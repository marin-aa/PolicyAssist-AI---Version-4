"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowDownToLine, ArrowLeft, BookOpen, Check, CircleDashed, Clock3, X } from "lucide-react";
import corpus from "@/data/corpus.json";
import evalSet from "@/data/eval.json";
import embeddingData from "@/data/embeddings.json";
import rerankData from "@/data/rerank.json";
import { applyRerank, decodeVectors, Retriever, LEXICAL_OPTIONS, RERANK_POOL, type Hit } from "@/lib/retrieval";
import type { Source } from "@/lib/types";

type Question = (typeof evalSet.questions)[number];
type Run = { id: string; ids: string[]; docs: string[]; chunkRecall: number; docRecall: number; ms: number };
type Status = "pass" | "fail" | "pending";

const K = 5;
const avg = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const fmt = (v: number) => v.toFixed(3).replace(".", ",");
const download = (name: string, content: string) => {
  const url = URL.createObjectURL(new Blob(["﻿" + content], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const csv = (v: string | number) => `"${String(v).replaceAll('"', '""')}"`;

function evaluate(questions: Question[], search: (q: Question) => Hit[]): Map<string, Run> {
  const runs = new Map<string, Run>();
  for (const q of questions) {
    if (!q.key || q.key.behavior !== "ANSWER") continue;
    const start = performance.now();
    const hits = search(q).slice(0, K);
    const ms = performance.now() - start;
    const ids = hits.map(h => h.chunk.id), docs = [...new Set(hits.map(h => h.documentId))];
    runs.set(q.id, { id: q.id, ids, docs, ms,
      chunkRecall: q.key.chunkIds.filter(c => ids.includes(c)).length / q.key.chunkIds.length,
      docRecall: q.key.documentIds.filter(d => docs.includes(d)).length / q.key.documentIds.length });
  }
  return runs;
}

export default function KpiPage() {
  const [view, setView] = useState<"keyed" | "all">("keyed");
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const data = useMemo(() => {
    const questions = evalSet.questions;
    const scoredQuestions = questions.filter(q => q.key?.behavior === "ANSWER");
    const hasEmbeddings = scoredQuestions.length > 0 && Object.keys(embeddingData.chunks).length > 0 && scoredQuestions.every(q => (embeddingData.questions as Record<string, string>)[`q:${q.id}`]);
    const queryVectors = hasEmbeddings ? decodeVectors(embeddingData.questions as Record<string, string>) : {};
    const retriever = new Retriever(corpus.documents as Source[], hasEmbeddings ? decodeVectors(embeddingData.chunks as Record<string, string>) : undefined);
    const date = (q: Question) => ({ referenceDate: q.referenceDate });
    const reranked = rerankData as { model: string; embeddingModel: string; questions: Record<string, { candidates: string[]; scores: Record<string, number> }> };
    const hasRerank = hasEmbeddings && scoredQuestions.every(q => reranked.questions[q.id]);
    let staleRerank = 0;
    const hybrid = (q: Question, k: number) => retriever.search(q.text, { ...LEXICAL_OPTIONS, ...date(q), queryVector: queryVectors[`q:${q.id}`], k });
    const stages = [
      { name: "BM25 thuần", detail: "Baseline: từ và cặp từ tiếng Việt, không lọc ngày", search: (q: Question) => retriever.search(q.text, { k: K }) },
      { name: "+ Lọc hiệu lực theo ngày", detail: "Bỏ đoạn chưa hoặc hết hiệu lực tại reference_date", search: (q: Question) => retriever.search(q.text, { k: K, ...date(q) }) },
      { name: "+ Bỏ từ nhiễu của câu hỏi", detail: "Bỏ “data pack” khỏi câu hỏi vì hầu hết nguồn đều có đoạn nhắc tới", search: (q: Question) => retriever.search(q.text, { k: K, ...date(q), cleanQuery: true }) },
      { name: "+ Gộp theo nhóm nguồn", detail: "Chuẩn hóa điểm trong nhóm pháp luật, nội bộ, FAQ rồi mới gộp; FAQ nhân 0,5", search: (q: Question) => retriever.search(q.text, { k: K, ...date(q), cleanQuery: true, mergeBySource: true }) },
      { name: "+ Đoạn kề nhau", detail: "Cộng 20% điểm của đoạn liền kề trong cùng tài liệu", search: (q: Question) => retriever.search(q.text, { k: K, ...date(q), ...LEXICAL_OPTIONS }) },
      { name: "+ Embedding (hybrid RRF)", detail: `Gemini embedding${hasEmbeddings ? ` (${embeddingData.model}, ${embeddingData.dims} chiều)` : ""}: hợp nhất thứ hạng BM25 và cosine bằng RRF`, search: hasEmbeddings ? (q: Question) => hybrid(q, K) : undefined },
      { name: `+ Rerank Gemini top-${RERANK_POOL}`, detail: `Gemini chấm lại ${RERANK_POOL} ứng viên hybrid${hasRerank ? ` (${reranked.model})` : ""}`, search: hasRerank ? (q: Question) => { const r = applyRerank(hybrid(q, RERANK_POOL), reranked.questions[q.id].scores); staleRerank += r.missing; return r.hits; } : undefined },
    ].map(({ search, ...stage }) => ({ ...stage, runs: search ? evaluate(questions, search) : undefined }));
    const available = stages.filter((st): st is typeof st & { runs: Map<string, Run> } => Boolean(st.runs));
    const base = available[0].runs, opt = available[available.length - 1].runs;
    const scored = questions.filter(q => base.has(q.id));
    const versioning = scored.filter(q => q.key?.scope === "VERSIONING");
    const mean = (runs: Map<string, Run>, qs: Question[], f: (r: Run) => number) => avg(qs.map(q => f(runs.get(q.id)!)));
    const summary = (runs: Map<string, Run>) => ({ recall: mean(runs, scored, r => r.chunkRecall), hit: mean(runs, scored, r => r.chunkRecall > 0 ? 1 : 0), docRecall: mean(runs, scored, r => r.docRecall), versioning: mean(runs, versioning, r => r.chunkRecall), ms: mean(runs, scored, r => r.ms) });
    const [b, o] = [summary(base), summary(opt)];
    return { questions, base, opt, scored, versioning, finalStage: available[available.length - 1].name, hasEmbeddings, hasRerank, staleRerank: staleRerank > 0, stages: stages.map(st => ({ ...st, ...(st.runs ? summary(st.runs) : {}) })),
      recall: [b.recall, o.recall], hit: [b.hit, o.hit], docRecall: [b.docRecall, o.docRecall], versioningRecall: [b.versioning, o.versioning], ms: [b.ms, summary(available[Math.min(4, available.length - 1)].runs).ms] };
  }, []);

  const keyed = data.questions.filter(q => q.key).length;
  const abstain = data.questions.filter(q => q.key?.behavior === "ABSTAIN").length;
  const rows: { metric: string; detail: string; target: string; base?: string; opt?: string; status: Status }[] = [
    { metric: `Retrieval Recall@${K}`, detail: `Tỷ lệ đoạn đúng nằm trong top-${K}, trung bình trên ${data.scored.length} câu ANSWER có đáp án mẫu. Mức tài liệu: ${fmt(data.docRecall[1])} · có ít nhất 1 đoạn đúng: ${fmt(data.hit[1])}. After Optimization = “${data.finalStage}”.`, target: "≥ 0,80", base: fmt(data.recall[0]), opt: fmt(data.recall[1]), status: data.recall[1] >= 0.8 ? "pass" : "fail" },
    { metric: "Versioning Recall@5", detail: `Recall@${K} riêng ${data.versioning.length} câu versioning (ngày tham chiếu khác 17/10/2026 hoặc cần chọn đúng phiên bản). Mẫu nhỏ. Đáp án mẫu có cả đoạn chưa hoặc hết hiệu lực tại ngày hỏi (chuỗi văn bản thay thế), nên lọc cứng theo ngày có thể làm Recall giảm.`, target: "Chưa đặt ngưỡng", base: fmt(data.versioningRecall[0]), opt: fmt(data.versioningRecall[1]), status: "pending" },
    { metric: "Answer Accuracy", detail: "Cần chạy Gemini trên bộ câu hỏi rồi chấm với reference_answer.", target: "Ngưỡng cần xác định", status: "pending" },
    { metric: "Citation Accuracy", detail: "Cần câu trả lời có citation để đối chiếu với citation_labels.", target: "≥ 0,80", status: "pending" },
    { metric: "Unsupported Answer Rate", detail: "Cần chấm các khẳng định không có căn cứ trong câu trả lời.", target: "Càng thấp càng tốt", status: "pending" },
    { metric: "Abstention Quality", detail: `Cần chạy Gemini trên ${abstain} câu ABSTAIN và các câu ANSWER để kiểm tra từ chối đúng lúc.`, target: "Chưa đặt ngưỡng", status: "pending" },
    { metric: "Average Latency", detail: `Độ trễ cả vòng hỏi đáp cần đo cùng Gemini. Riêng BM25 cục bộ: ${mounted ? `${data.ms[1].toFixed(2).replace(".", ",")} ms/câu` : "đang đo…"}; bước embedding và rerank gọi Gemini nên chậm hơn.`, target: "≤ 10 giây", status: "pending" },
  ];
  const measured = rows.filter(r => r.status !== "pending").length;
  const visible = data.questions.filter(q => view === "all" || q.key);

  function exportCsv() {
    const head = "question_id,expected_behavior,answer_scope,reference_date,relevant_chunk_ids,retrieved_baseline,retrieved_optimized,chunk_recall_baseline,chunk_recall_optimized,doc_recall_optimized,retrieval_ms_optimized";
    const lines = data.scored.map(q => { const b = data.base.get(q.id)!, o = data.opt.get(q.id)!; return [q.id, q.key!.behavior, q.key!.scope, q.referenceDate, q.key!.chunkIds.join(";"), b.ids.join(";"), o.ids.join(";"), b.chunkRecall.toFixed(3), o.chunkRecall.toFixed(3), o.docRecall.toFixed(3), o.ms.toFixed(2)].map(csv).join(","); });
    download("PolicyAssist-kpi-retrieval.csv", [head, ...lines].join("\n"));
  }

  return <div className="kpi-page">
    <header className="kpi-header">
      <Link className="kpi-back" href="/"><ArrowLeft size={15}/>Về sổ tay</Link>
      <Link className="brand" href="/" aria-label="PolicyAssist AI"><span className="brand-symbol"><BookOpen size={23}/></span><span>PolicyAssist<span className="ai-badge">AI</span></span></Link>
      <button className="export-button kpi-export" onClick={exportCsv}><ArrowDownToLine size={15}/><span>Xuất kết quả CSV</span></button>
    </header>
    <main className="kpi-main">
      <section className="kpi-intro">
        <div className="eyebrow">ĐÁNH GIÁ HỆ THỐNG</div>
        <h1>KPI Evaluation Dashboard</h1>
        <p>Đo trên bộ {data.questions.length} câu hỏi public của Data Pack, trong đó {keyed} câu có đáp án mẫu ({keyed - abstain} ANSWER, {abstain} ABSTAIN). Mới đo được {measured}/{rows.length} chỉ số; phần còn lại hiển thị Pending cho tới khi có kết quả thật.</p>
      </section>

      <section className="kpi-card" aria-label="Bảng KPI">
        <div className="kpi-table-scroll"><table className="kpi-table kpi-metrics">
          <thead><tr><th>Metric</th><th>Target</th><th>Baseline</th><th>After Optimization</th><th>Status</th></tr></thead>
          <tbody>{rows.map(r => <tr key={r.metric}>
            <td><strong>{r.metric}</strong><span>{r.detail}</span></td>
            <td data-label="Target">{r.target}</td><td className="num" data-label="Baseline">{r.base ?? "Chưa đo"}</td><td className="num" data-label="After Optimization">{r.opt ?? "Chưa đo"}</td>
            <td data-label="Status"><span className={`kpi-status ${r.status}`}>{r.status === "pass" ? <Check size={12}/> : r.status === "fail" ? <X size={12}/> : <CircleDashed size={12}/>}{r.status === "pass" ? "Đạt" : r.status === "fail" ? "Chưa đạt" : "Pending"}</span></td>
          </tr>)}</tbody>
        </table></div>
      </section>

      <section className="kpi-card" aria-label="Từng bước cải tiến">
        <div className="kpi-card-head"><h2>Từng bước cải tiến truy xuất</h2><span className="kpi-muted">Cộng dồn, đo trên {data.scored.length} câu ANSWER</span></div>
        <div className="kpi-table-scroll"><table className="kpi-table kpi-stages">
          <thead><tr><th>Cấu hình</th><th>Recall@{K}</th><th>Tài liệu</th><th>≥1 đoạn đúng</th><th>Versioning</th></tr></thead>
          <tbody>{data.stages.map((st, i) => {
            const previous = data.stages.slice(0, i).reverse().find(p => p.runs);
            const delta = previous && st.runs ? st.recall! - previous.recall! : undefined;
            return <tr key={st.name} className={st.name === data.finalStage ? "final" : ""}>
              <td><strong>{st.name}</strong><span>{st.detail}</span></td>
              {st.runs ? <>
                <td className="num" data-label={`Recall@${K}`}>{fmt(st.recall!)}{delta !== undefined && <small className={delta >= 0 ? "up" : "down"}>{delta >= 0 ? "+" : "−"}{fmt(Math.abs(delta))}</small>}</td>
                <td className="num" data-label="Tài liệu">{fmt(st.docRecall!)}</td><td className="num" data-label="≥1 đoạn đúng">{fmt(st.hit!)}</td><td className="num" data-label="Versioning">{fmt(st.versioning!)}</td>
              </> : <td colSpan={4} className="kpi-muted">Chưa chạy. Cần GEMINI_API_KEY trong .dev.vars rồi chạy scripts/build-embeddings.mjs{st.name.includes("Rerank") ? " --rerank" : ""}.</td>}
            </tr>;
          })}</tbody>
        </table></div>
      </section>

      <section className="kpi-note">
        <h2>Cách đo</h2>
        <ul>
          <li><strong>Baseline:</strong> BM25 (từ và cặp từ tiếng Việt) trên 374 đoạn, không lọc theo ngày. <strong>After Optimization:</strong> cấu hình cuối trong bảng cải tiến: lọc hiệu lực theo <code>reference_date</code>, bỏ từ nhiễu, gộp theo nhóm nguồn (pháp luật, nội bộ, FAQ theo <code>priority_level</code>) và cộng điểm đoạn kề.</li>
          <li>Recall@{K} theo đoạn = số đoạn đúng trong top-{K} chia tổng số đoạn đúng của câu, rồi lấy trung bình. Câu ABSTAIN không có đoạn đúng nên không tính vào Recall.</li>
          <li>Các bước cải tiến và tham số (k1, b, hệ số FAQ, hệ số đoạn kề) được chọn sau khi xem kết quả trên chính bộ public này. Khi dò tham số trên một nửa số câu rồi đo trên nửa còn lại, Recall@5 rơi vào khoảng 0,52 đến 0,60, nên đây là số liệu phát triển, chưa phải kiểm thử độc lập. Đáp án mẫu không được dùng để viết sẵn câu trả lời.</li>
          <li>Embedding và rerank được tính trước bằng <code>scripts/build-embeddings.mjs</code> (Gemini) và lưu trong <code>data/</code>; dashboard chỉ đọc kết quả đã lưu, không gọi Gemini khi mở trang. Rerank chấm lại {RERANK_POOL} ứng viên hybrid của từng câu.{data.staleRerank && <strong> Một số ứng viên hiện tại chưa có điểm rerank, hãy chạy lại script với --rerank.</strong>}</li>
          <li>Ứng dụng hiện gửi toàn bộ nguồn đã chọn cho Gemini nên bộ truy xuất này chưa nằm trong luồng hỏi đáp; nó chỉ phục vụ đo lường và là nền để làm RAG.</li>
        </ul>
      </section>

      <section className="kpi-card" aria-label="Chi tiết từng câu hỏi">
        <div className="kpi-card-head"><h2>Chi tiết từng câu hỏi</h2>
          <div className="source-filters">{([["keyed", `Có đáp án mẫu (${keyed})`], ["all", `Tất cả (${data.questions.length})`]] as const).map(([id, label]) => <button key={id} className={view === id ? "active" : ""} onClick={() => setView(id)}>{label}</button>)}</div></div>
        <div className="kpi-table-scroll"><table className="kpi-table kpi-questions">
          <thead><tr><th>Câu hỏi</th><th>Loại</th><th>Đoạn đúng (top-{K}, sau lọc ngày)</th><th>Recall</th></tr></thead>
          <tbody>{visible.map(q => { const run = data.opt.get(q.id); return <tr key={q.id}>
            <td><strong>{q.id}</strong><span>{q.text}</span>{q.referenceDate !== evalSet.snapshot && <span className="kpi-date"><Clock3 size={10}/>Ngày tham chiếu {q.referenceDate.split("-").reverse().join("/")}</span>}</td>
            <td>{q.key ? <span className={`kpi-tag ${q.key.behavior === "ABSTAIN" ? "abstain" : ""}`}>{q.key.scope === "OUT_OF_SCOPE" ? "Ngoài phạm vi" : q.key.scope}</span> : <span className="kpi-tag none">Chưa có đáp án</span>}</td>
            <td>{q.key?.behavior === "ANSWER" && run ? <div className="kpi-chips">{q.key.chunkIds.map(id => <span key={id} className={run.ids.includes(id) ? "hit" : "miss"}>{run.ids.includes(id) ? <Check size={10}/> : <X size={10}/>}{id}</span>)}</div> : <span className="kpi-muted">{q.key?.behavior === "ABSTAIN" ? "Kỳ vọng từ chối" : "—"}</span>}</td>
            <td className="num">{run ? fmt(run.chunkRecall) : "—"}</td>
          </tr>; })}</tbody>
        </table></div>
      </section>
    </main>
  </div>;
}
