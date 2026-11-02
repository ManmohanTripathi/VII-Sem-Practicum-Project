import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireElderAccess } from "@/lib/auth";
import { route } from "@/lib/http";
import { readAudio } from "@/lib/storage";

export const dynamic = "force-dynamic";

// GET /api/messages/[id]/audio — the recording (or synthesized speech) for a family message.
// Allowed for the elder's own devices and their caregivers.
export const GET = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const { id } = await params;
  const message = await prisma.familyMessage.findUniqueOrThrow({ where: { id } });
  await requireElderAccess(request, message.elderId);
  if (!message.audioFile) return NextResponse.json({ error: "No audio for this message" }, { status: 404 });
  const data = await readAudio(message.audioFile);
  return new NextResponse(new Uint8Array(data), {
    headers: { "Content-Type": message.audioMime || "application/octet-stream", "Content-Length": String(data.length), "Cache-Control": "private, max-age=3600" },
  });
});
