import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireActingElder } from "@/lib/auth";
import { HttpError, route } from "@/lib/http";
import { MAX_AUDIO_BYTES, replyFromElder, toDTO } from "@/lib/messages";

export const dynamic = "force-dynamic";

// GET /api/mobile/messages — recent family messages for the elder's phone; `unplayed` are the ones
// the phone should announce and play by itself.
export const GET = route(async (request) => {
  const { elder } = await requireActingElder(request, request.nextUrl.searchParams.get("elderId"));
  const messages = await prisma.familyMessage.findMany({ where: { elderId: elder.id }, orderBy: { createdAt: "desc" }, take: 30, include: { caregiver: { select: { name: true } } } });
  const list = messages.reverse().map((m) => toDTO(m));
  return NextResponse.json({
    messages: list,
    unplayed: list.filter((m) => m.direction === "TO_ELDER" && !m.playedAt),
  });
});

// POST /api/mobile/messages — the elder's spoken reply (multipart audio=<recording>, optional replyToId).
export const POST = route(async (request) => {
  const form = await request.formData().catch(() => null);
  const audio = form?.get("audio");
  const { elder } = await requireActingElder(request, (form?.get("elderId") as string | null) ?? null);
  if (!(audio instanceof Blob) || audio.size === 0) throw new HttpError(400, "Send the recording as multipart field 'audio'");
  if (audio.size > MAX_AUDIO_BYTES) throw new HttpError(413, "Recording too long");
  const message = await replyFromElder({
    elder,
    audio: { data: await audio.arrayBuffer(), mime: audio.type || "audio/mp4", name: audio instanceof File ? audio.name : undefined },
    replyToId: (form?.get("replyToId") as string | null) || null,
  });
  return NextResponse.json({ message: toDTO(message) }, { status: 201 });
});
