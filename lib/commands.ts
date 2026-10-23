export interface Command {
  name: string;
  title: string;
  desc: string;
  /** Gợi ý nội dung sau tên lệnh, hiển thị trong menu. */
  hint: string;
  /** "ai" gửi lời nhắc đã mở rộng đến Gemini; "action" chạy ngay trong ứng dụng. */
  kind: "ai" | "action";
  /** Lệnh AI bắt buộc có nội dung đi kèm. */
  needsText?: boolean;
  prompt?: (text: string, referenceDate: string) => string;
}

const dmy = (date: string) => date.split("-").reverse().join("/");
const RULES = "Chỉ dùng các nguồn đã chọn, không dùng kiến thức ngoài. Mỗi nhận định chính phải kèm citation là ID đoạn trong ngoặc vuông. Nếu thiếu căn cứ, nói rõ phần nào không đủ căn cứ thay vì suy đoán.";

export const COMMANDS: Command[] = [
  { name: "analyse", title: "Phân tích", desc: "Phân tích sâu một vấn đề, nêu rủi ro và kết luận", hint: "vấn đề cần phân tích", kind: "ai", needsText: true,
    prompt: (t, d) => `Phân tích sâu vấn đề sau theo các nguồn đã chọn, tại ngày tham chiếu ${dmy(d)}: ${t}\nTrình bày theo cấu trúc:\n1. Tóm tắt vấn đề và ngày áp dụng.\n2. Căn cứ pháp luật có hiệu lực tại ngày tham chiếu.\n3. Quy định hoặc quy trình nội bộ liên quan; chỉ ra chỗ khác hoặc xung đột với pháp luật.\n4. Phân tích, rủi ro và điểm cần lưu ý.\n5. Kết luận ngắn.\n${RULES}` },
  { name: "research", title: "Nghiên cứu", desc: "Tổng hợp mọi căn cứ liên quan theo thứ tự ưu tiên nguồn", hint: "chủ đề cần nghiên cứu", kind: "ai", needsText: true,
    prompt: (t, d) => `Nghiên cứu chủ đề sau trong các nguồn đã chọn, tại ngày tham chiếu ${dmy(d)}: ${t}\nTìm mọi đoạn liên quan rồi tổng hợp theo thứ tự ưu tiên: pháp luật đang có hiệu lực, quy chế hoặc quy trình nội bộ, sổ tay hoặc FAQ. Với mỗi nhóm nêu ý chính của từng nguồn kèm citation và tình trạng hiệu lực. Cuối cùng nêu khoảng trống thông tin trong nguồn và 2-3 câu hỏi nên hỏi tiếp.\n${RULES}` },
  { name: "check", title: "Kiểm chứng", desc: "Kiểm tra một nhận định là đúng, sai hay chưa đủ căn cứ", hint: "nhận định cần kiểm tra", kind: "ai", needsText: true,
    prompt: (t, d) => `Kiểm chứng nhận định sau với các nguồn đã chọn, tại ngày tham chiếu ${dmy(d)}: "${t}"\nKết luận một trong ba mức: Đúng, Sai hoặc Không đủ căn cứ trong các nguồn đã chọn. Sau đó giải thích ngắn, trích đoạn nguồn ủng hộ hoặc bác bỏ, và nêu nếu nhận định đúng ở thời điểm khác hoặc chỉ đúng với quy trình nội bộ chứ không phải pháp luật.\n${RULES}` },
  { name: "versions", title: "Hiệu lực văn bản", desc: "Xác định văn bản nào áp dụng tại ngày tham chiếu", hint: "chủ đề hoặc loại văn bản", kind: "ai", needsText: true,
    prompt: (t, d) => `Xác định văn bản nào áp dụng cho chủ đề "${t}" tại ngày tham chiếu ${dmy(d)}.\nLập bảng gồm: văn bản, hiệu lực từ, hiệu lực đến, trạng thái, văn bản thay thế hoặc bị thay thế. Sau bảng, kết luận văn bản áp dụng, giải thích chuỗi thay thế nếu có và nêu văn bản lịch sử không còn áp dụng. Không mặc định dùng văn bản mới nhất; kiểm tra mốc hiệu lực của từng đoạn.\n${RULES}` },
  { name: "compare", title: "So sánh", desc: "Đối chiếu pháp luật với quy trình nội bộ hoặc giữa các phiên bản", hint: "nội dung cần so sánh", kind: "ai", needsText: true,
    prompt: (t, d) => `So sánh các quy định liên quan đến: ${t}\nDùng bảng Markdown với các cột: nội dung, pháp luật (nêu văn bản và hiệu lực tại ${dmy(d)}), quy trình nội bộ, điểm khác biệt hoặc cần lưu ý. Chỉ so sánh khi có đủ căn cứ ở cả hai bên; nếu không, ghi "Không đủ căn cứ".\n${RULES}` },
  { name: "explain", title: "Giải thích", desc: "Giải thích dễ hiểu, có ví dụ ngắn lấy từ nguồn", hint: "khái niệm hoặc quy định", kind: "ai", needsText: true,
    prompt: t => `Giải thích bằng ngôn ngữ dễ hiểu cho người không chuyên: ${t}\nBắt đầu bằng một câu tóm tắt, sau đó giải thích từng ý ngắn gọn và đưa một ví dụ ngắn nếu nguồn có tình huống phù hợp.\n${RULES}` },
  { name: "cite", title: "Tìm căn cứ", desc: "Chỉ liệt kê các đoạn nguồn liên quan, không phân tích dài", hint: "điều cần tìm căn cứ", kind: "ai", needsText: true,
    prompt: (t, d) => `Tìm các đoạn nguồn làm căn cứ cho: ${t} (ngày tham chiếu ${dmy(d)}).\nChỉ trả về danh sách, mỗi dòng gồm citation, loại nguồn (pháp luật, nội bộ, FAQ), hiệu lực và một câu mô tả đoạn đó nói gì. Sắp xếp theo mức liên quan, nguồn pháp luật có hiệu lực trước. Không phân tích thêm.\n${RULES}` },
  { name: "summarize", title: "Tóm tắt", desc: "Tóm tắt các nguồn đã chọn theo nhóm chủ đề", hint: "trọng tâm (không bắt buộc)", kind: "ai",
    prompt: (t, d) => `Tóm tắt nội dung chính của các nguồn đã chọn theo nhóm chủ đề${t ? `, tập trung vào: ${t}` : ""}. Ngày tham chiếu ${dmy(d)}; nêu rõ điểm cần lưu ý về hiệu lực và tài liệu giả lập.\n${RULES}` },
  { name: "checklist", title: "Checklist", desc: "Tạo danh sách kiểm tra từng bước", hint: "quy trình cần kiểm tra (không bắt buộc)", kind: "ai",
    prompt: (t, d) => `Tạo checklist${t ? ` cho: ${t}` : " kiểm tra và phê duyệt chứng từ thanh toán"} dựa trên các nguồn đã chọn, tại ngày tham chiếu ${dmy(d)}. Dùng danh sách đánh số, nêu vai trò thực hiện nếu có căn cứ, mỗi bước kèm citation.\n${RULES}` },
  { name: "quiz", title: "Câu hỏi ôn tập", desc: "Tạo 5 câu hỏi ôn tập kèm đáp án", hint: "chủ đề (không bắt buộc)", kind: "ai",
    prompt: t => `Tạo 5 câu hỏi ôn tập ngắn${t ? ` về: ${t}` : " về tài chính, kế toán từ các nguồn đã chọn"}. Với mỗi câu, cung cấp đáp án và citation.\n${RULES}` },
  { name: "date", title: "Ngày tham chiếu", desc: "Đặt ngày tham chiếu cho các câu hỏi tiếp theo", hint: "dd/mm/yyyy hoặc yyyy-mm-dd", kind: "action", needsText: true },
  { name: "export", title: "Xuất ghi chú", desc: "Tải ghi chú dưới dạng Markdown", hint: "", kind: "action" },
  { name: "clear", title: "Hội thoại mới", desc: "Xóa hội thoại hiện tại, giữ nguồn và ghi chú", hint: "", kind: "action" },
];

/** Lệnh khớp với phần đang gõ khi ô nhập mới chỉ có "/" và tên lệnh, chưa có khoảng trắng. */
export function matchCommands(input: string): Command[] {
  const m = input.match(/^\/([^\s/]*)$/);
  if (!m) return [];
  const q = m[1].toLowerCase();
  return COMMANDS.filter(c => c.name.startsWith(q) || c.title.toLocaleLowerCase("vi").includes(q));
}

export type ParsedCommand = { command: Command; text: string } | { unknown: string } | null;

export function parseCommand(input: string): ParsedCommand {
  const m = input.trim().match(/^\/([^\s/]+)(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  const command = COMMANDS.find(c => c.name === m[1].toLowerCase());
  return command ? { command, text: (m[2] ?? "").trim() } : { unknown: m[1] };
}

/** Chuyển dd/mm/yyyy hoặc yyyy-mm-dd thành yyyy-mm-dd; trả null nếu không hợp lệ. */
export function parseDate(text: string): string | null {
  const m = text.trim().match(/^(?:(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})|(\d{4})-(\d{2})-(\d{2}))$/);
  if (!m) return null;
  const [y, mo, d] = m[4] ? [m[4], m[5], m[6]] : [m[3], m[2].padStart(2, "0"), m[1].padStart(2, "0")];
  const iso = `${y}-${mo}-${d}`;
  return Number.isFinite(Date.parse(iso)) && new Date(iso).toISOString().slice(0, 10) === iso ? iso : null;
}
