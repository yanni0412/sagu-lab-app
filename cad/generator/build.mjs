import opencascade from "replicad-opencascadejs/src/replicad_single.js";
import { setOC, makeBaseBox, makeCylinder, makeSphere, draw } from "replicad";
const makeBox = (a, b) => makeBaseBox(b[0]-a[0], b[1]-a[1], b[2]-a[2]).translate([(a[0]+b[0])/2, (a[1]+b[1])/2, a[2]]);
import fs from "fs"; import path from "path";
const here = path.dirname(new URL(import.meta.url).pathname);
const oc = await opencascade({ locateFile: () => path.join(here, "node_modules/replicad-opencascadejs/src/replicad_single.wasm") });
setOC(oc);

// ---- 파라미터 (mm, 뷰어 기본값과 동일) ----
const P = { W:10, H:10, T:0.5, winW:8, winH:8, pocketD:0.25, ledgeH:0.9, ledgeRise:0.10, slopeLen:0.35,
  vPitch:0.127, vAngle:90, vFlat:0.010, ribMargin:0.2, dotD:0.15, dotH:0.04, frameInset:0.5, ledgeInset:0.3,
  notchN:3, notchW:0.2, notchD:0.15, notchZ:0.04,
  fiberD:0.125, lensA:0.110, lensR:0.25 };   // Reflective lens: 구경 110µm, 곡률반경 250µm (가정값)
const e = 0.001;
const zF = P.T - P.pocketD, zL = P.T + P.ledgeRise, yTop = P.winH/2, yL0 = yTop - P.ledgeH, yS0 = yL0 - P.slopeLen;
const wx = P.winW/2, wy = P.winH/2, r = P.dotD/2;

function body() {
  const G = vgroove(), zB = zF - G.depth, M = mirror(G);
  let s = makeBox([-P.W/2, -P.H/2, 0], [P.W/2, P.H/2, P.T]);
  s = s.cut(makeBox([-wx, -wy, zF], [wx, wy, P.T + 1]));
  // 상단 레지(프레임 위로 돌출)
  s = s.fuse(makeBox([-wx, yL0, zF - e], [wx, yTop, zL]));
  // 45° 반사면: V-groove 바닥 높이(zB)부터 레지 윗면까지
  const tri = draw([M.yM, zB]).lineTo([yL0 + e, zB]).lineTo([yL0 + e, zL]).close()
    .sketchOnPlane("YZ", [-wx, 0, 0]).extrude(P.winW);
  s = s.fuse(tri);
  // V-groove: XZ 단면 삼각형을 Y로 돌출해 바닥에서 잘라냄
  let cutter = null;
  for (const x of G.xs) {
    const t = draw([x, zF + e]).lineTo([x + G.open/2, zB]).lineTo([x + G.open, zF + e]).close()
      .sketchOnPlane("XZ", [0, G.y1, 0]).extrude(G.y1 - G.y0);
    cutter = cutter ? cutter.fuse(t, { optimisation: "none" }) : t;
  }
  // 파이버 끝 ~ 반사면 사이 광로 트렌치 (홈 바닥 깊이)
  cutter = cutter.fuse(makeBox([G.xs[0], G.y1 - e, zB], [G.xe, M.yM + e, zF + e]));
  s = s.cut(cutter);
  // Reflective lens: 각 lane 광축이 반사면과 만나는 점에 오목 구면 (구 빼기)
  let lenses = null;
  for (const x of G.xs) {
    const c = [x + G.open/2, M.py + M.n[1]*(P.lensR - M.sag), M.pz + M.n[2]*(P.lensR - M.sag)];
    const sp = makeSphere(P.lensR).translate(c);
    lenses = lenses ? lenses.fuse(sp, { optimisation: "none" }) : sp;
  }
  // 반사면 쐐기 안쪽만 깎도록 제한 (홈 끝단·트렌치 옆 바닥은 건드리지 않음)
  const wedge = draw([M.yM, zB]).lineTo([yL0, zB]).lineTo([yL0, zL]).close()
    .sketchOnPlane("YZ", [G.xs[0], 0, 0]).extrude(G.xe - G.xs[0]);
  return s.cut(lenses.intersect(wedge));
}
// 반사면/렌즈 기하: 45° 면이 zB에서 시작하도록 경사 시작점(yM)을 앞으로 당김
function mirror(G) {
  const zB = zF - G.depth, run = P.slopeLen, rise = zL - zF, ang = Math.atan2(rise, run);
  const yM = yS0 - (zF - zB) / Math.tan(ang);
  const zc = zB + (P.fiberD/2) / Math.sin(P.vAngle/2 * Math.PI/180);    // 파이버 광축 높이
  const py = yM + (zc - zB) / Math.tan(ang), pz = zc;                    // 광축이 반사면에 닿는 점
  const n = [0, -Math.sin(ang), Math.cos(ang)];                           // 반사면 바깥 법선
  const h = P.lensA/2, sag = P.lensR - Math.sqrt(P.lensR**2 - h**2);
  const vC = (zc - zB) / Math.sin(ang), L = (zL - zB) / Math.sin(ang);   // 경사면 위 좌표
  return { yM, zc, py, pz, n, sag, ang, vC, L };
}
function vgroove() {
  const open = P.vPitch - P.vFlat, depth = (open/2) / Math.tan(P.vAngle/2 * Math.PI/180);
  const n = Math.floor((P.winW - 2*P.ribMargin - P.vFlat) / P.vPitch);
  const x0 = -(n*P.vPitch - P.vFlat)/2;               // 홈 배열을 X 중앙 정렬
  const xs = Array.from({length:n}, (_,i) => x0 + i*P.vPitch);
  return { open, depth, n, xs, xe: xs[n-1] + open, y0: -wy + P.ribMargin, y1: yS0 - P.ribMargin };
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
{ const G = vgroove(), M = mirror(G); console.log(`V-groove ${G.n}개, 개구폭 ${(G.open*1000).toFixed(1)}µm, 깊이 ${(G.depth*1000).toFixed(1)}µm`);
  console.log(`반사면 ${(M.ang*180/Math.PI).toFixed(1)}°, 광축 z ${M.zc.toFixed(4)}, 렌즈 ${G.n}개 sag ${(M.sag*1000).toFixed(2)}µm, 경사면 위치 ${(M.vC*1000).toFixed(1)}/${(M.L*1000).toFixed(1)}µm, 트렌치 길이 ${((M.yM-G.y1)*1000).toFixed(1)}µm`); }
for (const [k, f] of Object.entries(variants)) {
  const s = f();
  const bb = s.boundingBox;
  fs.writeFileSync(path.join(out, `mirror_frame_${k}.step`), Buffer.from(await s.blobSTEP().arrayBuffer()));
  fs.writeFileSync(path.join(out, `mirror_frame_${k}.stl`), Buffer.from(await s.blobSTL({ tolerance: 0.002, angularTolerance: 0.1 }).arrayBuffer()));
  console.log(k, "bbox", bb.bounds.map(v => v.map(n => n.toFixed(3)).join(",")).join(" | "));
}
