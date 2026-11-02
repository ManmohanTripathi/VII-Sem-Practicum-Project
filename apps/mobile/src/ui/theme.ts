// "Calm & warm" palette shared with the web dashboard.
export const colors = {
  bg: "#FAF8F5",
  surface: "#FFFFFF",
  surface2: "#F3EFEA",
  ink: "#1F2937",
  muted: "#6B7280",
  line: "#ECE7E1",
  accent: "#0F766E",
  accentDark: "#115E59",
  accentSoft: "#E6F4F1",
  good: "#15803D",
  goodSoft: "#EAF6EE",
  warn: "#B45309",
  warnSoft: "#FEF5E7",
  bad: "#B91C1C",
  badSoft: "#FDECEC",
  white: "#FFFFFF",
};

export const radius = { sm: 12, md: 18, lg: 24, pill: 999 };

// Font sizes; the patient app multiplies them when "Large text" is on.
export const baseSize = { xs: 13, sm: 15, md: 17, lg: 20, xl: 24, xxl: 30 };

export function sizes(large: boolean) {
  const k = large ? 1.2 : 1;
  return Object.fromEntries(Object.entries(baseSize).map(([n, v]) => [n, Math.round(v * k)])) as typeof baseSize;
}
