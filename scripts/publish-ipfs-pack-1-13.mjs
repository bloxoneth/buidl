#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const rows = [
  { id: 1, kind: 0, width: 1, depth: 1, density: 1, mass: 1, geometry: "0x3b5f6d31614edfda9f266147c15046b3c620e0f13593b252eb4115a4e44b5e85" },
  { id: 2, kind: 0, width: 1, depth: 2, density: 1, mass: 2, geometry: "0x5e8b5ff3c1d9daa6239c0f77bac0933af81a2a1ee01a722852e9c5074851f2a5" },
  { id: 3, kind: 0, width: 1, depth: 3, density: 1, mass: 3, geometry: "0x5ce8eb764c32a17a5d453ed1123492a8ebb6924d1c705a49196d38b9e61c6258" },
  { id: 4, kind: 0, width: 4, depth: 4, density: 1, mass: 16, geometry: "0x60e73dc5290209f58885aa3455f07183554220e2ba52b85dc35788e6c74b6102" },
  { id: 5, kind: 0, width: 1, depth: 4, density: 1, mass: 4, geometry: "0xc62da3acf6963e5ae96bd92d1999683f75f2df602be0ef218737db138c6196b1" },
  { id: 6, kind: 0, width: 8, depth: 2, density: 1, mass: 16, geometry: "0xa7609403a421ff2732ae0bbb2f37e93596da649a69cb3f2d2838de971cf4b38f" },
  { id: 7, kind: 0, width: 4, depth: 2, density: 1, mass: 8, geometry: "0x755f9f6b52cbe692f51f0176c43a48c4022f9bad01c9ba7e84fdb4d5a6f5f20e" },
  { id: 8, kind: 0, width: 2, depth: 9, density: 1, mass: 18, geometry: "0x6cdba6b54ca9b381ac1abe35a1c6ae9ada205c25900f0f9b6dcf4a5f7ba73e81" },
  { id: 9, kind: 0, width: 9, depth: 9, density: 1, mass: 81, geometry: "0xced3ce31c0d54e594ca33600b322352c01f9877e600cafc4048015f5315932c0" },
  { id: 10, kind: 0, width: 4, depth: 9, density: 1, mass: 36, geometry: "0x505e5e7dec38a067f7522f419e1aa133ee7e4607636e4b6af0dc9220d6dd7464" },
  { id: 11, kind: 0, width: 2, depth: 3, density: 1, mass: 6, geometry: "0x180a8393bb38688965e16e563279c4b732a9c55e30071316b1de2c0044b9edff" },
  { id: 12, kind: 0, width: 6, depth: 9, density: 1, mass: 54, geometry: "0xf6ef07006515f15a023c2c17cca1e441d9e31f1d46151c813251eee4fc5dd729" },
  { id: 13, kind: 0, width: 4, depth: 8, density: 1, mass: 32, geometry: "0xc77495e19519b8a8d2f0a0c6eff427ecc28c2b7a66d2ba7716a81028b4da6250" },
];

function loadDotEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 1) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[k] = v;
  }
}

function htmlFor(id) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>BUIDL #${id}</title><style>html,body{margin:0;height:100%;background:#0b183a;color:#dbeafe;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}#app{width:100%;height:100%;position:relative;overflow:hidden}#hud{position:absolute;top:8px;left:8px;right:8px;z-index:10;display:flex;justify-content:space-between;gap:8px;pointer-events:none}.pill{background:rgba(15,23,42,.72);border:1px solid rgba(148,163,184,.35);border-radius:8px;padding:4px 8px;font-size:12px}#msg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:13px;color:#93c5fd}canvas{display:block}</style></head><body><div id="app"><div id="hud"><div class="pill" id="name">BUIDL #${id}</div><div class="pill" id="stats">Loading...</div></div><div id="msg">Loading metadata...</div></div><script type="module">import * as THREE from "./three.module.min.js";(async()=>{const app=document.getElementById("app"),msg=document.getElementById("msg"),nameEl=document.getElementById("name"),statsEl=document.getElementById("stats");let meta=null;try{const r=await fetch("./${id}.json",{cache:"no-store"});if(!r.ok)throw new Error("metadata "+r.status);meta=await r.json()}catch(e){msg.textContent="Metadata unavailable";console.error(e);return}nameEl.textContent=meta.name||"BUIDL #${id}";const attrs={};for(const a of(meta.attributes||[])){if(!a||typeof a!=="object")continue;attrs[String(a.trait_type||"")]=a.value}const kind=Number(attrs.kindId??1),width=Math.max(1,Number(attrs.width??1)),depth=Math.max(1,Number(attrs.depth??1)),mass=Number(attrs.mass??width*depth),density=Number(attrs.density??1);statsEl.textContent="kind="+kind+" | "+width+"x"+depth+" | mass="+mass+" | d="+density;const scene=new THREE.Scene();scene.background=new THREE.Color(0x0b183a);const camera=new THREE.PerspectiveCamera(45,app.clientWidth/app.clientHeight,.1,1e3);camera.position.set(8,6,8);const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});renderer.setSize(app.clientWidth,app.clientHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;app.appendChild(renderer.domElement);scene.add(new THREE.HemisphereLight(0xdbeafe,0x0b183a,1.1));const key=new THREE.DirectionalLight(0xffffff,1.15);key.position.set(6,10,6);scene.add(key);const floor=new THREE.Mesh(new THREE.PlaneGeometry(50,50),new THREE.MeshStandardMaterial({color:0x1e293b,roughness:.95,metalness:.05}));floor.rotation.x=-Math.PI/2;floor.position.y=-.501;scene.add(floor);function addBrick(w,d,color=0x2563eb){const body=new THREE.Mesh(new THREE.BoxGeometry(w,1,d),new THREE.MeshStandardMaterial({color,roughness:.45,metalness:.15}));scene.add(body);const studGeom=new THREE.SphereGeometry(.2,16,12,0,Math.PI*2,0,Math.PI/2),studMat=new THREE.MeshStandardMaterial({color:0x3b82f6,roughness:.35,metalness:.1});for(let x=0;x<w;x++)for(let z=0;z<d;z++){const s=new THREE.Mesh(studGeom,studMat);s.position.set(-w/2+x+.5,.5,-d/2+z+.5);scene.add(s)}}if(kind===0)addBrick(width,depth);const box=new THREE.Box3().setFromObject(scene),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());scene.position.sub(center);const maxDim=Math.max(size.x,size.y,size.z);camera.position.set(maxDim*1.4,maxDim*1.1,maxDim*1.5);camera.lookAt(0,0,0);msg.remove();let t=0;function animate(){t+=.0055;camera.position.x=Math.cos(t)*(maxDim*1.8);camera.position.z=Math.sin(t)*(maxDim*1.8);camera.lookAt(0,0,0);renderer.render(scene,camera);requestAnimationFrame(animate)}animate();window.addEventListener("resize",()=>{camera.aspect=app.clientWidth/app.clientHeight;camera.updateProjectionMatrix();renderer.setSize(app.clientWidth,app.clientHeight)})})();</script></body></html>`;
}

async function main() {
  loadDotEnvLocal();
  const jwt = process.env.PINATA_JWT || "";
  if (jwt.split(".").length !== 3) throw new Error("PINATA_JWT missing/invalid");
  const imagesCid = process.env.NEXT_PUBLIC_IMAGES_CID || "bafybeibnk4kq7mesrs7wtwi2ypwlnxhazoqkwgoycol55n64tqseox2q2a";
  const uploadUrl = process.env.IPFS_UPLOAD_URL || "https://api.pinata.cloud/pinning/pinFileToIPFS";

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join(process.cwd(), "data", "metadata-ipfs-chain", stamp);
  fs.mkdirSync(outDir, { recursive: true });

  for (const r of rows) {
    const meta = {
      name: `${r.width}x${r.depth}-D${r.density}`,
      description: `BUIDL Brick - ${r.width}x${r.depth} density ${r.density}`,
      image: `ipfs://${imagesCid}/${r.id}.png`,
      animation_url: `./${r.id}.html`,
      attributes: [
        { trait_type: "kind", value: "Brick" },
        { trait_type: "kindId", value: 0 },
        { trait_type: "mass", value: r.mass },
        { trait_type: "density", value: r.density },
        { trait_type: "width", value: r.width },
        { trait_type: "depth", value: r.depth },
        { trait_type: "geometryHash", value: r.geometry },
      ],
    };
    fs.writeFileSync(path.join(outDir, `${r.id}.json`), JSON.stringify(meta, null, 2));
    fs.writeFileSync(path.join(outDir, `${r.id}.html`), htmlFor(r.id));
  }
  fs.copyFileSync(
    path.join(process.cwd(), "node_modules", "three", "build", "three.module.min.js"),
    path.join(outDir, "three.module.min.js"),
  );

  const root = path.basename(outDir);
  const form = new FormData();
  form.append("pinataOptions", JSON.stringify({ wrapWithDirectory: false }));
  for (const f of fs.readdirSync(outDir).sort()) {
    const b = fs.readFileSync(path.join(outDir, f));
    const type = f.endsWith(".html") ? "text/html" : f.endsWith(".js") ? "text/javascript" : "application/json";
    form.append("file", new Blob([b], { type }), `${root}/${f}`);
  }

  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Pinata upload failed ${res.status}: ${text}`);
  const parsed = JSON.parse(text);
  const cid = parsed.IpfsHash || parsed.Hash;
  if (!cid) throw new Error(`CID missing in response: ${text}`);

  const baseUri = `ipfs://${cid}/${root}`;
  console.log(`OUT=${outDir}`);
  console.log(`CID=${cid}`);
  console.log(`BASE_URI=${baseUri}`);
  console.log(`CHECK_JSON=https://dweb.link/ipfs/${cid}/${root}/6.json`);
  console.log(`CHECK_HTML=https://dweb.link/ipfs/${cid}/${root}/6.html`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});

