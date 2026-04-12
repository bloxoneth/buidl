#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

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
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

function parseArgs(argv) {
  const out = { dir: "public/ipfs-viewer" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dir" && argv[i + 1]) out.dir = argv[++i];
  }
  return out;
}

function walkFiles(dir, rel = "") {
  const out = [];
  const abs = path.join(dir, rel);
  for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
    if (ent.name.startsWith(".")) continue;
    const r = path.join(rel, ent.name);
    if (ent.isDirectory()) out.push(...walkFiles(dir, r));
    else out.push(r);
  }
  return out;
}

async function main() {
  loadDotEnvLocal();
  const args = parseArgs(process.argv.slice(2));

  const token = process.env.PINATA_JWT || process.env.LIGHTHOUSE_API_KEY;
  const uploadUrl =
    process.env.IPFS_UPLOAD_URL ||
    process.env.LIGHTHOUSE_UPLOAD_URL ||
    "https://api.pinata.cloud/pinning/pinFileToIPFS";

  if (!token) throw new Error("Missing PINATA_JWT (or LIGHTHOUSE_API_KEY)");
  if (String(token).split(".").length !== 3) throw new Error("PINATA_JWT is malformed");

  const sourceDir = path.resolve(process.cwd(), args.dir);
  if (!fs.existsSync(sourceDir)) throw new Error(`Directory not found: ${sourceDir}`);

  const files = walkFiles(sourceDir);
  if (files.length === 0) throw new Error(`No files in ${sourceDir}`);

  const form = new FormData();
  form.append("pinataOptions", JSON.stringify({ wrapWithDirectory: true }));
  for (const rel of files) {
    const full = path.join(sourceDir, rel);
    const body = fs.readFileSync(full);
    form.append("file", new Blob([body]), rel.replace(/\\/g, "/"));
  }

  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${txt}`);
  let cid = "";
  try {
    const obj = JSON.parse(txt);
    cid = obj.IpfsHash || obj.Hash || "";
  } catch {
    throw new Error(`Upload response parse error: ${txt}`);
  }
  if (!cid) throw new Error(`Upload returned no CID: ${txt}`);

  const template = `https://dweb.link/ipfs/${cid}/index.html?tokenId={tokenId}`;
  console.log(`Viewer CID: ${cid}`);
  console.log(`Animation template: ${template}`);
  console.log("Set this env:");
  console.log(`BUILD_ANIMATION_URL_TEMPLATE=${template}`);
}

main().catch((err) => {
  console.error(`publish-viewer-ipfs failed: ${err?.message || err}`);
  process.exit(1);
});
