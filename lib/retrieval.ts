import type { Source, SourceChunk } from "./types";

export interface RetrievalOptions {
  /** Chỉ giữ đoạn có hiệu lực tại ngày tham chiếu (YYYY-MM-DD). */
  referenceDate?: string;
  /** Bỏ từ khóa nhiễu của câu hỏi (tên bộ dữ liệu) trước khi tìm. */
  cleanQuery?: boolean;
  /** Chuẩn hóa điểm trong từng nhóm nguồn (pháp luật, nội bộ, FAQ) rồi mới gộp, để nhóm này không lấn hết top-k. */
  mergeBySource?: boolean;
  /** Cộng một phần điểm của đoạn liền kề (cùng tài liệu) vào đoạn đang xét. */
  neighbor?: number;
  /** Vector (đã chuẩn hóa) của câu hỏi; cần Retriever có vector đoạn. Kết quả BM25 và cosine được hợp nhất bằng RRF. */
  queryVector?: Float32Array;
  k?: number;
}

export interface Hit { chunk: SourceChunk; documentId: string; documentType: string; tier: string; score: number }

/** Cấu hình lexical cuối cùng, dùng chung cho dashboard và script tạo rerank. */
export const LEXICAL_OPTIONS = { cleanQuery: true, mergeBySource: true, neighbor: 0.2 } as const;
/** Số ứng viên đưa vào bước rerank. */
export const RERANK_POOL = 20;

const STOP = new Set("và của là có các một những được cho trong khi với này để theo như hoặc thì đã không cần phải nào gì bao nhiêu thế nếu thuộc về tại từ đến".split(" "));
const QUERY_NOISE = new Set(["data", "pack"]);
const K1 = 1.2, B = 0.75, RRF_K = 60;

function tokens(text: string, noise?: Set<string>): string[] {
  const words = text.normalize("NFC").toLocaleLowerCase("vi").split(/[^\p{L}\p{N}]+/u).filter(w => w && !STOP.has(w) && !noise?.has(w));
  const grams: string[] = [];
  for (let i = 0; i < words.length - 1; i++) grams.push(`${words[i]}_${words[i + 1]}`);
  return [...words, ...grams];
}

function neighborIds(id: string): string[] {
  const m = id.match(/^(.*_C)(\d+)$/);
  return m ? [-1, 1].map(d => `${m[1]}${String(Number(m[2]) + d).padStart(m[2].length, "0")}`) : [];
}

/** Giải mã vector int8 (base64, đã chuẩn hóa độ dài 1, nhân 127) do scripts/build-embeddings.mjs ghi ra. */
export function decodeVector(base64: string): Float32Array {
  const raw = atob(base64), out = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) { const b = raw.charCodeAt(i); out[i] = (b > 127 ? b - 256 : b) / 127; }
  return out;
}

export function decodeVectors(encoded: Record<string, string>): Record<string, Float32Array> {
  return Object.fromEntries(Object.entries(encoded).map(([id, v]) => [id, decodeVector(v)]));
}

/** Sắp lại danh sách ứng viên theo điểm rerank; đoạn thiếu điểm xếp cuối. Trả thêm số đoạn thiếu điểm. */
export function applyRerank(hits: Hit[], scores: Record<string, number> | undefined): { hits: Hit[]; missing: number } {
  if (!scores) return { hits, missing: hits.length };
  const rank = new Map(hits.map((h, i) => [h.chunk.id, i]));
  const score = (h: Hit) => scores[h.chunk.id] ?? -1;
  return { hits: [...hits].sort((a, b) => score(b) - score(a) || rank.get(a.chunk.id)! - rank.get(b.chunk.id)!), missing: hits.filter(h => scores[h.chunk.id] === undefined).length };
}

export class Retriever {
  private docs: { hit: Omit<Hit, "score">; tf: Map<string, number>; len: number }[];
  private df = new Map<string, number>();
  private avgLen: number;
  private vectors?: Record<string, Float32Array>;

  constructor(sources: Source[], vectors?: Record<string, Float32Array>) {
    this.vectors = vectors;
    this.docs = sources.flatMap(s => s.chunks.map(chunk => {
      const terms = tokens(`${s.title} ${s.topic} ${chunk.heading} ${chunk.location} ${chunk.label} ${chunk.text}`);
      const tf = new Map<string, number>();
      for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1);
      return { hit: { chunk, documentId: s.id, documentType: s.type, tier: s.tier ?? (s.type === "internal" ? "internal" : "law") }, tf, len: terms.length };
    }));
    for (const d of this.docs) for (const t of d.tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    this.avgLen = this.docs.reduce((n, d) => n + d.len, 0) / (this.docs.length || 1);
  }

  search(query: string, { referenceDate, cleanQuery, mergeBySource, neighbor = 0, queryVector, k = 5 }: RetrievalOptions = {}): Hit[] {
    const q = [...new Set(tokens(query, cleanQuery ? QUERY_NOISE : undefined))];
    const n = this.docs.length;
    const normalizeTiers = (hits: Hit[]) => {
      const best = new Map<string, number>();
      for (const h of hits) best.set(h.tier, Math.max(best.get(h.tier) ?? 0, h.score));
      return hits.map(h => ({ ...h, score: h.score / (best.get(h.tier) || 1) * (h.tier === "faq" ? 0.5 : 1) }));
    };
    let lexical = this.docs
      .filter(d => !referenceDate || (!d.hit.chunk.effectiveFrom || d.hit.chunk.effectiveFrom <= referenceDate) && (!d.hit.chunk.effectiveTo || d.hit.chunk.effectiveTo >= referenceDate))
      .map(d => {
        let score = 0;
        for (const t of q) {
          const f = d.tf.get(t); if (!f) continue;
          const df = this.df.get(t)!;
          score += Math.log(1 + (n - df + 0.5) / (df + 0.5)) * (f * (K1 + 1)) / (f + K1 * (1 - B + B * d.len / this.avgLen));
        }
        return { ...d.hit, score };
      });
    if (mergeBySource) lexical = normalizeTiers(lexical);
    if (neighbor) {
      const byId = new Map(lexical.map(h => [h.chunk.id, h.score]));
      lexical = lexical.map(h => ({ ...h, score: h.score + neighbor * Math.max(0, ...neighborIds(h.chunk.id).map(id => byId.get(id) ?? 0)) }));
    }
    const byScore = (a: Hit, b: Hit) => b.score - a.score;
    if (!queryVector || !this.vectors) return lexical.filter(h => h.score > 0).sort(byScore).slice(0, k);

    let semantic = lexical.map(h => {
      const v = this.vectors![h.chunk.id];
      let dot = 0; if (v) for (let i = 0; i < v.length; i++) dot += v[i] * queryVector[i];
      return { ...h, score: dot };
    });
    if (mergeBySource) semantic = normalizeTiers(semantic);
    const ranks = (hits: Hit[]) => new Map([...hits].sort(byScore).map((h, i) => [h.chunk.id, i]));
    const lexRank = ranks(lexical), semRank = ranks(semantic);
    return lexical
      .map(h => ({ ...h, score: 1 / (RRF_K + lexRank.get(h.chunk.id)!) + 1 / (RRF_K + semRank.get(h.chunk.id)!) }))
      .sort(byScore).slice(0, k);
  }
}
