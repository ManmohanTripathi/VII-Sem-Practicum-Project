import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { call, makeCaregiver, makeElder, prisma, req, resetDb } from "../helpers";
import { POST as visionEvent } from "@/app/api/vision/event/route";
import { GET as cameras } from "@/app/api/vision/cameras/route";
import { latestVision } from "@/lib/vision";

describe("camera AI events (/api/vision/*)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("VISION_TOKEN", "vision-secret");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("rejects calls without the service token", async () => {
    const res = await call(visionEvent, req("POST", "/api/vision/event", { body: { type: "fall", elderId: "x" }, token: "wrong" }));
    expect(res.status).toBe(401);
  });

  it("lists the cameras to watch", async () => {
    const { caregiver } = await makeCaregiver();
    const ba = await makeElder(caregiver.id, { name: "Shanti Devi" });
    await prisma.elder.update({ where: { id: ba.id }, data: { cameraUrl: "http://10.0.0.5" } });
    await makeElder(caregiver.id, { name: "No Camera" });
    const res = await call(cameras, req("GET", "/api/vision/cameras", { token: "vision-secret" }));
    expect(res.json.cameras).toEqual([{ elderId: ba.id, name: "Shanti Devi", streamUrl: "http://10.0.0.5/stream" }]);
  });

  it("a fall is a critical emergency, once per two minutes", async () => {
    const { caregiver } = await makeCaregiver();
    const ba = await makeElder(caregiver.id, { name: "Shanti Devi" });
    const body = { type: "fall", elderId: ba.id, identity: "patient", confidence: 0.8 };
    const first = await call(visionEvent, req("POST", "/api/vision/event", { body, token: "vision-secret" }));
    expect(first.status).toBe(200);
    await call(visionEvent, req("POST", "/api/vision/event", { body, token: "vision-secret" }));
    const alerts = await prisma.alert.findMany();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: "FALL_DETECTED", severity: "critical" });
    expect(alerts[0].message).toContain("saw Shanti go down");
  });

  it("observations update the live state, count as activity, and note unknown faces", async () => {
    const { caregiver } = await makeCaregiver();
    const ba = await makeElder(caregiver.id, { name: "Shanti Devi" });
    const people = [{ posture: "sitting", identity: "unknown" }];
    await call(visionEvent, req("POST", "/api/vision/event", { body: { type: "observation", elderId: ba.id, people }, token: "vision-secret" }));
    expect(latestVision(ba.id)?.people).toEqual(people);
    expect(await prisma.sensorReading.count({ where: { elderId: ba.id, kind: "motion" } })).toBe(1);
    expect(await prisma.alert.findFirstOrThrow()).toMatchObject({ kind: "UNKNOWN_PERSON", severity: "info" });

    // The patient in view too: no "someone new" note.
    await prisma.alert.deleteMany();
    const withPatient = [...people, { posture: "standing", identity: "patient" }];
    await call(visionEvent, req("POST", "/api/vision/event", { body: { type: "observation", elderId: ba.id, people: withPatient }, token: "vision-secret" }));
    expect(await prisma.alert.count()).toBe(0);
  });
});
