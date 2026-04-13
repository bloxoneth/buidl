export const BUIDL_PALETTE = [
  { index: 0, name: "Empty", hex: "#000000" }, // reserved — not selectable
  { index: 1, name: "Red", hex: "#FF3333" },
  { index: 2, name: "Orange", hex: "#FF9933" },
  { index: 3, name: "Yellow", hex: "#FFCC33" },
  { index: 4, name: "Green", hex: "#33CC66" },
  { index: 5, name: "Light Blue", hex: "#33CCFF" },
  { index: 6, name: "Purple", hex: "#9933CC" },
  { index: 7, name: "Black", hex: "#333333" },
] as const

export type ColourIndex = 1 | 2 | 3 | 4 | 5 | 6 | 7

export const SELECTABLE_PALETTE = BUIDL_PALETTE.filter(c => c.index > 0)

export function hexForIndex(index: ColourIndex): string {
  return BUIDL_PALETTE[index]?.hex ?? '#F0F0F0'
}
