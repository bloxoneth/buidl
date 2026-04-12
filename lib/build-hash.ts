export interface BuildGeometry {
  bricks: Array<{
    position: [number, number, number]
    color?: string
    width: number
    depth: number
  }>
  baseWidth: number
  baseDepth: number
}

type CanonicalPlacement = {
  x2: number
  y: number
  z2: number
  w2: number
  d2: number
}

const EPSILON = 1e-6

function quantizeHalfStud(value: number): number {
  // Convert stud-space to 0.5-stud integer grid.
  return Math.round(value * 2)
}

function buildLayerIndex(bricks: BuildGeometry["bricks"]): number[] {
  const uniqueY: number[] = []
  const layerByIndex: number[] = []

  for (let i = 0; i < bricks.length; i++) {
    const y = Number(bricks[i].position?.[1] ?? 0)
    let found = -1
    for (let j = 0; j < uniqueY.length; j++) {
      if (Math.abs(uniqueY[j] - y) <= EPSILON) {
        found = j
        break
      }
    }
    if (found === -1) {
      uniqueY.push(y)
      found = uniqueY.length - 1
    }
    layerByIndex.push(found)
  }

  const sorted = [...uniqueY].sort((a, b) => a - b)
  const remap = new Map<number, number>()
  for (let i = 0; i < sorted.length; i++) remap.set(sorted[i], i)

  return layerByIndex.map((idx) => remap.get(uniqueY[idx]) ?? idx)
}

function normalizePlacements(bricks: BuildGeometry["bricks"]): CanonicalPlacement[] {
  const layerIndex = buildLayerIndex(bricks)
  const out: CanonicalPlacement[] = []

  for (let i = 0; i < bricks.length; i++) {
    const b = bricks[i]
    const w = Math.max(1, Math.round(Number(b.width || 1)))
    const d = Math.max(1, Math.round(Number(b.depth || 1)))
    const x = Number(b.position?.[0] ?? 0)
    const z = Number(b.position?.[2] ?? 0)

    // Position is center-based in stud units.
    const minXStud = x - w / 2
    const minZStud = z - d / 2

    out.push({
      x2: quantizeHalfStud(minXStud),
      y: layerIndex[i] ?? 0,
      z2: quantizeHalfStud(minZStud),
      w2: w * 2,
      d2: d * 2,
    })
  }

  return out
}

function rotateY90(p: CanonicalPlacement): CanonicalPlacement {
  // Min-corner rectangle rotation in half-stud grid around origin.
  return {
    x2: p.z2,
    y: p.y,
    z2: -(p.x2 + p.w2),
    w2: p.d2,
    d2: p.w2,
  }
}

function rotateVariant(seed: CanonicalPlacement[], turns: number): CanonicalPlacement[] {
  const rotated = seed.map((p) => ({ ...p }))
  for (let t = 0; t < turns; t++) {
    for (let i = 0; i < rotated.length; i++) rotated[i] = rotateY90(rotated[i])
  }
  return rotated
}

function translateToOrigin(placements: CanonicalPlacement[]): CanonicalPlacement[] {
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  for (const p of placements) {
    if (p.x2 < minX) minX = p.x2
    if (p.y < minY) minY = p.y
    if (p.z2 < minZ) minZ = p.z2
  }
  return placements.map((p) => ({
    x2: p.x2 - minX,
    y: p.y - minY,
    z2: p.z2 - minZ,
    w2: p.w2,
    d2: p.d2,
  }))
}

function sortPlacements(placements: CanonicalPlacement[]): CanonicalPlacement[] {
  return [...placements].sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y
    if (a.x2 !== b.x2) return a.x2 - b.x2
    if (a.z2 !== b.z2) return a.z2 - b.z2
    if (a.w2 !== b.w2) return a.w2 - b.w2
    return a.d2 - b.d2
  })
}

function dedupeOrThrow(sorted: CanonicalPlacement[]): CanonicalPlacement[] {
  const out: CanonicalPlacement[] = []
  let prevKey = ""
  for (const p of sorted) {
    const key = `${p.x2}:${p.y}:${p.z2}:${p.w2}:${p.d2}`
    if (key === prevKey) {
      throw new Error("Duplicate placement detected in canonical geometry")
    }
    out.push(p)
    prevKey = key
  }
  return out
}

function stableCanonicalString(placements: CanonicalPlacement[]): string {
  return JSON.stringify({
    standard: "BUIDL-CANONICAL-GEOMETRY-V1",
    axis_policy: "yaw_only",
    unit: "half_stud",
    placements: placements.map((p) => [p.x2, p.y, p.z2, p.w2, p.d2]),
  })
}

function pickBestYaw(placements: CanonicalPlacement[]): CanonicalPlacement[] {
  let best: CanonicalPlacement[] | null = null
  let bestSig = ""

  for (let turns = 0; turns < 4; turns++) {
    const rotated = rotateVariant(placements, turns)
    const normalized = sortPlacements(translateToOrigin(rotated))
    const sig = stableCanonicalString(normalized)
    if (best === null || sig < bestSig) {
      best = normalized
      bestSig = sig
    }
  }

  return best ?? []
}

export async function generateBuildHash(geometry: BuildGeometry): Promise<string> {
  const normalized = normalizePlacements(geometry.bricks || [])
  const canonical = dedupeOrThrow(pickBestYaw(normalized))
  const canonicalJson = stableCanonicalString(canonical)

  const encoder = new TextEncoder()
  const data = encoder.encode(canonicalJson)
  const hashBuffer = await crypto.subtle.digest("SHA-256", data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")
  return `0x${hashHex}`
}

export function isValidBuildHash(hash: string): boolean {
  return /^0x[a-f0-9]{64}$/i.test(hash)
}
