import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  acknowledgeAlert,
  ConversationSummary,
  ElderOverview,
  errorMessage,
  fetchConversations,
  fetchOverview,
  isUnauthorized,
  registerCaregiverPushToken,
} from "../api";
import { getPushToken } from "../notifications";
import { Lang, t } from "../i18n";
import { Card } from "../ui/Card";
import { Icon, type IconName } from "../ui/Icon";
import { Pill, type Tone } from "../ui/Pill";
import { ScreenHeader } from "../ui/ScreenHeader";
import { colors, radius } from "../ui/theme";

type Tab = "family" | "alerts" | "settings";

const DOT: Record<string, { color: string; icon: IconName | null }> = {
  DONE_ON_TIME: { color: colors.good, icon: "checkmark" },
  DONE_LATE: { color: "#D97706", icon: "checkmark" },
  MISSED: { color: colors.bad, icon: "close" },
  SKIPPED: { color: colors.muted, icon: "remove" },
  PENDING: { color: colors.line, icon: null },
};

const MOOD: Record<string, { label: string; tone: Tone }> = {
  good: { label: "Seemed good", tone: "good" },
  okay: { label: "Seemed okay", tone: "neutral" },
  low: { label: "Seemed low", tone: "warn" },
  unwell: { label: "Unwell", tone: "bad" },
};

const STATUS_ICON: Record<string, IconName> = { good: "checkmark-circle", warn: "warning", bad: "alert-circle" };

function ago(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

function time12(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

// Caretaker side: Family · Alerts · Settings, with a detail screen per parent.
export function CaregiverScreen({ name, lang, onLang, onSignOut }: { name: string; lang: Lang; onLang: (l: Lang) => void; onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>("family");
  const [family, setFamily] = useState<ElderOverview[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setFamily(await fetchOverview());
    } catch (e) {
      if (isUnauthorized(e)) return onSignOut();
      Alert.alert("Couldn't load", errorMessage(e, "Please try again."));
    }
  }, [onSignOut]);

  useEffect(() => {
    load();
    getPushToken().then((token) => {
      if (token) registerCaregiverPushToken(token).catch(() => {});
    });
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (!family) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  const alerts = family.flatMap((f) => f.openAlerts.map((a) => ({ ...a, elderName: f.elder.name })));
  const urgentCount = alerts.filter((a) => a.severity !== "info").length;
  const parent = family.find((f) => f.elder.id === selected);

  if (parent) return <ParentDetail parent={parent} lang={lang} onBack={() => setSelected(null)} onChanged={load} />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 18, gap: 14, paddingBottom: 30 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
        {tab === "family" && (
          <>
            <Text style={styles.h1}>
              {t(lang, "hi")} {name.split(" ")[0]}
            </Text>
            <Text style={styles.sub}>{t(lang, "familyToday")}</Text>
            {family.length === 0 && <Text style={styles.sub}>{t(lang, "noFamily")}</Text>}
            {family.map((f) => {
              const tone = f.status.tone;
              const toneColor = tone === "good" ? colors.good : tone === "warn" ? colors.warn : colors.bad;
              const toneBg = tone === "good" ? colors.goodSoft : tone === "warn" ? colors.warnSoft : colors.badSoft;
              return (
                <Pressable key={f.elder.id} onPress={() => setSelected(f.elder.id)} accessibilityRole="button" style={({ pressed }) => pressed && { opacity: 0.9 }}>
                  <Card style={{ gap: 12 }}>
                    <View style={styles.row}>
                      <View style={[styles.avatar, { backgroundColor: f.elder.avatarColor }]}>
                        <Text style={styles.avatarText}>{f.elder.name.slice(0, 1)}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.name}>{f.elder.name}</Text>
                        <Text style={styles.meta}>{f.elder.relation}</Text>
                      </View>
                      <Icon name="chevron-forward" size={22} color={colors.muted} />
                    </View>
                    <View style={[styles.status, { backgroundColor: toneBg }]}>
                      <Icon name={STATUS_ICON[tone]} size={20} color={toneColor} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.statusLabel, { color: toneColor }]}>{f.status.label}</Text>
                        <Text style={styles.statusDetail} numberOfLines={1}>
                          {f.status.detail}
                        </Text>
                      </View>
                    </View>
                    {f.timeline.length > 0 && <Dots items={f.timeline} />}
                    {f.lastTalk && (
                      <Text style={styles.talk} numberOfLines={2}>
                        <Text style={{ fontWeight: "700", color: colors.ink }}>{t(lang, "lastTalk")}: </Text>
                        {f.lastTalk.summary}
                      </Text>
                    )}
                  </Card>
                </Pressable>
              );
            })}
          </>
        )}

        {tab === "alerts" && (
          <>
            <Text style={styles.h1}>{t(lang, "alerts")}</Text>
            {alerts.length === 0 && (
              <Card style={{ alignItems: "center", gap: 8, paddingVertical: 28 }}>
                <Icon name="checkmark-circle" size={36} color={colors.good} />
                <Text style={styles.sub}>{t(lang, "noAlerts")}</Text>
              </Card>
            )}
            {alerts.map((a) => {
              const urgent = a.severity === "critical";
              const color = urgent ? colors.bad : a.severity === "warning" ? colors.warn : colors.muted;
              return (
                <Card key={a.id} style={{ gap: 8, borderLeftWidth: 5, borderLeftColor: color }}>
                  <Text style={[styles.alertKind, { color }]}>
                    {urgent ? "URGENT" : a.severity === "warning" ? "CHECK" : "FYI"} · {a.elderName.split(" ")[0]} · {ago(a.createdAt)}
                  </Text>
                  <Text style={styles.alertTitle}>{a.title}</Text>
                  <Text style={styles.alertMsg}>{a.message}</Text>
                  <Pressable
                    onPress={async () => {
                      await acknowledgeAlert(a.id).catch(() => {});
                      load();
                    }}
                    style={styles.ack}
                    accessibilityRole="button"
                  >
                    <Text style={styles.ackText}>{t(lang, "onIt")}</Text>
                  </Pressable>
                </Card>
              );
            })}
          </>
        )}

        {tab === "settings" && (
          <>
            <Text style={styles.h1}>{t(lang, "caretakerSettings")}</Text>
            <Card style={{ gap: 12 }}>
              <Text style={styles.name}>{t(lang, "languageSetting")}</Text>
              <View style={{ flexDirection: "row", gap: 10 }}>
                {(
                  [
                    ["en", "English"],
                    ["hi", "हिंदी"],
                  ] as const
                ).map(([value, label]) => (
                  <Pressable key={value} onPress={() => onLang(value)} style={[styles.choice, lang === value && styles.choiceOn]}>
                    <Text style={[styles.choiceText, lang === value && { color: colors.accent }]}>{label}</Text>
                  </Pressable>
                ))}
              </View>
            </Card>
            <Pressable
              onPress={() =>
                Alert.alert(t(lang, "signOutConfirm"), undefined, [
                  { text: t(lang, "cancel"), style: "cancel" },
                  { text: t(lang, "signOutOnly"), style: "destructive", onPress: onSignOut },
                ])
              }
              style={styles.signOut}
            >
              <Icon name="log-out-outline" size={20} color={colors.bad} />
              <Text style={{ color: colors.bad, fontSize: 16, fontWeight: "700" }}>{t(lang, "signOutOnly")}</Text>
            </Pressable>
          </>
        )}
      </ScrollView>

      <View style={styles.tabBar}>
        <TabButton icon="people" label={t(lang, "family")} active={tab === "family"} onPress={() => setTab("family")} />
        <TabButton icon="notifications" label={t(lang, "alerts")} active={tab === "alerts"} badge={urgentCount} onPress={() => setTab("alerts")} />
        <TabButton icon="settings-outline" label={t(lang, "caretakerSettings")} active={tab === "settings"} onPress={() => setTab("settings")} />
      </View>
    </View>
  );
}

function ParentDetail({ parent, lang, onBack, onChanged }: { parent: ElderOverview; lang: Lang; onBack: () => void; onChanged: () => void }) {
  const [talks, setTalks] = useState<ConversationSummary[] | null>(null);
  useEffect(() => {
    fetchConversations(parent.elder.id)
      .then(setTalks)
      .catch(() => setTalks([]));
  }, [parent.elder.id]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title={parent.elder.name} onBack={onBack} />
      <ScrollView contentContainerStyle={{ padding: 18, gap: 14, paddingBottom: 30 }}>
        {parent.elder.phone && (
          <Pressable onPress={() => Linking.openURL(`tel:${parent.elder.phone}`)} style={styles.callButton} accessibilityRole="button">
            <Icon name="call" size={20} color={colors.white} />
            <Text style={styles.callText}>
              {t(lang, "call")} {parent.elder.name.split(" ")[0]}
            </Text>
          </Pressable>
        )}

        {parent.openAlerts.map((a) => (
          <Card key={a.id} style={{ gap: 6, borderLeftWidth: 5, borderLeftColor: a.severity === "critical" ? colors.bad : colors.warn }}>
            <Text style={styles.alertTitle}>{a.title}</Text>
            <Text style={styles.alertMsg}>{a.message}</Text>
            <Pressable
              onPress={async () => {
                await acknowledgeAlert(a.id).catch(() => {});
                onChanged();
              }}
              style={styles.ack}
            >
              <Text style={styles.ackText}>{t(lang, "onIt")}</Text>
            </Pressable>
          </Card>
        ))}

        <Card style={{ gap: 10 }}>
          <Text style={styles.name}>{t(lang, "today")}</Text>
          {parent.timeline.length === 0 && <Text style={styles.sub}>{t(lang, "none")}</Text>}
          {parent.timeline.map((c) => {
            const d = DOT[c.status] ?? DOT.PENDING;
            return (
              <View key={c.id} style={styles.row}>
                <View style={[styles.dot, { backgroundColor: d.color }]}>{d.icon && <Icon name={d.icon} size={14} color={colors.white} />}</View>
                <Text style={{ width: 76, color: colors.muted, fontWeight: "600" }}>{time12(c.time)}</Text>
                <Text style={{ flex: 1, color: colors.ink, fontWeight: "600" }}>{c.label}</Text>
              </View>
            );
          })}
        </Card>

        <Text style={[styles.name, { marginTop: 4 }]}>{t(lang, "conversations")}</Text>
        {!talks && <ActivityIndicator color={colors.accent} />}
        {talks?.length === 0 && <Text style={styles.sub}>{t(lang, "noTalk")}</Text>}
        {talks?.map((c) => {
          const mood = c.mood ? MOOD[c.mood] : null;
          return (
            <Card key={c.id} style={{ gap: 8 }}>
              <View style={[styles.row, { flexWrap: "wrap", gap: 6 }]}>
                <Text style={styles.meta}>{new Date(c.startedAt).toLocaleString("en-IN", { weekday: "short", hour: "numeric", minute: "2-digit" })}</Text>
                {c.usedVoice && <Pill label="Voice" tone="accent" icon="mic" />}
                {mood && <Pill label={mood.label} tone={mood.tone} />}
                {!c.endedAt && <Pill label={t(lang, "talkingNow")} tone="good" />}
              </View>
              <Text style={styles.talk}>
                {!c.endedAt && c.summary ? <Text style={{ fontWeight: "700", color: colors.accent }}>{t(lang, "soFar")} </Text> : null}
                {c.summary ?? "…"}
              </Text>
              {c.concerns.length > 0 && (
                <View style={[styles.row, { flexWrap: "wrap", gap: 6 }]}>
                  {c.concerns.map((x) => (
                    <Pill key={x} label={x} tone="warn" />
                  ))}
                </View>
              )}
            </Card>
          );
        })}
      </ScrollView>
    </View>
  );
}

function Dots({ items }: { items: ElderOverview["timeline"] }) {
  return (
    <View style={[styles.row, { flexWrap: "wrap", gap: 8 }]}>
      {items.map((c) => {
        const d = DOT[c.status] ?? DOT.PENDING;
        return (
          <View key={c.id} style={[styles.dot, { backgroundColor: d.color }]} accessibilityLabel={`${c.time} ${c.label}: ${c.status}`}>
            {d.icon && <Icon name={d.icon} size={14} color={colors.white} />}
          </View>
        );
      })}
    </View>
  );
}

function TabButton({ icon, label, active, onPress, badge }: { icon: IconName; label: string; active: boolean; onPress: () => void; badge?: number }) {
  return (
    <Pressable onPress={onPress} style={styles.tab} accessibilityRole="tab" accessibilityState={{ selected: active }}>
      <View>
        <Icon name={icon} size={26} color={active ? colors.accent : colors.muted} />
        {!!badge && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        )}
      </View>
      <Text style={[styles.tabLabel, active && { color: colors.accent }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  h1: { fontSize: 28, fontWeight: "800", color: colors.ink, marginTop: 8 },
  sub: { fontSize: 15, color: colors.muted },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.white, fontSize: 18, fontWeight: "800" },
  name: { fontSize: 17, fontWeight: "700", color: colors.ink },
  meta: { fontSize: 13, color: colors.muted },
  status: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: radius.sm, padding: 12 },
  statusLabel: { fontSize: 15, fontWeight: "800" },
  statusDetail: { fontSize: 14, color: colors.ink, marginTop: 1 },
  talk: { fontSize: 14, color: colors.muted, lineHeight: 20 },
  dot: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  alertKind: { fontSize: 12, fontWeight: "800" },
  alertTitle: { fontSize: 16, fontWeight: "700", color: colors.ink },
  alertMsg: { fontSize: 14, color: colors.muted, lineHeight: 20 },
  ack: { alignSelf: "flex-start", borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, paddingHorizontal: 14, paddingVertical: 9, marginTop: 4, backgroundColor: colors.surface },
  ackText: { fontSize: 14, fontWeight: "700", color: colors.ink },
  choice: { flex: 1, minHeight: 56, borderRadius: radius.md, borderWidth: 2, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  choiceOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  choiceText: { fontSize: 18, fontWeight: "800", color: colors.ink },
  signOut: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", paddingVertical: 18 },
  callButton: { flexDirection: "row", gap: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent, borderRadius: radius.md, minHeight: 56 },
  callText: { color: colors.white, fontSize: 17, fontWeight: "800" },
  tabBar: { flexDirection: "row", borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.surface, paddingBottom: 6 },
  tab: { flex: 1, alignItems: "center", paddingVertical: 8, gap: 2 },
  tabLabel: { fontSize: 12, fontWeight: "700", color: colors.muted },
  badge: { position: "absolute", top: -4, right: -10, backgroundColor: colors.bad, borderRadius: 9, minWidth: 18, paddingHorizontal: 4, alignItems: "center" },
  badgeText: { color: colors.white, fontSize: 11, fontWeight: "800" },
});
