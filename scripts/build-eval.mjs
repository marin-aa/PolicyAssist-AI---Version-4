// Chuyển questions_sample.csv + answer_key_sample.csv của Data Pack thành data/eval.json,
// và gắn nhóm nguồn (tier) từ priority_level trong document_metadata.csv vào data/corpus.json.
// Dùng: node scripts/build-eval.mjs "<thư mục Data Pack>"
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = process.argv[2];
if (!dir) throw new Error("Cần đường dẫn thư mục Data Pack.");

function parseCsv(text) {
  const rows = []; let row = [], cell = "", quoted = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c; }
    else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some(Boolean)) rows.push(row); row = []; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.map(r => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}
const list = v => v.split(/[;,]/).map(s => s.trim()).filter(Boolean);

const questions = parseCsv(readFileSync(join(dir, "questions_sample.csv"), "utf8"));
const keys = new Map(parseCsv(readFileSync(join(dir, "answer_key_sample.csv"), "utf8")).map(r => [r.question_id, r]));
const out = {
  snapshot: "2026-10-17",
  questions: questions.map(q => {
    const k = keys.get(q.question_id);
    return {
      id: q.question_id, text: q.question_text, referenceDate: q.reference_date,
      ...(k ? { key: { behavior: k.expected_behavior, scope: k.answer_scope, referenceAnswer: k.reference_answer, documentIds: list(k.relevant_document_ids), chunkIds: list(k.relevant_chunk_ids), citationLabels: list(k.citation_labels), note: k.grading_note } } : {}),
    };
  }),
};
const target = fileURLToPath(new URL("../data/eval.json", import.meta.url));
writeFileSync(target, JSON.stringify(out));
console.log(`${out.questions.length} câu hỏi, ${out.questions.filter(q => q.key).length} có đáp án mẫu -> ${target}`);

// priority_level 1-3: pháp luật, 4: quy chế/quy trình nội bộ, 5: sổ tay/FAQ (README Data Pack, mục 2).
const corpusPath = fileURLToPath(new URL("../data/corpus.json", import.meta.url));
const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
const tiers = new Map(parseCsv(readFileSync(join(dir, "document_metadata.csv"), "utf8")).map(r => [r.document_id, Number(r.priority_level) <= 3 ? "law" : Number(r.priority_level) === 4 ? "internal" : "faq"]));
for (const d of corpus.documents) { if (!tiers.has(d.id)) throw new Error(`Thiếu metadata cho ${d.id}`); d.tier = tiers.get(d.id); }
writeFileSync(corpusPath, JSON.stringify(corpus, null, 2) + "\n");
console.log(`Đã gắn tier cho ${corpus.documents.length} tài liệu.`);
