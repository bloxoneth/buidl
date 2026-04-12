import { ethers } from 'ethers'
import type { Brick } from './types'
import type { ColourIndex } from './palette'

export interface BoundingBox {
  x: number // width
  y: number // height
  z: number // depth
}

export interface EncodedGeometry {
  bytes: Uint8Array // full geometry bytes including header
  hash: string // keccak256 of shape-only bytes (colour stripped)
  boundingBox: BoundingBox
  voxelCount: number // number of filled voxels
  mass: number // = voxelCount (1 voxel = 1 BLOX)
}

// Header: [version=1, bboxX, bboxY, bboxZ] — 4 bytes
// Voxel data: 3 bits per voxel position, packed into bytes
// 8 voxels per 3 bytes (24 bits), no padding
export function encodeBricks(bricks: Brick[]): EncodedGeometry {
  // 1. Expand all bricks to individual voxels
  const positions = bricks.flatMap(b => expandBrickToVoxels(b))

  if (positions.length === 0) {
    throw new Error('No voxels to encode')
  }

  // 2. Find bounding box
  const maxX = Math.max(...positions.map(p => p[0])) + 1
  const maxY = Math.max(...positions.map(p => p[1])) + 1
  const maxZ = Math.max(...positions.map(p => p[2])) + 1

  const bboxX = Math.min(maxX, 255)
  const bboxY = Math.min(maxY, 255)
  const bboxZ = Math.min(maxZ, 255)

  const totalVoxels = bboxX * bboxY * bboxZ

  // 3 bits per voxel, pack 8 voxels per 3 bytes
  const dataBytes = Math.ceil((totalVoxels * 3) / 8)
  const voxelData = new Uint8Array(dataBytes)

  // 3. Fill voxel data
  for (const [x, y, z, colourIdx] of positions) {
    const voxelIndex = x + y * bboxX + z * bboxX * bboxY
    const byteIdx = Math.floor((voxelIndex * 3) / 8)
    const bitOff = (voxelIndex * 3) % 8

    voxelData[byteIdx] |= (colourIdx & 0x07) << bitOff

    if (bitOff > 5) {
      voxelData[byteIdx + 1] |= (colourIdx >> (8 - bitOff)) & 0x07
    }
  }

  // 4. Prepend header
  const header = new Uint8Array([1, bboxX, bboxY, bboxZ])
  const fullBytes = new Uint8Array(4 + dataBytes)
  fullBytes.set(header)
  fullBytes.set(voxelData, 4)

  // 5. Compute geometry hash (shape only — strip colour bits)
  const shapeOnly = stripColour(fullBytes)
  const hash = ethers.keccak256(canonicalise(shapeOnly))

  return {
    bytes: fullBytes,
    hash,
    boundingBox: { x: bboxX, y: bboxY, z: bboxZ },
    voxelCount: positions.length,
    mass: positions.length,
  }
}

// Expand a multi-voxel brick to individual voxel positions with colour
function expandBrickToVoxels(b: Brick): [number, number, number, number][] {
  const voxels: [number, number, number, number][] = []
  const colourIdx = (b as any).colourIndex ?? 1

  const baseX = Math.round(b.position[0])
  const baseY = Math.round(b.position[1])
  const baseZ = Math.round(b.position[2])

  for (let dx = 0; dx < b.width; dx++) {
    for (let dz = 0; dz < b.depth; dz++) {
      voxels.push([baseX + dx, baseY, baseZ + dz, colourIdx])
    }
  }

  return voxels
}

// Strip colour bits to get shape-only data for hashing
function stripColour(bytes: Uint8Array): Uint8Array {
  const header = bytes.slice(0, 4)
  const [, bx, by, bz] = header
  const totalVoxels = bx * by * bz
  const shape = new Uint8Array(Math.ceil(totalVoxels / 8))

  // Extract presence bit (any non-zero colour = filled)
  for (let i = 0; i < totalVoxels; i++) {
    const byteIdx = Math.floor((i * 3) / 8)
    const bitOff = (i * 3) % 8

    let colourIdx = (bytes[4 + byteIdx] >> bitOff) & 0x07
    if (bitOff > 5) colourIdx |= (bytes[4 + byteIdx + 1] << (8 - bitOff)) & 0x07

    if (colourIdx !== 0) shape[Math.floor(i / 8)] |= (1 << (i % 8))
  }

  const result = new Uint8Array(4 + shape.length)
  result.set(header)
  result.set(shape, 4)
  return result
}

// Canonical normalisation — translate to origin, pick lexicographically smallest rotation
// This must match the Solidity canonical normalisation pipeline exactly
function canonicalise(shapeBytes: Uint8Array): Uint8Array {
  // For MVP: identity — no rotation canonicalisation yet
  // Full 4-rotation canonicalisation required for hash consistency with contract
  // TODO: implement full canonicalisation matching contract pipeline
  return shapeBytes
}
