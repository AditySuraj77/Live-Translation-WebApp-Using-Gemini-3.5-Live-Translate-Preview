"use client";

import { useState, useRef, useEffect } from "react";
import type { ChatMessagePayload } from "@/lib/livekit-transport";

interface ChatSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  messages: ChatMessagePayload[];
  onSendMessage: (text?: string, file?: ChatMessagePayload["file"]) => void;
  currentUserName: string;
}

// Compress image on client-side before P2P transfer for lightning-fast WebRTC delivery
async function compressImage(file: File): Promise<{ name: string; size: number; type: string; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;
        const maxDim = 1200;

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve({ name: file.name, size: file.size, type: file.type, dataUrl: e.target?.result as string });
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/webp", 0.82);
        resolve({
          name: file.name.replace(/\.[^/.]+$/, ".webp"),
          size: Math.round((dataUrl.length * 3) / 4),
          type: "image/webp",
          dataUrl,
        });
      };
      img.onerror = () => reject(new Error("Failed to load image for compression"));
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function readFileAsDataUrl(file: File): Promise<{ name: string; size: number; type: string; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        name: file.name,
        size: file.size,
        type: file.type || "application/octet-stream",
        dataUrl: reader.result as string,
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function ChatSidebar({
  isOpen,
  onClose,
  messages,
  onSendMessage,
  currentUserName,
}: ChatSidebarProps) {
  const [inputText, setInputText] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [selectedImageModal, setSelectedImageModal] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Auto-scroll to latest message
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen]);

  function handleSendText() {
    const trimmed = inputText.trim();
    if (!trimmed) return;
    onSendMessage(trimmed);
    setInputText("");
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // 10MB safety limit for DataChannel
    if (file.size > 10 * 1024 * 1024) {
      alert("File is too large! Please choose a file smaller than 10MB.");
      return;
    }

    try {
      setIsUploading(true);
      if (file.type.startsWith("image/")) {
        const compressed = await compressImage(file);
        onSendMessage(undefined, compressed);
      } else {
        const fileData = await readFileAsDataUrl(file);
        onSendMessage(undefined, fileData);
      }
    } catch (err) {
      console.error("[Chat] Failed to attach file:", err);
      alert("Failed to process file for sending.");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  if (!isOpen) return null;

  return (
    <>
      <aside className="fixed inset-y-0 right-0 z-40 w-full sm:w-88 md:w-96 bg-gray-900/95 border-l border-gray-800 shadow-2xl backdrop-blur-xl flex flex-col transition-transform duration-300">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-gray-800/80 bg-gray-950/60">
          <div className="flex items-center gap-2">
            <span className="text-lg">💬</span>
            <h2 className="font-semibold text-sm text-gray-200">Room Chat & Files</h2>
            <span className="text-[10px] font-bold bg-indigo-500/20 text-indigo-400 px-1.5 py-0.5 rounded border border-indigo-500/30">
              P2P
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-gray-800 transition cursor-pointer text-lg leading-none"
            title="Close chat"
          >
            ✕
          </button>
        </div>

        {/* Message history */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3.5 text-xs">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-gray-500 py-12">
              <span className="text-3xl mb-2">💬</span>
              <p className="font-medium text-gray-400">No messages yet</p>
              <p className="text-[11px] text-gray-500 max-w-xs mt-1">
                Send a private text, share pictures, or send files directly via P2P WebRTC.
              </p>
            </div>
          ) : (
            messages.map((m) => {
              const isMe = m.sender === currentUserName;
              return (
                <div
                  key={m.id}
                  className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}
                >
                  <div className="flex items-center gap-1.5 mb-1 px-1 text-[11px]">
                    <span className="text-sm">{m.senderAvatar || "👤"}</span>
                    <span className={`font-semibold ${isMe ? "text-indigo-300" : "text-emerald-300"}`}>
                      {isMe ? "You" : m.sender}
                    </span>
                    <span className="text-gray-500 text-[10px]">{formatTime(m.timestamp)}</span>
                  </div>

                  <div
                    className={`max-w-[85%] rounded-2xl p-3 shadow-md ${
                      isMe
                        ? "bg-indigo-600 text-white rounded-tr-none"
                        : "bg-gray-800 text-gray-100 border border-gray-700/60 rounded-tl-none"
                    }`}
                  >
                    {/* Text content */}
                    {m.text && <p className="leading-relaxed whitespace-pre-wrap break-words">{m.text}</p>}

                    {/* Image attachment */}
                    {m.file && m.file.type.startsWith("image/") && (
                      <div className="mt-1.5 flex flex-col gap-1">
                        <img
                          src={m.file.dataUrl}
                          alt={m.file.name}
                          onClick={() => setSelectedImageModal(m.file!.dataUrl)}
                          className="rounded-lg max-h-48 object-cover cursor-pointer hover:opacity-90 transition border border-black/20"
                        />
                        <div className="flex items-center justify-between text-[10px] text-gray-300/80 px-0.5">
                          <span className="truncate max-w-[130px]">{m.file.name}</span>
                          <span>{formatBytes(m.file.size)}</span>
                        </div>
                      </div>
                    )}

                    {/* Non-image document attachment */}
                    {m.file && !m.file.type.startsWith("image/") && (
                      <div className="mt-1.5 bg-black/20 p-2 rounded-lg border border-white/10 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-base">📄</span>
                          <div className="min-w-0">
                            <p className="font-semibold text-[11px] truncate">{m.file.name}</p>
                            <p className="text-[10px] text-gray-300">{formatBytes(m.file.size)}</p>
                          </div>
                        </div>
                        <a
                          href={m.file.dataUrl}
                          download={m.file.name}
                          className="bg-white/20 hover:bg-white/30 text-white px-2 py-1 rounded text-[11px] font-bold transition whitespace-nowrap"
                        >
                          ⬇ Save
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Footer Input Area */}
        <div className="p-3 border-t border-gray-800 bg-gray-950/80">
          {isUploading && (
            <div className="text-xs text-indigo-400 mb-2 flex items-center gap-2 animate-pulse px-1">
              <span>⏳</span> Processing and attaching media...
            </div>
          )}

          <div className="flex items-center gap-2">
            {/* Attachment Button */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="p-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition cursor-pointer border border-gray-700/80 text-sm"
              title="Attach image or file"
            >
              📎
            </button>
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileChange}
              className="hidden"
              accept="image/*,.pdf,.doc,.docx,.txt,.zip,.json,.mp3,.wav"
            />

            {/* Text input */}
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSendText();
                }
              }}
              placeholder="Type message..."
              className="flex-1 bg-gray-900 border border-gray-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition"
            />

            {/* Send button */}
            <button
              onClick={handleSendText}
              disabled={!inputText.trim()}
              className={`p-2.5 rounded-xl font-bold transition text-xs shadow cursor-pointer ${
                inputText.trim()
                  ? "bg-indigo-600 hover:bg-indigo-500 text-white"
                  : "bg-gray-800 text-gray-500 cursor-not-allowed"
              }`}
              title="Send message"
            >
              ➤
            </button>
          </div>
        </div>
      </aside>

      {/* Lightbox Image Preview Modal */}
      {selectedImageModal && (
        <div
          onClick={() => setSelectedImageModal(null)}
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 cursor-pointer"
        >
          <div className="relative max-w-4xl max-h-[90vh]">
            <img
              src={selectedImageModal}
              alt="Preview"
              className="rounded-xl max-h-[85vh] max-w-full object-contain shadow-2xl"
            />
            <button
              onClick={() => setSelectedImageModal(null)}
              className="absolute top-2 right-2 bg-black/60 hover:bg-black/90 text-white rounded-full p-2 text-sm leading-none"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </>
  );
}
