/* 분자 뷰어 핵심 로직 — 화학식/SMILES 파싱, 조성 계산, 2D 배치, 내장 사전.
   화면 코드(chem.html)와 분리된 순수 함수들이라 Node에서도 불러 쓸 수 있다. */
(function (root) {
"use strict";

class ChemError extends Error {}

/* ---------- 원소 (기호 원자량 이름) ---------- */
const EL_RAW = "H 1.008 수소|He 4.0026 헬륨|Li 6.94 리튬|Be 9.0122 베릴륨|B 10.81 붕소|C 12.011 탄소|N 14.007 질소|O 15.999 산소|F 18.998 플루오린|Ne 20.180 네온|" +
  "Na 22.990 나트륨|Mg 24.305 마그네슘|Al 26.982 알루미늄|Si 28.085 규소|P 30.974 인|S 32.06 황|Cl 35.45 염소|Ar 39.95 아르곤|K 39.098 칼륨|Ca 40.078 칼슘|" +
  "Sc 44.956 스칸듐|Ti 47.867 타이타늄|V 50.942 바나듐|Cr 51.996 크로뮴|Mn 54.938 망가니즈|Fe 55.845 철|Co 58.933 코발트|Ni 58.693 니켈|Cu 63.546 구리|Zn 65.38 아연|" +
  "Ga 69.723 갈륨|Ge 72.630 저마늄|As 74.922 비소|Se 78.971 셀레늄|Br 79.904 브로민|Kr 83.798 크립톤|Rb 85.468 루비듐|Sr 87.62 스트론튬|Y 88.906 이트륨|Zr 91.224 지르코늄|" +
  "Nb 92.906 나이오븀|Mo 95.95 몰리브데넘|Tc 98 테크네튬|Ru 101.07 루테늄|Rh 102.91 로듐|Pd 106.42 팔라듐|Ag 107.87 은|Cd 112.41 카드뮴|In 114.82 인듐|Sn 118.71 주석|" +
  "Sb 121.76 안티모니|Te 127.60 텔루륨|I 126.90 아이오딘|Xe 131.29 제논|Cs 132.91 세슘|Ba 137.33 바륨|La 138.91 란타넘|Ce 140.12 세륨|Pr 140.91 프라세오디뮴|Nd 144.24 네오디뮴|" +
  "Pm 145 프로메튬|Sm 150.36 사마륨|Eu 151.96 유로퓸|Gd 157.25 가돌리늄|Tb 158.93 터븀|Dy 162.50 디스프로슘|Ho 164.93 홀뮴|Er 167.26 어븀|Tm 168.93 툴륨|Yb 173.05 이터븀|" +
  "Lu 174.97 루테튬|Hf 178.49 하프늄|Ta 180.95 탄탈럼|W 183.84 텅스텐|Re 186.21 레늄|Os 190.23 오스뮴|Ir 192.22 이리듐|Pt 195.08 백금|Au 196.97 금|Hg 200.59 수은|" +
  "Tl 204.38 탈륨|Pb 207.2 납|Bi 208.98 비스무트|Po 209 폴로늄|At 210 아스타틴|Rn 222 라돈|Fr 223 프랑슘|Ra 226 라듐|Ac 227 악티늄|Th 232.04 토륨|" +
  "Pa 231.04 프로트악티늄|U 238.03 우라늄|Np 237 넵투늄|Pu 244 플루토늄|Am 243 아메리슘|Cm 247 퀴륨|Bk 247 버클륨|Cf 251 캘리포늄|Es 252 아인슈타이늄|Fm 257 페르뮴|" +
  "Md 258 멘델레븀|No 259 노벨륨|Lr 262 로렌슘|Rf 267 러더포듐|Db 270 더브늄|Sg 269 시보귬|Bh 270 보륨|Hs 270 하슘|Mt 278 마이트너륨|Ds 281 다름슈타튬|" +
  "Rg 281 뢴트게늄|Cn 285 코페르니슘|Nh 286 니호늄|Fl 289 플레로븀|Mc 289 모스코븀|Lv 293 리버모륨|Ts 293 테네신|Og 294 오가네손";
const ELEMENTS = {};
EL_RAW.split("|").forEach((t, i) => {
  const [sym, mass, ko] = t.split(" ");
  ELEMENTS[sym] = { z: i + 1, mass: +mass, ko };
});

/* ---------- 화학식 ---------- */
const SUB_DIGITS = "₀₁₂₃₄₅₆₇₈₉";
const SUP_MAP = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁺": "+", "⁻": "-" };

function normFormula(s) {
  let t = String(s).trim().replace(/\s+/g, "");
  t = t.replace(/[₀-₉]/g, c => String(SUB_DIGITS.indexOf(c)));
  t = t.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]+/g, m => "^" + [...m].map(c => SUP_MAP[c]).join(""));
  t = t.replace(/[−–]/g, "-").replace(/[•∙・*.]/g, "·");
  return t;
}

function parseFormula(input) {
  let t = normFormula(input);
  if (!t) throw new ChemError("화학식을 입력해 주세요.");
  const text = t;
  let charge = 0, m;
  if ((m = t.match(/\^(\d*)([+-])$/))) {
    charge = (m[1] ? +m[1] : 1) * (m[2] === "+" ? 1 : -1);
    t = t.slice(0, m.index);
  } else if ((m = t.match(/\^?(\++|-+)$/))) {
    charge = m[1].length * (m[1][0] === "+" ? 1 : -1);
    t = t.slice(0, m.index);
  }
  if (t.includes("^")) throw new ChemError("전하는 맨 끝에 SO4^2- 처럼 적어 주세요.");
  const total = new Map(), segs = [];
  for (const p of t.split("·")) {
    if (!p) throw new ChemError("‘·’ 앞뒤에 화학식이 있어야 해요.");
    const cm = p.match(/^\d+/);
    const mult = cm ? +cm[0] : 1;
    const body = cm ? p.slice(cm[0].length) : p;
    if (!mult) throw new ChemError("계수 0은 쓸 수 없어요.");
    if (!body) throw new ChemError(`‘${p}’에 원소가 없어요.`);
    const counts = parseGroup(body);
    for (const [el, n] of counts) total.set(el, (total.get(el) || 0) + n * mult);
    segs.push({ mult, counts, text: p });
  }
  return { counts: total, charge, segs, text };
}

function parseGroup(s) {
  const CLOSE = { "(": ")", "[": "]", "{": "}" };
  let i = 0;
  function num() {
    let j = i;
    while (j < s.length && /\d/.test(s[j])) j++;
    const n = j > i ? parseInt(s.slice(i, j), 10) : 1;
    if (j > i && n === 0) throw new ChemError("아래 첨자 0은 쓸 수 없어요.");
    if (n > 100000) throw new ChemError("숫자가 너무 커요.");
    i = j;
    return n;
  }
  function add(dst, src, k) { for (const [el, n] of src) dst.set(el, (dst.get(el) || 0) + n * k); }
  function seq(close) {
    const c = new Map();
    while (i < s.length) {
      const ch = s[i];
      if (ch === close) return c;
      if (CLOSE[ch]) {
        i++;
        const inner = seq(CLOSE[ch]);
        if (s[i] !== CLOSE[ch]) throw new ChemError(`괄호 ‘${ch}’가 닫히지 않았어요.`);
        i++;
        if (!inner.size) throw new ChemError("빈 괄호가 있어요.");
        add(c, inner, num());
        continue;
      }
      if (/[A-Z]/.test(ch)) {
        let sym = ch;
        if (/[a-z]/.test(s[i + 1] || "")) sym += s[i + 1];
        if (!ELEMENTS[sym]) {
          const hint = ELEMENTS[ch] && ELEMENTS[s[i + 1].toUpperCase()] ? ` (${ch}${s[i + 1].toUpperCase()} 를 쓰려던 건가요?)` : "";
          throw new ChemError(`‘${sym}’은(는) 원소 기호가 아니에요.${hint}`);
        }
        i += sym.length;
        c.set(sym, (c.get(sym) || 0) + num());
        continue;
      }
      if (/[a-z]/.test(ch)) throw new ChemError(`원소 기호는 대문자로 시작해요: ‘${ch}’ → ‘${ch.toUpperCase()}’?`);
      if (")]}".includes(ch)) throw new ChemError(`여는 괄호 없이 ‘${ch}’가 나왔어요.`);
      if (/\d/.test(ch)) throw new ChemError(`숫자 ‘${ch}’ 앞에 원소가 없어요.`);
      throw new ChemError(`‘${ch}’는 화학식에 쓸 수 없는 문자예요.`);
    }
    return c;
  }
  return seq(null);
}

/* 힐 순서: 탄소가 있으면 C, H 다음 알파벳 순, 없으면 전부 알파벳 순 */
function hillOrder(counts) {
  const els = [...counts.keys()].filter(e => counts.get(e) > 0);
  const hasC = els.includes("C");
  els.sort((a, b) => {
    if (hasC) {
      const ra = a === "C" ? 0 : a === "H" ? 1 : 2, rb = b === "C" ? 0 : b === "H" ? 1 : 2;
      if (ra !== rb) return ra - rb;
    }
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return els.map(e => [e, counts.get(e)]);
}
function hillKey(counts, charge) {
  return hillOrder(counts).map(([e, n]) => e + (n > 1 ? n : "")).join("") + (charge ? "^" + charge : "");
}

function composition(counts) {
  let mass = 0, atoms = 0;
  const rows = hillOrder(counts).map(([el, n]) => {
    const m = ELEMENTS[el].mass * n;
    mass += m; atoms += n;
    return { el, n, ko: ELEMENTS[el].ko, am: ELEMENTS[el].mass, mass: m };
  });
  rows.forEach(r => { r.pct = mass ? r.mass / mass * 100 : 0; });
  return { rows, mass, atoms };
}

/* 불포화도(고리 + π결합 수). C·H·N·O·S·할로젠만 있는 중성 분자에서만 의미가 있다. */
function unsaturation(counts, charge) {
  if (charge || !counts.get("C")) return null;
  let c = 0, h = 0, n = 0;
  for (const [el, k] of counts) {
    if (el === "C" || el === "Si") c += k;
    else if (el === "H" || el === "F" || el === "Cl" || el === "Br" || el === "I") h += k;
    else if (el === "N" || el === "P") n += k;
    else if (el !== "O" && el !== "S") return null;
  }
  const d = c + 1 + n / 2 - h / 2;
  return d >= 0 && Number.isInteger(d) ? d : null;
}

/* ---------- SMILES ---------- */
const ORGANIC_VAL = { B: [3], C: [4], N: [3, 5], O: [2], P: [3, 5], S: [2, 4, 6], F: [1], Cl: [1], Br: [1], I: [1] };
const AROM_SYM = { b: "B", c: "C", n: "N", o: "O", p: "P", s: "S", se: "Se", as: "As" };
const AROM_VAL = { B: 3, C: 4, N: 3, O: 2, P: 3, S: 2, Se: 2, As: 3 };
const BOND_SYM = { "-": 1, "=": 2, "#": 3, "$": 4, ":": 1.5, "/": 1, "\\": 1 };

function parseBracket(body) {
  const m = body.match(/^(\d+)?([A-Z][a-z]?|se|as|[bcnops])(@{1,2}(?:TH[12]|AL[12]|SP[123]|TB\d{1,2}|OH\d{1,2})?)?(H\d*)?(\+\d*|-\d*|\++|-+)?(:\d+)?$/);
  if (!m) throw new ChemError(`대괄호 원자 ‘[${body}]’를 이해할 수 없어요.`);
  const arom = /^[a-z]/.test(m[2]);
  const el = arom ? AROM_SYM[m[2]] : m[2];
  if (!ELEMENTS[el]) throw new ChemError(`‘${m[2]}’은(는) 원소 기호가 아니에요.`);
  let charge = 0;
  if (m[5]) {
    const sign = m[5][0] === "+" ? 1 : -1;
    charge = sign * (/\d/.test(m[5]) ? +m[5].slice(1) : m[5].length);
  }
  return { el, arom, charge, hx: m[4] ? (m[4].length > 1 ? +m[4].slice(1) : 1) : 0, iso: m[1] ? +m[1] : null };
}

function parseSmiles(input) {
  const s = String(input).trim();
  if (!s) throw new ChemError("SMILES를 입력해 주세요.");
  if (/\s/.test(s)) throw new ChemError("SMILES에는 띄어쓰기를 넣을 수 없어요.");
  const atoms = [], bonds = [], rings = new Map(), stack = [];
  let prev = -1, pend = null, i = 0;

  function addBond(a, b, sym) {
    if (a === b) throw new ChemError("원자가 자기 자신과 고리를 만들 수 없어요.");
    if (bonds.some(x => (x.a === a && x.b === b) || (x.a === b && x.b === a)))
      throw new ChemError("같은 두 원자 사이의 결합이 두 번 적혔어요.");
    let order, arom = false;
    if (sym == null) {
      if (atoms[a].arom && atoms[b].arom) { order = 1.5; arom = true; } else order = 1;
    } else { order = BOND_SYM[sym]; arom = order === 1.5; }
    bonds.push({ a, b, order, arom });
  }

  while (i < s.length) {
    const ch = s[i];
    if (ch === "(") {
      if (prev < 0) throw new ChemError("‘(’ 앞에 원자가 있어야 해요.");
      stack.push(prev); i++; continue;
    }
    if (ch === ")") {
      if (!stack.length) throw new ChemError("‘(’ 없이 ‘)’가 나왔어요.");
      if (pend) throw new ChemError("결합 기호 뒤에 원자가 없어요.");
      prev = stack.pop(); i++; continue;
    }
    if (ch in BOND_SYM) {
      if (prev < 0) throw new ChemError(`결합 기호 ‘${ch}’ 앞에 원자가 있어야 해요.`);
      if (pend) throw new ChemError("결합 기호가 연달아 나왔어요.");
      pend = ch; i++; continue;
    }
    if (ch === ".") {
      if (pend || stack.length) throw new ChemError("‘.’ 위치가 이상해요.");
      prev = -1; i++; continue;
    }
    if (/\d/.test(ch) || ch === "%") {
      if (prev < 0) throw new ChemError("고리 번호 앞에 원자가 있어야 해요.");
      let num;
      if (ch === "%") {
        const m = s.slice(i + 1).match(/^\d\d/);
        if (!m) throw new ChemError("‘%’ 뒤에는 두 자리 고리 번호가 와야 해요.");
        num = +m[0]; i += 3;
      } else { num = +ch; i++; }
      if (rings.has(num)) {
        const r = rings.get(num);
        rings.delete(num);
        addBond(r.atom, prev, pend != null ? pend : r.bond);
      } else rings.set(num, { atom: prev, bond: pend });
      pend = null; continue;
    }
    let atom;
    if (ch === "[") {
      const j = s.indexOf("]", i);
      if (j < 0) throw new ChemError("‘[’가 닫히지 않았어요.");
      atom = parseBracket(s.slice(i + 1, j));
      i = j + 1;
    } else {
      const two = s.slice(i, i + 2);
      if (two === "Cl" || two === "Br") { atom = { el: two, arom: false }; i += 2; }
      else if ("BCNOPSFI".includes(ch)) { atom = { el: ch, arom: false }; i++; }
      else if ("bcnops".includes(ch)) { atom = { el: AROM_SYM[ch], arom: true }; i++; }
      else if (/[A-Z]/.test(ch)) {
        const sym = /[a-z]/.test(s[i + 1] || "") && ELEMENTS[ch + s[i + 1]] ? ch + s[i + 1] : ch;
        throw new ChemError(`SMILES에서 ${sym} 같은 원소는 대괄호로 감싸야 해요: [${sym}]`);
      } else throw new ChemError(`SMILES에서 ‘${ch}’를 이해할 수 없어요.`);
      atom.charge = 0; atom.hx = null; atom.iso = null;
    }
    if (atoms.length >= 250) throw new ChemError("원자가 너무 많아요 (250개까지).");
    const idx = atoms.push(atom) - 1;
    if (prev >= 0) addBond(prev, idx, pend);
    pend = null; prev = idx;
  }
  if (pend) throw new ChemError("결합 기호 뒤에 원자가 없어요.");
  if (stack.length) throw new ChemError("‘(’가 닫히지 않았어요.");
  if (rings.size) throw new ChemError(`고리 번호 ${[...rings.keys()].join(", ")}이(가) 닫히지 않았어요.`);
  if (!atoms.length) throw new ChemError("원자가 하나도 없어요.");

  const mol = { atoms, bonds, warnings: [] };
  finishMol(mol);
  return mol;
}

function bondSum(mol, i) {
  let s = 0, exoDouble = false;
  for (const b of mol.bonds) if (b.a === i || b.b === i) {
    s += b.arom ? 1 : b.order;
    if (!b.arom && b.order >= 2) exoDouble = true;
  }
  return { s, exoDouble };
}

function finishMol(mol) {
  const { atoms, bonds } = mol;
  atoms.forEach((a, i) => {
    a.deg = bonds.filter(b => b.a === i || b.b === i).length;
    const { s, exoDouble } = bondSum(mol, i);
    const extra = a.arom && !exoDouble ? 1 : 0;
    if (a.hx == null) {
      const vals = ORGANIC_VAL[a.el];
      a.h = 0;
      let ok = false;
      if (a.arom) {
        // 방향족 원자는 가장 낮은 원자가만 쓴다 (n이 5가로 계산되면 H가 잘못 붙음)
        a.h = Math.max(0, vals[0] - s - extra);
        ok = s <= vals[0];
      } else {
        for (const v of vals) if (v >= s) { a.h = v - s; ok = true; break; }
      }
      if (!ok) mol.warnings.push(`${a.el} 원자에 결합이 너무 많아요 (결합 수 ${s}).`);
    } else a.h = a.hx;
  });
  kekulize(mol);
}

/* 방향족 결합을 단일/이중 결합으로 나눈다 (완전 매칭을 백트래킹으로 찾음) */
function kekulize(mol) {
  const { atoms, bonds } = mol;
  const arBonds = bonds.filter(b => b.arom);
  if (!arBonds.length) return;
  const needy = atoms.map((a, i) => {
    if (!a.arom) return false;
    let v = AROM_VAL[a.el] || 3;
    if (a.el === "C" || a.el === "B") v -= Math.abs(a.charge);
    else v += a.charge;
    const { s, exoDouble } = bondSum(mol, i);
    if (exoDouble) return false;
    return v - s - a.h >= 1;
  });
  const nb = atoms.map(() => []);
  arBonds.forEach(b => { if (needy[b.a] && needy[b.b]) { nb[b.a].push(b); nb[b.b].push(b); } });
  const mate = atoms.map(() => null);
  let budget = 50000;
  function solve() {
    if (--budget < 0) return false;
    let best = -1, bestCnt = 1e9;
    for (let i = 0; i < atoms.length; i++) {
      if (!needy[i] || mate[i]) continue;
      const cnt = nb[i].filter(b => !mate[b.a === i ? b.b : b.a]).length;
      if (cnt < bestCnt) { best = i; bestCnt = cnt; }
    }
    if (best < 0) return true;
    if (!bestCnt) return false;
    for (const b of nb[best]) {
      const o = b.a === best ? b.b : b.a;
      if (mate[o]) continue;
      mate[best] = mate[o] = b;
      if (solve()) return true;
      mate[best] = mate[o] = null;
    }
    return false;
  }
  if (solve()) {
    arBonds.forEach(b => { b.order = mate[b.a] === b ? 2 : 1; b.arom = false; b.wasArom = true; });
  } else {
    mol.warnings.push("방향족 고리를 이중 결합 구조로 바꾸지 못했어요. 피롤 같은 N–H는 [nH]로 적어 주세요.");
  }
}

function molCounts(mol) {
  const c = new Map();
  let charge = 0;
  for (const a of mol.atoms) {
    c.set(a.el, (c.get(a.el) || 0) + 1);
    if (a.h) c.set("H", (c.get("H") || 0) + a.h);
    charge += a.charge;
  }
  return { counts: c, charge };
}

/* 수소를 별도 원자로 펼친 복사본 (전체 구조식·공-막대 모형용) */
function expandH(mol) {
  const atoms = mol.atoms.map(a => Object.assign({}, a));
  const bonds = mol.bonds.map(b => Object.assign({}, b));
  const n = atoms.length;
  for (let i = 0; i < n; i++) {
    const h = atoms[i].h;
    atoms[i].h = 0;
    for (let k = 0; k < h; k++) {
      const j = atoms.push({ el: "H", arom: false, charge: 0, hx: 0, h: 0, iso: null, deg: 1 }) - 1;
      bonds.push({ a: i, b: j, order: 1, arom: false });
      atoms[i].deg++;
    }
  }
  return { atoms, bonds, warnings: mol.warnings };
}

/* ---------- 고리 찾기: 결합마다 그 결합을 지나는 가장 작은 고리 ---------- */
function adjacency(mol) {
  const adj = mol.atoms.map(() => []);
  mol.bonds.forEach(b => { adj[b.a].push(b.b); adj[b.b].push(b.a); });
  return adj;
}

function findRings(mol, adj) {
  const rings = [], seen = new Set();
  for (const b of mol.bonds) {
    const prev = new Map([[b.a, -1]]);
    const q = [b.a];
    let found = false;
    while (q.length && !found) {
      const u = q.shift();
      for (const v of adj[u]) {
        if (u === b.a && v === b.b) continue;
        if (prev.has(v)) continue;
        prev.set(v, u);
        if (v === b.b) { found = true; break; }
        q.push(v);
      }
    }
    if (!found) continue;
    const path = [];
    for (let v = b.b; v !== -1; v = prev.get(v)) path.push(v);
    const key = path.slice().sort((x, y) => x - y).join(",");
    if (!seen.has(key)) { seen.add(key); rings.push(path); }
  }
  return rings;
}

/* ---------- 2D 배치: 목표 거리 + 스트레스 최소화(SMACOF) ---------- */
function layout(mol) {
  const n = mol.atoms.length;
  const adj = adjacency(mol);
  const rings = findRings(mol, adj);
  mol.rings = rings;
  const comp = new Array(n).fill(-1);
  const comps = [];
  for (let i = 0; i < n; i++) {
    if (comp[i] >= 0) continue;
    const list = [i]; comp[i] = comps.length;
    for (let k = 0; k < list.length; k++) for (const v of adj[list[k]]) if (comp[v] < 0) { comp[v] = comps.length; list.push(v); }
    comps.push(list);
  }
  const pos = new Array(n);
  let cursor = 0;
  comps.forEach(nodes => {
    const xy = layoutComponent(mol, nodes, adj, rings);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    xy.forEach(([x, y]) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); });
    const cy = (minY + maxY) / 2;
    nodes.forEach((g, k) => { pos[g] = [xy[k][0] - minX + cursor, xy[k][1] - cy]; });
    cursor += maxX - minX + 1.8;
  });
  mol.atoms.forEach((a, i) => { a.x = pos[i][0]; a.y = pos[i][1]; });
  return mol;
}

function bondBetween(mol, a, b) {
  return mol.bonds.find(x => (x.a === a && x.b === b) || (x.a === b && x.b === a));
}

function layoutComponent(mol, nodes, adj, rings) {
  const m = nodes.length;
  if (m === 1) return [[0, 0]];
  if (m === 2) return [[0, 0], [1, 0]];
  const loc = new Map(nodes.map((g, k) => [g, k]));
  const G = [];
  for (let i = 0; i < m; i++) {
    const d = new Array(m).fill(Infinity); d[i] = 0;
    const q = [nodes[i]];
    for (let k = 0; k < q.length; k++) {
      const u = q[k], du = d[loc.get(u)];
      for (const v of adj[u]) { const lv = loc.get(v); if (d[lv] === Infinity) { d[lv] = du + 1; q.push(v); } }
    }
    G.push(d);
  }
  // 고리 안 두 원자의 거리는 정다각형의 현 길이
  const ringD = new Map(), ringOf = new Map();
  rings.filter(r => loc.has(r[0])).sort((a, b) => a.length - b.length).forEach(r => {
    const s = r.length;
    r.forEach(g => { if (!ringOf.has(g)) ringOf.set(g, r); });
    for (let p = 0; p < s; p++) for (let q = p + 1; q < s; q++) {
      const i = loc.get(r[p]), j = loc.get(r[q]), key = i < j ? i * m + j : j * m + i;
      if (ringD.has(key)) continue;
      const k = Math.min(q - p, s - (q - p));
      ringD.set(key, Math.sin(Math.PI * k / s) / Math.sin(Math.PI / s));
    }
  });
  const inRing = (g, r) => r && r.includes(g);
  const D = [], W = [], Wk = [];
  for (let i = 0; i < m; i++) { D.push(new Array(m).fill(0)); W.push(new Array(m).fill(0)); }
  for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) {
    const k = G[i][j];
    let d;
    const key = i * m + j;
    if (k === 1) d = 1;
    else if (ringD.has(key)) d = ringD.get(key);
    else if (k === 2) {
      const gi = nodes[i], gj = nodes[j];
      const c = adj[gi].find(v => adj[gj].includes(v));
      const r = ringOf.get(c);
      const b1 = bondBetween(mol, gi, c), b2 = bondBetween(mol, gj, c);
      if (adj[c].length === 2 && (b1.order === 3 || b2.order === 3 || (b1.order === 2 && b2.order === 2))) d = 2;
      else if (r && (inRing(gi, r) !== inRing(gj, r))) {
        const ext = (Math.PI * 2 - Math.PI * (r.length - 2) / r.length) / 2;
        d = 2 * Math.sin(ext / 2);
      } else if (adj[c].length >= 4) d = 1.6;
      else d = Math.sqrt(3);
    } else if (k === 3) {
      // 고리 결합 양쪽의 치환기(오르토 위치)는 서로 가깝다
      const gi = nodes[i], gj = nodes[j];
      let cis = false;
      for (const a of adj[gi]) for (const b of adj[gj]) {
        if (adj[a].includes(b)) {
          const r = ringOf.get(a);
          if (r && r.includes(b) && !r.includes(gi) && !r.includes(gj)) cis = true;
        }
      }
      d = cis ? 2 : 2.6;
      // 가지가 많은 결합 주위의 1-4 거리는 다 맞출 수 없으니 약하게 건다
      let br = 1;
      for (const a of adj[gi]) for (const b of adj[gj]) if (adj[a].includes(b)) br = Math.max(br, adj[a].length - 1, adj[b].length - 1);
      Wk[key] = 1 / (br * br);
    } else d = k * 0.866;
    D[i][j] = D[j][i] = d;
    // 결합 길이와 고리 모양은 더 단단하게 지킨다
    const wk = k === 1 || ringD.has(key) ? 4 : k === 2 ? 2 : k === 3 ? Wk[key] : 0.3;
    W[i][j] = W[j][i] = wk / (d * d);
  }
  // 고전적 MDS로 초기 위치
  const D2 = D.map(r => r.map(v => v * v));
  const rowMean = D2.map(r => r.reduce((s, v) => s + v, 0) / m);
  const tot = rowMean.reduce((s, v) => s + v, 0) / m;
  const B = D2.map((r, i) => r.map((v, j) => -0.5 * (v - rowMean[i] - rowMean[j] + tot)));
  function power(Bm) {
    let v = Array.from({ length: m }, (_, i) => Math.sin(i * 1.37 + 0.5) + 0.01 * i);
    let lam = 0;
    for (let it = 0; it < 200; it++) {
      const w = Bm.map(r => r.reduce((s, x, j) => s + x * v[j], 0));
      const norm = Math.hypot(...w) || 1;
      lam = norm;
      v = w.map(x => x / norm);
    }
    const Bv = Bm.map(r => r.reduce((s, x, j) => s + x * v[j], 0));
    lam = Bv.reduce((s, x, i) => s + x * v[i], 0);
    return { v, lam };
  }
  const e1 = power(B);
  const B2 = B.map((r, i) => r.map((x, j) => x - e1.lam * e1.v[i] * e1.v[j]));
  const e2 = power(B2);
  const s1 = Math.sqrt(Math.max(e1.lam, 0)), s2 = Math.sqrt(Math.max(e2.lam, 0));
  function smacof(X) {
    // 가우스-자이델 방식으로 한 원자씩 갱신
    for (let it = 0; it < 300; it++) {
      for (let i = 0; i < m; i++) {
        let nx = 0, ny = 0, den = 0;
        const xi = X[i];
        for (let j = 0; j < m; j++) {
          if (j === i) continue;
          const w = W[i][j], dx = xi[0] - X[j][0], dy = xi[1] - X[j][1];
          const dist = Math.hypot(dx, dy) || 1e-6;
          nx += w * (X[j][0] + D[i][j] * dx / dist);
          ny += w * (X[j][1] + D[i][j] * dy / dist);
          den += w;
        }
        xi[0] = nx / den; xi[1] = ny / den;
      }
    }
    let stress = 0;
    for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) {
      const e = Math.hypot(X[i][0] - X[j][0], X[i][1] - X[j][1]) - D[i][j];
      stress += W[i][j] * e * e;
    }
    return { X, stress };
  }
  // MDS 초기값과 그 변형 몇 개로 돌려서 스트레스가 가장 낮은 배치를 고른다
  let best = null;
  const tries = m > 120 ? 1 : 4;
  for (let t = 0; t < tries; t++) {
    const X = nodes.map((_, i) => [
      e1.v[i] * s1 + (t ? 0.6 * Math.sin(i * 3.1 + t * 1.7) : 0),
      e2.v[i] * s2 * (t === 2 ? -1 : 1) + 0.15 * Math.sin(i * 2.1 + 1 + t) + (t ? 0.6 * Math.cos(i * 2.3 + t) : 0),
    ]);
    const r = smacof(X);
    if (!best || r.stress < best.stress - 1e-9) best = r;
  }
  const X = best.X;
  if (flipInward(nodes, loc, X, adj, rings)) smacof(X);
  // 가장 긴 방향이 가로가 되도록 회전
  let mx = 0, my = 0;
  X.forEach(([x, y]) => { mx += x; my += y; });
  mx /= m; my /= m;
  let sxx = 0, syy = 0, sxy = 0;
  X.forEach(([x, y]) => { const dx = x - mx, dy = y - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; });
  const th = -0.5 * Math.atan2(2 * sxy, sxx - syy);
  const c = Math.cos(th), s = Math.sin(th);
  return X.map(([x, y]) => [(x - mx) * c - (y - my) * s, (x - mx) * s + (y - my) * c]);
}

/* 고리 안쪽을 향한 치환기(고리에 속하지 않는 가지)를 고리 바깥쪽으로 돌린다 */
function flipInward(nodes, loc, X, adj, rings) {
  let moved = false;
  const ringBond = new Set();
  rings.forEach(r => r.forEach((g, t) => {
    const h = r[(t + 1) % r.length];
    ringBond.add(g < h ? g + "," + h : h + "," + g);
  }));
  for (const r of rings) {
    if (!loc.has(r[0])) continue;
    let cx = 0, cy = 0;
    r.forEach(g => { cx += X[loc.get(g)][0]; cy += X[loc.get(g)][1]; });
    cx /= r.length; cy /= r.length;
    for (const a of r) {
      const subs = adj[a].filter(v => !ringBond.has(a < v ? a + "," + v : v + "," + a));
      const [ax, ay] = X[loc.get(a)];
      let ox = ax - cx, oy = ay - cy;
      const ol = Math.hypot(ox, oy) || 1;
      ox /= ol; oy /= ol;
      subs.forEach((sub, t) => {
        const [sx, sy] = X[loc.get(sub)];
        if ((sx - ax) * ox + (sy - ay) * oy >= 0) return;
        // 목표 방향: 바깥쪽 (치환기가 둘이면 ±35°로 벌림)
        const spread = subs.length > 1 ? (t ? 0.6 : -0.6) : 0;
        const tx = ox * Math.cos(spread) - oy * Math.sin(spread), ty = ox * Math.sin(spread) + oy * Math.cos(spread);
        const cur = Math.atan2(sy - ay, sx - ax), want = Math.atan2(ty, tx), d = want - cur;
        const c = Math.cos(d), s = Math.sin(d);
        const seen = new Set([a, sub]), q = [sub];
        for (let k = 0; k < q.length; k++) for (const v of adj[q[k]]) if (!seen.has(v)) { seen.add(v); q.push(v); }
        if (q.some(g => r.includes(g))) return;  // 다리 결합이 아니면 건드리지 않음
        q.forEach(g => {
          const p = X[loc.get(g)], dx = p[0] - ax, dy = p[1] - ay;
          p[0] = ax + dx * c - dy * s; p[1] = ay + dx * s + dy * c;
        });
        moved = true;
      });
    }
  }
  return moved;
}

/* ---------- 내장 사전 ---------- */
// [한글 이름, 영어 이름, SMILES, 별칭(이름·축약 구조식), 한 줄 설명]
const DICT_RAW = [
  ["물", "water", "O", ["H2O", "HOH"], "생명에 꼭 필요한 액체. 산소 1개에 수소 2개가 굽은 모양으로 붙어 있어요."],
  ["과산화 수소", "hydrogen peroxide", "OO", ["H2O2", "과산화수소수"], "상처 소독약(과산화수소수)의 성분이에요."],
  ["산소", "oxygen", "O=O", ["O2"], "숨 쉴 때 필요한 기체. 두 원자가 이중 결합으로 이어져 있어요."],
  ["오존", "ozone", "[O-][O+]=O", ["O3"], "높은 하늘에서 자외선을 막아 주는 기체예요."],
  ["질소", "nitrogen", "N#N", ["N2"], "공기의 약 78%. 삼중 결합이라 아주 단단해요."],
  ["수소", "hydrogen", "[H][H]", ["H2"], "우주에서 가장 흔하고 가장 가벼운 원소의 기체."],
  ["염소", "chlorine", "ClCl", ["Cl2"], "수돗물 소독에 쓰는 기체예요."],
  ["이산화 탄소", "carbon dioxide", "O=C=O", ["CO2", "이산화탄소"], "숨을 내쉴 때 나오는 기체. 일직선 모양이에요."],
  ["일산화 탄소", "carbon monoxide", "[C-]#[O+]", ["CO", "일산화탄소"], "불이 덜 탈 때 생기는 위험한 기체예요."],
  ["암모니아", "ammonia", "N", ["NH3"], "톡 쏘는 냄새가 나고, 비료의 원료가 돼요."],
  ["메테인", "methane", "C", ["CH4", "메탄"], "천연가스의 주성분. 가장 간단한 탄화수소예요."],
  ["에테인", "ethane", "CC", ["C2H6", "CH3CH3", "에탄"], "탄소 2개짜리 탄화수소."],
  ["프로페인", "propane", "CCC", ["C3H8", "CH3CH2CH3", "프로판"], "캠핑용 가스통에 들어 있는 연료예요."],
  ["뷰테인", "butane", "CCCC", ["C4H10", "CH3CH2CH2CH3", "부탄"], "휴대용 가스레인지 연료예요."],
  ["아이소뷰테인", "isobutane", "CC(C)C", ["이소부탄", "아이소부탄", "CH(CH3)3"], "뷰테인과 분자식이 같지만 가지가 달린 이성질체예요."],
  ["헥세인", "hexane", "CCCCCC", ["헥산"], "탄소 6개가 사슬로 이어진 탄화수소."],
  ["사이클로헥세인", "cyclohexane", "C1CCCCC1", ["사이클로헥산", "시클로헥산"], "탄소 6개가 고리를 이룬 분자예요."],
  ["에텐", "ethylene", "C=C", ["C2H4", "CH2CH2", "CH2=CH2", "에틸렌"], "과일을 익게 하는 식물 호르몬이자 비닐(PE)의 원료."],
  ["에타인", "acetylene", "C#C", ["C2H2", "아세틸렌"], "용접 불꽃에 쓰는 기체. 삼중 결합이 있어요."],
  ["메탄올", "methanol", "CO", ["CH3OH", "메틸알코올", "메틸 알코올"], "마시면 아주 위험한 알코올이에요."],
  ["에탄올", "ethanol", "CCO", ["C2H5OH", "CH3CH2OH", "에틸알코올", "에틸 알코올", "알코올"], "술과 손 소독제의 주성분이에요."],
  ["다이메틸 에테르", "dimethyl ether", "COC", ["CH3OCH3", "디메틸에테르"], "에탄올과 분자식(C₂H₆O)이 같은 이성질체예요."],
  ["1-프로판올", "1-propanol", "CCCO", ["CH3CH2CH2OH", "프로판올"], "탄소 3개짜리 알코올."],
  ["아이소프로필 알코올", "isopropyl alcohol", "CC(C)O", ["2-프로판올", "이소프로필알코올", "IPA", "(CH3)2CHOH"], "전자기기 세척제로 많이 써요."],
  ["에틸렌 글라이콜", "ethylene glycol", "OCCO", ["에틸렌글리콜", "에틸렌글라이콜"], "자동차 부동액의 성분이에요."],
  ["글리세롤", "glycerol", "OCC(O)CO", ["글리세린"], "화장품 보습제로 쓰는 달콤한 액체예요."],
  ["폼알데하이드", "formaldehyde", "C=O", ["HCHO", "CH2O", "포름알데히드"], "새집 증후군의 원인 물질이에요."],
  ["아세트알데하이드", "acetaldehyde", "CC=O", ["CH3CHO", "아세트알데히드"], "술을 마신 뒤 숙취를 일으키는 물질이에요."],
  ["아세톤", "acetone", "CC(C)=O", ["CH3COCH3"], "매니큐어 지우개의 성분이에요."],
  ["폼산", "formic acid", "OC=O", ["HCOOH", "포름산", "개미산"], "개미가 쏠 때 나오는 산이에요."],
  ["아세트산", "acetic acid", "CC(=O)O", ["CH3COOH", "초산"], "식초의 신맛을 내는 산이에요."],
  ["폼산 메틸", "methyl formate", "COC=O", ["HCOOCH3", "포름산메틸"], "아세트산과 분자식이 같은 이성질체(에스터)예요."],
  ["젖산", "lactic acid", "CC(O)C(=O)O", ["락트산"], "요구르트의 새콤한 맛을 내요."],
  ["시트르산", "citric acid", "OC(=O)CC(O)(CC(=O)O)C(=O)O", ["구연산"], "레몬의 신맛을 내는 산이에요."],
  ["벤젠", "benzene", "c1ccccc1", ["C6H6"], "탄소 6개 고리에 이중 결합이 번갈아 있는 방향족 화합물이에요."],
  ["톨루엔", "toluene", "Cc1ccccc1", ["C6H5CH3"], "페인트 시너에 들어 있는 용매예요."],
  ["페놀", "phenol", "Oc1ccccc1", ["C6H5OH", "석탄산"], "벤젠 고리에 –OH가 붙은 분자예요."],
  ["벤조산", "benzoic acid", "OC(=O)c1ccccc1", ["C6H5COOH", "안식향산"], "음료의 보존료로 써요."],
  ["나프탈렌", "naphthalene", "c1ccc2ccccc2c1", ["C10H8"], "벤젠 고리 2개가 붙은 모양. 좀약 냄새가 나요."],
  ["포도당", "glucose", "OCC1OC(O)C(O)C(O)C1O", ["글루코스"], "우리 몸의 주 에너지원. 물에 녹으면 주로 고리 모양이에요."],
  ["과당", "fructose", "OCC1(O)OCC(O)C(O)C1O", ["프럭토스", "프룩토스"], "과일의 단맛. 포도당과 분자식이 같은 이성질체예요."],
  ["설탕", "sucrose", "OCC1OC(OC2(CO)OC(CO)C(O)C2O)C(O)C(O)C1O", ["수크로스", "자당"], "포도당과 과당이 하나씩 이어진 분자예요."],
  ["요소", "urea", "NC(N)=O", ["CO(NH2)2", "NH2CONH2"], "오줌 속에 들어 있고, 비료로도 써요."],
  ["글리신", "glycine", "NCC(=O)O", ["NH2CH2COOH"], "가장 간단한 아미노산이에요."],
  ["알라닌", "alanine", "CC(N)C(=O)O", [], "단백질을 만드는 아미노산 중 하나예요."],
  ["카페인", "caffeine", "CN1C=NC2=C1C(=O)N(C)C(=O)N2C", [], "커피와 차에 들어 있어 잠을 깨워요."],
  ["아스피린", "aspirin", "CC(=O)OC1=CC=CC=C1C(=O)O", ["아세틸살리실산"], "열을 내리고 통증을 줄이는 약이에요."],
  ["아세트아미노펜", "acetaminophen", "CC(=O)NC1=CC=C(O)C=C1", ["파라세타몰", "타이레놀"], "열을 내리고 통증을 줄이는 약이에요."],
  ["이부프로펜", "ibuprofen", "CC(C)CC1=CC=C(C=C1)C(C)C(=O)O", [], "염증과 통증을 줄이는 약이에요."],
  ["비타민 C", "ascorbic acid", "OCC(O)C1OC(=O)C(O)=C1O", ["비타민C", "아스코르브산", "vitamin c"], "과일과 채소에 많은 비타민이에요."],
  ["바닐린", "vanillin", "COC1=C(O)C=CC(C=O)=C1", ["바닐라"], "바닐라 향을 내는 분자예요."],
  ["니코틴", "nicotine", "CN1CCCC1C1=CN=CC=C1", [], "담배에 들어 있는 중독성 물질이에요."],
  ["염화 수소", "hydrogen chloride", "Cl", ["HCl", "염산", "염화수소"], "물에 녹은 것이 염산. 위액에도 들어 있어요."],
  ["황산", "sulfuric acid", "OS(=O)(=O)O", ["H2SO4"], "아주 강한 산. 자동차 배터리에 들어 있어요."],
  ["질산", "nitric acid", "O[N+](=O)[O-]", ["HNO3"], "비료와 화약을 만드는 데 쓰는 강한 산이에요."],
  ["탄산", "carbonic acid", "OC(=O)O", ["H2CO3"], "탄산음료 속에서 이산화 탄소가 물과 만나 생겨요."],
  ["인산", "phosphoric acid", "OP(=O)(O)O", ["H3PO4"], "콜라의 새콤한 맛을 내요."],
  ["사이안화 수소", "hydrogen cyanide", "C#N", ["HCN", "시안화수소"], "아주 독한 기체. 삼중 결합이 있어요."],
  ["이산화 황", "sulfur dioxide", "O=S=O", ["SO2", "이산화황"], "화산 가스와 산성비의 원인이에요."],
  ["아산화 질소", "nitrous oxide", "[N-]=[N+]=O", ["N2O", "웃음 가스", "웃음가스"], "치과에서 쓰는 마취 기체예요."],
  ["염화 나트륨", "sodium chloride", "[Na+].[Cl-]", ["NaCl", "소금"], "소금. Na⁺ 이온과 Cl⁻ 이온이 끌어당겨 생겨요."],
  ["수산화 나트륨", "sodium hydroxide", "[Na+].[OH-]", ["NaOH", "가성소다"], "비누를 만들 때 쓰는 강한 염기예요."],
  ["수산화 칼슘", "calcium hydroxide", "[Ca+2].[OH-].[OH-]", ["Ca(OH)2", "소석회"], "석회수의 성분이에요."],
  ["탄산 칼슘", "calcium carbonate", "[Ca+2].[O-]C([O-])=O", ["CaCO3", "석회석", "분필"], "달걀 껍데기, 조개껍데기, 분필의 성분이에요."],
  ["탄산수소 나트륨", "sodium bicarbonate", "[Na+].OC([O-])=O", ["NaHCO3", "베이킹 소다", "베이킹소다"], "빵을 부풀리는 베이킹 소다예요."],
  ["암모늄 이온", "ammonium", "[NH4+]", [], "암모니아에 H⁺가 붙은 양이온이에요."],
  ["하이드로늄 이온", "hydronium", "[OH3+]", [], "물에 H⁺가 붙은 이온. 산성의 정체예요."],
  ["수산화 이온", "hydroxide", "[OH-]", [], "염기성의 정체인 음이온이에요."],
  ["황산 이온", "sulfate", "[O-]S(=O)(=O)[O-]", [], "황산이 H⁺를 2개 내놓고 남은 음이온이에요."],
  ["탄산 이온", "carbonate", "[O-]C([O-])=O", [], "탄산이 H⁺를 2개 내놓고 남은 음이온이에요."],
];

function normName(s) { return String(s).toLowerCase().replace(/[\s·\-()]/g, ""); }

const DICT = DICT_RAW.map(([ko, en, smiles, aliases, desc], id) => {
  const mol = parseSmiles(smiles);
  const { counts, charge } = molCounts(mol);
  return { id, ko, en, smiles, aliases, desc, key: hillKey(counts, charge) };
});

/* 화학식 모양의 별칭(대문자로 시작)은 대소문자를 구분하고, 이름은 구분하지 않는다 */
function lookupName(input) {
  const raw = String(input).trim().replace(/\s+/g, "");
  const n = normName(input);
  if (!n) return null;
  for (const e of DICT) {
    if (normName(e.ko) === n || normName(e.en) === n) return e;
    for (const a of e.aliases) {
      if (/^[A-Z(]/.test(a) ? a.replace(/\s+/g, "") === raw : normName(a) === n) return e;
    }
  }
  return null;
}

function lookupFormula(key) { return DICT.filter(e => e.key === key); }

/* ---------- 3D 좌표: 결합 길이·결합각 목표 + 스트레스 최소화 ----------
   2D 배치(layout)를 마친 분자(수소 펼친 것)를 받아 Å 단위 [x,y,z] 배열을 돌려준다.
   입체 정보(@, /, \)는 쓰지 않으므로 거울상 중 어느 쪽이 나올지는 정해져 있지 않다. */
const COV_R = { H: .31, B: .84, C: .76, N: .71, O: .66, F: .57, Si: 1.11, P: 1.07, S: 1.05, Cl: 1.02, Br: 1.20, I: 1.39, Se: 1.20, As: 1.19 };

function bondLength(mol, b) {
  const r = (COV_R[mol.atoms[b.a].el] || 1.3) + (COV_R[mol.atoms[b.b].el] || 1.3);
  return r * (b.arom || b.wasArom ? .91 : b.order >= 3 ? .78 : b.order >= 2 ? .87 : 1);
}

function embed3D(mol) {
  const n = mol.atoms.length;
  const adj = adjacency(mol);
  const rings = mol.rings || findRings(mol, adj);
  const bmap = new Map();
  mol.bonds.forEach(b => { bmap.set(b.a * n + b.b, b); bmap.set(b.b * n + b.a, b); });
  const bond = (i, j) => bmap.get(i * n + j);
  const blen = mol.bonds.map(b => bondLength(mol, b));
  const lenOf = (i, j) => blen[mol.bonds.indexOf(bond(i, j))];

  // 혼성: 삼중 또는 이중 2개 → sp(180°), 이중·방향족 → sp2(120°), 나머지 sp3(109.5°)
  const hyb = mol.atoms.map((a, i) => {
    let dbl = 0, tri = 0, ar = false;
    adj[i].forEach(j => { const b = bond(i, j); if (b.arom || b.wasArom) ar = true; else if (b.order >= 3) tri++; else if (b.order >= 2) dbl++; });
    if (tri || dbl >= 2) return 1;
    return dbl || ar ? 2 : 3;
  });
  // 원자가 모두 sp2인 고리는 평평한 정다각형으로 둔다
  const planar = rings.filter(r => r.every(g => hyb[g] <= 2) || r.length <= 4);
  const ringOf = new Map();
  planar.slice().sort((a, b) => a.length - b.length).forEach(r => r.forEach(g => { if (!ringOf.has(g)) ringOf.set(g, r); }));

  const T = new Map();  // key → [목표 거리, 가중치, 한쪽 방향(밀어내기만)?]
  const key = (i, j) => i < j ? i * n + j : j * n + i;
  const set = (i, j, d, w, rep) => { const k = key(i, j); if (!T.has(k) || T.get(k)[1] < w) T.set(k, [d, w, !!rep]); };

  mol.bonds.forEach((b, t) => set(b.a, b.b, blen[t], 8));
  planar.forEach(r => {
    const s = r.length;
    let avg = 0;
    r.forEach((g, t) => { avg += lenOf(g, r[(t + 1) % s]); });
    avg /= s;
    for (let p = 0; p < s; p++) for (let q = p + 1; q < s; q++) {
      const k = Math.min(q - p, s - (q - p));
      if (k > 1) set(r[p], r[q], avg * Math.sin(Math.PI * k / s) / Math.sin(Math.PI / s), 4);
    }
  });
  // 결합각 (1-3 거리)
  for (let c = 0; c < n; c++) {
    const nb = adj[c];
    for (let p = 0; p < nb.length; p++) for (let q = p + 1; q < nb.length; q++) {
      const i = nb[p], j = nb[q];
      if (bond(i, j)) continue;
      let ang = hyb[c] === 1 ? Math.PI : hyb[c] === 2 ? Math.PI * 2 / 3 : 1.9106;
      const r = ringOf.get(c);
      if (r && r.includes(i) !== r.includes(j)) ang = Math.PI - Math.PI * (r.length - 2) / r.length / 2;
      else if (r && r.includes(i) && r.includes(j)) continue;  // 고리 다각형이 이미 정함
      const a = lenOf(c, i), b = lenOf(c, j);
      set(i, j, Math.sqrt(a * a + b * b - 2 * a * b * Math.cos(ang)), 4);
    }
  }
  // 이중 결합 양쪽 치환기: 2D 그림의 시스/트랜스를 그대로 평면으로
  mol.bonds.forEach(b => {
    if (!(b.order >= 2 && b.order < 3 && !b.arom)) return;
    const A = mol.atoms[b.a], B = mol.atoms[b.b];
    const ux = B.x - A.x, uy = B.y - A.y;
    const L = lenOf(b.a, b.b);
    adj[b.a].forEach(i => adj[b.b].forEach(j => {
      if (i === b.b || j === b.a || i === j) return;
      const si = Math.sign(ux * (mol.atoms[i].y - A.y) - uy * (mol.atoms[i].x - A.x));
      const sj = Math.sign(ux * (mol.atoms[j].y - B.y) - uy * (mol.atoms[j].x - B.x));
      const li = lenOf(b.a, i), lj = lenOf(b.b, j), th = Math.PI / 3;
      const pi = [-li * Math.cos(th), li * Math.sin(th)];
      const pj = [L + lj * Math.cos(th), (si === sj ? 1 : -1) * lj * Math.sin(th)];
      set(i, j, Math.hypot(pi[0] - pj[0], pi[1] - pj[1]), 2);
    }));
  });
  // 나머지 쌍은 너무 가까울 때만 밀어낸다
  const comp = new Array(n).fill(-1);
  for (let s = 0, c = 0; s < n; s++) {
    if (comp[s] >= 0) continue;
    const q = [s]; comp[s] = c;
    for (let k = 0; k < q.length; k++) for (const v of adj[q[k]]) if (comp[v] < 0) { comp[v] = c; q.push(v); }
    c++;
  }
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (T.has(key(i, j))) continue;
    const hi = mol.atoms[i].el === "H", hj = mol.atoms[j].el === "H";
    const d = comp[i] !== comp[j] ? 3.4 : hi && hj ? 2.1 : hi || hj ? 2.5 : 2.9;
    set(i, j, d, 1, true);
  }

  // sp2 원자 + 이웃 셋은 한 평면 위에 있어야 한다. 평면에서 살짝 벗어난 방향으로는 스트레스가
  // 거의 변하지 않아 수렴이 느리므로, 매 반복마다 원자를 이웃 셋의 평면 쪽으로 직접 당긴다.
  const flat = mol.atoms.map((a, i) => i).filter(i => hyb[i] === 2 && adj[i].length === 3);
  // 평평해야 할 부분(sp2와 거기 붙은 원자)은 z=0에서 시작해야 휘어진 채로 갇히지 않는다
  const pucker = mol.atoms.map((a, i) => hyb[i] === 3 && !(a.el === "H" && adj[i].some(j => hyb[j] <= 2)));
  const X = mol.atoms.map((a, i) => [a.x * 1.45, a.y * 1.45, pucker[i] ? 0.9 * Math.sin(i * 2.39 + 0.7) : 0]);
  const pairs = [...T.entries()].map(([k, v]) => [Math.floor(k / n), k % n, v[0], v[1] / (v[0] * v[0]), v[2]]);
  const per = mol.atoms.map(() => []);
  pairs.forEach(p => { per[p[0]].push([p[1], p[2], p[3], p[4]]); per[p[1]].push([p[0], p[2], p[3], p[4]]); });
  // 계산량을 대략 일정하게: 작은 분자는 반복을 많이, 큰 분자는 적게
  const iters = Math.max(300, Math.min(4000, Math.round(4e6 / (pairs.length * 2 || 1))));
  const OMEGA = 1.5;  // 과완화(SOR)로 수렴을 앞당긴다
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < n; i++) {
      const xi = X[i];
      let sx = 0, sy = 0, sz = 0, den = 0;
      for (const [j, d, w, rep] of per[i]) {
        const xj = X[j], dx = xi[0] - xj[0], dy = xi[1] - xj[1], dz = xi[2] - xj[2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        if (rep && dist >= d) continue;
        sx += w * (xj[0] + d * dx / dist); sy += w * (xj[1] + d * dy / dist); sz += w * (xj[2] + d * dz / dist);
        den += w;
      }
      if (den) {
        xi[0] += OMEGA * (sx / den - xi[0]); xi[1] += OMEGA * (sy / den - xi[1]); xi[2] += OMEGA * (sz / den - xi[2]);
      }
    }
    for (const c of flat) {
      const [p, q, r] = adj[c].map(j => X[j]);
      const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], v = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
      const nx = u[1] * v[2] - u[2] * v[1], ny = u[2] * v[0] - u[0] * v[2], nz = u[0] * v[1] - u[1] * v[0];
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (nl < 1e-6) continue;
      const xc = X[c], h = ((xc[0] - p[0]) * nx + (xc[1] - p[1]) * ny + (xc[2] - p[2]) * nz) / nl;
      // 가운데 원자는 3/4, 이웃들은 반대 방향으로 1/4씩 나눠 움직여 무게중심을 지킨다
      xc[0] -= 0.75 * h * nx / nl; xc[1] -= 0.75 * h * ny / nl; xc[2] -= 0.75 * h * nz / nl;
      for (const j of adj[c]) { const xj = X[j]; xj[0] += 0.25 * h * nx / nl; xj[1] += 0.25 * h * ny / nl; xj[2] += 0.25 * h * nz / nl; }
    }
  }
  let cx = 0, cy = 0, cz = 0;
  X.forEach(p => { cx += p[0]; cy += p[1]; cz += p[2]; });
  return X.map(p => [p[0] - cx / n, p[1] - cy / n, p[2] - cz / n]);
}

const api = {
  ChemError, ELEMENTS, normFormula, parseFormula, hillOrder, hillKey, composition, unsaturation,
  parseSmiles, molCounts, expandH, layout, adjacency, findRings, embed3D, DICT, lookupName, lookupFormula,
};
if (typeof module !== "undefined" && module.exports) module.exports = api;
else root.Chem = api;
})(typeof window !== "undefined" ? window : globalThis);
