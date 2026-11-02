import type { Caregiver, Elder, FamilyMessage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { emitCareEvent } from "@/lib/events";
import { raiseAlert } from "@/lib/alerts";
import { sendPush } from "@/lib/push";
import { synthesize, transcribe } from "@/lib/ai/speech";
import { classifyIntent, scoreWellbeing } from "@/lib/ai/nlu";
import { extensionFor, mimeFor, saveAudio } from "@/lib/storage";
import { zonedDayKey } from "@/lib/time";

// Family messages: caregivers send voice notes or text to the elder (played aloud on their phone);
// the elder replies by voice (transcribed for the family, and checked for help/health words).

export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

export type MessageDTO = {
  id: string;
  direction: "TO_ELDER" | "FROM_ELDER";
  senderName: string;
  kind: "voice" | "text";
  text: string | null;
  audioUrl: string | null;
  playedAt: string | null;
  createdAt: string;
};

export function toDTO(m: FamilyMessage): MessageDTO {
  return {
    id: m.id,
    direction: m.direction as MessageDTO["direction"],
    senderName: m.senderName,
    kind: m.kind as MessageDTO["kind"],
    text: m.text,
    audioUrl: m.audioFile ? `/api/messages/${m.id}/audio` : null,
    playedAt: m.playedAt?.toISOString() ?? null,
    createdAt: m.createdAt.toISOString(),
  };
}

const first = (name: string) => name.split(" ")[0];

export async function sendToElder(opts: {
  elder: Elder;
  caregiver: Caregiver;
  text?: string;
  audio?: { data: ArrayBuffer; mime: string; name?: string };
}) {
  const { elder, caregiver } = opts;
  let audioFile: string | null = null;
  let audioMime: string | null = null;

  if (opts.audio) {
    audioFile = await saveAudio(opts.audio.data, extensionFor(opts.audio.mime, opts.audio.name));
    audioMime = mimeFor(audioFile);
  } else if (opts.text) {
    // Typed messages are spoken in a natural voice on the elder's phone. Without TTS the phone
    // falls back to its own voice.
    const speech = await synthesize(opts.text);
    if (speech) {
      audioFile = await saveAudio(speech.audio, extensionFor(speech.contentType));
      audioMime = speech.contentType;
    }
  }

  const message = await prisma.familyMessage.create({
    data: {
      elderId: elder.id,
      direction: "TO_ELDER",
      caregiverId: caregiver.id,
      senderName: caregiver.name,
      kind: opts.audio ? "voice" : "text",
      text: opts.text ?? null,
      audioFile,
      audioMime,
    },
  });

  emitCareEvent({ elderId: elder.id, type: "message.created", payload: { ...toDTO(message), elderName: elder.name } });

  const phones = await prisma.device.findMany({ where: { elderId: elder.id, kind: "APP", pushToken: { not: null } } });
  await sendPush(
    phones.map((d) => ({
      to: d.pushToken!,
      title: elder.language === "hi" ? `${first(caregiver.name)} का संदेश` : `Message from ${first(caregiver.name)}`,
      body: opts.text ?? (elder.language === "hi" ? "सुनने के लिए खोलें" : "Open to listen"),
      data: { messageId: message.id },
      channelId: "reminders",
    }))
  );
  return message;
}

export async function replyFromElder(opts: {
  elder: Elder;
  audio: { data: ArrayBuffer; mime: string; name?: string };
  replyToId?: string | null;
}) {
  const { elder } = opts;
  const replyTo = opts.replyToId
    ? await prisma.familyMessage.findFirst({ where: { id: opts.replyToId, elderId: elder.id } })
    : await prisma.familyMessage.findFirst({ where: { elderId: elder.id, direction: "TO_ELDER" }, orderBy: { createdAt: "desc" } });

  const audioFile = await saveAudio(opts.audio.data, extensionFor(opts.audio.mime, opts.audio.name));
  const transcript = await transcribe(new Blob([opts.audio.data], { type: opts.audio.mime }), elder.language === "hi" ? "hi" : undefined, audioFile);

  const message = await prisma.familyMessage.create({
    data: {
      elderId: elder.id,
      direction: "FROM_ELDER",
      caregiverId: replyTo?.caregiverId ?? null,
      senderName: elder.name,
      kind: "voice",
      text: transcript || null,
      audioFile,
      audioMime: mimeFor(audioFile),
      replyToId: replyTo?.id ?? null,
    },
  });

  // A spoken reply can still be a call for help or a health worry.
  const name = first(elder.name);
  if (transcript) {
    const { intent } = classifyIntent(transcript);
    const wellbeing = scoreWellbeing(transcript);
    if (intent === "DISTRESS" || intent === "HELP") {
      await raiseAlert({
        elderId: elder.id,
        kind: intent === "DISTRESS" ? "DISTRESS" : "HELP_REQUEST",
        severity: "critical",
        title: intent === "DISTRESS" ? "Possible emergency" : "Asked for help",
        message: `${name} said in a voice message: “${transcript.slice(0, 160)}”`,
        dedupeKey: `msg-${intent.toLowerCase()}:${message.id}`,
      });
    } else if (wellbeing.flags.includes("unwell")) {
      await raiseAlert({
        elderId: elder.id,
        kind: "HEALTH_CONCERN",
        severity: "warning",
        title: "Not feeling well",
        message: `${name} said in a voice message: “${transcript.slice(0, 160)}”`,
        dedupeKey: `msg-unwell:${elder.id}:${zonedDayKey(new Date(), elder.timezone)}:${message.id}`,
      });
    }
  }

  emitCareEvent({ elderId: elder.id, type: "message.created", payload: { ...toDTO(message), elderName: elder.name } });

  const links = await prisma.caregiverLink.findMany({ where: { elderId: elder.id }, include: { caregiver: true } });
  await sendPush(
    links
      .filter((l) => l.caregiver.pushToken)
      .map((l) => ({
        to: l.caregiver.pushToken!,
        title: `${name} sent a voice message`,
        body: transcript ? `“${transcript.slice(0, 120)}”` : "Tap to listen",
        data: { messageId: message.id, elderId: elder.id },
        channelId: "alerts",
      }))
  );
  return message;
}

export async function markPlayed(message: FamilyMessage, elderName: string) {
  if (message.playedAt) return message;
  const updated = await prisma.familyMessage.update({ where: { id: message.id }, data: { playedAt: new Date() } });
  emitCareEvent({ elderId: message.elderId, type: "message.played", payload: { ...toDTO(updated), elderName } });
  return updated;
}
