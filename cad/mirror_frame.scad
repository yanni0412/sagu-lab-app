// =====================================================================
//  Mirror 프레임 + DOT(凸/凹) / Notch 식별 마크  — OpenSCAD 파라메트릭 모델
//  단위: mm   원점: 판 중심, z=0 바닥면, z=T 윗면
//  ※ 전체 외곽·개구부·레지 치수는 그림 비율로 추정한 "가정값"입니다.
//     실제 도면 치수를 받으면 아래 파라미터만 바꾸면 됩니다.
// =====================================================================

/* [표시할 마크] */
feature  = "dot";    // [dot, notch, none]  dot=DOT형상, notch=Notch형상(대안)
dot_mode = "bump";   // [bump, dimple]      bump=凸(돌출), dimple=凹(오목)

/* [DOT 사양] */
dot_d         = 0.15;  // Φ0.15 (요청 사양)
dot_h         = 0.04;  // 높이/깊이 — 기존 제안 0.04, 더 작게 하려면 여기만 수정
dot_at_frame  = true;  // ① 기존 제안 위치(외곽 프레임 4모서리, 빨간 점)
dot_at_ledge  = true;  // ② 신규 요청 위치(상단 레지 양끝, 파란 점)
frame_dot_inset = 0.5; // 프레임 모서리에서 DOT 중심까지 거리
ledge_dot_inset = 0.3; // 레지 좌/우 끝에서 DOT 중심까지 거리

/* [Notch 사양 (DOT 불가 시 대안)] */
notch_n = 3;      // 개수 (그림: 3개)
notch_w = 0.20;   // X방향 폭
notch_d = 0.15;   // Y방향 깊이 (레지 윗변에서 안쪽으로)
notch_z = 0.04;   // Z방향 깊이

/* [외곽 프레임 — 가정값] */
W = 10.0;   // 가로
H = 10.0;   // 세로
T = 0.50;   // 두께

/* [개구부(포켓) — 가정값] */
win_w    = 8.0;   // 포켓 가로 (프레임 여백 1.0mm)
win_h    = 8.0;   // 포켓 세로
pocket_d = 0.25;  // 포켓 깊이

/* [상단 경사 레지 — 가정값] */
ledge_h    = 0.90;  // 레지 평탄부 폭(Y)
ledge_drop = 0.05;  // 레지 윗면이 프레임 윗면보다 낮은 양
slope_len  = 0.35;  // 경사면 Y길이 (레지 → 포켓 바닥)

/* [그레이팅(세로 리브) — 가정값] */
rib_pitch  = 0.12;
rib_w      = 0.06;
rib_h      = 0.05;
rib_margin = 0.20;

$fn = 48;
eps = 0.001;

// ---------- 파생 좌표 ----------
z_floor  = T - pocket_d;          // 포켓 바닥 높이
z_ledge  = T - ledge_drop;        // 레지 윗면 높이
y_top    = win_h/2;               // 포켓 윗변
y_l0     = y_top - ledge_h;       // 레지 평탄부 아랫변
y_s0     = y_l0 - slope_len;      // 경사면 끝(포켓 바닥과 만나는 선)

// ---------- 기본 형상 ----------
module plate() {
    difference() {
        translate([-W/2, -H/2, 0]) cube([W, H, T]);
        translate([-win_w/2, -win_h/2, z_floor]) cube([win_w, win_h, pocket_d + eps]);
    }
}

module ledge() {
    // 평탄부
    translate([-win_w/2, y_l0, z_floor - eps])
        cube([win_w, ledge_h, z_ledge - z_floor + eps]);
    // 경사면: (Y,Z) 단면 삼각형을 X방향으로 돌출
    rotate([90, 0, 90])
        linear_extrude(height = win_w, center = true)
            polygon([[y_s0, z_floor - eps], [y_l0 + eps, z_floor - eps], [y_l0 + eps, z_ledge]]);
}

module grating() {
    x0 = -win_w/2 + rib_margin;
    span = win_w - 2*rib_margin;
    n = floor((span - rib_w) / rib_pitch) + 1;
    y0 = -win_h/2 + rib_margin;
    len = (y_s0 - rib_margin) - y0;
    for (i = [0 : n - 1])
        translate([x0 + i*rib_pitch, y0, z_floor - eps])
            cube([rib_w, len, rib_h + eps]);
}

// ---------- 마크 위치 ----------
function frame_dots() = [ for (sx = [-1, 1], sy = [-1, 1])
    [sx*(W/2 - frame_dot_inset), sy*(H/2 - frame_dot_inset), T] ];
function ledge_dots() = [ for (sx = [-1, 1])
    [sx*(win_w/2 - ledge_dot_inset), (y_l0 + y_top)/2, z_ledge] ];
function all_dots() = concat(dot_at_frame ? frame_dots() : [],
                             dot_at_ledge ? ledge_dots() : []);

module dot_bumps() {          // 凸
    for (p = all_dots()) translate([p[0], p[1], p[2] - eps]) cylinder(d = dot_d, h = dot_h + eps);
}
module dot_dimples() {        // 凹
    for (p = all_dots()) translate([p[0], p[1], p[2] - dot_h]) cylinder(d = dot_d, h = dot_h + eps);
}
module notches() {            // 레지 윗변에서 파고든 직사각 홈
    for (i = [1 : notch_n])
        translate([-win_w/2 + win_w*i/(notch_n + 1) - notch_w/2,
                   y_top - notch_d - eps,
                   z_ledge - notch_z])
            cube([notch_w, notch_d + 2*eps, notch_z + eps]);
}

// ---------- 조립 ----------
difference() {
    union() {
        plate();
        ledge();
        grating();
        if (feature == "dot" && dot_mode == "bump") dot_bumps();
    }
    if (feature == "dot" && dot_mode == "dimple") dot_dimples();
    if (feature == "notch") notches();
}

// ---------- 설계 체크 (콘솔 출력) ----------
echo(str("DOT 종횡비(h/d) = ", dot_h / dot_d));
assert(frame_dot_inset + dot_d/2 < (W - win_w)/2, "프레임 DOT이 포켓과 겹칩니다");
assert(ledge_dot_inset > dot_d/2, "레지 DOT이 레지 끝을 벗어납니다");
assert(dot_mode != "dimple" || dot_h < ledge_drop + (T - pocket_d) , "DOT 깊이가 과도합니다");
assert(notch_d < ledge_h, "Notch가 레지보다 깊습니다");
