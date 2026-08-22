/** The palette of the design. Every option and avatar picks from this list. */
export const PALETTE = [
  "#e0574d",
  "#d1913a",
  "#4f8a5b",
  "#3fb0c8",
  "#4b8fbe",
  "#6d5bd0",
  "#c2557a",
  "#b6763f",
  "#2f9e7a",
  "#7a8a2f",
  "#3d7fc1",
  "#8b8f98",
] as const;

export const AVATAR_COLORS = [
  "#6d5bd0",
  "#2f9e7a",
  "#c2557a",
  "#b6763f",
  "#4b8fbe",
  "#3fb0c8",
  "#d1913a",
  "#7a8a2f",
] as const;

export function pickAvatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function nextPaletteColor(used: string[]): string {
  const free = PALETTE.find((c) => !used.includes(c));
  return free ?? PALETTE[used.length % PALETTE.length];
}

/** Translates #rrggbb into an rgba() string with the given alpha. */
export function tint(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
