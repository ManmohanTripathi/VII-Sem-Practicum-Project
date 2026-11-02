"use client";

import { createContext, useCallback, useContext, useState } from "react";
import Link from "next/link";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";

type Tone = "good" | "bad" | "info";
type Toast = { id: number; message: string; tone: Tone; detail?: string; href?: string };
type Show = (message: string, tone?: Tone, opts?: { detail?: string; href?: string; durationMs?: number }) => void;

const ToastContext = createContext<Show>(() => {});

const ICON = { good: CircleCheck, bad: CircleAlert, info: Info };
const ICON_COLOR = { good: "text-emerald-300", bad: "text-red-300", info: "text-sky-300" };

// Small confirmations after saves ("Reminder added") and real-time heads-ups ("Papa sent a voice message").
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback<Show>((message, tone = "good", opts = {}) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, message, tone, detail: opts.detail, href: opts.href }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), opts.durationMs ?? 3500);
  }, []);

  const dismiss = (id: number) => setToasts((all) => all.filter((x) => x.id !== id));

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6 md:right-6 md:left-auto md:items-end" aria-live="polite">
        {toasts.map((t) => {
          const Icon = ICON[t.tone];
          const body = (
            <>
              <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${ICON_COLOR[t.tone]}`} />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{t.message}</span>
                {t.detail && <span className="mt-0.5 line-clamp-2 block text-white/70">{t.detail}</span>}
              </span>
            </>
          );
          return (
            <div
              key={t.id}
              className="pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-2xl bg-ink px-4 py-3 text-sm text-white shadow-xl"
              style={{ animation: "toast-in 160ms ease-out" }}
            >
              {t.href ? (
                <Link href={t.href} onClick={() => dismiss(t.id)} className="flex min-w-0 flex-1 items-start gap-2.5">
                  {body}
                </Link>
              ) : (
                body
              )}
              <button onClick={() => dismiss(t.id)} className="text-white/60 hover:text-white" aria-label="Dismiss">
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
