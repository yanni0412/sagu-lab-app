// =====================================================================
//  V-groove 기판 + Reflective lens 레지 + DOT/Notch 식별 마크 — OpenSCAD
//  단위: mm   원점: 판 중심, z=0 바닥면, z=T 판 윗면
//  ※ 치수는 CAD 그림 비율로 잡은 가정값. generator/build.mjs(STEP 생성기)와 같은 파라미터.
// =====================================================================

/* [표시할 마크] */
feature  = "dot";    // [dot, notch, none]
dot_mode = "bump";   // [bump, dimple]

/* [DOT 사양] */
dot_d         = 0.15;
dot_h         = 0.04;
dot_at_frame  = true;  // ① 판 4모서리
dot_at_ledge  = true;  // ② 레지 윗면 양끝
frame_dot_inset = 0.5;
ledge_dot_inset = 0.3;

/* [Notch 사양] */
notch_n = 3; notch_w = 0.20; notch_d = 0.15; notch_z = 0.04;

/* [판] */
W = 10.0; H = 10.0; T = 0.50;
win_w        = 8.0;   // V-groove 영역 폭
front_margin = 0.6;   // 판 앞 가장자리 ~ 홈 시작

/* [레지 (Reflective lens 리지)] */
ridge_l     = 8.6;    // 바닥(판 윗면) 기준 길이, 양 끝 45° 경사
back_margin = 0.8;    // 판 뒤 가장자리 ~ 레지 뒷면
ledge_w     = 0.40;   // 레지 윗면 폭
ledge_rise  = 0.25;   // 판 윗면 위 높이
mirror_ang  = 45;     // 앞면 반사면 각도

/* [V-groove] */
v_pitch = 0.127; v_angle = 90; v_flat = 0.010; v_margin = 0.20;

/* [Reflective lens] */
fiber_d = 0.125; lens_a = 0.110; lens_r = 0.25;

$fn = 48;
eps = 0.001;

// ---------- 파생 ----------
z_top   = T;
z_ledge = T + ledge_rise;
y_back  = H/2 - back_margin;
y_l0    = y_back - ledge_w;
y_s0    = y_l0 - ledge_rise / tan(mirror_ang);
x_t     = ridge_l/2 - ledge_rise;

v_open  = v_pitch - v_flat;
v_depth = (v_open/2) / tan(v_angle/2);
v_n     = floor((win_w - 2*v_margin - v_flat) / v_pitch);
v_x0    = -(v_n*v_pitch - v_flat)/2;
v_xe    = v_x0 + v_n*v_pitch - v_flat;
v_y0    = -H/2 + front_margin;
v_y1    = y_s0 - v_margin;

z_b     = z_top - v_depth;
y_m     = y_s0 - (z_top - z_b) / tan(mirror_ang);
m_L     = (z_ledge - z_b) / sin(mirror_ang);
m_n     = [0, -sin(mirror_ang), cos(mirror_ang)];
lens_sag = lens_r - sqrt(lens_r*lens_r - (lens_a/2)*(lens_a/2));

// YZ 단면 → X 방향 돌출 / XZ 단면 → Y 방향 돌출 도우미
module yz(len) { rotate([90, 0, 90]) linear_extrude(height = len, center = true) children(); }
module xz(y_from, len) { translate([0, y_from, 0]) rotate([90, 0, 0]) linear_extrude(height = len) children(); }

module ridge() {
    intersection() {
        yz(ridge_l + 2) polygon([[y_m, z_b], [y_back, z_b], [y_back, z_ledge], [y_l0, z_ledge]]);
        xz(y_back + 1, y_back - y_m + 2)
            polygon([[-ridge_l/2 - (z_top - z_b), z_b], [ridge_l/2 + (z_top - z_b), z_b], [x_t, z_ledge], [-x_t, z_ledge]]);
    }
}
module vgrooves() {
    for (i = [0 : v_n - 1]) let(x = v_x0 + i*v_pitch)
        xz(v_y1, v_y1 - v_y0) polygon([[x, z_top + eps], [x + v_open/2, z_b], [x + v_open, z_top + eps]]);
}
module trench() {
    translate([v_x0, v_y1 - eps, z_b]) cube([v_xe - v_x0, y_m - v_y1 + 2*eps, z_top - z_b + eps]);
}
module lenses() {   // lane마다 반사면 바닥 → 레지 윗모서리까지 오목 원통 채널, 반사면 쐐기 안쪽만
    intersection() {
        for (i = [0 : v_n - 1])
            translate([v_x0 + i*v_pitch + v_open/2, y_m, z_b] + m_n*(lens_r - lens_sag))
                rotate([-(90 - mirror_ang), 0, 0])
                    translate([0, 0, -0.05]) cylinder(r = lens_r, h = m_L + 0.1, $fn = 96);
        translate([v_x0 + (v_xe - v_x0)/2, 0, 0])
            yz(v_xe - v_x0) polygon([[y_m, z_b], [y_l0, z_b], [y_l0, z_ledge]]);
    }
}

function frame_dots() = [ for (sx = [-1, 1], sy = [-1, 1]) [sx*(W/2 - frame_dot_inset), sy*(H/2 - frame_dot_inset), z_top] ];
function ledge_dots() = [ for (sx = [-1, 1]) [sx*(x_t - ledge_dot_inset), (y_l0 + y_back)/2, z_ledge] ];
function all_dots()   = concat(dot_at_frame ? frame_dots() : [], dot_at_ledge ? ledge_dots() : []);

module dot_bumps()   { for (p = all_dots()) translate([p[0], p[1], p[2] - eps]) cylinder(d = dot_d, h = dot_h + eps); }
module dot_dimples() { for (p = all_dots()) translate([p[0], p[1], p[2] - dot_h]) cylinder(d = dot_d, h = dot_h + eps); }
module notches() {
    for (i = [1 : notch_n])
        translate([-x_t + 2*x_t*i/(notch_n + 1) - notch_w/2, y_back - notch_d, z_ledge - notch_z])
            cube([notch_w, notch_d + eps, notch_z + eps]);
}

// ---------- 조립 ----------
difference() {
    union() {
        translate([-W/2, -H/2, 0]) cube([W, H, T]);
        ridge();
        if (feature == "dot" && dot_mode == "bump") dot_bumps();
    }
    vgrooves();
    trench();
    lenses();
    if (feature == "dot" && dot_mode == "dimple") dot_dimples();
    if (feature == "notch") notches();
}

echo(str("V-groove ", v_n, "개, 깊이 ", v_depth, " / lens sag ", lens_sag));
assert(lens_a < v_pitch, "렌즈 폭이 피치보다 큽니다");
assert(notch_z < ledge_rise, "Notch Z깊이가 레지 높이보다 큽니다");
assert(ledge_dot_inset > dot_d/2, "레지 DOT이 레지 끝을 벗어납니다");
