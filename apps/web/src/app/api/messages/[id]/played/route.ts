import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireElderAccess } from "@/lib/auth";
import { route } from "@/lib/http";
import { markPlayed, toDTO } from "@/lib/messages";

export const dynamic = "force-dynamic";

// POST /api/messages/[id]/played — the recipient listened to it. The elder's phone marks family
// messages as played (the family sees "Played"); caregivers mark the elder's replies as heard.
export const POST = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const { id } = await params;
  const message = await prisma.familyMessage.findUniqueOrThrow({ where: { id }, include: { elder: true } });
  const who = await requireElderAccess(request, message.elderId);
  const isRecipient = (who.kind === "device") === (message.direction === "TO_ELDER");
  const updated = isRecipient ? await markPlayed(message, message.elder.name) : message;
  return NextResponse.json({ message: toDTO(updated) });
});
