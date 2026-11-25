import opencascade from "replicad-opencascadejs/src/replicad_single.js";
import { setOC, makeBaseBox, makeCylinder, draw } from "replicad";
const makeBox = (a, b) => makeBaseBox(b[0]-a[0], b[1]-a[1], b[2]-a[2]).translate([(a[0]+b[0])/2, (a[1]+b[1])/2, a[2]]);
import fs from "fs"; import path from "path";
const here = path.dirname(new URL(import.meta.url).pathname);
const oc = await opencascade({ locateFile: () => path.join(here, "node_modules/replicad-opencascadejs/src/replicad_single.wasm") });
setOC(oc);

// ---- 파라미터 (mm, 뷰어 기본값과 동일 · 모두 가정값) ----
const P = { W:10, H:10, T:0.5, winW:8, frontMargin:0.6,
  ridgeL:8.6, backMargin:0.8, ledgeH:0.40, ledgeRise:0.25, mirrorAng:45,   // 레지: 길이, 뒤 여백, 윗면 폭, 높이, 반사면 각
  vPitch:0.127, vAngle:90, vFlat:0.010, ribMargin:0.2,
  dotD:0.15, dotH:0.04, frameInset:0.5, ledgeInset:0.3,
  notchN:3, notchW:0.2, notchD:0.15, notchZ:0.04,
  fiberD:0.125, lensA:0.110, lensR:0.25 };
const e = 0.001, deg = Math.PI/180;
const zF = P.T, zL = P.T + P.ledgeRise, yTop = P.H/2 - P.backMargin, yL0 = yTop - P.ledgeH;
const ang = P.mirrorAng*deg, yS0 = yL0 - P.ledgeRise/Math.tan(ang);
const L2 = P.ridgeL/2, xt = L2 - P.ledgeRise, r = P.dotD/2;

function vgroove() {
  const open = P.vPitch - P.vFlat, depth = (open/2) / Math.tan(P.vAngle/2*deg);
  const n = Math.floor((P.winW - 2*P.ribMargin - P.vFlat) / P.vPitch);
  const x0 = -(n*P.vPitch - P.vFlat)/2;
  const xs = Array.from({length:n}, (_,i) => x0 + i*P.vPitch);
  return { open, depth, n, xs, xe: xs[n-1] + open, y0: -P.H/2 + P.frontMargin, y1: yS0 - P.ribMargin };
}
function mirror(G) {
  const zB = zF - G.depth, yM = yS0 - (zF - zB)/Math.tan(ang);
  const zc = zB + (P.fiberD/2) / Math.sin(P.vAngle/2*deg);
  const n = [0, -Math.sin(ang), Math.cos(ang)], t = [0, Math.cos(ang), Math.sin(ang)];
  const h = P.lensA/2, sag = P.lensR - Math.sqrt(P.lensR**2 - h**2);
  const vC = (zc - zB)/Math.sin(ang), L = (zL - zB)/Math.sin(ang);
  return { zB, yM, zc, py: yM + vC*Math.cos(ang), n, t, sag, vC, L };
}
function body() {
  const G = vgroove(), M = mirror(G), zB = M.zB;
  let s = makeBox([-P.W/2, -P.H/2, 0], [P.W/2, P.H/2, zF]);
  // 레지: (YZ 단면: 앞 45° 반사면 + 윗면 + 수직 뒷면) ∩ (XZ 단면: 양 끝 45° 경사)
  const prof = draw([M.yM, zB]).lineTo([yTop, zB]).lineTo([yTop, zL]).lineTo([yL0, zL]).close()
    .sketchOnPlane("YZ", [-L2 - 1, 0, 0]).extrude(P.ridgeL + 2);
  const ends = draw([-L2 - (zF - zB), zB]).lineTo([L2 + (zF - zB), zB]).lineTo([xt, zL]).lineTo([-xt, zL]).close()
    .sketchOnPlane("XZ", [0, yTop + 1, 0]).extrude(yTop - M.yM + 2);
  s = s.fuse(prof.intersect(ends));
  // V-groove + 파이버 끝 ~ 반사면 광로 트렌치
  let cutter = null;
  for (const x of G.xs) {
    const t = draw([x, zF + e]).lineTo([x + G.open/2, zB]).lineTo([x + G.open, zF + e]).close()
      .sketchOnPlane("XZ", [0, G.y1, 0]).extrude(G.y1 - G.y0);
    cutter = cutter ? cutter.fuse(t, { optimisation: "none" }) : t;
  }
  cutter = cutter.fuse(makeBox([G.xs[0], G.y1 - e, zB], [G.xe, M.yM + e, zF + e]));
  s = s.cut(cutter);
  // Reflective lens: lane마다 반사면 바닥 → 레지 윗모서리까지 오목 원통 채널, 반사면 쐐기 안쪽만
  let lenses = null; const k = P.lensR - M.sag, ext = 0.05;
  for (const x of G.xs) {
    const o = [x + G.open/2, M.yM + M.n[1]*k - M.t[1]*ext, zB + M.n[2]*k - M.t[2]*ext];
    const cy = makeCylinder(P.lensR, M.L + 2*ext, o, M.t);
    lenses = lenses ? lenses.fuse(cy, { optimisation: "none" }) : cy;
  }
  const wedge = draw([M.yM, zB]).lineTo([yL0, zB]).lineTo([yL0, zL]).close()
    .sketchOnPlane("YZ", [G.xs[0], 0, 0]).extrude(G.xe - G.xs[0]);
  return s.cut(lenses.intersect(wedge));
}
const framePts = [[1,1],[-1,1],[1,-1],[-1,-1]].map(([a,b]) => [a*(P.W/2-P.frameInset), b*(P.H/2-P.frameInset), zF]);
const ledgePts = [1,-1].map(a => [a*(xt-P.ledgeInset), (yL0+yTop)/2, zL]);
const dots = [...framePts, ...ledgePts];

const base = body();
const variants = {
  bump:   () => dots.reduce((s,[x,y,z]) => s.fuse(makeCylinder(r, P.dotH + e, [x,y,z - e])), base),
  dimple: () => dots.reduce((s,[x,y,z]) => s.cut(makeCylinder(r, P.dotH + e, [x,y,z - P.dotH])), base),
  notch:  () => Array.from({length:P.notchN}, (_,i) => -xt + 2*xt*(i+1)/(P.notchN+1))
                  .reduce((s,cx) => s.cut(makeBox([cx-P.notchW/2, yTop-P.notchD, zL-P.notchZ], [cx+P.notchW/2, yTop+e, zL+e])), base),
};
const out = process.argv[2];
{ const G = vgroove(), M = mirror(G); console.log(`V-groove ${G.n}개, 개구폭 ${(G.open*1000).toFixed(1)}µm, 깊이 ${(G.depth*1000).toFixed(1)}µm`);
  console.log(`반사면 ${P.mirrorAng}°, 광축 z ${M.zc.toFixed(4)}, 렌즈 ${G.n}개 sag ${(M.sag*1000).toFixed(2)}µm, 경사면 위치 ${(M.vC*1000).toFixed(1)}/${(M.L*1000).toFixed(1)}µm, 트렌치 길이 ${((M.yM-G.y1)*1000).toFixed(1)}µm`); }
for (const [k, f] of Object.entries(variants)) {
  const s = f();
  const bb = s.boundingBox;
  fs.writeFileSync(path.join(out, `mirror_frame_${k}.step`), Buffer.from(await s.blobSTEP().arrayBuffer()));
  fs.writeFileSync(path.join(out, `mirror_frame_${k}.stl`), Buffer.from(await s.blobSTL({ tolerance: 0.002, angularTolerance: 0.1 }).arrayBuffer()));
  console.log(k, "bbox", bb.bounds.map(v => v.map(n => n.toFixed(3)).join(",")).join(" | "));
}
