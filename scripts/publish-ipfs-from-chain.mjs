#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execSync } from "node:child_process";

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
    process.env[key] = val;
  }
}

function parseArgs(argv) {
  const out = { from: 1, to: 20, setBase: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--from" && argv[i + 1]) out.from = Number(argv[++i]);
    else if (a === "--to" && argv[i + 1]) out.to = Number(argv[++i]);
    else if (a === "--set-base") out.setBase = true;
  }
  return out;
}

function runCast(rpc, to, sig, arg) {
  const inner = `cast call --rpc-url ${rpc} ${to} "${sig}" ${arg ?? ""}`.trim().replaceAll('"', '\\"');
  const cmd = `/bin/zsh -lc "${inner}"`;
  const out = execSync(cmd, { encoding: "utf8" }).trim().replaceAll('"', "");
  // cast may append human-readable scientific notation, e.g.:
  // 32000000000000000000 [3.2e19]
  return out.split(/\s+/)[0];
}

function runCastSend(rpc, pk, to, sig, arg) {
  const inner = `cast send --rpc-url ${rpc} --private-key ${pk} ${to} "${sig}" "${arg}"`.replaceAll('"', '\\"');
  const cmd = `/bin/zsh -lc "${inner}"`;
  return execSync(cmd, { encoding: "utf8" });
}

function buildTokenHtml(tokenId) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>BUIDL #${tokenId}</title><style>html,body{margin:0;height:100%;background:#0b183a;color:#dbeafe;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}#app{width:100%;height:100%;position:relative;overflow:hidden}#hud{position:absolute;top:8px;left:8px;right:8px;z-index:10;display:flex;justify-content:space-between;gap:8px;pointer-events:none}.pill{background:rgba(15,23,42,.72);border:1px solid rgba(148,163,184,.35);border-radius:8px;padding:4px 8px;font-size:12px}#msg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:13px;color:#93c5fd}canvas{display:block}</style></head><body><div id="app"><div id="hud"><div class="pill" id="name">BUIDL #${tokenId}</div><div class="pill" id="stats">Loading...</div></div><div id="msg">Loading metadata...</div></div><script type="module">import * as THREE from "./three.module.min.js";(async()=>{const app=document.getElementById("app"),msg=document.getElementById("msg"),nameEl=document.getElementById("name"),statsEl=document.getElementById("stats");let meta=null;try{const r=await fetch("./${tokenId}.json",{cache:"no-store"});if(!r.ok)throw new Error("metadata "+r.status);meta=await r.json()}catch(e){msg.textContent="Metadata unavailable";console.error(e);return}nameEl.textContent=meta.name||"BUIDL #${tokenId}";const attrs={};for(const a of(meta.attributes||[])){if(!a||typeof a!=="object")continue;attrs[String(a.trait_type||"")]=a.value}const kind=Number(attrs.kindId??1),width=Math.max(1,Number(attrs.width??1)),depth=Math.max(1,Number(attrs.depth??1)),mass=Number(attrs.mass??width*depth),density=Number(attrs.density??1);statsEl.textContent="kind="+kind+" | "+width+"x"+depth+" | mass="+mass+" | d="+density;const scene=new THREE.Scene();scene.background=new THREE.Color(0x0b183a);const camera=new THREE.PerspectiveCamera(45,app.clientWidth/app.clientHeight,.1,1e3);camera.position.set(8,6,8);const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});renderer.setSize(app.clientWidth,app.clientHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;app.appendChild(renderer.domElement);scene.add(new THREE.HemisphereLight(0xdbeafe,0x0b183a,1.1));const key=new THREE.DirectionalLight(0xffffff,1.15);key.position.set(6,10,6);scene.add(key);const floor=new THREE.Mesh(new THREE.PlaneGeometry(50,50),new THREE.MeshStandardMaterial({color:0x1e293b,roughness:.95,metalness:.05}));floor.rotation.x=-Math.PI/2;floor.position.y=-.501;scene.add(floor);function addBrick(w,d,color=0x2563eb){const body=new THREE.Mesh(new THREE.BoxGeometry(w,1,d),new THREE.MeshStandardMaterial({color,roughness:.45,metalness:.15}));scene.add(body);const studGeom=new THREE.SphereGeometry(.2,16,12,0,Math.PI*2,0,Math.PI/2),studMat=new THREE.MeshStandardMaterial({color:0x3b82f6,roughness:.35,metalness:.1});for(let x=0;x<w;x++)for(let z=0;z<d;z++){const s=new THREE.Mesh(studGeom,studMat);s.position.set(-w/2+x+.5,.5,-d/2+z+.5);scene.add(s)}}function addBuildCluster(m){const n=Math.max(6,Math.min(90,Math.round(m/2))),g=new THREE.BoxGeometry(.8,.8,.8),mat=new THREE.MeshStandardMaterial({color:0x60a5fa,roughness:.4,metalness:.08,transparent:true,opacity:.95});for(let i=0;i<n;i++){const b=new THREE.Mesh(g,mat);b.position.set((Math.random()-.5)*5.5,(Math.random()-.1)*2.5,(Math.random()-.5)*5.5);scene.add(b)}}if(kind===0)addBrick(width,depth);else addBuildCluster(mass);const box=new THREE.Box3().setFromObject(scene),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());scene.position.sub(center);const maxDim=Math.max(size.x,size.y,size.z);camera.position.set(maxDim*1.4,maxDim*1.1,maxDim*1.5);camera.lookAt(0,0,0);msg.remove();let t=0;function animate(){t+=.0055;camera.position.x=Math.cos(t)*(maxDim*1.8);camera.position.z=Math.sin(t)*(maxDim*1.8);camera.lookAt(0,0,0);renderer.render(scene,camera);requestAnimationFrame(animate)}animate();window.addEventListener("resize",()=>{camera.aspect=app.clientWidth/app.clientHeight;camera.updateProjectionMatrix();renderer.setSize(app.clientWidth,app.clientHeight)})})();</script></body></html>`;
}

async function main() {
  loadDotEnvLocal();
  const args = parseArgs(process.argv.slice(2));

  const rpc = process.env.BASE_SEPOLIA_RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || "https://sepolia.base.org";
  const buildNft = process.env.NEXT_PUBLIC_BUILDNFT_ADDRESS || "0xBFb4DF18dd2b1f25a627028682F3984a5F5813aa";
  const pinataJwt = process.env.PINATA_JWT || "";
  const pinataUrl = process.env.IPFS_UPLOAD_URL || "https://api.pinata.cloud/pinning/pinFileToIPFS";
  const imagesCid = process.env.NEXT_PUBLIC_IMAGES_CID || "bafybeibnk4kq7mesrs7wtwi2ypwlnxhazoqkwgoycol55n64tqseox2q2a";
  const ownerPk = process.env.PRIVATE_KEY || process.env.BASE_TOKEN_URI_OWNER_KEY || "";

  if (pinataJwt.split(".").length !== 3) throw new Error("Missing or invalid PINATA_JWT");

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join(process.cwd(), "data", "metadata-ipfs-chain", ts);
  fs.mkdirSync(outDir, { recursive: true });

  let written = 0;
  for (let id = args.from; id <= args.to; id++) {
    const exists = runCast(rpc, buildNft, "exists(uint256)(bool)", String(id));
    if (exists !== "true") continue;

    const kind = runCast(rpc, buildNft, "kindOf(uint256)(uint8)", String(id));
    const specRaw = runCast(rpc, buildNft, "brickSpecOf(uint256)((uint8,uint8,uint16))", String(id)).replace(/[()]/g, "");
    const [width = "1", depth = "1", density = "1"] = specRaw.split(",").map((x) => x.trim());
    const locked = runCast(rpc, buildNft, "lockedBloxOf(uint256)(uint256)", String(id));
    const mass = (BigInt(locked) / 10n ** 18n).toString();
    const geometry = runCast(rpc, buildNft, "geometryOf(uint256)(bytes32)", String(id));

    let name = `BUIDL Build #${id}`;
    let kindLabel = "Build";
    let description = "BUIDL Build";
    if (kind === "0") {
      name = `${width}x${depth}-D${density}`;
      kindLabel = "Brick";
      description = `BUIDL Brick - ${width}x${depth} density ${density}`;
    } else if (kind === "2") {
      name = `BUIDL Collectors Edition #${id}`;
      kindLabel = "Collectors Edition";
      description = "BUIDL Collectors Edition";
    }

    const metadata = {
      name,
      description,
      image: `ipfs://${imagesCid}/${id}.png`,
      animation_url: `./${id}.html`,
      attributes: [
        { trait_type: "kind", value: kindLabel },
        { trait_type: "kindId", value: Number(kind) },
        { trait_type: "mass", value: Number(mass) },
        { trait_type: "density", value: Number(density) },
        { trait_type: "width", value: Number(width) },
        { trait_type: "depth", value: Number(depth) },
        { trait_type: "geometryHash", value: geometry },
      ],
    };
    fs.writeFileSync(path.join(outDir, `${id}.json`), JSON.stringify(metadata, null, 2));
    fs.writeFileSync(path.join(outDir, `${id}.html`), buildTokenHtml(String(id)));
    written++;
  }

  if (!written) throw new Error("No tokens found in selected range");
  fs.copyFileSync(
    path.join(process.cwd(), "node_modules", "three", "build", "three.module.min.js"),
    path.join(outDir, "three.module.min.js"),
  );

  const rootDir = path.basename(outDir);
  const files = fs.readdirSync(outDir).sort();
  const form = new FormData();
  form.append("pinataOptions", JSON.stringify({ wrapWithDirectory: false }));
  for (const fileName of files) {
    const full = path.join(outDir, fileName);
    const body = fs.readFileSync(full);
    const type = fileName.endsWith(".html")
      ? "text/html"
      : fileName.endsWith(".js")
        ? "text/javascript"
        : "application/json";
    form.append("file", new Blob([body], { type }), `${rootDir}/${fileName}`);
  }

  const res = await fetch(pinataUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${pinataJwt}` },
    body: form,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Pinata upload failed: ${res.status} ${text}`);
  const payload = JSON.parse(text);
  const cid = payload.IpfsHash || payload.Hash;
  if (!cid) throw new Error(`No CID in upload response: ${text}`);

  const baseUri = `ipfs://${cid}/${rootDir}`;
  console.log(`Generated: ${outDir}`);
  console.log(`CID: ${cid}`);
  console.log(`Base URI: ${baseUri}`);
  console.log(`Token 1 gateway: https://dweb.link/ipfs/${cid}/${rootDir}/1.json`);
  console.log(`Animation 1 gateway: https://dweb.link/ipfs/${cid}/${rootDir}/1.html`);

  if (args.setBase) {
    if (!ownerPk) throw new Error("Missing PRIVATE_KEY for --set-base");
    runCastSend(rpc, ownerPk, buildNft, "setBaseTokenURI(string)", baseUri);
    console.log("setBaseTokenURI sent");
  }
}

main().catch((e) => {
  console.error(`publish-ipfs-from-chain failed: ${e?.message || e}`);
  process.exit(1);
});
