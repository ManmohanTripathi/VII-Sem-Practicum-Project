import { NextResponse } from "next/server";
import { route } from "@/lib/http";
import { handleVisionEvent, requireVisionService, visionEventSchema } from "@/lib/vision";

export const dynamic = "force-dynamic";

// POST /api/vision/event — from the camera AI service (Bearer VISION_TOKEN).
//   { type: "observation", elderId, people: [{ posture, identity?, confidence? }] }
//   { type: "fall", elderId, identity?, confidence? }   -> critical FALL_DETECTED alert
export const POST = route(async (request) => {
  requireVisionService(request);
  const alert = await handleVisionEvent(visionEventSchema.parse(await request.json()));
  return NextResponse.json({ ok: true, alertId: alert?.id ?? null });
});
