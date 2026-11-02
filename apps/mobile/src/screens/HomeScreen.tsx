import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, AppState, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  DueAnnouncement,
  errorMessage,
  fetchDue,
  fetchToday,
  isUnauthorized,
  Mood,
  Prompt,
  registerSeniorPushToken,
  requestHelp,
  respondToCheckIn,
  submitMood,
  submitSelfReport,
  TodayItem,
  VoiceReply,
} from "../api";
import {
  cancelLocalReminders,
  ensureNotificationPermission,
  getPushToken,
  setupAndroidChannel,
  syncDailyReminderNotifications,
} from "../notifications";
import { Lang, t } from "../i18n";
import { useVoiceTalk } from "../useVoiceTalk";
import { SaathiAvatar } from "../components/SaathiAvatar";
import { BigButton } from "../ui/BigButton";
import { Card } from "../ui/Card";
import { Icon, type IconName } from "../ui/Icon";
import { colors, radius, sizes } from "../ui/theme";

const TYPE_ICON: Record<string, IconName> = { MEDICINE: "medkit", MEAL: "restaurant", SLEEP: "moon", WAKE: "sunny", CUSTOM: "notifications" };

const ANNOUNCED_KEY = "carecircle:announced";
const DUE_POLL_MS = 15_000;
const TODAY_POLL_MS = 60_000;

function time12(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

type Question = { kind: "MOOD" | string; question: string; options: { answer: string; emoji: string; label: string }[] };

// Patient home: Saathi, one talk button, one reminder card, one question, three tiles. Nothing else.
export function HomeScreen({
  lang,
  largeText,
  readAloud,
  onOpen,
  onSwitchProfile,
}: {
  lang: Lang;
  largeText: boolean;
  readAloud: boolean;
  onOpen: (screen: "reminders" | "chat" | "settings") => void;
  onSwitchProfile: () => void;
}) {
  const fs = sizes(largeText);
  const [elderName, setElderName] = useState("");
  const [items, setItems] = useState<TodayItem[]>([]);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [moodToday, setMoodToday] = useState<Mood | null>(null);
  const [due, setDue] = useState<DueAnnouncement[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [caption, setCaption] = useState<{ heard?: string; text: string } | null>(null);
  const pushSetUp = useRef(false);
  const announced = useRef<Set<string>>(new Set());

  const loadToday = useCallback(async () => {
    try {
      const data = await fetchToday();
      setElderName(data.elder.name);
      setItems(data.items);
      setPrompts(data.prompts);
      setMoodToday(data.moodToday);
      if (!pushSetUp.current) {
        pushSetUp.current = true;
        const token = await getPushToken();
        if (token) {
          await registerSeniorPushToken(token);
          await cancelLocalReminders();
        } else {
          await ensureNotificationPermission();
          await setupAndroidChannel();
          await syncDailyReminderNotifications(data.items.map((i) => i.reminder));
        }
      }
    } catch (e) {
      if (isUnauthorized(e)) {
        Alert.alert("This phone was unpaired", "Ask your family for a new pairing code.");
        onSwitchProfile();
        return;
      }
      throw e;
    }
  }, [onSwitchProfile]);

  const onTurn = useCallback(
    (turn: VoiceReply) => {
      setCaption({ heard: turn.transcript, text: turn.reply });
      loadToday().catch(() => {});
      fetchDue().then(setDue).catch(() => {});
    },
    [loadToday]
  );
  const voice = useVoiceTalk(lang, onTurn);
  const { speak } = voice;
  const phaseRef = useRef(voice.phase);
  phaseRef.current = voice.phase;

  // Speak each newly due reminder once, by itself.
  const checkDue = useCallback(async () => {
    let list: DueAnnouncement[];
    try {
      list = await fetchDue();
    } catch {
      return;
    }
    setDue(list);
    const next = list.find((d) => !announced.current.has(d.key));
    if (!next || phaseRef.current !== "idle") return;
    announced.current.add(next.key);
    AsyncStorage.setItem(ANNOUNCED_KEY, JSON.stringify([...announced.current].slice(-60))).catch(() => {});
    setCaption({ text: next.text });
    await speak(next.text, next.audioUrl);
  }, [speak]);

  useEffect(() => {
    AsyncStorage.getItem(ANNOUNCED_KEY)
      .then((raw) => {
        if (raw) announced.current = new Set(JSON.parse(raw));
      })
      .catch(() => {})
      .finally(() => checkDue());
    loadToday()
      .catch((e) => Alert.alert("Couldn't load today", errorMessage(e, "Please try again.")))
      .finally(() => setLoading(false));
    const dueTimer = setInterval(() => AppState.currentState === "active" && checkDue(), DUE_POLL_MS);
    const todayTimer = setInterval(() => loadToday().catch(() => {}), TODAY_POLL_MS);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") {
        checkDue();
        loadToday().catch(() => {});
      }
    });
    return () => {
      clearInterval(dueTimer);
      clearInterval(todayTimer);
      sub.remove();
    };
  }, [checkDue, loadToday]);

  function confirmMessage(message: string | null | undefined) {
    if (!message) return;
    setCaption({ text: message });
    if (readAloud) speak(message, null);
  }

  async function answer(checkInId: string, yes: boolean) {
    try {
      const { checkIn, message } = await respondToCheckIn(checkInId, yes ? "yes" : "no");
      setItems((prev) => prev.map((i) => (i.checkIn.id === checkInId ? { ...i, checkIn } : i)));
      setDue((d) => d.filter((x) => x.checkInId !== checkInId));
      confirmMessage(message);
    } catch (e) {
      Alert.alert("Couldn't save", errorMessage(e, "Please try again."));
    }
  }

  // One question at a time: today's mood first, then the quick wellbeing prompts.
  const question: Question | null = useMemo(() => {
    if (!moodToday) {
      return {
        kind: "MOOD",
        question: t(lang, "feeling"),
        options: [
          { answer: "great", emoji: "😄", label: t(lang, "great") },
          { answer: "okay", emoji: "🙂", label: t(lang, "okay") },
          { answer: "not_great", emoji: "😕", label: t(lang, "notGreat") },
        ],
      };
    }
    return prompts[0] ?? null;
  }, [moodToday, prompts, lang]);

  async function answerQuestion(q: Question, value: string) {
    try {
      if (q.kind === "MOOD") {
        const { message } = await submitMood(value as Mood);
        setMoodToday(value as Mood);
        confirmMessage(message ?? t(lang, "thanksMood"));
      } else {
        const { message } = await submitSelfReport(q.kind, value);
        setPrompts((p) => p.filter((x) => x.kind !== q.kind));
        confirmMessage(message ?? t(lang, "thanksMood"));
      }
    } catch (e) {
      Alert.alert("Couldn't save", errorMessage(e, "Please try again."));
    }
  }

  function askForHelp() {
    Alert.alert(t(lang, "helpConfirmTitle"), t(lang, "helpConfirmBody"), [
      { text: t(lang, "cancel"), style: "cancel" },
      {
        text: t(lang, "helpYes"),
        style: "destructive",
        onPress: async () => {
          try {
            const { message } = await requestHelp();
            setCaption({ text: message });
            speak(message, null);
          } catch (e) {
            Alert.alert("Couldn't reach your family", errorMessage(e, "Please call them directly."));
          }
        },
      },
    ]);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  const hour = new Date().getHours();
  const greeting = t(lang, hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening");
  const phase = voice.phase;
  const talkLabel =
    phase === "listening" ? t(lang, "listening") : phase === "thinking" ? t(lang, "thinking") : phase === "speaking" ? t(lang, "speaking") : t(lang, "holdToTalk");
  const nextItem = items.find((i) => i.checkIn.status === "PENDING" && new Date(i.checkIn.scheduledFor).getTime() > Date.now());
  const dueNow = due[0];

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await Promise.all([loadToday().catch(() => {}), checkDue()]);
            setRefreshing(false);
          }}
        />
      }
    >
      <View style={styles.topRow}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.greeting, { fontSize: fs.xxl }]} numberOfLines={2}>
            {greeting}, {elderName.split(" ")[0]}
          </Text>
          <Text style={[styles.date, { fontSize: fs.sm }]}>
            {new Date().toLocaleDateString(lang === "hi" ? "hi-IN" : "en-IN", { weekday: "long", day: "numeric", month: "long" })}
          </Text>
        </View>
        <Pressable onPress={() => onOpen("settings")} style={styles.gear} accessibilityRole="button" accessibilityLabel={t(lang, "settings")} hitSlop={10}>
          <Icon name="settings-outline" size={26} color={colors.muted} />
        </Pressable>
      </View>

      {/* Saathi */}
      <Card style={styles.hero}>
        <SaathiAvatar phase={phase} size={120} />
        <Text style={[styles.caption, { fontSize: fs.lg }]} numberOfLines={5}>
          {caption?.text ?? t(lang, "talkCaption")}
        </Text>
        {caption?.heard ? (
          <Text style={[styles.heard, { fontSize: fs.sm }]} numberOfLines={2}>
            {t(lang, "youSaid")}: “{caption.heard}”
          </Text>
        ) : null}
        <Pressable
          onPressIn={voice.start}
          onPressOut={voice.stop}
          onPress={() => phase === "speaking" && voice.stopSpeaking()}
          disabled={phase === "thinking"}
          accessibilityRole="button"
          accessibilityLabel={talkLabel}
          style={({ pressed }) => [
            styles.talk,
            phase === "listening" && { backgroundColor: colors.bad },
            phase === "thinking" && { backgroundColor: colors.muted },
            phase === "speaking" && { backgroundColor: colors.good },
            pressed && phase === "idle" && { transform: [{ scale: 0.98 }] },
          ]}
        >
          <Icon name={phase === "speaking" ? "volume-high" : phase === "listening" ? "radio-button-on" : "mic"} size={28} color={colors.white} />
          <Text style={[styles.talkText, { fontSize: fs.lg }]}>{talkLabel}</Text>
        </Pressable>
      </Card>

      {/* One reminder card */}
      {dueNow ? (
        <Card style={[styles.block, styles.dueCard]}>
          <View style={styles.rowCenter}>
            <View style={[styles.iconBubble, { backgroundColor: colors.warnSoft }]}>
              <Icon name={TYPE_ICON[dueNow.type] ?? "notifications"} size={26} color={colors.warn} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.dueTitle, { fontSize: fs.sm }]}>{t(lang, "dueNow")}</Text>
              <Text style={[styles.cardTitle, { fontSize: fs.lg }]}>{dueNow.label}</Text>
            </View>
            <Pressable onPress={() => speak(dueNow.text, dueNow.audioUrl)} hitSlop={10} accessibilityLabel="Repeat">
              <Icon name="volume-high" size={28} color={colors.warn} />
            </Pressable>
          </View>
          <View style={styles.twoButtons}>
            <View style={{ flex: 1 }}>
              <BigButton label={t(lang, "yes")} variant="good" icon="checkmark-circle" fontSize={fs.md} onPress={() => answer(dueNow.checkInId, true)} />
            </View>
            <View style={{ flex: 1 }}>
              <BigButton label={t(lang, "notYet")} variant="secondary" fontSize={fs.md} onPress={() => answer(dueNow.checkInId, false)} />
            </View>
          </View>
        </Card>
      ) : (
        <Card style={[styles.block, styles.rowCenter]}>
          <View style={[styles.iconBubble, { backgroundColor: nextItem ? colors.accentSoft : colors.goodSoft }]}>
            <Icon name={nextItem ? TYPE_ICON[nextItem.reminder.type] ?? "alarm" : "checkmark-circle"} size={26} color={nextItem ? colors.accent : colors.good} />
          </View>
          <View style={{ flex: 1 }}>
            {nextItem ? (
              <>
                <Text style={[styles.muted, { fontSize: fs.sm }]}>
                  {t(lang, "nextUp")} · {time12(nextItem.reminder.time)}
                </Text>
                <Text style={[styles.cardTitle, { fontSize: fs.lg }]}>{nextItem.reminder.label}</Text>
              </>
            ) : (
              <Text style={[styles.cardTitle, { fontSize: fs.md }]}>{items.length ? t(lang, "allDoneToday") : t(lang, "none")}</Text>
            )}
          </View>
        </Card>
      )}

      {/* One question at a time */}
      {question && (
        <Card style={styles.block}>
          <Pressable onPress={() => speak(question.question, null)} accessibilityRole="button">
            <Text style={[styles.question, { fontSize: fs.lg }]}>{question.question}</Text>
          </Pressable>
          <View style={styles.options}>
            {question.options.map((o) => (
              <Pressable
                key={o.answer}
                onPress={() => answerQuestion(question, o.answer)}
                style={({ pressed }) => [styles.option, pressed && { backgroundColor: colors.accentSoft }]}
                accessibilityRole="button"
                accessibilityLabel={o.label}
              >
                <Text style={{ fontSize: 30 }}>{o.emoji}</Text>
                <Text style={[styles.optionLabel, { fontSize: fs.sm }]}>{o.label}</Text>
              </Pressable>
            ))}
          </View>
        </Card>
      )}

      {/* Three tiles */}
      <View style={styles.tiles}>
        <Tile icon="alarm" label={t(lang, "remindersTile")} fontSize={fs.md} onPress={() => onOpen("reminders")} />
        <Tile icon="chatbubble-ellipses" label={t(lang, "chatTile")} fontSize={fs.md} onPress={() => onOpen("chat")} />
        <Tile icon="call" label={t(lang, "helpTile")} fontSize={fs.md} onPress={askForHelp} danger />
      </View>
    </ScrollView>
  );
}

function Tile({ icon, label, onPress, danger, fontSize }: { icon: IconName; label: string; onPress: () => void; danger?: boolean; fontSize: number }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.tile, danger && { backgroundColor: colors.bad, borderColor: colors.bad }, pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] }]}
    >
      <Icon name={icon} size={32} color={danger ? colors.white : colors.accent} />
      <Text style={[styles.tileLabel, { fontSize }, danger && { color: colors.white }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 18, paddingTop: 12, paddingBottom: 40, gap: 14 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  topRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  greeting: { fontWeight: "800", color: colors.ink },
  date: { color: colors.muted, marginTop: 2 },
  gear: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  hero: { alignItems: "center", paddingTop: 4, paddingBottom: 18, borderRadius: radius.lg },
  caption: { color: colors.ink, textAlign: "center", fontWeight: "600", lineHeight: 28, minHeight: 56, paddingHorizontal: 4 },
  heard: { color: colors.muted, textAlign: "center", marginTop: 6 },
  talk: {
    marginTop: 16,
    alignSelf: "stretch",
    minHeight: 72,
    borderRadius: radius.lg,
    backgroundColor: colors.accent,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  talkText: { color: colors.white, fontWeight: "800" },
  block: { gap: 14 },
  dueCard: { backgroundColor: "#FFFBF3", borderColor: "#F3D9A8", borderWidth: 2 },
  rowCenter: { flexDirection: "row", alignItems: "center", gap: 14 },
  iconBubble: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  dueTitle: { color: colors.warn, fontWeight: "800" },
  cardTitle: { color: colors.ink, fontWeight: "700" },
  muted: { color: colors.muted, fontWeight: "600" },
  twoButtons: { flexDirection: "row", gap: 12 },
  question: { color: colors.ink, fontWeight: "700", lineHeight: 28 },
  options: { flexDirection: "row", gap: 10 },
  option: { flex: 1, alignItems: "center", paddingVertical: 14, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.surface },
  optionLabel: { marginTop: 4, color: colors.ink, fontWeight: "700", textAlign: "center" },
  tiles: { flexDirection: "row", gap: 12 },
  tile: {
    flex: 1,
    minHeight: 104,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  tileLabel: { color: colors.ink, fontWeight: "700" },
});
