export interface SourceChunk {
  id: string;
  heading: string;
  location: string;
  text: string;
  label: string;
  effectiveFrom: string;
  effectiveTo: string;
}

export interface Source {
  id: string;
  title: string;
  type: string;
  topic: string;
  summary: string;
  effectiveDate: string;
  expiryDate: string;
  status: string;
  url: string;
  /** Nhóm nguồn theo thứ tự ưu tiên của Data Pack: law > internal > faq. */
  tier?: string;
  chunks: SourceChunk[];
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Văn bản hiển thị cho tin nhắn dùng lệnh, khi nội dung gửi đi là lời nhắc đã mở rộng. */
  display?: string;
  command?: string;
  attachmentName?: string;
  attachmentSourceId?: string;
  latency?: number;
  failed?: boolean;
  sources?: Source[];
}

export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  sources?: Source[];
}
