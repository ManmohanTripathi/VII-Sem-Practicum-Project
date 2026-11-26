import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { emitCareEvent } from "@/lib/events";
import { raiseAlert } from "@/lib/alerts";
import { targetElders } from "@/lib/device-alerts";

// Optional mmWave bathroom sensor: an ESP32 with an HLK-LD2410C radar on the ceiling, a door reed
// switch, a buzzer and an "I am OK" button (firmware/esp32-mmwave). It publishes JSON on
// MQTT_MMWAVE_TOPIC. The sensor itself decides when to alarm: it sounds its buzzer first and only
// publishes an alarm if nobody presses "I am OK", so every alarm here is an emergency.
//
// Until a sensor publishes, nothing here does anything: no card on the dashboard, no alerts, no
// offline checks. The state is in memory, like the camera AI's: a restarted server waits for the
// next heartbeat (every 30 s) to show the card again.

const OFFLINE_AFTER_MS = 3 * 60_000;

export const mmwaveSchema = z.object({
  type: z.enum(["status", "fall", "long_stay", "presence_lost", "ok"]),
  elderId: z.string().optional(),
  sensorId: z.string().max(60).optional(),
  room: z.string().max(40).optional(),
  state: z.enum(["empty", "occupied", "on_floor", "checking"]).optional(),
  radar: z.enum(["ok", "missing"]).optional(), // "missing": the ESP32 runs but no LD2410 frames arrive
  distanceCm: z.number().min(0).max(1000).optional(),
  moveEnergy: z.number().min(0).max(100).optional(),
  stillEnergy: z.number().min(0).max(100).optional(),
  minutes: z.number().min(0).max(24 * 60).optional(),
});

export type MmwaveState = {
  sensorId: string;
  room: string;
  state: "empty" | "occupied" | "on_floor" | "checking";
  radar: "ok" | "missing";
  distanceCm: number | null;
  at: string;
};

type Entry = MmwaveState & { lastMotionAt: number; offlineAlerted: boolean };

const g = globalThis as unknown as { ccMmwave?: Map<string, Entry> };
const sensors = (g.ccMmwave ??= new Map());

export function latestMmwave(elderId: string): MmwaveState | null {
  const e = sensors.get(elderId);
  if (!e) return null;
  return { sensorId: e.sensorId, room: e.room, state: e.state, radar: e.radar, distanceCm: e.distanceCm, at: e.at };
}

const ALARMS = {
  fall: (name: string, room: string) => ({
    title: `Possible fall in the ${room}`,
    message: `The ${room} sensor saw ${name} at floor level without moving, and nobody pressed "I am OK". Check on ${name} right now.`,
  }),
  long_stay: (name: string, room: string, minutes?: number) => ({
    title: `${name} has been in the ${room} too long`,
    message: `${name} has been in the ${room} for ${minutes ? `${Math.round(minutes)} minutes` : "a long time"} and nobody pressed "I am OK". Check on ${name} right now.`,
  }),
  presence_lost: (name: string, room: string) => ({
    title: `${room[0].toUpperCase()}${room.slice(1)} sensor lost ${name}`,
    message: `The ${room} sensor stopped detecting ${name}, but the door did not open, and nobody pressed "I am OK". Check on ${name} right now.`,
  }),
} as const;

export async function handleMmwaveMessage(raw: string) {
  const msg = mmwaveSchema.parse(JSON.parse(raw));
  const elders = await targetElders(msg.elderId);
  const room = msg.room || "bathroom";
  const now = Date.now();

  for (const elder of elders) {
    const name = elder.name.split(" ")[0];
    const prev = sensors.get(elder.id);
    const entry: Entry = {
      sensorId: msg.sensorId ?? prev?.sensorId ?? "mmwave",
      room,
      state: msg.state ?? prev?.state ?? "empty",
      radar: msg.radar ?? prev?.radar ?? "ok",
      distanceCm: msg.distanceCm ?? prev?.distanceCm ?? null,
      at: new Date(now).toISOString(),
      lastMotionAt: prev?.lastMotionAt ?? 0,
      offlineAlerted: false,
    };
    sensors.set(elder.id, entry);
    emitCareEvent({ elderId: elder.id, type: "mmwave.status", payload: latestMmwave(elder.id) });

    // Someone in the bathroom is activity too (at most one reading a minute).
    if (entry.state !== "empty" && now - entry.lastMotionAt > 60_000) {
      entry.lastMotionAt = now;
      await prisma.sensorReading.create({ data: { elderId: elder.id, kind: "motion", value: 1 } });
    }

    if (msg.type === "fall" || msg.type === "long_stay" || msg.type === "presence_lost") {
      const text = ALARMS[msg.type](name, room, msg.minutes);
      await raiseAlert({
        elderId: elder.id,
        kind: "BATHROOM_ALERT",
        severity: "critical",
        ...text,
        data: { source: "mmwave", type: msg.type, sensorId: entry.sensorId, distanceCm: entry.distanceCm },
        dedupeKey: `mmwave:${elder.id}:${msg.type}:${Math.floor(now / 120_000)}`,
      });
    }
  }
}

// Called by the scheduler: a sensor that reported before and then went quiet.
export async function checkMmwaveOffline(now = new Date()) {
  for (const [elderId, e] of sensors) {
    const age = now.getTime() - new Date(e.at).getTime();
    if (e.offlineAlerted || age < OFFLINE_AFTER_MS) continue;
    e.offlineAlerted = true;
    // The parent's profile was removed since the sensor last reported: forget the sensor.
    if (!(await prisma.elder.findUnique({ where: { id: elderId }, select: { id: true } }))) {
      sensors.delete(elderId);
      continue;
    }
    await raiseAlert({
      elderId,
      kind: "SENSOR_OFFLINE",
      severity: "warning",
      title: `The ${e.room} sensor is offline`,
      message: `The ${e.room} sensor hasn't reported for ${Math.round(age / 60_000)} minutes, so falls there are not being watched. Check its power and Wi-Fi.`,
      dedupeKey: `mmwave-offline:${elderId}:${e.at}`,
    });
  }
}
