/**
 * Isometric SVG renderer for BUIDL voxel models.
 *
 * Takes parsed voxel geometry (from on-chain or app data) and produces
 * a self-contained SVG string that closely matches the Three.js preview.
 *
 * Camera: orthographic from direction (1,1,1) — same as BuildVoxelPreview [8,8,8]
 * Light:  directional from (9,12,8) — same as BuildVoxelPreview
 *
 * Usage:
 *   import { renderVoxelSVG } from "@/lib/svg-renderer"
 *   const svg = renderVoxelSVG(voxels, { width: 512, height: 512 })
 */

import { BUIDL_PALETTE } from "./palette"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Voxel {
  x: number
  y: number
  z: number
  colourIndex: number
}

export interface SVGRendererOptions {
  /** Output width in px (default 512) */
  width?: number
  /** Output height in px (default 512) */
  height?: number
  /** Background colour (default matches Three.js scene #36465c) */
  background?: string
  /** Padding factor 0-1 around the model (default 0.15) */
  padding?: number
  /** Show ground glow ellipse (default true) */
  groundGlow?: boolean
}

// ─── Projection math ─────────────────────────────────────────────────────────

// Camera direction (1, 0.82, 1) — slightly lower than pure isometric (1,1,1)
// to show more side face and match the Three.js perspective feel (FOV 42 at [8,8,8]).
// The lower Y gives a ~35° elevation instead of true isometric ~35.26°,
// making side faces taller relative to the top face.
const CAM = { x: 1, y: 0.82, z: 1 }
const CAM_LEN = Math.sqrt(CAM.x ** 2 + CAM.y ** 2 + CAM.z ** 2)
const FWD = { x: -CAM.x / CAM_LEN, y: -CAM.y / CAM_LEN, z: -CAM.z / CAM_LEN }

// Right axis = normalise( cross( forward, worldUp ) )
const RIGHT_RAW = { x: -FWD.z, y: 0, z: FWD.x } // cross(fwd, (0,1,0))
const RIGHT_LEN = Math.sqrt(RIGHT_RAW.x ** 2 + RIGHT_RAW.z ** 2)
const RIGHT = { x: RIGHT_RAW.x / RIGHT_LEN, y: 0, z: RIGHT_RAW.z / RIGHT_LEN }

// Up axis = cross( right, forward )
const UP = {
  x: RIGHT.y * FWD.z - RIGHT.z * FWD.y,
  y: RIGHT.z * FWD.x - RIGHT.x * FWD.z,
  z: RIGHT.x * FWD.y - RIGHT.y * FWD.x,
}

// Fake perspective: points further from camera appear smaller.
// Applied relative to the model center so near edges grow and far edges shrink.
const PERSPECTIVE = 0.18 // strength of foreshortening (0 = pure isometric)
const CAM_DIR = { x: CAM.x / CAM_LEN, y: CAM.y / CAM_LEN, z: CAM.z / CAM_LEN }

// Base projection (no perspective — applied in renderVoxelSVG with model center)
function projectOrtho(x: number, y: number, z: number): [number, number] {
  const sx = x * RIGHT.x + y * RIGHT.y + z * RIGHT.z
  const sy = -(x * UP.x + y * UP.y + z * UP.z)
  return [sx, sy]
}

function depthOf(x: number, y: number, z: number): number {
  return x * CAM_DIR.x + y * CAM_DIR.y + z * CAM_DIR.z
}

// ─── Lighting ────────────────────────────────────────────────────────────────

// Directional light at (9,12,8) — normalised
const LIGHT_LEN = Math.sqrt(9 * 9 + 12 * 12 + 8 * 8)
const LIGHT = [9 / LIGHT_LEN, 12 / LIGHT_LEN, 8 / LIGHT_LEN] as const

const AMBIENT = 0.38 // slightly lower ambient for more contrast
const DIFFUSE = 0.62 // stronger directional for more face differentiation

// Face normals (visible faces from camera direction)
// Top:   (0, 1, 0)
// Right: (1, 0, 0)   — the x+ face, appears on screen-right
// Front: (0, 0, 1)   — the z+ face, appears on screen-left
const FACE_NORMALS = {
  top:   [0, 1, 0] as const,
  right: [1, 0, 0] as const,
  left:  [0, 0, 1] as const,
}

function faceBrightness(normal: readonly [number, number, number]): number {
  const dot = normal[0] * LIGHT[0] + normal[1] * LIGHT[1] + normal[2] * LIGHT[2]
  return Math.min(1, AMBIENT + DIFFUSE * Math.max(0, dot))
}

const BRIGHTNESS_TOP   = faceBrightness(FACE_NORMALS.top)    // brighter
const BRIGHTNESS_RIGHT = faceBrightness(FACE_NORMALS.right)  // mid
const BRIGHTNESS_LEFT  = faceBrightness(FACE_NORMALS.left)   // darkest

// ─── Colour helpers ──────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "")
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
  return `#${clamp(r).toString(16).padStart(2, "0")}${clamp(g).toString(16).padStart(2, "0")}${clamp(b).toString(16).padStart(2, "0")}`
}

function applyBrightness(hex: string, brightness: number): string {
  const [r, g, b] = hexToRgb(hex)
  return rgbToHex(r * brightness, g * brightness, b * brightness)
}

function darken(hex: string, pct: number): string {
  const [r, g, b] = hexToRgb(hex)
  const f = 1 - pct
  return rgbToHex(r * f, g * f, b * f)
}

function lighten(hex: string, pct: number): string {
  const [r, g, b] = hexToRgb(hex)
  return rgbToHex(r + (255 - r) * pct, g + (255 - g) * pct, b + (255 - b) * pct)
}

// ─── Voxel helpers ───────────────────────────────────────────────────────────

/** Build a fast lookup set for occupied voxels */
function buildOccupancySet(voxels: Voxel[]): Set<string> {
  const s = new Set<string>()
  for (const v of voxels) s.add(`${v.x},${v.y},${v.z}`)
  return s
}

function isOccupied(occ: Set<string>, x: number, y: number, z: number): boolean {
  return occ.has(`${x},${y},${z}`)
}

/** Check if a face of voxel at (x,y,z) is visible (neighbour is empty) */
function isFaceVisible(
  occ: Set<string>,
  x: number, y: number, z: number,
  face: "top" | "right" | "left",
): boolean {
  switch (face) {
    case "top":   return !isOccupied(occ, x, y + 1, z)
    case "right": return !isOccupied(occ, x + 1, y, z)
    case "left":  return !isOccupied(occ, x, y, z + 1)
  }
}

// ─── Face geometry ───────────────────────────────────────────────────────────

/** Return 4 3D vertices for one face of the unit cube at (x,y,z) */
function faceVertices3D(
  x: number, y: number, z: number,
  face: "top" | "right" | "left",
): [number, number, number][] {
  switch (face) {
    case "top":
      return [
        [x,     y + 1, z],
        [x + 1, y + 1, z],
        [x + 1, y + 1, z + 1],
        [x,     y + 1, z + 1],
      ]
    case "right": // x+ face
      return [
        [x + 1, y,     z],
        [x + 1, y + 1, z],
        [x + 1, y + 1, z + 1],
        [x + 1, y,     z + 1],
      ]
    case "left": // z+ face
      return [
        [x,     y,     z + 1],
        [x + 1, y,     z + 1],
        [x + 1, y + 1, z + 1],
        [x,     y + 1, z + 1],
      ]
  }
}

/** Project 3D vertices to 2D with fake perspective centered around model depth */
function projectWithPerspective(
  verts3D: [number, number, number][],
  centerDepth: number,
): [number, number][] {
  return verts3D.map(([x, y, z]) => {
    const [sx, sy] = projectOrtho(x, y, z)
    // depth relative to model center: positive = closer, negative = further
    const relDepth = depthOf(x, y, z) - centerDepth
    const scale = 1 + PERSPECTIVE * relDepth
    return [sx * scale, sy * scale] as [number, number]
  })
}

// ─── Sort order (painter's algorithm) ────────────────────────────────────────

/** Depth from camera (1,1,1) — higher value = further from camera = draw first */
function voxelDepth(x: number, y: number, z: number): number {
  return -(x + y + z)
}

// ─── Main renderer ───────────────────────────────────────────────────────────

export function renderVoxelSVG(
  voxels: Voxel[],
  options: SVGRendererOptions = {},
): string {
  const {
    width = 512,
    height = 512,
    background = "#29364a",
    padding = 0.15,
    groundGlow = true,
  } = options

  if (voxels.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${background}"/></svg>`
  }

  const occ = buildOccupancySet(voxels)

  // Compute model center depth for perspective centering
  let sumX = 0, sumY = 0, sumZ = 0
  for (const v of voxels) { sumX += v.x + 0.5; sumY += v.y + 0.5; sumZ += v.z + 0.5 }
  const n = voxels.length
  const centerDepth = depthOf(sumX / n, sumY / n, sumZ / n)

  // Collect visible faces with sort depth
  type Face = {
    voxel: Voxel
    face: "top" | "right" | "left"
    depth: number
  }

  const faces: Face[] = []

  for (const v of voxels) {
    for (const face of ["top", "right", "left"] as const) {
      if (isFaceVisible(occ, v.x, v.y, v.z, face)) {
        // Face-specific depth tweak: top faces draw after side faces at same depth
        const faceBonus = face === "top" ? 0.3 : face === "right" ? 0.1 : 0
        faces.push({
          voxel: v,
          face,
          depth: voxelDepth(v.x, v.y, v.z) - faceBonus,
        })
      }
    }
  }

  // Sort: back-to-front (higher depth = further = draw first)
  faces.sort((a, b) => b.depth - a.depth)

  // Project all face vertices with perspective and find bounds
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity

  const projected = faces.map((f) => {
    const verts3D = faceVertices3D(f.voxel.x, f.voxel.y, f.voxel.z, f.face)
    const verts = projectWithPerspective(verts3D, centerDepth)
    for (const [px, py] of verts) {
      if (px < minX) minX = px
      if (px > maxX) maxX = px
      if (py < minY) minY = py
      if (py > maxY) maxY = py
    }
    return { ...f, verts }
  })

  // Compute view transform: fit model into the SVG with padding
  const modelW = maxX - minX
  const modelH = maxY - minY
  const padPx = Math.min(width, height) * padding
  const availW = width - 2 * padPx
  const availH = height - 2 * padPx
  const scale = Math.min(availW / modelW, availH / modelH)
  const cx = width / 2
  const cy = height / 2
  const modelCX = (minX + maxX) / 2
  const modelCY = (minY + maxY) / 2

  const tx = (sx: number) => cx + (sx - modelCX) * scale
  const ty = (sy: number) => cy + (sy - modelCY) * scale

  // Build SVG
  const lines: string[] = []
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">`)

  // Background gradient
  lines.push(`<defs>`)
  lines.push(`<radialGradient id="bg"><stop offset="0%" stop-color="#3d5068"/><stop offset="100%" stop-color="${background}"/></radialGradient>`)
  if (groundGlow) {
    lines.push(`<radialGradient id="glow"><stop offset="0%" stop-color="#5a7090" stop-opacity="0.25"/><stop offset="100%" stop-color="#5a7090" stop-opacity="0"/></radialGradient>`)
  }
  lines.push(`</defs>`)
  lines.push(`<rect width="${width}" height="${height}" fill="url(#bg)"/>`)

  // Ground glow
  if (groundGlow) {
    const glowCX = cx
    const glowCY = ty(maxY) + 8
    const glowRX = (maxX - minX) * scale * 0.6
    const glowRY = 20
    lines.push(`<ellipse cx="${r2(glowCX)}" cy="${r2(glowCY)}" rx="${r2(glowRX)}" ry="${r2(glowRY)}" fill="url(#glow)"/>`)
  }

  // Render faces with beveled edges
  const BEVEL = 0.06 // inset fraction (0-1) — how much to shrink each face for the gap
  const BEVEL_HIGHLIGHT = 0.25 // how much brighter the top-left bevel edge is
  const BEVEL_SHADOW = 0.30 // how much darker the bottom-right bevel edge is

  for (const f of projected) {
    const baseHex = BUIDL_PALETTE[f.voxel.colourIndex]?.hex ?? "#F0F0F0"

    let brightness: number
    switch (f.face) {
      case "top":   brightness = BRIGHTNESS_TOP; break
      case "right": brightness = BRIGHTNESS_RIGHT; break
      case "left":  brightness = BRIGHTNESS_LEFT; break
    }

    const fill = applyBrightness(baseHex, brightness)

    // Compute face center for insetting
    const fcx = f.verts.reduce((s, v) => s + v[0], 0) / f.verts.length
    const fcy = f.verts.reduce((s, v) => s + v[1], 0) / f.verts.length

    // Inset vertices toward center
    const inset = f.verts.map(([sx, sy]) => [
      sx + (fcx - sx) * BEVEL,
      sy + (fcy - sy) * BEVEL,
    ] as [number, number])

    // 1. Draw bevel shadow (dark border behind the face — fills the gap)
    const bevelDark = darken(fill, BEVEL_SHADOW)
    const outerPts = f.verts
      .map(([sx, sy]) => `${r2(tx(sx))},${r2(ty(sy))}`)
      .join(" ")
    lines.push(`<polygon points="${outerPts}" fill="${bevelDark}" stroke="none"/>`)

    // 2. Draw the main face (inset)
    const innerPts = inset
      .map(([sx, sy]) => `${r2(tx(sx))},${r2(ty(sy))}`)
      .join(" ")
    lines.push(`<polygon points="${innerPts}" fill="${fill}" stroke="none"/>`)

    // 3. Draw highlight edges (top and left edges of each face catch the light)
    const highlight = lighten(fill, BEVEL_HIGHLIGHT)
    // Edge 0→1 is the "top" edge of the face, edge 3→0 is the "left" edge
    // These are the edges that would catch light from above-left
    const bevelW = Math.max(0.8, scale * BEVEL * 0.4)
    // Top edge highlight
    lines.push(`<line x1="${r2(tx(inset[0][0]))}" y1="${r2(ty(inset[0][1]))}" x2="${r2(tx(inset[1][0]))}" y2="${r2(ty(inset[1][1]))}" stroke="${highlight}" stroke-width="${r2(bevelW)}" stroke-linecap="round"/>`)
    // Left edge highlight (for top faces) or top edge (for side faces)
    if (f.face === "top") {
      lines.push(`<line x1="${r2(tx(inset[3][0]))}" y1="${r2(ty(inset[3][1]))}" x2="${r2(tx(inset[0][0]))}" y2="${r2(ty(inset[0][1]))}" stroke="${highlight}" stroke-width="${r2(bevelW)}" stroke-linecap="round"/>`)
    }
  }

  lines.push(`</svg>`)
  return lines.join("\n")
}

/** Round to 2 decimal places for compact SVG output */
function r2(n: number): string {
  return (Math.round(n * 100) / 100).toString()
}

// ─── Geometry decoder (standalone, no ethers dependency) ─────────────────────

/** Decode 3-bit packed voxel bytes into Voxel[] */
export function decodeGeometryBytes(
  hex: string,
): { bboxX: number; bboxY: number; bboxZ: number; voxels: Voxel[] } | null {
  const raw = hex.startsWith("0x") ? hex.slice(2) : hex
  if (raw.length < 10) return null

  const bytes = new Uint8Array(raw.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(raw.slice(i * 2, i * 2 + 2), 16)
  }

  if (bytes[0] !== 1 && bytes[0] !== 2) return null

  const bboxX = bytes[1], bboxY = bytes[2], bboxZ = bytes[3]
  const total = bboxX * bboxY * bboxZ
  const voxels: Voxel[] = []

  for (let i = 0; i < total; i++) {
    const bitOff = (i * 3) % 8
    const byteIdx = Math.floor((i * 3) / 8)
    let ci = (bytes[4 + byteIdx] >> bitOff) & 0x07
    if (bitOff > 5 && 4 + byteIdx + 1 < bytes.length) {
      ci |= (bytes[4 + byteIdx + 1] << (8 - bitOff)) & 0x07
    }
    if (ci > 0) {
      const z = Math.floor(i / (bboxX * bboxY))
      const y = Math.floor((i % (bboxX * bboxY)) / bboxX)
      const x = i % bboxX
      voxels.push({ x, y, z, colourIndex: ci })
    }
  }

  return { bboxX, bboxY, bboxZ, voxels }
}

// ─── Convenience: Brick[] → Voxel[] ─────────────────────────────────────────

/** Convert app Brick format to Voxel format for the renderer */
export function bricksToVoxels(
  bricks: Array<{ color?: string; position: [number, number, number]; width?: number; depth?: number }>,
): Voxel[] {
  const voxels: Voxel[] = []
  for (const b of bricks) {
    const w = b.width ?? 1
    const d = b.depth ?? 1
    // Find closest palette match for the colour
    const ci = colourToIndex(b.color ?? "#F0F0F0")
    for (let dx = 0; dx < w; dx++) {
      for (let dz = 0; dz < d; dz++) {
        voxels.push({
          x: Math.round(b.position[0]) + dx,
          y: Math.round(b.position[1]),
          z: Math.round(b.position[2]) + dz,
          colourIndex: ci,
        })
      }
    }
  }
  return voxels
}

function colourToIndex(hex: string): number {
  const target = hex.toLowerCase().replace("#", "")
  let bestIdx = 1, bestDist = Infinity
  for (let i = 1; i < BUIDL_PALETTE.length; i++) {
    const p = BUIDL_PALETTE[i].hex.toLowerCase().replace("#", "")
    const dr = parseInt(target.slice(0, 2), 16) - parseInt(p.slice(0, 2), 16)
    const dg = parseInt(target.slice(2, 4), 16) - parseInt(p.slice(2, 4), 16)
    const db = parseInt(target.slice(4, 6), 16) - parseInt(p.slice(4, 6), 16)
    const dist = dr * dr + dg * dg + db * db
    if (dist < bestDist) { bestDist = dist; bestIdx = i }
  }
  return bestIdx
}
