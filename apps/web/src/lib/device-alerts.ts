import { prisma } from "@/lib/prisma";
import { raiseAlert } from "@/lib/alerts";

// Emergency alerts published by the home hardware on MQTT_ALERT_TOPIC (default
// "project/phase3sem7/alert"). Every message is a high-emergency event: it always becomes a
// critical alert, with no severity guessing and no de-duplication. (Only this topic works this way;
// the rest of the alert system keeps its own rules.)
// The payload can be plain text ("ALERT", "Fall detected") or JSON:
//   { "message": "Fall detected", "elderId"?: "..." }
// ("alert", "msg", "text", "event", "type" are accepted for the message too.)
// Without an elderId the alert goes to MQTT_ALERT_ELDER_ID (id or name), or else to every parent
// with a camera configured (i.e. the homes that have the hardware).

type Parsed = { message: string; elderId?: string };

export function parseDeviceAlert(raw: string): Parsed | null {
  const text = raw.trim();
  if (!text) return null;
  let obj: Record<string, unknown> | null = null;
  try {
    const j = JSON.parse(text);
    if (j && typeof j === "object" && !Array.isArray(j)) obj = j as Record<string, unknown>;
  } catch {}
  const str = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v).trim() : "");
  const message = obj ? str(obj.message) || str(obj.alert) || str(obj.msg) || str(obj.text) || str(obj.event) || str(obj.type) || text : text;
  if (!message) return null;
  return { message: message.slice(0, 500), elderId: obj ? str(obj.elderId) || undefined : undefined };
}

export async function targetElders(elderId?: string) {
  if (elderId) return prisma.elder.findMany({ where: { id: elderId } });
  const configured = process.env.MQTT_ALERT_ELDER_ID?.trim();
  if (configured) {
    const ids = configured.split(",").map((s) => s.trim()).filter(Boolean);
    return prisma.elder.findMany({ where: { OR: [{ id: { in: ids } }, { name: { in: ids } }] } });
  }
  return prisma.elder.findMany({ where: { cameraUrl: { not: null } } });
}

export async function handleDeviceAlert(raw: string) {
  const parsed = parseDeviceAlert(raw);
  if (!parsed) return [];
  const elders = await targetElders(parsed.elderId);
  const raised = [];
  for (const elder of elders) {
    const alert = await raiseAlert({
      elderId: elder.id,
      kind: "DEVICE_ALERT",
      severity: "critical",
      title: "EMERGENCY from the home device",
      message: `The home device sent “${parsed.message}”. Check on ${elder.name.split(" ")[0]} right now.`,
      data: { source: "mqtt", raw: raw.slice(0, 500) },
    });
    if (alert) raised.push(alert);
  }
  return raised;
}
