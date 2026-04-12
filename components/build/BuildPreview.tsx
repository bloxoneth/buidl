"use client"

import { Canvas } from "@react-three/fiber"
import { OrbitControls } from "@react-three/drei"
import type { Brick } from "@/lib/types"

interface BuildPreviewProps {
  bricks: Brick[]
}

function BuildGeometry({ bricks }: { bricks: Brick[] }) {
  return (
    <>
      {bricks.map((brick, index) => {
        const [x, y, z] = brick.position
        return (
          <mesh key={index} position={[x, y, z]}>
            <boxGeometry args={[brick.width, 1, brick.depth]} />
            <meshStandardMaterial color={brick.color} />
          </mesh>
        )
      })}
    </>
  )
}

export function BuildPreview({ bricks }: BuildPreviewProps) {
  if (!bricks || bricks.length === 0) {
    return (
      <div className="w-full h-full min-h-[8rem] bg-[hsl(var(--buidl-surface-elevated))] rounded flex items-center justify-center text-[hsl(var(--buidl-text-tertiary))] text-sm">
        No geometry
      </div>
    )
  }

  // Calculate camera position based on build bounds
  const positions = bricks.map(b => b.position)
  const maxX = Math.max(...positions.map(p => p[0])) + 2
  const maxY = Math.max(...positions.map(p => p[1])) + 2
  const maxZ = Math.max(...positions.map(p => p[2])) + 2
  const maxDim = Math.max(maxX, maxY, maxZ, 5)
  const cameraDistance = maxDim * 1.5

  return (
    <div className="w-full h-full min-h-[8rem] bg-[hsl(var(--buidl-surface-elevated))] rounded overflow-hidden">
      <Canvas camera={{ position: [cameraDistance, cameraDistance, cameraDistance], fov: 50 }}>
        <OrbitControls enableZoom={false} enablePan={false} autoRotate autoRotateSpeed={2} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[10, 10, 5]} intensity={0.8} />
        <BuildGeometry bricks={bricks} />
      </Canvas>
    </div>
  )
}
