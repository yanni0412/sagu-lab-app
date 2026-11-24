import opencascade from "replicad-opencascadejs/src/replicad_single.js";
import { setOC, makeBaseBox, makeCylinder, draw } from "replicad";
const makeBox = (a, b) => makeBaseBox(b[0]-a[0], b[1]-a[1], b[2]-a[2]).translate([(a[0]+b[0])/2, (a[1]+b[1])/2, a[2]]);
import fs from "fs"; import path from "path";
const here = path.dirname(new URL(import.meta.url).pathname);
const oc = await opencascade({ locateFile: () => path.join(here, "node_modules/replicad-opencascadejs/src/replicad_single.wasm") });
setOC(oc);

// ---- 파라미터 (mm, 뷰어 기본값과 동일) ----
const P = { W:10, H:10, T:0.5, winW:8, winH:8, pocketD:0.25, ledgeH:0.9, ledgeRise:0.10, slopeLen:0.35,
  vPitch:0.127, vAngle:90, vFlat:0.010, ribMargin:0.2, dotD:0.15, dotH:0.04, frameInset:0.5, ledgeInset:0.3,
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
  // V-groove: 피치 127µm, 내각 90°, 상단 평탄부 10µm (가정값). XZ 단면 삼각형을 Y로 돌출해 바닥에서 잘라냄
  const G = vgroove();
  let cutter = null;
  for (const x of G.xs) {
    const tri = draw([x, zF + e]).lineTo([x + G.open/2, zF - G.depth]).lineTo([x + G.open, zF + e]).close()
      .sketchOnPlane("XZ", [0, G.y1, 0]).extrude(G.y1 - G.y0);
    cutter = cutter ? cutter.fuse(tri, { optimisation: "none" }) : tri;
  }
  return s.cut(cutter);
}
function vgroove() {
  const open = P.vPitch - P.vFlat, depth = (open/2) / Math.tan(P.vAngle/2 * Math.PI/180);
  const n = Math.floor((P.winW - 2*P.ribMargin - P.vFlat) / P.vPitch);
  const x0 = -(n*P.vPitch - P.vFlat)/2;               // 홈 배열을 X 중앙 정렬
  return { open, depth, n, xs: Array.from({length:n}, (_,i) => x0 + i*P.vPitch), y0: -wy + P.ribMargin, y1: yS0 - P.ribMargin };
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
{ const G = vgroove(); console.log(`V-groove ${G.n}개, 개구폭 ${(G.open*1000).toFixed(1)}µm, 깊이 ${(G.depth*1000).toFixed(1)}µm, x0 ${G.xs[0].toFixed(4)}`); }
for (const [k, f] of Object.entries(variants)) {
  const s = f();
  const bb = s.boundingBox;
  fs.writeFileSync(path.join(out, `mirror_frame_${k}.step`), Buffer.from(await s.blobSTEP().arrayBuffer()));
  fs.writeFileSync(path.join(out, `mirror_frame_${k}.stl`), Buffer.from(await s.blobSTL({ tolerance: 0.002, angularTolerance: 0.1 }).arrayBuffer()));
  console.log(k, "bbox", bb.bounds.map(v => v.map(n => n.toFixed(3)).join(",")).join(" | "));
}
