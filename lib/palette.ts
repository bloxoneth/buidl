export const BUIDL_PALETTE = [
  { index: 0, name: "Empty", hex: "#000000" }, // reserved — not selectable
  { index: 1, name: "Off White", hex: "#F0F0F0" },
  { index: 2, name: "Brick Red", hex: "#B85C38" },
  { index: 3, name: "Wood Brown", hex: "#8B5E3C" },
  { index: 4, name: "Grass Green", hex: "#5A8C3F" },
  { index: 5, name: "Sky Blue", hex: "#5B9BD5" },
  { index: 6, name: "Sand Yellow", hex: "#D4B483" },
  { index: 7, name: "Charcoal", hex: "#2D2D2D" },
] as const

export type ColourIndex = 1 | 2 | 3 | 4 | 5 | 6 | 7

export const SELECTABLE_PALETTE = BUIDL_PALETTE.filter(c => c.index > 0)

export function hexForIndex(index: ColourIndex): string {
  return BUIDL_PALETTE[index]?.hex ?? '#F0F0F0'
}
