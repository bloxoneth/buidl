import { ethers } from "ethers"
import { computeSpecKey } from "../brickSpec"

// IMPORTANT: Next.js Turbopack only statically replaces process.env.NEXT_PUBLIC_*
// when accessed as LITERAL property names, NOT via dynamic process.env[key].
// All NEXT_PUBLIC_* vars MUST be referenced directly for client-side bundles.
const _trim = (v: string | undefined) => (v ?? "").trim()
const isLikelyIpfsCid = (v: string) => /^(bafy[0-9a-z]{20,}|Qm[1-9A-HJ-NP-Za-km-z]{44})$/.test(String(v || "").trim())

// Constants
export const FEE_PER_MINT = ethers.parseEther("0.001") // 0.001 ETH mint fee
export const BURN_FEE = ethers.parseEther("0.005") // 0.005 ETH burn fee
export const BLOX_DECIMALS = 18n
export const MINT_GAS_LIMIT = 2_000_000n // atomic license flow scales with voxel count
export const MINT_GAS_LIMIT_FORCE = 2_500_000n // upper bound when force-sending

// Metadata via IPFS - baseTokenURI is set on-chain, no per-token URIs needed
export const BASE_METADATA_CID = "bafybeihf3bprrm6gr5prmzatwnjlnl3pmygw5xh44tvnwccejqo2yfoaii"
export const BASE_METADATA_URI =
  _trim(process.env.NEXT_PUBLIC_BASE_METADATA_URI) || `ipfs://${BASE_METADATA_CID}`
export const BASE_METADATA_GATEWAY =
  _trim(process.env.NEXT_PUBLIC_BASE_METADATA_GATEWAY) ||
  `https://gateway.pinata.cloud/ipfs/${BASE_METADATA_CID}`
export const tokenMetadataURI = (tokenId: string | number) =>
  `${BASE_METADATA_URI}/${tokenId}.json`
export const tokenMetadataGatewayURL = (tokenId: string | number) =>
  `${BASE_METADATA_GATEWAY}/${tokenId}.json`

// Images via IPFS - stored at root of images CID (no /images/ folder)
const _imagesCidRaw = _trim(process.env.NEXT_PUBLIC_IMAGES_CID)
export const IMAGES_CID =
  (isLikelyIpfsCid(_imagesCidRaw) ? _imagesCidRaw : "") ||
  "bafybeibnk4kq7mesrs7wtwi2ypwlnxhazoqkwgoycol55n64tqseox2q2a"
export const IMAGES_GATEWAY =
  _trim(process.env.NEXT_PUBLIC_IMAGES_GATEWAY) ||
  `https://gateway.pinata.cloud/ipfs/${IMAGES_CID}`
export const tokenImageURI = (tokenId: string | number) =>
  `ipfs://${IMAGES_CID}/${tokenId}.png`
export const tokenImageGatewayURL = (tokenId: string | number) =>
  `${IMAGES_GATEWAY}/${tokenId}.png`

// Resolve any ipfs:// URI to a gateway URL
export const resolveIPFS = (uri: string) => {
  const gateway = _trim(process.env.NEXT_PUBLIC_IPFS_GATEWAY) || "https://gateway.pinata.cloud/ipfs/"
  return uri.replace("ipfs://", gateway)
}

// Build kinds
export const BUILD_KIND = {
  BRICK: 0, // kind=0 for individual bricks
  BUILD: 1, // kind>0 for composite builds
} as const

// Network: configurable via env, defaults to Base Mainnet
const DEFAULT_CHAIN_ID = 8453
const DEFAULT_CHAIN_HEX = "0x2105"
export const CHAIN_ID = Number(_trim(process.env.NEXT_PUBLIC_CHAIN_ID) || DEFAULT_CHAIN_ID)
export const RPC_URL =
  _trim(process.env.NEXT_PUBLIC_RPC_URL) ||
  "https://mainnet.base.org"

// Contract addresses — each must use a direct process.env.NEXT_PUBLIC_* literal
export const CONTRACTS = {
  MOCK_BLOX:
    _trim(process.env.NEXT_PUBLIC_BLOX_ADDRESS) || "",
  BUILD_NFT:
    _trim(process.env.NEXT_PUBLIC_BUILDNFT_ADDRESS) || "",
  LICENSE_REGISTRY:
    _trim(process.env.NEXT_PUBLIC_LICENSE_REGISTRY_ADDRESS) || "",
  LICENSE_NFT:
    _trim(process.env.NEXT_PUBLIC_LICENSE_NFT_ADDRESS) || "",
  DISTRIBUTOR:
    _trim(process.env.NEXT_PUBLIC_DISTRIBUTOR_ADDRESS) || "",
  GEOMETRY_REGISTRY:
    _trim(process.env.NEXT_PUBLIC_GEOMETRY_REGISTRY_ADDRESS) || "",
  RENDERER:
    _trim(process.env.NEXT_PUBLIC_RENDERER_ADDRESS) || "",
  WORLD_REGISTRY:
    _trim(process.env.NEXT_PUBLIC_WORLD_REGISTRY_ADDRESS) || "",
  CHAIN_HEX: _trim(process.env.NEXT_PUBLIC_CHAIN_HEX) || DEFAULT_CHAIN_HEX,
  BASE_SEPOLIA_CHAIN_ID: _trim(process.env.NEXT_PUBLIC_CHAIN_HEX) || DEFAULT_CHAIN_HEX,
}

// Minimal ABIs
export const MOCK_BLOX_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]

// BuildNFT ABI
// Confirmed from on-chain tx 0x37c60c0d: MethodID 0x0923bb28
// mint(bytes32,uint256,bytes,uint256[],uint256[],(uint256,uint8,uint8,uint8,uint8,uint8,uint8)[],uint8,uint8,uint8,uint16)
// Note: density is uint16 (NOT uint8)
export const BUILD_NFT_ABI = [
  "function mint(bytes32 geometryHash, uint256 mass, bytes geometryData, uint256[] componentBuildIds, uint256[] componentCounts, (uint256 licenseTokenId, uint8 rotation, uint8 x, uint8 y, uint8 z, uint8 colourIndex, uint8 useMode)[] manifest, uint8 kind, uint8 width, uint8 depth, uint16 density) payable",
  "function getManifest(uint256 tokenId) view returns ((uint256 licenseTokenId, uint8 rotation, uint8 x, uint8 y, uint8 z, uint8 colourIndex, uint8 useMode)[])",
  "function repaint(uint256 tokenId, bytes newVoxelData)",
  "function geometryRegistry() view returns (address)",
  "function renderer() view returns (address)",
  "function isMinter(address) view returns (bool)",
  "function mintingOpen() view returns (bool)",
  // State reading (public mappings — auto-getter names must match exactly)
  "function kindOf(uint256 tokenId) view returns (uint8)",
  "function geometryOf(uint256 tokenId) view returns (bytes32)",
  "function brickSpecOf(uint256 tokenId) view returns (uint8 width, uint8 depth, uint16 density)",
  "function lockedBloxOf(uint256 tokenId) view returns (uint256)",
  "function brickSpecKeyOf(uint256 tokenId) view returns (bytes32)",
  "function escrowedLicenses(uint256 tokenId, uint256 licenseId) view returns (uint256)",
  "function maxMass() view returns (uint256)",
  "function nextTokenId() view returns (uint256)",
  "function hashToTokenId(bytes32) view returns (uint256)",
  "function brickSpecConsumed(bytes32) view returns (bool)",
  "function blox() view returns (address)",
  "function FEE_PER_MINT() view returns (uint256)",
  "function BURN_FEE() view returns (uint256)",
  "function owner() view returns (address)",
  "function distributor() view returns (address)",
  // ERC721 standard
  "function balanceOf(address owner) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function exists(uint256 tokenId) view returns (bool)",
  "function ownerOfSafe(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  // Burn (only for builds, not bricks)
  "function burn(uint256 tokenId) payable",
  // Events
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
]

// GeometryRegistry ABI
export const GEOMETRY_REGISTRY_ABI = [
  "function geometryData(uint256 tokenId) view returns (bytes)",
  "function hashConsumed(bytes32 hash) view returns (bool)",
  "function hasGeometry(uint256 tokenId) view returns (bool)",
]

// LicenseRegistry ABI - maps component tokenIds to license IDs
export const LICENSE_REGISTRY_ABI = [
  "function nextLicenseId() view returns (uint256)",
  "function licenseIdForBuild(uint256 buildId) view returns (uint256)",
  "function buildIdForLicense(uint256 licenseId) view returns (uint256)",
  "function quote(uint256 buildId, uint256 qty) view returns (uint256)",
  "function pricingForLicense(uint256 licenseId) view returns (uint256 startPrice, uint256 step, uint256 maxSupply, uint256 maxPrice)",
  "function mintLicenseForBuild(uint256 buildId, uint256 qty) payable",
  "function registerBuild(uint256 buildId, bytes32 expectedGeometryHash)",
  "function getLicenseId(uint256 componentTokenId) view returns (uint256)",
  "function getLicenseIds(uint256[] calldata componentTokenIds) view returns (uint256[])",
  "function isLicenseRequired(uint256 componentTokenId) view returns (bool)",
]

// LicenseNFT ABI - ERC1155 for license ownership
export const LICENSE_NFT_ABI = [
  // ERC1155 standard
  "function balanceOf(address account, uint256 id) view returns (uint256)",
  "function balanceOfBatch(address[] calldata accounts, uint256[] calldata ids) view returns (uint256[])",
  "function setApprovalForAll(address operator, bool approved)",
  "function isApprovedForAll(address account, address operator) view returns (bool)",
  // License-specific
  "function totalSupply(uint256 id) view returns (uint256)",
  "function maxSupply(uint256 id) view returns (uint256)",
]

// Distributor ABI - handles rewards distribution
export const DISTRIBUTOR_ABI = [
  "function claim()",
  "function claimTo(address to)",
  "function ethOwed(address account) view returns (uint256)",
  "function pendingLicenseRewards(address account, uint256[] licenseIds) view returns (uint256 total, uint256[] perId)",
  "function claimLicenseRewards(uint256[] licenseIds)",
  "function totalDistributed() view returns (uint256)",
]

async function resolveDistributorAddress(provider: ethers.BrowserProvider): Promise<string> {
  const fallback = CONTRACTS.DISTRIBUTOR
  if (fallback === "0x0000000000000000000000000000000000000000") return fallback
  try {
    const build = new ethers.Contract(CONTRACTS.BUILD_NFT, BUILD_NFT_ABI, provider)
    const onchain = (await build.distributor()) as string
    if (onchain && onchain !== "0x0000000000000000000000000000000000000000") return onchain
  } catch {
    // fall through to configured distributor
  }
  return fallback
}

// Local storage registry for minted hashes
const MINTED_HASHES_KEY = "buidl_minted_hashes"

export function getMintedHashes(): Set<string> {
  if (typeof window === "undefined") return new Set()
  const stored = localStorage.getItem(MINTED_HASHES_KEY)
  return new Set(stored ? JSON.parse(stored) : [])
}

export function addMintedHash(hash: string) {
  const hashes = getMintedHashes()
  hashes.add(hash.toLowerCase())
  localStorage.setItem(MINTED_HASHES_KEY, JSON.stringify(Array.from(hashes)))
}

export function isHashMinted(hash: string): boolean {
  return getMintedHashes().has(hash.toLowerCase())
}

// Contract interaction helpers
export async function getBloxBalance(provider: ethers.BrowserProvider, address: string): Promise<bigint> {
  const contract = new ethers.Contract(CONTRACTS.MOCK_BLOX, MOCK_BLOX_ABI, provider)
  return await contract.balanceOf(address)
}

export async function getBloxAllowance(
  provider: ethers.BrowserProvider,
  owner: string,
  spender: string,
): Promise<bigint> {
  const contract = new ethers.Contract(CONTRACTS.MOCK_BLOX, MOCK_BLOX_ABI, provider)
  return await contract.allowance(owner, spender)
}

export async function approveBlox(
  provider: ethers.BrowserProvider,
  amount: bigint,
): Promise<ethers.ContractTransactionResponse> {
  const signer = await provider.getSigner()
  const contract = new ethers.Contract(CONTRACTS.MOCK_BLOX, MOCK_BLOX_ABI, signer)
  return await contract.approve(CONTRACTS.BUILD_NFT, amount)
}

export async function getMaxMass(provider: ethers.BrowserProvider): Promise<bigint> {
  const contract = new ethers.Contract(CONTRACTS.BUILD_NFT, BUILD_NFT_ABI, provider)
  return await contract.maxMass()
}

export async function getNextTokenId(provider: ethers.BrowserProvider): Promise<bigint> {
  const contract = new ethers.Contract(CONTRACTS.BUILD_NFT, BUILD_NFT_ABI, provider)
  return await contract.nextTokenId()
}

export async function isBrickSpecMintedOnChain(
  provider: ethers.BrowserProvider,
  width: number,
  depth: number,
  density: number,
): Promise<boolean> {
  const contract = new ethers.Contract(CONTRACTS.BUILD_NFT, BUILD_NFT_ABI, provider)
  const specKey = computeSpecKey(width, depth, density)
  return Boolean(await contract.brickSpecConsumed(specKey))
}

export async function mintBuildNFT(
  provider: ethers.BrowserProvider,
  geometryHash: string,
  mass: number,
  geometryData: Uint8Array = new Uint8Array(0),
): Promise<ethers.ContractTransactionResponse> {
  return mintBuildNFTWithParams(provider, {
    geometryHash,
    mass,
    geometryData,
    componentBuildIds: [],
    componentCounts: [],
    manifest: [],
    kind: 1,
    width: 0,
    depth: 0,
    density: 1,
  })
}

// New mint function with correct payload format
export interface PlacedComponent {
  licenseTokenId: bigint
  rotation: number // 0-23
  x: number
  y: number
  z: number
  colourIndex: number // 1-7
  useMode: number // 0=COMPONENT, 1=COLLECTIBLE
}

export interface MintParams {
  geometryHash: string
  mass: number
  geometryData: Uint8Array // raw 3-bit voxel bytes (replaces uri)
  componentBuildIds: bigint[]
  componentCounts: bigint[]
  manifest: PlacedComponent[]
  kind: number
  width: number
  depth: number
  density: number
}

// Run pre-mint diagnostics - returns an object with all checks
export async function runMintDiagnostics(
  provider: ethers.BrowserProvider,
  params: MintParams,
  sender: string,
): Promise<Record<string, string>> {
  const results: Record<string, string> = {}
  
  try {
    const bloxContract = new ethers.Contract(CONTRACTS.MOCK_BLOX, MOCK_BLOX_ABI, provider)
    const buildContract = new ethers.Contract(CONTRACTS.BUILD_NFT, BUILD_NFT_ABI, provider)
    
    // Network
    const network = await provider.getNetwork()
    results["Chain ID"] = `${network.chainId} (expected: ${CHAIN_ID})`
    results["Correct Chain"] = network.chainId === BigInt(CHAIN_ID) ? "YES" : "NO"
    
    // Contract state checks
    results["--- CONTRACT STATE ---"] = ""
    
    try {
      const paused = await buildContract.paused()
      results["Contract Paused"] = paused ? "YES (MINTING BLOCKED!)" : "NO"
    } catch { results["Contract Paused"] = "N/A (no paused() function)" }
    
    try {
      const bloxTokenAddr = await buildContract.blox()
      results["Contract BLOX Token Addr"] = bloxTokenAddr
      results["BLOX Addr Matches Our Config"] = bloxTokenAddr.toLowerCase() === CONTRACTS.MOCK_BLOX.toLowerCase() ? "YES" : `NO! Contract uses ${bloxTokenAddr}, we use ${CONTRACTS.MOCK_BLOX}`
    } catch {
      try {
        const bloxTokenAddr = await buildContract.bloxToken()
        results["Contract BLOX Token Addr"] = bloxTokenAddr
        results["BLOX Addr Matches Our Config"] =
          bloxTokenAddr.toLowerCase() === CONTRACTS.MOCK_BLOX.toLowerCase()
            ? "YES"
            : `NO! Contract uses ${bloxTokenAddr}, we use ${CONTRACTS.MOCK_BLOX}`
      } catch {
        results["Contract BLOX Token Addr"] = "N/A (no blox/bloxToken function)"
      }
    }
    
    try {
      const onChainFee = await buildContract.FEE_PER_MINT()
      results["On-chain Mint Fee"] = `${ethers.formatEther(onChainFee)} ETH (raw: ${onChainFee.toString()})`
      results["Our Fee Matches"] = onChainFee === FEE_PER_MINT ? "YES" : `NO! Contract wants ${ethers.formatEther(onChainFee)} ETH, we send ${ethers.formatEther(FEE_PER_MINT)} ETH`
    } catch {
      try {
        const onChainFee = await buildContract.mintFee()
        results["On-chain Mint Fee"] = `${ethers.formatEther(onChainFee)} ETH (raw: ${onChainFee.toString()})`
        results["Our Fee Matches"] =
          onChainFee === FEE_PER_MINT
            ? "YES"
            : `NO! Contract wants ${ethers.formatEther(onChainFee)} ETH, we send ${ethers.formatEther(FEE_PER_MINT)} ETH`
      } catch {
        results["On-chain Mint Fee"] = "N/A (no fee getter)"
      }
    }
    
    try {
      const contractOwner = await buildContract.owner()
      results["Contract Owner"] = contractOwner
      results["Sender Is Owner"] = contractOwner.toLowerCase() === sender.toLowerCase() ? "YES" : "NO"
    } catch { results["Contract Owner"] = "N/A (no owner() function)" }
    
    // Check for whitelist/minter role
    try {
      const isMinter = await buildContract.isMinter(sender)
      results["Is Minter (whitelisted)"] = isMinter ? "YES" : "NO (MAY BLOCK MINTING!)"
    } catch { results["Is Minter"] = "N/A (no isMinter() function)" }
    
    try {
      const mintingOpen = await buildContract.mintingOpen()
      results["Minting Open"] = mintingOpen ? "YES" : "NO (MINTING CLOSED!)"
    } catch { results["Minting Open"] = "N/A (no mintingOpen() function)" }
    
    try {
      const nextId = await buildContract.nextTokenId()
      results["Next Token ID"] = nextId.toString()
    } catch { results["Next Token ID"] = "FAILED TO READ" }
    
    try {
      const maxM = await buildContract.maxMass()
      results["Max Mass"] = maxM.toString()
      results["Mass Within Limit"] = BigInt(params.mass) <= maxM ? "YES" : `NO (mass ${params.mass} > max ${maxM})`
    } catch { results["Max Mass"] = "FAILED TO READ" }
    
    // Hash check
    results["--- HASH CHECK ---"] = ""
    results["Geometry Hash"] = params.geometryHash
    try {
      const hashToToken = await buildContract.hashToTokenId(params.geometryHash)
      results["Hash Already Minted"] = hashToToken > 0n ? `YES - TOKEN #${hashToToken} (WILL REVERT!)` : "NO (available)"
    } catch { results["Hash Already Minted"] = "COULD NOT CHECK (no hashToTokenId function)" }
    
    // BLOX checks
    results["--- BLOX TOKEN ---"] = ""
    const balance = await bloxContract.balanceOf(sender)
    results["BLOX Balance"] = `${ethers.formatEther(balance)} BLOX (raw: ${balance.toString()})`
    
    const allowance = await bloxContract.allowance(sender, CONTRACTS.BUILD_NFT)
    results["BLOX Allowance (to BuildNFT)"] = `${ethers.formatEther(allowance)} BLOX (raw: ${allowance.toString()})`
    
    const requiredBlox = BigInt(params.mass) * 10n ** 18n
    results["Required BLOX"] = `${ethers.formatEther(requiredBlox)} (mass=${params.mass})`
    results["Balance Sufficient"] = balance >= requiredBlox ? "YES" : `NO (need ${ethers.formatEther(requiredBlox - balance)} more)`
    results["Allowance Sufficient"] = allowance >= requiredBlox ? "YES" : `NO (need ${ethers.formatEther(requiredBlox - allowance)} more)`
    
    // ETH check
    results["--- ETH ---"] = ""
    const ethBalance = await provider.getBalance(sender)
    results["ETH Balance"] = `${ethers.formatEther(ethBalance)} ETH`
    results["ETH Sufficient"] =
      ethBalance >= FEE_PER_MINT ? "YES" : `NO (need ${ethers.formatEther(FEE_PER_MINT)} ETH)`
    
    // Mint params summary
    results["--- MINT PARAMS ---"] = ""
    results["kind"] = params.kind.toString()
    results["mass"] = params.mass.toString()
    results["width"] = params.width.toString()
    results["depth"] = params.depth.toString()
    results["density"] = params.density.toString()
    results["componentBuildIds"] = `[${params.componentBuildIds.map(String).join(", ")}] (length: ${params.componentBuildIds.length})`
    results["componentCounts"] = `[${params.componentCounts.map(String).join(", ")}] (length: ${params.componentCounts.length})`
    results["geometryData"] = `${params.geometryData.length} bytes`
    results["manifest"] = `${params.manifest.length} entries`
    
  } catch (err: any) {
    results["Diagnostic Error"] = err.message
  }
  
  return results
}

export async function mintBuildNFTWithParams(
  provider: ethers.BrowserProvider,
  params: MintParams,
  forceSend = false,
): Promise<ethers.ContractTransactionResponse> {
  const signer = await provider.getSigner()

  // Encode calldata explicitly and send a raw tx so data can never be omitted.
  const data = encodeMintCalldata(params)
  if (!data || data.length < 10 || data === "0x") {
    throw new Error(`Calldata is empty or too short: "${data}"`)
  }

  // V3: BuildNFT atomically mints licenses during _handleComponents, paid in ETH.
  // Quote total license cost for all components and add to msg.value.
  let totalLicenseCost = 0n
  if (params.componentBuildIds.length > 0) {
    const registry = new ethers.Contract(CONTRACTS.LICENSE_REGISTRY, LICENSE_REGISTRY_ABI, provider)
    for (let i = 0; i < params.componentBuildIds.length; i++) {
      const cost = await registry.quote(params.componentBuildIds[i], params.componentCounts[i])
      totalLicenseCost += cost
    }
  }

  return await signer.sendTransaction({
    to: CONTRACTS.BUILD_NFT,
    data,
    value: FEE_PER_MINT + totalLicenseCost,
    gasLimit: forceSend ? MINT_GAS_LIMIT_FORCE : MINT_GAS_LIMIT,
  })
}

// Encode calldata for mint v2.0 - includes geometryData + manifest
export function encodeMintCalldata(params: MintParams): string {
  const mintAbi = [{
    type: "function",
    name: "mint",
    stateMutability: "payable",
    inputs: [
      { name: "geometryHash", type: "bytes32" },
      { name: "mass", type: "uint256" },
      { name: "geometryData", type: "bytes" },
      { name: "componentBuildIds", type: "uint256[]" },
      { name: "componentCounts", type: "uint256[]" },
      { name: "manifest", type: "tuple[]", components: [
        { name: "licenseTokenId", type: "uint256" },
        { name: "rotation", type: "uint8" },
        { name: "x", type: "uint8" },
        { name: "y", type: "uint8" },
        { name: "z", type: "uint8" },
        { name: "colourIndex", type: "uint8" },
        { name: "useMode", type: "uint8" },
      ]},
      { name: "kind", type: "uint8" },
      { name: "width", type: "uint8" },
      { name: "depth", type: "uint8" },
      { name: "density", type: "uint16" },
    ],
    outputs: [],
  }]
  const iface = new ethers.Interface(mintAbi)
  return iface.encodeFunctionData("mint", [
    params.geometryHash,
    BigInt(params.mass),
    params.geometryData,
    params.componentBuildIds,
    params.componentCounts,
    params.manifest,
    params.kind,
    params.width,
    params.depth,
    params.density,
  ])
}

// Repaint a build (change colours, keep geometry)
export async function repaintBuild(
  provider: ethers.BrowserProvider,
  tokenId: bigint,
  newVoxelData: Uint8Array,
): Promise<ethers.ContractTransactionResponse> {
  const signer = await provider.getSigner()
  const contract = new ethers.Contract(CONTRACTS.BUILD_NFT, BUILD_NFT_ABI, signer)
  return await contract.repaint(tokenId, newVoxelData)
}

// Simulate mint via eth_call using the signer (ensures from is set correctly)
export async function simulateMint(
  provider: ethers.BrowserProvider,
  params: MintParams,
  from: string,
): Promise<{ success: boolean; result: string; decodedError?: string }> {
  const calldata = encodeMintCalldata(params)

  // V3: Quote license costs and include in simulation value
  let totalLicenseCost = 0n
  if (params.componentBuildIds.length > 0) {
    const registry = new ethers.Contract(CONTRACTS.LICENSE_REGISTRY, LICENSE_REGISTRY_ABI, provider)
    for (let i = 0; i < params.componentBuildIds.length; i++) {
      const cost = await registry.quote(params.componentBuildIds[i], params.componentCounts[i])
      totalLicenseCost += cost
    }
  }

  // Use a direct JsonRpcProvider for simulation so we get full revert data
  // (MetaMask's signer.call() often strips revert reasons)
  const directProvider = new ethers.JsonRpcProvider(RPC_URL)
  try {
    const result = await directProvider.call({
      from,
      to: CONTRACTS.BUILD_NFT,
      data: calldata,
      value: FEE_PER_MINT + totalLicenseCost,
    })
    return { success: true, result }
  } catch (err: any) {
    // Try to extract revert data from various error shapes
    const data = err.data || err.error?.data || err.info?.error?.data || "0x"
    let decodedError = undefined
    
    if (data && data !== "0x" && data.length > 2) {
      // Try to decode as Error(string) - selector 0x08c379a0
      if (data.startsWith("0x08c379a0")) {
        try {
          const decoded = ethers.AbiCoder.defaultAbiCoder().decode(["string"], "0x" + data.slice(10))
          decodedError = `Revert: "${decoded[0]}"`
        } catch {
          decodedError = `Raw revert data: ${data}`
        }
      } else {
        decodedError = `Raw revert data: ${data}`
      }
    } else {
      // No revert data - try to extract from error message
      const msg = err.message || ""
      if (msg.includes("insufficient funds")) {
        decodedError = `Insufficient ETH (need ${ethers.formatEther(FEE_PER_MINT)} ETH for mint fee + gas)`
      } else if (msg.includes("require(false)")) {
        decodedError = "Bare require(false) - contract rejected call. Check BLOX approval, balance, and fee."
      } else {
        if (msg.includes("missing revert data") && msg.includes("data=null")) {
          decodedError = `RPC returned no data — likely a rate limit or network issue. Try again in a few seconds.`
        } else {
          decodedError = `No revert data — check BUIDL token approval and balance. Error: ${msg.slice(0, 200)}`
        }
      }
    }
    
    return { success: false, result: data, decodedError }
  }
}

export async function burnBuildNFT(
  provider: ethers.BrowserProvider,
  tokenId: string,
): Promise<ethers.ContractTransactionResponse> {
  const signer = await provider.getSigner()
  const contract = new ethers.Contract(CONTRACTS.BUILD_NFT, BUILD_NFT_ABI, signer)
  // Convert tokenId string to BigInt for contract call
  return await contract.burn(BigInt(tokenId), { value: BURN_FEE })
}

// ========== NEW: Brick Minting ==========

export interface BrickSpec {
  width: number
  depth: number
  density: number
}

export async function mintBrick(
  provider: ethers.BrowserProvider,
  geometryHash: string,
  spec: BrickSpec,
  geometryData: Uint8Array = new Uint8Array(0),
): Promise<ethers.ContractTransactionResponse> {
  const mass = Math.max(1, spec.width * spec.depth)
  return mintBuildNFTWithParams(provider, {
    geometryHash,
    mass,
    geometryData,
    componentBuildIds: [],
    componentCounts: [],
    manifest: [],
    kind: 0,
    width: spec.width,
    depth: spec.depth,
    density: spec.density,
  })
}

// ========== NEW: Build Minting with Components ==========

export async function mintBuild(
  provider: ethers.BrowserProvider,
  geometryHash: string,
  mass: number,
  kind: number,
  componentTokenIds: bigint[],
  componentCounts: bigint[] = [],
  geometryData: Uint8Array = new Uint8Array(0),
  manifest: PlacedComponent[] = [],
): Promise<ethers.ContractTransactionResponse> {
  return mintBuildNFTWithParams(provider, {
    geometryHash,
    mass,
    geometryData,
    componentBuildIds: componentTokenIds,
    componentCounts: componentCounts.length > 0 ? componentCounts : componentTokenIds.map(() => 1n),
    manifest,
    kind,
    width: 0,
    depth: 0,
    density: 1,
  })
}

// ========== NEW: License Registry Functions ==========

export async function getLicenseIds(
  provider: ethers.BrowserProvider,
  componentTokenIds: bigint[],
): Promise<bigint[]> {
  if (CONTRACTS.LICENSE_REGISTRY === "0x0000000000000000000000000000000000000000") {
    // Contract not deployed yet - return empty array
    return []
  }
  const contract = new ethers.Contract(CONTRACTS.LICENSE_REGISTRY, LICENSE_REGISTRY_ABI, provider)
  try {
    return await contract.getLicenseIds(componentTokenIds)
  } catch {
    const ids: bigint[] = []
    for (const tokenId of componentTokenIds) {
      ids.push(await contract.licenseIdForBuild(tokenId))
    }
    return ids
  }
}

export interface ComponentLicenseStatus {
  componentBuildIds: bigint[]
  licenseIds: bigint[]
  balances: bigint[]
  missingComponentBuildIds: bigint[]
  missingLicenseIds: bigint[]
}

export async function getComponentLicenseStatus(
  provider: ethers.BrowserProvider,
  account: string,
  componentBuildIds: bigint[],
): Promise<ComponentLicenseStatus> {
  const licenseIds = await getLicenseIds(provider, componentBuildIds)
  const balances =
    licenseIds.length > 0 ? await getLicenseBalances(provider, account, licenseIds) : []
  const missingComponentBuildIds: bigint[] = []
  const missingLicenseIds: bigint[] = []

  for (let i = 0; i < componentBuildIds.length; i++) {
    const licenseId = licenseIds[i] ?? 0n
    const balance = balances[i] ?? 0n
    if (licenseId === 0n || balance < 1n) {
      missingComponentBuildIds.push(componentBuildIds[i])
      if (licenseId > 0n) missingLicenseIds.push(licenseId)
    }
  }

  return {
    componentBuildIds,
    licenseIds,
    balances,
    missingComponentBuildIds,
    missingLicenseIds,
  }
}

export async function registerBuildLicenseIfOwner(
  provider: ethers.BrowserProvider,
  buildId: bigint,
): Promise<boolean> {
  const signer = await provider.getSigner()
  const registry = new ethers.Contract(CONTRACTS.LICENSE_REGISTRY, LICENSE_REGISTRY_ABI, signer)
  const build = new ethers.Contract(CONTRACTS.BUILD_NFT, BUILD_NFT_ABI, provider)

  const existing = await registry.licenseIdForBuild(buildId)
  if (existing > 0n) return false

  try {
    const exists = await build.exists(buildId).catch(() => null)
    if (exists === false) {
      throw new Error(
        `Build #${buildId.toString()} does not exist on the connected network. Check chain selection and component token IDs.`,
      )
    }

    await build.ownerOf(buildId)
  } catch (error: any) {
    throw new Error(
      `Cannot register license for build #${buildId.toString()}: ${error?.message || "build not found or not active on this chain"}`,
    )
  }

  const geometryHash = await build.geometryOf(buildId)
  const tx = await registry.registerBuild(buildId, geometryHash)
  await tx.wait()
  return true
}

export async function quoteLicenseForBuild(
  provider: ethers.BrowserProvider,
  buildId: bigint,
  qty = 1n,
): Promise<bigint> {
  const registry = new ethers.Contract(CONTRACTS.LICENSE_REGISTRY, LICENSE_REGISTRY_ABI, provider)
  return await registry.quote(buildId, qty)
}

export async function mintLicenseForBuild(
  provider: ethers.BrowserProvider,
  buildId: bigint,
  qty = 1n,
): Promise<ethers.ContractTransactionResponse> {
  const signer = await provider.getSigner()
  const registry = new ethers.Contract(CONTRACTS.LICENSE_REGISTRY, LICENSE_REGISTRY_ABI, signer)
  // V3: License fees are paid in ETH, not BLOX
  const price = await registry.quote(buildId, qty)
  return await registry.mintLicenseForBuild(buildId, qty, { value: price })
}

export interface LicensePurchaseResult {
  registeredBuilds: bigint[]
  purchasedBuilds: bigint[]
  txHashes: string[]
}

/**
 * Buy missing licenses for standalone use (outside of mint).
 * NOTE: In V3, BuildNFT.mint() atomically purchases licenses during _handleComponents,
 * so this is NOT needed before minting. Only use for pre-buying licenses separately.
 * License fees are now paid in ETH.
 */
export async function buyMissingLicensesForComponents(
  provider: ethers.BrowserProvider,
  account: string,
  componentBuildIds: bigint[],
): Promise<LicensePurchaseResult> {
  const uniqueBuildIds = Array.from(new Set(componentBuildIds.map((id) => id.toString()))).map(
    (id) => BigInt(id),
  )

  const statusBefore = await getComponentLicenseStatus(provider, account, uniqueBuildIds)
  const targetBuildIds = statusBefore.missingComponentBuildIds
  const result: LicensePurchaseResult = { registeredBuilds: [], purchasedBuilds: [], txHashes: [] }

  for (const buildId of targetBuildIds) {
    const licenseIdBefore = (
      await getLicenseIds(provider, [buildId])
    )[0] ?? 0n
    if (licenseIdBefore === 0n) {
      const registered = await registerBuildLicenseIfOwner(provider, buildId)
      if (registered) result.registeredBuilds.push(buildId)
    }

    const statusNow = await getComponentLicenseStatus(provider, account, [buildId])
    const hasLicense = (statusNow.balances[0] ?? 0n) >= 1n
    if (!hasLicense) {
      // V3: License fees paid in ETH
      const tx = await mintLicenseForBuild(provider, buildId, 1n)
      result.txHashes.push(tx.hash)
      await tx.wait()
      result.purchasedBuilds.push(buildId)
    }
  }

  return result
}

export async function isLicenseRequired(
  provider: ethers.BrowserProvider,
  componentTokenId: bigint,
): Promise<boolean> {
  if (CONTRACTS.LICENSE_REGISTRY === "0x0000000000000000000000000000000000000000") {
    return false
  }
  const ids = await getLicenseIds(provider, [componentTokenId])
  return ids.length > 0 && ids[0] > 0n
}

// ========== NEW: License NFT Functions ==========

export async function getLicenseBalance(
  provider: ethers.BrowserProvider,
  account: string,
  licenseId: bigint,
): Promise<bigint> {
  if (CONTRACTS.LICENSE_NFT === "0x0000000000000000000000000000000000000000") {
    return 0n
  }
  const contract = new ethers.Contract(CONTRACTS.LICENSE_NFT, LICENSE_NFT_ABI, provider)
  return await contract.balanceOf(account, licenseId)
}

export async function getLicenseBalances(
  provider: ethers.BrowserProvider,
  account: string,
  licenseIds: bigint[],
): Promise<bigint[]> {
  if (CONTRACTS.LICENSE_NFT === "0x0000000000000000000000000000000000000000") {
    return licenseIds.map(() => 0n)
  }
  const contract = new ethers.Contract(CONTRACTS.LICENSE_NFT, LICENSE_NFT_ABI, provider)
  const accounts = licenseIds.map(() => account)
  return await contract.balanceOfBatch(accounts, licenseIds)
}

export interface OwnedLicense {
  licenseId: bigint
  buildId: bigint
  balance: bigint
}

export async function getOwnedLicenses(
  provider: ethers.BrowserProvider,
  account: string,
): Promise<OwnedLicense[]> {
  if (
    CONTRACTS.LICENSE_NFT === "0x0000000000000000000000000000000000000000" ||
    CONTRACTS.LICENSE_REGISTRY === "0x0000000000000000000000000000000000000000"
  ) {
    return []
  }

  const registry = new ethers.Contract(CONTRACTS.LICENSE_REGISTRY, LICENSE_REGISTRY_ABI, provider)
  const licenseNft = new ethers.Contract(CONTRACTS.LICENSE_NFT, LICENSE_NFT_ABI, provider)
  const nextLicenseId = BigInt(await registry.nextLicenseId())
  if (nextLicenseId <= 1n) return []

  const licenseIds: bigint[] = []
  for (let id = 1n; id < nextLicenseId; id++) {
    licenseIds.push(id)
  }

  const balances = await licenseNft.balanceOfBatch(
    licenseIds.map(() => account),
    licenseIds,
  )

  const owned: OwnedLicense[] = []
  for (let i = 0; i < licenseIds.length; i++) {
    const bal = balances[i] ?? 0n
    if (bal > 0n) {
      const buildId = await registry.buildIdForLicense(licenseIds[i])
      owned.push({
        licenseId: licenseIds[i],
        buildId: BigInt(buildId),
        balance: BigInt(bal),
      })
    }
  }
  return owned
}

export async function approveLicenseNFT(
  provider: ethers.BrowserProvider,
  operator: string,
  approved: boolean,
): Promise<ethers.ContractTransactionResponse> {
  const signer = await provider.getSigner()
  const contract = new ethers.Contract(CONTRACTS.LICENSE_NFT, LICENSE_NFT_ABI, signer)
  return await contract.setApprovalForAll(operator, approved)
}

export async function isLicenseApproved(
  provider: ethers.BrowserProvider,
  account: string,
  operator: string,
): Promise<boolean> {
  if (CONTRACTS.LICENSE_NFT === "0x0000000000000000000000000000000000000000") {
    return true // No license contract = no approval needed
  }
  const contract = new ethers.Contract(CONTRACTS.LICENSE_NFT, LICENSE_NFT_ABI, provider)
  return await contract.isApprovedForAll(account, operator)
}

// ========== NEW: Build State Reading ==========

export interface BuildState {
  kind: number
  geometryHash: string
  lockedBlox: bigint
  brickSpec?: BrickSpec
}

export async function getBuildState(
  provider: ethers.BrowserProvider,
  tokenId: bigint,
): Promise<BuildState | null> {
  try {
    const contract = new ethers.Contract(CONTRACTS.BUILD_NFT, BUILD_NFT_ABI, provider)
    
    const [kind, geometryHash, lockedBlox] = await Promise.all([
      contract.kindOf(tokenId),
      contract.geometryOf(tokenId),
      contract.lockedBloxOf(tokenId),
    ])

  const state: BuildState = {
    kind: Number(kind),
    geometryHash,
    lockedBlox,
  }

  // If it's a brick (kind=0), fetch brick spec
  if (state.kind === BUILD_KIND.BRICK) {
    const [width, depth, density] = await contract.brickSpecOf(tokenId)
    state.brickSpec = {
      width: Number(width),
      depth: Number(depth),
      density: Number(density),
    }
  }

  return state
  } catch {
    // Token may not support getBuildState (e.g. test mints, non-burnable builds)
    return null
  }
}

export async function getEscrowedLicenses(
  provider: ethers.BrowserProvider,
  tokenId: bigint,
  licenseIds: bigint[],
): Promise<Map<bigint, bigint>> {
  const contract = new ethers.Contract(CONTRACTS.BUILD_NFT, BUILD_NFT_ABI, provider)
  const result = new Map<bigint, bigint>()
  
  for (const licenseId of licenseIds) {
    const amount = await contract.escrowedLicenses(tokenId, licenseId)
    if (amount > 0n) {
      result.set(licenseId, amount)
    }
  }
  
  return result
}

// ========== NEW: Distributor Functions ==========

export async function getPendingRewards(
  provider: ethers.BrowserProvider,
  account: string,
): Promise<bigint> {
  const distributor = await resolveDistributorAddress(provider)
  if (distributor === "0x0000000000000000000000000000000000000000") {
    return 0n
  }
  const contract = new ethers.Contract(distributor, DISTRIBUTOR_ABI, provider)
  return await contract.ethOwed(account)
}

export async function claimRewards(
  provider: ethers.BrowserProvider,
): Promise<ethers.ContractTransactionResponse> {
  const signer = await provider.getSigner()
  const distributor = await resolveDistributorAddress(provider)
  const contract = new ethers.Contract(distributor, DISTRIBUTOR_ABI, signer)
  return await contract.claim()
}

export async function getPendingLicenseRewards(
  provider: ethers.BrowserProvider,
  account: string,
  licenseIds: bigint[],
): Promise<{ total: bigint; perId: bigint[] }> {
  const distributor = await resolveDistributorAddress(provider)
  if (distributor === "0x0000000000000000000000000000000000000000" || licenseIds.length === 0) {
    return { total: 0n, perId: [] }
  }
  const contract = new ethers.Contract(distributor, DISTRIBUTOR_ABI, provider)
  const [total, perId] = await contract.pendingLicenseRewards(account, licenseIds)
  return { total, perId }
}

export async function claimLicenseRewards(
  provider: ethers.BrowserProvider,
  licenseIds: bigint[],
): Promise<ethers.ContractTransactionResponse> {
  const signer = await provider.getSigner()
  const distributor = await resolveDistributorAddress(provider)
  const contract = new ethers.Contract(distributor, DISTRIBUTOR_ABI, signer)
  return await contract.claimLicenseRewards(licenseIds)
}

// ========== NEW: Validation Helpers ==========

export function calculateBloxLock(mass: number): bigint {
  return BigInt(mass) * 10n ** BLOX_DECIMALS
}

export function canBurn(kind: number): boolean {
  // Only builds (kind > 0) can be burned, not bricks (kind = 0)
  return kind > BUILD_KIND.BRICK
}

export async function getUserMintedBuilds(
  provider: ethers.BrowserProvider,
  address: string,
): Promise<Array<{ tokenId: string; tokenURI: string }>> {
  try {
    console.log("[v0] Fetching minted builds for address:", address)
    const contract = new ethers.Contract(CONTRACTS.BUILD_NFT, BUILD_NFT_ABI, provider)

    // Query Transfer events where 'to' is the user's address
    const filter = contract.filters.Transfer(null, address)
    const currentBlock = await provider.getBlockNumber()
    const fromBlock = Math.max(0, currentBlock - 10000) // Last ~10k blocks (adjust if needed)

    console.log("[v0] Querying Transfer events from block", fromBlock, "to", currentBlock)
    const events = await contract.queryFilter(filter, fromBlock, currentBlock)
    console.log("[v0] Found", events.length, "Transfer events")

    // Collect unique token IDs and verify current ownership
    const tokenIds = new Set<bigint>()
    for (const event of events) {
      if (event.args && event.args.tokenId) {
        tokenIds.add(event.args.tokenId)
      }
    }

    console.log(
      "[v0] Unique token IDs from events:",
      Array.from(tokenIds).map((id) => id.toString()),
    )

    // Verify ownership and fetch metadata
    const builds = []
    for (const tokenId of tokenIds) {
      try {
        const owner = await contract.ownerOf(tokenId)
        if (owner.toLowerCase() === address.toLowerCase()) {
          const tokenURI = await contract.tokenURI(tokenId)
          builds.push({
            tokenId: tokenId.toString(),
            tokenURI,
          })
          console.log("[v0] Confirmed ownership of token", tokenId.toString())
        } else {
          console.log("[v0] Token", tokenId.toString(), "no longer owned by user")
        }
      } catch (error) {
        console.log("[v0] Token", tokenId.toString(), "may not exist or is not accessible")
      }
    }

    console.log("[v0] Final builds owned by user:", builds.length)
    return builds
  } catch (error) {
    console.error("[v0] Error fetching minted builds:", error)
    return []
  }
}

export async function getAllMintedBuilds(
  provider: ethers.BrowserProvider,
): Promise<Array<{ tokenId: string; owner: string; tokenURI: string }>> {
  try {
    console.log("[v0] Fetching all minted builds for gallery")
    const contract = new ethers.Contract(CONTRACTS.BUILD_NFT, BUILD_NFT_ABI, provider)

    const currentBlock = await provider.getBlockNumber()
    const CHUNK_SIZE = 50000 // Safe chunk size under 100k limit
    const allEvents: ethers.EventLog[] = []

    // Query from contract deployment or recent history
    // For Base Sepolia, we'll query from a reasonable starting point
    const deploymentBlock = 0 // You can set this to the actual deployment block if known

    console.log("[v0] Querying mint events in chunks from block", deploymentBlock, "to", currentBlock)

    for (let fromBlock = deploymentBlock; fromBlock <= currentBlock; fromBlock += CHUNK_SIZE) {
      const toBlock = Math.min(fromBlock + CHUNK_SIZE - 1, currentBlock)
      console.log(`[v0] Querying chunk: blocks ${fromBlock} to ${toBlock}`)

      try {
        const filter = contract.filters.Transfer(ethers.ZeroAddress, null)
        const events = await contract.queryFilter(filter, fromBlock, toBlock)
        allEvents.push(...(events as ethers.EventLog[]))
        console.log(`[v0] Found ${events.length} events in this chunk`)
      } catch (chunkError) {
        console.error(`[v0] Error querying chunk ${fromBlock}-${toBlock}:`, chunkError)
        // Continue with next chunk even if one fails
      }
    }

    console.log("[v0] Found", allEvents.length, "total mint events")

    // Collect token data with ownership verification
    const builds = []
    const processedTokens = new Set<string>()

    for (const event of allEvents) {
      if (event.args && event.args.tokenId) {
        const tokenId = event.args.tokenId.toString()

        // Skip if already processed
        if (processedTokens.has(tokenId)) continue
        processedTokens.add(tokenId)

        try {
          // Verify token still exists and get current owner
          const owner = await contract.ownerOf(tokenId)
          const tokenURI = await contract.tokenURI(tokenId)

          builds.push({
            tokenId,
            owner,
            tokenURI,
          })
          console.log("[v0] Added token", tokenId, "owned by", owner)
        } catch (error) {
          console.log("[v0] Token", tokenId, "may have been burned or is not accessible")
        }
      }
    }

    console.log("[v0] Total minted builds in gallery:", builds.length)
    // Sort by tokenId descending (newest first)
    return builds.sort((a, b) => Number(b.tokenId) - Number(a.tokenId))
  } catch (error) {
    console.error("[v0] Error fetching all minted builds:", error)
    return []
  }
}
