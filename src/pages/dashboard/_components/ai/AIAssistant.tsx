import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAction } from "convex/react";
import { ConvexError } from "convex/values";
import { Sparkles, Send, Trash2 } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet.tsx";

type Msg = { role: "user" | "assistant"; content: string };

const STORAGE_KEY = "ai-assistant-chat";
const SUGGESTIONS = [
  "Find 5 winning pet products with good margins",
  "Which beauty ads have been running the longest?",
  "Write 3 TikTok hooks for a posture corrector",
  "What niche should a beginner start with?",
];

function loadChat(): Msg[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Msg[]) : [];
  } catch {
    return [];
  }
}

// Turns /dashboard/... paths into in-app links and http(s) URLs into external
// links; everything else stays plain text.
function linkify(text: string): ReactNode[] {
  const parts = text.split(/(https?:\/\/[^\s)]+|\/dashboard\/[\w\-/]*)/g);
  return parts.map((part, i) => {
    if (/^https?:\/\//.test(part)) {
      return (
        <a key={i} href={part} target="_blank" rel="noreferrer" className="underline text-primary break-all">
          {part}
        </a>
      );
    }
    if (part.startsWith("/dashboard/")) {
      return (
        <Link key={i} to={part.replace(/[.,]+$/, "")} className="underline text-primary">
          {part}
        </Link>
      );
    }
    return part;
  });
}

export default function AIAssistant() {
  const chat = useAction(api.assistant.chat);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>(loadChat);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<{ used: number; limit: number } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-40)));
    } catch {
      /* storage unavailable - chat just won't survive a reload */
    }
  }, [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy, open]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    const next: Msg[] = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    setError(null);
    setBusy(true);
    try {
      const r = await chat({ messages: next });
      setMessages([...next, { role: "assistant", content: r.reply }]);
      setUsage({ used: r.used, limit: r.limit });
    } catch (e) {
      const msg =
        e instanceof ConvexError && typeof (e.data as { message?: unknown })?.message === "string"
          ? (e.data as { message: string }).message
          : "Something went wrong. Please try again.";
      setError(msg);
      // Put the question back so it can be re-sent.
      setMessages(messages);
      setInput(content);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed right-4 bottom-20 md:bottom-6 z-40 flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-4 py-3 shadow-lg hover:opacity-90 transition-opacity cursor-pointer"
        aria-label="Open AI assistant"
      >
        <Sparkles className="w-4 h-4" />
        <span className="text-sm font-semibold">Ask AI</span>
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md flex flex-col gap-0 p-0">
          <SheetHeader className="border-b border-border p-4">
            <SheetTitle className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" /> AI assistant
            </SheetTitle>
            <SheetDescription>
              Ask about winning products, ads and niches, or get hooks and ad copy. Answers use the ads and products in the app.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto p-4 space-y-3 text-sm">
            {messages.length === 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Try asking:</p>
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    disabled={busy}
                    className="block w-full text-left rounded-lg border border-border px-3 py-2 hover:bg-muted transition-colors cursor-pointer"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={
                    m.role === "user"
                      ? "max-w-[85%] rounded-2xl rounded-br-sm bg-primary text-primary-foreground px-3 py-2 whitespace-pre-wrap"
                      : "max-w-[90%] rounded-2xl rounded-bl-sm bg-muted px-3 py-2 whitespace-pre-wrap break-words"
                  }
                >
                  {m.role === "assistant" ? linkify(m.content) : m.content}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Spinner className="w-3.5 h-3.5" /> Looking through the data…
              </div>
            )}
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div ref={bottomRef} />
          </div>

          <form
            className="border-t border-border p-3 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <div className="flex gap-2 items-end">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value.slice(0, 4000))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
                placeholder="Ask anything about products or ads…"
                rows={2}
                className="resize-none min-h-0"
                disabled={busy}
              />
              <Button type="submit" size="icon" disabled={busy || !input.trim()} aria-label="Send">
                <Send className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{usage ? `${usage.used} of ${usage.limit} messages used today` : "AI can make mistakes. Check important numbers."}</span>
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={() => { setMessages([]); setError(null); }}
                  disabled={busy}
                  className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" /> New chat
                </button>
              )}
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
