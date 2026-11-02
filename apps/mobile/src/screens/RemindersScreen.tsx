import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { errorMessage, fetchToday, respondToCheckIn, TodayItem } from "../api";
import { Lang, say, t } from "../i18n";
import { BigButton } from "../ui/BigButton";
import { Card } from "../ui/Card";
import { Icon, type IconName } from "../ui/Icon";
import { Pill } from "../ui/Pill";
import { ScreenHeader } from "../ui/ScreenHeader";
import { colors, sizes } from "../ui/theme";

const TYPE_ICON: Record<string, IconName> = { MEDICINE: "medkit", MEAL: "restaurant", SLEEP: "moon", WAKE: "sunny", CUSTOM: "notifications" };

function time12(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

// Today's reminders, in time order, with big answer buttons.
export function RemindersScreen({ lang, largeText, onBack }: { lang: Lang; largeText: boolean; onBack: () => void }) {
  const fs = sizes(largeText);
  const [items, setItems] = useState<TodayItem[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems((await fetchToday()).items);
    } catch (e) {
      Alert.alert("Couldn't load", errorMessage(e, "Please try again."));
      setItems([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function answer(item: TodayItem, yes: boolean) {
    try {
      const { checkIn, message } = await respondToCheckIn(item.checkIn.id, yes ? "yes" : "no");
      setItems((prev) => prev?.map((i) => (i.checkIn.id === item.checkIn.id ? { ...i, checkIn } : i)) ?? null);
      if (message) say(message, lang);
    } catch (e) {
      Alert.alert("Couldn't save", errorMessage(e, "Please try again."));
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title={t(lang, "checkins")} onBack={onBack} />
      {!items ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.accent} size="large" />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 18, gap: 14, paddingBottom: 40 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await load();
                setRefreshing(false);
              }}
            />
          }
        >
          {items.length === 0 && <Text style={[styles.empty, { fontSize: fs.md }]}>{t(lang, "none")}</Text>}
          {items.map((item) => {
            const { status, response } = item.checkIn;
            const done = status.startsWith("DONE");
            const missed = status === "MISSED";
            const notYet = status === "PENDING" && response === "not_yet";
            return (
              <Card key={item.checkIn.id} style={{ gap: 14, opacity: done ? 0.75 : 1 }}>
                <View style={styles.row}>
                  <View style={[styles.bubble, { backgroundColor: done ? colors.goodSoft : colors.accentSoft }]}>
                    <Icon name={done ? "checkmark-circle" : TYPE_ICON[item.reminder.type] ?? "notifications"} size={26} color={done ? colors.good : colors.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.time, { fontSize: fs.sm }]}>{time12(item.reminder.time)}</Text>
                    <Text style={[styles.label, { fontSize: fs.lg }]}>{item.reminder.label}</Text>
                  </View>
                  {done && <Pill label={t(lang, "done")} tone="good" />}
                  {missed && <Pill label="✕" tone="bad" />}
                </View>
                {!done && (
                  <>
                    {(missed || notYet) && (
                      <Text style={{ color: missed ? colors.bad : colors.muted, fontSize: fs.sm, fontWeight: "600" }}>
                        {missed ? t(lang, "missed") : t(lang, "willRemind")}
                      </Text>
                    )}
                    <View style={styles.row}>
                      <View style={{ flex: 1 }}>
                        <BigButton label={missed || notYet ? t(lang, "tookItNow") : t(lang, "yes")} variant="good" fontSize={fs.md} compact onPress={() => answer(item, true)} />
                      </View>
                      {!missed && !notYet && (
                        <View style={{ flex: 1 }}>
                          <BigButton label={t(lang, "notYet")} variant="secondary" fontSize={fs.md} compact onPress={() => answer(item, false)} />
                        </View>
                      )}
                    </View>
                  </>
                )}
              </Card>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  bubble: { width: 50, height: 50, borderRadius: 25, alignItems: "center", justifyContent: "center" },
  time: { color: colors.muted, fontWeight: "700" },
  label: { color: colors.ink, fontWeight: "700" },
  empty: { color: colors.muted, textAlign: "center", marginTop: 30 },
});
