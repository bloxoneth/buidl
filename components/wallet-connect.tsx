"use client"

import { Button } from "@/components/ui/button"
import { Wallet } from "lucide-react"
import { useMetaMask } from "@/contexts/metamask-context"
import { WalletDrawer } from "@/components/wallet-drawer"
import { useState } from "react"
import { useBloxBalance } from "@/lib/web3/hooks/useBloxBalance"

interface WalletConnectProps {
  variant?: "default" | "compact"
}

export function WalletConnect({ variant = "default" }: WalletConnectProps) {
  const { account, isConnected, connect } = useMetaMask()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { balance, isCorrectChain } = useBloxBalance()

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`
  }

  const handleClick = () => {
    if (isConnected) {
      setDrawerOpen(true)
    } else {
      connect()
    }
  }

  if (variant === "compact") {
    return (
      <>
        <Button
          onClick={handleClick}
          size="sm"
          className={
            isConnected
              ? "bg-[hsl(var(--buidl-surface))] text-[hsl(var(--buidl-text-primary))] border border-[hsl(var(--buidl-border))] hover:bg-[hsl(var(--buidl-surface-elevated))] hover:border-[hsl(var(--buidl-green))] transition-all"
              : "bg-[hsl(var(--buidl-green))] text-black hover:bg-[hsl(var(--buidl-green))]/90 font-semibold"
          }
        >
          {isConnected ? (
            <>
              <div className="w-2 h-2 rounded-full bg-[hsl(var(--buidl-green))] mr-2" />
              {account && (
                <span className="flex items-center gap-2">
                  {isCorrectChain && balance && (
                    <span className="text-[hsl(var(--buidl-green))] font-semibold">{balance} BLOX</span>
                  )}
                  <span className="text-[hsl(var(--buidl-text-tertiary))]">|</span>
                  {formatAddress(account)}
                </span>
              )}
            </>
          ) : (
            <>
              <Wallet className="h-4 w-4 mr-2" />
              Connect
            </>
          )}
        </Button>
        <WalletDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
      </>
    )
  }

  return (
    <>
      <Button
        onClick={handleClick}
        className={
          isConnected
            ? "w-full bg-[hsl(var(--buidl-surface))] text-[hsl(var(--buidl-text-primary))] border border-[hsl(var(--buidl-border))] hover:bg-[hsl(var(--buidl-surface-elevated))] hover:border-[hsl(var(--buidl-green))] transition-all"
            : "w-full bg-[hsl(var(--buidl-green))] text-black hover:bg-[hsl(var(--buidl-green))]/90 font-semibold"
        }
      >
        {isConnected ? (
          <>
            <div className="w-2 h-2 rounded-full bg-[hsl(var(--buidl-green))] mr-2" />
            {account && formatAddress(account)}
          </>
        ) : (
          <>
            <Wallet className="h-4 w-4 mr-2" />
            Connect Wallet
          </>
        )}
      </Button>
      <WalletDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
    </>
  )
}
