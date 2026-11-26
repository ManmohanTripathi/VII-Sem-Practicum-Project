import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { route } from "@/lib/http";
import { requireVisionService } from "@/lib/vision";

export const dynamic = "force-dynamic";

// GET /api/vision/cameras — which cameras the camera AI service should watch (Bearer VISION_TOKEN).
export const GET = route(async (request) => {
  requireVisionService(request);
  const elders = await prisma.elder.findMany({ where: { cameraUrl: { not: null } }, select: { id: true, name: true, cameraUrl: true } });
  return NextResponse.json({ cameras: elders.map((e) => ({ elderId: e.id, name: e.name, streamUrl: `${e.cameraUrl}/stream` })) });
});
