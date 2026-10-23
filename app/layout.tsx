import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PolicyAssist AI — Không gian chính sách của bạn",
  description: "Đọc, hỏi đáp và ghi chú chính sách tài chính, kế toán, thuế trong một không gian nghiên cứu với Gemini Flash.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi">
      <body className="antialiased">{children}</body>
    </html>
  );
}
