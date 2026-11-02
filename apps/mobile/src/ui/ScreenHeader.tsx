import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "./theme";
import { Icon } from "./Icon";

export function ScreenHeader({ title, onBack, backLabel, right }: { title: string; onBack?: () => void; backLabel?: string; right?: React.ReactNode }) {
  return (
    <View style={styles.header}>
      {onBack ? (
        <Pressable onPress={onBack} style={styles.back} accessibilityRole="button" accessibilityLabel={backLabel ?? "Back"} hitSlop={12}>
          <Icon name="chevron-back" size={26} color={colors.accent} />
          {backLabel ? <Text style={styles.backText}>{backLabel}</Text> : null}
        </Pressable>
      ) : (
        <View style={{ width: 40 }} />
      )}
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <View style={{ minWidth: 40, alignItems: "flex-end" }}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingTop: 8, paddingBottom: 10, backgroundColor: colors.bg },
  back: { flexDirection: "row", alignItems: "center", minWidth: 40, minHeight: 44 },
  backText: { color: colors.accent, fontSize: 17, fontWeight: "600" },
  title: { flex: 1, textAlign: "center", fontSize: 19, fontWeight: "700", color: colors.ink },
});
