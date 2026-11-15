// 壳层(shell)绒毛地毯渲染器
// 防穿帮要点:
//  1. 每像素抖动壳层阈值,消除"一层层薄片"的层感
//  2. MSAA + alpha-to-coverage,转动视角不闪
//  3. 噪声纹理 mipmap + 各向异性过滤,远处自然平均
//  4. 边缘裙边几何,侧面看也是绒毛而不是切片
import { createProgram, uniforms, createFurNoiseTexture } from './glutil';
import { Mat4 } from './mat4';

const FUR_COMMON = `
uniform sampler2D uHeightTex;   // R 绒高 0..1
uniform sampler2D uRegionTex;   // R 1=割绒 0=圈绒
uniform sampler2D uNapTex;      // RG 倒顺毛方向 B 压痕
uniform sampler2D uPatternTex;  // RGB 纱线颜色 A 材质id(0/0.5/1)
uniform sampler2D uFurNoise;    // 割绒噪声
uniform sampler2D uLoopNoise;   // 圈绒噪声
uniform float uMaxHeight;       // 米
uniform vec2 uNoiseScale;       // uv -> 毛簇格数
`;

const RUG_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aXZ;
layout(location=1) in vec2 aUV;
uniform mat4 uProj;
uniform mat4 uView;
uniform float uShellT;
${FUR_COMMON}
out vec2 vUV;
out float vT;
out vec3 vWorld;
out vec2 vNap;
out float vPressure;
out float vPile;
void main(){
  float h = texture(uHeightTex, aUV).r;
  vec4 nap = texture(uNapTex, aUV);
  float pile = texture(uRegionTex, aUV).r;
  float pressure = nap.b;
  float height = h * uMaxHeight;
  height *= mix(0.55, 1.0, pile);          // 圈绒更矮
  height *= (1.0 - pressure * 0.65);       // 脚印压扁
  vec2 napDir = nap.rg * 2.0 - 1.0;
  float t = uShellT;
  vec3 pos = vec3(aXZ.x, height * t, aXZ.y);
  // 绒尖顺倒毛方向弯曲(只割绒)
  float lean = t * t * height * 0.85 * pile;
  pos.xz += napDir * lean;
  vUV = aUV; vT = t; vNap = napDir; vPressure = pressure; vPile = pile;
  vWorld = pos;
  gl_Position = uProj * uView * vec4(pos, 1.0);
}`;

const SKIRT_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;    // 底边周界点 (y=0)
layout(location=1) in vec2 aNormal; // 外法线 xz
layout(location=2) in vec2 aUVEdge; // x: 周长比例 y: 0底1顶
layout(location=3) in vec2 aUV;     // 对应毯面 uv
uniform mat4 uProj;
uniform mat4 uView;
uniform float uShellT;
${FUR_COMMON}
out vec2 vUV;
out float vT;
out vec3 vWorld;
out vec2 vNap;
out float vPressure;
out float vPile;
out vec2 vEdgeUV;
void main(){
  float h = texture(uHeightTex, aUV).r;
  vec4 nap = texture(uNapTex, aUV);
  float pile = texture(uRegionTex, aUV).r;
  float height = h * uMaxHeight * mix(0.55, 1.0, pile);
  float t = uShellT;
  // 侧面绒毛向外蓬出
  vec3 pos = aPos;
  pos.y = aUVEdge.y * height;
  pos.xz += aNormal * t * uMaxHeight * 0.28;
  vUV = aUV; vT = t; vNap = nap.rg * 2.0 - 1.0; vPressure = nap.b; vPile = pile;
  vEdgeUV = aUVEdge;
  vWorld = pos;
  gl_Position = uProj * uView * vec4(pos, 1.0);
}`;

const FUR_FS_BODY = `
precision highp float;
in vec2 vUV;
in float vT;
in vec3 vWorld;
in vec2 vNap;
in float vPressure;
in float vPile;
#ifdef IS_SKIRT
in vec2 vEdgeUV;
#endif
${FUR_COMMON}
uniform vec3 uCamPos;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uAmbient;
uniform float uShellCount;
uniform vec4 uMatParams[3];   // x 高光锐度 y 高光强度 z 丝光
uniform float uNapContrast;
uniform float uSkirt;         // 1=裙边(不做形状裁剪)
uniform vec2 uEdgeScale;      // 裙边噪声缩放
out vec4 fragColor;

float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main(){
  // 形状裁剪(圆形/椭圆在 uv 空间都是圆)
  if (uSkirt < 0.5) {
    #ifdef SHAPE_ROUND
    vec2 c = vUV - 0.5;
    if (dot(c, c) > 0.25) discard;
    #endif
  }
  // 每像素抖动壳层高度,打散层与层之间的界线
  float t = vT + (hash12(gl_FragCoord.xy) - 0.5) / uShellCount;

  vec2 nUV = vUV * uNoiseScale;
  #ifdef IS_SKIRT
  // 裙边:沿周向铺噪声
  nUV = vEdgeUV * uNoiseScale;
  #endif
  vec4 cut = texture(uFurNoise, nUV);
  vec4 loop = texture(uLoopNoise, nUV * 0.6);
  float density = mix(loop.r, cut.r, vPile);
  #ifdef DEBUG_DENSITY
  fragColor = vec4(vec3(texture(uFurNoise, vUV * 4.0).r), 1.0);
  return;
  #endif

  float a = density - t;
  if (a <= 0.0) discard;
  float alpha = clamp(a * 5.0, 0.0, 1.0);

  vec4 pat = texture(uPatternTex, vUV);
  vec3 base = pat.rgb;
  int matId = int(floor(pat.a * 2.0 + 0.5));
  // 单簇颜色微差,像捻线
  float vary = mix(loop.g, cut.g, vPile);
  base *= 0.90 + 0.20 * vary;

  vec3 V = normalize(uCamPos - vWorld);
  vec3 T = normalize(vec3(vNap.x, 0.35, vNap.y) + vec3(0.0, 0.0001, 0.0));
  vec3 N = normalize(vec3(-vNap.x * t * 0.8, 1.0, -vNap.y * t * 0.8));

  float ao = mix(0.30, 1.0, pow(t, 0.65));       // 根部暗
  // 顺毛逆毛:视线方向与倒毛方向的关系
  vec2 vxz = normalize(vWorld.xz - uCamPos.xz + vec2(0.0001));
  float along = dot(vxz, vNap) * 0.5 + 0.5;      // 1=顺着毛看
  float napTone = mix(1.0 - uNapContrast, 1.0 + uNapContrast, along);
  napTone = mix(1.0, napTone, vPile);            // 圈绒无倒顺

  vec3 L = normalize(uLightDir);
  float diff = max(dot(N, L), 0.0);
  vec3 H = normalize(L + V);
  vec4 mp = matId == 0 ? uMatParams[0] : (matId == 1 ? uMatParams[1] : uMatParams[2]);
  // Kajiya-Kay 各向异性高光
  float sinTH = sqrt(max(0.0, 1.0 - dot(T, H) * dot(T, H)));
  float spec = pow(sinTH, mp.x) * mp.y;
  // 丝的光泽:宽而柔的 view 相关 sheen
  float sheen = pow(1.0 - max(dot(N, V), 0.0), 2.5) * mp.z;

  vec3 col = base * (uAmbient + uLightColor * diff) * ao * napTone;
  col += uLightColor * (spec + sheen * base * 2.0) * ao;
  col *= 1.0 - vPressure * 0.22;                  // 脚印处略暗
  fragColor = vec4(col, alpha);
}`;

const FUR_FS = (defines: string) => `#version 300 es\n${defines}\n${FUR_FS_BODY}`;

export interface RugTextures {
  height: WebGLTexture;
  region: WebGLTexture;
  nap: WebGLTexture;
  pattern: WebGLTexture;
}

export interface FurUniforms {
  proj: Mat4;
  view: Mat4;
  camPos: [number, number, number];
  lightDir: [number, number, number];
  lightColor: [number, number, number];
  ambient: [number, number, number];
  maxHeight: number;      // 米
  rugW: number;           // 米
  rugH: number;
  tuftsPerMeter: number;
  napContrast: number;
  shellCount: number;
  shape: 'rect' | 'round' | 'oval';
}

// 材质参数: x 高光锐度 y 高光强度 z 丝光
const MAT_PARAMS: Record<number, number[]> = {
  0: [60, 0.10, 0.25],   // 羊毛:弱高光,轻微边缘绒光
  1: [10, 0.55, 0.85],   // 真丝:宽柔高光,强 sheen
  2: [38, 0.30, 0.10],   // 化纤:较锐高光
};

export class RugRenderer {
  private gl: WebGL2RenderingContext;
  private progCut: WebGLProgram;
  private progCutRound: WebGLProgram;
  private progSkirt: WebGLProgram;
  private u: Record<string, Record<string, WebGLUniformLocation | null>>;
  private gridVAO: WebGLVertexArrayObject;
  private gridCount = 0;
  private skirtVAO: WebGLVertexArrayObject;
  private skirtCount = 0;
  private furNoise: WebGLTexture;
  private loopNoise: WebGLTexture;
  private shape: 'rect' | 'round' | 'oval' = 'rect';

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    const UN = [
      'uProj', 'uView', 'uShellT', 'uHeightTex', 'uRegionTex', 'uNapTex', 'uPatternTex',
      'uFurNoise', 'uLoopNoise', 'uMaxHeight', 'uNoiseScale', 'uCamPos', 'uLightDir',
      'uLightColor', 'uAmbient', 'uShellCount', 'uMatParams', 'uNapContrast', 'uSkirt',
    ] as const;
    this.progCut = createProgram(gl, RUG_VS, FUR_FS(''));
    this.progCutRound = createProgram(gl, RUG_VS, FUR_FS('#define SHAPE_ROUND'));
    this.progSkirt = createProgram(gl, SKIRT_VS, FUR_FS('#define IS_SKIRT'));
    // 调试:直接显示密度
    if (new URLSearchParams(location.search).has('debugDensity')) {
      this.progCut = createProgram(gl, RUG_VS, FUR_FS('#define DEBUG_DENSITY'));
    }
    this.u = {
      cut: uniforms(gl, this.progCut, [...UN]),
      round: uniforms(gl, this.progCutRound, [...UN]),
      skirt: uniforms(gl, this.progSkirt, [...UN]),
    };
    this.furNoise = createFurNoiseTexture(gl, 256, true);
    this.loopNoise = createFurNoiseTexture(gl, 256, false);
    this.gridVAO = gl.createVertexArray()!;
    this.skirtVAO = gl.createVertexArray()!;
  }

  /** 重建毯面网格与裙边(尺寸或形状变化时调用) */
  buildMesh(w: number, h: number, shape: 'rect' | 'round' | 'oval', res = 180) {
    const gl = this.gl;
    this.shape = shape;
    // ---- 毯面网格 ----
    const verts: number[] = [];
    const idx: number[] = [];
    for (let j = 0; j <= res; j++) {
      for (let i = 0; i <= res; i++) {
        const u = i / res, v = j / res;
        verts.push((u - 0.5) * w, (v - 0.5) * h, u, v);
      }
    }
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const a = j * (res + 1) + i, b = a + 1, c = a + res + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    gl.bindVertexArray(this.gridVAO);
    const vb = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
    const ib = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(idx), gl.STATIC_DRAW);
    this.gridCount = idx.length;

    // ---- 裙边:周界参数化 ----
    const peri: { x: number; z: number; nx: number; nz: number }[] = [];
    if (shape === 'rect') {
      const seg = Math.max(8, Math.round(res / 2));
      const pushEdge = (x0: number, z0: number, x1: number, z1: number, nx: number, nz: number) => {
        for (let i = 0; i < seg; i++) {
          const t = i / seg;
          peri.push({ x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, nx, nz });
        }
      };
      pushEdge(-w / 2, -h / 2, w / 2, -h / 2, 0, -1);
      pushEdge(w / 2, -h / 2, w / 2, h / 2, 1, 0);
      pushEdge(w / 2, h / 2, -w / 2, h / 2, 0, 1);
      pushEdge(-w / 2, h / 2, -w / 2, -h / 2, -1, 0);
    } else {
      const seg = 160;
      for (let i = 0; i < seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        const x = Math.cos(a) * w / 2, z = Math.sin(a) * h / 2;
        // 椭圆外法线
        const nx = Math.cos(a) / (w / 2), nz = Math.sin(a) / (h / 2);
        const l = Math.hypot(nx, nz) || 1;
        peri.push({ x, z, nx: nx / l, nz: nz / l });
      }
    }
    const sVerts: number[] = [];
    const sIdx: number[] = [];
    const n = peri.length;
    for (let i = 0; i <= n; i++) {
      const p = peri[i % n];
      const u = (p.x / w) + 0.5, v = (p.z / h) + 0.5;
      const s = i / n;
      // 底点与顶点
      sVerts.push(p.x, 0, p.z, p.nx, p.nz, s, 0, u, v);
      sVerts.push(p.x, 0, p.z, p.nx, p.nz, s, 1, u, v);
    }
    for (let i = 0; i < n; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      sIdx.push(a, c, b, b, c, d);
    }
    gl.bindVertexArray(this.skirtVAO);
    const svb = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, svb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(sVerts), gl.STATIC_DRAW);
    const stride = 36;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 20);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 2, gl.FLOAT, false, stride, 28);
    const sib = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, sib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(sIdx), gl.STATIC_DRAW);
    this.skirtCount = sIdx.length;
    gl.bindVertexArray(null);
  }

  private bindCommon(u: Record<string, WebGLUniformLocation | null>, tex: RugTextures, fu: FurUniforms) {
    const gl = this.gl;
    gl.uniformMatrix4fv(u.uProj, false, fu.proj);
    gl.uniformMatrix4fv(u.uView, false, fu.view);
    gl.uniform1f(u.uMaxHeight, fu.maxHeight);
    // 噪声纹理 256 texel = 256 个毛簇,换算成重复次数
    gl.uniform2f(u.uNoiseScale, fu.rugW * fu.tuftsPerMeter / 256, fu.rugH * fu.tuftsPerMeter / 256);
    gl.uniform3fv(u.uCamPos, fu.camPos);
    gl.uniform3fv(u.uLightDir, fu.lightDir);
    gl.uniform3fv(u.uLightColor, fu.lightColor);
    gl.uniform3fv(u.uAmbient, fu.ambient);
    gl.uniform1f(u.uShellCount, fu.shellCount);
    gl.uniform1f(u.uNapContrast, fu.napContrast);
    const mp = [0, 1, 2].flatMap((i) => MAT_PARAMS[i]);
    gl.uniform4fv(u.uMatParams, mp);
    const bind = (unit: number, texture: WebGLTexture, loc: WebGLUniformLocation | null) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(loc, unit);
    };
    bind(0, tex.height, u.uHeightTex);
    bind(1, tex.region, u.uRegionTex);
    bind(2, tex.nap, u.uNapTex);
    bind(3, tex.pattern, u.uPatternTex);
    bind(4, this.furNoise, u.uFurNoise);
    bind(5, this.loopNoise, u.uLoopNoise);
  }

  render(tex: RugTextures, fu: FurUniforms) {
    const gl = this.gl;
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);

    const shells = fu.shellCount;
    // ---- 毯面 ----
    const prog = fu.shape === 'rect' ? 'cut' : 'round';
    gl.useProgram(prog === 'cut' ? this.progCut : this.progCutRound);
    const u = this.u[prog];
    this.bindCommon(u, tex, fu);
    gl.uniform1f(u.uSkirt, 0);
    gl.bindVertexArray(this.gridVAO);
    for (let i = 1; i <= shells; i++) {
      gl.uniform1f(u.uShellT, i / shells);
      gl.drawElements(gl.TRIANGLES, this.gridCount, gl.UNSIGNED_INT, 0);
    }
    // ---- 裙边(层数减半即可) ----
    gl.useProgram(this.progSkirt);
    const us = this.u.skirt;
    this.bindCommon(us, tex, fu);
    gl.uniform1f(us.uSkirt, 1);
    gl.bindVertexArray(this.skirtVAO);
    const skirtShells = Math.max(6, Math.round(shells / 3));
    for (let i = 1; i <= skirtShells; i++) {
      gl.uniform1f(us.uShellT, i / skirtShells);
      gl.drawElements(gl.TRIANGLES, this.skirtCount, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
    gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
  }
}
