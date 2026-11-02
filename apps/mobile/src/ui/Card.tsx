import { StyleSheet, View, type ViewProps } from "react-native";
import { colors, radius } from "./theme";

export function Card({ style, ...rest }: ViewProps) {
  return <View style={[styles.card, style]} {...rest} />;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.line,
  },
});
