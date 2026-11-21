// 结图转换算法测试：锯齿/细线检测、色号合并、中位切分量化、道数几何
import { detectJagged, mergeColor } from '../src/core/conversion.ts';
import { medianCut, deltaE_rgb, rgbToLab } from '../src/core/color.ts';
import { gridFromSpec, MM_PER_INCH } from '../src/core/grid.ts';

let pass = 0, fail = 0;
const assert = (cond: boolean, msg: string) => {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.error('  ✗', msg); }
};

console.log('测试 A：道数几何换算');
{
  const g = gridFromSpec(254, 254, 100); // 10 英寸见方、100 道
  assert(Math.abs(g.pitchXMm - MM_PER_INCH / 100) < 1e-9, `结间距 = 25.4/100 = ${g.pitchXMm.toFixed(3)}mm`);
  assert(g.cols === 1000 && g.rows === 1000, `10英寸100道 = 1000×1000 结（得 ${g.cols}×${g.rows}）`);
  const g2 = gridFromSpec(600, 400, 80);
  const g3 = gridFromSpec(600, 400, 120);
  assert(g3.cols * g3.rows > g2.cols * g2.rows, '同道物理尺寸下道数越高结数越多');
  assert(Math.abs(g2.widthMm - 600) < 1e-9 && Math.abs(g3.heightMm - 400) < 1e-9, '换道数物理尺寸保持不变');
}

console.log('测试 B：细线（1 结宽竖条）必须被锯齿检测标出');
{
  // 9x9，中间一竖列颜色 1，其余颜色 0
  const cols = 9, rows = 9;
  const knots = new Uint16Array(cols * rows);
  for (let y = 1; y < rows - 1; y++) knots[y * cols + 4] = 1;
  const { mask, count } = detectJagged(knots, cols, rows);
  const marked = [];
  for (let y = 1; y < rows - 1; y++) if (mask[y * cols + 4]) marked.push(y);
  assert(marked.length >= rows - 4, `1 结宽竖条标出 ${marked.length} 个风险结（总检出 ${count}）`);
}

console.log('测试 C：纯色平涂不应误报锯齿');
{
  const cols = 12, rows = 12;
  const knots = new Uint16Array(cols * rows); // 全 0
  const { count } = detectJagged(knots, cols, rows);
  assert(count === 0, `纯色无边界，锯齿检出 = ${count}`);
}

console.log('测试 D：对角线阶梯边被识别');
{
  // 主对角线右下三角填色 1，制造连续单结台阶
  const cols = 10, rows = 10;
  const knots = new Uint16Array(cols * rows);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) if (x <= y) knots[y * cols + x] = 1;
  const { count } = detectJagged(knots, cols, rows);
  assert(count > 0, `45° 阶梯边检出 ${count} 个风险结`);
}

console.log('测试 E：色号合并把 from 全部改成 to');
{
  const cols = 4, rows = 2;
  const knots = new Uint16Array([0, 1, 2, 1, 2, 0, 1, 0]);
  const ids = ['A', 'B', 'C'];
  const out = mergeColor(knots, ids, 'B', 'A');
  assert(!out.knots.includes(1), '合并后结数组里不再有色号 B 的索引 1');
  assert(out.knots[1] === 0 && out.knots[3] === 0 && out.knots[6] === 0, '原 B 的结全部并入 A');
  assert(out.knots[2] === 2 && out.knots[4] === 2, '色号 C 不受影响');
  // 原数组不可变
  assert(knots[1] === 1, '合并返回新数组，不修改原结图');
}

console.log('测试 F：中位切分量化收敛到限定色数');
{
  // 造两块明显不同的颜色区域
  const w = 40, h = 20;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const red = x < w / 2;
    data[i] = red ? 200 : 40;
    data[i + 1] = red ? 40 : 200;
    data[i + 2] = red ? 40 : 60;
    data[i + 3] = 255;
  }
  const colors = await medianCut(data, w * h, 4);
  assert(colors.length <= 4, `量化色数 ${colors.length} <= 上限 4`);
  assert(colors.length >= 2, `两色区域量化出 ${colors.length} 个代表色`);
  const dE = deltaE_rgb(colors[0], colors[1]);
  assert(dE > 30, `两个代表色 ΔE=${dE.toFixed(1)} 明显分离`);
}

console.log('测试 G：Lab 色差对称性与自零');
{
  const c1 = { r: 120, g: 80, b: 200 };
  assert(Math.abs(deltaE_rgb(c1, c1)) < 1e-9, '同色 ΔE = 0');
  const lab = rgbToLab(c1);
  assert(lab.L > 0 && lab.L < 100, `Lab L 通道在合法区间 (${lab.L.toFixed(1)})`);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail) process.exit(1);
