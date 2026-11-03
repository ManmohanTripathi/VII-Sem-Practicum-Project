import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword, requireCaregiver, verifyPassword } from "@/lib/auth";
import { HttpError, readJson, route } from "@/lib/http";
import { normalizePhone } from "@/lib/help-contact";

export const dynamic = "force-dynamic";

export const GET = route(async (request) => {
  const caregiver = await requireCaregiver(request);
  return NextResponse.json({ caregiver: { id: caregiver.id, name: caregiver.name, email: caregiver.email, phone: caregiver.phone } });
});

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    // Called by the parent's Help button. Empty string clears it.
    phone: z
      .string()
      .max(30)
      .refine((p) => p.trim() === "" || normalizePhone(p).replace("+", "").length >= 7, "Enter a full phone number, e.g. +91 98765 43210")
      .optional(),
    currentPassword: z.string().optional(),
    newPassword: z.string().min(8, "New password must be at least 8 characters").max(200).optional(),
  })
  .refine((b) => !b.newPassword || b.currentPassword, "Enter your current password");

// PATCH /api/auth/me — update your name and/or password (password change needs the current one).
export const PATCH = route(async (request) => {
  const caregiver = await requireCaregiver(request);
  const body = await readJson(request, patchSchema);
  if (body.newPassword && !(await verifyPassword(body.currentPassword!, caregiver.passwordHash))) {
    throw new HttpError(400, "Your current password isn't right");
  }
  const updated = await prisma.caregiver.update({
    where: { id: caregiver.id },
    data: {
      ...(body.name ? { name: body.name } : {}),
      ...(body.phone !== undefined ? { phone: body.phone.trim() ? normalizePhone(body.phone) : null } : {}),
      ...(body.newPassword ? { passwordHash: await hashPassword(body.newPassword) } : {}),
    },
  });
  return NextResponse.json({ caregiver: { id: updated.id, name: updated.name, email: updated.email, phone: updated.phone } });
});
