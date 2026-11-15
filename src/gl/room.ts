// 室内场景:地板、墙面、地毯投影、灯光预设
import { createProgram, uniforms } from './glutil';
import { Mat4 } from './mat4';

export interface LightPreset {
  name: string;
  dir: [number, number, number];      // 指向光源
  color: [number, number, number];
  ambient: [number, number, number];
  wallTint: [number, number, number];
}

export const LIGHT_PRESETS: LightPreset[] = [
  { name: '自然光', dir: [0.55, 0.75, 0.35], color: [1.0, 0.98, 0.94], ambient: [0.34, 0.36, 0.40], wallTint: [0.92, 0.91, 0.89] },
  { name: '暖光', dir: [0.3, 0.85, -0.4], color: [1.0, 0.82, 0.60], ambient: [0.30, 0.25, 0.20], wallTint: [0.88, 0.84, 0.78] },
  { name: '展厅', dir: [0.1, 1.0, 0.1], color: [1.05, 1.03, 1.0], ambient: [0.42, 0.42, 0.44], wallTint: [0.94, 0.94, 0.94] },
  { name: '傍晚', dir: [0.85, 0.28, 0.2], color: [1.0, 0.62, 0.38], ambient: [0.20, 0.22, 0.30], wallTint: [0.72, 0.72, 0.78] },
];

const VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
uniform mat4 uProj;
uniform mat4 uView;
out vec3 vWorld;
out vec3 vNormal;
void main(){
  vWorld = aPos;
  vNormal = aNormal;
  gl_Position = uProj * uView * vec4(aPos, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
uniform vec3 uCamPos;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uAmbient;
uniform vec3 uWallTint;
uniform float uIsFloor;
uniform vec3 uRugCenter;    // xz + 不用 y
uniform vec2 uRugSize;
uniform float uRugRound;    // 0 矩形 1 圆/椭圆
out vec4 fragColor;

float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x),
             mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}

void main(){
  vec3 base;
  if (uIsFloor > 0.5) {
    // 木地板:条板 + 木纹
    float plankW = 0.18;
    float row = floor(vWorld.x / plankW);
    float offset = hash12(vec2(row, 7.0)) * 4.0;
    float plankZ = fract((vWorld.z + offset) / 1.2);
    float gapX = smoothstep(0.0, 0.012, fract(vWorld.x / plankW)) * smoothstep(1.0, 0.988, fract(vWorld.x / plankW));
    float gapZ = smoothstep(0.0, 0.01, plankZ) * smoothstep(1.0, 0.99, plankZ);
    float grain = vnoise(vec2(vWorld.x * 3.0, vWorld.z * 24.0)) * 0.5 + vnoise(vWorld.xz * 8.0) * 0.5;
    float tone = 0.72 + 0.18 * grain + 0.08 * hash12(vec2(row, 3.0));
    base = vec3(0.62, 0.47, 0.33) * tone;
    base *= 0.55 + 0.45 * gapX * gapZ;
  } else {
    // 墙面:轻微竖向渐变
    float g = smoothstep(0.0, 2.8, vWorld.y);
    base = uWallTint * (1.0 - 0.12 * g);
  }
  vec3 N = normalize(vNormal);
  vec3 L = normalize(uLightDir);
  float diff = max(dot(N, L), 0.0);
  vec3 col = base * (uAmbient + uLightColor * diff);

  // 地毯软阴影(沿光源反方向偏移的 SDF)
  vec2 p = vWorld.xz - uRugCenter.xz;
  vec2 ld = normalize(uLightDir.xz + vec2(1e-4));
  p += ld * 0.06;
  float d;
  if (uRugRound > 0.5) {
    vec2 q = p / (uRugSize * 0.5);
    d = (length(q) - 1.0) * min(uRugSize.x, uRugSize.y) * 0.5;
  } else {
    vec2 q = abs(p) - uRugSize * 0.5;
    d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  }
  float shadow = 1.0 - 0.38 * (1.0 - smoothstep(0.0, 0.16, d));
  if (uIsFloor > 0.5) col *= shadow;

  // 距离雾,让房间有纵深
  float dist = length(vWorld - uCamPos);
  float fog = 1.0 - exp(-dist * dist * 0.006);
  col = mix(col, uAmbient * 0.9, fog * 0.5);
  fragColor = vec4(col, 1.0);
}`;

export class Room {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private u: Record<string, WebGLUniformLocation | null>;
  private floorVAO: WebGLVertexArrayObject;
  private wallVAO: WebGLVertexArrayObject;
  private wallCount = 0;
  preset: LightPreset = LIGHT_PRESETS[0];
  visible = true;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.prog = createProgram(gl, VS, FS);
    this.u = uniforms(gl, this.prog, [
      'uProj', 'uView', 'uCamPos', 'uLightDir', 'uLightColor', 'uAmbient',
      'uWallTint', 'uIsFloor', 'uRugCenter', 'uRugSize', 'uRugRound',
    ]);
    // 地板 10x10
    this.floorVAO = gl.createVertexArray()!;
    gl.bindVertexArray(this.floorVAO);
    const S = 5;
    const floorVerts = new Float32Array([
      -S, 0, -S, 0, 1, 0,  S, 0, -S, 0, 1, 0,  S, 0, S, 0, 1, 0,
      -S, 0, -S, 0, 1, 0,  S, 0, S, 0, 1, 0,  -S, 0, S, 0, 1, 0,
    ]);
    const fb = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, fb);
    gl.bufferData(gl.ARRAY_BUFFER, floorVerts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);

    // 四面墙
    this.wallVAO = gl.createVertexArray()!;
    gl.bindVertexArray(this.wallVAO);
    const H = 3.0;
    const wv: number[] = [];
    const quad = (a: number[], b: number[], c: number[], d: number[], n: number[]) => {
      wv.push(...a, ...n, ...b, ...n, ...c, ...n, ...a, ...n, ...c, ...n, ...d, ...n);
    };
    quad([-S, 0, -S], [S, 0, -S], [S, H, -S], [-S, H, -S], [0, 0, 1]);
    quad([S, 0, S], [-S, 0, S], [-S, H, S], [S, H, S], [0, 0, -1]);
    quad([-S, 0, S], [-S, 0, -S], [-S, H, -S], [-S, H, S], [1, 0, 0]);
    quad([S, 0, -S], [S, 0, S], [S, H, S], [S, H, -S], [-1, 0, 0]);
    const wb = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, wb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(wv), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    this.wallCount = wv.length / 6;
    gl.bindVertexArray(null);
  }

  render(proj: Mat4, view: Mat4, camPos: [number, number, number], rugW: number, rugH: number, rugRound: boolean) {
    if (!this.visible) return;
    const gl = this.gl;
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.u.uProj, false, proj);
    gl.uniformMatrix4fv(this.u.uView, false, view);
    gl.uniform3fv(this.u.uCamPos, camPos);
    gl.uniform3fv(this.u.uLightDir, this.preset.dir);
    gl.uniform3fv(this.u.uLightColor, this.preset.color);
    gl.uniform3fv(this.u.uAmbient, this.preset.ambient);
    gl.uniform3fv(this.u.uWallTint, this.preset.wallTint);
    gl.uniform3f(this.u.uRugCenter, 0, 0, 0);
    gl.uniform2f(this.u.uRugSize, rugW, rugH);
    gl.uniform1f(this.u.uRugRound, rugRound ? 1 : 0);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    gl.uniform1f(this.u.uIsFloor, 1);
    gl.bindVertexArray(this.floorVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.uniform1f(this.u.uIsFloor, 0);
    gl.bindVertexArray(this.wallVAO);
    gl.drawArrays(gl.TRIANGLES, 0, this.wallCount);
    gl.bindVertexArray(null);
  }
}
