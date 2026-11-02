import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCaregiverForElder } from "@/lib/auth";
import { HttpError, route } from "@/lib/http";
import { MAX_AUDIO_BYTES, sendToElder, toDTO } from "@/lib/messages";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// GET: the message thread with this elder (both directions), oldest first.
export const GET = route<Ctx>(async (request, { params }) => {
  const { id } = await params;
  await requireCaregiverForElder(request, id);
  const messages = await prisma.familyMessage.findMany({ where: { elderId: id }, orderBy: { createdAt: "desc" }, take: 50 });
  return NextResponse.json({ messages: messages.reverse().map(toDTO) });
});

// POST: send a message to the elder.
//   multipart/form-data: audio=<recording>   (voice note)
//   application/json:    { "text": "..." }   (read aloud on their phone)
export const POST = route<Ctx>(async (request, { params }) => {
  const { id } = await params;
  const caregiver = await requireCaregiverForElder(request, id);
  const elder = await prisma.elder.findUniqueOrThrow({ where: { id } });

  const type = request.headers.get("content-type") || "";
  if (type.startsWith("multipart/form-data")) {
    const form = await request.formData();
    const audio = form.get("audio");
    if (!(audio instanceof Blob) || audio.size === 0) throw new HttpError(400, "Send the recording as multipart field 'audio'");
    if (audio.size > MAX_AUDIO_BYTES) throw new HttpError(413, "Recording too long (max 10 MB)");
    const message = await sendToElder({
      elder,
      caregiver,
      audio: { data: await audio.arrayBuffer(), mime: audio.type || "audio/wav", name: audio instanceof File ? audio.name : undefined },
    });
    return NextResponse.json({ message: toDTO(message) }, { status: 201 });
  }

  const body = await request.json().catch(() => ({}));
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) throw new HttpError(400, "Type a message or send a recording");
  if (text.length > 600) throw new HttpError(400, "Keep messages under 600 characters");
  const message = await sendToElder({ elder, caregiver, text });
  return NextResponse.json({ message: toDTO(message) }, { status: 201 });
});
