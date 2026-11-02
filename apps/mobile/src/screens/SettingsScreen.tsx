import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { Lang, t } from "../i18n";
import { Card } from "../ui/Card";
import { Icon } from "../ui/Icon";
import { ScreenHeader } from "../ui/ScreenHeader";
import { colors, radius, sizes } from "../ui/theme";

// Patient settings, kept out of the home screen so nothing can be changed by accident.
export function SettingsScreen({
  lang,
  largeText,
  readAloud,
  onBack,
  onLang,
  onLargeText,
  onReadAloud,
  onSwitchProfile,
}: {
  lang: Lang;
  largeText: boolean;
  readAloud: boolean;
  onBack: () => void;
  onLang: (l: Lang) => void;
  onLargeText: (v: boolean) => void;
  onReadAloud: (v: boolean) => void;
  onSwitchProfile: () => void;
}) {
  const fs = sizes(largeText);

  function confirmSwitch() {
    Alert.alert(t(lang, "switchConfirmTitle"), t(lang, "switchConfirmBody"), [
      { text: t(lang, "cancel"), style: "cancel" },
      { text: t(lang, "switchYes"), style: "destructive", onPress: onSwitchProfile },
    ]);
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title={t(lang, "settings")} onBack={onBack} />
      <ScrollView contentContainerStyle={{ padding: 18, gap: 14 }}>
        <Card style={{ gap: 12 }}>
          <Text style={[styles.heading, { fontSize: fs.md }]}>{t(lang, "languageSetting")}</Text>
          <View style={{ flexDirection: "row", gap: 10 }}>
            {(
              [
                ["en", "English"],
                ["hi", "हिंदी"],
              ] as const
            ).map(([value, label]) => (
              <Pressable
                key={value}
                onPress={() => onLang(value)}
                accessibilityRole="radio"
                accessibilityState={{ selected: lang === value }}
                style={[styles.choice, lang === value && styles.choiceOn]}
              >
                <Text style={[styles.choiceText, { fontSize: fs.lg }, lang === value && { color: colors.accent }]}>{label}</Text>
              </Pressable>
            ))}
          </View>
        </Card>

        <Card style={{ gap: 4 }}>
          <Row label={t(lang, "largeText")} fontSize={fs.md} value={largeText} onChange={onLargeText} />
          <View style={{ height: 1, backgroundColor: colors.line }} />
          <Row label={t(lang, "readAloud")} fontSize={fs.md} value={readAloud} onChange={onReadAloud} />
        </Card>

        <Pressable onPress={confirmSwitch} style={styles.switchRow} accessibilityRole="button">
          <Icon name="swap-horizontal" size={20} color={colors.muted} />
          <Text style={{ color: colors.muted, fontSize: fs.sm, fontWeight: "600" }}>{t(lang, "switchProfile")}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function Row({ label, value, onChange, fontSize }: { label: string; value: boolean; onChange: (v: boolean) => void; fontSize: number }) {
  return (
    <View style={styles.row}>
      <Text style={{ flex: 1, fontSize, color: colors.ink, fontWeight: "600" }}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.accent, false: colors.line }} thumbColor={colors.white} />
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { color: colors.ink, fontWeight: "700" },
  choice: { flex: 1, minHeight: 64, borderRadius: radius.md, borderWidth: 2, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  choiceOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  choiceText: { fontWeight: "800", color: colors.ink },
  row: { flexDirection: "row", alignItems: "center", minHeight: 60 },
  switchRow: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", paddingVertical: 18, marginTop: 10 },
});
