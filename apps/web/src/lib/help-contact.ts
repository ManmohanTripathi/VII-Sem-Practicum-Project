import { prisma } from "@/lib/prisma";

export type HelpContact = { caregiverId: string; name: string; phone: string };

// Who the elder's Help button calls: the caregiver chosen in the parent's settings, otherwise the
// first linked caregiver who has added a phone number. Null when nobody has a number yet.
export async function helpContact(elder: { id: string; helpCaregiverId: string | null }): Promise<HelpContact | null> {
  const links = await prisma.caregiverLink.findMany({ where: { elderId: elder.id }, include: { caregiver: true }, orderBy: { id: "asc" } });
  const withPhone = links.map((l) => l.caregiver).filter((c) => c.phone?.trim());
  const pick = withPhone.find((c) => c.id === elder.helpCaregiverId) ?? withPhone[0];
  return pick ? { caregiverId: pick.id, name: pick.name, phone: pick.phone!.trim() } : null;
}

// Digits and a leading + only, so it works in a tel: link.
export function normalizePhone(raw: string) {
  const t = raw.trim();
  return (t.startsWith("+") ? "+" : "") + t.replace(/\D/g, "");
}
