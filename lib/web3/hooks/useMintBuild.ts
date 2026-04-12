"use client"

import { useState, useCallback } from "react"
import { ethers } from "ethers"
import { useMetaMask } from "@/contexts/metamask-context"
import {
  CONTRACTS,
  BUILD_KIND,
  getBloxBalance,
  getBloxAllowance,
  approveBlox,
  getNextTokenId,
  mintBuildNFT,
  mintBuildNFTWithParams,
  mintBuild,
  calculateBloxLock,
  addMintedHash,
  type BrickSpec,
  type PlacedComponent,
} from "@/lib/contracts/buidl-contracts"

export type MintStep =
  | "idle"
  | "checking"
  | "approving-blox"
  | "approving-licenses"
  | "minting"
  | "success"
  | "error"

export interface MintResult {
  tokenId: bigint
  txHash: string
}

export interface UseMintBuildOptions {
  onSuccess?: (result: MintResult) => void
  onError?: (error: Error) => void
}

export interface MintBrickParams {
  geometryHash: string
  spec: BrickSpec
}

export interface MintBuildParams {
  geometryHash: string
  mass: number
  kind?: number
  componentTokenIds?: bigint[]
  componentCounts?: bigint[]
  geometryData?: Uint8Array
  manifest?: PlacedComponent[]
}

export function useMintBuild(options: UseMintBuildOptions = {}) {
  const { account, isConnected, chainId } = useMetaMask()
  const [step, setStep] = useState<MintStep>("idle")
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [tokenId, setTokenId] = useState<bigint | null>(null)

  const isCorrectChain = chainId === CONTRACTS.BASE_SEPOLIA_CHAIN_ID

  const getProvider = useCallback(() => {
    if (typeof window === "undefined") return null
    const ethereum = (window as any).ethereum
    if (!ethereum) return null
    return new ethers.BrowserProvider(ethereum)
  }, [])

  const checkRequirements = useCallback(
    async (mass: number, _componentTokenIds: bigint[] = [], _componentCounts: bigint[] = []) => {
      if (!account || !isConnected) {
        throw new Error("Please connect your wallet")
      }
      if (!isCorrectChain) {
        throw new Error("Please switch to Base Sepolia network")
      }

      const provider = getProvider()
      if (!provider) {
        throw new Error("No provider available")
      }

      const requiredBlox = calculateBloxLock(mass)
      const [balance, allowance] = await Promise.all([
        getBloxBalance(provider, account),
        getBloxAllowance(provider, account, CONTRACTS.BUILD_NFT),
      ])

      if (balance < requiredBlox) {
        throw new Error(
          `Insufficient BLOX balance. Need ${ethers.formatEther(requiredBlox)} BLOX, have ${ethers.formatEther(balance)} BLOX`,
        )
      }

      const needsBloxApproval = allowance < requiredBlox

      // V3: Licenses are purchased atomically during mint via ETH.
      // No need to pre-check or pre-approve license transfers.

      return {
        needsBloxApproval,
        needsLicenseApproval: false,
        requiredBlox,
      }
    },
    [account, isConnected, isCorrectChain, getProvider],
  )

  const mintSimpleBuild = useCallback(
    async (geometryHash: string, mass: number) => {
      setStep("checking")
      setError(null)
      setTxHash(null)
      setTokenId(null)

      try {
        const provider = getProvider()
        if (!provider) throw new Error("No provider available")

        const { needsBloxApproval, requiredBlox } = await checkRequirements(mass)

        // Approve BLOX if needed
        if (needsBloxApproval) {
          setStep("approving-blox")
          const approveTx = await approveBlox(provider, requiredBlox)
          await approveTx.wait()
        }

        // Get next token ID before minting
        const nextId = await getNextTokenId(provider)
        setTokenId(nextId)

        // Mint the NFT
        setStep("minting")
        const mintTx = await mintBuildNFT(provider, geometryHash, mass)
        setTxHash(mintTx.hash)

        await mintTx.wait()

        // Record minted hash locally
        addMintedHash(geometryHash)

        setStep("success")
        options.onSuccess?.({ tokenId: nextId, txHash: mintTx.hash })

        return { tokenId: nextId, txHash: mintTx.hash }
      } catch (err: any) {
        const message = err.code === 4001 ? "Transaction rejected" : err.message || "Minting failed"
        setError(message)
        setStep("error")
        options.onError?.(new Error(message))
        throw err
      }
    },
    [getProvider, checkRequirements, options],
  )

  const mintBrickNFT = useCallback(
    async (params: MintBrickParams) => {
      setStep("checking")
      setError(null)
      setTxHash(null)
      setTokenId(null)

      try {
        const provider = getProvider()
        if (!provider) throw new Error("No provider available")

        if (!account || !isConnected) {
          throw new Error("Please connect your wallet")
        }
        if (!isCorrectChain) {
          throw new Error("Please switch to Base Sepolia network")
        }

        const brickMass = Math.max(1, params.spec.width * params.spec.depth)
        const { needsBloxApproval, requiredBlox } = await checkRequirements(brickMass)
        if (needsBloxApproval) {
          setStep("approving-blox")
          const approveTx = await approveBlox(provider, requiredBlox)
          await approveTx.wait()
        }

        // Mint the brick
        setStep("minting")
        const mintTx = await mintBuildNFTWithParams(provider, {
          geometryHash: params.geometryHash,
          mass: brickMass,
          geometryData: new Uint8Array(0),
          componentBuildIds: [],
          componentCounts: [],
          manifest: [],
          kind: BUILD_KIND.BRICK,
          width: params.spec.width,
          depth: params.spec.depth,
          density: params.spec.density,
        })
        setTxHash(mintTx.hash)

        const receipt = await mintTx.wait()
        
        // Extract token ID from Transfer event in receipt
        let mintedTokenId: bigint | null = null
        if (receipt?.logs) {
          for (const log of receipt.logs) {
            // Transfer event topic: keccak256("Transfer(address,address,uint256)")
            if (log.topics[0] === "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef") {
              // Token ID is the 4th topic (index 3) for ERC721 Transfer
              mintedTokenId = BigInt(log.topics[3])
              break
            }
          }
        }
        
        if (mintedTokenId !== null) {
          setTokenId(mintedTokenId)
        }

        addMintedHash(params.geometryHash)

        setStep("success")
        options.onSuccess?.({ tokenId: mintedTokenId ?? 0n, txHash: mintTx.hash })

        return { tokenId: mintedTokenId ?? 0n, txHash: mintTx.hash }
      } catch (err: any) {
        const message = err.code === 4001 ? "Transaction rejected" : err.message || "Minting failed"
        setError(message)
        setStep("error")
        options.onError?.(new Error(message))
        throw err
      }
    },
    [account, isConnected, isCorrectChain, getProvider, options, checkRequirements],
  )

  const mintBuildWithComponents = useCallback(
    async (params: MintBuildParams) => {
      setStep("checking")
      setError(null)
      setTxHash(null)
      setTokenId(null)

      try {
        const provider = getProvider()
        if (!provider) throw new Error("No provider available")

        const componentTokenIds = params.componentTokenIds || []
        const componentCounts = params.componentCounts || componentTokenIds.map(() => 1n)
        const kind = params.kind || (componentTokenIds.length > 0 ? BUILD_KIND.BUILD : BUILD_KIND.BRICK)

        const { needsBloxApproval, needsLicenseApproval, requiredBlox } = await checkRequirements(
          params.mass,
          componentTokenIds,
          componentCounts,
        )

        // Approve BLOX if needed
        if (needsBloxApproval) {
          setStep("approving-blox")
          const approveTx = await approveBlox(provider, requiredBlox)
          await approveTx.wait()
        }

        // Approve licenses if needed
        if (needsLicenseApproval) {
          setStep("approving-licenses")
          const licenseTx = await approveLicenseNFT(provider, CONTRACTS.BUILD_NFT, true)
          await licenseTx.wait()
        }

        // Get next token ID before minting
        const nextId = await getNextTokenId(provider)
        setTokenId(nextId)

        // Mint the build
        setStep("minting")
        const mintTx = await mintBuild(
          provider,
          params.geometryHash,
          params.mass,
          kind,
          componentTokenIds,
          componentCounts,
          params.geometryData || new Uint8Array(0),
          params.manifest || [],
        )
        setTxHash(mintTx.hash)

        await mintTx.wait()

        addMintedHash(params.geometryHash)

        setStep("success")
        options.onSuccess?.({ tokenId: nextId, txHash: mintTx.hash })

        return { tokenId: nextId, txHash: mintTx.hash }
      } catch (err: any) {
        const message = err.code === 4001 ? "Transaction rejected" : err.message || "Minting failed"
        setError(message)
        setStep("error")
        options.onError?.(new Error(message))
        throw err
      }
    },
    [getProvider, checkRequirements, options],
  )

  const reset = useCallback(() => {
    setStep("idle")
    setError(null)
    setTxHash(null)
    setTokenId(null)
  }, [])

  return {
    // State
    step,
    error,
    txHash,
    tokenId,
    isLoading: step !== "idle" && step !== "success" && step !== "error",
    isSuccess: step === "success",
    isError: step === "error",

    // Actions
    mintSimpleBuild,
    mintBrickNFT,
    mintBuildWithComponents,
    checkRequirements,
    reset,

    // Derived
    isConnected,
    isCorrectChain,
    account,
  }
}
