# PolicyAssist AI — demo localhost

Giao diện lấy cảm hứng từ NotebookLM: nguồn tài liệu, hội thoại và Studio. React/TypeScript chạy trên Vinext/Vite. Không triển khai lên dịch vụ hosting.

## Chạy

```sh
npm install
npm run dev -- --port 3000
```

Mở http://localhost:3000. Cần Node.js 22.13 trở lên.

Key Gemini nằm trong `.dev.vars`, chỉ được đọc phía máy chủ; tệp này bị Git bỏ qua. Mẫu cấu hình nằm trong `.env.example`. Sau khi đổi key trong `.dev.vars`, khởi động lại server. Có thể nhập key tạm trong Cài đặt; key tạm chỉ nằm trong bộ nhớ tab, không lưu vào localStorage.

## Chức năng

- 20 tài liệu / 374 đoạn từ Data Pack, tìm và lọc danh sách nguồn, chọn nguồn dùng trong hội thoại.
- Hỏi đáp Gemini Flash, trả lời streaming, dừng, thử lại, sao chép và lưu ghi chú.
- Nhấp citation để mở đúng đoạn trong nguồn chuẩn hóa.
- Studio tạo tóm tắt, bảng so sánh, checklist, câu hỏi ôn tập qua Gemini thật.
- Đính kèm tệp TXT/MD/CSV trực tiếp trong ô câu hỏi; tệp được gửi cùng câu hỏi, tối đa 100.000 ký tự.
- Thêm nguồn TXT/MD/CSV hoặc dán văn bản; đọc nguồn; ghi chú thủ công; xuất Markdown.
- Lưu hội thoại, nguồn bổ sung và ghi chú tại trình duyệt, giao diện responsive.

Mặc định `gemini-3.8-flash`; có thể đổi trong Cài đặt. Dùng key thuộc free tier; ứng dụng không tự đổi sang mô hình khác khi hết quota. Tài liệu Google: https://ai.google.dev/gemini-api/docs/pricing.

## Đánh giá KPI

Trang `/kpi` (nút “Đánh giá KPI” ở thanh đầu) đo bộ truy xuất BM25 trên 90 câu hỏi public và 30 đáp án mẫu của Data Pack: Recall@5 và Recall@5 cho câu versioning, so Baseline (BM25 thuần) với After Optimization (lọc hiệu lực theo `reference_date`, bỏ từ nhiễu, gộp điểm theo nhóm nguồn pháp luật/nội bộ/FAQ và cộng điểm đoạn kề), kèm bảng đóng góp của từng bước. Hai bước cuối (Gemini embedding hybrid với BM25 bằng RRF, rồi Gemini rerank top-20) cần key: thêm `GEMINI_API_KEY` vào `.dev.vars`, chạy `node --experimental-strip-types scripts/build-embeddings.mjs --rerank` (thêm `--force` để bỏ cache), rồi mở lại `/kpi`; kết quả được lưu trong `data/embeddings.json` và `data/rerank.json`. `node scripts/build-eval.mjs` cũng gắn nhóm nguồn (`tier`) từ `priority_level` vào `data/corpus.json`. Các chỉ số cần chạy Gemini (Answer Accuracy, Citation Accuracy, Unsupported Answer Rate, Abstention Quality, Latency) hiển thị Pending cho tới khi đo thật. Dữ liệu nằm trong `data/eval.json`, tạo lại bằng:

```sh
node scripts/build-eval.mjs "<thư mục Data Pack>"
```

## Phạm vi demo

**Chưa có RAG.** Máy chủ gửi toàn bộ nội dung nguồn được chọn trực tiếp đến Gemini. Ngày tham chiếu nằm trong prompt; chưa có bộ lọc hiệu lực hoặc kiểm chứng citation tự động. Citation là ID do mô hình sinh, được liên kết tới nguồn để người dùng tự đối chiếu. Không công bố confidence hay KPI chưa đo.

Nguồn trong `data/corpus.json` được chuyển từ `document_metadata.csv` và `legal_chunks.csv` của Data Pack. Không sử dụng câu hỏi/đáp án mẫu để hard-code phản hồi. SIM01–SIM08 là tài liệu nội bộ giả lập. Khi hỏi đáp hoặc chạy Studio, nội dung nguồn đã chọn được gửi đến Google.

## Kiểm tra

```sh
npx tsc --noEmit
npm run build
```

API `GET /api/config` chỉ trả trạng thái có key và mô hình, không trả key. `POST /api/chat` kiểm tra đầu vào, lấy nguồn theo ID và gọi Gemini qua máy chủ. Các lỗi quota, key, timeout được trả về bằng thông báo tiếng Việt.
