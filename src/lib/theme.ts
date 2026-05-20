// Design tokens derived from the SPECTRA spec (2026-05-20-controlcenter-spec.yaml §design_tokens).
// Use these constants in TypeScript; the CSS variables in src/styles/global.css are the
// runtime source of truth for components — keep the two in sync.

export const COLORS_DARK = {
  bgCanvas: "#15131A",
  bgSurface: "#1C1A22",
  bgSurfaceRaised: "#241F2C",
  borderSubtle: "#2E2937",
  textPrimary: "#EEE9F3",
  textSecondary: "#A39BAE",
  textMuted: "#6E6679",
  accentPrimary: "#A87CFF",
  accentGradient: "linear-gradient(135deg, #A87CFF 0%, #5EE3D1 100%)",
  accentSecondaryAmber: "#FFB86B",
  statusOk: "#5EE3D1",
  statusWarn: "#F2C879",
  statusError: "#FF7A8A",
} as const;

export const COLORS_LIGHT = {
  bgCanvas: "#FBF7F2",
  bgSurface: "#FFFFFF",
  // Other tokens inherit from dark mode with inverted canvas/surface
} as const;

export const SPACING_PX = [2, 4, 6, 8, 12, 16, 20, 24, 32, 48, 64] as const;

export const RADII_PX = {
  control: 6,
  card: 10,
  sheet: 14,
  modal: 20,
  pill: 999,
} as const;

export const MOTION = {
  entryCurve: "cubic-bezier(0.32, 0.72, 0, 1)",
  durations: {
    micro: 120,
    panel: 220,
    sheet: 320,
  },
} as const;

export const TYPOGRAPHY = {
  ui: "-apple-system, ui-sans-serif, Inter, sans-serif",
  mono: "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace",
} as const;
