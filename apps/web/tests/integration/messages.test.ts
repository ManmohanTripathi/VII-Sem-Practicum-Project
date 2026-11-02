import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { call, makeCaregiver, makeDevice, makeElder, prisma, req, resetDb } from "../helpers";
import { fetchMock } from "../setup";
import * as thread from "@/app/api/elders/[id]/messages/route";
import * as audioRoute from "@/app/api/messages/[id]/audio/route";
import * as played from "@/app/api/messages/[id]/played/route";
import * as mobile from "@/app/api/mobile/messages/route";
import * as feed from "@/app/api/caregiver/feed/route";
import { careEvents } from "@/lib/events";

const json = (d: unknown) => new Response(JSON.stringify(d));
let dir: string;

beforeEach(async () => {
  await resetDb();
  dir = mkdtempSync(path.join(tmpdir(), "cc-msg-"));
  vi.stubEnv("STORAGE_DIR", dir);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

function voiceForm(bytes = 3000, type = "audio/wav", name = "note.wav") {
  const form = new FormData();
  form.append("audio", new File([new Uint8Array(bytes).fill(7)], name, { type }));
  return form;
}

async function family() {
  const { caregiver, token: cg } = await makeCaregiver("Anita Shah");
  const elder = await makeElder(caregiver.id, { name: "Ramesh Shah", language: "hi" });
  const { token: phone } = await makeDevice(elder.id, "APP");
  return { caregiver, cg, elder, phone };
}

describe("caregiver -> parent messages", () => {
  it("text is spoken with ElevenLabs, shows up unplayed on the phone, and 'played' is reported back", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "xi");
    vi.stubEnv("ELEVENLABS_VOICE_ID", "v");
    fetchMock.mockImplementation(async () => new Response(new Uint8Array([9, 9, 9]), { headers: { "content-type": "audio/mpeg" } }));
    const { cg, elder, phone } = await family();
    const events: string[] = [];
    const listener = (e: { type: string }) => events.push(e.type);
    careEvents.on("event", listener);

    const sent = await call(thread.POST, req("POST", "/x", { cookie: cg, body: { text: "Did you take your medicine?" } }), { id: elder.id });
    expect(sent.status).toBe(201);
    expect(sent.json.message).toMatchObject({ direction: "TO_ELDER", kind: "text", senderName: "Anita Shah", text: "Did you take your medicine?" });
    expect(sent.json.message.audioUrl).toMatch(/^\/api\/messages\/.+\/audio$/);

    const inbox = await call(mobile.GET, req("GET", "/api/mobile/messages", { token: phone }));
    expect(inbox.json.unplayed).toHaveLength(1);

    // The phone fetches the audio with its device token.
    const id = sent.json.message.id;
    const audio = await audioRoute.GET(req("GET", `/api/messages/${id}/audio`, { token: phone }), { params: Promise.resolve({ id }) });
    expect(audio.status).toBe(200);
    expect(audio.headers.get("content-type")).toBe("audio/mpeg");

    await call(played.POST, req("POST", "/x", { token: phone }), { id });
    expect((await call(mobile.GET, req("GET", "/api/mobile/messages", { token: phone }))).json.unplayed).toHaveLength(0);
    expect(events).toEqual(expect.arrayContaining(["message.created", "message.played"]));
    careEvents.off("event", listener);
  });

  it("voice notes are stored and playable; without TTS, text messages have no audio (phone reads them)", async () => {
    const { cg, elder, phone } = await family();
    const voice = await call(thread.POST, req("POST", "/x", { cookie: cg, raw: voiceForm() }), { id: elder.id });
    expect(voice.json.message).toMatchObject({ kind: "voice" });
    const a = await audioRoute.GET(req("GET", "/x", { token: phone }), { params: Promise.resolve({ id: voice.json.message.id }) });
    expect(a.headers.get("content-type")).toBe("audio/wav");
    expect((await a.arrayBuffer()).byteLength).toBe(3000);

    const text = await call(thread.POST, req("POST", "/x", { cookie: cg, body: { text: "Love you" } }), { id: elder.id });
    expect(text.json.message.audioUrl).toBeNull();
  });

  it("validates input and blocks other families", async () => {
    const { cg, elder, phone } = await family();
    const { token: stranger } = await makeCaregiver("Stranger");
    expect((await call(thread.POST, req("POST", "/x", { cookie: cg, body: { text: "" } }), { id: elder.id })).status).toBe(400);
    expect((await call(thread.POST, req("POST", "/x", { cookie: cg, body: { text: "x".repeat(601) } }), { id: elder.id })).status).toBe(400);
    expect((await call(thread.POST, req("POST", "/x", { cookie: stranger, body: { text: "hi" } }), { id: elder.id })).status).toBe(404);
    const sent = await call(thread.POST, req("POST", "/x", { cookie: cg, raw: voiceForm() }), { id: elder.id });
    const other = await makeElder((await makeCaregiver()).caregiver.id);
    const otherPhone = (await makeDevice(other.id, "APP")).token;
    const res = await audioRoute.GET(req("GET", "/x", { token: otherPhone }), { params: Promise.resolve({ id: sent.json.message.id }) });
    expect(res.status).toBe(403);
    expect((await call(mobile.GET, req("GET", "/x", { token: phone }))).status).toBe(200);
  });
});

describe("parent -> family voice replies", () => {
  it("transcribes the reply, links it to the last message, and appears in the caregiver feed", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "xi");
    vi.stubEnv("ELEVENLABS_VOICE_ID", "v");
    const { cg, elder, phone } = await family();
    fetchMock.mockImplementation(async () => new Response(new Uint8Array([1]), { headers: { "content-type": "audio/mpeg" } }));
    const sent = await call(thread.POST, req("POST", "/x", { cookie: cg, body: { text: "How are you?" } }), { id: elder.id });
    const since = new Date(Date.now() - 1000).toISOString();

    fetchMock.mockImplementation(async (input) =>
      String(input).endsWith("/speech-to-text") ? json({ text: "मैं ठीक हूँ, खाना खा लिया", language_code: "hin" }) : json({})
    );
    const reply = await call(mobile.POST, req("POST", "/x", { token: phone, raw: voiceForm(4000, "audio/mp4", "reply.m4a") }));
    expect(reply.status).toBe(201);
    expect(reply.json.message).toMatchObject({ direction: "FROM_ELDER", kind: "voice", text: "मैं ठीक हूँ, खाना खा लिया" });
    const row = await prisma.familyMessage.findUniqueOrThrow({ where: { id: reply.json.message.id } });
    expect(row.replyToId).toBe(sent.json.message.id);

    const f = await call(feed.GET, req("GET", `/api/caregiver/feed?since=${encodeURIComponent(since)}`, { cookie: cg }));
    expect(f.json.items.map((i: { type: string }) => i.type)).toContain("message");
    expect(f.json.items[0].title).toBe("Ramesh sent a voice message");

    // Caregiver plays it -> marked heard (but a caregiver can't mark their own message as played).
    await call(played.POST, req("POST", "/x", { cookie: cg }), { id: reply.json.message.id });
    expect((await prisma.familyMessage.findUniqueOrThrow({ where: { id: reply.json.message.id } })).playedAt).not.toBeNull();
    await call(played.POST, req("POST", "/x", { cookie: cg }), { id: sent.json.message.id });
    expect((await prisma.familyMessage.findUniqueOrThrow({ where: { id: sent.json.message.id } })).playedAt).toBeNull();
  });

  it("raises an urgent alert when the spoken reply asks for help", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "xi");
    const { elder, phone } = await family();
    fetchMock.mockImplementation(async () => json({ text: "मदद चाहिए, मैं गिर गया", language_code: "hin" }));
    await call(mobile.POST, req("POST", "/x", { token: phone, raw: voiceForm() }));
    const alert = await prisma.alert.findFirstOrThrow({ where: { elderId: elder.id } });
    expect(alert).toMatchObject({ severity: "critical", kind: "DISTRESS" });
  });

  it("feed ignores info alerts and things before `since`", async () => {
    const { cg, elder } = await family();
    await prisma.alert.create({ data: { elderId: elder.id, kind: "HUB_OFFLINE", severity: "info", title: "Hub offline", message: "m" } });
    await prisma.alert.create({ data: { elderId: elder.id, kind: "LOW_MOOD", severity: "warning", title: "Old", message: "m", createdAt: new Date(Date.now() - 3600_000) } });
    const since = new Date(Date.now() - 60_000).toISOString();
    const f = await call(feed.GET, req("GET", `/api/caregiver/feed?since=${encodeURIComponent(since)}`, { cookie: cg }));
    expect(f.json.items).toEqual([]);
  });
});
