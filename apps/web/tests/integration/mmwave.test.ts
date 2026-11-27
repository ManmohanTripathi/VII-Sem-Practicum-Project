import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCaregiver, makeElder, prisma, resetDb } from "../helpers";
import { checkMmwaveOffline, handleMmwaveMessage, latestMmwave } from "@/lib/mmwave";

describe("optional mmWave bathroom sensor", () => {
  beforeEach(resetDb);
  afterEach(() => vi.unstubAllEnvs());

  it("without a sensor nothing changes: no state, no offline alerts", async () => {
    const { caregiver } = await makeCaregiver();
    const ba = await makeElder(caregiver.id, { name: "Shanti Devi" });
    expect(latestMmwave(ba.id)).toBeNull();
    await checkMmwaveOffline(new Date(Date.now() + 3600_000));
    expect(await prisma.alert.count({ where: { elderId: ba.id } })).toBe(0);
  });

  it("status reports show the card state and count as activity", async () => {
    const { caregiver } = await makeCaregiver();
    const ba = await makeElder(caregiver.id, { name: "Shanti Devi" });
    await handleMmwaveMessage(JSON.stringify({ type: "status", elderId: ba.id, state: "occupied", distanceCm: 120 }));
    expect(latestMmwave(ba.id)).toMatchObject({ room: "bathroom", state: "occupied", radar: "ok", distanceCm: 120 });
    expect(await prisma.sensorReading.count({ where: { elderId: ba.id, kind: "motion" } })).toBe(1);
    expect(await prisma.alert.count()).toBe(0);
  });

  it("an unanswered fall check is an emergency, and a silent sensor raises one offline warning", async () => {
    const { caregiver } = await makeCaregiver();
    const ba = await makeElder(caregiver.id, { name: "Shanti Devi" });
    await handleMmwaveMessage(JSON.stringify({ type: "fall", elderId: ba.id, state: "on_floor" }));
    expect(await prisma.alert.findFirstOrThrow()).toMatchObject({ kind: "BATHROOM_ALERT", severity: "critical", title: "Possible fall in the bathroom" });

    const later = new Date(Date.now() + 5 * 60_000);
    await checkMmwaveOffline(later);
    await checkMmwaveOffline(later);
    expect(await prisma.alert.count({ where: { kind: "SENSOR_OFFLINE" } })).toBe(1);
  });

  it("without an elderId the message goes to the configured parent", async () => {
    vi.stubEnv("MQTT_ALERT_ELDER_ID", "Shanti Devi");
    const { caregiver } = await makeCaregiver();
    const ba = await makeElder(caregiver.id, { name: "Shanti Devi" });
    await makeElder(caregiver.id, { name: "Someone Else" });
    await handleMmwaveMessage(JSON.stringify({ type: "long_stay", minutes: 31 }));
    const alert = await prisma.alert.findFirstOrThrow();
    expect(alert.elderId).toBe(ba.id);
    expect(alert.message).toContain("31 minutes");
  });
});
