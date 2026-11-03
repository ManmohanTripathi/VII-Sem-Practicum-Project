import { beforeEach, describe, expect, it } from "vitest";
import { call, makeCaregiver, makeDevice, makeElder, prisma, req, resetDb } from "../helpers";
import * as help from "@/app/api/mobile/help/route";
import * as today from "@/app/api/mobile/today/route";
import * as me from "@/app/api/auth/me/route";
import * as elderRoute from "@/app/api/elders/[id]/route";

describe("Help button calls a family member", () => {
  beforeEach(resetDb);

  it("caretakers add their number in Settings (cleaned up for tel: links)", async () => {
    const { token } = await makeCaregiver("Anupama");
    const ok = await call(me.PATCH, req("PATCH", "/api/auth/me", { token, body: { phone: "+91 98765-43210" } }));
    expect(ok.json.caregiver.phone).toBe("+919876543210");
    const bad = await call(me.PATCH, req("PATCH", "/api/auth/me", { token, body: { phone: "123" } }));
    expect(bad.status).toBe(400);
    const cleared = await call(me.PATCH, req("PATCH", "/api/auth/me", { token, body: { phone: "" } }));
    expect(cleared.json.caregiver.phone).toBeNull();
  });

  it("alerts the family and tells the phone who to call", async () => {
    const { caregiver } = await makeCaregiver("Anupama");
    await prisma.caregiver.update({ where: { id: caregiver.id }, data: { phone: "+919876543210" } });
    const elder = await makeElder(caregiver.id, { name: "Ba" });
    const { token } = await makeDevice(elder.id);

    const r = await call(help.POST, req("POST", "/api/mobile/help", { token, body: {} }));
    expect(r.status).toBe(200);
    expect(r.json.call).toMatchObject({ name: "Anupama", phone: "+919876543210" });
    const alert = await prisma.alert.findFirstOrThrow({ where: { elderId: elder.id } });
    expect(alert).toMatchObject({ kind: "HELP_REQUEST", severity: "critical" });
    expect(alert.message).toContain("Their phone is calling Anupama");

    // The phone caches it from Today, so Help still calls when the server is unreachable.
    const t = await call(today.GET, req("GET", "/api/mobile/today", { token }));
    expect(t.json.helpContact).toMatchObject({ name: "Anupama", phone: "+919876543210" });
  });

  it("calls the chosen caretaker, falling back to the first with a number", async () => {
    const { caregiver: anupama, token: anupamaToken } = await makeCaregiver("Anupama");
    const { caregiver: rohan } = await makeCaregiver("Rohan");
    const { caregiver: stranger } = await makeCaregiver("Stranger");
    const elder = await makeElder(anupama.id, { name: "Ba" });
    await prisma.caregiverLink.create({ data: { elderId: elder.id, caregiverId: rohan.id } });
    await prisma.caregiver.update({ where: { id: rohan.id }, data: { phone: "+911111111111" } });
    const { token } = await makeDevice(elder.id);

    // Anupama has no number yet, so Rohan is called.
    expect((await call(help.POST, req("POST", "/api/mobile/help", { token, body: {} }))).json.call.name).toBe("Rohan");

    await prisma.caregiver.update({ where: { id: anupama.id }, data: { phone: "+912222222222" } });
    const set = await call(elderRoute.PATCH, req("PATCH", `/api/elders/${elder.id}`, { token: anupamaToken, body: { helpCaregiverId: anupama.id } }), { id: elder.id });
    expect(set.status).toBe(200);
    expect((await call(today.GET, req("GET", "/api/mobile/today", { token }))).json.helpContact.name).toBe("Anupama");

    // Only people who look after this parent can be chosen.
    const bad = await call(elderRoute.PATCH, req("PATCH", `/api/elders/${elder.id}`, { token: anupamaToken, body: { helpCaregiverId: stranger.id } }), { id: elder.id });
    expect(bad.status).toBe(400);
  });

  it("without any number it still alerts, and asks the family to call", async () => {
    const { caregiver } = await makeCaregiver();
    const elder = await makeElder(caregiver.id);
    const { token } = await makeDevice(elder.id);
    const r = await call(help.POST, req("POST", "/api/mobile/help", { token, body: {} }));
    expect(r.json.call).toBeNull();
    expect((await prisma.alert.findFirstOrThrow()).message).toContain("Please call them now");
  });
});
