"use client"

import { useEffect, useState, useRef } from "react"
import { BuildPreview } from "@/components/build/BuildPreview"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { calculateTotalBlox } from "@/lib/brick-utils"
import type { Brick } from "@/lib/types"

interface BuildData {
  key: string
  name?: string
  tokenId?: string
  owner?: string
  creator?: string
  geoHash?: string
  bricks?: string | Brick[]
  createdAt?: string
  composition?: string | Record<string, { count: number; name: string }>
}

export default function BuildDataPage() {
  const [builds, setBuilds] = useState<BuildData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [previewBuild, setPreviewBuild] = useState<BuildData | null>(null)
  const [fixing, setFixing] = useState(false)
  const [fixResult, setFixResult] = useState<string | null>(null)
  const hasFetched = useRef(false)

  useEffect(() => {
    if (hasFetched.current) return

    async function fetchBuilds() {
      try {
        console.log("[v0] Fetching builds data...")
        hasFetched.current = true
        const response = await fetch("/api/admin/builds-data")
        const data = await response.json()
        console.log("[v0] Received data:", data)
        console.log("[v0] Number of builds in response:", data.builds?.length)
        console.log(
          "[v0] Builds with tokenId 10:",
          data.builds?.filter((b: BuildData) => b.tokenId === "10"),
        )
        console.log(
          "[v0] Builds with tokenId 13:",
          data.builds?.filter((b: BuildData) => b.tokenId === "13"),
        )

        if (data.error) {
          setError(data.error)
        } else {
          // Just use the builds array directly since each should already be unique by buildId
          setBuilds(data.builds || [])
        }
      } catch (error) {
        console.error("[v0] Failed to fetch builds:", error)
        setError("Failed to load build data")
      } finally {
        setLoading(false)
      }
    }
    fetchBuilds()
  }, [])

  const handleFixDuplicates = async () => {
    if (!confirm("This will create new build IDs for duplicate token mappings. Continue?")) {
      return
    }

    setFixing(true)
    setFixResult(null)

    try {
      console.log("[v0] Calling fix-duplicate-builds endpoint...")
      const response = await fetch("/api/admin/fix-duplicate-builds", {
        method: "POST",
      })
      const data = await response.json()

      if (data.success) {
        console.log("[v0] Fix successful:", data)
        setFixResult(`✓ Success: ${data.message}. Fixed ${data.fixed?.length || 0} mappings.`)

        // Refresh the builds list
        setTimeout(() => {
          window.location.reload()
        }, 2000)
      } else {
        setFixResult(`✗ Error: ${data.error || "Unknown error"}`)
      }
    } catch (error) {
      console.error("[v0] Failed to fix duplicates:", error)
      setFixResult(`✗ Error: ${error instanceof Error ? error.message : "Failed to fix duplicates"}`)
    } finally {
      setFixing(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-8">
        <div className="max-w-[1400px] mx-auto">
          <h1 className="text-3xl font-bold mb-2">Build Data</h1>
          <p className="text-muted-foreground mb-8">Loading build data from Redis...</p>

          <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
            <div className="h-full bg-blue-500 animate-pulse" style={{ width: "60%" }}></div>
          </div>
          <p className="text-sm text-muted-foreground mt-4">This may take a few seconds...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background p-8">
        <div className="max-w-[1400px] mx-auto">
          <h1 className="text-3xl font-bold mb-2 text-red-500">Error</h1>
          <p className="text-muted-foreground">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-[1400px] mx-auto">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold mb-2">Build Data</h1>
            <p className="text-muted-foreground">All builds from Redis database ({builds.length} total)</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <button
              onClick={handleFixDuplicates}
              disabled={fixing}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:opacity-50 text-white rounded text-sm font-medium transition-colors"
            >
              {fixing ? "Fixing..." : "Fix Duplicate Builds"}
            </button>
            {fixResult && (
              <p className={`text-sm ${fixResult.startsWith("✓") ? "text-green-400" : "text-red-400"}`}>{fixResult}</p>
            )}
          </div>
        </div>

        <div className="border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium">Preview</th>
                  <th className="px-4 py-3 text-left text-sm font-medium">Build ID</th>
                  <th className="px-4 py-3 text-left text-sm font-medium">Name</th>
                  <th className="px-4 py-3 text-left text-sm font-medium">Token ID</th>
                  <th className="px-4 py-3 text-left text-sm font-medium">Creator</th>
                  <th className="px-4 py-3 text-left text-sm font-medium">Owner</th>
                  <th className="px-4 py-3 text-left text-sm font-medium">Geo Hash</th>
                  <th className="px-4 py-3 text-left text-sm font-medium">BLOX Volume</th>
                  <th className="px-4 py-3 text-left text-sm font-medium">Created</th>
                  <th className="px-4 py-3 text-left text-sm font-medium">Bricks</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {builds.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">
                      No builds found in Redis database
                    </td>
                  </tr>
                ) : (
                  builds.map((build, idx) => {
                    let brickCount = 0
                    let bloxSize = 0
                    let parsedBricks: Brick[] = []
                    try {
                      if (build.bricks) {
                        const bricksData = typeof build.bricks === "string" ? JSON.parse(build.bricks) : build.bricks
                        parsedBricks = Array.isArray(bricksData) ? bricksData : []
                        brickCount = parsedBricks.length
                        bloxSize = calculateTotalBlox(parsedBricks)
                      }
                    } catch (e) {
                      // Invalid JSON
                    }

                    return (
                      <tr key={idx} className="hover:bg-muted/50">
                        <td className="px-4 py-3 text-sm">
                          <button
                            onClick={() => setPreviewBuild(build)}
                            className="text-blue-400 hover:text-blue-300 text-xs underline"
                            disabled={brickCount === 0}
                          >
                            {brickCount > 0 ? "View" : "-"}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-sm font-mono">{build.key}</td>
                        <td className="px-4 py-3 text-sm">{build.name || "-"}</td>
                        <td className="px-4 py-3 text-sm">
                          {build.tokenId ? (
                            <span className="inline-flex items-center px-2 py-1 rounded bg-blue-500/20 text-blue-400 text-xs font-medium">
                              NFT #{build.tokenId}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm font-mono text-xs">
                          {build.creator ? `${build.creator.slice(0, 6)}...${build.creator.slice(-4)}` : "-"}
                        </td>
                        <td className="px-4 py-3 text-sm font-mono text-xs">
                          {build.owner ? `${build.owner.slice(0, 6)}...${build.owner.slice(-4)}` : "-"}
                        </td>
                        <td className="px-4 py-3 text-sm font-mono text-xs">
                          {build.geoHash ? `${build.geoHash.slice(0, 8)}...` : "-"}
                        </td>
                        <td className="px-4 py-3 text-sm font-semibold">{bloxSize || "-"}</td>
                        <td className="px-4 py-3 text-sm text-xs">
                          {build.createdAt ? new Date(Number.parseInt(build.createdAt)).toLocaleString() : "-"}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {build.bricks && (
                            <button
                              onClick={() => {
                                let parsedBricks: Brick[] = []
                                let parsedComposition: Record<string, { count: number; name: string }> = {}

                                try {
                                  if (build.bricks) {
                                    const bricksData =
                                      typeof build.bricks === "string" ? JSON.parse(build.bricks) : build.bricks
                                    parsedBricks = Array.isArray(bricksData) ? bricksData : []
                                  }
                                  if (build.composition) {
                                    parsedComposition =
                                      typeof build.composition === "string"
                                        ? JSON.parse(build.composition)
                                        : build.composition
                                  }
                                } catch (e) {
                                  console.error("[v0] Failed to parse build data:", e)
                                }

                                const minX =
                                  parsedBricks.length > 0 ? Math.min(...parsedBricks.map((b) => b.position[0])) : 0
                                const maxX =
                                  parsedBricks.length > 0
                                    ? Math.max(...parsedBricks.map((b) => b.position[0] + b.width - 1))
                                    : 0
                                const minZ =
                                  parsedBricks.length > 0 ? Math.min(...parsedBricks.map((b) => b.position[2])) : 0
                                const maxZ =
                                  parsedBricks.length > 0
                                    ? Math.max(...parsedBricks.map((b) => b.position[2] + b.depth - 1))
                                    : 0

                                const fullBuildJson = {
                                  version: "0.1",
                                  sceneType: "buidl-v0",
                                  buildId: build.key,
                                  buildHash: build.geoHash || "",
                                  composition: parsedComposition,
                                  metadata: {
                                    buildWidth: Math.floor(maxX - minX + 1),
                                    buildDepth: Math.floor(maxZ - minZ + 1),
                                    totalBricks: parsedBricks.length,
                                    totalInstances: Object.values(parsedComposition).reduce(
                                      (sum, data) => sum + data.count,
                                      0,
                                    ),
                                    nftsUsed: Object.keys(parsedComposition).length,
                                  },
                                  bricks: parsedBricks.map((brick, index) => ({
                                    id: `blox-${index}-${Date.now()}`,
                                    position: brick.position,
                                    color: brick.color,
                                    width: brick.width,
                                    depth: brick.depth,
                                  })),
                                }

                                const blob = new Blob([JSON.stringify(fullBuildJson, null, 2)], {
                                  type: "application/json",
                                })
                                const url = URL.createObjectURL(blob)
                                const a = document.createElement("a")
                                a.href = url
                                a.download = `${build.key}-build.json`
                                a.click()
                                URL.revokeObjectURL(url)
                              }}
                              className="text-blue-400 hover:text-blue-300 text-xs underline"
                            >
                              Download
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <Dialog open={!!previewBuild} onOpenChange={() => setPreviewBuild(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{previewBuild?.name || "Build Preview"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {previewBuild &&
                (() => {
                  let bricks: Brick[] = []
                  let composition: Record<string, { count: number; name: string }> = {}
                  try {
                    if (previewBuild.bricks) {
                      const parsed =
                        typeof previewBuild.bricks === "string" ? JSON.parse(previewBuild.bricks) : previewBuild.bricks
                      bricks = Array.isArray(parsed) ? parsed : []
                    }
                    if (previewBuild.composition) {
                      composition =
                        typeof previewBuild.composition === "string"
                          ? JSON.parse(previewBuild.composition)
                          : previewBuild.composition
                    }
                  } catch (e) {
                    console.error("[v0] Failed to parse bricks:", e)
                  }

                  return (
                    <>
                      <div className="h-96 bg-gray-900 rounded">
                        <BuildPreview bricks={bricks} />
                      </div>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground">Build ID:</span>
                          <div className="font-mono">{previewBuild.key}</div>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Token ID:</span>
                          <div>{previewBuild.tokenId ? `NFT #${previewBuild.tokenId}` : "-"}</div>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Creator:</span>
                          <div className="font-mono text-xs">{previewBuild.creator || "-"}</div>
                        </div>
                        <div>
                          <span className="text-muted-foreground">BLOX Volume:</span>
                          <div>{calculateTotalBlox(bricks)}</div>
                        </div>
                      </div>
                    </>
                  )
                })()}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
