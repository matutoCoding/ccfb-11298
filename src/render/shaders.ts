// 全部 GLSL ES 3.00 着色器源码
// 设计原则：
// 1) 所有随机量从物体空间整数结坐标 + 固定 seed 派生，视角变化不重采样 -> 不闪
// 2) 高度场单位 mm，与剪花引擎同源，剖面与渲染一致
// 3) 壳层体积 + 逐纤维片元 + 边缘鳍片，贴近看是一根根绒尖而非薄片

const COMMON = /* glsl */ `
precision highp float;
uniform sampler2D uKnotTex;    // R16UI 结色索引
uniform sampler2D uHeightTex;  // R16F 绒头高度(mm)
uniform sampler2D uPaletteTex; // 每色号 RGBA8: rgb=线性色, a=材质类型(0毛1丝2夹丝)
uniform vec2 uGrid;            // cols, rows
uniform vec2 uPitch;           // 结间距 mm (x,y)
uniform float uBasePile;
uniform float uTime;
uniform int uYarn;             // 全局默认材质（色卡未指定时）

// 物体空间整数哈希 -> [0,1)，无 time 依赖，旋转不闪
uvec3 hashSeed = uvec3(0x68e31da4u, 0xb5297a49u, 0x1b56c4e9u);
float hash31(ivec3 p) {
  uvec3 q = uvec3(p) * uvec3(374761393u, 668265263u, 2147483647u) + hashSeed;
  uint h = q.x ^ q.y ^ q.z;
  h = (h ^ (h >> 13)) * 1274126177u;
  h ^= h >> 16;
  return float(h) / 4294967296.0;
}
float hash21(ivec2 p) { return hash31(ivec3(p, 7)); }

vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 linearToSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
vec3 paletteLinearColor(int idx) {
  int n = textureSize(uPaletteTex, 0).x;
  vec4 v = texelFetch(uPaletteTex, ivec2(clamp(idx, 0, n - 1), 0), 0);
  return srgbToLinear(v.rgb);
}
int paletteMaterial(int idx) {
  int n = textureSize(uPaletteTex, 0).x;
  vec4 v = texelFetch(uPaletteTex, ivec2(clamp(idx, 0, n - 1), 0), 0);
  return int(v.a * 2.0 + 0.5);
}

vec2 knotUv(vec2 objXy) {
  return clamp((objXy + uPitch * 0.5) / (uGrid * uPitch), vec2(0.001), vec2(0.999));
}
float sampleHeightMm(vec2 uv) { return texture(uHeightTex, uv).r; }
int sampleKnot(vec2 uv) { return int(texture(uKnotTex, uv).r); }

// 高度场中心差分法线（物体空间），沟在侧光下的阴影由此自然产生
vec3 heightNormal(vec2 uv, vec3 baseN) {
  vec2 texel = 1.0 / uGrid;
  float hl = texture(uHeightTex, uv - vec2(texel.x, 0.0)).r;
  float hr = texture(uHeightTex, uv + vec2(texel.x, 0.0)).r;
  float hd = texture(uHeightTex, uv - vec2(0.0, texel.y)).r;
  float hu = texture(uHeightTex, uv + vec2(0.0, texel.y)).r;
  vec3 n = normalize(vec3((hl - hr) / (2.0 * uPitch.x), (hd - hu) / (2.0 * uPitch.y), 1.0));
  return normalize(mix(baseN, n, 0.85));
}

// 染缸批次横向色差：按物理行确定条带，Lab 风格的明度/色调微扰，强度可调
uniform vec4 uDyeLot; // x=条带宽(行) y=强度 z=相位 w=开关
uniform float uShowDyeLines; // 1=高亮换缸边界行
float dyeFactor(float objY) {
  if (uDyeLot.w < 0.5) return 0.0;
  float row = (-objY / uPitch.y) + uDyeLot.z;
  float band = floor(row / max(1.0, uDyeLot.x));
  float h = fract(sin(band * 127.1 + 3.7) * 43758.5453);
  return (h - 0.5) * 2.0; // -1..1 每缸固定
}
// 换缸边界行高亮：在每缸交界处叠一条青色指示线，强度 0..1
float dyeLineMask(vec2 objXy) {
  if (uShowDyeLines < 0.5 || uDyeLot.w < 0.5) return 0.0;
  float row = (-objXy.y / uPitch.y) + uDyeLot.z;
  float within = fract(row / max(1.0, uDyeLot.x));
  float nearEdge = 1.0 - smoothstep(0.0, 0.06, min(within, 1.0 - within));
  return nearEdge;
}
vec3 applyDyeLot(vec3 linearRgb, vec2 uv, vec2 objXy) {
  float f = dyeFactor(objXy.y) * uDyeLot.y;
  float luma = dot(linearRgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 outC = linearRgb * (1.0 + f * 0.22);
  // 混缸边界行做半行过渡，避免一条硬线
  float row = (-objXy.y / uPitch.y) + uDyeLot.z;
  float fracRow = fract(row / max(1.0, uDyeLot.x));
  float edge = smoothstep(0.0, 0.15, min(fracRow, 1.0 - fracRow));
  vec3 c = mix(vec3(luma), outC, 0.6 + 0.4 * edge);
  // 换缸行叠加青色指示（仅标注用）
  float line = dyeLineMask(objXy);
  c = mix(c, vec3(0.25, 0.75, 0.85), line * 0.55);
  return c;
}
`;

export const SHELL_VS = /* glsl */ `#version 300 es
${COMMON}
in vec2 aPos;          // 物体空间 xy (mm)
uniform float uLayer;  // 0..N-1
uniform float uLayers;
uniform mat4 uViewProj;
uniform mat4 uModel;
out vec2 vUv;
out vec2 vObj;
out float vLayerT;
out float vFiberLen;
void main() {
  vec2 uv = knotUv(aPos);
  float h = sampleHeightMm(uv);
  vLayerT = uLayer / max(1.0, uLayers - 1.0);
  // 绒头从地表向法线方向生长；越靠壳顶可占用高度越接近全绒高
  vFiberLen = h;
  float z = vLayerT * h;
  vUv = uv;
  vObj = aPos;
  gl_Position = uViewProj * uModel * vec4(aPos, z, 1.0);
}
`;

export const SHELL_FS = /* glsl */ `#version 300 es
${COMMON}
in vec2 vUv;
in vec2 vObj;
in float vLayerT;
in float vFiberLen;
uniform vec3 uLightDir;     // 视图空间光向由相机侧换算后传物体空间
uniform vec3 uLightColor;
uniform float uAmbient;
uniform vec3 uEyePosObj;
out vec4 frag;

// 各向异性 GGX（丝的柔和高光 / 夹丝的闪烁）
float distributionGGX(vec3 n, vec3 h, float rough) {
  float a = rough * rough;
  float nh = max(dot(n, h), 0.0);
  float d = (nh * nh * (a * a - 1.0) + 1.0);
  return (a * a) / max(1e-5, 3.14159265 * d * d);
}

void main() {
  ivec2 knotCell = ivec2(floor((vObj + uPitch * 0.5) / uPitch));
  int colorIdx = sampleKnot(vUv);
  vec3 base = paletteLinearColor(colorIdx);
  int material = paletteMaterial(colorIdx);
  if (material < 0) material = uYarn;

  // ---- 逐纤维体积结构：每结内多根绒丝，物体空间锚定 ----
  vec2 localF = fract((vObj + uPitch * 0.5) / uPitch) - 0.5; // 结内 -0.5..0.5
  // 一个结里 3~5 根绒丝的位置，用整数结坐标哈希固定
  vec3 n0 = heightNormal(vUv, vec3(0.0, 0.0, 1.0));
  float fiberRnd = hash21(knotCell);
  float fibers = 3.0 + floor(fiberRnd * 3.0);
  vec2 fiberAxis = vec2(cos(fiberRnd * 6.2831), sin(fiberRnd * 6.2831));
  float along = dot(localF, fiberAxis);
  float across = dot(localF, vec2(-fiberAxis.y, fiberAxis.x));
  float fiberId = floor((along + 0.5) * fibers);
  float fiberCenter = (fiberId + 0.5) / fibers - 0.5;
  float fiberHalfW = 0.35 / fibers;
  float fiberShape = 1.0 - smoothstep(fiberHalfW * 0.4, fiberHalfW, abs(along - fiberCenter));
  // 绒丝顶端收尖：顶层壳出现一根根独立轮廓
  float tipTaper = 1.0 - vLayerT * vLayerT * 0.55;
  float density = fiberShape * tipTaper;

  // 壳层间软过渡 + 结边缘衰减，消除"一层层薄片"
  float cellEdge = smoothstep(0.5, 0.38, max(abs(localF.x), abs(localF.y)));
  float layerFade = mix(0.55, 1.0, 1.0 - abs(vLayerT - 0.5) * 2.0 * 0.25);
  float alpha = clamp(density * cellEdge * layerFade + 0.12 * cellEdge, 0.0, 1.0);
  // 顶层壳保留绒尖间隙，底层壳近乎实心，保证体积连续
  alpha = mix(0.85, alpha, vLayerT);
  if (alpha < 0.06) discard;

  // ---- 微法线扰动：绒丝方向 + 结级随机倾斜，固定不闪 ----
  float tilt = (hash31(ivec3(knotCell, int(fiberId))) - 0.5) * 0.35;
  vec3 microN = normalize(n0 + vec3(fiberAxis * tilt, 0.15 * (hash21(knotCell + ivec2(3, 9)) - 0.5)));

  vec3 V = normalize(uEyePosObj - vec3(vObj, vLayerT * vFiberLen));
  vec3 L = normalize(uLightDir);
  vec3 H = normalize(L + V);
  float ndl = max(dot(microN, L), 0.0);

  // ---- 三种纱线 BRDF ----
  vec3 color = base * uAmbient;
  float rough = 0.85, specStrength = 0.06;
  if (material == 1) { rough = 0.28; specStrength = 0.55; }       // 丝：柔和强高光
  else if (material == 2) { rough = 0.42; specStrength = 0.30; }  // 羊毛夹丝
  float spec = distributionGGX(microN, H, rough) * specStrength;

  if (material == 2) {
    // 夹丝：观察角相关的闪烁单元，位置由结坐标固定，只随视角显隐 -> 转动才闪、静止不闪
    float sparkleCell = hash31(ivec3(knotCell, int(fiberId * 7.0)));
    float facing = pow(max(dot(H, microN), 0.0), 48.0);
    float sparkle = step(0.82, sparkleCell) * facing * 1.6;
    spec += sparkle;
  }
  // 羊毛：织物各向异性漫反射（绒丝方向拉长的亮带）
  float velvet = 1.0 + 0.18 * pow(1.0 - max(dot(microN, V), 0.0), 2.0);
  color += base * uLightColor * (ndl * velvet + spec * (material == 0 ? vec3(0.9) : vec3(1.0)));
  color = applyDyeLot(color, vUv, vObj);

  // 绒尖略亮（毛尖受光），沟底略暗由法线 ndl 自然给出
  color *= 0.85 + 0.15 * vLayerT;
  frag = vec4(linearToSrgb(max(color, vec3(0.0))), alpha);
}
`;

export const FIN_VS = /* glsl */ `#version 300 es
${COMMON}
in vec3 aCorner;     // 鳍片四顶点模板：xy∈{-1,1}, z=底0/尖1
in vec2 iEdgePos;    // 实例：边缘中点物体坐标
in float iEdgeAxis;  // 实例：0=竖边 1=横边
in float iRnd;       // 实例：固定随机
uniform mat4 uViewProj;
uniform mat4 uModel;
out vec2 vUv;
out vec2 vObj;
out float vT;
out float vRnd;
out float vAxis;
void main() {
  vec2 uv = knotUv(iEdgePos);
  float h = sampleHeightMm(uv);
  float halfW = (iEdgeAxis < 0.5 ? uPitch.y : uPitch.x) * 0.42;
  vec2 tangent = iEdgeAxis < 0.5 ? vec2(0.0, 1.0) : vec2(1.0, 0.0);
  float top = aCorner.z;
  vec2 p = iEdgePos + tangent * aCorner.x * halfW;
  // 绒尖做固定随机倒伏（实例属性，不随视角变化 -> 不闪）
  vec2 leanVec = vec2(-tangent.y, tangent.x) * (iRnd - 0.5) * halfW * 0.8 * top;
  float z = top * h;
  vUv = uv;
  vObj = p + leanVec;
  vT = top;
  vRnd = iRnd;
  vAxis = iEdgeAxis;
  gl_Position = uViewProj * uModel * vec4(p + leanVec, z, 1.0);
}
`;

export const FIN_FS = /* glsl */ `#version 300 es
${COMMON}
in vec2 vUv;
in vec2 vObj;
in float vT;
in float vRnd;
in float vAxis;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform float uAmbient;
uniform vec3 uEyePosObj;
out vec4 frag;
void main() {
  int colorIdx = sampleKnot(vUv);
  vec3 base = paletteLinearColor(colorIdx);
  int material = paletteMaterial(colorIdx);
  if (material < 0) material = uYarn;
  // 鳍片法线：水平边 -> 法线沿 y，竖直边 -> 法线沿 x，加绒丝扰动
  vec3 n = normalize(vec3(vAxis < 0.5 ? 1.0 : 0.0, vAxis < 0.5 ? 0.0 : 1.0, 0.35));
  vec3 L = normalize(uLightDir);
  vec3 V = normalize(uEyePosObj - vec3(vObj, vT));
  float ndl = max(dot(n, L), 0.0);
  vec3 color = base * (uAmbient + uLightColor * ndl);
  if (material != 0) {
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(n, H), 0.0), material == 1 ? 24.0 : 40.0) * (material == 1 ? 0.5 : 0.28);
    color += uLightColor * spec;
  }
  color = applyDyeLot(color, vUv, vObj);
  // 绒尖收尖透明，鳍片根部并入毯面
  float alpha = mix(0.75, 0.18, smoothstep(0.0, 1.0, vT));
  frag = vec4(linearToSrgb(max(color, vec3(0.0))), alpha);
}
`;

export const BASE_VS = /* glsl */ `#version 300 es
${COMMON}
in vec2 aPos;
uniform mat4 uViewProj;
uniform mat4 uModel;
out vec2 vUv;
out vec2 vObj;
void main() {
  vec2 uv = knotUv(aPos);
  vUv = uv;
  vObj = aPos;
  float z = sampleHeightMm(uv) * 0.02; // 基布贴在绒面之下
  gl_Position = uViewProj * uModel * vec4(aPos, z - 0.4, 1.0);
}
`;

export const BASE_FS = /* glsl */ `#version 300 es
${COMMON}
in vec2 vUv;
in vec2 vObj;
uniform vec3 uLightDir;
uniform float uAmbient;
out vec4 frag;
void main() {
  int idx = sampleKnot(vUv);
  vec3 base = paletteLinearColor(idx) * 0.55;
  // 经纬编织暗纹
  vec2 weave = sin((vObj / uPitch) * 3.14159);
  float weaveShade = 0.9 + 0.1 * weave.x * weave.y;
  vec3 n = heightNormal(vUv, vec3(0,0,1));
  float ndl = max(dot(n, normalize(uLightDir)), 0.0);
  frag = vec4(linearToSrgb(applyDyeLot(base * weaveShade * (uAmbient + ndl), vUv, vObj)), 1.0);
}
`;

// 背面：结点一个个凸起，翻过来看得到打结结构
export const BACK_VS = /* glsl */ `#version 300 es
${COMMON}
in vec2 aPos;
uniform mat4 uViewProj;
uniform mat4 uModel;
out vec2 vUv;
out vec2 vObj;
void main() {
  vec2 uv = knotUv(aPos);
  vUv = uv;
  vObj = aPos;
  ivec2 cell = ivec2(floor((aPos + uPitch * 0.5) / uPitch));
  float bump = hash21(cell) * 0.35;
  gl_Position = uViewProj * uModel * vec4(aPos, -0.8 - bump, 1.0);
}
`;

export const BACK_FS = /* glsl */ `#version 300 es
${COMMON}
in vec2 vUv;
in vec2 vObj;
uniform vec3 uLightDir;
uniform float uAmbient;
out vec4 frag;
void main() {
  ivec2 cell = ivec2(floor((vObj + uPitch * 0.5) / uPitch));
  vec2 localF = fract((vObj + uPitch * 0.5) / uPitch) - 0.5;
  float knot = 1.0 - smoothstep(0.18, 0.42, length(localF));
  vec3 thread = vec3(0.72, 0.66, 0.55);
  vec3 knotCol = thread * (0.75 + 0.25 * hash21(cell));
  vec3 n = normalize(vec3(-localF * 1.6, 0.6 + knot));
  float ndl = max(dot(n, normalize(uLightDir)), 0.0);
  frag = vec4(linearToSrgb(knotCol * (uAmbient + ndl * 0.9)), 1.0);
}
`;

export const FLOOR_VS = /* glsl */ `#version 300 es
precision highp float;
in vec3 aPos;
uniform mat4 uViewProj;
uniform mat4 uModel;
out vec3 vPos;
void main() {
  vPos = (uModel * vec4(aPos, 1.0)).xyz;
  gl_Position = uViewProj * uModel * vec4(aPos, 1.0);
}
`;

export const FLOOR_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vPos;
uniform vec3 uLightDir;
uniform float uIsWall;
out vec4 frag;
// 程序化木纹/墙面，无外部贴图
void main() {
  vec2 p = vPos.xy * 0.01;
  float grain;
  if (uIsWall > 0.5) {
    grain = 0.85 + 0.05 * sin(p.x * 18.0) + 0.03 * sin(p.y * 7.0);
  } else {
    float plank = floor(p.y * 6.0);
    grain = 0.78 + 0.12 * sin(p.x * 30.0 + plank * 3.1) + 0.05 * sin(p.y * 60.0);
  }
  vec3 base = mix(vec3(0.42, 0.33, 0.24), vec3(0.82, 0.80, 0.76), uIsWall) * grain;
  float ndl = max(normalize(uLightDir).z * 0.4 + 0.7, 0.0);
  frag = vec4(base * ndl, 1.0);
}
`;
