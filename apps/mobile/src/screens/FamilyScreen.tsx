import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, type ScrollViewInstance, StyleSheet, Text, View } from "react-native";
import { authHeaders, FamilyMessage, fetchMyMessages, markMessagePlayed } from "../api";
import { Lang, t } from "../i18n";
import { useVoiceTalk } from "../useVoiceTalk";
import { Card } from "../ui/Card";
import { Icon } from "../ui/Icon";
import { ScreenHeader } from "../ui/ScreenHeader";
import { colors, radius, sizes } from "../ui/theme";

function when(iso: string, lang: Lang) {
  return new Date(iso).toLocaleString(lang === "hi" ? "hi-IN" : "en-IN", { weekday: "short", hour: "numeric", minute: "2-digit" });
}

// The parent's messages with family: tap any message to hear it again, hold the big button to reply.
export function FamilyScreen({ lang, largeText, onBack }: { lang: Lang; largeText: boolean; onBack: () => void }) {
  const fs = sizes(largeText);
  const [messages, setMessages] = useState<FamilyMessage[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const headers = useRef<Record<string, string>>({});
  const voice = useVoiceTalk(lang);
  const scroll = useRef<ScrollViewInstance>(null);

  const load = useCallback(async () => {
    try {
      setMessages((await fetchMyMessages()).messages);
    } catch {
      setMessages((m) => m ?? []);
    }
  }, []);

  useEffect(() => {
    authHeaders().then((h) => (headers.current = h));
    load();
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, [load]);

  const lastFromFamily = [...(messages ?? [])].reverse().find((m) => m.direction === "TO_ELDER");

  async function play(m: FamilyMessage) {
    if (m.direction === "TO_ELDER") {
      await voice.playMessage(t(lang, "messageFrom").replace("{name}", m.senderName.split(" ")[0]), m, headers.current);
      if (!m.playedAt) markMessagePlayed(m.id).then(load).catch(() => {});
    } else {
      voice.speak(m.text ?? "", m.audioUrl, headers.current);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title={t(lang, "familyMessages")} onBack={onBack} />
      {!messages ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.accent} size="large" />
      ) : (
        <ScrollView
          ref={scroll}
          contentContainerStyle={{ padding: 18, gap: 12, paddingBottom: 24 }}
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
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
          {messages.length === 0 && <Text style={[styles.empty, { fontSize: fs.md }]}>{t(lang, "noMessages")}</Text>}
          {messages.map((m) => {
            const fromFamily = m.direction === "TO_ELDER";
            return (
              <Pressable key={m.id} onPress={() => play(m)} accessibilityRole="button" accessibilityLabel={t(lang, "playAgain")}>
                <Card style={[styles.msg, fromFamily ? styles.theirs : styles.mine]}>
                  <View style={styles.row}>
                    <Icon name={fromFamily ? "heart" : "person-circle"} size={20} color={fromFamily ? "#BE185D" : colors.accent} />
                    <Text style={[styles.sender, { fontSize: fs.sm }]}>{fromFamily ? m.senderName.split(" ")[0] : t(lang, "you")}</Text>
                    <Text style={[styles.when, { fontSize: fs.xs }]}>{when(m.createdAt, lang)}</Text>
                  </View>
                  {m.text ? <Text style={[styles.text, { fontSize: fs.lg }]}>{m.text}</Text> : null}
                  <View style={styles.playRow}>
                    <Icon name="play-circle" size={36} color={fromFamily ? "#BE185D" : colors.accent} />
                    <Text style={[styles.playLabel, { fontSize: fs.sm }]}>{t(lang, "playAgain")}</Text>
                  </View>
                </Card>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      <View style={styles.footer}>
        <Pressable
          onPressIn={voice.start}
          onPressOut={() => voice.stopReply(lastFromFamily?.id ?? null, lastFromFamily?.senderName.split(" ")[0] ?? t(lang, "familyTile"), load)}
          disabled={voice.phase === "thinking"}
          style={[styles.replyBig, voice.phase === "listening" && { backgroundColor: colors.bad }, voice.phase === "thinking" && { backgroundColor: colors.muted }]}
          accessibilityRole="button"
          accessibilityLabel={t(lang, "holdToReply")}
        >
          {voice.phase === "thinking" ? <ActivityIndicator color={colors.white} /> : <Icon name="mic" size={30} color={colors.white} />}
          <Text style={[styles.replyBigText, { fontSize: fs.lg }]}>{voice.phase === "listening" ? t(lang, "listening") : t(lang, "holdToReply")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { color: colors.muted, textAlign: "center", marginTop: 30, lineHeight: 26 },
  msg: { gap: 10, maxWidth: "92%" },
  theirs: { alignSelf: "flex-start", backgroundColor: "#FFF7FB", borderColor: "#F9D2E5" },
  mine: { alignSelf: "flex-end", backgroundColor: colors.accentSoft, borderColor: "#BFE3DC" },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  sender: { fontWeight: "800", color: colors.ink },
  when: { color: colors.muted, marginLeft: "auto" },
  text: { color: colors.ink, fontWeight: "600", lineHeight: 28 },
  playRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  playLabel: { color: colors.muted, fontWeight: "700" },
  footer: { padding: 16, paddingBottom: 24, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.line },
  replyBig: { minHeight: 76, borderRadius: radius.lg, backgroundColor: "#BE185D", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  replyBigText: { color: colors.white, fontWeight: "800" },
});
