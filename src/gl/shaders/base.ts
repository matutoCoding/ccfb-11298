// 地毯底层网格：按绒高图位移形成浮雕，采样纱线 LUT 上色
export const baseVert = /* glsl */ `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;     // 平面网格，z=0
layout(location=1) in vec2 aUV;

uniform mat4 uViewProj;
uniform sampler2D uHeightMap;   // R=绒高 G=割/圈
uniform float uPileHeightM;     // 最高割绒绒高（米）
uniform float uLoopHeightM;
uniform vec2 uTexel;
uniform vec2 uRugSize;

out vec2 vUV;
out vec3 vNormal;
out float vHeight;
out vec3 vWorldPos;

float sampleH(vec2 uv) { return texture(uHeightMap, uv).r; }

void main() {
  vUV = aUV;
  float h = sampleH(aUV);
  vHeight = h;
  float typeCut = texture(uHeightMap, aUV).g;
  float hM = mix(uLoopHeightM, uPileHeightM, typeCut) * h;
  vec3 pos = aPos;
  pos.z += hM;
  vWorldPos = pos;

  float hl = sampleH(aUV - vec2(uTexel.x, 0.0));
  float hr = sampleH(aUV + vec2(uTexel.x, 0.0));
  float hd = sampleH(aUV - vec2(0.0, uTexel.y));
  float hu = sampleH(aUV + vec2(0.0, uTexel.y));
  // 世界空间斜率：dh/du * H / 物理尺寸
  float sx = ((hr - hl) / (2.0 * uTexel.x)) * uPileHeightM / uRugSize.x;
  float sy = ((hu - hd) / (2.0 * uTexel.y)) * uPileHeightM / uRugSize.y;
  vNormal = normalize(vec3(-sx, -sy, 1.0));

  gl_Position = uViewProj * vec4(pos, 1.0);
}
`;

export const baseFrag = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
in vec3 vNormal;
in float vHeight;
in vec3 vWorldPos;

uniform sampler2D uPattern;
uniform sampler2D uYarnLUT;
uniform sampler2D uShadowMap;
uniform mat4 uLightVP;
uniform vec3 uLightDir;
uniform vec3 uAmbient;
uniform vec3 uKeyColor;
uniform float uIntensity;
uniform float uShadowEnabled;

out vec4 frag;

vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 linearToSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
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
      s += (ref - 0.0025 < d) ? 1.0 : 0.0;
    }
  return s / 9.0;
}

void main() {
  float idx = texture(uPattern, vUV).r;
  // LUT 存 sRGB 字节值，先转线性空间再做光照
  vec3 yarn = srgbToLinear(texture(uYarnLUT, vec2(idx, 0.5)).rgb);

  float n = fract(sin(dot(floor(vUV * 900.0), vec2(12.9898, 78.233))) * 43758.5453);
  yarn *= 0.92 + 0.16 * n;

  vec3 N = normalize(vNormal);
  vec3 L = normalize(-uLightDir);
  float ndl = max(dot(N, L), 0.0);
  float sh = pcfShadow(vWorldPos);
  vec3 lit = yarn * (uAmbient + uKeyColor * uIntensity * ndl * sh);
  lit *= 0.85 + 0.15 * vHeight;
  frag = vec4(linearToSrgb(lit), 1.0);
}
`;
