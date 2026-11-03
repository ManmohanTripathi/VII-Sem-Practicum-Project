import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCallsTo, fetchMock } from "../setup";
import { makeCaregiver, makeElder, prisma, resetDb } from "../helpers";
import { buildSystemPrompt, companionTurn, parseAskFamily } from "@/lib/ai/companion";
import { sendToElder, toDTO } from "@/lib/messages";

const llmSays = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }));

describe("Saathi asks the family when it doesn't know", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("GROQ_API_KEY", "gk");
  });

  it("parses the model's ASK_FAMILY line", () => {
    expect(parseAskFamily('ASK_FAMILY: "When is Rohan visiting?"')).toBe("When is Rohan visiting?");
    expect(parseAskFamily("**ASK_FAMILY:** Where are my glasses?\nextra")).toBe("Where are my glasses?");
    expect(parseAskFamily("Rohan is lovely.")).toBeNull();
  });

  it("asks the caretaker, pushes a notification and tells the parent who was asked", async () => {
    const { caregiver } = await makeCaregiver();
    await prisma.caregiver.update({ where: { id: caregiver.id }, data: { pushToken: "ExponentPushToken[anita]" } });
    const elder = await makeElder(caregiver.id);
    fetchMock.mockImplementation(async (url) => (String(url).includes("groq") ? llmSays("ASK_FAMILY: When is Rohan visiting?") : new Response("{}")));

    const r = await companionTurn({ elder, text: "Rohan kab aayega?", source: "app" });
    expect(r.reply).toContain("Anita");
    expect(r.reply).not.toContain("ASK_FAMILY");
    expect(r.askedFamily).toMatchObject({ caregiverName: "Anita", question: "When is Rohan visiting?" });

    const q = await prisma.familyMessage.findFirstOrThrow({ where: { elderId: elder.id } });
    expect(q).toMatchObject({ direction: "FROM_ELDER", kind: "question", text: "When is Rohan visiting?", caregiverId: caregiver.id });
    const push = fetchCallsTo("exp.host");
    expect(JSON.stringify(push[0].body)).toContain("asked Saathi something");

    // Asking again doesn't spam the family.
    const again = await companionTurn({ elder, text: "Rohan kab aayega?", source: "app" });
    expect(again.reply).toMatch(/already|has your question/);
    expect(await prisma.familyMessage.count()).toBe(1);
  });

  it("speaks Hindi to Hindi-speaking parents, in Saathi's feminine voice", async () => {
    const { caregiver } = await makeCaregiver();
    const elder = await makeElder(caregiver.id, { language: "hi", name: "Kamlaben Shah" });
    fetchMock.mockImplementation(async () => llmSays("ASK_FAMILY: Where are my spectacles kept?"));
    const r = await companionTurn({ elder, text: "मेरा चश्मा कहाँ रखा है?", source: "app" });
    expect(r.reply).toMatch(/Anita/);
    expect(r.reply).toMatch(/दूँगी|सुनाऊँगी/);
  });

  it("the caretaker's answer reaches the parent and Saathi remembers it", async () => {
    const { caregiver } = await makeCaregiver();
    const elder = await makeElder(caregiver.id);
    fetchMock.mockImplementation(async () => llmSays("ASK_FAMILY: When is Rohan visiting?"));
    await companionTurn({ elder, text: "When is Rohan coming?", source: "app" });

    await sendToElder({ elder, caregiver, text: "Rohan is coming on Sunday" });

    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => llmSays("He's coming on Sunday, Ramesh!"));
    const r = await companionTurn({ elder, text: "When is Rohan coming?", source: "app" });
    expect(r.reply).toBe("He's coming on Sunday, Ramesh!");
    const prompt = fetchCallsTo("groq")[0].body.messages[0].content as string;
    expect(prompt).toContain('They asked the family: "When is Rohan visiting?"');
    expect(prompt).toContain('Anita said: "Rohan is coming on Sunday"');
  });

  it("Saathi reads recent family notes to answer", async () => {
    const { caregiver } = await makeCaregiver();
    const elder = await makeElder(caregiver.id);
    await prisma.caregiverNote.create({ data: { elderId: elder.id, caregiverId: caregiver.id, body: "Doctor visit is on Friday at 11am" } });
    await prisma.caregiverNote.create({
      data: { elderId: elder.id, caregiverId: caregiver.id, body: "Old note", createdAt: new Date(Date.now() - 30 * 24 * 3600_000) },
    });
    fetchMock.mockImplementation(async () => llmSays("Anita said your doctor visit is on Friday at 11."));
    const r = await companionTurn({ elder, text: "When is my doctor visit?", source: "app" });
    expect(r.reply).toContain("Friday");
    const prompt = fetchCallsTo("groq")[0].body.messages[0].content as string;
    expect(prompt).toMatch(/Never tell .* from these notes about their health/);
    expect(prompt).toContain("Anita (");
    expect(prompt).toContain("Doctor visit is on Friday at 11am");
    expect(prompt).not.toContain("Old note"); // only the last two weeks
  });

  it("the parent's phone sees the open question and who it went to", async () => {
    const { caregiver } = await makeCaregiver();
    const elder = await makeElder(caregiver.id);
    fetchMock.mockImplementation(async () => llmSays("ASK_FAMILY: Is the doctor visit tomorrow?"));
    await companionTurn({ elder, text: "Is my doctor visit tomorrow?", source: "app" });
    const msgs = await prisma.familyMessage.findMany({ include: { caregiver: { select: { name: true } } } });
    expect(toDTO(msgs[0])).toMatchObject({ kind: "question", askedName: "Anita", direction: "FROM_ELDER" });
  });

  it("the dashboard preview never messages the family", async () => {
    const { caregiver } = await makeCaregiver();
    const elder = await makeElder(caregiver.id);
    fetchMock.mockImplementation(async () => llmSays("ASK_FAMILY: When is Rohan visiting?"));
    const r = await companionTurn({ elder, text: "When is Rohan coming?", source: "dashboard", persist: false });
    expect(r.reply).not.toContain("ASK_FAMILY");
    expect(await prisma.familyMessage.count()).toBe(0);
  });

  it("the persona is a soft-spoken woman", () => {
    const p = buildSystemPrompt({ name: "Kamla", lang: "hi", localTime: "10:00", partOfDay: "morning", profile: null, todayReminders: [], recentReports: [] });
    expect(p).toMatch(/gentle, soft-spoken woman/);
    expect(p).toMatch(/feminine forms/);
    expect(p).toMatch(/ASK_FAMILY/);
  });
});
