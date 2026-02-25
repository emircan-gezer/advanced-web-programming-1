"use client";

import { useState, useRef, useEffect } from "react";

type Msg = {
  role: "user" | "assistant";
  content: string;
  confidence?: number;
};

export default function CareerAssistantPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const send = async () => {
    if (!input.trim()) return;

    const userMsg: Msg = { role: "user", content: input };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: input }),
      });

      const data = await res.json();

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.reply || "Sorry, something went wrong.",
          confidence: data.confidence,
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Network error. Please try again." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-[var(--mra-neutral-bg)] text-[var(--mra-text-primary)]">
      {/* Header */}
      <header className="border-b border-[var(--mra-border)] bg-[var(--mra-section-bg)] px-5 py-4 sm:px-8">
        <h1 className="text-2xl font-semibold tracking-tight">Emircan Gezer Career Assistant</h1>
      </header>

      {/* Chat Area */}
      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-6 sm:px-8">
         
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${
                msg.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                  msg.role === "user"
                    ? "bg-[var(--mra-accent-primary)] text-white"
                    : "bg-[var(--mra-card-bg)] border border-[var(--mra-border)]"
                }`}
              >
                <div className="whitespace-pre-wrap text-[15px] leading-relaxed">
                  {msg.content}
                </div>

                {msg.confidence !== undefined && msg.role === "assistant" && (
                  <div className="mt-2 text-xs opacity-50">
                    Confidence: {msg.confidence.toFixed(2)}
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="rounded-2xl bg-[var(--mra-card-bg)] px-4 py-3">
                <div className="flex items-center gap-2 text-[var(--mra-text-secondary)]">
                  <div className="h-2 w-2 animate-pulse rounded-full bg-current"></div>
                  <div className="h-2 w-2 animate-pulse rounded-full bg-current animation-delay-150"></div>
                  <div className="h-2 w-2 animate-pulse rounded-full bg-current animation-delay-300"></div>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="border-t border-[var(--mra-border)] bg-[var(--mra-section-bg)] p-4 sm:p-6">
          <div className="mx-auto max-w-4xl">
            <div className="relative flex items-center">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder="Ask anything about your career..."
                className="w-full rounded-2xl border border-[var(--mra-border-light)] bg-[var(--mra-card-bg)] px-5 py-4 text-base text-[var(--mra-text-primary)] placeholder-[var(--mra-text-tertiary)] outline-none focus:border-[var(--mra-accent-primary)] focus:ring-1 focus:ring-[var(--mra-accent-primary)] disabled:opacity-60"
                disabled={loading}
              />

              <button
                onClick={send}
                disabled={loading || !input.trim()}
                className="absolute right-3 rounded-xl bg-[var(--mra-accent-primary)] px-4 py-2 font-medium text-white transition-all hover:bg-[var(--mra-accent-primary-hover)] hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100"
              >
                Send
              </button>
            </div>

          </div>
        </div>
      </main>
    </div>
  );
}