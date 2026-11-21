// WebGL2 渲染引擎：高度场曲面 + 壳层绒头 + 边缘鳍片 + 背面结点 + 地面/墙面
import { mat4LookAt, mat4Multiply, mat4Perspective, mat4RotateX, mat4Identity, clamp } from '../core/math';
import type { PaletteColor, PreviewSpec, YarnType } from '../core/types';
import {
  BACK_FS, BACK_VS, BASE_FS, BASE_VS, FIN_FS, FIN_VS, FLOOR_FS, FLOOR_VS, SHELL_FS, SHELL_VS,
} from './shaders';

export interface RugRenderData {
  cols: number;
  rows: number;
  pitchX: number;
  pitchY: number;
  knots: Uint16Array;
  heights: Float32Array;
  palette: PaletteColor[];
}

interface Program {
  prog: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
  attribs: Record<string, number>;
}

const yarnMaterial: Record<YarnType, number> = { wool: 0, silk: 1, woolSilk: 2 };

export class RugRenderer {
  private gl: WebGL2RenderingContext;
  private programs: Record<string, Program> = {};
  private knotTex!: WebGLTexture;
  private heightTex!: WebGLTexture;
  private paletteTex!: WebGLTexture;
  private vao: WebGLVertexArrayObject | null = null;
  private vertexCount = 0;
  private finVao: WebGLVertexArrayObject | null = null;
  private finInstanceCount = 0;
  private floorVao: WebGLVertexArrayObject | null = null;
  private data: RugRenderData | null = null;

  // 轨道相机
  azimuth = 0.6;
  elevation = 0.55;
  distance = 1400;
  target = [0, 0, 0] as [number, number, number];
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  spec: PreviewSpec;
  fps = 60;
  private frameTimes: number[] = [];
  private raf = 0;
  private running = false;
  private disposed = false;

  constructor(private canvas: HTMLCanvasElement, spec: PreviewSpec) {
    const gl = canvas.getContext('webgl2', {
      antialias: true, alpha: false, premultipliedAlpha: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('当前浏览器不支持 WebGL2');
    this.gl = gl;
    this.spec = spec;
    this.programs.shell = this.buildProgram(SHELL_VS, SHELL_FS, ['aPos']);
    this.programs.fin = this.buildProgram(FIN_VS, FIN_FS, ['aCorner', 'iEdgePos', 'iEdgeAxis', 'iRnd']);
    this.programs.base = this.buildProgram(BASE_VS, BASE_FS, ['aPos']);
    this.programs.back = this.buildProgram(BACK_VS, BACK_FS, ['aPos']);
    this.programs.floor = this.buildProgram(FLOOR_VS, FLOOR_FS, ['aPos']);
    gl.getExtension('EXT_color_buffer_float');
    this.bindCamera();
  }

  private compile(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error('着色器编译失败: ' + log);
    }
    return sh;
  }

  private buildProgram(vsSrc: string, fsSrc: string, attribNames: string[]): Program {
    const gl = this.gl;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, this.compile(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(prog, this.compile(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('着色器链接失败: ' + gl.getProgramInfoLog(prog));
    }
    const uniforms: Record<string, WebGLUniformLocation | null> = {};
    const count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(prog, i)!;
      uniforms[info.name.replace('[0]', '')] = gl.getUniformLocation(prog, info.name);
    }
    const attribs: Record<string, number> = {};
    attribNames.forEach((n) => (attribs[n] = gl.getAttribLocation(prog, n)));
    return { prog, uniforms, attribs };
  }

  // ---------- 数据上传 ----------
  setData(data: RugRenderData): void {
    this.data = data;
    const gl = this.gl;
    this.uploadKnotTexture(data);
    this.uploadHeightTexture(data);
    this.uploadPaletteTexture(data.palette);
    this.buildRugMesh(data);
    this.buildFinMesh(data);
    this.buildFloorMesh(data);
  }

  updateHeights(heights: Float32Array): void {
    if (!this.data) return;
    this.data.heights = heights;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.heightTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, this.data.cols, this.data.rows, 0, gl.RED, gl.HALF_FLOAT, heights);
  }

  updatePalette(palette: PaletteColor[]): void {
    if (this.data) this.data.palette = palette;
    this.uploadPaletteTexture(palette);
  }

  private uploadKnotTexture(data: RugRenderData): void {
    const gl = this.gl;
    this.knotTex ??= gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.knotTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16UI, data.cols, data.rows, 0, gl.RED_INTEGER, gl.UNSIGNED_SHORT, data.knots);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private uploadHeightTexture(data: RugRenderData): void {
    const gl = this.gl;
    this.heightTex ??= gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.heightTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, data.cols, data.rows, 0, gl.RED, gl.HALF_FLOAT, data.heights);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private uploadPaletteTexture(palette: PaletteColor[]): void {
    const gl = this.gl;
    this.paletteTex ??= gl.createTexture();
    const n = Math.max(1, palette.length);
    const rgba = new Uint8Array(n * 4);
    palette.forEach((c, i) => {
      // 直接存 sRGB 编码值；片元着色器光照后做一次性 sRGB 转换，避免双重提亮
      rgba[i * 4] = c.r;
      rgba[i * 4 + 1] = c.g;
      rgba[i * 4 + 2] = c.b;
      rgba[i * 4 + 3] = Math.round((yarnMaterial[c.yarn] / 2) * 255);
    });
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, n, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  }

  /**
   * 渲染网格：分辨率封顶（长边 maxMeshSide 段），物理尺寸不变。
   * 结级颜色/绒高/纤维全部走全分辨率纹理在片元着色器里采样，
   * 因此降网格只省三角形、不丢结图细节；沟槽起伏由高度纹理法线还原。
   */
  private buildRugMesh(data: RugRenderData): void {
    const gl = this.gl;
    const { cols, rows, pitchX, pitchY } = data;
    const w = cols * pitchX, h = rows * pitchY;
    const maxMeshSide = 260;
    const scale = Math.min(1, maxMeshSide / Math.max(cols, rows));
    const gx = Math.max(8, Math.round(cols * scale));
    const gy = Math.max(8, Math.round(rows * scale));
    const stepX = w / gx;
    const stepY = h / gy;
    const positions = new Float32Array((gx + 1) * (gy + 1) * 2);
    let p = 0;
    for (let y = 0; y <= gy; y++) {
      for (let x = 0; x <= gx; x++) {
        positions[p++] = x * stepX - w / 2;
        positions[p++] = h / 2 - y * stepY;
      }
    }
    const indices = new Uint32Array(gx * gy * 6);
    let k = 0;
    for (let y = 0; y < gy; y++) {
      for (let x = 0; x < gx; x++) {
        const a = y * (gx + 1) + x;
        indices[k++] = a; indices[k++] = a + 1; indices[k++] = a + gx + 1;
        indices[k++] = a + 1; indices[k++] = a + gx + 2; indices[k++] = a + gx + 1;
      }
    }
    this.vertexCount = indices.length;
    this.vao ??= gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const posLoc = this.programs.shell.attribs.aPos;
    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    const idxBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
  }

  /** 边缘鳍片（实例化）：毯四条外缘每结一个实例，每实例 4 顶点四边形，一次 draw call */
  private buildFinMesh(data: RugRenderData): void {
    const gl = this.gl;
    const { cols, rows, pitchX, pitchY } = data;
    const w = cols * pitchX, h = rows * pitchY;
    let rndSeed = 13;
    const rnd = () => {
      rndSeed = (Math.imul(rndSeed, 1664525) + 1013904223) | 0;
      return ((rndSeed >>> 0) % 1000) / 1000;
    };
    const edgeCount = cols * 2 + rows * 2;
    this.finInstanceCount = edgeCount;
    // 实例属性：x, y, axis, rnd
    const inst = new Float32Array(edgeCount * 4);
    let v = 0;
    for (let x = 0; x < cols; x++) {
      const cx = (x + 0.5) * pitchX - w / 2;
      inst[v++] = cx; inst[v++] = h / 2; inst[v++] = 1; inst[v++] = rnd();
      inst[v++] = cx; inst[v++] = -h / 2; inst[v++] = 1; inst[v++] = rnd();
    }
    for (let y = 0; y < rows; y++) {
      const cy = h / 2 - (y + 0.5) * pitchY;
      inst[v++] = -w / 2; inst[v++] = cy; inst[v++] = 0; inst[v++] = rnd();
      inst[v++] = w / 2; inst[v++] = cy; inst[v++] = 0; inst[v++] = rnd();
    }
    // 四顶点模板：底左、底右、尖右、尖左（TRIANGLE_FAN）
    const corners = new Float32Array([
      -1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0,
    ]);

    this.finVao ??= gl.createVertexArray();
    gl.bindVertexArray(this.finVao);
    const finProg = this.programs.fin;
    const locCorner = finProg.attribs.aCorner;
    const locPos = finProg.attribs.iEdgePos;
    const locAxis = finProg.attribs.iEdgeAxis;
    const locRnd = finProg.attribs.iRnd;
    const cornerBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
    gl.bufferData(gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(locCorner);
    gl.vertexAttribPointer(locCorner, 3, gl.FLOAT, false, 0, 0);

    const instBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, inst, gl.STATIC_DRAW);
    const stride = 4 * 4;
    gl.enableVertexAttribArray(locPos);
    gl.vertexAttribPointer(locPos, 2, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(locPos, 1);
    gl.enableVertexAttribArray(locAxis);
    gl.vertexAttribPointer(locAxis, 1, gl.FLOAT, false, stride, 2 * 4);
    gl.vertexAttribDivisor(locAxis, 1);
    gl.enableVertexAttribArray(locRnd);
    gl.vertexAttribPointer(locRnd, 1, gl.FLOAT, false, stride, 3 * 4);
    gl.vertexAttribDivisor(locRnd, 1);
    gl.bindVertexArray(null);
  }

  private buildFloorMesh(data: RugRenderData): void {
    const gl = this.gl;
    const w = data.cols * data.pitchX * 2.2;
    const h = data.rows * data.pitchY * 2.2;
    // z 由 floorModelMatrix 统一处理（平铺下沉/挂墙立起后退）
    const verts = new Float32Array([
      -w, -h, 0, w, -h, 0, w, h, 0,
      -w, -h, 0, w, h, 0, -w, h, 0,
    ]);
    this.floorVao ??= gl.createVertexArray();
    gl.bindVertexArray(this.floorVao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    const loc = this.programs.floor.attribs.aPos;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  // ---------- 相机交互 ----------
  private bindCamera(): void {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.azimuth -= dx * 0.008;
      this.elevation = clamp(this.elevation + dy * 0.006, -1.45, 1.52);
    });
    const end = () => (this.dragging = false);
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.distance = clamp(this.distance * (1 + Math.sign(e.deltaY) * 0.08), 120, 6000);
    }, { passive: false });
  }

  resetView(): void {
    this.azimuth = 0.6;
    this.elevation = 0.55;
    if (this.data) {
      this.distance = Math.max(this.data.cols * this.data.pitchX, this.data.rows * this.data.pitchY) * 1.15;
    }
  }

  /** 挂墙：毯绕 x 轴立起 90°，绒面朝向 +z；平铺：单位矩阵 */
  private modelMatrix(): Float32Array {
    if (this.spec.scene === 'wall') {
      return mat4RotateX(-Math.PI / 2);
    }
    return mat4Identity();
  }

  /** 墙面模型：地面绕 x 立起并向后平移，避免与毯共面闪烁 */
  private floorModelMatrix(): Float32Array {
    if (this.spec.scene === 'wall') {
      const m = mat4RotateX(-Math.PI / 2);
      // 立起后沿 -y（即世界 -z 方向）后退 3mm
      m[13] = -3;
      return m;
    }
    const m = mat4Identity();
    m[14] = -2.5;
    return m;
  }

  private eyePosition(): [number, number, number] {
    const ce = Math.cos(this.elevation);
    return [
      this.target[0] + this.distance * ce * Math.cos(this.azimuth),
      this.target[1] + this.distance * ce * Math.sin(this.azimuth),
      this.target[2] + this.distance * Math.sin(this.elevation),
    ];
  }

  // ---------- 渲染循环 ----------
  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = (t: number) => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      this.render(t);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private setCommonUniforms(p: Program, viewProj: Float32Array, eye: [number, number, number]): void {
    const gl = this.gl;
    const d = this.data!;
    const u = p.uniforms;
    gl.uniformMatrix4fv(u.uViewProj, false, viewProj);
    if (u.uModel) gl.uniformMatrix4fv(u.uModel, false, this.modelMatrix());
    gl.uniform2f(u.uGrid, d.cols, d.rows);
    gl.uniform2f(u.uPitch, d.pitchX, d.pitchY);
    gl.uniform1f(u.uBasePile, this.spec ? 0 : 0);
    gl.uniform1i(u.uKnotTex, 0);
    gl.uniform1i(u.uHeightTex, 1);
    gl.uniform1i(u.uPaletteTex, 2);
    const dye = this.spec.dyeLot;
    gl.uniform4f(u.uDyeLot, dye.bandHeight / Math.max(0.01, d.pitchY), dye.strength, dye.phase, dye.enabled ? 1 : 0);
    if (u.uShowDyeLines) gl.uniform1f(u.uShowDyeLines, this.spec.showDyeLines ? 1 : 0);
    gl.uniform1i(u.uYarn, yarnMaterial[this.spec.yarn]);
    gl.uniform3f(u.uEyePosObj, eye[0], eye[1], eye[2]);
    // 侧光：方位角 + 仰角，物体空间光向
    const az = (this.spec.lightAzimuth * Math.PI) / 180;
    const el = (this.spec.lightElevation * Math.PI) / 180;
    const lx = Math.cos(el) * Math.cos(az), ly = Math.cos(el) * Math.sin(az), lz = Math.sin(el);
    gl.uniform3f(u.uLightDir, lx, ly, lz);
    gl.uniform3f(u.uLightColor, this.spec.lightIntensity, this.spec.lightIntensity, this.spec.lightIntensity);
    gl.uniform1f(u.uAmbient, 0.32);
    gl.uniform1f(u.uTime, performance.now() / 1000);
  }

  private render(t: number): void {
    const gl = this.gl;
    const d = this.data;
    if (!d) return;

    // 帧率统计
    if (this.frameTimes.length) {
      const dt = t - this.frameTimes[this.frameTimes.length - 1];
      if (dt > 0) this.fps = this.fps * 0.92 + (1000 / dt) * 0.08;
    }
    this.frameTimes.push(t);
    if (this.frameTimes.length > 60) this.frameTimes.shift();

    const canvas = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const ch = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.07, 0.075, 0.08, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);

    const aspect = canvas.width / canvas.height;
    const proj = mat4Perspective((40 * Math.PI) / 180, aspect, 1, 20000);
    const eye = this.eyePosition();
    const view = mat4LookAt(eye, this.target, [0, 0, 1]);
    const viewProj = new Float32Array(16);
    mat4Multiply(viewProj, proj, view);

    // 场景：地面（平铺）或墙面（挂墙时地板绕 x 立起）
    this.drawFloor(viewProj);

    if (this.spec.showBack) {
      this.drawBack(viewProj, eye);
      return;
    }

    this.drawBase(viewProj, eye);
    this.drawShells(viewProj, eye);
    this.drawFins(viewProj, eye);
  }

  private bindTextures(): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.knotTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.heightTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);
  }

  private drawFloor(viewProj: Float32Array): void {
    const gl = this.gl;
    const p = this.programs.floor;
    gl.useProgram(p.prog);
    gl.bindVertexArray(this.floorVao);
    gl.uniformMatrix4fv(p.uniforms.uViewProj, false, viewProj);
    if (p.uniforms.uModel) gl.uniformMatrix4fv(p.uniforms.uModel, false, this.floorModelMatrix());
    gl.uniform3f(p.uniforms.uLightDir, 0.3, 0.4, 0.85);
    gl.uniform1f(p.uniforms.uIsWall, this.spec.scene === 'wall' ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /** 翻面时相机转到毯下方；回正面回到斜上方 */
  orientToBack(back: boolean): void {
    this.elevation = back ? -0.6 : 0.55;
    this.azimuth = 0.6;
    this.resetView();
  }

  /** 切换平铺/挂墙时重置相机到合适机位 */
  orientCameraToScene(): void {
    if (this.spec.scene === 'wall') {
      // 墙面机位：从 +z 方向看立起的毯
      this.azimuth = Math.PI / 2;
      this.elevation = 0.05;
    } else {
      this.azimuth = 0.6;
      this.elevation = 0.55;
    }
    this.resetView();
  }

  private drawBase(viewProj: Float32Array, eye: [number, number, number]): void {
    const gl = this.gl;
    const p = this.programs.base;
    gl.useProgram(p.prog);
    gl.bindVertexArray(this.vao);
    this.bindTextures();
    this.setCommonUniforms(p, viewProj, eye);
    gl.drawElements(gl.TRIANGLES, this.vertexCount, gl.UNSIGNED_INT, 0);
  }

  private drawBack(viewProj: Float32Array, eye: [number, number, number]): void {
    const gl = this.gl;
    const p = this.programs.back;
    gl.useProgram(p.prog);
    gl.bindVertexArray(this.vao);
    this.bindTextures();
    this.setCommonUniforms(p, viewProj, eye);
    gl.drawElements(gl.TRIANGLES, this.vertexCount, gl.UNSIGNED_INT, 0);
  }

  private drawShells(viewProj: Float32Array, eye: [number, number, number]): void {
    const gl = this.gl;
    const p = this.programs.shell;
    gl.useProgram(p.prog);
    gl.bindVertexArray(this.vao);
    this.bindTextures();
    this.setCommonUniforms(p, viewProj, eye);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(true);
    const layers = clamp(Math.round(this.spec.shellLayers), 2, 24);
    for (let L = 0; L < layers; L++) {
      gl.uniform1f(p.uniforms.uLayer, L);
      gl.uniform1f(p.uniforms.uLayers, layers);
      gl.drawElements(gl.TRIANGLES, this.vertexCount, gl.UNSIGNED_INT, 0);
    }
    gl.disable(gl.BLEND);
  }

  private drawFins(viewProj: Float32Array, eye: [number, number, number]): void {
    const gl = this.gl;
    const p = this.programs.fin;
    gl.useProgram(p.prog);
    gl.bindVertexArray(this.finVao);
    this.bindTextures();
    this.setCommonUniforms(p, viewProj, eye);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, this.finInstanceCount);
    gl.disable(gl.BLEND);
  }

  screenshot(): string {
    this.render(performance.now());
    return this.canvas.toDataURL('image/png');
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    const gl = this.gl;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
