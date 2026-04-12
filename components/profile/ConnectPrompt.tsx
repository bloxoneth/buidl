"use client"

import { useMetaMask } from "@/contexts/metamask-context"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Wallet, User } from "lucide-react"

export default function ConnectPrompt() {
  const { connect } = useMetaMask()

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <Card className="max-w-md w-full mx-4">
        <CardHeader className="text-center">
          <div className="mx-auto w-16 h-16 rounded-full bg-gradient-to-br from-[hsl(var(--buidl-yellow))] to-[hsl(var(--buidl-accent-cyan))] flex items-center justify-center mb-4">
            <User className="h-8 w-8 text-black" />
          </div>
          <CardTitle className="text-xl">View Your Profile</CardTitle>
          <CardDescription>
            Connect your wallet to view and manage your builder profile
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            onClick={connect}
            className="w-full bg-[hsl(var(--buidl-green))] text-black hover:bg-[hsl(var(--buidl-green))]/90 font-semibold py-6"
          >
            <Wallet className="h-5 w-5 mr-2" />
            Connect Wallet
          </Button>
          <p className="text-xs text-center text-[hsl(var(--buidl-text-tertiary))]">
            Your profile is public and tied to your wallet address
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
