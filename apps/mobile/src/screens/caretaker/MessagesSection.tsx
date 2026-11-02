import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as Haptics from "expo-haptics";
import {
  type AudioPlayer,
  createAudioPlayer,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import { authHeaders, errorMessage, FamilyMessage, fetchThread, markMessagePlayed, sendTextMessage, sendVoiceMessage } from "../../api";
import { Lang, t } from "../../i18n";
import { Card } from "../../ui/Card";
import { Icon } from "../../ui/Icon";
import { colors, radius } from "../../ui/theme";

const QUICK = {
  en: ["Did you take your medicine?", "Have you eaten?", "Thinking of you. I'll call you this evening."],
  hi: ["क्या आपने दवा ले ली?", "क्या आपने खाना खा लिया?", "आपकी याद आ रही है, शाम को फ़ोन करूँगा/करूँगी।"],
};

function ago(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

// Caretaker → parent voice notes / text, and the parent's spoken replies.
export function MessagesSection({ elderId, elderName, lang, refreshKey }: { elderId: string; elderName: string; lang: Lang; refreshKey: number }) {
  const [thread, setThread] = useState<FamilyMessage[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const player = useRef<AudioPlayer | null>(null);
  const startedAt = useRef(0);
  const first = elderName.split(" ")[0];

  const load = useCallback(() => {
    fetchThread(elderId)
      .then(setThread)
      .catch(() => setThread((x) => x ?? []));
  }, [elderId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  useEffect(() => () => player.current?.remove(), []);

  async function play(m: FamilyMessage) {
    if (!m.audioUrl) return;
    player.current?.remove();
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    const p = createAudioPlayer({ uri: m.audioUrl, headers: await authHeaders() });
    player.current = p;
    setPlaying(m.id);
    p.addListener("playbackStatusUpdate", (s) => {
      if (s.didJustFinish || s.error) {
        p.remove();
        setPlaying(null);
      }
    });
    p.play();
    if (m.direction === "FROM_ELDER" && !m.playedAt) markMessagePlayed(m.id).catch(() => {});
  }

  async function startRec() {
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) return Alert.alert("Microphone", "Please allow the microphone in Settings.");
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    startedAt.current = Date.now();
    setRecording(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  }

  async function stopRec() {
    if (!recording) return;
    setRecording(false);
    try {
      await recorder.stop();
    } catch {}
    if (Date.now() - startedAt.current < 800 || !recorder.uri) return Alert.alert(t(lang, "tooShort"));
    setBusy(true);
    try {
      await sendVoiceMessage(elderId, recorder.uri);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      load();
    } catch (e) {
      Alert.alert("Couldn't send", errorMessage(e, "Please try again."));
    } finally {
      setBusy(false);
    }
  }

  async function sendText(body: string) {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await sendTextMessage(elderId, body.trim());
      setText("");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      load();
    } catch (e) {
      Alert.alert("Couldn't send", errorMessage(e, "Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ gap: 12 }}>
      <Text style={styles.title}>{t(lang, "messages")}</Text>
      {!thread && <ActivityIndicator color={colors.accent} />}
      {thread?.slice(-8).map((m) => {
        const mine = m.direction === "TO_ELDER";
        return (
          <View key={m.id} style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
            <Text style={[styles.meta, mine && { color: "rgba(255,255,255,0.85)" }]}>
              {mine ? m.senderName.split(" ")[0] : first} · {ago(m.createdAt)}
            </Text>
            {m.text ? <Text style={[styles.text, mine && { color: colors.white }]}>{m.text}</Text> : null}
            {m.audioUrl && (m.kind === "voice" || !mine) && (
              <Pressable onPress={() => play(m)} style={styles.playRow} accessibilityRole="button">
                <Icon name={playing === m.id ? "volume-high" : "play-circle"} size={26} color={mine ? colors.white : colors.accent} />
                <Text style={[styles.playText, mine && { color: colors.white }]}>{playing === m.id ? "Playing…" : "Play"}</Text>
              </Pressable>
            )}
            {mine && (
              <Text style={styles.status}>
                {m.playedAt ? `✓✓ ${t(lang, "played")} ${ago(m.playedAt)}` : `✓ ${t(lang, "delivered")}`}
              </Text>
            )}
          </View>
        );
      })}

      <View style={styles.quickRow}>
        {QUICK[lang].map((q) => (
          <Pressable key={q} onPress={() => sendText(q)} disabled={busy} style={styles.quick}>
            <Text style={styles.quickText}>{q}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        onPressIn={startRec}
        onPressOut={stopRec}
        disabled={busy}
        style={[styles.recordBtn, recording && { backgroundColor: colors.bad }]}
        accessibilityRole="button"
        accessibilityLabel={t(lang, "holdToRecord")}
      >
        {busy ? <ActivityIndicator color={colors.white} /> : <Icon name={recording ? "radio-button-on" : "mic"} size={24} color={colors.white} />}
        <Text style={styles.recordText}>{recording ? t(lang, "listening") : t(lang, "holdToRecord")}</Text>
      </Pressable>

      <View style={styles.inputRow}>
        <TextInput value={text} onChangeText={setText} placeholder={t(lang, "typeMessage")} style={styles.input} multiline maxLength={600} />
        <Pressable onPress={() => sendText(text)} disabled={!text.trim() || busy} style={[styles.send, (!text.trim() || busy) && { opacity: 0.5 }]} accessibilityLabel={t(lang, "send")}>
          <Icon name="send" size={20} color={colors.white} />
        </Pressable>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 17, fontWeight: "700", color: colors.ink },
  bubble: { maxWidth: "88%", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 9, gap: 4 },
  mine: { alignSelf: "flex-end", backgroundColor: colors.accent, borderBottomRightRadius: 4 },
  theirs: { alignSelf: "flex-start", backgroundColor: colors.surface2, borderBottomLeftRadius: 4 },
  meta: { fontSize: 12, fontWeight: "600", color: colors.muted },
  text: { fontSize: 15, color: colors.ink, lineHeight: 21 },
  playRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  playText: { fontSize: 14, fontWeight: "700", color: colors.accent },
  status: { fontSize: 11, color: "rgba(255,255,255,0.85)", alignSelf: "flex-end" },
  quickRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  quick: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 7 },
  quickText: { fontSize: 13, color: colors.ink },
  recordBtn: { minHeight: 56, borderRadius: radius.md, backgroundColor: colors.accent, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  recordText: { color: colors.white, fontSize: 16, fontWeight: "800" },
  inputRow: { flexDirection: "row", gap: 8, alignItems: "flex-end" },
  input: { flex: 1, borderWidth: 1.5, borderColor: colors.line, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, maxHeight: 100, backgroundColor: colors.surface },
  send: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
});
