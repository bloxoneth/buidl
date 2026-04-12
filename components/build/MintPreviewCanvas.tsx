"use client"

import { useRef, useEffect, useMemo } from "react"
import { Canvas, useThree } from "@react-three/fiber"
import { OrbitControls } from "@react-three/drei"
import type { Brick } from "@/lib/types"
import { Button } from "@/components/ui/button"

const BRICK_HEIGHT = 1.0

function BrickMesh({ brick }: { brick: Brick }) {
  const studCount = Math.floor(brick.width) * Math.floor(brick.depth)
  const studs = []
  for (let i = 0; i < Math.floor(brick.width); i++) {
    for (let j = 0; j < Math.floor(brick.depth); j++) {
      studs.push([i - brick.width / 2 + 0.5, BRICK_HEIGHT / 2 + 0.025, j - brick.depth / 2 + 0.5])
    }
  }

  return (
    <group position={brick.position}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[brick.width, BRICK_HEIGHT, brick.depth]} />
        <meshStandardMaterial color={brick.color} roughness={0.5} metalness={0.05} />
      </mesh>
      {studs.map((pos, idx) => (
        <mesh key={idx} position={pos as [number, number, number]} castShadow>
          <sphereGeometry args={[0.155, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color={brick.color} roughness={0.5} metalness={0.05} />
        </mesh>
      ))}
    </group>
  )
}

function Platform({ width, depth }: { width: number; depth: number }) {
  return (
    <group position={[0, -0.05, 0]}>
      <mesh receiveShadow>
        <boxGeometry args={[width, 0.1, depth]} />
        <meshStandardMaterial color="#e0e0e0" transparent opacity={0.3} roughness={0.1} metalness={0.9} />
      </mesh>
    </group>
  )
}

function Scene({ bricks, baseWidth, baseDepth }: { bricks: Brick[]; baseWidth: number; baseDepth: number }) {
  const { camera } = useThree()

  useEffect(() => {
    if (bricks.length > 0) {
      // Calculate bounds
      let minX = Number.POSITIVE_INFINITY,
        maxX = Number.NEGATIVE_INFINITY
      let minY = Number.POSITIVE_INFINITY,
        maxY = Number.NEGATIVE_INFINITY
      let minZ = Number.POSITIVE_INFINITY,
        maxZ = Number.NEGATIVE_INFINITY

      bricks.forEach((brick) => {
        const [x, y, z] = brick.position
        minX = Math.min(minX, x - brick.width / 2)
        maxX = Math.max(maxX, x + brick.width / 2)
        minY = Math.min(minY, y - BRICK_HEIGHT / 2)
        maxY = Math.max(maxY, y + BRICK_HEIGHT / 2)
        minZ = Math.min(minZ, z - brick.depth / 2)
        maxZ = Math.max(maxZ, z + brick.depth / 2)
      })

      const centerX = (minX + maxX) / 2
      const centerY = (minY + maxY) / 2
      const centerZ = (minZ + maxZ) / 2

      const sizeX = maxX - minX
      const sizeY = maxY - minY
      const sizeZ = maxZ - minZ

      const maxDim = Math.max(sizeX, sizeY, sizeZ)
      const distance = Math.max(15, maxDim * 2)

      camera.position.set(distance * 0.6, distance * 0.6, distance * 0.6)
      camera.lookAt(centerX, centerY, centerZ)
    }
  }, [bricks, camera])

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 10, 5]} intensity={0.8} castShadow />
      <pointLight position={[-10, -10, -5]} intensity={0.3} />

      <Platform width={baseWidth} depth={baseDepth} />

      {bricks.map((brick, index) => (
        <BrickMesh key={index} brick={brick} />
      ))}
    </>
  )
}

interface MintPreviewCanvasProps {
  bricks: Brick[]
  baseWidth: number
  baseDepth: number
  onScreenshotCaptured: (dataUrl: string) => void
  screenshotDataUrl: string | null
}

export function MintPreviewCanvas({
  bricks,
  baseWidth,
  baseDepth,
  onScreenshotCaptured,
  screenshotDataUrl,
}: MintPreviewCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const autoCaptureKey = useMemo(() => {
    const brickKey = bricks
      .map((b) => `${b.id}:${b.width}x${b.depth}@${b.position.join(",")}:${b.color}`)
      .join("|")
    return `${baseWidth}x${baseDepth}:${brickKey}`
  }, [bricks, baseWidth, baseDepth])
  const lastAutoCaptureKey = useRef<string>("")

  const handleCaptureScreenshot = () => {
    if (canvasRef.current) {
      const dataUrl = canvasRef.current.toDataURL("image/png")
      onScreenshotCaptured(dataUrl)
    }
  }

  const handleDownloadScreenshot = () => {
    if (screenshotDataUrl) {
      const link = document.createElement("a")
      link.href = screenshotDataUrl
      link.download = `buidl-build-${Date.now()}.png`
      link.click()
    }
  }

  useEffect(() => {
    if (!canvasRef.current) return
    if (lastAutoCaptureKey.current === autoCaptureKey) return
    const timer = setTimeout(() => {
      if (!canvasRef.current) return
      try {
        const dataUrl = canvasRef.current.toDataURL("image/png")
        onScreenshotCaptured(dataUrl)
        lastAutoCaptureKey.current = autoCaptureKey
      } catch {
        // User can still capture manually.
      }
    }, 600)
    return () => clearTimeout(timer)
  }, [autoCaptureKey, onScreenshotCaptured])

  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold text-white">3D Preview</h3>
      <div className="relative aspect-square bg-gradient-to-br from-gray-100 to-gray-200 rounded-lg overflow-hidden">
        <Canvas
          ref={canvasRef}
          shadows
          camera={{ position: [15, 15, 15], fov: 50 }}
          gl={{ preserveDrawingBuffer: true }}
        >
          <Scene bricks={bricks} baseWidth={baseWidth} baseDepth={baseDepth} />
          <OrbitControls enablePan={false} dampingFactor={0.05} />
        </Canvas>

        <Button
          onClick={handleCaptureScreenshot}
          size="sm"
          className="absolute bottom-3 right-3 bg-black text-white text-xs hover:bg-gray-800 rounded-full"
        >
          📸 Capture Screenshot
        </Button>
      </div>

      <p className="text-xs text-gray-400 text-center">💡 Click and drag to rotate, scroll to zoom</p>

      {screenshotDataUrl && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-white">Captured Screenshot</h4>
          <div className="relative">
            <img
              src={screenshotDataUrl || "/placeholder.svg"}
              alt="Build screenshot"
              className="w-full h-32 object-cover rounded-lg border border-gray-700"
            />
            <Button
              onClick={handleDownloadScreenshot}
              size="sm"
              className="absolute bottom-2 right-2 bg-black text-white text-xs hover:bg-gray-800 rounded-full"
            >
              💾 Download
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
