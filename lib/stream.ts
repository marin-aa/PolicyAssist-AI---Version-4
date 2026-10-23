export async function readGeminiStream(response: Response, onText: (text: string) => void) {
  if (!response.body) throw new Error("Gemini không trả về nội dung.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", text = "", finishReason = "";
  const processEvent = (event: string) => {
    const payload = event.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()).join("\n");
    if (!payload || payload === "[DONE]") return;
    const value = JSON.parse(payload);
    if (value.error) throw new Error("Gemini gặp lỗi trong khi trả lời. Vui lòng thử lại.");
    const candidate = value.candidates?.[0];
    if (value.promptFeedback?.blockReason || candidate?.finishReason === "SAFETY" || candidate?.finishReason === "RECITATION") throw new Error("Gemini chưa thể trả lời nội dung này. Hãy thử diễn đạt lại câu hỏi.");
    for (const part of candidate?.content?.parts ?? []) {
      if (part.text && !part.thought) { text += part.text; onText(text); }
    }
    if (candidate?.finishReason) finishReason = candidate.finishReason;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
      let index;
      while ((index = buffer.indexOf("\n\n")) >= 0) {
        processEvent(buffer.slice(0, index));
        buffer = buffer.slice(index + 2);
      }
      if (done) break;
    }
    if (buffer.trim()) processEvent(buffer);
    if (!text.trim()) throw new Error("Gemini chưa trả về nội dung. Hãy thử lại với câu hỏi cụ thể hơn.");
    return { text, truncated: finishReason === "MAX_TOKENS" };
  } finally { reader.releaseLock(); }
}
