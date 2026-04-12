"use client"

import { useState, useCallback } from "react"
import { ethers } from "ethers"
import { useMetaMask } from "@/contexts/metamask-context"
import { CONTRACTS, BUILD_KIND, getBuildState, burnBuildNFT, canBurn } from "@/lib/contracts/buidl-contracts"

export type BurnStep = "idle" | "checking" | "burning" | "success" | "error"

export interface UseBurnBuildOptions {
  onSuccess?: (txHash: string) => void
  onError?: (error: Error) => void
}

export function useBurnBuild(options: UseBurnBuildOptions = {}) {
  const { account, isConnected, chainId } = useMetaMask()
  const [step, setStep] = useState<BurnStep>("idle")
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)

  const isCorrectChain = chainId === CONTRACTS.BASE_SEPOLIA_CHAIN_ID

  const getProvider = useCallback(() => {
    if (typeof window === "undefined") return null
    const ethereum = (window as any).ethereum
    if (!ethereum) return null
    return new ethers.BrowserProvider(ethereum)
  }, [])

  const burn = useCallback(
    async (tokenId: bigint | string) => {
      setStep("checking")
      setError(null)
      setTxHash(null)

      try {
        if (!account || !isConnected) {
          throw new Error("Please connect your wallet")
        }
        if (!isCorrectChain) {
          throw new Error("Please switch to Base Sepolia network")
        }

        const provider = getProvider()
        if (!provider) throw new Error("No provider available")

        const tokenIdBigInt = typeof tokenId === "string" ? BigInt(tokenId) : tokenId
        const tokenIdString = tokenIdBigInt.toString()

        // Check if this is a build (not a brick) - only builds can be burned
        const state = await getBuildState(provider, tokenIdBigInt)

        if (state.kind === BUILD_KIND.BRICK) {
          throw new Error("Bricks cannot be burned. Only composite builds can be burned.")
        }

        if (!canBurn(state.kind)) {
          throw new Error("This NFT cannot be burned")
        }

        // Execute burn
        setStep("burning")
        const burnTx = await burnBuildNFT(provider, tokenIdString)
        setTxHash(burnTx.hash)

        await burnTx.wait()

        setStep("success")
        options.onSuccess?.(burnTx.hash)

        return burnTx.hash
      } catch (err: any) {
        const message = err.code === 4001 ? "Transaction rejected" : err.message || "Burn failed"
        setError(message)
        setStep("error")
        options.onError?.(new Error(message))
        throw err
      }
    },
    [account, isConnected, isCorrectChain, getProvider, options],
  )

  const reset = useCallback(() => {
    setStep("idle")
    setError(null)
    setTxHash(null)
  }, [])

  return {
    step,
    error,
    txHash,
    isLoading: step === "checking" || step === "burning",
    isSuccess: step === "success",
    isError: step === "error",
    burn,
    reset,
  }
}
