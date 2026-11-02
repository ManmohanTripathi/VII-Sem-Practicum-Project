import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import axios from "axios";
import { File } from "expo-file-system";

const SERVER_URL_KEY = "carecircle:serverUrl";
const SESSION_KEY = "carecircle:session";

// While developing, the app is loaded from the same Mac that runs the backend (Expo's hostUri,
// e.g. "10.227.249.130:8081"), so the server address can be worked out instead of typed.
function devServerUrl(): string | null {
  const host = Constants.expoConfig?.hostUri?.split(":")[0];
  return host ? `http://${host}:3000` : null;
}

export const DEFAULT_SERVER_URL = devServerUrl() ?? "http://localhost:3000";

async function reachable(url: string, ms = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    await fetch(`${url}/api/auth/me`, { signal: controller.signal }); // any HTTP answer (even 401) means it's up
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// After a Wi-Fi change the saved address stops working. If so, switch to the Mac this app was
// loaded from (only when that one answers), so nobody has to retype it.
export async function autoFixServerUrl() {
  const dev = devServerUrl();
  const saved = await AsyncStorage.getItem(SERVER_URL_KEY);
  if (!dev || !saved || saved === dev) return;
  if (await reachable(saved)) return;
  if (await reachable(dev)) await setServerUrl(dev);
}

// Who is using this phone: the senior (paired with a 6-digit code from the dashboard)
// or a caregiver (signed in with their dashboard account).
export type Session =
  | { role: "senior"; token: string; elder: Elder }
  | { role: "caregiver"; token: string; caregiver: { id: string; name: string } };

export async function getServerUrl(): Promise<string> {
  return (await AsyncStorage.getItem(SERVER_URL_KEY)) || DEFAULT_SERVER_URL;
}

export async function setServerUrl(url: string) {
  await AsyncStorage.setItem(SERVER_URL_KEY, url.trim().replace(/\/$/, ""));
}

export async function getSession(): Promise<Session | null> {
  const raw = await AsyncStorage.getItem(SESSION_KEY);
  return raw ? (JSON.parse(raw) as Session) : null;
}

async function setSession(session: Session) {
  await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export async function clearSession() {
  await AsyncStorage.removeItem(SESSION_KEY);
}

async function client() {
  const [baseURL, session] = await Promise.all([getServerUrl(), getSession()]);
  return axios.create({
    baseURL,
    timeout: 15000,
    headers: session ? { Authorization: `Bearer ${session.token}` } : {},
  });
}

// Pulls the server's { error } message out of axios errors for friendly alerts.
export function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof Error && !axios.isAxiosError(e) && e.message) return e.message;
  if (axios.isAxiosError(e)) {
    if (e.response?.data?.error) return e.response.data.error;
    if (!e.response) return "Can't reach the server. Check the address and your Wi-Fi.";
  }
  return fallback;
}

export function isUnauthorized(e: unknown) {
  return axios.isAxiosError(e) && e.response?.status === 401;
}

// --- Types ---

export type Elder = { id: string; name: string; avatarColor: string; language?: string; timezone?: string };

export type Reminder = {
  id: string;
  type: string;
  label: string;
  time: string;
  question: string;
  active: boolean;
};

export type CheckIn = {
  id: string;
  status: string;
  scheduledFor: string;
  response: string | null;
};

export type TodayItem = { reminder: Reminder; checkIn: CheckIn };

export type Prompt = {
  kind: string;
  question: string;
  options: { answer: string; emoji: string; label: string }[];
};

export type Mood = "great" | "okay" | "not_great";

export type ChatMessage = { id: string; role: "user" | "assistant"; content: string; createdAt: string };

// --- Senior ---

export async function pairWithCode(code: string): Promise<Elder> {
  const api = await client();
  const { data } = await api.post("/api/devices/pair", { code, kind: "APP", name: "Senior's phone" });
  await setSession({ role: "senior", token: data.token, elder: data.elder });
  return data.elder;
}

export async function fetchToday(): Promise<{ elder: Elder; items: TodayItem[]; prompts: Prompt[]; moodToday: Mood | null }> {
  const api = await client();
  const { data } = await api.get("/api/mobile/today");
  return data;
}

export async function respondToCheckIn(checkInId: string, answer: "yes" | "no") {
  const api = await client();
  const { data } = await api.patch(`/api/checkins/${checkInId}`, { answer });
  return data as { checkIn: CheckIn; message?: string };
}

export async function submitMood(mood: Mood) {
  const api = await client();
  const { data } = await api.post("/api/mood", { mood });
  return data as { message: string | null };
}

export async function submitSelfReport(kind: string, answer: string) {
  const api = await client();
  const { data } = await api.post("/api/mobile/self-report", { kind, answer });
  return data as { message: string | null };
}

export async function fetchChat(): Promise<ChatMessage[]> {
  const api = await client();
  const { data } = await api.get("/api/mobile/chat");
  return data.messages;
}

export async function sendChat(text: string) {
  const api = await client();
  const { data } = await api.post("/api/mobile/chat", { text });
  return data as { reply: string; intent: string; alertRaised: boolean };
}

export async function requestHelp() {
  const api = await client();
  const { data } = await api.post("/api/mobile/help", {});
  return data as { message: string };
}

export async function registerSeniorPushToken(pushToken: string | null) {
  const api = await client();
  await api.post("/api/mobile/push-token", { pushToken });
}

// --- Caregiver ---

export async function caregiverLogin(email: string, password: string) {
  const api = await client();
  const { data } = await api.post("/api/auth/login", { email, password });
  await setSession({ role: "caregiver", token: data.token, caregiver: data.caregiver });
  return data.caregiver as { id: string; name: string };
}

export type Alert = {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  createdAt: string;
};

export type ElderOverview = {
  elder: { id: string; name: string; avatarColor: string; relation: string; phone: string | null };
  status: { tone: "good" | "warn" | "bad"; label: string; detail: string };
  lastTalk: { summary: string; mood: string | null; at: string; usedVoice: boolean } | null;
  done: number;
  missed: number;
  pending: number;
  total: number;
  timeline: { id: string; label: string; time: string; type: string; status: string }[];
  openAlerts: Alert[];
  lastMood: { mood: Mood; at: string } | null;
  hub: "online" | "offline" | "none";
};

export async function fetchOverview(): Promise<ElderOverview[]> {
  const api = await client();
  const { data } = await api.get("/api/caregiver/overview");
  return data.elders;
}

export async function acknowledgeAlert(id: string) {
  const api = await client();
  await api.patch(`/api/alerts/${id}`);
}

export async function registerCaregiverPushToken(pushToken: string | null) {
  const api = await client();
  await api.post("/api/caregiver/push-token", { pushToken });
}

// --- Voice (hold-to-talk) ---

export type VoiceReply = {
  transcript: string;
  reply: string;
  audioUrl: string | null; // absolute URL of the spoken reply, or null (fall back to on-device speech)
  alertRaised: boolean;
};

// Uploads a recording; the server transcribes it (ElevenLabs), asks the companion, and speaks the reply.
export async function sendVoice(fileUri: string): Promise<VoiceReply> {
  const [baseURL, session] = await Promise.all([getServerUrl(), getSession()]);
  const form = new FormData();
  // Expo SDK 58's fetch only accepts real Blob-like files in FormData (not RN's old { uri, name, type }
  // objects, which fail with "Unsupported FormDataPart implementation"). expo-file-system's File is one.
  form.append("audio", new File(fileUri));
  const res = await fetch(`${baseURL}/api/mobile/voice`, {
    method: "POST",
    headers: session ? { Authorization: `Bearer ${session.token}` } : {},
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Voice request failed (${res.status})`);
  return { ...data, audioUrl: data.audioUrl ? `${baseURL}${data.audioUrl}` : null };
}

// Leaving the talk screen: lets the server summarise the conversation for the family right away.
export async function endConversation() {
  const api = await client();
  await api.post("/api/mobile/voice/end", {});
}

// --- Spoken reminders & preferences ---

export type DueAnnouncement = {
  key: string; // announce each key once
  checkInId: string;
  kind: "reminder" | "nudge";
  type: string;
  label: string;
  text: string;
  audioUrl: string | null; // absolute URL once resolved below
};

// Reminders due right now, with the sentence (and ElevenLabs audio) to speak.
export async function fetchDue(): Promise<DueAnnouncement[]> {
  const api = await client();
  const baseURL = await getServerUrl();
  const { data } = await api.get("/api/mobile/due");
  return (data.due as DueAnnouncement[]).map((d) => ({ ...d, audioUrl: d.audioUrl ? `${baseURL}${d.audioUrl}` : null }));
}

export async function setLanguagePreference(language: "en" | "hi") {
  const api = await client();
  await api.post("/api/mobile/preferences", { language });
}

// --- Caretaker: conversation summaries ---

export type ConversationSummary = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  usedVoice: boolean;
  summary: string | null;
  mood: "good" | "okay" | "low" | "unwell" | null;
  concerns: string[];
};

export async function fetchConversations(elderId: string): Promise<ConversationSummary[]> {
  const api = await client();
  const { data } = await api.get(`/api/elders/${elderId}/conversations`);
  return data.conversations;
}

// --- Family messages ---

export type FamilyMessage = {
  id: string;
  direction: "TO_ELDER" | "FROM_ELDER";
  senderName: string;
  kind: "voice" | "text";
  text: string | null;
  audioUrl: string | null; // absolute once resolved; needs authHeaders() to play
  playedAt: string | null;
  createdAt: string;
};

export async function authHeaders(): Promise<Record<string, string>> {
  const session = await getSession();
  return session ? { Authorization: `Bearer ${session.token}` } : {};
}

async function absolute(list: FamilyMessage[]) {
  const baseURL = await getServerUrl();
  return list.map((m) => ({ ...m, audioUrl: m.audioUrl ? `${baseURL}${m.audioUrl}` : null }));
}

async function uploadAudio(path: string, fileUri: string, fields: Record<string, string> = {}) {
  const [baseURL, headers] = await Promise.all([getServerUrl(), authHeaders()]);
  const form = new FormData();
  form.append("audio", new File(fileUri));
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const res = await fetch(`${baseURL}${path}`, { method: "POST", headers, body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Upload failed (${res.status})`);
  return data;
}

// Patient side
export async function fetchMyMessages(): Promise<{ messages: FamilyMessage[]; unplayed: FamilyMessage[] }> {
  const api = await client();
  const { data } = await api.get("/api/mobile/messages");
  return { messages: await absolute(data.messages), unplayed: await absolute(data.unplayed) };
}

export async function sendReply(fileUri: string, replyToId?: string | null) {
  return uploadAudio("/api/mobile/messages", fileUri, replyToId ? { replyToId } : {});
}

export async function markMessagePlayed(id: string) {
  const api = await client();
  await api.post(`/api/messages/${id}/played`);
}

// Caretaker side
export async function fetchThread(elderId: string): Promise<FamilyMessage[]> {
  const api = await client();
  const { data } = await api.get(`/api/elders/${elderId}/messages`);
  return absolute(data.messages);
}

export async function sendTextMessage(elderId: string, text: string) {
  const api = await client();
  await api.post(`/api/elders/${elderId}/messages`, { text });
}

export async function sendVoiceMessage(elderId: string, fileUri: string) {
  return uploadAudio(`/api/elders/${elderId}/messages`, fileUri);
}

export type FeedItem = {
  id: string;
  type: "alert" | "message" | "played";
  elderId: string;
  elderName: string;
  title: string;
  body: string;
  severity: "info" | "warning" | "critical";
  at: string;
};

export async function fetchFeed(since: string): Promise<{ items: FeedItem[]; serverTime: string }> {
  const api = await client();
  const { data } = await api.get("/api/caregiver/feed", { params: { since } });
  return data;
}
