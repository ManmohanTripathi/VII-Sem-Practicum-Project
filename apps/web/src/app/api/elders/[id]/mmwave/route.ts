import { NextResponse } from "next/server";
import { requireCaregiverForElder } from "@/lib/auth";
import { route } from "@/lib/http";
import { latestMmwave } from "@/lib/mmwave";

export const dynamic = "force-dynamic";

// GET /api/elders/[id]/mmwave — the bathroom sensor's last report, or null when no sensor is connected.
export const GET = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const { id } = await params;
  await requireCaregiverForElder(request, id);
  return NextResponse.json({ mmwave: latestMmwave(id) });
});
