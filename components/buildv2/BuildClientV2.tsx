"use client"

import dynamic from "next/dynamic"
import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { ethers } from "ethers"
import { Button } from "@/components/ui/button"
import { useMetaMask } from "@/contexts/metamask-context"
import type { SavedBuild } from "@/lib/storage"
import { loadBuildById } from "@/lib/storage"
import type { Brick } from "@/lib/types"
import { ACCESS_PASS_REQUIRE_FOR_BUILD, getAccessPassState } from "@/lib/contracts/access-pass"

const V0BlocksV2 = dynamic(() => import("./V0BlocksV2"), { ssr: false })

const SESSION_KEY = "buidl-buildv2-session"

interface SessionState {
  bricks: Brick[]
  timestamp: number
}

export default function BuildClientV2({ loadBuildId }: { loadBuildId?: string | null }) {
  const { account, isConnected, connect } = useMetaMask()
  const [mounted, setMounted] = useState(false)
  const [loadedBuild, setLoadedBuild] = useState<SavedBuild | null>(null)
  const [sessionBricks, setSessionBricks] = useState<Brick[] | null>(null)
  const [hasPass, setHasPass] = useState(!ACCESS_PASS_REQUIRE_FOR_BUILD)
  const [checkedPass, setCheckedPass] = useState(!ACCESS_PASS_REQUIRE_FOR_BUILD)

  // Restore session or load build by ID on mount
  useEffect(() => {
    setMounted(true)
    
    // If a build ID is provided, load that build instead of session
    if (loadBuildId) {
      const build = loadBuildById(loadBuildId)
      if (build) {
        setLoadedBuild(build)
        return // Don't restore session when loading a specific build
      }
    }
    
    // Try to restore session
    try {
      const saved = sessionStorage.getItem(SESSION_KEY)
      if (saved) {
        const session: SessionState = JSON.parse(saved)
        // Only restore if less than 24 hours old
        const twentyFourHours = 24 * 60 * 60 * 1000
        if (Date.now() - session.timestamp < twentyFourHours) {
          setSessionBricks(session.bricks || [])
        } else {
          sessionStorage.removeItem(SESSION_KEY)
        }
      }
    } catch (e) {
      // Ignore storage errors
    }
  }, [loadBuildId])

  useEffect(() => {
    if (!ACCESS_PASS_REQUIRE_FOR_BUILD) return
    if (typeof window === "undefined" || !(window as any).ethereum) return
    if (!isConnected || !account) {
      setHasPass(false)
      setCheckedPass(true)
      return
    }
    const run = async () => {
      const provider = new ethers.BrowserProvider((window as any).ethereum)
      const st = await getAccessPassState(provider, account)
      setHasPass(st.passBalance > 0n)
      setCheckedPass(true)
    }
    run().catch(() => {
      setHasPass(false)
      setCheckedPass(true)
    })
  }, [account, isConnected])

  // Auto-save callback for V0BlocksV2
  const handleAutoSave = useCallback((bricks: Brick[]) => {
    try {
      const session: SessionState = {
        bricks,
        timestamp: Date.now()
      }
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
    } catch (e) {
      // Ignore storage errors
    }
  }, [])

  // Clear session when explicitly resetting
  const handleClearSession = useCallback(() => {
    sessionStorage.removeItem(SESSION_KEY)
    setLoadedBuild(null)
    setSessionBricks(null)
  }, [])

  const handleLoadBuild = (build: SavedBuild | null) => {
    if (!build) {
      setLoadedBuild(null)
      return
    }
    setLoadedBuild(build)
  }

  if (!mounted) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent" />
          <p className="mt-4 text-sm text-muted-foreground">Loading builder...</p>
        </div>
      </div>
    )
  }

  if (ACCESS_PASS_REQUIRE_FOR_BUILD && checkedPass && !hasPass) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="max-w-lg mx-auto p-6 rounded-lg border border-[hsl(var(--buidl-border))] bg-[hsl(var(--buidl-surface))] text-center">
          <h2 className="text-2xl font-heading font-bold mb-2">Access Pass Required</h2>
          <p className="text-[hsl(var(--buidl-text-secondary))] mb-6">
            You need at least 1 BUIDL Access Pass to use the builder in this phase.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            {!isConnected && (
              <Button onClick={() => connect()} className="bg-[hsl(var(--buidl-blue))] text-white">
                Connect Wallet
              </Button>
            )}
            <Button asChild variant="outline">
              <Link href="/passes">Go To Pass Mint</Link>
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // Determine initial bricks: session > loaded build > empty
  const initialBricks = sessionBricks || loadedBuild?.bricks || undefined

  return (
    <div className="h-full">
      <V0BlocksV2
        onClearSession={handleClearSession}
        initialLoadedBuild={loadedBuild}
        initialBricks={initialBricks}
        onAutoSave={handleAutoSave}
        onLoadBuild={handleLoadBuild}
      />
    </div>
  )
}
