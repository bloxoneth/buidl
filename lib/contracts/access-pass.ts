import { ethers } from "ethers"

export const ACCESS_PASS_ADDRESS =
  process.env.NEXT_PUBLIC_ACCESS_PASS_ADDRESS ?? "0x0000000000000000000000000000000000000000"
export const ACCESS_PASS_PRICE_WEI = ethers.parseEther("0.05")
export const ACCESS_PASS_MAX_SUPPLY = 1000n
export const ACCESS_PASS_BLOX_REWARD = 10_000n * 10n ** 18n
export const ACCESS_PASS_REQUIRE_FOR_BUILD =
  process.env.NEXT_PUBLIC_REQUIRE_ACCESS_PASS === "1"

export const ACCESS_PASS_ABI = [
  "function saleActive() view returns (bool)",
  "function claimStart() view returns (uint256)",
  "function totalMinted() view returns (uint256)",
  "function MAX_SUPPLY() view returns (uint256)",
  "function PASS_PRICE() view returns (uint256)",
  "function BLOX_REWARD_PER_PASS() view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function mint(uint256 quantity) payable",
  "function claimBlox(uint256[] tokenIds)",
]

function configured(): boolean {
  return ACCESS_PASS_ADDRESS !== "0x0000000000000000000000000000000000000000"
}

function getContract(providerOrSigner: ethers.Provider | ethers.Signer) {
  return new ethers.Contract(ACCESS_PASS_ADDRESS, ACCESS_PASS_ABI, providerOrSigner)
}

export async function getAccessPassState(provider: ethers.BrowserProvider, account?: string | null): Promise<{
  configured: boolean
  saleActive: boolean
  totalMinted: bigint
  maxSupply: bigint
  passPrice: bigint
  bloxReward: bigint
  passBalance: bigint
  claimStart: bigint
}> {
  if (!configured()) {
    return {
      configured: false,
      saleActive: false,
      totalMinted: 0n,
      maxSupply: ACCESS_PASS_MAX_SUPPLY,
      passPrice: ACCESS_PASS_PRICE_WEI,
      bloxReward: ACCESS_PASS_BLOX_REWARD,
      passBalance: 0n,
      claimStart: 0n,
    }
  }
  const c = getContract(provider)
  const [saleActive, totalMinted, maxSupply, passPrice, bloxReward, passBalance, claimStart] = await Promise.all([
    c.saleActive().catch(() => false),
    c.totalMinted().catch(() => 0n),
    c.MAX_SUPPLY().catch(() => ACCESS_PASS_MAX_SUPPLY),
    c.PASS_PRICE().catch(() => ACCESS_PASS_PRICE_WEI),
    c.BLOX_REWARD_PER_PASS().catch(() => ACCESS_PASS_BLOX_REWARD),
    account ? c.balanceOf(account).catch(() => 0n) : Promise.resolve(0n),
    c.claimStart().catch(() => 0n),
  ])
  return { configured: true, saleActive, totalMinted, maxSupply, passPrice, bloxReward, passBalance, claimStart }
}

export async function mintAccessPass(
  provider: ethers.BrowserProvider,
  quantity: number,
): Promise<ethers.TransactionResponse> {
  if (!configured()) {
    throw new Error("Access pass contract is not configured")
  }
  if (quantity <= 0) {
    throw new Error("Quantity must be greater than zero")
  }
  const signer = await provider.getSigner()
  const c = getContract(signer)
  const total = ACCESS_PASS_PRICE_WEI * BigInt(quantity)
  return c.mint(quantity, { value: total })
}
