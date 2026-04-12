#!/usr/bin/env node
import { ethers } from "ethers";

const RPC_URL = process.env.RPC_URL || "https://sepolia.base.org";
const APP_URL = (process.env.APP_URL || "https://buidl-app-psi.vercel.app").replace(/\/+$/, "");
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const BUILD_NFT = (process.env.BUILD_NFT || "0xBFb4DF18dd2b1f25a627028682F3984a5F5813aa").toLowerCase();
const DENSITY = Number(process.env.DENSITY || "1");
const TARGET_MINTS = Number(process.env.TARGET_MINTS || "5");
const FEE_PER_MINT = ethers.parseEther(process.env.FEE_PER_MINT_ETH || "0.001");

if (!PRIVATE_KEY) {
  console.error("Missing PRIVATE_KEY");
  process.exit(1);
}

const buildAbi = [
  "function nextTokenId() view returns (uint256)",
  "function brickSpecConsumed(bytes32) view returns (bool)",
  "function kindOf(uint256) view returns (uint8)",
  "function brickSpecOf(uint256) view returns (uint8 width, uint8 depth, uint16 density)",
  "function mint(bytes32 geometryHash, uint256 mass, string uri, uint256[] componentBuildIds, uint256[] componentCounts, uint8 kind, uint8 width, uint8 depth, uint16 density) payable returns (uint256)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function blox() view returns (address)",
  "function licenseNFT() view returns (address)",
  "function licenseRegistry() view returns (address)",
];
const bloxAbi = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
];
const licenseNftAbi = [
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
  "function setApprovalForAll(address operator, bool approved)",
  "function balanceOf(address account, uint256 id) view returns (uint256)",
];
const registryAbi = [
  "function licenseIdForBuild(uint256 buildId) view returns (uint256)",
  "function buildIdForLicense(uint256 licenseId) view returns (uint256)",
  "function nextLicenseId() view returns (uint256)",
  "function quote(uint256 buildId, uint256 qty) view returns (uint256)",
  "function mintLicenseForBuild(uint256 buildId, uint256 qty)",
];

const provider = new ethers.JsonRpcProvider(RPC_URL);
const signer = new ethers.Wallet(PRIVATE_KEY, provider);
const build = new ethers.Contract(BUILD_NFT, buildAbi, signer);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function brickHash(width, depth, density) {
  const w = Math.min(width, depth);
  const d = Math.max(width, depth);
  return ethers.keccak256(ethers.solidityPacked(["uint8", "uint8", "uint16"], [w, d, density]));
}

async function fetchJson(url, opts = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    return { ok: res.ok, status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

async function getLicenseHoldings() {
  const bloxAddr = String(await build.blox()).toLowerCase();
  const licenseNftAddr = String(await build.licenseNFT()).toLowerCase();
  const registryAddr = String(await build.licenseRegistry()).toLowerCase();

  const blox = new ethers.Contract(bloxAddr, bloxAbi, signer);
  const licenseNft = new ethers.Contract(licenseNftAddr, licenseNftAbi, signer);
  const registry = new ethers.Contract(registryAddr, registryAbi, signer);

  const components = [];
  const nextTokenId = Number(await build.nextTokenId());
  for (let tokenId = 1; tokenId < nextTokenId; tokenId++) {
    let kind = 255;
    try {
      kind = Number(await build.kindOf(tokenId));
    } catch {
      continue;
    }
    if (kind !== 0) continue;
    let spec;
    try {
      spec = await build.brickSpecOf(tokenId);
    } catch {
      continue;
    }
    const density = Number(spec.density);
    if (density !== DENSITY) continue;
    const area = Number(spec.width) * Number(spec.depth);
    if (area <= 0) continue;

    const buildId = BigInt(tokenId);
    const licenseId = BigInt(await registry.licenseIdForBuild(buildId));
    const balance = licenseId > 0n ? Number(await licenseNft.balanceOf(signer.address, licenseId)) : 0;
    components.push({
      licenseId,
      buildId,
      balance,
      area,
      width: Number(spec.width),
      depth: Number(spec.depth),
    });
  }
  components.sort((a, b) => {
    if (b.balance !== a.balance) return b.balance - a.balance;
    if (a.area !== b.area) return a.area - b.area;
    return Number(a.buildId - b.buildId);
  });
  return { blox, licenseNft, registry, components };
}

async function chooseSpecsForComponents(components, targetCount) {
  const chosen = [];
  const usedAreas = new Set();
  for (const comp of components) {
    for (let w = 1; w <= 10 && chosen.length < targetCount; w++) {
      for (let d = w; d <= 10 && chosen.length < targetCount; d++) {
        const area = w * d;
        if (area <= 1 || area % comp.area !== 0) continue;
        if (usedAreas.has(`${w}x${d}`)) continue;
        const h = brickHash(w, d, DENSITY);
        const used = await build.brickSpecConsumed(h);
        if (used) continue;
        chosen.push({
          w,
          d,
          area,
          geometryHash: h,
          componentBuildId: comp.buildId,
          componentArea: comp.area,
          componentCount: area / comp.area,
        });
        usedAreas.add(`${w}x${d}`);
      }
    }
  }
  return chosen.slice(0, targetCount);
}

function computeNeededLicenses(specs) {
  const needed = new Map();
  for (const spec of specs) {
    const key = String(spec.componentBuildId);
    needed.set(key, (needed.get(key) || 0) + 1);
  }
  return needed;
}

async function autoBuyMissingLicenses(specs, components, registry, blox) {
  const byBuild = new Map(components.map((c) => [String(c.buildId), c]));
  const needed = computeNeededLicenses(specs);
  const buys = [];
  let totalCost = 0n;
  for (const [buildId, qtyNeeded] of needed.entries()) {
    const comp = byBuild.get(buildId);
    const current = comp?.balance || 0;
    const missing = qtyNeeded - current;
    if (missing <= 0) continue;
    const quoted = await registry.quote(BigInt(buildId), BigInt(missing));
    totalCost += BigInt(quoted);
    buys.push({ buildId: BigInt(buildId), qty: BigInt(missing), quote: BigInt(quoted) });
  }

  if (buys.length === 0) {
    return;
  }

  const allowance = await blox.allowance(signer.address, registry.target);
  if (allowance < totalCost) {
    const tx = await blox.approve(registry.target, totalCost * 2n);
    await tx.wait();
    console.log(`Approved BLOX allowance for registry: ${tx.hash}`);
  }

  for (const buy of buys) {
    console.log(
      `Buying licenses: build=${buy.buildId.toString()} qty=${buy.qty.toString()} quote=${buy.quote.toString()}`
    );
    const tx = await registry.mintLicenseForBuild(buy.buildId, buy.qty);
    await tx.wait();
    console.log(`License buy tx: ${tx.hash}`);
  }
}

async function ensureApprovals(specs, blox, licenseNft, registry, components) {
  await autoBuyMissingLicenses(specs, components, registry, blox);

  const totalMass = specs.reduce((sum, s) => sum + BigInt(s.area * DENSITY), 0n);
  const totalLock = totalMass * 10n ** 18n;
  const allowance = await blox.allowance(signer.address, build.target);
  if (allowance < totalLock) {
    const tx = await blox.approve(build.target, totalLock * 2n);
    await tx.wait();
    console.log(`Approved BLOX allowance: ${tx.hash}`);
  }

  const approvedForAll = await licenseNft.isApprovedForAll(signer.address, BUILD_NFT);
  if (!approvedForAll) {
    const tx = await licenseNft.setApprovalForAll(BUILD_NFT, true);
    await tx.wait();
    console.log(`Approved LicenseNFT for BuildNFT: ${tx.hash}`);
  }
}

async function saveMintToApp({ tokenId, spec, txHash }) {
  const body = {
    tokenId: String(tokenId),
    buildHash: spec.geometryHash,
    txHash,
    walletAddress: signer.address.toLowerCase(),
    buildName: `${spec.w}x${spec.d}-D${DENSITY}`,
    bricks: [{ id: "1", position: [0, 0.5, 0], color: "#2563eb", width: spec.w, depth: spec.d }],
    baseWidth: spec.w,
    baseDepth: spec.d,
    mass: spec.area * DENSITY,
    colors: 1,
    bw_score: Number((Math.log(1 + spec.area * DENSITY) * Math.log(3)).toFixed(2)),
    kind: 0,
    density: DENSITY,
    brickWidth: spec.w,
    brickDepth: spec.d,
    composition: { [String(spec.componentBuildId)]: { count: spec.componentCount, name: `${spec.w}x${spec.d}-D${DENSITY}` } },
    geometryHash: spec.geometryHash,
    componentBuildIds: [String(spec.componentBuildId)],
    componentCounts: [String(spec.componentCount)],
    metadata: {
      buildWidth: spec.w,
      buildDepth: spec.d,
      totalBricks: 1,
      totalInstances: spec.area,
      nftsUsed: 1,
    },
  };

  const res = await fetchJson(`${APP_URL}/api/builds/mint`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, 45000);
  return res;
}

async function verifyToken(tokenId) {
  const tokenUri = String(await build.tokenURI(tokenId));
  const meta = await fetchJson(tokenUri, {}, 30000);
  let imageUrl = "";
  let imageProbe = { ok: false, status: 0 };
  if (meta.json && typeof meta.json === "object" && meta.json.image) {
    const image = String(meta.json.image);
    if (image.startsWith("ipfs://")) {
      imageUrl = `https://dweb.link/ipfs/${image.slice("ipfs://".length)}`;
    } else {
      imageUrl = image;
    }
    const probe = await fetchJson(imageUrl, { method: "HEAD" }, 20000);
    imageProbe = { ok: probe.ok, status: probe.status };
  }
  return {
    tokenUri,
    metaOk: meta.ok,
    metaStatus: meta.status,
    imageUrl,
    imageOk: imageProbe.ok,
    imageStatus: imageProbe.status,
  };
}

async function mintWithRetry(spec, maxAttempts = 2) {
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const tx = await build.mint(
        spec.geometryHash,
        BigInt(spec.area * DENSITY),
        "",
        [spec.componentBuildId],
        [BigInt(spec.componentCount)],
        0,
        spec.w,
        spec.d,
        DENSITY,
        { value: FEE_PER_MINT },
      );
      const rc = await tx.wait();
      return { txHash: tx.hash, receipt: rc };
    } catch (err) {
      lastErr = err;
      const msg = String(err?.shortMessage || err?.message || "");
      const retryable = msg.includes("nonce has already been used") || msg.includes("nonce too low");
      if (!retryable || attempt >= maxAttempts) break;
      await sleep(1200);
    }
  }
  throw lastErr;
}

async function main() {
  console.log(`Pipeline start: signer=${signer.address} build=${BUILD_NFT} app=${APP_URL}`);
  const { blox, licenseNft, registry, components } = await getLicenseHoldings();
  console.log(`Component catalog size: ${components.length}`);
  const specs = await chooseSpecsForComponents(components, TARGET_MINTS);
  if (specs.length < TARGET_MINTS) {
    throw new Error(`Found only ${specs.length} available unminted specs; need ${TARGET_MINTS}`);
  }
  console.log("Chosen specs:", specs.map((s) => `${s.w}x${s.d}-D${DENSITY}[c:${s.componentBuildId}x${s.componentCount}]`).join(", "));

  await ensureApprovals(specs, blox, licenseNft, registry, components);

  const results = [];
  for (const spec of specs) {
    const nextId = await build.nextTokenId();
    console.log(`\n[Mint] target token=${nextId.toString()} spec=${spec.w}x${spec.d}-D${DENSITY}`);

    let txHash = "";
    let mintOk = false;
    try {
      const { txHash: hash, receipt: rc } = await mintWithRetry(spec);
      txHash = hash;
      mintOk = !!rc && rc.status === 1;
      console.log(`Mint tx: ${txHash} status=${rc?.status ?? "?"}`);
    } catch (err) {
      console.error(`Mint failed for ${spec.w}x${spec.d}-D${DENSITY}:`, err?.shortMessage || err?.message || err);
      results.push({ spec: `${spec.w}x${spec.d}-D${DENSITY}`, mintOk: false, error: String(err?.message || err) });
      continue;
    }

    const saveRes = await saveMintToApp({ tokenId: nextId, spec, txHash });
    const saveOk = saveRes.ok && saveRes.json && saveRes.json.success === true;
    console.log(`App sync: http=${saveRes.status} saveOk=${saveOk ? "yes" : "no"}`);
    if (!saveOk) {
      console.log("App sync payload:", JSON.stringify(saveRes.json));
    }

    await sleep(1200);
    const verify = await verifyToken(nextId);
    console.log(
      `Verify token=${nextId.toString()} meta=${verify.metaStatus}/${verify.metaOk ? "ok" : "bad"} image=${verify.imageStatus}/${verify.imageOk ? "ok" : "bad"}`
    );

    results.push({
      tokenId: nextId.toString(),
      spec: `${spec.w}x${spec.d}-D${DENSITY}`,
      txHash,
      mintOk,
      saveOk,
      tokenUri: verify.tokenUri,
      metaStatus: verify.metaStatus,
      imageStatus: verify.imageStatus,
      imageUrl: verify.imageUrl,
    });
  }

  console.log("\n=== Pipeline Summary ===");
  for (const r of results) {
    console.log(JSON.stringify(r));
  }
  const good = results.filter((r) => r.mintOk && r.saveOk && r.metaStatus === 200).length;
  console.log(`Pass: ${good}/${results.length}`);
}

main().catch((err) => {
  console.error("Pipeline failed:", err?.shortMessage || err?.message || err);
  process.exit(1);
});
