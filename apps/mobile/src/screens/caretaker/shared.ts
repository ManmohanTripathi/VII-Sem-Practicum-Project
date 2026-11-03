import type { IconName } from "../../ui/Icon";
import type { Tone } from "../../ui/Pill";
import { colors } from "../../ui/theme";

// Small helpers shared by the caretaker screens.

export function ago(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export function time12(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

export function clock(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

export const DOT: Record<string, { color: string; icon: IconName | null }> = {
  DONE_ON_TIME: { color: colors.good, icon: "checkmark" },
  DONE_LATE: { color: "#D97706", icon: "checkmark" },
  MISSED: { color: colors.bad, icon: "close" },
  SKIPPED: { color: colors.muted, icon: "remove" },
  PENDING: { color: colors.line, icon: null },
};

// Conversation mood (from the summaries).
export const MOOD: Record<string, { label: string; tone: Tone }> = {
  good: { label: "Seemed good", tone: "good" },
  okay: { label: "Seemed okay", tone: "neutral" },
  low: { label: "Seemed low", tone: "warn" },
  unwell: { label: "Unwell", tone: "bad" },
};
