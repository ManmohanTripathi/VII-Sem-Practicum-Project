import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, AppState, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import {
  acknowledgeAlert,
  ElderOverview,
  errorMessage,
  FeedItem,
  fetchFeed,
  fetchOverview,
  isUnauthorized,
  openCareEvents,
  registerCaregiverPushToken,
} from "../api";
import { EmergencyAlarm, type Emergency } from "../components/EmergencyAlarm";
import { getPushToken } from "../notifications";
import { Lang, t } from "../i18n";
import { Card } from "../ui/Card";
import { Icon, type IconName } from "../ui/Icon";
import { ScreenHeader } from "../ui/ScreenHeader";
import { colors, radius } from "../ui/theme";
import { ParentDetail } from "./caretaker/ParentDetail";
import { ago, DOT } from "./caretaker/shared";

type Tab = "family" | "alerts" | "settings";

const STATUS_ICON: Record<string, IconName> = { good: "checkmark-circle", warn: "warning", bad: "alert-circle" };

// Caretaker side: Family · Alerts · Settings, with a detail screen per parent.
export function CaregiverScreen({ name, lang, onLang, onSignOut }: { name: string; lang: Lang; onLang: (l: Lang) => void; onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>("family");
  const [family, setFamily] = useState<ElderOverview[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [banner, setBanner] = useState<FeedItem | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const since = useRef(new Date().toISOString());
  // The home hardware's emergency (MQTT) alert: full-screen siren + vibration until handled.
  const [emergency, setEmergency] = useState<Emergency | null>(null);
  const [handledBy, setHandledBy] = useState<string | null>(null);
  const emergencyRef = useRef<Emergency | null>(null);
  emergencyRef.current = emergency;
  const alarmed = useRef(new Set<string>());
  const familyRef = useRef<ElderOverview[] | null>(null);
  familyRef.current = family;
  const slide = useRef(new Animated.Value(-140)).current;

  const showBanner = useCallback(
    (item: FeedItem) => {
      setBanner(item);
      Haptics.notificationAsync(item.severity === "critical" ? Haptics.NotificationFeedbackType.Error : Haptics.NotificationFeedbackType.Warning).catch(() => {});
      Animated.spring(slide, { toValue: 0, useNativeDriver: true }).start();
      setTimeout(() => Animated.timing(slide, { toValue: -140, duration: 250, useNativeDriver: true }).start(() => setBanner((b) => (b?.id === item.id ? null : b))), item.severity === "critical" ? 15000 : 7000);
    },
    [slide]
  );

  const raiseEmergency = useCallback((alertId: string, elderId: string, message: string, elderName?: string) => {
    if (alarmed.current.has(alertId)) return; // already ringing for this one (live stream and feed both report it)
    alarmed.current.add(alertId);
    const parent = familyRef.current?.find((f) => f.elder.id === elderId)?.elder;
    setHandledBy(null);
    setEmergency((prev) => ({
      alertId,
      elderId,
      elderName: parent?.name ?? elderName ?? "",
      message,
      phone: parent?.phone ?? null,
      count: prev && prev.elderId === elderId ? prev.count + 1 : 1,
    }));
  }, []);

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
    // Real-time-ish: Expo Go can't receive push, so check the activity feed every 10 s while open.
    const feedTimer = setInterval(async () => {
      if (AppState.currentState !== "active") return;
      try {
        const { items, serverTime } = await fetchFeed(since.current);
        since.current = serverTime;
        // Backup for the live stream: an emergency the stream missed still sets off the alarm.
        for (const item of items) if (item.emergency && item.alertId) raiseEmergency(item.alertId, item.elderId, item.body, item.elderName);
        const normal = items.filter((i) => !i.emergency);
        if (items.length) {
          if (normal.length) showBanner(normal[0]);
          setRefreshKey((k) => k + 1);
          load();
        }
      } catch {}
    }, 10_000);
    // Event-driven: the server pushes each alert the moment it happens while the app is open.
    const closeEvents = openCareEvents((event) => {
      const p = event.payload ?? {};
      if (event.type === "alert.created" && p.kind === "DEVICE_ALERT") {
        raiseEmergency(String(p.id), event.elderId, String(p.message ?? ""));
        setRefreshKey((k) => k + 1);
        load();
      }
      // Someone tapped "I'm on it" (here, on the laptop, or a sibling): stop the alarm everywhere.
      if (event.type === "alert.updated" && p.kind === "DEVICE_ALERT" && p.acknowledgedAt) {
        if (emergencyRef.current?.elderId === event.elderId) setHandledBy(String(p.acknowledgedBy ?? "Someone"));
      }
    });
    return () => {
      clearInterval(timer);
      clearInterval(feedTimer);
      closeEvents();
    };
  }, [load, showBanner, raiseEmergency]);

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

  const alarmView = emergency && (
    <EmergencyAlarm
      emergency={emergency}
      onAcknowledge={async () => {
        await acknowledgeAlert(emergency.alertId);
        load();
        setRefreshKey((k) => k + 1);
      }}
      handledBy={handledBy}
      onClose={() => {
        setEmergency(null);
        setHandledBy(null);
      }}
    />
  );

  const bannerView = banner && (
    <Animated.View style={[styles.banner, { transform: [{ translateY: slide }] }, banner.severity === "critical" && { backgroundColor: colors.bad }]}>
      <Pressable
        onPress={() => {
          setSelected(banner.elderId);
          setBanner(null);
        }}
        style={{ flexDirection: "row", gap: 10, alignItems: "center" }}
      >
        <Icon name={banner.type === "message" ? "mic" : banner.type === "played" ? "checkmark-done" : "alert-circle"} size={24} color={colors.white} />
        <View style={{ flex: 1 }}>
          <Text style={styles.bannerTitle} numberOfLines={1}>
            {banner.type === "alert" ? `${banner.elderName.split(" ")[0]}: ${banner.title}` : banner.title}
          </Text>
          <Text style={styles.bannerBody} numberOfLines={2}>
            {banner.body}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );

  if (parent)
    return (
      <View style={{ flex: 1 }}>
        <ParentDetail
          parent={parent}
          lang={lang}
          refreshKey={refreshKey}
          onBack={() => setSelected(null)}
          onChanged={load}
          onRemoved={() => {
            setSelected(null);
            load();
          }}
        />
        {bannerView}
        {alarmView}
      </View>
    );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {bannerView}
      {alarmView}
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
  banner: {
    position: "absolute",
    top: 8,
    left: 12,
    right: 12,
    zIndex: 10,
    backgroundColor: colors.ink,
    borderRadius: radius.md,
    padding: 14,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  bannerTitle: { color: colors.white, fontSize: 15, fontWeight: "800" },
  bannerBody: { color: "rgba(255,255,255,0.8)", fontSize: 13, marginTop: 2 },
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
  tabBar: { flexDirection: "row", borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.surface, paddingBottom: 6 },
  tab: { flex: 1, alignItems: "center", paddingVertical: 8, gap: 2 },
  tabLabel: { fontSize: 12, fontWeight: "700", color: colors.muted },
  badge: { position: "absolute", top: -4, right: -10, backgroundColor: colors.bad, borderRadius: 9, minWidth: 18, paddingHorizontal: 4, alignItems: "center" },
  badgeText: { color: colors.white, fontSize: 11, fontWeight: "800" },
});
