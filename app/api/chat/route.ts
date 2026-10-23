import { env } from "cloudflare:workers";
import corpus from "@/data/corpus.json";
import { buildGeminiBody, RequestError, upstreamError, validateInput } from "@/lib/gemini";

export async function POST(request: Request) {
  try {
    const declaredSize = Number(request.headers.get("content-length") || 0);
    if (declaredSize > 1800000) throw new RequestError("Nội dung gửi lên quá lớn.", 413);
    const text = await request.text();
    if (text.length > 900000) throw new RequestError("Nội dung gửi lên quá lớn.", 413);
    let raw;
    try { raw = JSON.parse(text); } catch { throw new RequestError("Yêu cầu JSON không hợp lệ."); }
    const input = validateInput(raw);
    const key = request.headers.get("x-gemini-key")?.trim() || (env as unknown as Record<string,string>).GEMINI_API_KEY || process.env.GEMINI_API_KEY;
    if (!key) throw new RequestError("Hãy kết nối API key Gemini trong Cài đặt để bắt đầu.", 401);
    if (key.length > 200 || /[\r\n]/.test(key)) throw new RequestError("API key không hợp lệ.");
    const body = buildGeminiBody(input, corpus.documents);
    const upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${input.model}:streamGenerateContent?alt=sse`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body), signal: AbortSignal.any([request.signal, AbortSignal.timeout(90000)]),
    });
    if (!upstream.ok) {
      await upstream.body?.cancel();
      return Response.json({ error: upstreamError(upstream.status) }, { status: upstream.status, headers: { "Cache-Control": "no-store" } });
    }
    return new Response(upstream.body, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (e) {
    const error = e as Error;
    return Response.json({ error: e instanceof RequestError ? error.message : error.name === "TimeoutError" ? "Gemini phản hồi quá lâu. Vui lòng thử lại." : error.name === "AbortError" ? "Đã dừng trả lời." : "Không kết nối được Gemini. Vui lòng thử lại." }, { status: e instanceof RequestError ? e.status : 502, headers: { "Cache-Control": "no-store" } });
  }
}
