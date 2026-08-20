import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LiveTranslate — Real-time Voice Translation",
  description: "1-to-1 real-time voice translation powered by Gemini Live",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-950 antialiased">{children}</body>
    </html>
  );
}
