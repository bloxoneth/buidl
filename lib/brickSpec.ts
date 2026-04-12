import { ethers } from "ethers"

export function isValidBrickDimension(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 10
}

/**
 * Compute a canonical specKey matching the V3 contract:
 * keccak256(abi.encodePacked(w, d))
 * Width/depth are normalized so min comes first (1x3 == 3x1).
 * Density is FIXED_DENSITY=1 in V3, not part of the spec key.
 */
export function computeSpecKey(width: number, depth: number, _density?: number): string {
  const w = Math.min(width, depth)
  const d = Math.max(width, depth)
  const encoded = ethers.solidityPacked(
    ["uint8", "uint8"],
    [w, d]
  )
  return ethers.keccak256(encoded)
}

/**
 * Validate all brick params. Returns null if valid, or an error string.
 */
export function validateBrickParams(
  width: number,
  depth: number,
): string | null {
  if (!isValidBrickDimension(width)) return `Invalid width: ${width} (must be 1-10)`
  if (!isValidBrickDimension(depth)) return `Invalid depth: ${depth} (must be 1-10)`
  return null
}

/**
 * Compute canonical mass for a brick: width * depth (density is always 1 in V3)
 */
export function computeBrickMass(width: number, depth: number): number {
  return Math.min(width, depth) * Math.max(width, depth)
}
