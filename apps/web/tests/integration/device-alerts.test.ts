import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCallsTo } from "../setup";
import { call, makeCaregiver, makeElder, prisma, req, resetDb } from "../helpers";
import { handleDeviceAlert, parseDeviceAlert } from "@/lib/device-alerts";

describe("hardware emergency alerts on project/phase3sem7/alert", () => {
  beforeEach(resetDb);
  afterEach(() => vi.unstubAllEnvs());

  it("reads plain text and JSON payloads", () => {
    expect(parseDeviceAlert("ALERT")).toEqual({ message: "ALERT", elderId: undefined });
    expect(parseDeviceAlert('{"alert":"Gas leak"}')).toMatchObject({ message: "Gas leak" });
    expect(parseDeviceAlert('{"message":"Fall detected","elderId":"e1"}')).toMatchObject({ message: "Fall detected", elderId: "e1" });
    expect(parseDeviceAlert("   ")).toBeNull();
  });

  it("every message is a critical alert for the configured parent, pushed to the caretaker", async () => {
    const { caregiver } = await makeCaregiver("Anupama");
    await prisma.caregiver.update({ where: { id: caregiver.id }, data: { pushToken: "ExponentPushToken[a]" } });
    const ba = await makeElder(caregiver.id, { name: "Ba" });
    await makeElder(caregiver.id, { name: "Someone Else" });
    vi.stubEnv("MQTT_ALERT_ELDER_ID", "Ba");

    // Even text that sounds harmless, or JSON asking for a lower severity, is an emergency.
    for (const payload of ["ALERT", "Door left open", '{"message":"Motion","severity":"info"}']) {
      const [alert] = await handleDeviceAlert(payload);
      expect(alert).toMatchObject({ elderId: ba.id, kind: "DEVICE_ALERT", severity: "critical", title: "EMERGENCY from the home device" });
    }
    expect((await prisma.alert.findFirstOrThrow({ orderBy: { createdAt: "asc" } })).message).toBe("The home device sent “ALERT”. Check on Ba right now.");
    expect(JSON.stringify(fetchCallsTo("exp.host")[0].body)).toContain("Ba: EMERGENCY from the home device");
  });

  it("no filtering: repeated messages, even back to back, are each a new alert", async () => {
    vi.stubEnv("MQTT_ALERT_ELDER_ID", "Ba");
    const { caregiver } = await makeCaregiver();
    await makeElder(caregiver.id, { name: "Ba" });
    for (let i = 0; i < 4; i++) await handleDeviceAlert("ALERT");
    expect(await prisma.alert.count()).toBe(4);
  });

  it("without config, alerts the parents whose home has the camera", async () => {
    vi.stubEnv("MQTT_ALERT_ELDER_ID", "");
    const { caregiver } = await makeCaregiver();
    const withCam = await makeElder(caregiver.id, { name: "Ba" });
    await prisma.elder.update({ where: { id: withCam.id }, data: { cameraUrl: "http://10.0.0.5" } });
    await makeElder(caregiver.id, { name: "No Hardware" });
    expect(await handleDeviceAlert("ALERT")).toHaveLength(1);
    expect((await prisma.alert.findFirstOrThrow()).elderId).toBe(withCam.id);
  });
});

describe("handling a hardware emergency", () => {
  beforeEach(resetDb);
  afterEach(() => vi.unstubAllEnvs());

  it("I'm on it handles every open press for that parent, but not other alerts", async () => {
    vi.stubEnv("MQTT_ALERT_ELDER_ID", "Ba");
    const { caregiver, token } = await makeCaregiver("Anupama");
    const ba = await makeElder(caregiver.id, { name: "Ba" });
    const presses = [];
    for (let i = 0; i < 3; i++) presses.push(...(await handleDeviceAlert("ALERT")));
    const other = await prisma.alert.create({ data: { elderId: ba.id, kind: "HEALTH_CONCERN", severity: "warning", title: "Not feeling well", message: "x" } });

    const { PATCH } = await import("@/app/api/alerts/[id]/route");
    const r = await call(PATCH, req("PATCH", `/api/alerts/${presses[2].id}`, { token }), { id: presses[2].id });
    expect(r.status).toBe(200);
    const open = await prisma.alert.findMany({ where: { acknowledgedAt: null } });
    expect(open.map((a) => a.id)).toEqual([other.id]);
    expect((await prisma.alert.findUniqueOrThrow({ where: { id: presses[0].id } })).acknowledgedBy).toBe("Anupama");
  });
});
