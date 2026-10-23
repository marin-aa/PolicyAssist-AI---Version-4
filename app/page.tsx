"use client";

import { useEffect, useRef, useState, type ReactNode, type FormEvent } from "react";
import { ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUp, BookOpen, Bookmark, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, ClipboardCheck, Clock3, Copy, ExternalLink, FileCheck2, FileText, Files, FolderOpen, KeyRound, LayoutGrid, ListChecks, LoaderCircle, Maximize2, MessageSquare, Minimize2, MoreHorizontal, NotebookPen, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Paperclip, Pencil, Plus, Scale, Search, Settings2, ShieldCheck, Sparkles, Square, StickyNote, Trash2, Upload, X } from "lucide-react";
import corpus from "@/data/corpus.json";
import type { Message, Note, Source } from "@/lib/types";
import { DEFAULT_MODEL, MODELS } from "@/lib/gemini";
import { readGeminiStream } from "@/lib/stream";
import { matchCommands, parseCommand, parseDate, type Command } from "@/lib/commands";

const INITIAL_TITLE = "Sổ tay chính sách tài chính";
const BUILTIN: Source[] = corpus.documents;
const PROMPTS = [
  { icon: FileCheck2, title: "Hóa đơn điện tử", text: "Hóa đơn điện tử có sai sót thì cần xử lý như thế nào?", color: "green" },
  { icon: Clock3, title: "Tạm ứng & công tác phí", text: "Quy trình tạm ứng và hoàn ứng công tác phí tại Nova Việt gồm những bước nào?", color: "peach" },
  { icon: Scale, title: "Hiệu lực văn bản", text: "Những văn bản nào trong Data Pack về hóa đơn điện tử áp dụng tại ngày tham chiếu?", color: "blue" },
  { icon: ClipboardCheck, title: "Chứng từ thanh toán", text: "Cần kiểm tra những gì trước khi phê duyệt chứng từ thanh toán?", color: "purple" },
];
const STUDIO = [
  { icon: FileText, title: "Tóm tắt", desc: "Nắm nhanh ý chính", color: "green", prompt: "Tóm tắt nội dung chính của các nguồn đã chọn theo nhóm chủ đề, kèm citation cho từng ý. Nêu rõ điểm cần lưu ý về hiệu lực và tài liệu giả lập." },
  { icon: Scale, title: "Bảng so sánh", desc: "Đối chiếu quy định", color: "blue", prompt: "Tạo bảng so sánh quy định pháp luật và quy trình nội bộ về hóa đơn, chứng từ trong các nguồn đã chọn. Mỗi hàng cần có nội dung, nguồn pháp luật, nguồn nội bộ và điểm cần lưu ý. Chỉ so sánh khi có đủ căn cứ và dẫn citation." },
  { icon: ListChecks, title: "Checklist", desc: "Từng bước thực hiện", color: "peach", prompt: "Tạo checklist kiểm tra và phê duyệt chứng từ thanh toán dựa trên các nguồn đã chọn. Dùng danh sách đánh số, nêu vai trò nếu có căn cứ, kèm citation cho từng bước." },
  { icon: CircleHelp, title: "Câu hỏi ôn tập", desc: "Củng cố kiến thức", color: "purple", prompt: "Tạo 5 câu hỏi ôn tập ngắn về tài chính, kế toán từ các nguồn đã chọn. Với mỗi câu, cung cấp đáp án và citation. Không dùng thông tin ngoài nguồn." },
];
const COMMAND_ICONS: Record<string, typeof Sparkles> = { analyse: Sparkles, research: Search, check: ShieldCheck, versions: Clock3, compare: Scale, explain: BookOpen, cite: FileCheck2, summarize: FileText, checklist: ListChecks, quiz: CircleHelp, date: Clock3, export: ArrowDownToLine, clear: Trash2 };
type QuestionAttachment = { name: string; text: string };

function uid() { return crypto.randomUUID(); }
function dateLabel(date: string) { return date ? date.split("-").reverse().join("/") : "Chưa xác định"; }
function statusLabel(s: Source) { return s.type === "internal" ? "Nội bộ giả lập" : s.type === "upload" ? "Nguồn của bạn" : ["REPEALED", "EXPIRED", "SUPERSEDED", "HISTORICAL"].some(t => s.status.includes(t)) ? "Văn bản lịch sử" : "Theo Data Pack"; }
function download(name: string, content: string, mime = "text/markdown;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const dialog = ref.current;
    dialog?.querySelector<HTMLElement>("input, textarea, button, a")?.focus();
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
      if (e.key === "Tab") {
        const items = dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, select, a[href], [tabindex="0"]');
        if (!items?.length) return;
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", handle);
    return () => { document.removeEventListener("keydown", handle); previous?.focus(); };
  }, []);
  return <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div ref={ref} className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}><div className="modal-header"><h2>{title}</h2><button className="icon-button" aria-label="Đóng" onClick={onClose}><X size={19}/></button></div>{children}</div></div>;
}

function RichText({ text, sources, onCitation }: { text: string; sources: Source[]; onCitation: (id: string, sources?: Source[]) => void }) {
  const inline = (value: string): ReactNode[] => value.split(/(\*\*[^*]+\*\*|`[^`]+`|\[(?:LAW\d+_C\d+|SIM\d+_C\d+|USR_[a-zA-Z0-9_-]+)\])/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2,-2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i}>{part.slice(1,-1)}</code>;
    if (part.startsWith("[")) {
      const id = part.slice(1,-1), source = sources.find(s => s.id === id || s.chunks.some(c => c.id === id));
      if (source) return <button key={i} className="citation" title={`Mở ${source.id}: ${source.title}`} onClick={() => onCitation(id, sources)}>{source.id}<ArrowUp size={9}/></button>;
    }
    return part;
  });
  const lines = text.split("\n"), out: ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith("|") && lines[i+1]?.match(/^\s*\|?[\s:|-]+\|/)) {
      const rows = [line]; i++;
      while (lines[i+1]?.trim().startsWith("|")) rows.push(lines[++i]);
      const cells = (r: string) => r.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());
      out.push(<div className="table-scroll" key={`t${i}`}><table><thead><tr>{cells(rows[0]).map((c,j) => <th key={j}>{inline(c)}</th>)}</tr></thead><tbody>{rows.slice(1).map((r,j) => <tr key={j}>{cells(r).map((c,k) => <td key={k}>{inline(c)}</td>)}</tr>)}</tbody></table></div>);
    } else if (/^#{1,4}\s/.test(line)) out.push(<h3 key={i}>{inline(line.replace(/^#{1,4}\s/,""))}</h3>);
    else if (/^\s*[-*]\s/.test(line)) out.push(<div className="markdown-list" key={i}><span className="list-dot"/><div>{inline(line.replace(/^\s*[-*]\s/,""))}</div></div>);
    else if (/^\s*\d+[.)]\s/.test(line)) out.push(<div className="markdown-list" key={i}><span className="list-number">{line.match(/^\s*(\d+)/)?.[1]}.</span><div>{inline(line.replace(/^\s*\d+[.)]\s/,""))}</div></div>);
    else if (line.trim() && !/^---+$/.test(line.trim())) out.push(<p key={i}>{inline(line)}</p>);
    else out.push(<div key={i} className="paragraph-space"/>);
  }
  return <div className="rich-text">{out}</div>;
}

export default function Home() {
  const [title, setTitle] = useState(INITIAL_TITLE);
  const [editingTitle, setEditingTitle] = useState(false);
  const [customSources, setCustomSources] = useState<Source[]>([]);
  const [selected, setSelected] = useState<string[]>(BUILTIN.map(s => s.id));
  const [messages, setMessages] = useState<Message[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [input, setInput] = useState("");
  const [questionFile, setQuestionFile] = useState<QuestionAttachment | null>(null);
  const [busy, setBusy] = useState(false);
  const [referenceDate, setReferenceDate] = useState("2026-10-17");
  const [apiKey, setApiKey] = useState("");
  const [serverKey, setServerKey] = useState(false);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [settings, setSettings] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [modelInput, setModelInput] = useState(DEFAULT_MODEL);
  const [addSource, setAddSource] = useState(false);
  const [sourceTab, setSourceTab] = useState("file");
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [sourceError, setSourceError] = useState("");
  const [viewer, setViewer] = useState<{ source: Source; chunk?: string } | null>(null);
  const [noteEditor, setNoteEditor] = useState<Note | null>(null);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [notePreview, setNotePreview] = useState<Note | null>(null);
  const [modal, setModal] = useState<"about" | "clear" | null>(null);
  const [toast, setToast] = useState("");
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [focused, setFocused] = useState(false);
  const [mobileTab, setMobileTab] = useState("chat");
  const [activeStudio, setActiveStudio] = useState("");
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashClosed, setSlashClosed] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const abort = useRef<AbortController | null>(null);
  const pendingTask = useRef<{ question: string; noteTitle?: string; attachment?: QuestionAttachment; display?: string; command?: string } | null>(null);
  const messagesEnd = useRef<HTMLDivElement>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const storageError = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const questionFileRef = useRef<HTMLInputElement>(null);
  const allSources = [...BUILTIN, ...customSources];
  const chosenSources = allSources.filter(s => selected.includes(s.id));
  const filtered = allSources.filter(s => (filter === "all" || s.type === filter) && `${s.title} ${s.id} ${s.topic}`.toLocaleLowerCase("vi").includes(query.toLocaleLowerCase("vi")));
  const ready = Boolean(apiKey || serverKey);
  const slashMatches = busy || slashClosed ? [] : matchCommands(input);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("policyassist-workspace-v1") || "null");
      if (stored) {
        if (typeof stored.title === "string") setTitle(stored.title);
        if (Array.isArray(stored.customSources)) setCustomSources(stored.customSources);
        if (Array.isArray(stored.selected)) setSelected(stored.selected);
        if (Array.isArray(stored.messages)) setMessages(stored.messages);
        if (Array.isArray(stored.notes)) setNotes(stored.notes);
        if (typeof stored.referenceDate === "string") setReferenceDate(stored.referenceDate);
        if (MODELS.includes(stored.model)) { setModel(stored.model); setModelInput(stored.model); }
      }
    } catch { setToast("Không đọc được phiên trước. Đã mở không gian mới."); }
    setHydrated(true);
    fetch("/api/config").then(r => r.json() as Promise<{ configured: boolean }>).then(data => setServerKey(data.configured === true)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!hydrated || busy) return;
    try {
      localStorage.setItem("policyassist-workspace-v1", JSON.stringify({ title, customSources, selected, messages, notes, referenceDate, model }));
      storageError.current = false;
    } catch { if (!storageError.current) { setToast("Bộ nhớ trình duyệt đã đầy. Hãy xuất ghi chú để giữ lại nội dung."); storageError.current = true; } }
  }, [title, customSources, selected, messages, notes, referenceDate, model, hydrated, busy]);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(""), 4500); return () => clearTimeout(id); }, [toast]);
  useEffect(() => { const el = scrollArea.current; if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 240) messagesEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages]);
  useEffect(() => { if (viewer?.chunk) { const id = setTimeout(() => document.getElementById(`source-${viewer.chunk}`)?.scrollIntoView({ block: "center", behavior: "smooth" }),100); return () => clearTimeout(id); } }, [viewer]);
  useEffect(() => () => abort.current?.abort(), []);

  function openSettings() { setKeyInput(apiKey); setModelInput(model); setSettings(true); }
  function toggleSource(id: string) { setSelected(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev,id]); }
  function openCitation(id: string, sourceList = allSources) {
    const source = sourceList.find(s => s.id === id || s.chunks.some(c => c.id === id));
    if (source) setViewer({ source, chunk: id });
  }
  async function copy(text: string) { try { await navigator.clipboard.writeText(text); setToast("Đã sao chép nội dung."); } catch { setToast("Trình duyệt chưa cho phép sao chép. Bạn có thể chọn và sao chép văn bản."); } }
  function exportNotes() {
    const contents = notes.length ? notes.map(n => `## ${n.title}\n\n${n.content}\n\n${n.sources?.length ? "Nguồn: " + n.sources.map(s => `${s.id} — ${s.title}`).join("; ") : ""}`).join("\n\n---\n\n") : messages.filter(m => m.role === "assistant" && !m.failed).map(m => m.content).join("\n\n---\n\n");
    if (!contents) { setToast("Tạo ghi chú hoặc bắt đầu hội thoại để xuất nội dung."); return; }
    download("PolicyAssist-ghi-chu.md", `# ${title}\n\nNgày tham chiếu: ${dateLabel(referenceDate)}\n\n${contents}\n\n---\nDữ liệu Case Study PolicyAssist AI. Nguồn SIM là tài liệu giả lập.\n`);
    setToast("Đã xuất ghi chú dưới dạng Markdown.");
  }

  async function sendQuestion(question: string, generatedNoteTitle?: string, overrideKey?: string, historyOverride?: Message[], overrideModel?: string, attachment?: QuestionAttachment, display?: string, command?: string) {
    const q = question.trim();
    if (!q || busy) return;
    if (!selected.length && !attachment) { setToast("Chọn ít nhất một nguồn hoặc đính kèm tệp để bắt đầu hỏi đáp."); setMobileTab("sources"); return; }
    const attachedSource: Source | undefined = attachment ? (() => {
      const id = `USR_${uid().replaceAll("-", "")}`;
      const text = attachment.text.trim();
      return { id, title: attachment.name.slice(0,250), type: "upload", topic: "Tệp đính kèm", summary: text.slice(0,180), effectiveDate: "", expiryDate: "", status: "USER_PROVIDED", url: "", chunks: [{ id, heading: attachment.name, location: "Tệp đính kèm trong câu hỏi", text, label: attachment.name, effectiveFrom: "", effectiveTo: "" }] };
    })() : undefined;
    const selectedCustomSources = customSources.filter(s => selected.includes(s.id));
    if (attachedSource && selectedCustomSources.length >= 30) { setToast("Hãy bỏ chọn một nguồn bổ sung trước khi đính kèm tệp."); return; }
    if (attachedSource && selected.length >= 50) { setToast("Hãy bỏ chọn một nguồn trước khi đính kèm tệp."); return; }
    if (attachedSource && selectedCustomSources.reduce((sum, source) => sum + source.chunks[0].text.length, 0) + attachedSource.chunks[0].text.length > 300000) { setToast("Tệp và các nguồn bổ sung đã chọn vượt giới hạn 300.000 ký tự. Hãy bỏ chọn bớt nguồn."); return; }
    if (!ready && !overrideKey) { pendingTask.current = { question: q, noteTitle: generatedNoteTitle, attachment, display, command }; openSettings(); return; }
    const history = (historyOverride ?? messages).filter(m => !m.failed && m.content.trim()).slice(-20);
    const userMessage: Message = { id: uid(), role: "user", content: q, ...(display ? { display, command } : {}), ...(attachedSource ? { attachmentName: attachedSource.title, attachmentSourceId: attachedSource.id } : {}) };
    const requestSources = attachedSource ? [...chosenSources, attachedSource] : chosenSources;
    const requestSourceIds = attachedSource ? [...selected, attachedSource.id] : selected;
    const requestCustomSources = attachedSource ? [...selectedCustomSources, attachedSource] : selectedCustomSources;
    const answerId = uid();
    setMessages([...history, userMessage, { id: answerId, role: "assistant", content: "", sources: requestSources }]);
    setInput(""); setQuestionFile(null); if (questionFileRef.current) questionFileRef.current.value = ""; setBusy(true); setMobileTab("chat"); setActiveStudio(generatedNoteTitle || "");
    const controller = new AbortController(); abort.current = controller;
    const start = performance.now(); let answer = "";
    setTimeout(() => messagesEnd.current?.scrollIntoView({ behavior: "smooth" }), 80);
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json", ...((overrideKey ?? apiKey) ? { "x-gemini-key": overrideKey ?? apiKey } : {}) },
        body: JSON.stringify({ messages: [...history,userMessage].map(m => ({ role: m.role, content: m.content })), sourceIds: requestSourceIds, customSources: requestCustomSources, referenceDate, model: overrideModel ?? model }), signal: controller.signal });
      if (!response.ok) { const error = await response.json().catch(() => ({})) as { error?: string }; throw new Error(error.error || "Không kết nối được Gemini. Vui lòng thử lại."); }
      const result = await readGeminiStream(response, text => { answer = text; setMessages(prev => prev.map(m => m.id === answerId ? { ...m, content: text } : m)); });
      const citedSources = requestSources.filter(s => s.chunks.some(c => result.text.includes(`[${c.id}]`)) || result.text.includes(`[${s.id}]`));
      setMessages(prev => prev.map(m => m.id === answerId ? { ...m, content: result.text, latency: (performance.now()-start)/1000, sources: citedSources } : m));
      if (result.truncated) setToast("Câu trả lời đã chạm giới hạn độ dài. Bạn có thể yêu cầu giải thích tiếp.");
      if (generatedNoteTitle) { setNotes(prev => [{ id: uid(), title: generatedNoteTitle, content: result.text, sources: citedSources, createdAt: new Date().toISOString() },...prev]); setToast(`Đã lưu “${generatedNoteTitle}” vào ghi chú.`); }
    } catch (error) {
      const stopped = controller.signal.aborted;
      const message = stopped ? "Đã dừng tạo câu trả lời." : (error as Error).message;
      setMessages(prev => prev.map(m => m.id === answerId ? { ...m, content: answer ? `${answer}\n\n${message}` : message, failed: true, sources: attachedSource ? [...chosenSources.filter(s => s.chunks.some(c => answer.includes(`[${c.id}]`))), attachedSource] : chosenSources.filter(s => s.chunks.some(c => answer.includes(`[${c.id}]`))), latency: (performance.now()-start)/1000 } : m));
    } finally { setBusy(false); setActiveStudio(""); abort.current = null; }
  }

  function saveAnswer(message: Message) {
    const index = messages.findIndex(m => m.id === message.id);
    setNotes(prev => [{ id: uid(), title: (messages[index-1]?.display ?? messages[index-1]?.content)?.slice(0,90) || "Ghi chú từ hội thoại", content: message.content, sources: message.sources, createdAt: new Date().toISOString() },...prev]);
    setToast("Đã lưu câu trả lời vào ghi chú.");
  }
  function addTextSource(name: string, text: string) {
    if (!text.trim()) { setSourceError("Nguồn cần có nội dung văn bản."); return; }
    if (text.length > 100000) { setSourceError("Mỗi nguồn tối đa 100.000 ký tự."); return; }
    if (customSources.length >= 30) { setSourceError("Bạn đã đạt giới hạn 30 nguồn bổ sung."); return; }
    const id = `USR_${uid().replaceAll("-", "")}`;
    const source: Source = { id, title: name.trim().slice(0,250) || "Nguồn mới", type: "upload", topic: "Tài liệu của bạn", summary: text.slice(0,180), effectiveDate: "", expiryDate: "", status: "USER_PROVIDED", url: "", chunks: [{ id, heading: name, location: "Nội dung đã nhập", text: text.trim(), label: name, effectiveFrom: "", effectiveTo: "" }] };
    setCustomSources(prev => [...prev,source]); setSelected(prev => [...prev,id]); setAddSource(false); setSourceTitle(""); setSourceText(""); setSourceError(""); setToast("Đã thêm nguồn vào sổ tay.");
  }
  async function uploadFile(file?: File) {
    if (!file) return;
    if (!/\.(txt|md|csv)$/i.test(file.name)) { setSourceError("Vui lòng chọn tệp TXT, Markdown hoặc CSV."); return; }
    if (file.size > 400000) { setSourceError("Tệp quá lớn. Mỗi nguồn tối đa 100.000 ký tự."); return; }
    try { addTextSource(file.name, await file.text()); } catch { setSourceError("Không đọc được tệp. Hãy thử lại với tệp UTF-8."); }
  }
  async function attachQuestionFile(file?: File) {
    if (!file) return;
    if (!/\.(txt|md|csv)$/i.test(file.name)) { setToast("Chỉ hỗ trợ tệp TXT, Markdown hoặc CSV."); return; }
    if (file.size > 400000) { setToast("Tệp quá lớn. Mỗi tệp tối đa 100.000 ký tự."); return; }
    try {
      const text = await file.text();
      if (!text.trim()) { setToast("Tệp không có nội dung văn bản."); return; }
      if (text.length > 100000) { setToast("Tệp quá lớn. Mỗi tệp tối đa 100.000 ký tự."); return; }
      setQuestionFile({ name: file.name, text });
    } catch { setToast("Không đọc được tệp. Hãy thử lại với tệp UTF-8."); }
  }
  function runCommand(command: Command, text: string) {
    if (command.needsText && !text) { setToast(`Nhập nội dung sau /${command.name}: ${command.hint}.`); return; }
    if (command.kind === "action") {
      if (busy) { setToast("Hãy chờ câu trả lời hiện tại hoàn tất."); return; }
      if (command.name === "date") {
        const iso = parseDate(text);
        if (!iso) { setToast("Ngày không hợp lệ. Dùng dd/mm/yyyy hoặc yyyy-mm-dd."); return; }
        setReferenceDate(iso); setToast(`Đã đặt ngày tham chiếu: ${dateLabel(iso)}.`);
      } else if (command.name === "export") exportNotes();
      else if (messages.length) setModal("clear"); else setToast("Bạn đang ở cuộc hội thoại mới.");
      setInput(""); return;
    }
    sendQuestion(command.prompt!(text, referenceDate), undefined, undefined, undefined, undefined, questionFile ?? undefined, text || command.title, command.name);
  }
  function submitInput() {
    const parsed = parseCommand(input);
    if (!parsed) { sendQuestion(input, undefined, undefined, undefined, undefined, questionFile ?? undefined); return; }
    if ("unknown" in parsed) { setToast(`Không có lệnh /${parsed.unknown}. Gõ / để xem danh sách lệnh.`); return; }
    runCommand(parsed.command, parsed.text);
  }
  function pickCommand(command: Command) {
    if (command.kind === "action" && !command.needsText) { runCommand(command, ""); return; }
    setInput(`/${command.name} `); setSlashClosed(true); composerRef.current?.focus();
  }
  function newNote() { setNoteEditor({ id: uid(), title: "", content: "", createdAt: new Date().toISOString() }); setNoteTitle(""); setNoteContent(""); }
  function editNote(note: Note) { setNotePreview(null); setNoteEditor(note); setNoteTitle(note.title); setNoteContent(note.content); }

  return <div className="app-shell">
    <header className="app-header">
      <a className="brand" href="/" aria-label="PolicyAssist AI"><span className="brand-symbol"><BookOpen size={23}/><Sparkles size={12} className="brand-spark"/></span><span>PolicyAssist<span className="ai-badge">AI</span></span></a>
      <span className="header-divider"/>
      <div className="notebook-name">{editingTitle ? <input aria-label="Tên sổ tay" value={title} maxLength={90} onChange={e => setTitle(e.target.value)} onBlur={() => { setEditingTitle(false); if (!title.trim()) setTitle(INITIAL_TITLE); }} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} autoFocus/> : <button onClick={() => setEditingTitle(true)}>{title}<Pencil size={13}/></button>}</div>
      <div className="header-actions"><span className="local-status"><span/>Đã lưu trên trình duyệt</span><button className="icon-button help-button" title="Về bản demo" aria-label="Về bản demo" onClick={() => setModal("about")}><CircleHelp size={19}/></button><a className="settings-button" href="/kpi" title="KPI Evaluation Dashboard"><ClipboardCheck size={16}/><span>Đánh giá KPI</span></a><button className="settings-button" onClick={openSettings}><Settings2 size={16}/><span>Cài đặt</span></button><button className="export-button" onClick={exportNotes}><ArrowDownToLine size={15}/><span>Xuất ghi chú</span></button><span className="avatar" title="Không gian cá nhân">PA</span></div>
    </header>

    <div className="workspace-intro"><div><span className="workspace-dot"/>KHÔNG GIAN LÀM VIỆC<span className="intro-separator">/</span><span className="intro-name">Tài chính & kế toán</span></div><button className={`model-status ${ready ? "ready" : ""}`} onClick={openSettings}><Sparkles size={13}/>{model.replace("gemini-", "Gemini ").replace("-flash-lite"," Flash-Lite").replace("-flash"," Flash")}<span className="status-dot"/>{!ready && <span className="connect-text">Kết nối</span>}<ChevronDown size={12}/></button></div>

    <nav className="mobile-tabs" aria-label="Khu vực làm việc">{[{ id: "sources", label: "Nguồn", icon: Files },{ id: "chat", label: "Hội thoại", icon: MessageSquare },{ id: "studio", label: "Studio", icon: NotebookPen }].map(t => <button key={t.id} className={mobileTab === t.id ? "active" : ""} onClick={() => setMobileTab(t.id)}><t.icon size={16}/>{t.label}{t.id === "sources" && <span>{allSources.length}</span>}</button>)}</nav>

    <main className={`workspace ${(!leftOpen || focused) ? "left-collapsed" : ""} ${(!rightOpen || focused) ? "right-collapsed" : ""} mobile-${mobileTab}`}>
      <aside className="sources-panel panel">
        <div className="panel-heading"><h2>Nguồn tài liệu <span className="count-badge">{allSources.length}</span></h2><button className="icon-button panel-toggle" aria-label="Thu gọn nguồn" title="Thu gọn nguồn" onClick={() => setLeftOpen(false)}><PanelLeftClose size={17}/></button></div>
        <div className="source-actions"><button className="add-source-button" onClick={() => { setSourceError(""); setAddSource(true); }}><Plus size={16}/>Thêm nguồn</button><button className="icon-button source-info" title="Thông tin Data Pack" aria-label="Thông tin Data Pack" onClick={() => setModal("about")}><FolderOpen size={17}/></button></div>
        <label className="source-search"><Search size={15}/><input placeholder="Tìm trong nguồn tài liệu" aria-label="Tìm nguồn tài liệu" value={query} onChange={e => setQuery(e.target.value)}/>{query && <button className="mini-icon" aria-label="Xóa tìm kiếm" onClick={() => setQuery("")}><X size={13}/></button>}</label>
        <div className="source-filters" aria-label="Lọc loại nguồn">{[{ id: "all", name: "Tất cả" },{ id: "law", name: "Pháp luật" },{ id: "internal", name: "Nội bộ" }].map(f => <button key={f.id} className={filter === f.id ? "active" : ""} onClick={() => setFilter(f.id)}>{f.name}</button>)}</div>
        <div className="select-all"><label><input type="checkbox" checked={filtered.length > 0 && filtered.every(s => selected.includes(s.id))} onChange={() => setSelected(prev => filtered.every(s => prev.includes(s.id)) ? prev.filter(id => !filtered.some(s => s.id === id)) : [...new Set([...prev,...filtered.map(s => s.id)])])}/><span>Chọn tất cả</span></label><span>{chosenSources.length} đã chọn</span></div>
        <div className="source-list">{filtered.map(s => <div className={`source-row ${selected.includes(s.id) ? "selected" : ""}`} key={s.id}>
          <button className="source-open" onClick={() => setViewer({ source: s })}><span className={`document-icon ${s.type === "internal" ? "peach" : s.type === "upload" ? "purple" : "green"}`}><FileText size={17}/></span><span className="source-row-text"><span className="source-title">{s.title.replace(" tại Công ty Cổ phần Nova Việt", "")}</span><span className="source-meta">{s.type === "upload" ? "Của bạn" : s.id}<span>·</span>{s.type === "internal" ? "Giả lập" : s.topic}</span></span></button><input type="checkbox" aria-label={`Chọn ${s.id}: ${s.title}`} checked={selected.includes(s.id)} onChange={() => toggleSource(s.id)}/>
        </div>)}{!filtered.length && <div className="source-empty"><Search size={23}/><p>Không tìm thấy nguồn phù hợp.</p><button className="text-button" onClick={() => { setQuery(""); setFilter("all"); }}>Xóa bộ lọc</button></div>}</div>
        <div className="corpus-footer"><span className="corpus-icon"><ShieldCheck size={17}/></span><div><strong>Data Pack · Bảng A</strong><span>Snapshot 17.10.2026 <span className="tiny-dot">·</span> 374 đoạn</span></div><button className="mini-icon" aria-label="Chi tiết Data Pack" onClick={() => setModal("about")}><ChevronRight size={16}/></button></div>
      </aside>

      <section className="chat-panel panel" aria-label="Hội thoại với PolicyAssist">
        <div className="panel-heading chat-heading"><div className="chat-title">{(!leftOpen || focused) && <button className="icon-button panel-toggle" aria-label="Mở bảng nguồn" onClick={() => { setFocused(false); setLeftOpen(true); }}><PanelLeftOpen size={17}/></button>}<h2><MessageSquare size={16}/>Hội thoại</h2><span className="subtle-label">Cùng hiểu rõ chính sách</span></div><div className="chat-header-actions"><button className="icon-button" title="Cuộc hội thoại mới" aria-label="Cuộc hội thoại mới" onClick={() => messages.length ? setModal("clear") : setToast("Bạn đang ở cuộc hội thoại mới.")} disabled={busy}><Plus size={18}/></button><button className="icon-button focus-button" title={focused ? "Thoát chế độ tập trung" : "Chế độ tập trung"} aria-label={focused ? "Thoát chế độ tập trung" : "Chế độ tập trung"} onClick={() => setFocused(!focused)}>{focused ? <Minimize2 size={16}/> : <Maximize2 size={16}/>}</button>{(!rightOpen || focused) && <button className="icon-button panel-toggle" aria-label="Mở Studio" onClick={() => { setFocused(false); setRightOpen(true); }}><PanelRightOpen size={17}/></button>}</div></div>
        <div className={`chat-scroll ${messages.length ? "has-messages" : ""}`} ref={scrollArea}>
          {!messages.length ? <div className="welcome">
            <div className="welcome-emblem"><BookOpen size={33} strokeWidth={1.5}/><span><Sparkles size={17}/></span></div>
            <div className="eyebrow">ÍT THỜI GIAN TRA CỨU. NHIỀU ĐIỀU SÁNG TỎ.</div>
            <h1>Hiểu chính sách.<br/><span>Vững quyết định.</span></h1>
            <p className="welcome-description">Một không gian để đọc, hỏi và kết nối kiến thức<br className="desktop-br"/> tài chính, kế toán, thuế từ tài liệu của bạn.</p>
            <div className="notebook-overview"><div className="overview-heading"><span><span className="overview-dot"/>Sổ tay của bạn đã sẵn sàng</span><BookOpen size={17}/></div><p>Từ hóa đơn điện tử đến quy trình thanh toán nội bộ — bắt đầu bằng một câu hỏi, đi sâu bằng những nguồn cụ thể.</p><div className="overview-tags"><span><Files size={12}/>{allSources.length} tài liệu</span><span><ShieldCheck size={12}/>LAW & SIM</span><span><Clock3 size={12}/>17.10.2026</span></div></div>
            <div className="prompt-heading"><Sparkles size={14}/><span>Bạn muốn tìm hiểu điều gì?</span></div>
            <div className="prompt-grid">{PROMPTS.map(p => <button key={p.title} className="prompt-card" onClick={() => sendQuestion(p.text)}><span className={`prompt-icon ${p.color}`}><p.icon size={17}/></span><strong>{p.title}</strong><p>{p.text}</p><ArrowUp size={14} className="prompt-arrow"/></button>)}</div>
            <div className="welcome-footnote"><BookOpen size={13}/>Hiểu rõ hơn, từ chính nguồn bạn chọn.</div>
          </div> : <div className="message-list">{messages.map((m,index) => <article key={m.id} className={`message ${m.role} ${m.failed ? "failed" : ""}`}>
            {m.role === "user" ? <div className="user-message"><span className="message-author">Bạn{m.command && <span className="command-badge">/{m.command}</span>}</span><p>{m.display ?? m.content}</p>{m.attachmentName && <span className="message-attachment"><Paperclip size={12}/>{m.attachmentName}</span>}</div> : <><div className="assistant-author"><span className="assistant-avatar"><Sparkles size={15}/></span><strong>PolicyAssist <span>AI</span></strong>{m.latency !== undefined && <span className="response-time"><Clock3 size={11}/>{m.latency.toFixed(1)} giây</span>}</div><div className="assistant-content">{!m.content ? <div className="thinking"><span/><span/><span/><span className="thinking-text">Đang đọc các nguồn bạn chọn…</span></div> : <RichText text={m.content} sources={[...allSources,...(m.sources || [])]} onCitation={openCitation}/>}</div>{m.content && !(busy && index === messages.length-1) && <div className="message-actions">{!m.failed && <button onClick={() => saveAnswer(m)}><Bookmark size={13}/>Lưu ghi chú</button>}<button onClick={() => copy(m.content)}><Copy size={13}/>Sao chép</button>{m.failed && <button disabled={busy} onClick={() => { const userMessage = messages[index-1]; const source = userMessage?.attachmentSourceId ? m.sources?.find(s => s.id === userMessage.attachmentSourceId) : undefined; const attachment = source ? { name: source.title, text: source.chunks[0]?.text || "" } : undefined; sendQuestion(userMessage?.content || "", undefined, undefined, messages.slice(0,index-1), undefined, attachment, userMessage?.display, userMessage?.command); }}><ArrowRight size={13}/>Thử lại</button>}{!!m.sources?.length && !m.failed && <span className="answer-source-count">{m.sources.length} nguồn được dẫn</span>}</div>}</>}
          </article>)}<div ref={messagesEnd}/></div>}
        </div>
        <div className="composer-area"><div className="composer-context"><span><span className={`small-status-dot ${selected.length || questionFile ? "green-dot" : ""}`}/>{chosenSources.length + (questionFile ? 1 : 0)} nguồn sẽ gửi</span><label className="reference-date"><Clock3 size={12}/><span>Ngày tham chiếu</span><input aria-label="Ngày tham chiếu" type="date" value={referenceDate} onChange={e => setReferenceDate(e.target.value)} disabled={busy}/></label></div>{slashMatches.length > 0 && <div className="slash-menu" role="listbox" aria-label="Lệnh">{slashMatches.map((c, i) => { const Icon = COMMAND_ICONS[c.name] ?? Sparkles; return <button type="button" role="option" aria-selected={i === slashIndex} key={c.name} className={i === slashIndex ? "active" : ""} onMouseEnter={() => setSlashIndex(i)} onMouseDown={e => { e.preventDefault(); pickCommand(c); }}><span className="slash-icon"><Icon size={15}/></span><span className="slash-text"><strong>/{c.name}<em>{c.title}</em>{c.kind === "action" && <i>Thao tác</i>}</strong><span>{c.desc}</span></span>{c.hint && <small>{c.hint}</small>}</button>; })}</div>}<form className={`composer ${busy ? "is-busy" : ""}`} onSubmit={(e: FormEvent) => { e.preventDefault(); submitInput(); }}><textarea ref={composerRef} aria-label="Câu hỏi của bạn" placeholder="Đặt câu hỏi hoặc gõ / để dùng lệnh…" value={input} onChange={e => { setInput(e.target.value); setSlashClosed(false); setSlashIndex(0); }} maxLength={12000} rows={2} onKeyDown={e => {
            if (e.nativeEvent.isComposing) return;
            if (slashMatches.length) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setSlashIndex(i => (i + (e.key === "ArrowDown" ? 1 : slashMatches.length - 1)) % slashMatches.length); return; }
              if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pickCommand(slashMatches[Math.min(slashIndex, slashMatches.length - 1)]); return; }
              if (e.key === "Escape") { e.preventDefault(); setSlashClosed(true); return; }
            }
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitInput(); }
          }}/>{questionFile && <div className="attachment-chip"><span className="attachment-file"><FileText size={15}/><span><strong>{questionFile.name}</strong><small>Đính kèm cho câu hỏi này · {questionFile.text.length.toLocaleString("vi-VN")} ký tự</small></span></span><button type="button" className="attachment-remove" aria-label={`Gỡ tệp ${questionFile.name}`} title="Gỡ tệp" onClick={() => { setQuestionFile(null); if (questionFileRef.current) questionFileRef.current.value = ""; }}><X size={14}/></button></div>}<div className="composer-bottom"><div className="composer-tools"><button type="button" className="attach-button" onClick={() => questionFileRef.current?.click()} disabled={busy}><Paperclip size={13}/>{questionFile ? "Đổi tệp" : "Đính kèm tệp"}</button><button type="button" className="attach-button slash-button" onClick={() => { setInput("/"); setSlashClosed(false); setSlashIndex(0); composerRef.current?.focus(); }} disabled={busy} title="Lệnh nhanh"><span aria-hidden>/</span>Lệnh</button><span><Sparkles size={13}/>{busy ? "Gemini đang trả lời" : "Câu trả lời bắt đầu từ nguồn của bạn"}</span></div><input ref={questionFileRef} type="file" accept=".txt,.md,.csv" hidden disabled={busy} onChange={e => { void attachQuestionFile(e.target.files?.[0]); e.currentTarget.value = ""; }}/>{busy ? <button className="send-button stop" type="button" aria-label="Dừng trả lời" onClick={() => abort.current?.abort()}><Square size={14} fill="currentColor"/></button> : <button className="send-button" type="submit" aria-label="Gửi câu hỏi" disabled={!input.trim() || (!selected.length && !questionFile)}><ArrowUp size={19}/></button>}</div></form><p className="composer-disclaimer">Tệp đính kèm và nguồn đã chọn được gửi đến Gemini cùng câu hỏi. <span>AI có thể mắc sai sót; hãy kiểm tra nguồn.</span></p></div>
      </section>

      <aside className="studio-panel panel"><div className="panel-heading"><h2><NotebookPen size={17}/>Studio</h2><button className="icon-button panel-toggle" aria-label="Thu gọn Studio" title="Thu gọn Studio" onClick={() => setRightOpen(false)}><PanelRightClose size={17}/></button></div><div className="studio-scroll"><div className="studio-section-label">BIẾN TÀI LIỆU THÀNH KIẾN THỨC</div><div className="studio-grid">{STUDIO.map(tool => <button key={tool.title} className={`studio-tool ${tool.color}`} disabled={busy} onClick={() => sendQuestion(tool.prompt, tool.title)}><div><tool.icon size={20} strokeWidth={1.6}/>{activeStudio === tool.title ? <LoaderCircle size={13} className="spin"/> : <ArrowUp size={12}/>}</div><strong>{tool.title}</strong><span>{tool.desc}</span></button>)}</div><p className="studio-hint"><Sparkles size={11}/>Được tạo từ các nguồn bạn chọn</p><div className="notes-heading"><h3>Ghi chú của bạn <span>{notes.length.toString().padStart(2,"0")}</span></h3><button className="icon-button" title="Tạo ghi chú" aria-label="Tạo ghi chú" onClick={newNote}><Plus size={17}/></button></div>{!notes.length ? <div className="notes-empty"><div className="note-illustration"><span className="illustration-paper back"/><span className="illustration-paper front"><i/><i/><i/><span><Plus size={12}/></span></span></div><strong>Một ý hay, đừng để trôi qua.</strong><p>Lưu câu trả lời hoặc viết ghi chú<br/>để giữ lại điều quan trọng.</p><button className="new-note-button" onClick={newNote}><Plus size={14}/>Tạo ghi chú đầu tiên</button></div> : <div className="notes-list">{notes.map(note => <button className="note-card" key={note.id} onClick={() => setNotePreview(note)}><span className="note-card-icon"><StickyNote size={16}/></span><div><strong>{note.title}</strong><p>{note.content.replace(/[#*`\[\]]/g,"").slice(0,95)}</p><span>{new Date(note.createdAt).toLocaleDateString("vi-VN")}</span></div><ChevronRight size={14}/></button>)}</div>}<div className="studio-tip"><span className="tip-spark"><Sparkles size={16}/></span><div><strong>Thử hỏi sâu hơn</strong><p>Chọn một vài nguồn liên quan để câu trả lời tập trung hơn vào điều bạn cần.</p></div></div><button className={`connection-card ${ready ? "connected" : ""}`} onClick={openSettings}><span className="connection-icon">{ready ? <CheckCheck size={17}/> : <KeyRound size={17}/>}</span><div><strong>{ready ? "Gemini đã sẵn sàng" : "Kết nối trí tuệ của bạn"}</strong><span>{ready ? "Bắt đầu với một câu hỏi" : "Thêm Gemini API key để bắt đầu"}</span></div><ChevronRight size={15}/></button></div><div className="studio-footer"><span className="footer-brand">p<span>.</span></span><span>Rõ nguồn. Rõ điều bạn cần.</span></div></aside>
    </main>

    {toast && <div className="toast" role="status"><Check size={15}/>{toast}<button aria-label="Đóng thông báo" onClick={() => setToast("")}><X size={14}/></button></div>}

    {settings && <Modal title="Kết nối Gemini" onClose={() => { setSettings(false); pendingTask.current = null; }}><div className="modal-body"><div className="settings-intro"><span><Sparkles size={23}/></span><div><h3>Một chiếc chìa khóa. Nhiều điều sáng tỏ.</h3><p>Dùng API key của bạn để hỏi đáp với Gemini Flash.</p></div></div><form onSubmit={e => { e.preventDefault(); if (!keyInput.trim() && !serverKey) { setToast("Hãy nhập API key Gemini để tiếp tục."); return; } const nextKey = keyInput.trim(); setApiKey(nextKey); setModel(modelInput); setSettings(false); setToast("Đã lưu cài đặt cho phiên làm việc này."); const task = pendingTask.current; pendingTask.current = null; if (task) sendQuestion(task.question, task.noteTitle, nextKey, undefined, modelInput, task.attachment, task.display, task.command); }}><label className="field-label" htmlFor="api-key">Gemini API key {serverKey && <span className="field-badge">Máy chủ đã có key</span>}</label><div className="key-field"><KeyRound size={16}/><input id="api-key" type="password" value={keyInput} onChange={e => setKeyInput(e.target.value)} placeholder={serverKey ? "Để trống để dùng key máy chủ" : "AIza…"} autoComplete="off" spellCheck={false}/></div><p className="field-help">Key chỉ được giữ trong phiên đang mở, không lưu vào trình duyệt.</p><a className="api-key-link" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Lấy API key tại Google AI Studio<ExternalLink size={12}/></a><label className="field-label model-label" htmlFor="model">Mô hình</label><select id="model" value={modelInput} onChange={e => setModelInput(e.target.value)}><option value="gemini-3.8-flash">Gemini 3.8 Flash · Mặc định</option><option value="gemini-3.5-flash-lite">Gemini 3.5 Flash-Lite</option><option value="gemini-2.5-flash">Gemini 2.5 Flash · Tài khoản tương thích</option></select><div className="settings-note"><ShieldCheck size={16}/><p>Dùng API key thuộc free tier để demo. Hạn mức và quyền truy cập mô hình do Google áp dụng cho từng tài khoản.</p></div><div className="modal-actions">{apiKey && <button type="button" className="text-button danger-text" onClick={() => { setApiKey(""); setKeyInput(""); setToast("Đã xóa key khỏi phiên làm việc."); }}>Xóa key</button>}<button type="button" className="secondary-button" onClick={() => { setSettings(false); pendingTask.current = null; }}>Để sau</button><button type="submit" className="primary-button"><Check size={15}/>Lưu & tiếp tục</button></div></form></div></Modal>}

    {addSource && <Modal title="Thêm nguồn vào sổ tay" onClose={() => setAddSource(false)}><div className="modal-body"><p className="modal-description">Đưa tài liệu của bạn vào cuộc hội thoại.</p><div className="dialog-tabs"><button className={sourceTab === "file" ? "active" : ""} onClick={() => { setSourceTab("file"); setSourceError(""); }}><Upload size={15}/>Tải tệp lên</button><button className={sourceTab === "text" ? "active" : ""} onClick={() => { setSourceTab("text"); setSourceError(""); }}><FileText size={15}/>Dán văn bản</button></div>{sourceTab === "file" ? <><button className="upload-zone" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); uploadFile(e.dataTransfer.files[0]); }} onClick={() => fileRef.current?.click()}><span><Upload size={25}/></span><strong>Chọn tệp hoặc kéo thả vào đây</strong><p>TXT, Markdown, CSV · Tối đa 100.000 ký tự</p></button><input ref={fileRef} type="file" accept=".txt,.md,.csv" hidden onChange={e => uploadFile(e.target.files?.[0])}/><p className="field-help">Data Pack đã có sẵn 20 tài liệu chuẩn hóa. Với PDF khác, bạn có thể dán phần văn bản cần sử dụng.</p></> : <form onSubmit={e => { e.preventDefault(); addTextSource(sourceTitle, sourceText); }}><label className="field-label" htmlFor="source-title">Tên nguồn</label><input className="full-input" id="source-title" placeholder="Ví dụ: Hướng dẫn thanh toán nội bộ" value={sourceTitle} maxLength={250} onChange={e => setSourceTitle(e.target.value)} required/><label className="field-label model-label" htmlFor="source-text">Nội dung</label><textarea className="source-text-input" id="source-text" placeholder="Dán nội dung tài liệu tại đây…" value={sourceText} onChange={e => setSourceText(e.target.value)} maxLength={100000} required/><div className="modal-actions"><button className="primary-button" type="submit"><Plus size={15}/>Thêm nguồn</button></div></form>}{sourceError && <p className="form-error" role="alert">{sourceError}</p>}</div></Modal>}

    {viewer && <Modal title="Nguồn tài liệu" wide onClose={() => setViewer(null)}><div className="source-viewer"><div className="viewer-document-header"><span className={`document-icon ${viewer.source.type === "internal" ? "peach" : "green"}`}><FileText size={23}/></span><div><div className="viewer-kicker">{viewer.source.type === "upload" ? "TÀI LIỆU CỦA BẠN" : `${viewer.source.id} · DATA PACK POLICYASSIST`}</div><h3>{viewer.source.title}</h3></div></div><div className="viewer-metadata"><span>{statusLabel(viewer.source)}</span>{viewer.source.effectiveDate && <span>Hiệu lực: {dateLabel(viewer.source.effectiveDate)}</span>}<span>{viewer.source.chunks.length} đoạn</span></div>{viewer.source.type === "internal" && <div className="sim-notice">Tài liệu nội bộ giả lập của Nova Việt, chỉ phục vụ Case Study.</div>}<p className="viewer-summary">{viewer.source.summary}</p><div className="viewer-divider"><span>{viewer.source.type === "upload" ? "NỘI DUNG NGUỒN" : "NỘI DUNG CHUẨN HÓA TỪ DATA PACK"}</span>{viewer.source.url && <a href={viewer.source.url} target="_blank" rel="noreferrer">Mở nguồn gốc<ExternalLink size={12}/></a>}</div>{viewer.source.chunks.map(c => <section id={`source-${c.id}`} key={c.id} className={`source-chunk ${viewer.chunk === c.id ? "highlighted" : ""}`}><div className="chunk-heading"><span>{c.location}</span><span>{c.id === viewer.source.id ? "Văn bản" : c.id}</span></div><h4>{c.heading}</h4><p>{c.text}</p>{c.effectiveFrom && <div className="chunk-date">Từ {dateLabel(c.effectiveFrom)}{c.effectiveTo && ` đến ${dateLabel(c.effectiveTo)}`}</div>}</section>)}{viewer.source.type === "upload" && <button className="danger-button" onClick={() => { const id = viewer.source.id; setCustomSources(prev => prev.filter(s => s.id !== id)); setSelected(prev => prev.filter(s => s !== id)); setViewer(null); setToast("Đã xóa nguồn khỏi sổ tay."); }}><Trash2 size={14}/>Xóa nguồn này</button>}</div></Modal>}

    {noteEditor && <Modal title={noteEditor.title ? "Chỉnh sửa ghi chú" : "Một ý mới cho sổ tay"} onClose={() => setNoteEditor(null)}><form className="modal-body" onSubmit={e => { e.preventDefault(); const note = { ...noteEditor, title: noteTitle.trim(), content: noteContent.trim() }; if (!note.title || !note.content) return; setNotes(prev => prev.some(n => n.id === note.id) ? prev.map(n => n.id === note.id ? note : n) : [note,...prev]); setNoteEditor(null); setToast("Đã lưu ghi chú."); }}><label className="field-label" htmlFor="note-title">Tiêu đề</label><input className="full-input" id="note-title" placeholder="Đặt tên cho ý tưởng của bạn" value={noteTitle} maxLength={150} onChange={e => setNoteTitle(e.target.value)} required/><label className="field-label model-label" htmlFor="note-content">Nội dung</label><textarea className="note-content-input" id="note-content" placeholder="Viết điều bạn muốn giữ lại…" value={noteContent} maxLength={30000} onChange={e => setNoteContent(e.target.value)} required/><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setNoteEditor(null)}>Hủy</button><button className="primary-button" type="submit"><Check size={15}/>Lưu ghi chú</button></div></form></Modal>}

    {notePreview && <Modal title="Ghi chú của bạn" wide onClose={() => setNotePreview(null)}><div className="modal-body note-preview"><div className="note-preview-heading"><span className="note-icon"><StickyNote size={23}/></span><h3>{notePreview.title}</h3></div><p className="note-date">Đã tạo {new Date(notePreview.createdAt).toLocaleString("vi-VN")}</p><RichText text={notePreview.content} sources={[...allSources,...(notePreview.sources || [])]} onCitation={(id,sources) => { setNotePreview(null); openCitation(id,sources); }}/><div className="modal-actions"><button className="danger-button" onClick={() => { setNotes(prev => prev.filter(n => n.id !== notePreview.id)); setNotePreview(null); setToast("Đã xóa ghi chú."); }}><Trash2 size={14}/>Xóa</button><button className="secondary-button" onClick={() => { download("PolicyAssist-ghi-chu.md",`# ${notePreview.title}\n\n${notePreview.content}`); }}><ArrowDownToLine size={14}/>Tải xuống</button><button className="primary-button" onClick={() => editNote(notePreview)}><Pencil size={14}/>Chỉnh sửa</button></div></div></Modal>}

    {modal === "clear" && <Modal title="Bắt đầu cuộc hội thoại mới?" onClose={() => setModal(null)}><div className="modal-body"><p className="modal-description">Lịch sử hội thoại hiện tại sẽ được xóa. Các nguồn và ghi chú đã lưu vẫn ở trong sổ tay.</p><div className="modal-actions"><button className="secondary-button" onClick={() => setModal(null)}>Giữ hội thoại</button><button className="primary-button" onClick={() => { setMessages([]); setModal(null); }}>Bắt đầu mới<ArrowRight size={14}/></button></div></div></Modal>}
    {modal === "about" && <Modal title="Về PolicyAssist AI" onClose={() => setModal(null)}><div className="modal-body about-content"><span className="about-emblem"><BookOpen size={29}/></span><h3>Rõ nguồn. Rõ điều bạn cần.</h3><p>Bản demo cho Bảng A — Festival Chuyển đổi số 2026, lấy cảm hứng từ không gian nghiên cứu của NotebookLM.</p><div className="about-stats"><div><strong>20</strong><span>Tài liệu</span></div><div><strong>374</strong><span>Đoạn chuẩn hóa</span></div><div><strong>17.10.26</strong><span>Corpus snapshot</span></div></div><h4>Cách bản demo hoạt động</h4><p>Toàn bộ nội dung các nguồn bạn chọn được gửi trực tiếp đến Gemini Flash cùng câu hỏi. Chưa triển khai RAG, tìm kiếm ngữ nghĩa hoặc kiểm chứng citation tự động. Ngày tham chiếu được cung cấp cho mô hình để hỗ trợ đọc hiệu lực văn bản.</p><p>Nhấp vào citation để đối chiếu với đoạn nguồn. Tài liệu SIM01–SIM08 là dữ liệu nội bộ giả lập của Nova Việt.</p><p>Hội thoại, nguồn bổ sung và ghi chú được lưu tại trình duyệt này. API key chỉ tồn tại trong bộ nhớ của phiên đang mở. Nguồn đã chọn và nội dung tệp đính kèm sẽ được gửi đến Google khi bạn gửi câu hỏi.</p><a className="api-key-link" href="https://ai.google.dev/gemini-api/docs/pricing" target="_blank" rel="noreferrer">Hạn mức và free tier của Gemini<ExternalLink size={12}/></a></div></Modal>}
  </div>;
}
