"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Check, CheckCheck, Mic, Send, Square, Trash2, Volume2 } from "lucide-react";
import { Card } from "@/components/Card";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { useWavRecorder } from "@/components/useWavRecorder";
import { timeAgo } from "@/lib/format";

type Message = {
  id: string;
  direction: "TO_ELDER" | "FROM_ELDER";
  senderName: string;
  kind: "voice" | "text";
  text: string | null;
  audioUrl: string | null;
  playedAt: string | null;
  createdAt: string;
};

const QUICK = {
  en: ["Did you take your medicine?", "Have you eaten?", "Thinking of you. I'll call you this evening.", "Please drink some water and rest."],
  hi: ["क्या आपने दवा ले ली?", "क्या आपने खाना खा लिया?", "आपकी याद आ रही है, शाम को फ़ोन करूँगा/करूँगी।", "थोड़ा पानी पीकर आराम कर लीजिए।"],
};

// Family messages with the parent: voice notes and typed messages are played aloud on their phone;
// their spoken replies come back here with a transcript.
export function MessagesPanel({ elderId, elderName, language, messages }: { elderId: string; elderName: string; language: string; messages: Message[] }) {
  const router = useRouter();
  const toast = useToast();
  const rec = useWavRecorder();
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<{ blob: Blob; url: string } | null>(null);
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const first = elderName.split(" ")[0];

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

  async function sendText(body: string) {
    if (!body.trim()) return;
    setSending(true);
    const res = await fetch(`/api/elders/${elderId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: body.trim() }),
    });
    setSending(false);
    if (!res.ok) return toast((await res.json().catch(() => ({}))).error ?? "Couldn't send", "bad");
    setText("");
    toast(`Sent — it will be read aloud to ${first}`);
    router.refresh();
  }

  async function toggleRecording() {
    if (rec.recording) {
      const blob = await rec.stop();
      if (blob.size < 2000) return toast("That was too short — hold on a little longer", "bad");
      setDraft({ blob, url: URL.createObjectURL(blob) });
    } else {
      try {
        await rec.start();
      } catch {
        toast("Microphone not available — allow it in the browser", "bad");
      }
    }
  }

  async function sendVoice() {
    if (!draft) return;
    setSending(true);
    const form = new FormData();
    form.append("audio", draft.blob, "voice-note.wav");
    const res = await fetch(`/api/elders/${elderId}/messages`, { method: "POST", body: form });
    setSending(false);
    if (!res.ok) return toast((await res.json().catch(() => ({}))).error ?? "Couldn't send", "bad");
    URL.revokeObjectURL(draft.url);
    setDraft(null);
    toast(`Voice note sent — it will play on ${first}'s phone`);
    router.refresh();
  }

  return (
    <Card title={`Messages with ${first}`} description={`Voice notes and messages play out loud on ${first}'s phone. ${first} can reply by voice.`}>
      <div className="max-h-[32rem] space-y-3 overflow-y-auto rounded-xl bg-surface-2/60 p-3 sm:p-4">
        {messages.length === 0 && <p className="py-8 text-center text-sm text-muted">No messages yet. Send {first} a voice note — it will play automatically.</p>}
        {messages.map((m) => {
          const mine = m.direction === "TO_ELDER";
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 ${mine ? "rounded-br-md bg-accent text-white" : "rounded-bl-md border border-line bg-surface"}`}>
                <div className={`mb-1 text-xs font-medium ${mine ? "text-white/80" : "text-muted"}`} suppressHydrationWarning>
                  {mine ? m.senderName.split(" ")[0] : first} · {timeAgo(m.createdAt)}
                </div>
                {m.text && <p className="text-[15px] leading-snug">{m.text}</p>}
                {m.audioUrl && (m.kind === "voice" || !mine) && (
                  <audio
                    controls
                    preload="none"
                    src={m.audioUrl}
                    className="mt-1.5 h-9 w-64 max-w-full"
                    onPlay={() => {
                      if (!mine && !m.playedAt) fetch(`/api/messages/${m.id}/played`, { method: "POST" }).then(() => router.refresh());
                    }}
                  />
                )}
                {mine && (
                  <div className="mt-1 flex items-center justify-end gap-1 text-[11px] text-white/80" suppressHydrationWarning>
                    {m.playedAt ? (
                      <>
                        <CheckCheck className="h-3.5 w-3.5" /> {m.kind === "text" ? "Read aloud" : "Played"} {timeAgo(m.playedAt)}
                      </>
                    ) : (
                      <>
                        <Check className="h-3.5 w-3.5" /> Delivered
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {QUICK[language === "hi" ? "hi" : "en"].map((q) => (
          <button key={q} onClick={() => sendText(q)} disabled={sending} className="rounded-full border border-line px-3 py-1.5 text-sm hover:border-accent hover:bg-accent-soft hover:text-accent disabled:opacity-50">
            {q}
          </button>
        ))}
      </div>

      {draft ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-line p-3">
          <Volume2 className="h-5 w-5 text-accent" />
          <audio controls src={draft.url} className="h-9 min-w-0 flex-1" />
          <Button variant="ghost" icon={Trash2} onClick={() => setDraft(null)}>
            Discard
          </Button>
          <Button icon={Send} loading={sending} onClick={sendVoice}>
            Send voice note
          </Button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendText(text);
          }}
          className="mt-4 flex items-center gap-2"
        >
          {rec.supported && (
            <Button
              type="button"
              variant={rec.recording ? "danger" : "secondary"}
              icon={rec.recording ? Square : Mic}
              onClick={toggleRecording}
              aria-label={rec.recording ? "Stop recording" : "Record a voice note"}
            >
              {rec.recording ? `${Math.floor(rec.seconds / 60)}:${String(rec.seconds % 60).padStart(2, "0")}` : "Record"}
            </Button>
          )}
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={600}
            placeholder={rec.recording ? "Recording… press stop when done" : `Type a message — it's read aloud to ${first}`}
            disabled={rec.recording}
            className={`${inputClass} mt-0`}
          />
          <Button type="submit" icon={Send} loading={sending && !draft} disabled={!text.trim() || rec.recording} aria-label="Send" />
        </form>
      )}
      {!rec.supported && <p className="mt-2 text-xs text-muted">Voice recording works when the dashboard is opened on this computer (localhost) or over https.</p>}
    </Card>
  );
}
