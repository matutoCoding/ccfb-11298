// 纤维实例化扭曲丝带（instanced twisted ribbon）
// 每根纤维 3 段 × 4 顶点 = 12 顶点；割绒尖梢宽度收为 0，旋转视角不会出现薄片闪烁
export const fiberVert = /* glsl */ `#version 300 es
precision highp float;

// 丝带模板（每纤维 12 顶点）
layout(location=0) in vec3 aRibbon;   // x=段参数t  y=环向角a  z=宽度系数
// 实例属性
layout(location=2) in vec3 iOrigin;   // 根部世界坐标（米）
layout(location=3) in vec4 iSeed;     // xyz=随机方向扰动 w=随机种子
layout(location=4) in float iType;    // 1=割绒 0=圈绒

uniform mat4 uViewProj;
uniform sampler2D uHeightMap;
uniform sampler2D uDirectionMap;
uniform vec2 uRugSize;
uniform float uPileHeightM;
uniform float uLoopHeightM;
uniform float uTime;

out vec3 vWorldPos;
out vec3 vTangent;
out vec2 vUV;
out float vSeed;
out float vCrush;
out vec3 vRootPos;
out float vFiberH;

// 确定性哈希，保证视角旋转时纤维形状不变（防闪烁的关键：不依赖相机/时间）
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

void main() {
  float t = aRibbon.x;          // 0 根 -> 1 梢
  float ang = aRibbon.y;        // 环向角 0..2π
  float widthMul = aRibbon.z;   // 1 根端 -> 0 梢端

  vec2 uv = vec2(iOrigin.x / uRugSize.x + 0.5, iOrigin.y / uRugSize.y + 0.5);
  float hNorm = texture(uHeightMap, uv).r;
  float typeMix = texture(uHeightMap, uv).g;
  vec4 dirTex = texture(uDirectionMap, uv);
  vec2 napDir = normalize(dirTex.rg * 2.0 - 1.0 + vec2(1e-5));
  float crush = dirTex.b;       // 压痕强度（脚印）

  float isCut = mix(iType, 1.0, typeMix);
  float fiberH = mix(uLoopHeightM, uPileHeightM, isCut) * hNorm;
  // 压痕：倒伏且变短
  fiberH *= 1.0 - crush * 0.72;

  // 纤维根部落在浮雕表面（与底层网格位移一致，圈绒用圈高）
  float baseZ = mix(uLoopHeightM, uPileHeightM, typeMix) * hNorm;

  // ---- 纤维中轴曲线 ----
  vec3 root = vec3(iOrigin.xy, baseZ);
  // 随机倾斜（确定性种子），圈绒更直立，割绒带自然倾斜
  float r1 = hash11(iSeed.w * 7.13) - 0.5;
  float r2 = hash11(iSeed.w * 3.71 + 11.0) - 0.5;
  float lean = (0.22 + 0.2 * hash11(iSeed.w * 5.3 + 3.0)) * (1.0 - crush * 0.9);
  vec2 leanDir = normalize(napDir * (1.0 - crush) + vec2(r1, r2) * 0.55 + napDir * crush * 2.2);

  vec3 center;
  vec3 tangent;
  if (isCut > 0.5) {
    // 割绒：轻微弯曲的直纤维，梢部顺着毛向倾倒
    float bend = sin(t * 1.5708);
    vec2 off = leanDir * fiberH * lean * bend * t;
    center = root + vec3(off, fiberH * t);
    tangent = normalize(vec3(leanDir * fiberH * lean * (0.5 + t), fiberH));
  } else {
    // 圈绒：半圆拱，两端扎根
    float angT = t * 3.14159265;
    vec2 off = leanDir * fiberH * 0.55 * (1.0 - cos(angT));
    center = root + vec3(off, fiberH * sin(angT));
    tangent = normalize(vec3(leanDir * fiberH * 0.55 * 3.14159 * sin(angT),
                             fiberH * 3.14159 * cos(angT)) + vec3(1e-6));
  }

  // ---- 环向截面：随 t 扭转的丝带 ----
  float twist = ang + t * (2.4 + hash11(iSeed.w * 9.17) * 3.2);
  // 参考轴随切线方向切换，避免纤维直立时 cross 退化为零向量
  vec3 refAxis = abs(tangent.z) > 0.95 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0);
  vec3 side = normalize(cross(tangent, refAxis));
  vec3 binormal = normalize(cross(tangent, side));
  float radius = (0.00075 * (0.75 + 0.5 * hash11(iSeed.w * 1.91))) * widthMul * mix(0.8, 1.0, isCut);
  vec3 pos = center + (side * cos(twist) + binormal * sin(twist)) * radius;

  vWorldPos = pos;
  vTangent = tangent;
  vUV = uv;
  vSeed = iSeed.w;
  vCrush = crush;
  vRootPos = root;
  vFiberH = fiberH;
  gl_Position = uViewProj * vec4(pos, 1.0);
}
`;

export const fiberFrag = /* glsl */ `#version 300 es
precision highp float;
in vec3 vWorldPos;
in vec3 vTangent;
in vec2 vUV;
in float vSeed;
in float vCrush;
in vec3 vRootPos;
in float vFiberH;

uniform sampler2D uPattern;
uniform sampler2D uYarnLUT;
uniform sampler2D uDirectionMap;
uniform sampler2D uShadowMap;
uniform mat4 uLightVP;
uniform vec3 uLightDir;
uniform vec3 uViewPos;
uniform vec3 uAmbient;
uniform vec3 uKeyColor;
uniform float uIntensity;
uniform float uShadowEnabled;
uniform float uNapStrength;
// 材质参数：x=粗糙度 y=高光强度 z=次表面/绒感 w=各向异性锐度
uniform vec4 uMaterial;

out vec4 frag;

vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 linearToSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

float pcfShadow(vec3 worldPos) {
  if (uShadowEnabled < 0.5) return 1.0;
  vec4 lp = uLightVP * vec4(worldPos, 1.0);
  vec3 ndc = lp.xyz / lp.w;
  if (abs(ndc.x) > 1.0 || abs(ndc.y) > 1.0 || ndc.z > 1.0) return 1.0;
  vec2 uv = ndc.xy * 0.5 + 0.5;
  float ref = ndc.z * 0.5 + 0.5;
  float s = 0.0;
  vec2 texel = 1.0 / vec2(textureSize(uShadowMap, 0));
  for (int x = -1; x <= 1; x++)
    for (int y = -1; y <= 1; y++) {
      float d = texture(uShadowMap, uv + vec2(x, y) * texel).r;
      s += (ref - 0.003 < d) ? 1.0 : 0.0;
    }
  return s / 9.0;
}

void main() {
  float idx = texture(uPattern, vUV).r;
  vec3 yarn = srgbToLinear(texture(uYarnLUT, vec2(idx, 0.5)).rgb);

  vec3 T = normalize(vTangent);
  vec3 V = normalize(uViewPos - vWorldPos);
  vec3 L = normalize(-uLightDir);

  // Kajiya-Kay 各向异性高光：沿纤维方向的长条柔光
  float TdotL = dot(T, L);
  float sinTL = sqrt(clamp(1.0 - TdotL * TdotL, 0.0, 1.0));
  float shin = mix(8.0, 90.0, uMaterial.w);
  float spec = pow(sinTL, shin) * uMaterial.y;

  // 丝材质：加一层柔和宽高光（双层各向异性）
  if (uMaterial.w > 0.75) {
    spec += pow(sinTL, 14.0) * uMaterial.y * 0.35;
  }

  // 漫反射用微扰动法线（纤维表面圆柱感）
  float ndl = 0.55 + 0.45 * max(sinTL, 0.0);
  float sh = pcfShadow(vWorldPos);

  // ---- 顺毛/逆毛色差 ----
  vec2 napDir = texture(uDirectionMap, vUV).rg * 2.0 - 1.0;
  vec2 viewDir = normalize((uViewPos.xy - vRootPos.xy) + vec2(1e-5));
  float against = dot(normalize(napDir + vec2(1e-5)), viewDir); // >0 逆毛看（对着毛尖）
  float nap = 1.0 + against * uNapStrength * 0.35 * (1.0 - vCrush * 0.5);

  // 纤维自身高度渐变 + 随机明暗，根部略暗
  float hFrac = clamp(length(vWorldPos - vRootPos) / max(vFiberH, 1e-4), 0.0, 1.0);
  float rootShade = 0.78 + 0.22 * hFrac;
  // 世界空间固定颗粒，视角旋转不闪烁
  float grain = 0.9 + 0.2 * hash13(vWorldPos * 420.0 + vec3(vSeed * 17.0));

  // 压痕区域整体压暗（脚印）
  float crushShade = 1.0 - vCrush * 0.28;

  vec3 diffuse = yarn * ndl * nap * rootShade * grain * crushShade;
  vec3 color = diffuse * (uAmbient + uKeyColor * uIntensity * sh)
             + uKeyColor * spec * uIntensity * sh
             + yarn * uMaterial.z * max(TdotL, 0.0) * 0.12 * sh; // 轻微次表面透射
  // 柔和色调映射，防止高光死白
  color = color / (color + vec3(0.85)) * 1.55;
  frag = vec4(linearToSrgb(color), 1.0);
}
`;
