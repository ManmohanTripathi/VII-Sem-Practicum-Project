import * as Haptics from "expo-haptics";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius } from "./theme";
import { Icon, type IconName } from "./Icon";

type Variant = "primary" | "secondary" | "danger" | "good";

const VARIANT: Record<Variant, { bg: string; fg: string; border?: string }> = {
  primary: { bg: colors.accent, fg: colors.white },
  secondary: { bg: colors.surface, fg: colors.ink, border: colors.line },
  danger: { bg: colors.bad, fg: colors.white },
  good: { bg: colors.good, fg: colors.white },
};

// Large, high-contrast button (min 64px tall) with a light haptic tap.
export function BigButton({
  label,
  icon,
  onPress,
  variant = "primary",
  loading,
  disabled,
  fontSize = 19,
  compact,
}: {
  label: string;
  icon?: IconName;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  fontSize?: number;
  compact?: boolean;
}) {
  const v = VARIANT[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled || loading}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress();
      }}
      style={({ pressed }) => [
        styles.base,
        compact && { minHeight: 52, paddingVertical: 12 },
        { backgroundColor: v.bg, borderColor: v.border ?? v.bg, opacity: disabled ? 0.5 : 1 },
        pressed && { transform: [{ scale: 0.98 }], opacity: 0.9 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <View style={styles.row}>
          {icon && <Icon name={icon} size={fontSize + 4} color={v.fg} />}
          <Text style={[styles.label, { color: v.fg, fontSize }]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: 64, borderRadius: radius.md, paddingVertical: 16, paddingHorizontal: 18, alignItems: "center", justifyContent: "center", borderWidth: 1.5 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  label: { fontWeight: "700" },
});
