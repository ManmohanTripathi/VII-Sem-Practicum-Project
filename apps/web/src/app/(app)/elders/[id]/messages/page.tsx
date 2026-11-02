import { prisma } from "@/lib/prisma";
import { loadElderPage } from "@/lib/elder-page";
import { toDTO } from "@/lib/messages";
import { MessagesPanel } from "@/components/MessagesPanel";

export const dynamic = "force-dynamic";

export default async function MessagesTab({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { elder } = await loadElderPage(id);
  const messages = await prisma.familyMessage.findMany({ where: { elderId: id }, orderBy: { createdAt: "desc" }, take: 50 });
  return (
    <div className="max-w-3xl">
      <MessagesPanel elderId={id} elderName={elder.name} language={elder.language} messages={messages.reverse().map(toDTO)} />
    </div>
  );
}
