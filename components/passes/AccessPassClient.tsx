"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ethers } from "ethers"
import { useMetaMask } from "@/contexts/metamask-context"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { useToast } from "@/components/ui/use-toast"
import { getAccessPassState, mintAccessPass, ACCESS_PASS_ADDRESS } from "@/lib/contracts/access-pass"

export function AccessPassClient() {
  const { account, isConnected, connect } = useMetaMask()
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [quantity, setQuantity] = useState(1)
  const [state, setState] = useState<{
    configured: boolean
    saleActive: boolean
    totalMinted: bigint
    maxSupply: bigint
    passPrice: bigint
    bloxReward: bigint
    passBalance: bigint
    claimStart: bigint
  }>({
    configured: ACCESS_PASS_ADDRESS !== "0x0000000000000000000000000000000000000000",
    saleActive: false,
    totalMinted: 0n,
    maxSupply: 1000n,
    passPrice: ethers.parseEther("0.05"),
    bloxReward: 10_000n * 10n ** 18n,
    passBalance: 0n,
    claimStart: 0n,
  })

  const refresh = useCallback(async () => {
    if (typeof window === "undefined" || !(window as any).ethereum) return
    const provider = new ethers.BrowserProvider((window as any).ethereum)
    const next = await getAccessPassState(provider, account)
    setState(next)
  }, [account])

  useEffect(() => {
    refresh().catch(() => {})
  }, [refresh])

  const totalEth = useMemo(() => state.passPrice * BigInt(quantity), [state.passPrice, quantity])

  const onMint = useCallback(async () => {
    try {
      if (!isConnected) {
        await connect()
        return
      }
      if (!state.configured) {
        toast({
          title: "Contract Not Configured",
          description: "Set NEXT_PUBLIC_ACCESS_PASS_ADDRESS first.",
          variant: "destructive",
        })
        return
      }
      if (!state.saleActive) {
        toast({ title: "Sale Inactive", description: "Minting is not open yet.", variant: "destructive" })
        return
      }
      setLoading(true)
      const provider = new ethers.BrowserProvider((window as any).ethereum)
      const tx = await mintAccessPass(provider, quantity)
      toast({ title: "Mint Submitted", description: tx.hash })
      await tx.wait()
      toast({ title: "Mint Confirmed", description: `Minted ${quantity} pass(es).` })
      await refresh()
    } catch (error: any) {
      toast({
        title: "Mint Failed",
        description: error?.shortMessage || error?.message || "Transaction reverted",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }, [connect, isConnected, quantity, refresh, state.configured, state.saleActive, toast])

  return (
    <div className="grid lg:grid-cols-2 gap-8 items-start">
      <Card className="p-4 md:p-6 bg-[hsl(var(--buidl-surface))] border-[hsl(var(--buidl-border))]">
        <img
          src="/buidl-boxes.svg"
          alt="BUIDL and BUIDL boxes"
          className="w-full rounded-md border border-[hsl(var(--buidl-border))] object-cover"
        />
        <p className="mt-3 text-xs text-[hsl(var(--buidl-text-tertiary))]">
          Replace <code>/public/buidl-boxes.svg</code> with your production artwork when ready.
        </p>
      </Card>

      <Card className="p-6 md:p-8 bg-[hsl(var(--buidl-surface))] border-[hsl(var(--buidl-border))]">
        <h2 className="text-3xl font-heading font-bold text-[hsl(var(--buidl-text-primary))] mb-2">
          BUIDL Access Pass
        </h2>
        <p className="text-[hsl(var(--buidl-text-secondary))] mb-6">
          Mint pass NFTs for <strong>0.05 ETH</strong>. Each pass can claim <strong>10,000 BLOX</strong> once,
          after the claim window opens. Target supply is <strong>1000</strong>.
        </p>

        <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
          <div className="rounded-md border border-[hsl(var(--buidl-border))] p-3">
            <p className="text-[hsl(var(--buidl-text-tertiary))]">Minted</p>
            <p className="font-semibold">{state.totalMinted.toString()} / {state.maxSupply.toString()}</p>
          </div>
          <div className="rounded-md border border-[hsl(var(--buidl-border))] p-3">
            <p className="text-[hsl(var(--buidl-text-tertiary))]">Sale Status</p>
            <p className="font-semibold">{state.saleActive ? "Active" : "Inactive"}</p>
          </div>
          <div className="rounded-md border border-[hsl(var(--buidl-border))] p-3">
            <p className="text-[hsl(var(--buidl-text-tertiary))]">Price</p>
            <p className="font-semibold">{ethers.formatEther(state.passPrice)} ETH</p>
          </div>
          <div className="rounded-md border border-[hsl(var(--buidl-border))] p-3">
            <p className="text-[hsl(var(--buidl-text-tertiary))]">Reward</p>
            <p className="font-semibold">{Number(ethers.formatEther(state.bloxReward)).toLocaleString()} BLOX</p>
          </div>
        </div>
        <p className="text-xs text-[hsl(var(--buidl-text-tertiary))] mb-6">
          Claim start: {state.claimStart > 0n ? new Date(Number(state.claimStart) * 1000).toLocaleString() : "Not set yet"}
        </p>

        <div className="mb-6">
          <label className="block text-sm text-[hsl(var(--buidl-text-tertiary))] mb-2">Quantity</label>
          <input
            type="number"
            min={1}
            max={20}
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, Math.min(20, Number(e.target.value || "1"))))}
            className="w-full rounded-md border border-[hsl(var(--buidl-border))] bg-background px-3 py-2"
          />
          <p className="text-xs text-[hsl(var(--buidl-text-tertiary))] mt-2">
            Total: {ethers.formatEther(totalEth)} ETH
          </p>
          {isConnected && (
            <p className="text-xs text-[hsl(var(--buidl-text-tertiary))] mt-1">
              Your pass balance: {state.passBalance.toString()}
            </p>
          )}
        </div>

        <Button
          onClick={onMint}
          disabled={loading || !state.configured}
          className="w-full bg-[hsl(var(--buidl-blue))] text-white hover:bg-[hsl(var(--buidl-blue))]/90"
        >
          {loading ? "Minting..." : isConnected ? "Mint Access Pass" : "Connect Wallet"}
        </Button>

        <p className="mt-4 text-xs text-[hsl(var(--buidl-text-tertiary))] break-all">
          Contract: {ACCESS_PASS_ADDRESS}
        </p>
      </Card>
    </div>
  )
}
