#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

class RestRedis {
  constructor({ url, token }) {
    this.url = String(url || "").replace(/\/+$/, "");
    this.token = String(token || "").trim();
  }

  async command(args) {
    const res = await fetch(this.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
    });
    if (!res.ok) throw new Error(`Upstash command failed (${res.status})`);
    const json = await res.json().catch(() => null);
    if (json && json.error) throw new Error(`Upstash error: ${json.error}`);
    return json?.result;
  }

  parseMaybeJson(value) {
    if (typeof value !== "string") return value;
    const t = value.trim();
    if (!t) return value;
    if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
      try {
        return JSON.parse(t);
      } catch {
        return value;
      }
    }
    return value;
  }

  async get(key) {
    const v = await this.command(["GET", key]);
    return this.parseMaybeJson(v);
  }

  async smembers(key) {
    const v = await this.command(["SMEMBERS", key]);
    return Array.isArray(v) ? v : [];
  }

  async keys(pattern) {
    const v = await this.command(["KEYS", pattern]);
    return Array.isArray(v) ? v : [];
  }
}

function loadDotEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trim().startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx < 1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    // Always apply .env.local values in file order so later duplicate keys override earlier ones.
    process.env[key] = val;
  }
}

function parseArgs(argv) {
  const out = {
    from: 1,
    to: null,
    setBase: false,
    dryRun: false,
    outDir: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--from" && argv[i + 1]) out.from = Number(argv[++i]);
    else if (a === "--to" && argv[i + 1]) out.to = Number(argv[++i]);
    else if (a === "--set-base") out.setBase = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--out-dir" && argv[i + 1]) out.outDir = argv[++i];
  }
  return out;
}

function jsonAttr(trait_type, value) {
  return { trait_type, value };
}

function buildAnimationUrl(tokenId) {
  return `./${tokenId}.html`;
}

function resolveAppBaseUrl() {
  const explicit =
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_APP_ORIGIN ||
    "";
  if (explicit) return String(explicit).replace(/\/+$/, "");

  const vercelProd = String(process.env.VERCEL_PROJECT_PRODUCTION_URL || "").trim();
  if (vercelProd) return `https://${vercelProd.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;

  const vercelUrl = String(process.env.VERCEL_URL || "").trim();
  if (vercelUrl) return `https://${vercelUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;

  return "";
}

function buildMetadata(build, tokenId, appBaseUrl, imagesCid) {
  const kind = Number(build?.kind ?? 0);
  const kindLabel = kind === 0 ? "Brick" : kind === 2 ? "Collectors Edition" : "Build";
  const w = Number(build?.brickWidth ?? build?.baseWidth ?? 1);
  const d = Number(build?.brickDepth ?? build?.baseDepth ?? 1);
  const density = Number(build?.density ?? 1);
  const mass = Number(build?.mass ?? w * d * density);
  const name =
    build?.name && String(build.name).trim().length > 0
      ? String(build.name).trim()
      : kind === 0
        ? `Brick ${Math.min(w, d)}x${Math.max(w, d)} D${density}`
        : `BASEBLOX ${kindLabel} #${tokenId}`;

  const attributes = [
    jsonAttr("kind", kindLabel),
    jsonAttr("kindId", kind),
    jsonAttr("mass", mass),
    jsonAttr("density", density),
    jsonAttr("width", w),
    jsonAttr("depth", d),
  ];

  if (build?.geometryHash) attributes.push(jsonAttr("geometryHash", String(build.geometryHash)));
  if (build?.specKey) attributes.push(jsonAttr("specKey", String(build.specKey)));
  if (build?.bw_score !== undefined && build?.bw_score !== null) {
    attributes.push(jsonAttr("bw_score", Number(build.bw_score)));
  }

  const composition = build?.composition && typeof build.composition === "object" ? build.composition : {};
  const componentIds = [];
  const componentCounts = [];
  for (const [tid, info] of Object.entries(composition)) {
    const count = Number(info?.count ?? 0);
    if (!tid || !Number.isFinite(count) || count <= 0) continue;
    componentIds.push(String(tid));
    componentCounts.push(count);
  }
  if (componentIds.length > 0) {
    attributes.push(jsonAttr("componentBuildIds", componentIds.join(",")));
    attributes.push(jsonAttr("componentCounts", componentCounts.join(",")));
  }

  const imageFromBuild = String(build?.ipfsImageUri || "").trim();
  const usableBuildImage =
    imageFromBuild && !/\.svg(\?.*)?$/i.test(imageFromBuild) ? imageFromBuild : "";
  const image = usableBuildImage
    ? usableBuildImage
    : appBaseUrl
      ? `${appBaseUrl}/api/builds/image/${tokenId}`
      : imagesCid
        ? `ipfs://${imagesCid}/${tokenId}.png`
        : `https://ethblox-app-delta.vercel.app/api/builds/image/${tokenId}`;
  const externalUrl = appBaseUrl ? `${appBaseUrl}/explore/${tokenId}` : undefined;

  return {
    name,
    description: `BASEBLOX ${kindLabel} - ${w}x${d} density ${density}`,
    image,
    ...(externalUrl ? { external_url: externalUrl } : {}),
    attributes,
  };
}

function buildTokenHtml(tokenId) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>BASEBLOX #${tokenId}</title>
  <style>
    html, body { margin: 0; height: 100%; background: #0b183a; color: #dbeafe; font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; }
    #app { width: 100%; height: 100%; position: relative; overflow: hidden; }
    #hud { position: absolute; top: 8px; left: 8px; right: 8px; z-index: 10; display: flex; justify-content: space-between; gap: 8px; pointer-events: none; }
    .pill { background: rgba(15,23,42,.72); border: 1px solid rgba(148,163,184,.35); border-radius: 8px; padding: 4px 8px; font-size: 12px; }
    #msg { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 13px; color: #93c5fd; }
    canvas { display:block; }
  </style>
  <script src="./three.min.js"></script>
</head>
<body>
  <div id="app">
    <div id="hud">
      <div class="pill" id="name">BASEBLOX #${tokenId}</div>
      <div class="pill" id="stats">Loading...</div>
    </div>
    <div id="msg">Loading metadata...</div>
  </div>
  <script>
    (async () => {
      const app = document.getElementById("app");
      const msg = document.getElementById("msg");
      const nameEl = document.getElementById("name");
      const statsEl = document.getElementById("stats");
      let meta = null;
      try {
        const r = await fetch("./${tokenId}.json", { cache: "no-store" });
        if (!r.ok) throw new Error("metadata " + r.status);
        meta = await r.json();
      } catch (e) {
        msg.textContent = "Metadata unavailable";
        console.error(e);
        return;
      }
      nameEl.textContent = meta.name || "BASEBLOX #${tokenId}";
      const attrs = {};
      for (const a of (meta.attributes || [])) {
        if (!a || typeof a !== "object") continue;
        attrs[String(a.trait_type || "")] = a.value;
      }
      const kind = Number(attrs.kindId ?? 1);
      const width = Math.max(1, Number(attrs.width ?? 1));
      const depth = Math.max(1, Number(attrs.depth ?? 1));
      const mass = Number(attrs.mass ?? (width * depth));
      const density = Number(attrs.density ?? 1);
      statsEl.textContent = "kind=" + kind + " | " + width + "x" + depth + " | mass=" + mass + " | d=" + density;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0b183a);
      const camera = new THREE.PerspectiveCamera(45, app.clientWidth / app.clientHeight, 0.1, 1000);
      camera.position.set(8, 6, 8);
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      renderer.setSize(app.clientWidth, app.clientHeight);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      app.appendChild(renderer.domElement);

      scene.add(new THREE.HemisphereLight(0xdbeafe, 0x0b183a, 1.1));
      const key = new THREE.DirectionalLight(0xffffff, 1.15);
      key.position.set(6, 10, 6);
      scene.add(key);

      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(50, 50),
        new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.95, metalness: 0.05 })
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -0.501;
      scene.add(floor);

      function addBrick(w, d, color = 0x2563eb) {
        const body = new THREE.Mesh(
          new THREE.BoxGeometry(w, 1, d),
          new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.15 })
        );
        scene.add(body);
        const studGeom = new THREE.SphereGeometry(0.2, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2);
        const studMat = new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.35, metalness: 0.1 });
        for (let x = 0; x < w; x++) {
          for (let z = 0; z < d; z++) {
            const s = new THREE.Mesh(studGeom, studMat);
            s.position.set(-w / 2 + x + 0.5, 0.5, -d / 2 + z + 0.5);
            scene.add(s);
          }
        }
      }
      function addBuildCluster(m) {
        const n = Math.max(6, Math.min(90, Math.round(m / 2)));
        const g = new THREE.BoxGeometry(0.8, 0.8, 0.8);
        const mat = new THREE.MeshStandardMaterial({ color: 0x60a5fa, roughness: 0.4, metalness: 0.08, transparent: true, opacity: 0.95 });
        for (let i = 0; i < n; i++) {
          const b = new THREE.Mesh(g, mat);
          b.position.set((Math.random()-0.5)*5.5, (Math.random()-0.1)*2.5, (Math.random()-0.5)*5.5);
          scene.add(b);
        }
      }
      if (kind === 0) addBrick(width, depth);
      else addBuildCluster(mass);

      const box = new THREE.Box3().setFromObject(scene);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      scene.position.sub(center);
      const maxDim = Math.max(size.x, size.y, size.z);
      camera.position.set(maxDim * 1.4, maxDim * 1.1, maxDim * 1.5);
      camera.lookAt(0, 0, 0);
      msg.remove();

      let t = 0;
      function animate() {
        t += 0.0055;
        camera.position.x = Math.cos(t) * (maxDim * 1.8);
        camera.position.z = Math.sin(t) * (maxDim * 1.8);
        camera.lookAt(0, 0, 0);
        renderer.render(scene, camera);
        requestAnimationFrame(animate);
      }
      animate();
      window.addEventListener("resize", () => {
        camera.aspect = app.clientWidth / app.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(app.clientWidth, app.clientHeight);
      });
    })();
  </script>
</body>
</html>`;
}

function parseIpfsAddResponse(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed);
      const cid = obj.IpfsHash || obj.Hash || null;
      return { folderCid: cid, raw: obj };
    } catch {
      // fall through to NDJSON parsing
    }
  }
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const rows = [];
  for (const line of lines) {
    try {
      rows.push(JSON.parse(line));
    } catch {
      // ignore non-json lines
    }
  }
  const finalRow = rows[rows.length - 1] || null;
  const folderCid = finalRow?.IpfsHash || finalRow?.Hash || null;
  return { rows, folderCid, raw: finalRow };
}

async function postWithRetry(url, makeRequest, options = {}) {
  const retries = Number(options.retries ?? 4);
  const timeoutMs = Number(options.timeoutMs ?? 25000);
  let lastErr = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await makeRequest({ url, timeoutMs, attempt });
      if (res.ok) return res;
      const errText = await res.text();
      lastErr = new Error(`HTTP ${res.status}: ${errText}`);
    } catch (err) {
      lastErr = err;
    }
    if (attempt < retries) {
      const backoffMs = 700 * attempt;
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastErr || new Error("request failed");
}

function makeMetadataFormData(outDir, fileNames, rootDirName) {
  const formData = new FormData();
  formData.append("pinataOptions", JSON.stringify({ cidVersion: 1, wrapWithDirectory: true }));
  for (const fileName of fileNames) {
    const fullPath = path.join(outDir, fileName);
    const body = fs.readFileSync(fullPath);
    const isHtml = fileName.endsWith(".html");
    const isJs = fileName.endsWith(".js");
    const contentType = isHtml ? "text/html" : isJs ? "text/javascript" : "application/json";
    formData.append("file", new Blob([body], { type: contentType }), `${rootDirName}/${fileName}`);
  }
  return formData;
}

async function collectTokenIdsFromRedisFallback(redis, style, from, to) {
  const out = new Set();

  // token:<id> -> buildId mappings
  const tokenKeys = await redis.keys(style.token("*"));
  for (const key of tokenKeys || []) {
    const m = String(key).match(/token:(\d+)$/);
    if (!m) continue;
    const id = Number(m[1]);
    if (!Number.isFinite(id)) continue;
    if (id < from) continue;
    if (to != null && id > to) continue;
    out.add(id);
  }

  // build:* objects with tokenId fields
  const buildKeys = await redis.keys(style.build("*"));
  for (const key of buildKeys || []) {
    if (String(key).includes("build:token:") || String(key).includes("build:hash:")) continue;
    const build = await redis.get(key);
    if (!build || typeof build !== "object") continue;
    const id = Number(build.tokenId);
    if (!Number.isFinite(id)) continue;
    if (id < from) continue;
    if (to != null && id > to) continue;
    out.add(id);
  }

  return [...out].sort((a, b) => a - b);
}

async function main() {
  loadDotEnvLocal();
  const args = parseArgs(process.argv.slice(2));

  const chainId = String(process.env.NEXT_PUBLIC_CHAIN_ID || "84532");
  const redisPrefix = process.env.REDIS_KEY_PREFIX || "";
  const appBaseUrl = resolveAppBaseUrl();
  const imagesCid = (process.env.NEXT_PUBLIC_IMAGES_CID || process.env.IMAGES_CID || "").trim();

  const buildNft = process.env.NEXT_PUBLIC_BUILDNFT_ADDRESS;
  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || process.env.NEXT_PUBLIC_RPC_URL;
  const ownerPk = process.env.PRIVATE_KEY || process.env.BASE_TOKEN_URI_OWNER_KEY;
  const ipfsApiToken = process.env.PINATA_JWT || process.env.LIGHTHOUSE_API_KEY;
  const ipfsUploadUrl =
    process.env.IPFS_UPLOAD_URL ||
    process.env.LIGHTHOUSE_UPLOAD_URL ||
    "https://api.pinata.cloud/pinning/pinFileToIPFS";
  const pinataGatewayBase =
    process.env.PINATA_GATEWAY_BASE || "https://gateway.pinata.cloud/ipfs";
  const ipfsTimeoutMs = Number(process.env.IPFS_UPLOAD_TIMEOUT_MS || "30000");
  const ipfsRetries = Number(process.env.IPFS_UPLOAD_RETRIES || "4");
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  if (!kvUrl || !kvToken) throw new Error("Missing KV_REST_API_URL / KV_REST_API_TOKEN");
  if (!ipfsApiToken && !args.dryRun) throw new Error("Missing PINATA_JWT (or LIGHTHOUSE_API_KEY)");
  if (!args.dryRun && ipfsApiToken && String(ipfsApiToken).split(".").length !== 3) {
    throw new Error("PINATA_JWT is malformed (expected 3 JWT segments)");
  }

  const redis = new RestRedis({ url: kvUrl, token: kvToken });
  const keyStyleA = {
    minted: `ethblox:${chainId}:minted_tokens`,
    token: (id) => `ethblox:${chainId}:token:${id}`,
    build: (id) => `ethblox:${chainId}:build:${id}`,
  };
  const keyStyleB = {
    minted: `${redisPrefix}minted_tokens`,
    token: (id) => `${redisPrefix}token:${id}`,
    build: (id) => `${redisPrefix}build:${id}`,
  };

  let minted = await redis.smembers(keyStyleA.minted);
  let style = keyStyleA;
  if (!minted || minted.length === 0) {
    minted = await redis.smembers(keyStyleB.minted);
    style = keyStyleB;
  }
  const tokenIds = (minted || [])
    .map(String)
    .filter((v) => /^\d+$/.test(v))
    .map((v) => Number(v))
    .filter((v) => v >= args.from && (args.to == null || v <= args.to))
    .sort((a, b) => a - b);

  if (tokenIds.length === 0) {
    const fallbackForStyle = await collectTokenIdsFromRedisFallback(
      redis,
      style,
      args.from,
      args.to,
    );
    if (fallbackForStyle.length > 0) {
      tokenIds.push(...fallbackForStyle);
    } else {
      const alternate = style === keyStyleA ? keyStyleB : keyStyleA;
      const fallbackAlternate = await collectTokenIdsFromRedisFallback(
        redis,
        alternate,
        args.from,
        args.to,
      );
      if (fallbackAlternate.length > 0) {
        style = alternate;
        tokenIds.push(...fallbackAlternate);
      }
    }
  }

  if (tokenIds.length === 0) throw new Error("No minted tokens found in selected range");

  const runLabel = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = args.outDir || path.join("/tmp", "metadata-batch", runLabel);
  fs.mkdirSync(outDir, { recursive: true });

  let written = 0;
  for (const tokenId of tokenIds) {
    const buildId = await redis.get(style.token(String(tokenId)));
    if (!buildId) continue;
    const build = await redis.get(style.build(String(buildId)));
    if (!build || typeof build !== "object") continue;
    const metadata = buildMetadata(build, String(tokenId), appBaseUrl, imagesCid);
    fs.writeFileSync(path.join(outDir, `${tokenId}.json`), JSON.stringify(metadata, null, 2));
    written++;
  }

  if (written === 0) throw new Error("No metadata files were generated from Redis records");
  console.log(`Generated ${written} metadata files in: ${outDir}`);

  if (args.dryRun) {
    console.log("Dry run complete. No IPFS upload and no base URI update.");
    return;
  }

  const rootDirName = path.basename(outDir);
  const fileNames = fs.readdirSync(outDir).filter((f) => f.endsWith(".json")).sort();
  const uploadRes = await postWithRetry(
    ipfsUploadUrl,
    async ({ timeoutMs }) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await fetch(ipfsUploadUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${ipfsApiToken}` },
          body: makeMetadataFormData(outDir, fileNames, rootDirName),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    },
    { retries: ipfsRetries, timeoutMs: ipfsTimeoutMs },
  );
  const rawText = await uploadRes.text();
  const parsed = parseIpfsAddResponse(rawText);
  if (!parsed.folderCid) throw new Error(`Could not parse folder CID from IPFS response: ${rawText}`);
  const folderCid = parsed.folderCid;
  const baseUri = `ipfs://${folderCid}/${rootDirName}`;
  console.log(`Uploaded metadata folder CID: ${folderCid}`);
  console.log(`Gateway URL: ${pinataGatewayBase}/${folderCid}/${rootDirName}`);
  console.log(`Base URI candidate: ${baseUri}`);

  if (!args.setBase) {
    console.log("Skipping on-chain base URI update (use --set-base to enable).");
    return;
  }

  if (!buildNft) throw new Error("Missing NEXT_PUBLIC_BUILDNFT_ADDRESS");
  if (!rpcUrl) throw new Error("Missing BASE_SEPOLIA_RPC_URL / NEXT_PUBLIC_RPC_URL");
  if (!ownerPk) throw new Error("Missing PRIVATE_KEY (or BASE_TOKEN_URI_OWNER_KEY) for --set-base");
  const { ethers } = await import("ethers");
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(ownerPk, provider);
  const contract = new ethers.Contract(buildNft, ["function owner() view returns (address)", "function setBaseTokenURI(string)"], wallet);
  const owner = String(await contract.owner());
  if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error(`Signer ${wallet.address} is not BuildNFT owner ${owner}`);
  }
  const tx = await contract.setBaseTokenURI(baseUri);
  const rc = await tx.wait();
  console.log(`setBaseTokenURI tx: ${tx.hash}`);
  console.log(`setBaseTokenURI block: ${rc?.blockNumber ?? "n/a"}`);
}

main().catch((err) => {
  console.error(`publish-metadata-batch failed: ${err?.message || err}`);
  process.exit(1);
});
