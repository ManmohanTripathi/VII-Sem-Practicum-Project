import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCaregiver } from "@/lib/auth";
import { route } from "@/lib/http";

export const dynamic = "force-dynamic";

type FeedItem = {
  id: string;
  type: "alert" | "message" | "played";
  elderId: string;
  elderName: string;
  title: string;
  body: string;
  severity: "info" | "warning" | "critical";
  at: string;
};

// GET /api/caregiver/feed?since=<ISO> — what happened since the caregiver's phone last checked:
// alerts, voice messages from the elder, and "listened to your message". Polled by the caretaker app
// (Expo Go has no push), newest first.
export const GET = route(async (request) => {
  const caregiver = await requireCaregiver(request);
  const sinceParam = request.nextUrl.searchParams.get("since");
  const since = sinceParam && !Number.isNaN(Date.parse(sinceParam)) ? new Date(sinceParam) : new Date(Date.now() - 24 * 3600_000);
  const mine = { elder: { caregivers: { some: { caregiverId: caregiver.id } } } };

  const [alerts, replies, played] = await Promise.all([
    prisma.alert.findMany({ where: { ...mine, createdAt: { gt: since }, severity: { not: "info" } }, include: { elder: true }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.familyMessage.findMany({ where: { ...mine, direction: "FROM_ELDER", createdAt: { gt: since } }, include: { elder: true }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.familyMessage.findMany({ where: { ...mine, direction: "TO_ELDER", playedAt: { gt: since } }, include: { elder: true }, orderBy: { playedAt: "desc" }, take: 30 }),
  ]);

  const items: FeedItem[] = [
    ...alerts.map((a) => ({
      id: `alert:${a.id}:${a.createdAt.getTime()}`,
      type: "alert" as const,
      elderId: a.elderId,
      elderName: a.elder.name,
      title: a.title,
      body: a.message,
      severity: a.severity as FeedItem["severity"],
      at: a.createdAt.toISOString(),
    })),
    ...replies.map((m) => ({
      id: `message:${m.id}`,
      type: "message" as const,
      elderId: m.elderId,
      elderName: m.elder.name,
      title: `${m.elder.name.split(" ")[0]} sent a voice message`,
      body: m.text ? `“${m.text}”` : "Tap to listen",
      severity: "warning" as const,
      at: m.createdAt.toISOString(),
    })),
    ...played.map((m) => ({
      id: `played:${m.id}`,
      type: "played" as const,
      elderId: m.elderId,
      elderName: m.elder.name,
      title: `${m.elder.name.split(" ")[0]} listened to your message`,
      body: m.text ? `“${m.text.slice(0, 80)}”` : "Voice note",
      severity: "info" as const,
      at: m.playedAt!.toISOString(),
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return NextResponse.json({ items, serverTime: new Date().toISOString() });
});
