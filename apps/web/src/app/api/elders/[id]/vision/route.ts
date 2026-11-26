import { NextResponse } from "next/server";
import { requireCaregiverForElder } from "@/lib/auth";
import { route } from "@/lib/http";
import { latestVision } from "@/lib/vision";

export const dynamic = "force-dynamic";

// GET /api/elders/[id]/vision — what the camera AI saw last (people, posture, who), or null.
export const GET = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const { id } = await params;
  await requireCaregiverForElder(request, id);
  return NextResponse.json({ vision: latestVision(id) });
});
