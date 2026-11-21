// 着色器静态健全性检查：括号配对、版本声明、in/out 配对、常见 GLSL ES 3.00 类型陷阱
// 真实编译由浏览器 WebGL2 完成；此脚本在 CI/提交前快速抓低级错误
import {
  SHELL_VS, SHELL_FS, FIN_VS, FIN_FS, BASE_VS, BASE_FS, BACK_VS, BACK_FS, FLOOR_VS, FLOOR_FS,
} from '../src/render/shaders.ts';

let fail = 0;
const check = (cond: boolean, msg: string) => {
  if (cond) console.log('  ✓', msg);
  else { fail++; console.error('  ✗', msg); }
};

const shaders: [string, string, 'VS' | 'FS'][] = [
  ['SHELL_VS', SHELL_VS, 'VS'], ['SHELL_FS', SHELL_FS, 'FS'],
  ['FIN_VS', FIN_VS, 'VS'], ['FIN_FS', FIN_FS, 'FS'],
  ['BASE_VS', BASE_VS, 'VS'], ['BASE_FS', BASE_FS, 'FS'],
  ['BACK_VS', BACK_VS, 'VS'], ['BACK_FS', BACK_FS, 'FS'],
  ['FLOOR_VS', FLOOR_VS, 'VS'], ['FLOOR_FS', FLOOR_FS, 'FS'],
];

for (const [name, src, stage] of shaders) {
  // 剥离行注释、块注释、字符串后再做结构统计，避免注释里的括号干扰
  const body = src
    .replace('#version 300 es', '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/"[^"]*"/g, '""');
  const opens = (body.match(/{/g) ?? []).length;
  const closes = (body.match(/}/g) ?? []).length;
  check(opens === closes, `${name}: 花括号配对 (${opens}/${closes})`);
  const parenO = (body.match(/\(/g) ?? []).length;
  const parenC = (body.match(/\)/g) ?? []).length;
  check(parenO === parenC, `${name}: 圆括号配对 (${parenO}/${parenC})`);
  check(src.startsWith('#version 300 es'), `${name}: GLSL ES 3.00 版本声明`);
  check(stage === 'VS' ? src.includes('gl_Position') : src.includes('out vec4 frag'),
    `${name}: ${stage === 'VS' ? '顶点着色器写 gl_Position' : '片元着色器输出 frag'}`);
  // GLSL ES 3.00 禁止 attribute/varying/texture2D 旧语法
  check(!/\b(attribute|varying|texture2D|gl_FragColor)\b/.test(src), `${name}: 无 GLSL ES 1.00 废弃关键字`);
  // 浮点字面量陷阱：vec 分量与浮点 uniform 运算必须是浮点
  check(!/uLayers\s*-\s*1\b(?!\.)/.test(src), `${name}: uLayers 与浮点运算`);
}

// 顶点 out 与片元 in 的接口一致性（按名称集合）
const vsOuts = new Set<string>();
const fsIns = new Set<string>();
for (const [, src, stage] of shaders) {
  const re = /^\s*(out|in)\s+(?:vec\d|float|mat\d|int)\s+(\w+)\s*;/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (stage === 'VS' && m[1] === 'out') vsOuts.add(m[2]);
    if (stage === 'FS' && m[1] === 'in') fsIns.add(m[2]);
  }
}
for (const name of fsIns) check(vsOuts.has(name), `片元输入 ${name} 在某顶点着色器中有对应 out`);

console.log(fail ? `\n着色器检查失败 ${fail} 项` : '\n全部着色器静态检查通过');
if (fail) process.exit(1);
