#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

RPC="${RPC:-https://sepolia.base.org}"
BUILD="${BUILD:-0xBFb4DF18dd2b1f25a627028682F3984a5F5813aa}"
IMAGES_CID="${IMAGES_CID:-bafybeibnk4kq7mesrs7wtwi2ypwlnxhazoqkwgoycol55n64tqseox2q2a}"
FROM="${FROM:-1}"
TO="${TO:-13}"

OUT="data/metadata-ipfs-chain/$(date -u +%Y-%m-%dT%H-%M-%SZ)"
mkdir -p "$OUT"

for ((ID=FROM; ID<=TO; ID++)); do
  EX="$(cast call --rpc-url "$RPC" "$BUILD" "exists(uint256)(bool)" "$ID" | tr -d '"' | tr -d '\n')"
  if [[ "$EX" != "true" ]]; then
    continue
  fi

  KIND="$(cast call --rpc-url "$RPC" "$BUILD" "kindOf(uint256)(uint8)" "$ID" | tr -d '"' | tr -d '\n')"
  SPEC="$(cast call --rpc-url "$RPC" "$BUILD" "brickSpecOf(uint256)((uint8,uint8,uint16))" "$ID" | tr -d '()')"
  WIDTH="$(echo "$SPEC" | cut -d',' -f1 | tr -d ' ')"
  DEPTH="$(echo "$SPEC" | cut -d',' -f2 | tr -d ' ')"
  DENSITY="$(echo "$SPEC" | cut -d',' -f3 | tr -d ' ')"
  LOCKED="$(cast call --rpc-url "$RPC" "$BUILD" "lockedBloxOf(uint256)(uint256)" "$ID" | tr -d '"' | tr -d '\n')"
  MASS="$(python3 - <<PY
locked = int("$LOCKED")
print(locked // 10**18)
PY
)"
  GEO="$(cast call --rpc-url "$RPC" "$BUILD" "geometryOf(uint256)(bytes32)" "$ID" | tr -d '"' | tr -d '\n')"

  if [[ "$KIND" == "0" ]]; then
    NAME="${WIDTH}x${DEPTH}-D${DENSITY}"
    KIND_LABEL="Brick"
    DESC="BASEBLOX Brick - ${WIDTH}x${DEPTH} density ${DENSITY}"
  elif [[ "$KIND" == "2" ]]; then
    NAME="BASEBLOX Collectors Edition #$ID"
    KIND_LABEL="Collectors Edition"
    DESC="BASEBLOX Collectors Edition"
  else
    NAME="BASEBLOX Build #$ID"
    KIND_LABEL="Build"
    DESC="BASEBLOX Build"
  fi

  cat > "$OUT/$ID.json" <<JSON
{
  "name": "$NAME",
  "description": "$DESC",
  "image": "ipfs://$IMAGES_CID/$ID.png",
  "animation_url": "./$ID.html",
  "attributes": [
    { "trait_type": "kind", "value": "$KIND_LABEL" },
    { "trait_type": "kindId", "value": $KIND },
    { "trait_type": "mass", "value": $MASS },
    { "trait_type": "density", "value": $DENSITY },
    { "trait_type": "width", "value": $WIDTH },
    { "trait_type": "depth", "value": $DEPTH },
    { "trait_type": "geometryHash", "value": "$GEO" }
  ]
}
JSON

  cat > "$OUT/$ID.html" <<HTML
<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>BASEBLOX #$ID</title><style>html,body{margin:0;height:100%;background:#0b183a;color:#dbeafe;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}#app{width:100%;height:100%;position:relative;overflow:hidden}#hud{position:absolute;top:8px;left:8px;right:8px;z-index:10;display:flex;justify-content:space-between;gap:8px;pointer-events:none}.pill{background:rgba(15,23,42,.72);border:1px solid rgba(148,163,184,.35);border-radius:8px;padding:4px 8px;font-size:12px}#msg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:13px;color:#93c5fd}canvas{display:block}</style></head><body><div id="app"><div id="hud"><div class="pill" id="name">BASEBLOX #$ID</div><div class="pill" id="stats">Loading...</div></div><div id="msg">Loading metadata...</div></div><script type="module">import * as THREE from "./three.module.min.js";(async()=>{const app=document.getElementById("app"),msg=document.getElementById("msg"),nameEl=document.getElementById("name"),statsEl=document.getElementById("stats");let meta=null;try{const r=await fetch("./$ID.json",{cache:"no-store"});if(!r.ok)throw new Error("metadata "+r.status);meta=await r.json()}catch(e){msg.textContent="Metadata unavailable";console.error(e);return}nameEl.textContent=meta.name||"BASEBLOX #$ID";const attrs={};for(const a of(meta.attributes||[])){if(!a||typeof a!=="object")continue;attrs[String(a.trait_type||"")]=a.value}const kind=Number(attrs.kindId??1),width=Math.max(1,Number(attrs.width??1)),depth=Math.max(1,Number(attrs.depth??1)),mass=Number(attrs.mass??width*depth),density=Number(attrs.density??1);statsEl.textContent="kind="+kind+" | "+width+"x"+depth+" | mass="+mass+" | d="+density;const scene=new THREE.Scene();scene.background=new THREE.Color(0x0b183a);const camera=new THREE.PerspectiveCamera(45,app.clientWidth/app.clientHeight,.1,1e3);camera.position.set(8,6,8);const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});renderer.setSize(app.clientWidth,app.clientHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;app.appendChild(renderer.domElement);scene.add(new THREE.HemisphereLight(0xdbeafe,0x0b183a,1.1));const key=new THREE.DirectionalLight(0xffffff,1.15);key.position.set(6,10,6);scene.add(key);const floor=new THREE.Mesh(new THREE.PlaneGeometry(50,50),new THREE.MeshStandardMaterial({color:0x1e293b,roughness:.95,metalness:.05}));floor.rotation.x=-Math.PI/2;floor.position.y=-.501;scene.add(floor);function addBrick(w,d,color=0x2563eb){const body=new THREE.Mesh(new THREE.BoxGeometry(w,1,d),new THREE.MeshStandardMaterial({color,roughness:.45,metalness:.15}));scene.add(body);const studGeom=new THREE.SphereGeometry(.2,16,12,0,Math.PI*2,0,Math.PI/2),studMat=new THREE.MeshStandardMaterial({color:0x3b82f6,roughness:.35,metalness:.1});for(let x=0;x<w;x++)for(let z=0;z<d;z++){const s=new THREE.Mesh(studGeom,studMat);s.position.set(-w/2+x+.5,.5,-d/2+z+.5);scene.add(s)}}function addBuildCluster(m){const n=Math.max(6,Math.min(90,Math.round(m/2))),g=new THREE.BoxGeometry(.8,.8,.8),mat=new THREE.MeshStandardMaterial({color:0x60a5fa,roughness:.4,metalness:.08,transparent:true,opacity:.95});for(let i=0;i<n;i++){const b=new THREE.Mesh(g,mat);b.position.set((Math.random()-.5)*5.5,(Math.random()-.1)*2.5,(Math.random()-.5)*5.5);scene.add(b)}}if(kind===0)addBrick(width,depth);else addBuildCluster(mass);const box=new THREE.Box3().setFromObject(scene),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());scene.position.sub(center);const maxDim=Math.max(size.x,size.y,size.z);camera.position.set(maxDim*1.4,maxDim*1.1,maxDim*1.5);camera.lookAt(0,0,0);msg.remove();let t=0;function animate(){t+=.0055;camera.position.x=Math.cos(t)*(maxDim*1.8);camera.position.z=Math.sin(t)*(maxDim*1.8);camera.lookAt(0,0,0);renderer.render(scene,camera);requestAnimationFrame(animate)}animate();window.addEventListener("resize",()=>{camera.aspect=app.clientWidth/app.clientHeight;camera.updateProjectionMatrix();renderer.setSize(app.clientWidth,app.clientHeight)})})();</script></body></html>
HTML
done

cp node_modules/three/build/three.module.min.js "$OUT/three.module.min.js"
echo "$OUT"
