import opencascade from "replicad-opencascadejs/src/replicad_single.js";
import { setOC, makeBaseBox, makeCylinder, draw } from "replicad";
const makeBox = (a, b) => makeBaseBox(b[0]-a[0], b[1]-a[1], b[2]-a[2]).translate([(a[0]+b[0])/2, (a[1]+b[1])/2, a[2]]);
import fs from "fs"; import path from "path";
const here = path.dirname(new URL(import.meta.url).pathname);
const oc = await opencascade({ locateFile: () => path.join(here, "node_modules/replicad-opencascadejs/src/replicad_single.wasm") });
setOC(oc);

// ---- 파라미터 (mm, 뷰어 기본값과 동일) ----
const P = { W:10, H:10, T:0.5, winW:8, winH:8, pocketD:0.25, ledgeH:0.9, ledgeRise:0.10, slopeLen:0.35,
  ribPitch:0.12, ribW:0.06, ribH:0.05, ribMargin:0.2, dotD:0.15, dotH:0.04, frameInset:0.5, ledgeInset:0.3,
  notchN:3, notchW:0.2, notchD:0.15, notchZ:0.04 };
const e = 0.001;
const zF = P.T - P.pocketD, zL = P.T + P.ledgeRise, yTop = P.winH/2, yL0 = yTop - P.ledgeH, yS0 = yL0 - P.slopeLen;
const wx = P.winW/2, wy = P.winH/2, r = P.dotD/2;

function body() {
  let s = makeBox([-P.W/2, -P.H/2, 0], [P.W/2, P.H/2, P.T]);
  s = s.cut(makeBox([-wx, -wy, zF], [wx, wy, P.T + 1]));
  // 상단 레지(프레임 위로 돌출)
  s = s.fuse(makeBox([-wx, yL0, zF - e], [wx, yTop, zL]));
  // 경사면: YZ 단면 삼각형을 X로 돌출
  const tri = draw([yS0, zF - e]).lineTo([yL0 + e, zF - e]).lineTo([yL0 + e, zL]).close()
    .sketchOnPlane("YZ", [-wx, 0, 0]).extrude(P.winW);
  s = s.fuse(tri);
  // 그레이팅 리브
  const span = P.winW - 2*P.ribMargin, n = Math.floor((span - P.ribW)/P.ribPitch) + 1;
  const y0 = -wy + P.ribMargin, y1 = yS0 - P.ribMargin;
  let ribs = null;
  for (let i = 0; i < n; i++) {
    const x = -wx + P.ribMargin + i*P.ribPitch;
    const b = makeBox([x, y0, zF - e], [x + P.ribW, y1, zF + P.ribH]);
    ribs = ribs ? ribs.fuse(b, { optimisation: "none" }) : b;
  }
  return s.fuse(ribs);
}
const framePts = [[1,1],[-1,1],[1,-1],[-1,-1]].map(([a,b]) => [a*(P.W/2-P.frameInset), b*(P.H/2-P.frameInset), P.T]);
const ledgePts = [1,-1].map(a => [a*(wx-P.ledgeInset), (yL0+yTop)/2, zL]);
const dots = [...framePts, ...ledgePts];

const base = body();
const variants = {
  bump:   () => dots.reduce((s,[x,y,z]) => s.fuse(makeCylinder(r, P.dotH + e, [x,y,z - e])), base),
  dimple: () => dots.reduce((s,[x,y,z]) => s.cut(makeCylinder(r, P.dotH + e, [x,y,z - P.dotH])), base),
  notch:  () => Array.from({length:P.notchN}, (_,i) => -wx + P.winW*(i+1)/(P.notchN+1))
                  .reduce((s,cx) => s.cut(makeBox([cx-P.notchW/2, yTop-P.notchD, zL-P.notchZ], [cx+P.notchW/2, yTop+e, zL+e])), base),
};
const out = process.argv[2];
for (const [k, f] of Object.entries(variants)) {
  const s = f();
  const bb = s.boundingBox;
  fs.writeFileSync(path.join(out, `mirror_frame_${k}.step`), Buffer.from(await s.blobSTEP().arrayBuffer()));
  fs.writeFileSync(path.join(out, `mirror_frame_${k}.stl`), Buffer.from(await s.blobSTL({ tolerance: 0.002, angularTolerance: 0.1 }).arrayBuffer()));
  console.log(k, "bbox", bb.bounds.map(v => v.map(n => n.toFixed(3)).join(",")).join(" | "));
}
