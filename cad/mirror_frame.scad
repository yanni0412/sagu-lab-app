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
ledge_rise = 0.10;  // 레지 윗면이 프레임 윗면보다 돌출된 양 (가정값)
slope_len  = 0.35;  // 경사면 Y길이 (레지 → 포켓 바닥)

/* [V-groove (파이버 정렬 홈) — 가정값] */
v_pitch  = 0.127;  // 127µm 피치
v_angle  = 90;     // V 내각 (°)
v_flat   = 0.010;  // 홈 사이 상단 평탄부
v_margin = 0.20;   // 포켓 가장자리 여백

/* [Reflective lens — 가정값] */
fiber_d = 0.125;   // 파이버 지름
lens_a  = 0.110;   // 렌즈 구경 (피치 127µm보다 작게)
lens_r  = 0.25;    // 오목 구면 곡률반경

$fn = 48;
eps = 0.001;

// ---------- 파생 좌표 ----------
z_floor  = T - pocket_d;          // 포켓 바닥 높이
z_ledge  = T + ledge_rise;        // 레지 윗면 높이 (프레임 위로 돌출)
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
            polygon([[y_m, z_b], [y_l0 + eps, z_b], [y_l0 + eps, z_ledge]]);
}

v_open  = v_pitch - v_flat;
v_depth = (v_open/2) / tan(v_angle/2);
v_n     = floor((win_w - 2*v_margin - v_flat) / v_pitch);
v_x0    = -(v_n*v_pitch - v_flat)/2;
v_y0    = -win_h/2 + v_margin;
v_y1    = y_s0 - v_margin;

// 45° 반사면: 홈 바닥 높이(z_b)부터 시작하도록 경사 시작점을 앞으로 당김
z_b     = z_floor - v_depth;
m_ang   = atan2(z_ledge - z_floor, slope_len);
y_m     = y_s0 - (z_floor - z_b) / tan(m_ang);
z_axis  = z_b + (fiber_d/2) / sin(v_angle/2);            // 파이버 광축 높이
p_y     = y_m + (z_axis - z_b) / tan(m_ang);              // 광축이 반사면에 닿는 Y
m_n     = [0, -sin(m_ang), cos(m_ang)];                   // 반사면 바깥 법선
lens_sag = lens_r - sqrt(lens_r*lens_r - (lens_a/2)*(lens_a/2));

module trench() {     // 파이버 끝 ~ 반사면 사이 광로
    translate([v_x0, v_y1 - eps, z_b]) cube([v_n*v_pitch - v_flat, y_m - v_y1 + 2*eps, z_floor - z_b + eps]);
}
m_L = (z_ledge - z_b) / sin(m_ang);                       // 반사면 길이
module lenses() {     // lane마다 반사면 바닥 → 레지 윗모서리까지 이어지는 오목 원통 채널, 쐐기 안쪽만
    intersection() {
        for (i = [0 : v_n - 1])
            translate([v_x0 + i*v_pitch + v_open/2, y_m, z_b] + m_n*(lens_r - lens_sag))
                rotate([-(90 - m_ang), 0, 0])      // +Z 축을 반사면 경사 방향으로
                    translate([0, 0, -0.05]) cylinder(r = lens_r, h = m_L + 0.1, $fn = 96);
        rotate([90, 0, 90]) linear_extrude(height = win_w, center = true)
            polygon([[y_m, z_b], [y_l0, z_b], [y_l0, z_ledge]]);
    }
}

module vgrooves() {   // XZ 단면 삼각형을 -Y 방향으로 돌출 → 바닥에서 잘라냄
    for (i = [0 : v_n - 1]) let(x = v_x0 + i*v_pitch)
        translate([0, v_y1, 0]) rotate([90, 0, 0])
            linear_extrude(height = v_y1 - v_y0)
                polygon([[x, z_floor + eps], [x + v_open/2, z_floor - v_depth], [x + v_open, z_floor + eps]]);
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
        if (feature == "dot" && dot_mode == "bump") dot_bumps();
    }
    vgrooves();
    trench();
    lenses();
    if (feature == "dot" && dot_mode == "dimple") dot_dimples();
    if (feature == "notch") notches();
}

// ---------- 설계 체크 (콘솔 출력) ----------
echo(str("V-groove ", v_n, "개, 깊이 ", v_depth));
echo(str("Reflective lens sag ", lens_sag, ", 광축 z ", z_axis));
assert(lens_a < v_pitch, "렌즈 구경이 피치보다 큽니다");
echo(str("DOT 종횡비(h/d) = ", dot_h / dot_d));
assert(frame_dot_inset + dot_d/2 < (W - win_w)/2, "프레임 DOT이 포켓과 겹칩니다");
assert(ledge_dot_inset > dot_d/2, "레지 DOT이 레지 끝을 벗어납니다");
assert(dot_mode != "dimple" || dot_h < ledge_rise + pocket_d , "DOT 깊이가 과도합니다");
assert(notch_z < ledge_rise + pocket_d, "Notch Z깊이가 과도합니다");
assert(notch_d < ledge_h, "Notch가 레지보다 깊습니다");
