import { beforeEach, describe, expect, it, vi } from "vitest";
import { freezeTime, makeCaregiver, makeDevice, makeElder, prisma, resetDb } from "../helpers";
import { tick } from "@/lib/scheduler";

beforeEach(resetDb);

// 15:00 IST on 2026-10-30 = 09:30Z (daytime, so the no-movement check is active).
const NOW = "2026-10-30T09:30:00Z";
const at = (minutesAgo: number) => new Date(Date.parse(NOW) - minutesAgo * 60_000);

async function setup() {
  const { caregiver } = await makeCaregiver();
  const elder = await makeElder(caregiver.id);
  const { device } = await makeDevice(elder.id, "HUB", { online: true, lastSeenAt: at(0) });
  return { elder, device };
}

describe("no-movement alert", () => {
  it("does NOT fire when the hub only just came back online after days offline", async () => {
    const { elder, device } = await setup();
    await prisma.sensorReading.createMany({
      data: [
        { elderId: elder.id, deviceId: device.id, kind: "motion", value: 3, createdAt: at(3 * 24 * 60) }, // last movement 3 days ago
        { elderId: elder.id, deviceId: device.id, kind: "motion", value: 0, createdAt: at(1) }, // hub back online a minute ago
      ],
    });
    freezeTime(NOW, vi);
    await tick();
    expect(await prisma.alert.count({ where: { kind: "NO_ACTIVITY" } })).toBe(0);
  });

  it("fires when the hub has reported no movement for the whole 4 hours", async () => {
    const { elder, device } = await setup();
    const readings = [{ elderId: elder.id, deviceId: device.id, kind: "motion", value: 2, createdAt: at(5 * 60) }];
    for (let m = 4 * 60 + 10; m >= 0; m -= 15) readings.push({ elderId: elder.id, deviceId: device.id, kind: "motion", value: 0, createdAt: at(m) });
    await prisma.sensorReading.createMany({ data: readings });
    freezeTime(NOW, vi);
    await tick();
    const alert = await prisma.alert.findFirstOrThrow({ where: { kind: "NO_ACTIVITY" } });
    expect(alert.title).toBe("No movement for 4+ hours");
  });
});
