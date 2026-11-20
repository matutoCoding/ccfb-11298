// 程序化房间：木纹地板 + 哑光墙面，无外部贴图
export const roomVert = /* glsl */ `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec2 aUV;
uniform mat4 uViewProj;
out vec2 vUV;
out vec3 vWorldPos;
void main() {
  vUV = aUV;
  vWorldPos = aPos;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}
`;

export const floorFrag = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
in vec3 vWorldPos;
uniform vec3 uLightDir;
uniform vec3 uAmbient;
uniform vec3 uKeyColor;
uniform float uIntensity;
uniform mat4 uLightVP;
uniform sampler2D uShadowMap;
uniform float uShadowEnabled;
out vec4 frag;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float pcfShadow(vec3 worldPos) {
  if (uShadowEnabled < 0.5) return 1.0;
  vec4 lp = uLightVP * vec4(worldPos, 1.0);
  vec3 ndc = lp.xyz / lp.w;
  if (abs(ndc.x) > 1.0 || abs(ndc.y) > 1.0 || ndc.z > 1.0) return 1.0;
  vec2 uv = ndc.xy * 0.5 + 0.5;
  float ref = ndc.z * 0.5 + 0.5;
  vec2 texel = 1.0 / vec2(textureSize(uShadowMap, 0));
  float s = 0.0;
  for (int x = -1; x <= 1; x++)
    for (int y = -1; y <= 1; y++) {
      float d = texture(uShadowMap, uv + vec2(x, y) * texel).r;
      s += (ref - 0.0025 < d) ? 1.0 : 0.0;
    }
  return s / 9.0;
}

void main() {
  // 木地板：沿 x 的长条板
  float plankW = 0.22;
  float board = floor((vWorldPos.y + 6.0) / plankW);
  vec2 g = vec2(vWorldPos.x, fract((vWorldPos.y + 6.0) / plankW));
  float grain = sin(g.x * 28.0 + hash(vec2(board, 1.0)) * 12.0) * 0.5 + 0.5;
  float fine = sin(g.x * 130.0 + g.y * 8.0) * 0.5 + 0.5;
  vec3 woodA = vec3(0.62, 0.47, 0.32);
  vec3 woodB = vec3(0.48, 0.34, 0.22);
  vec3 base = mix(woodA, woodB, hash(vec2(board, 7.0)) * 0.7);
  base *= 0.85 + 0.18 * grain + 0.06 * fine;
  // 板缝
  float seam = smoothstep(0.02, 0.0, min(g.y, 1.0 - g.y));
  base *= 1.0 - seam * 0.35;

  vec3 N = vec3(0.0, 0.0, 1.0);
  vec3 L = normalize(-uLightDir);
  float ndl = max(dot(N, L), 0.0);
  float sh = pcfShadow(vWorldPos);
  vec3 color = base * (uAmbient + uKeyColor * uIntensity * ndl * sh);
  color = color / (color + vec3(0.9)) * 1.4;
  frag = vec4(color, 1.0);
}
`;

export const wallFrag = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
in vec3 vWorldPos;
uniform vec3 uLightDir;
uniform vec3 uAmbient;
uniform vec3 uKeyColor;
uniform float uIntensity;
uniform vec3 uTint;
out vec4 frag;
void main() {
  vec3 N = vec3(0.0, 1.0, 0.0);
  vec3 L = normalize(-uLightDir);
  float ndl = abs(dot(normalize(vec3(L.x, L.y, 0.0001)), N));
  float vert = clamp(vWorldPos.z / 3.0, 0.0, 1.0);
  vec3 color = uTint * (uAmbient * 0.9 + uKeyColor * uIntensity * (0.25 + 0.5 * ndl) * (0.8 + 0.2 * vert));
  color = color / (color + vec3(0.9)) * 1.35;
  frag = vec4(color, 1.0);
}
`;
