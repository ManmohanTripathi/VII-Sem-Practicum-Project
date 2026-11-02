import { StyleSheet, Text, View } from "react-native";
import { colors, radius } from "./theme";
import { Icon, type IconName } from "./Icon";

export type Tone = "good" | "warn" | "bad" | "neutral" | "accent";

const TONE: Record<Tone, { bg: string; fg: string }> = {
  good: { bg: colors.goodSoft, fg: colors.good },
  warn: { bg: colors.warnSoft, fg: colors.warn },
  bad: { bg: colors.badSoft, fg: colors.bad },
  neutral: { bg: colors.surface2, fg: colors.muted },
  accent: { bg: colors.accentSoft, fg: colors.accent },
};

export function Pill({ label, tone = "neutral", icon }: { label: string; tone?: Tone; icon?: IconName }) {
  const t = TONE[tone];
  return (
    <View style={[styles.pill, { backgroundColor: t.bg }]}>
      {icon && <Icon name={icon} size={14} color={t.fg} />}
      <Text style={[styles.text, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  text: { fontSize: 13, fontWeight: "700" },
});
