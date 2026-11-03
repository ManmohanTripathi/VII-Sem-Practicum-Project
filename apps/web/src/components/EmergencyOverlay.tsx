"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Siren, VolumeX } from "lucide-react";

export type Emergency = { alertId: string; elderId: string; elderName: string; message: string; count: number; handledBy?: string | null };

// Full-screen alarm for the home hardware's emergency alerts (MQTT): a looping siren until someone
// says "I'm on it" or silences it. Browsers only play sound after the page has been clicked once.
export function EmergencyOverlay({ emergency, onClose }: { emergency: Emergency; onClose: () => void }) {
  const router = useRouter();
  const audio = useRef<HTMLAudioElement>(null);
  const [silenced, setSilenced] = useState(false);
  const [busy, setBusy] = useState(false);
  const first = emergency.elderName.split(" ")[0] || "Your parent";

  const quiet = silenced || !!emergency.handledBy;

  useEffect(() => {
    const a = audio.current;
    if (!a || quiet) return;
    a.volume = 1;
    a.currentTime = 0;
    a.play().catch(() => {});
    return () => a.pause();
  }, [quiet, emergency.alertId]);

  async function acknowledge() {
    setBusy(true);
    await fetch(`/api/alerts/${emergency.alertId}`, { method: "PATCH" }).catch(() => {});
    setBusy(false);
    onClose();
    router.push(`/elders/${emergency.elderId}`);
    router.refresh();
  }

  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="emergency-title" className="fixed inset-0 z-[100] flex items-center justify-center bg-red-700/95 p-6 text-white">
      <audio ref={audio} src="/sounds/emergency.wav" loop preload="auto" />
      <div className="w-full max-w-md text-center">
        <Siren className="mx-auto h-20 w-20 animate-pulse" />
        <h2 id="emergency-title" className="mt-4 text-3xl font-bold tracking-tight">
          EMERGENCY at {first}&apos;s home
        </h2>
        <p className="mt-3 text-lg text-white/90">{emergency.message}</p>
        {emergency.count > 1 && <p className="mt-2 text-sm font-semibold text-white/80">{emergency.count} alerts from the home device</p>}
        {emergency.handledBy && <p className="mt-4 inline-block rounded-xl bg-black/20 px-4 py-2 text-lg font-bold">✓ {emergency.handledBy} is on it</p>}
        <div className="mt-8 flex flex-col gap-3">
          <button onClick={emergency.handledBy ? onClose : acknowledge} disabled={busy} className="rounded-2xl bg-white px-6 py-4 text-lg font-bold text-red-700 shadow-lg hover:bg-red-50 disabled:opacity-70">
            {busy ? "…" : emergency.handledBy ? "OK" : "I'm on it"}
          </button>
          {!quiet && (
            <button onClick={() => setSilenced(true)} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/60 px-6 py-3 font-semibold hover:bg-white/10">
              <VolumeX className="h-5 w-5" /> Silence alarm
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
