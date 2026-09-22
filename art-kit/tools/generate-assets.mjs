/**
 * Paper Journal 美术素材生成器
 * ------------------------------------------------------------------
 * 三层视觉语言：
 *   papercut  —— 剪纸（结构层：层叠 silhouette + 投影）
 *   crayon    —— 蜡笔（情绪层：feTurbulence 位移 + 蜡质颗粒）
 *   handdrawn —— 手绘（批注层：抖动双描线）
 *   texture   —— 纸纹（氛围层：可平铺噪声 / 瓦楞 / 和纸胶带）
 *
 * 用法：node tools/generate-assets.mjs
 *  - 产出 assets/<group>/<name>.svg
 *  - 读取 tools/template.html，把 {{WALL:*}} 替换为素材墙、
 *    {{ASSET:*}} 替换为内联 SVG（自动重写 id 防冲突），生成 index.html
 * 所有随机都走 seeded RNG：同参数重跑结果完全一致。
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = join(ROOT, "assets");

/* ───────────────────────── 调色板（对齐 globals.css token） ───────────────────────── */
const C = {
  paperBg: "#d8b98f", paperDeep: "#c2a075", paperCard: "#f7f1e7", paperStrong: "#fff9ef",
  paperTint: "#f2e7d5",
  ink: "#3f3933", inkMuted: "#7f7469", inkFaint: "#a89a8c",
  sage: "#6e8b72", sageDeep: "#5d7a61", sageLight: "#8fa78f", sagePale: "#a9bfa4",
  sun: "#e9b64f", sunDeep: "#d9a23e", sunPale: "#f0c878",
  rose: "#d88e86", roseDeep: "#c47a71", rosePale: "#e4aca5",
  sky: "#79a9bc", skyDeep: "#6795a8", skyPale: "#9dc0cf",
  coffee: "#8a6a4a",
};

/* ───────────────────────── 随机与几何原语 ───────────────────────── */
function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const jit = (r, amp) => (r() * 2 - 1) * amp;
const f1 = (n) => Math.round(n * 10) / 10;

/** 折线细分 + 垂直抖动：手绘/蜡笔线的核心 */
function subdivide(points, r, amp, closed = false) {
  const src = closed ? [...points, points[0]] : points;
  const out = [];
  for (let i = 0; i < src.length - 1; i++) {
    const [x1, y1] = src[i], [x2, y2] = src[i + 1];
    const n = Math.max(2, Math.round(Math.hypot(x2 - x1, y2 - y1) / 15));
    for (let j = 0; j < n; j++) {
      const t = j / n;
      let x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t;
      if (i > 0 || j > 0 || closed) {
        const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
        const off = jit(r, amp);
        x += (-dy / len) * off; y += (dx / len) * off;
      }
      out.push([x, y]);
    }
  }
  out.push(closed ? src[src.length - 1] : points[points.length - 1]);
  return out;
}
function toPath(pts, closed = false) {
  return "M" + pts.map((p) => `${f1(p[0])} ${f1(p[1])}`).join("L") + (closed ? "Z" : "");
}
/** 二次贝塞尔采样 */
function quadPts(p0, p1, p2, n = 22) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
  }
  return out;
}
/** 椭圆弧采样 */
function ellipsePts(cx, cy, rx, ry, a0, a1, n = 40) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return out;
}
/** 五角星顶点（R 外半径 / r 内半径） */
function starPts(cx, cy, R, r, n = 5, rot = -Math.PI / 2) {
  const out = [];
  for (let i = 0; i < n * 2; i++) {
    const rad = i % 2 === 0 ? R : r;
    const a = rot + (i * Math.PI) / n;
    out.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
  }
  return out;
}
/** 经典心形参数曲线采样 */
function heartPts(cx, cy, s, n = 46) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    out.push([cx + x * s, cy - y * s]);
  }
  return out;
}
const P = (pts) => pts.map((p) => `${f1(p[0])} ${f1(p[1])}`).join(" ");

/* ───────────────────────── SVG 滤镜 ───────────────────────── */
/** 蜡笔滤镜：低频位移（蜡笔抖）+ 高频颗粒 mask（蜡质断续） */
function crayonFilter(seed, id = "fx") {
  return `<filter id="${id}" x="-15%" y="-15%" width="130%" height="130%" color-interpolation-filters="sRGB">
<feTurbulence type="fractalNoise" baseFrequency="0.028 0.05" numOctaves="3" seed="${seed}" result="wob"/>
<feDisplacementMap in="SourceGraphic" in2="wob" scale="5" xChannelSelector="R" yChannelSelector="G" result="d1"/>
<feTurbulence type="fractalNoise" baseFrequency="0.30" numOctaves="2" seed="${seed + 7}" result="grain"/>
<feColorMatrix in="grain" type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 3.2 -1.15" result="spek"/>
<feComposite in="d1" in2="spek" operator="in"/>
</filter>`;
}
/** 剪纸投影：纸层抬起感 */
function shadowFilter(dy, blur, op, id = "fx") {
  return `<filter id="${id}" x="-25%" y="-25%" width="150%" height="150%">
<feDropShadow dx="0" dy="${dy}" stdDeviation="${blur}" flood-color="#4c3a27" flood-opacity="${op}"/>
</filter>`;
}

/* ───────────────────────── 描线风格 ───────────────────────── */
/** 蜡笔描线：主笔 + 侧锋回笔（同路径不同种子），都过蜡笔滤镜 */
function crayonStroke(points, color, width, seed, closed = false) {
  const p1 = subdivide(points, rng(seed), 2.4, closed);
  const p2 = subdivide(points, rng(seed * 31 + 5), 3.2, closed);
  return (
    `<path d="${toPath(p1, closed)}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" opacity="0.92" filter="url(#fx)"/>` +
    `<path d="${toPath(p2, closed)}" fill="none" stroke="${color}" stroke-width="${f1(width * 0.55)}" stroke-linecap="round" stroke-linejoin="round" opacity="0.45" filter="url(#fx)"/>`
  );
}
/** 手绘描线：主笔 + 淡回声（不过滤镜，纯抖动） */
function handStroke(points, color, width, seed, closed = false, echo = true) {
  const p1 = subdivide(points, rng(seed), 1.3, closed);
  let s = `<path d="${toPath(p1, closed)}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>`;
  if (echo) {
    const p2 = subdivide(points, rng(seed * 17 + 3), 1.9, closed);
    s += `<path d="${toPath(p2, closed)}" fill="none" stroke="${color}" stroke-width="${f1(width * 0.6)}" stroke-linecap="round" stroke-linejoin="round" opacity="0.32"/>`;
  }
  return s;
}

function svgFile(viewBox, defs, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="none" role="img">
<defs>${defs}</defs>
${body}
</svg>
`;
}

/* ═════════════════════════ papercut 剪纸 ═════════════════════════ */

function pcHills() {
  const layer = (yBase, amp, seed, color) => {
    const r = rng(seed);
    let d = `M0 ${f1(yBase + jit(r, 6))}`;
    let x = 0;
    while (x < 600) {
      const nx = Math.min(600, x + 90 + r() * 130);
      const peak = yBase - amp * (0.6 + r() * 0.7);
      d += ` Q ${f1((x + nx) / 2)} ${f1(peak)} ${f1(nx)} ${f1(yBase + jit(r, 8))}`;
      x = nx;
    }
    return `<path d="${d} L600 170 L0 170 Z" fill="${color}"/>`;
  };
  const body =
    `<g filter="url(#sh1)">${layer(112, 26, 11, C.sagePale)}</g>` +
    `<g filter="url(#sh2)">${layer(130, 30, 23, C.sage)}</g>` +
    `<g filter="url(#sh3)">${layer(150, 22, 37, C.sageDeep)}</g>`;
  return svgFile("0 0 600 170",
    shadowFilter(2, 2, 0.18, "sh1") + shadowFilter(2, 2, 0.18, "sh2") + shadowFilter(1.5, 1.5, 0.2, "sh3"),
    body);
}

function pcSun() {
  const rays = [];
  const N = 12;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const a1 = a - 0.1, a2 = a + 0.1, r0 = 66, r1 = 92;
    rays.push(`<path d="M${f1(100 + Math.cos(a1) * r0)} ${f1(100 + Math.sin(a1) * r0)} L${f1(100 + Math.cos(a) * r1)} ${f1(100 + Math.sin(a) * r1)} L${f1(100 + Math.cos(a2) * r0)} ${f1(100 + Math.sin(a2) * r0)} Z" fill="${C.sunDeep}"/>`);
  }
  const ring = [];
  const M = 20;
  for (let i = 0; i < M; i++) {
    const a = (i / M) * Math.PI * 2;
    ring.push(`<circle cx="${f1(100 + Math.cos(a) * 60)}" cy="${f1(100 + Math.sin(a) * 60)}" r="7"/>`);
  }
  const body =
    `<g filter="url(#fx)">${rays.join("")}</g>` +
    `<g filter="url(#fx)"><g fill="${C.sunPale}">${ring.join("")}</g></g>` +
    `<g filter="url(#fx)"><circle cx="100" cy="100" r="52" fill="${C.sun}"/><circle cx="100" cy="100" r="52" fill="none" stroke="${C.sunDeep}" stroke-width="2" opacity="0.5"/></g>`;
  return svgFile("0 0 200 200", shadowFilter(2, 2, 0.2), body);
}

function cloudGroup(cx, cy, s, color, shadowId) {
  const circles = [[0, 0, 22], [24, -8, 18], [46, 2, 20], [66, -4, 15], [-18, 6, 16]]
    .map(([dx, dy, rr]) => `<circle cx="${f1(cx + dx * s)}" cy="${f1(cy + dy * s)}" r="${f1(rr * s)}"/>`).join("");
  const rect = `<rect x="${f1(cx - 30 * s)}" y="${f1(cy + 2 * s)}" width="${f1(118 * s)}" height="${f1(16 * s)}"/>`;
  const scallops = [];
  for (let i = 0; i < 6; i++) scallops.push(`<circle cx="${f1(cx - 22 * s + i * 22 * s)}" cy="${f1(cy + 18 * s)}" r="${f1(9 * s)}"/>`);
  return `<g fill="${color}" filter="url(#${shadowId})">${circles}${rect}${scallops.join("")}</g>`;
}
function pcCloud() {
  const body = cloudGroup(64, 62, 0.9, C.paperTint, "sh2") + cloudGroup(160, 84, 1.15, C.paperStrong, "sh1");
  return svgFile("0 0 260 150",
    shadowFilter(3, 3, 0.18, "sh1") + shadowFilter(2, 2, 0.14, "sh2"), body);
}

function pcBird() {
  const body =
    `<g filter="url(#sh1)">` +
    `<path d="M66 84 L30 54 L58 92 Z" fill="${C.ink}"/>` + // 尾
    `<path d="M60 78 C50 52 72 34 98 38 C122 42 130 62 122 80 C114 96 88 102 72 94 C64 90 62 86 60 78 Z" fill="${C.ink}"/>` +
    `<path d="M120 50 L140 57 L119 64 Z" fill="${C.sunDeep}"/>` + // 喙
    `</g>` +
    `<g filter="url(#sh1)"><path d="M76 62 C88 44 110 44 118 54 C108 70 90 74 76 62 Z" fill="${C.paperStrong}"/></g>` + // 翅膀（纸层）
    `<circle cx="108" cy="50" r="2.6" fill="${C.paperCard}"/>` +
    `<path d="M88 98 L86 112 M100 96 L102 112" stroke="${C.ink}" stroke-width="3" stroke-linecap="round"/>`;
  return svgFile("0 0 160 120", shadowFilter(2, 2, 0.2, "sh1"), body);
}

function pcButterfly() {
  const upper = `<path d="M84 78 C60 30 20 22 14 48 C8 72 44 84 84 82 Z" fill="${C.sky}"/>`;
  const lower = `<path d="M84 84 C50 88 26 104 34 122 C42 138 70 122 84 90 Z" fill="${C.skyPale}"/>`;
  const wing = `<g filter="url(#fx)">${upper}${lower}<circle cx="40" cy="52" r="7" fill="${C.paperStrong}"/><circle cx="52" cy="112" r="5" fill="${C.paperStrong}"/></g>`;
  const body = `<g filter="url(#sh2)"><ellipse cx="90" cy="84" rx="7" ry="26" fill="${C.ink}"/><circle cx="90" cy="52" r="8" fill="${C.ink}"/></g>`;
  const ant = `<path d="M86 46 C82 34 74 28 66 26 M94 46 C98 34 106 28 114 26" stroke="${C.ink}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;
  return svgFile("0 0 180 160",
    shadowFilter(2, 2, 0.18) + shadowFilter(2, 2, 0.2, "sh2"),
    `<g transform="translate(180,0) scale(-1,1)">${wing}</g>${wing}${body}${ant}`);
}

function pcFlower() {
  const petal = (aDeg, d, len, w, color) => {
    const a = (aDeg * Math.PI) / 180;
    const cx = f1(80 + Math.cos(a) * d), cy = f1(84 + Math.sin(a) * d);
    return `<ellipse cx="${cx}" cy="${cy}" rx="${w}" ry="${f1(len)}" transform="rotate(${aDeg + 90} ${cx} ${cy})" fill="${color}"/>`;
  };
  let petals = "";
  for (const a of [45, 135, 225, 315]) petals += petal(a, 26, 40, 15, C.rosePale);
  let front = "";
  for (const a of [0, 90, 180, 270]) front += petal(a, 24, 34, 14, C.rose);
  const body =
    `<g filter="url(#sh1)">${petals}</g>` +
    `<g filter="url(#sh2)">${front}</g>` +
    `<g filter="url(#sh3)"><circle cx="80" cy="84" r="15" fill="${C.sun}"/><circle cx="80" cy="84" r="15" fill="none" stroke="${C.sunDeep}" stroke-width="2.5" opacity="0.6"/></g>` +
    `<path d="M80 100 C80 120 78 138 80 154" stroke="${C.sageDeep}" stroke-width="4" fill="none" stroke-linecap="round"/>` +
    `<g filter="url(#sh1)"><ellipse cx="58" cy="132" rx="16" ry="7" transform="rotate(-28 58 132)" fill="${C.sage}"/><ellipse cx="102" cy="146" rx="16" ry="7" transform="rotate(24 102 146)" fill="${C.sageLight}"/></g>`;
  return svgFile("0 0 160 170",
    shadowFilter(1.5, 1.5, 0.16, "sh1") + shadowFilter(1.5, 1.5, 0.18, "sh2") + shadowFilter(1.5, 1.5, 0.2, "sh3"),
    body);
}

function pcHouse() {
  const body =
    `<g filter="url(#sh2)"><path d="M16 82 L85 18 L154 82 Z" fill="${C.roseDeep}"/></g>` + // 屋顶
    `<g filter="url(#sh1)"><rect x="30" y="80" width="110" height="84" fill="${C.paperStrong}"/></g>` + // 墙
    `<g filter="url(#sh2)"><rect x="118" y="34" width="14" height="26" fill="${C.paperTint}"/></g>` + // 烟囱
    `<g filter="url(#sh3)"><rect x="70" y="112" width="28" height="52" rx="2" fill="${C.sage}"/></g>` + // 门
    `<g filter="url(#sh3)"><rect x="42" y="96" width="20" height="20" fill="${C.sun}"/><rect x="106" y="96" width="20" height="20" fill="${C.sun}"/></g>` + // 窗
    `<path d="M52 96 V116 M42 106 H62 M116 96 V116 M106 106 H126" stroke="${C.ink}" stroke-width="2" opacity="0.65"/>` +
    `<circle cx="92" cy="140" r="2.6" fill="${C.paperStrong}"/>`;
  return svgFile("0 0 170 175",
    shadowFilter(2, 2, 0.16, "sh1") + shadowFilter(2, 2, 0.2, "sh2") + shadowFilter(1.5, 1.5, 0.18, "sh3"),
    body);
}

function pcPlant() {
  const leaves = [
    [58, 182, 13, C.sage], [92, 162, 11, C.sageLight], [56, 134, 12, C.sageDeep],
    [90, 110, 10, C.sage], [54, 86, 12, C.sageLight], [88, 66, 9, C.sage],
    [60, 46, 11, C.sageDeep], [86, 30, 8, C.sageLight], [70, 16, 7, C.sage],
  ];
  const body =
    `<path d="M75 212 C68 170 84 140 72 100 C66 74 76 46 80 14" stroke="${C.sageDeep}" stroke-width="4" fill="none" stroke-linecap="round"/>` +
    leaves.map(([x, y, r, c]) => `<g filter="url(#sh1)"><circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/></g>`).join("");
  return svgFile("0 0 150 225", shadowFilter(1.5, 1.5, 0.18, "sh1"), body);
}

function pcBorderScallop() {
  const scallops = [];
  for (let x = 8; x <= 592; x += 22) scallops.push(`<circle cx="${x}" cy="12" r="11"/>`);
  const body =
    `<g fill="${C.sun}" opacity="0.92" filter="url(#fx)">${scallops.join("")}<rect x="0" y="10" width="600" height="26" rx="2"/></g>` +
    `<g fill="${C.rosePale}" opacity="0.9" filter="url(#fx)">${scallops.slice(3, 12).map((s) => s.replace('cy="12"', 'cy="46"').replace('r="11"', 'r="8"')).join("")}<rect x="66" y="44" width="198" height="12" rx="2"/></g>`;
  return svgFile("0 0 600 58", shadowFilter(2, 2, 0.18), body);
}

function pcStampFrame() {
  const holes = [];
  for (let x = 10; x <= 250; x += 20) {
    holes.push(`<circle cx="${x}" cy="10" r="5.5"/><circle cx="${x}" cy="190" r="5.5"/>`);
  }
  for (let y = 30; y <= 170; y += 20) {
    holes.push(`<circle cx="10" cy="${y}" r="5.5"/><circle cx="250" cy="${y}" r="5.5"/>`);
  }
  const defs =
    shadowFilter(3, 3, 0.22) +
    `<mask id="pm"><rect x="0" y="0" width="260" height="200" fill="white"/><g fill="black">${holes.join("")}</g></mask>`;
  const body =
    `<rect x="10" y="10" width="240" height="180" rx="3" fill="${C.paperStrong}" mask="url(#pm)" filter="url(#fx)"/>` +
    `<rect x="26" y="26" width="208" height="148" fill="none" stroke="${C.inkFaint}" stroke-width="2" stroke-dasharray="7 6"/>`;
  return svgFile("0 0 260 200", defs, body);
}

/* ═════════════════════════ crayon 蜡笔 ═════════════════════════ */

function crDivider() {
  const wave = [];
  for (let x = 16; x <= 464; x += 8) wave.push([x, 20 + Math.sin(x / 42) * 7]);
  const wave2 = [];
  for (let x = 44; x <= 300; x += 8) wave2.push([x, 32 + Math.sin(x / 36) * 5]);
  return svgFile("0 0 480 46", crayonFilter(4),
    crayonStroke(wave, C.sage, 5, 9) + crayonStroke(wave2, C.rose, 4, 21));
}

function crUnderline() {
  const main = [[12, 22], [120, 19], [240, 24], [348, 17]];
  const second = [[46, 26], [150, 24], [238, 28]];
  return svgFile("0 0 360 38", crayonFilter(6),
    crayonStroke(main, C.sun, 7, 13) + crayonStroke(second, C.sun, 4.5, 29));
}

function crCircleMark() {
  const loop = ellipsePts(130, 58, 104, 40, -0.5, Math.PI * 2 + 0.7, 46);
  return svgFile("0 0 260 116", crayonFilter(8), crayonStroke(loop, C.rose, 5, 17));
}

function crHighlight(color, seed) {
  const block = [[18, 16], [110, 12], [210, 18], [302, 14], [304, 42], [200, 46], [96, 42], [16, 44]];
  const p = subdivide(block, rng(seed), 2.6, true);
  return svgFile("0 0 320 60", crayonFilter(seed),
    `<path d="${toPath(p, true)}" fill="${color}" opacity="0.55" filter="url(#fx)"/>`);
}

function crStar() {
  const pts = starPts(65, 67, 50, 21);
  const overshoot = [pts[0][0] + 5, pts[0][1] - 4];
  return svgFile("0 0 130 132", crayonFilter(11),
    crayonStroke([...pts, overshoot], C.sun, 6, 23));
}

function crSunFace() {
  const circle = ellipsePts(95, 95, 45, 45, -0.4, Math.PI * 2 + 0.5, 42);
  const rays = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.35;
    rays.push([[95 + Math.cos(a) * 57, 95 + Math.sin(a) * 57], [95 + Math.cos(a) * 78, 95 + Math.sin(a) * 78]]);
  }
  const smile = ellipsePts(95, 98, 17, 11, Math.PI * 0.18, Math.PI * 0.82, 14);
  const body =
    crayonStroke(circle, C.sun, 6, 31) +
    rays.map((seg, i) => crayonStroke(seg, C.sunDeep, 5, 37 + i)).join("") +
    `<circle cx="81" cy="86" r="3.6" fill="${C.ink}" filter="url(#fx)"/>` +
    `<circle cx="109" cy="86" r="3.6" fill="${C.ink}" filter="url(#fx)"/>` +
    crayonStroke(smile, C.ink, 4, 43) +
    `<circle cx="72" cy="100" r="5" fill="${C.rose}" opacity="0.45" filter="url(#fx)"/>` +
    `<circle cx="118" cy="100" r="5" fill="${C.rose}" opacity="0.45" filter="url(#fx)"/>`;
  return svgFile("0 0 190 190", crayonFilter(31), body);
}

function crHeart() {
  const pts = heartPts(75, 66, 4.1);
  const overshoot = [pts[0][0] + 4, pts[0][1] + 5];
  return svgFile("0 0 150 138", crayonFilter(14), crayonStroke([...pts, overshoot], C.rose, 6, 19));
}

/* ═════════════════════════ handdrawn 手绘 ═════════════════════════ */

function hdStarDoodle() {
  const pts = starPts(55, 57, 44, 18);
  const overshoot = [pts[0][0] + 7, pts[0][1] - 5];
  return svgFile("0 0 110 112", "", handStroke([...pts, overshoot], C.ink, 3, 27));
}

function hdArrow() {
  const curve = quadPts([16, 68], [96, 8], [228, 42], 24);
  const head1 = [[226, 42], [200, 26]];
  const head2 = [[226, 42], [204, 56]];
  return svgFile("0 0 250 88", "",
    handStroke(curve, C.ink, 3.5, 33) + handStroke(head1, C.ink, 3.5, 41) + handStroke(head2, C.ink, 3.5, 47));
}

function hdCoffeeStain() {
  const ring = ellipsePts(75, 75, 53, 49, -0.35, Math.PI * 1.86, 44);
  const ring2 = ellipsePts(75, 75, 49, 45, 0.4, Math.PI * 0.55, 14);
  return svgFile("0 0 150 150", "",
    handStroke(ring, C.coffee, 8, 51, false, false).replace('opacity="0.9"', 'opacity="0.32"') +
    handStroke(ring2, C.coffee, 5, 57, false, false).replace('opacity="0.9"', 'opacity="0.22"') +
    `<circle cx="112" cy="118" r="6" fill="${C.coffee}" opacity="0.22"/>` +
    `<circle cx="38" cy="34" r="3.5" fill="${C.coffee}" opacity="0.18"/>`);
}

function hdSparkle() {
  const v = quadPts([50, 8], [44, 50], [50, 92], 16);
  const h = quadPts([8, 50], [50, 44], [92, 50], 16);
  const d1 = [[20, 20], [28, 28]];
  const d2 = [[80, 80], [72, 72]];
  return svgFile("0 0 100 100", "",
    handStroke(v, C.ink, 3, 61) + handStroke(h, C.ink, 3, 67) +
    handStroke(d1, C.ink, 2.4, 73, false, false) + handStroke(d2, C.ink, 2.4, 79, false, false) +
    `<circle cx="14" cy="52" r="2.4" fill="${C.ink}" opacity="0.7"/><circle cx="88" cy="46" r="2.4" fill="${C.ink}" opacity="0.7"/>`);
}

function hdCat() {
  const bodyArc = ellipsePts(94, 82, 46, 36, Math.PI * 0.28, Math.PI * 1.98, 38);
  const head = ellipsePts(46, 88, 22, 20, -0.3, Math.PI * 2 + 0.2, 30);
  const ear1 = [[33, 72], [37, 54], [48, 68]];
  const ear2 = [[52, 66], [58, 50], [67, 64]];
  const eye = quadPts([38, 90], [43, 95], [50, 90], 10);
  const tail = quadPts([136, 90], [166, 66], [146, 32], 18);
  const nose = [[42, 98], [48, 98], [45, 103], [42, 98]];
  return svgFile("0 0 180 135", "",
    handStroke(bodyArc, C.ink, 3, 71) + handStroke(head, C.ink, 3, 77) +
    handStroke(ear1, C.ink, 3, 83, true) + handStroke(ear2, C.ink, 3, 89, true) +
    handStroke(eye, C.ink, 2.6, 95, false, false) +
    handStroke(tail, C.ink, 3, 101) +
    handStroke(nose, C.ink, 2.4, 107, true, false) +
    `<path d="M164 14 l3 -8 M172 20 l8 -4 M160 8 l-2 -7" stroke="${C.ink}" stroke-width="2" stroke-linecap="round" opacity="0.55"/>`);
}

function hdFrameSketch() {
  const rect = [[26, 26], [354, 22], [356, 214], [24, 218]];
  const tick = (x, y, dx, dy) => handStroke([[x, y], [x + dx, y + dy]], C.ink, 2.4, 113, false, false);
  return svgFile("0 0 380 240", "",
    handStroke(rect, C.ink, 3, 91, true) +
    tick(14, 14, 8, 8) + tick(366, 12, -8, 8) + tick(368, 226, -8, -8) + tick(12, 230, 8, -8));
}

function hdPaperPlane() {
  const outline = [[172, 48], [112, 26], [130, 56], [110, 76], [172, 48]];
  const fold = [[112, 26], [130, 56]];
  const trail = quadPts([16, 92], [70, 98], [108, 66], 20);
  return svgFile("0 0 200 115", "",
    handStroke(outline, C.ink, 3, 121, true) + handStroke(fold, C.ink, 2.2, 127, false, false) +
    `<path d="${toPath(subdivide(trail, rng(131), 1.6))}" fill="none" stroke="${C.inkMuted}" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 11" opacity="0.8"/>` +
    handStroke(starPts(30, 62, 9, 4), C.sun, 2.4, 137, true, false));
}

function hdCheckbox() {
  const box = [[18, 18], [80, 15], [82, 70], [16, 73]];
  const check = [[28, 46], [46, 62], [58, 48], [88, 18]];
  return svgFile("0 0 150 92", "",
    handStroke(box, C.ink, 3, 141, true) + handStroke(check, C.sageDeep, 3.5, 149));
}

/* ═════════════════════════ texture 纹理 ═════════════════════════ */

function txPaperGrain() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img">
<defs>
<filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>
<filter id="fiber"><feTurbulence type="fractalNoise" baseFrequency="0.012 0.06" numOctaves="3" seed="8" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>
</defs>
<rect width="256" height="256" filter="url(#grain)" opacity="0.35"/>
<rect width="256" height="256" filter="url(#fiber)" opacity="0.18"/>
</svg>
`;
}

function txCorrugated() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img">
<defs><pattern id="c" width="12" height="12" patternUnits="userSpaceOnUse">
<rect width="12" height="12" fill="#b8905f"/>
<rect x="0" width="3" height="12" fill="#a67d4d" opacity="0.5"/>
<rect x="4" width="4" height="12" fill="#c9a06c" opacity="0.55"/>
</pattern></defs>
<rect width="64" height="64" fill="url(#c)"/>
</svg>
`;
}

function washiFile(patternBody, seed) {
  // 胶带条：撕裂边缘 + 半透明纸纹 + 阴影
  const edge = subdivide(
    [[16, 6], [110, 4], [184, 7], [184, 30], [186, 52], [184, 66], [110, 69], [16, 66], [14, 44], [16, 24]],
    rng(seed), 2.8, true
  );
  return svgFile("0 0 200 76",
    crayonFilter(seed, "fx") + `<pattern id="wp" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(-8)">${patternBody}</pattern>`,
    `<path d="${toPath(edge, true)}" fill="url(#wp)" filter="url(#fx)"/>`);
}
function txWashiStripe() {
  return washiFile(
    `<rect width="18" height="18" fill="#f2e2b8" opacity="0.92"/><rect width="9" height="18" fill="#e9b64f" opacity="0.5"/>`,
    3
  );
}
function txWashiGrid() {
  return washiFile(
    `<rect width="18" height="18" fill="#eee6d2" opacity="0.92"/><rect width="18" height="3" fill="#79a9bc" opacity="0.42"/><rect width="3" height="18" fill="#d88e86" opacity="0.42"/>`,
    9
  );
}

/* ───────────────────────── 素材清单 ───────────────────────── */
const MANIFEST = [
  { group: "papercut", file: "hills", label: "层叠山峦", note: "页面/侧栏底部 · 结构层", fn: pcHills, wide: true },
  { group: "papercut", file: "sun", label: "剪纸太阳", note: "复盘页/空状态 · 光源锚点", fn: pcSun },
  { group: "papercut", file: "cloud", label: "双层云", note: "页首氛围 · 花边底部冲切", fn: pcCloud },
  { group: "papercut", file: "bird", label: "纸鸟", note: "那年今天 · 自由联想", fn: pcBird },
  { group: "papercut", file: "butterfly", label: "对折蝴蝶", note: "对折剪裁对称 · 心情高亮", fn: pcButterfly },
  { group: "papercut", file: "flower", label: "纸花", note: "纪念日/成就 · 徽章位", fn: pcFlower },
  { group: "papercut", file: "house", label: "小房子", note: "首页/引导页插画", fn: pcHouse },
  { group: "papercut", file: "plant", label: "尤加利枝", note: "卡片角落 · 侧栏底部", fn: pcPlant },
  { group: "papercut", file: "border-scallop", label: "冲切花边", note: "分隔带/区块标题底", fn: pcBorderScallop, wide: true },
  { group: "papercut", file: "stamp-frame", label: "邮票齿孔框", note: "照片/导出卡片外框", fn: pcStampFrame },

  { group: "crayon", file: "divider-wave", label: "波浪分隔线", note: "日期分隔 · 段落间", fn: crDivider, wide: true },
  { group: "crayon", file: "underline", label: "蜡笔下划线", note: "标题/关键词底衬", fn: crUnderline, wide: true },
  { group: "crayon", file: "circle-mark", label: "圈重点", note: "圈住日期/一句话", fn: crCircleMark, wide: true },
  { group: "crayon", file: "highlight-sun", label: "蜡笔高亮 · 暖黄", note: "文字背景高亮", fn: () => crHighlight(C.sun, 5), wide: true },
  { group: "crayon", file: "highlight-rose", label: "蜡笔高亮 · 蔷薇", note: "文字背景高亮", fn: () => crHighlight(C.rose, 12), wide: true },
  { group: "crayon", file: "star", label: "蜡笔星", note: "收藏/评分", fn: crStar },
  { group: "crayon", file: "sun-face", label: "笑脸太阳", note: "AI 附注/好天气", fn: crSunFace },
  { group: "crayon", file: "heart", label: "蜡笔爱心", note: "心情/点赞", fn: crHeart },

  { group: "handdrawn", file: "star-doodle", label: "手绘星", note: "收藏星（替换 ★ 字符）", fn: hdStarDoodle },
  { group: "handdrawn", file: "arrow", label: "弯箭头", note: "指认/引导批注", fn: hdArrow, wide: true },
  { group: "handdrawn", file: "coffee-stain", label: "咖啡渍", note: "卡片角上的生活痕迹", fn: hdCoffeeStain },
  { group: "handdrawn", file: "sparkle", label: "闪光", note: "AI 生成完成的点缀", fn: hdSparkle },
  { group: "handdrawn", file: "cat", label: "睡猫", note: "深夜记录彩蛋", fn: hdCat },
  { group: "handdrawn", file: "frame-sketch", label: "手绘框", note: "复盘页/引用块外框", fn: hdFrameSketch, wide: true },
  { group: "handdrawn", file: "paper-plane", label: "纸飞机", note: "发送/分享动效起点", fn: hdPaperPlane, wide: true },
  { group: "handdrawn", file: "checkbox", label: "待办勾选", note: "清单项 · 手绘对勾", fn: hdCheckbox },

  { group: "texture", file: "paper-grain", label: "纸纤维颗粒", note: "平铺 · mix-blend multiply", fn: txPaperGrain, wide: true },
  { group: "texture", file: "corrugated", label: "瓦楞纸", note: "结构层条带", fn: txCorrugated },
  { group: "texture", file: "washi-stripe", label: "和纸胶带 · 条纹", note: "贴照片/卡片封口", fn: txWashiStripe, wide: true },
  { group: "texture", file: "washi-grid", label: "和纸胶带 · 方格", note: "贴照片/卡片封口", fn: txWashiGrid, wide: true },
];

const GROUP_META = {
  papercut: { title: "剪纸 · 结构层", desc: "层叠 silhouette + 逐层投影，替代 clip-path 撕边的「纸感厚度」", prefix: "pc" },
  crayon: { title: "蜡笔 · 情绪层", desc: "feTurbulence 位移 + 蜡质颗粒断续，像真的画上去的", prefix: "cr" },
  handdrawn: { title: "手绘 · 批注层", desc: "双描线抖动 + 回声笔迹，2–12 字批注的最佳伴侣", prefix: "hd" },
  texture: { title: "纸纹 · 氛围层", desc: "可平铺噪声 / 瓦楞 / 和纸胶带，低透明度叠加", prefix: "tx" },
};

/* ───────────────────────── 产出 ───────────────────────── */
const rendered = new Map(); // key: group/file -> { svg, item }

for (const item of MANIFEST) {
  const dir = join(ASSETS, item.group);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const svg = item.fn();
  writeFileSync(join(dir, `${item.file}.svg`), svg, "utf8");
  rendered.set(`${item.group}/${item.file}`, { svg, item });
}

/* 内联进模板时重写 id，避免多份 SVG 的 #fx / #sh1 撞车 */
function inlineSVG(key) {
  const entry = rendered.get(key);
  if (!entry) throw new Error(`unknown asset: ${key}`);
  const { svg, item } = entry;
  const prefix = `${GROUP_META[item.group].prefix}-${item.file}`;
  return svg
    .replace(/\bid="/g, `id="${prefix}-`)
    .replace(/url\(#/g, `url(#${prefix}-`)
    .replace(/mask="url\(#/g, `mask="url(#${prefix}-`);
}

function buildWall(group) {
  const meta = GROUP_META[group];
  const cards = [...rendered.values()]
    .filter(({ item }) => item.group === group)
    .map(({ item }, i) => {
      const key = `${item.group}/${item.file}`;
      const path = `assets/${key}.svg`;
      return `      <figure class="asset-card reveal" style="--i:${i}" data-asset>
        <div class="asset-frame ${item.wide ? "asset-wide" : ""}">${inlineSVG(key)}</div>
        <figcaption class="asset-caption">
          <span class="asset-name">${item.file}.svg</span>
          <span class="hand-note">${item.label} · ${item.note}</span>
        </figcaption>
        <code class="asset-path">${path}</code>
      </figure>`;
    })
    .join("\n");
  return cards;
}

/* ───────────────────────── 组装 index.html ───────────────────────── */
const tplPath = join(ROOT, "tools", "template.html");
let html = readFileSync(tplPath, "utf8");
for (const group of Object.keys(GROUP_META)) {
  html = html.replaceAll(`{{WALL:${group}}}`, buildWall(group));
}
html = html.replace(/\{\{ASSET:([a-z-/]+)\}\}/g, (_, key) => inlineSVG(key));
writeFileSync(join(ROOT, "index.html"), html, "utf8");

console.log(`OK: ${MANIFEST.length} SVG assets -> ${ASSETS}`);
console.log("OK: index.html generated");
