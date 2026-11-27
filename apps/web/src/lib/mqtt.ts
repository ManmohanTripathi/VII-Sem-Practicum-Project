import type { MqttClient } from "mqtt";

// Backend side of the hub transport. Only active when MQTT_URL is set; otherwise the hub uses the
// HTTP endpoints and polls /api/hub/state, and publishToHub() is a no-op.
//
// Namespace: carecircle/v1/hub/{deviceId}/{channel}
//   hub -> backend: telemetry | event | reply | status
//   backend -> hub: reminder | say | command
// The ESP32-CAM's own "home/door/status" topic is deliberately outside this namespace and untouched.
// The hardware's alert topic (MQTT_ALERT_TOPIC, default "project/phase3sem7/alert") is subscribed to
// and turned into caregiver alerts (see device-alerts.ts).

export const TOPIC_PREFIX = "carecircle/v1/hub";
const INBOUND = new Set(["telemetry", "event", "reply", "status"]);

const alertTopic = () => process.env.MQTT_ALERT_TOPIC || "project/phase3sem7/alert";
// The optional mmWave bathroom sensor (firmware/esp32-mmwave). Nothing happens until it publishes.
const mmwaveTopic = () => process.env.MQTT_MMWAVE_TOPIC || "project/phase3sem7/mmwave";

const g = globalThis as unknown as { ccMqtt?: MqttClient };

export function mqttConnected() {
  return !!g.ccMqtt?.connected;
}

export function publishToHub(deviceId: string, channel: "reminder" | "say" | "command", payload: unknown) {
  const client = g.ccMqtt;
  if (!client?.connected) return false;
  client.publish(`${TOPIC_PREFIX}/${deviceId}/${channel}`, JSON.stringify(payload), { qos: 1 });
  return true;
}

export async function startMqttBridge() {
  const url = process.env.MQTT_URL;
  if (!url || g.ccMqtt) return;

  const mqtt = await import("mqtt");
  const client = mqtt.connect(url, {
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
    clientId: `carecircle-backend-${Math.random().toString(16).slice(2, 10)}`,
    reconnectPeriod: 5000,
    connectTimeout: 10_000,
  });
  g.ccMqtt = client;

  client.on("connect", () => {
    console.log(`[mqtt] connected to ${url}`);
    client.subscribe(`${TOPIC_PREFIX}/+/+`, { qos: 1 });
    client.subscribe(alertTopic(), { qos: 1 });
    client.subscribe(mmwaveTopic(), { qos: 1 });
  });
  client.on("error", (err) => console.warn("[mqtt]", err.message));

  client.on("message", async (topic, buf) => {
    if (topic === alertTopic()) {
      try {
        const { handleDeviceAlert } = await import("@/lib/device-alerts");
        const raised = await handleDeviceAlert(buf.toString());
        console.log(`[mqtt] alert on ${topic}: "${buf.toString().slice(0, 80)}" -> ${raised.length} caregiver alert(s)`);
      } catch (err) {
        console.warn(`[mqtt] couldn't handle alert on ${topic}:`, (err as Error).message);
      }
      return;
    }
    if (topic === mmwaveTopic()) {
      try {
        const { handleMmwaveMessage } = await import("@/lib/mmwave");
        await handleMmwaveMessage(buf.toString());
      } catch (err) {
        console.warn(`[mqtt] bad mmWave message on ${topic}:`, (err as Error).message);
      }
      return;
    }
    const parts = topic.split("/");
    const [deviceId, channel] = parts.slice(-2);
    if (parts.length !== 5 || !INBOUND.has(channel)) return; // ignore our own outbound channels

    try {
      // Lazy imports: hub.ts imports this module for publishToHub.
      const [{ prisma }, hub] = await Promise.all([import("@/lib/prisma"), import("@/lib/hub")]);
      const device = await prisma.device.findFirst({ where: { id: deviceId, kind: "HUB" } });
      if (!device) return;

      const text = buf.toString();
      if (channel === "status") {
        await hub.setHubStatus(device, text.trim().toLowerCase() !== "offline");
        return;
      }
      const payload = JSON.parse(text);
      if (channel === "telemetry") await hub.ingestTelemetry(device, payload);
      else if (channel === "event") await hub.handleHubEvent(device, payload);
      else if (channel === "reply") await hub.handleHubReply(device, payload);
    } catch (err) {
      console.warn(`[mqtt] bad message on ${topic}:`, (err as Error).message);
    }
  });
}
