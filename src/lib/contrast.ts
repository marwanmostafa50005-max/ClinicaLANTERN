/** Relative luminance of an sRGB channel (0–255), WCAG 2.x. */
function channelLuminance(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Parse `#rrggbb` into RGB. */
export function parseHexColour(hex: string): [number, number, number] {
  const h = hex.trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(h)) {
    throw new Error(`Expected #rrggbb, got ${hex}`);
  }
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

/** WCAG contrast ratio between two `#rrggbb` colours (1 to 21). */
export function contrastRatio(foreground: string, background: string): number {
  const lum = (hex: string) => {
    const [r, g, b] = parseHexColour(hex);
    return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
  };
  const a = lum(foreground);
  const b = lum(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}