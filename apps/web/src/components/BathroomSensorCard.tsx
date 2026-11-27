"use client";

import { useEffect, useState } from "react";
import { Card, ICONS } from "@/components/Card";

type Mmwave = {
  sensorId: string;
  room: string;
  state: "empty" | "occupied" | "on_floor" | "checking";
  radar: "ok" | "missing";
  distanceCm: number | null;
  at: string;
};

const STATE: Record<Mmwave["state"], { label: string; tone: string }> = {
  empty: { label: "Empty", tone: "bg-stone-100 text-stone-600" },
  occupied: { label: "In use", tone: "bg-emerald-50 text-emerald-700" },
  on_floor: { label: "Someone at floor level", tone: "bg-red-600 text-white" },
  checking: { label: "Asking “Are you OK?”", tone: "bg-amber-100 text-amber-800" },
};

// The optional mmWave bathroom sensor (firmware/esp32-mmwave). Renders nothing until a sensor has
// reported, so homes without one see no change.
export function BathroomSensorCard({ elderId }: { elderId: string }) {
  const [data, setData] = useState<{ mmwave: Mmwave | null; fresh: boolean } | null>(null);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/elders/${elderId}/mmwave`, { cache: "no-store" });
        if (!res.ok || stop) return;
        const mmwave: Mmwave | null = (await res.json()).mmwave;
        setData({ mmwave, fresh: !!mmwave && Date.now() - new Date(mmwave.at).getTime() < 3 * 60_000 });
      } catch {}
    };
    load();
    const timer = setInterval(load, 10_000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [elderId]);

  const s = data?.mmwave;
  if (!s) return null;
  const room = s.room[0].toUpperCase() + s.room.slice(1);
  const state = STATE[s.state];

  return (
    <Card
      title={`${room} sensor`}
      icon={ICONS.home}
      action={
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
            data.fresh ? "bg-emerald-50 text-emerald-600" : "bg-stone-100 text-stone-500"
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${data.fresh ? "bg-emerald-500" : "bg-stone-400"}`} />
          {data.fresh ? "Online" : "Offline"}
        </span>
      }
    >
      {s.radar === "missing" ? (
        <p className="text-sm text-stone-600">The sensor board is online, but the radar is not connected.</p>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <span className={`rounded-full px-3 py-1 text-sm font-medium ${state.tone}`}>{state.label}</span>
          <span className="text-xs text-stone-500">
            mmWave radar · no camera, no microphone
            {s.distanceCm != null && s.state !== "empty" ? ` · ${(s.distanceCm / 100).toFixed(1)} m from ceiling` : ""}
          </span>
        </div>
      )}
    </Card>
  );
}
