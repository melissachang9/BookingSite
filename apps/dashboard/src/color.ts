const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export const DEFAULT_PANEL_COLOR = "#f6dfd0";

export function isHexColor(value: string): boolean {
  return HEX.test(value.trim());
}

function channels(hex: string): [number, number, number] {
  const value = hex.trim().slice(1);
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

/** Dark text on a light colour and white text on a dark one, so a card is always readable. */
export function readableTextColor(background: string): string {
  if (!isHexColor(background)) return "#15110f";
  const [r, g, b] = channels(background).map((channel) => {
    const unit = channel / 255;
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.4 ? "#15110f" : "#ffffff";
}
