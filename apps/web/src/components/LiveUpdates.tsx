"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/ui/toast";

type Payload = Record<string, unknown> & {
  severity?: string;
  title?: string;
  message?: string;
  direction?: string;
  text?: string | null;
  senderName?: string;
  newConcerns?: string[];
  elderName?: string;
};

type Heads = { title: string; detail?: string; urgent: boolean };

// Turns server events into real-time heads-ups for the family. Returns null for routine updates.
function headsUp(type: string, p: Payload, elderName: string): Heads | null {
  const who = elderName.split(" ")[0] || "Your parent";
  switch (type) {
    case "alert.created":
      if (p.severity === "info") return null;
      return { title: `${who}: ${p.title}`, detail: p.message, urgent: p.severity === "critical" };
    case "message.created":
      if (p.direction !== "FROM_ELDER") return null;
      return { title: `${who} sent you a voice message`, detail: p.text ? `“${p.text}”` : "Tap to listen", urgent: false };
    case "message.played":
      return { title: `${who} listened to your message`, detail: p.text ? `“${p.text}”` : undefined, urgent: false };
    case "conversation.summarized":
      if (!p.newConcerns?.length) return null;
      return { title: `${who} mentioned: ${p.newConcerns.join(", ").toLowerCase()}`, detail: "From their chat with Saathi", urgent: false };
    default:
      return null;
  }
}

// Soft two-note chime (no audio file needed). Browsers only allow it after the page has been clicked once.
function chime(urgent: boolean) {
  try {
    const ctx = new AudioContext();
    const notes = urgent ? [880, 660, 880] : [660, 880];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const start = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.15, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
      osc.start(start);
      osc.stop(start + 0.17);
    });
    setTimeout(() => ctx.close(), 1000);
  } catch {}
}

// Subscribes to /api/events (Server-Sent Events): refreshes the page when anything changes, and
// shows a toast + chime + browser notification for things a caregiver should know right away.
export function LiveUpdates({ elderId, elderNames = {}, showIndicator = false }: { elderId?: string; elderNames?: Record<string, string>; showIndicator?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [connected, setConnected] = useState(false);
  const names = useRef(elderNames);
  useEffect(() => {
    names.current = elderNames;
  }, [elderNames]);

  useEffect(() => {
    const es = new EventSource(`/api/events${elderId ? `?elderId=${elderId}` : ""}`);
    let timer: ReturnType<typeof setTimeout> | undefined;

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.addEventListener("care", (msg) => {
      try {
        const event = JSON.parse((msg as MessageEvent).data) as { elderId: string; type: string; payload?: Payload };
        const p = event.payload ?? {};
        const name = (p.elderName as string | undefined) ?? names.current[event.elderId] ?? "";
        const h = headsUp(event.type, p, name);
        if (h) {
          const href = event.type.startsWith("message") ? `/elders/${event.elderId}/messages` : `/elders/${event.elderId}`;
          toast(h.title, h.urgent ? "bad" : "info", { detail: h.detail, href, durationMs: h.urgent ? 15000 : 8000 });
          chime(h.urgent);
          if ("Notification" in window && Notification.permission === "granted" && document.visibilityState !== "visible") {
            const n = new Notification(h.title, { body: h.detail, tag: `${event.type}:${event.elderId}` });
            n.onclick = () => {
              window.focus();
              router.push(href);
            };
          }
        }
      } catch {}
      // Telemetry can arrive every few seconds; batch refreshes.
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 800);
    });

    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }

    return () => {
      clearTimeout(timer);
      es.close();
    };
  }, [elderId, router, toast]);

  if (!showIndicator) return null;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${connected ? "bg-good-soft text-good" : "bg-surface-2 text-muted"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-good" : "bg-stone-400"}`} />
      {connected ? "Live" : "Reconnecting…"}
    </span>
  );
}
