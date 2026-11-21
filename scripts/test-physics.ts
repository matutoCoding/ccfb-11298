// 物理一致性数值测试（Node 直接跑，不依赖浏览器）：
// 1) 片剪沟深：设定值与高度场实测落差一致
// 2) 换道数：结数与纱线克重按新结数重算
// 3) 距离变换：边界结为 0，远离边界结不受剪
// 注：模块用了 DOM API 的部分在此不导入，仅测纯算法 carving/grid/report
import { buildHeightField, findBoundaries, auditGrooveDepth } from '../src/core/carving.ts';
import { gridFromSpec } from '../src/core/grid.ts';
import { buildUsage } from '../src/core/report.ts';
import { defaultPalette } from '../src/core/palette.ts';
import type { AppSettings, CarveSpec } from '../src/core/types.ts';

let pass = 0, fail = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.error('  ✗', msg); }
}

// 构造一块 200x120 结的双色结图：左半色0、右半色1，中间一条竖直边界
function makeKnots(cols: number, rows: number) {
  const knots = new Uint16Array(cols * rows);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) knots[y * cols + x] = x >= cols / 2 ? 1 : 0;
  return knots;
}

const palette = defaultPalette();
const settings: AppSettings = {
  defaultKpi: 100, shellLayers: 6, finDensity: 1,
  yarnLinearDensity: { wool: 0.55, silk: 0.42, woolSilk: 0.5 },
  foldFactor: 1, customPalette: palette, msaaSamples: 4,
};

console.log('测试 1：沟深物理真值（设多少量多少）');
for (const depth of [1.5, 2.5, 4.0]) {
  const g = gridFromSpec(600, 400, 100);
  const knots = makeKnots(g.cols, g.rows);
  const spec: CarveSpec = {
    basePile: 10,
    groove: { width: 4, depth, slope: 0.55, enabled: true, colorBoundaryOnly: false },
    relief: [],
  };
  const hf = buildHeightField({
    cols: g.cols, rows: g.rows, pitchXMm: g.pitchXMm, pitchYMm: g.pitchYMm,
    spec, knots, paletteIds: palette.map((p) => p.id),
  });
  const audit = auditGrooveDepth(hf, spec);
  assert(Math.abs(audit.measuredMax - depth) <= audit.toleranceMm,
    `设定沟深 ${depth}mm，实测落差 ${audit.measuredMax.toFixed(2)}mm（容差 ±${audit.toleranceMm}）`);
  // 沟底不剪穿：最低绒头保留 >=0.5mm
  let min = Infinity;
  for (const v of hf.heights) if (v < min) min = v;
  assert(min >= 0.5, `沟底最小绒头 ${min.toFixed(2)}mm >= 0.5mm，未剪穿经纬`);
}

console.log('测试 2：未启用片剪时高度场恒等于基准绒高');
{
  const g = gridFromSpec(600, 400, 100);
  const knots = makeKnots(g.cols, g.rows);
  const spec: CarveSpec = {
    basePile: 10,
    groove: { width: 4, depth: 3, slope: 0.5, enabled: false, colorBoundaryOnly: false },
    relief: [],
  };
  const hf = buildHeightField({
    cols: g.cols, rows: g.rows, pitchXMm: g.pitchXMm, pitchYMm: g.pitchYMm,
    spec, knots, paletteIds: palette.map((p) => p.id),
  });
  const allBase = hf.heights.every((v) => Math.abs(v - 10) < 1e-6);
  assert(allBase, '平绒高度场全部等于基准 10mm');
}

console.log('测试 3：换道数后结数变化，克重按新结数重算');
{
  const g80 = gridFromSpec(600, 400, 80);
  const g120 = gridFromSpec(600, 400, 120);
  assert(g120.cols > g80.cols && g120.rows > g80.rows,
    `80道 ${g80.cols}×${g80.rows}=${g80.cols * g80.rows}结 -> 120道 ${g120.cols}×${g120.rows}=${g120.cols * g120.rows}结`);
  const mk = (g: ReturnType<typeof gridFromSpec>) => {
    const knots = makeKnots(g.cols, g.rows);
    const spec: CarveSpec = {
      basePile: 10,
      groove: { width: 4, depth: 2.5, slope: 0.55, enabled: true, colorBoundaryOnly: false },
      relief: [],
    };
    const hf = buildHeightField({
      cols: g.cols, rows: g.rows, pitchXMm: g.pitchXMm, pitchYMm: g.pitchYMm,
      spec, knots, paletteIds: palette.map((p) => p.id),
    });
    return { knots, hf };
  };
  const a = mk(g80), b = mk(g120);
  const usage80 = buildUsage(a.hf, a.knots, palette, settings);
  const usage120 = buildUsage(b.hf, b.knots, palette, settings);
  const sum80 = usage80.reduce((s, i) => s + i.knots, 0);
  const sum120 = usage120.reduce((s, i) => s + i.knots, 0);
  assert(sum80 === g80.cols * g80.rows, `80道清单总结数 ${sum80} = 网格结数`);
  assert(sum120 === g120.cols * g120.rows, `120道清单总结数 ${sum120} = 网格结数`);
  const g80total = usage80.reduce((s, i) => s + i.grams, 0);
  const g120total = usage120.reduce((s, i) => s + i.grams, 0);
  assert(g120total > g80total,
    `高密度道数克重更大：80道 ${g80total.toFixed(0)}g -> 120道 ${g120total.toFixed(0)}g`);
}

console.log('测试 4：边界检测与距离场安全');
{
  const g = gridFromSpec(600, 400, 100);
  const knots = makeKnots(g.cols, g.rows);
  const boundary = findBoundaries(knots, g.cols, g.rows);
  const boundaryCount = boundary.reduce((s, v) => s + v, 0);
  assert(boundaryCount > 0, `检测到 ${boundaryCount} 个边界结`);
  // 最左列远离中间边界，其绒高应保持基准（不被剪）
  const spec: CarveSpec = {
    basePile: 10,
    groove: { width: 4, depth: 2.5, slope: 0.55, enabled: true, colorBoundaryOnly: false },
    relief: [],
  };
  const hf = buildHeightField({
    cols: g.cols, rows: g.rows, pitchXMm: g.pitchXMm, pitchYMm: g.pitchYMm,
    spec, knots, paletteIds: palette.map((p) => p.id),
  });
  const farEdge = hf.heights[Math.floor(g.rows / 2) * g.cols + 2];
  assert(Math.abs(farEdge - 10) < 1e-6, `远离边界处绒高保持 10mm（实测 ${farEdge}）`);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail) process.exit(1);
