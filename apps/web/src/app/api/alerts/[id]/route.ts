import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCaregiverForElder } from "@/lib/auth";
import { route } from "@/lib/http";
import { emitCareEvent } from "@/lib/events";

export const dynamic = "force-dynamic";

// PATCH /api/alerts/[id] — acknowledge ("I'm on it"), so siblings can see someone has handled it.
export const PATCH = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const { id } = await params;
  const existing = await prisma.alert.findUniqueOrThrow({ where: { id } });
  const caregiver = await requireCaregiverForElder(request, existing.elderId);
  const alert = await prisma.alert.update({
    where: { id },
    data: { acknowledgedAt: existing.acknowledgedAt ?? new Date(), acknowledgedBy: existing.acknowledgedBy ?? caregiver.name },
  });
  emitCareEvent({ elderId: alert.elderId, type: "alert.updated", payload: alert });

  // Several presses of the home device's button are one emergency: handling one handles them all.
  if (alert.kind === "DEVICE_ALERT") {
    const others = await prisma.alert.findMany({ where: { elderId: alert.elderId, kind: "DEVICE_ALERT", acknowledgedAt: null } });
    for (const other of others) {
      const done = await prisma.alert.update({ where: { id: other.id }, data: { acknowledgedAt: alert.acknowledgedAt, acknowledgedBy: alert.acknowledgedBy } });
      emitCareEvent({ elderId: done.elderId, type: "alert.updated", payload: done });
    }
  }
  return NextResponse.json({ alert });
});
