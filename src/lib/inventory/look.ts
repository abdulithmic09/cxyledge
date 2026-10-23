export type LookMode = "light" | "dark" | "system";
export type LookAccent = "rust" | "pine";
export type LookSize = "sm" | "md" | "lg";

/** Optional custom colours as #rrggbb. Empty string = use the theme's own colour. */
export type LookColors = {
  background: string;
  text: string;
  accent: string;
};

export type Look = {
  mode: LookMode;
  accent: LookAccent;
  size: LookSize;
  colors: LookColors;
};

export const NO_COLORS: LookColors = { background: "", text: "", accent: "" };
export const DEFAULT_LOOK: Look = { mode: "light", accent: "rust", size: "md", colors: NO_COLORS };

const KEY = "cxyledge.look";
const HEX = /^#[0-9a-f]{6}$/i;

function cleanHex(value: unknown): string {
  return typeof value === "string" && HEX.test(value) ? value.toLowerCase() : "";
}

export function readLook(): Look {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_LOOK;
    const parsed = JSON.parse(raw) as Partial<Look>;
    const colors = (parsed.colors ?? {}) as Partial<LookColors>;
    return {
      mode: parsed.mode === "dark" || parsed.mode === "system" ? parsed.mode : "light",
      accent: parsed.accent === "pine" ? "pine" : "rust",
      size: parsed.size === "sm" || parsed.size === "lg" ? parsed.size : "md",
      colors: { background: cleanHex(colors.background), text: cleanHex(colors.text), accent: cleanHex(colors.accent) },
    };
  } catch {
    return DEFAULT_LOOK;
  }
}

export function writeLook(look: Look) {
  try {
    localStorage.setItem(KEY, JSON.stringify(look));
  } catch {
    // storage blocked: the look still applies for this visit
  }
}

/** Black or white, whichever reads better on the given colour. */
export function readableOn(hex: string): string {
  const v = parseInt(hex.slice(1), 16);
  const lum = (0.299 * (v >> 16) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255;
  return lum > 0.6 ? "#16191d" : "#ffffff";
}

const CUSTOM_VARS = [
  "--color-paper",
  "--color-card",
  "--color-sand",
  "--color-line",
  "--color-ink",
  "--color-muted",
  "--color-brand",
  "--color-brand-fg",
  "--color-brand-soft",
];

export function applyLook(look: Look) {
  const root = document.documentElement;
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = look.mode === "dark" || (look.mode === "system" && systemDark);
  root.dataset.theme = dark ? "dark" : "light";
  root.dataset.accent = look.accent;
  root.dataset.size = look.size;

  for (const name of CUSTOM_VARS) root.style.removeProperty(name);
  const { background, text, accent } = look.colors ?? NO_COLORS;
  if (background) {
    const towardText = text || readableOn(background);
    root.style.setProperty("--color-paper", background);
    root.style.setProperty("--color-card", `color-mix(in srgb, ${background} 88%, white 12%)`);
    root.style.setProperty("--color-sand", `color-mix(in srgb, ${background} 88%, ${towardText} 12%)`);
    root.style.setProperty("--color-line", `color-mix(in srgb, ${background} 78%, ${towardText} 22%)`);
    if (!text) {
      root.style.setProperty("--color-ink", towardText);
      root.style.setProperty("--color-muted", `color-mix(in srgb, ${towardText} 70%, ${background} 30%)`);
    }
  }
  if (text) {
    root.style.setProperty("--color-ink", text);
    root.style.setProperty("--color-muted", `color-mix(in srgb, ${text} 70%, ${background || (dark ? "#0a1120" : "#f4f6fa")} 30%)`);
  }
  if (accent) {
    root.style.setProperty("--color-brand", accent);
    root.style.setProperty("--color-brand-fg", readableOn(accent));
    root.style.setProperty("--color-brand-soft", `color-mix(in srgb, ${accent} 12%, ${background || (dark ? "#121b2d" : "#ffffff")})`);
  }
}
