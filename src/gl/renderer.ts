// 地毯绒面主渲染器：底层位移网格 + 实例化纤维 + 阴影通道 + 房间
import { mat4, vec3 } from 'gl-matrix';
import type { AppSettings, FiberMaterial, LightPreset, Order, YarnColor } from '../types';
import { createProgram, createTexture, uniformLocations, uploadImage, type GL } from './gl';
import { OrbitCamera } from './camera';
import { baseFrag, baseVert } from './shaders/base';
import { fiberFrag, fiberVert } from './shaders/fiber';
import { floorFrag, roomVert, wallFrag } from './shaders/room';
import { shadowFrag, shadowVert } from './shaders/shadow';

const RIBBON_VERTS = 12; // 3 段 × 4 顶点
const ROOM_HALF = 6;
const WALL_H = 3.2;

const MATERIAL_PARAMS: Record<FiberMaterial, [number, number, number, number]> = {
  // [粗糙度占位, 高光强度, 次表面绒感, 各向异性锐度]
  wool: [0.9, 0.28, 0.55, 0.25],
  silk: [0.25, 0.95, 0.3, 0.9],
  synthetic: [0.45, 0.6, 0.15, 0.6],
};

interface Textures {
  pattern: WebGLTexture;
  height: WebGLTexture;   // R=绒高 G=割圈
  direction: WebGLTexture;
  yarnLut: WebGLTexture;
  shadow: WebGLTexture;
  shadowFbo: WebGLFramebuffer;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class CarpetRenderer {
  gl: GL;
  camera: OrbitCamera;
  private order: Order | null = null;
  private colors: YarnColor[] = [];
  private settings: AppSettings;
  private light: LightPreset;
  private lightDir = vec3.create();

  private baseProg: WebGLProgram;
  private fiberProg: WebGLProgram;
  private roomProg: WebGLProgram;
  private wallProg: WebGLProgram;
  private shadowProg: WebGLProgram;
  private u: Record<string, Record<string, WebGLUniformLocation | null>> = {};

  private baseVao: WebGLVertexArrayObject;
  private baseBuf: WebGLBuffer;
  private baseEbo: WebGLBuffer | null = null;
  private baseVerts = 0;
  private mapW = 512;
  private mapH = 512;
  private fiberVao: WebGLVertexArrayObject;
  private ribbonBuf: WebGLBuffer;
  private originBuf: WebGLBuffer;
  private seedBuf: WebGLBuffer;
  private typeBuf: WebGLBuffer;
  private fiberCount = 0;
  private roomVao: WebGLVertexArrayObject;
  private wallVao: WebGLVertexArrayObject;
  private tex: Textures;
  private shadowSize: number;

  private raf = 0;
  private fps = 0;
  private frames = 0;
  private fpsTime = 0;
  private lastFrameMs = 0;
  private adaptiveScale = 1;       // 运行时自适应倍率（独立于用户设置）
  private adaptiveShadowOff = false;
  onFps?: (fps: number, fibers: number) => void;
  private lightVP = mat4.create();
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, settings: AppSettings, light: LightPreset) {
    const gl = canvas.getContext('webgl2', {
      antialias: true,
      preserveDrawingBuffer: true, // 截图需要
      alpha: false,
    });
    if (!gl) throw new Error('当前浏览器不支持 WebGL2');
    this.gl = gl;
    this.settings = settings;
    this.light = light;
    this.camera = new OrbitCamera(canvas);
    this.shadowSize = settings.shadowSize;

    this.baseProg = createProgram(gl, baseVert, baseFrag);
    this.fiberProg = createProgram(gl, fiberVert, fiberFrag);
    this.roomProg = createProgram(gl, roomVert, floorFrag);
    this.wallProg = createProgram(gl, roomVert, wallFrag);
    this.shadowProg = createProgram(gl, shadowVert, shadowFrag);
    this.u = {
      base: uniformLocations(gl, this.baseProg, [
        'uViewProj', 'uHeightMap', 'uPileHeightM', 'uLoopHeightM', 'uTexel', 'uRugSize',
        'uPattern', 'uYarnLUT', 'uShadowMap', 'uLightVP', 'uLightDir',
        'uAmbient', 'uKeyColor', 'uIntensity', 'uShadowEnabled',
      ]),
      fiber: uniformLocations(gl, this.fiberProg, [
        'uViewProj', 'uHeightMap', 'uDirectionMap', 'uRugSize', 'uPileHeightM',
        'uLoopHeightM', 'uTime', 'uPattern', 'uYarnLUT', 'uShadowMap', 'uLightVP',
        'uLightDir', 'uViewPos', 'uAmbient', 'uKeyColor', 'uIntensity',
        'uShadowEnabled', 'uNapStrength', 'uMaterial',
      ]),
      room: uniformLocations(gl, this.roomProg, [
        'uViewProj', 'uLightDir', 'uAmbient', 'uKeyColor', 'uIntensity',
        'uLightVP', 'uShadowMap', 'uShadowEnabled',
      ]),
      wall: uniformLocations(gl, this.wallProg, [
        'uViewProj', 'uLightDir', 'uAmbient', 'uKeyColor', 'uIntensity', 'uTint',
      ]),
      shadow: uniformLocations(gl, this.shadowProg, ['uLightVP']),
    };

    this.tex = this.createTextures();
    const base = this.createBaseVao();
    this.baseVao = base.vao;
    this.baseBuf = base.buf;
    this.baseEbo = base.ebo;
    const fiber = this.createFiberVao();
    this.fiberVao = fiber.vao;
    this.ribbonBuf = fiber.ribbon; this.originBuf = fiber.origin;
    this.seedBuf = fiber.seed; this.typeBuf = fiber.type;
    this.roomVao = this.createFloorVao();
    this.wallVao = this.createWallVao();

    gl.enable(gl.DEPTH_TEST);
    // 纤维是双面丝带（扭转后正反交替可见），不能背面剔除
    gl.disable(gl.CULL_FACE);
    gl.clearColor(0.93, 0.93, 0.94, 1);

    this.applyLight(light);
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  // ---------------- 纹理 ----------------
  private createTextures(): Textures {
    const gl = this.gl;
    const pattern = createTexture(gl, 0);
    const height = createTexture(gl, 1);
    const direction = createTexture(gl, 2);
    const yarnLut = createTexture(gl, 3, { wrap: gl.CLAMP_TO_EDGE });
    const shadow = createTexture(gl, 4, { filter: gl.NEAREST });
    gl.bindTexture(gl.TEXTURE_2D, shadow);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, this.shadowSize, this.shadowSize,
      0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    const shadowFbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shadow, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { pattern, height, direction, yarnLut, shadow, shadowFbo };
  }

  private uploadLut(colors: YarnColor[]): void {
    const gl = this.gl;
    const data = new Uint8Array(256 * 4);
    colors.forEach((c, i) => {
      data[i * 4] = c.rgb[0]; data[i * 4 + 1] = c.rgb[1];
      data[i * 4 + 2] = c.rgb[2]; data[i * 4 + 3] = 255;
    });
    gl.activeTexture(gl.TEXTURE0 + 3);
    gl.bindTexture(gl.TEXTURE_2D, this.tex.yarnLut);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    // LUT 必须线性格式：它是颜色数据表，由片元着色器自行处理颜色空间
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  }

  private uploadNoFlip(tex: WebGLTexture, source: TexImageSource, srgb = false): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8,
      gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  /** 把绒高图（R）与割/圈图（R）合成 RG 纹理 */
  private async uploadHeightType(order: Order): Promise<void> {
    const [hImg, tImg] = await Promise.all([
      loadImageEl(order.heightMap), loadImageEl(order.typeMap),
    ]);
    const w = hImg.naturalWidth, h = hImg.naturalHeight;
    this.mapW = w; this.mapH = h;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(hImg, 0, 0);
    const hd = ctx.getImageData(0, 0, w, h);
    const tc2 = document.createElement('canvas');
    tc2.width = w; tc2.height = h;
    const tctx = tc2.getContext('2d', { willReadFrequently: true })!;
    tctx.drawImage(tImg, 0, 0);
    const td = tctx.getImageData(0, 0, w, h);
    for (let i = 0; i < w * h; i++) {
      hd.data[i * 4 + 1] = td.data[i * 4]; // G = 割/圈
      hd.data[i * 4 + 2] = 0;
      hd.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(hd, 0, 0);
    this.uploadNoFlip(this.tex.height, c);
  }

  // ---------------- 几何 ----------------
  private createBaseVao(): { vao: WebGLVertexArrayObject; buf: WebGLBuffer; ebo: WebGLBuffer } {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
    // EBO 必须在 VAO 创建时就绑定，否则后续 drawElements 报 GL_INVALID_OPERATION
    const ebo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
    gl.bindVertexArray(null);
    return { vao, buf, ebo };
  }

  private rebuildBaseMesh(order: Order): void {
    const gl = this.gl;
    const nx = this.settings.baseSegmentsX;
    const ny = this.settings.baseSegmentsY;
    const hw = order.widthM / 2, hd = order.depthM / 2;
    const verts: number[] = [];
    for (let iy = 0; iy <= ny; iy++) {
      for (let ix = 0; ix <= nx; ix++) {
        const u = ix / nx, v = iy / ny;
        // 无 flipY：纹理 v=0 在底部，世界 y=-hd 对应 v=0
        verts.push((u - 0.5) * order.widthM, (v - 0.5) * order.depthM, 0, u, v);
      }
    }
    const idx: number[] = [];
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const a = iy * (nx + 1) + ix, b = a + 1, c = a + nx + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const vData = new Float32Array(verts);
    const iData = new Uint32Array(idx);
    gl.bindVertexArray(this.baseVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.baseBuf);
    gl.bufferData(gl.ARRAY_BUFFER, vData, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.baseEbo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, iData, gl.STATIC_DRAW);
    this.baseVerts = idx.length;
    gl.bindVertexArray(null);
  }

  private createFiberVao() {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    // 丝带模板（静态）
    const ribbon: number[] = [];
    for (let seg = 0; seg < 3; seg++) {
      const t0 = seg / 3, t1 = (seg + 1) / 3;
      const w0 = 1 - t0 * 0.92, w1 = 1 - t1 * 0.92;
      const quad = [
        [t0, 0, w0], [t0, Math.PI, w0], [t1, 0, w1],
        [t1, 0, w1], [t0, Math.PI, w0], [t1, Math.PI, w1],
      ];
      for (const q of quad) ribbon.push(q[0], q[1], q[2]);
    }
    const ribbonBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, ribbonBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(ribbon), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);

    const originBuf = gl.createBuffer()!;
    const seedBuf = gl.createBuffer()!;
    const typeBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, originBuf);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 12, 0);
    gl.vertexAttribDivisor(2, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, seedBuf);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 16, 0);
    gl.vertexAttribDivisor(3, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, typeBuf);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, 4, 0);
    gl.vertexAttribDivisor(4, 1);
    gl.bindVertexArray(null);
    return { vao, ribbon: ribbonBuf, origin: originBuf, seed: seedBuf, type: typeBuf };
  }

  /** 按密度在毯面 jitter grid 布纤维；种子全部确定性生成，视角变化不闪烁 */
  rebuildFibers(order: Order, extraScale = 1): void {
    const gl = this.gl;
    const areaCm2 = order.widthM * order.depthM * 10000;
    let target = Math.round(areaCm2 * order.pile.density * this.settings.fiberScale * extraScale);
    target = Math.min(target, this.settings.maxFiberInstances);
    // 网格单元数略大于目标数，保证铺满
    const cols = Math.ceil(Math.sqrt(target * order.widthM / order.depthM));
    const rows = Math.ceil(target / cols);
    const rng = mulberry32(hashStr(order.id) + Math.round(order.widthM * 1000));
    const origins = new Float32Array(cols * rows * 3);
    const seeds = new Float32Array(cols * rows * 4);
    const types = new Float32Array(cols * rows);
    let n = 0;
    const dx = order.widthM / cols, dy = order.depthM / rows;
    for (let iy = 0; iy < rows; iy++) {
      for (let ix = 0; ix < cols; ix++) {
        if (n >= target) break;
        const jx = (rng() - 0.5) * dx * 0.9;
        const jy = (rng() - 0.5) * dy * 0.9;
        origins[n * 3] = -order.widthM / 2 + (ix + 0.5) * dx + jx;
        origins[n * 3 + 1] = -order.depthM / 2 + (iy + 0.5) * dy + jy;
        origins[n * 3 + 2] = 0;
        const s = rng() * 1000;
        seeds[n * 4] = rng() - 0.5;
        seeds[n * 4 + 1] = rng() - 0.5;
        seeds[n * 4 + 2] = rng() - 0.5;
        seeds[n * 4 + 3] = s;
        types[n] = rng() < order.pile.cutRatio ? 1 : 0;
        n++;
      }
    }
    gl.bindVertexArray(this.fiberVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.originBuf);
    gl.bufferData(gl.ARRAY_BUFFER, origins.subarray(0, n * 3), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.seedBuf);
    gl.bufferData(gl.ARRAY_BUFFER, seeds.subarray(0, n * 4), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.typeBuf);
    gl.bufferData(gl.ARRAY_BUFFER, types.subarray(0, n), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.fiberCount = n;
  }

  private createFloorVao(): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const s = ROOM_HALF;
    const v = new Float32Array([
      -s, -s, -0.012, 0, 0, s, -s, -0.012, 1, 0, s, s, -0.012, 1, 1,
      -s, -s, -0.012, 0, 0, s, s, -0.012, 1, 1, -s, s, -0.012, 0, 1,
    ]);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
    gl.bindVertexArray(null);
    return vao;
  }

  private createWallVao(): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const s = ROOM_HALF, h = WALL_H;
    // 两面墙：北墙(y=+s) 与西墙(x=-s)
    const v = new Float32Array([
      -s, s, 0, 0, 0, s, s, 0, 1, 0, s, s, h, 1, 1,
      -s, s, 0, 0, 0, s, s, h, 1, 1, -s, s, h, 0, 1,
      -s, -s, 0, 0, 0, -s, s, 0, 1, 0, -s, s, h, 1, 1,
      -s, -s, 0, 0, 0, -s, s, h, 1, 1, -s, -s, h, 0, 1,
    ]);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
    gl.bindVertexArray(null);
    return vao;
  }

  // ---------------- 对外同步 ----------------
  async syncOrder(order: Order, colors: YarnColor[], rebuildGeometry = false): Promise<void> {
    this.order = order;
    this.colors = colors;
    this.uploadLut(colors);
    if (order.quantizedImage) {
      // 量化图存的是纱线索引（数据），必须用线性 RGBA，不能用 sRGB 自动解码
      this.uploadNoFlip(this.tex.pattern, await loadImageEl(order.quantizedImage), false);
    } else {
      this.uploadNoFlip(this.tex.pattern, blankCanvas(64, [200, 200, 200]), false);
    }
    await this.uploadHeightType(order);
    this.uploadNoFlip(this.tex.direction, await loadImageEl(order.directionMap));
    if (rebuildGeometry) {
      this.rebuildBaseMesh(order);
      this.rebuildFibers(order);
      this.camera.frameRug(order.widthM, order.depthM);
    }
  }

  /** 只更新工艺纹理（笔刷绘制后调用，开销小） */
  async refreshMaps(mask: { height?: boolean; direction?: boolean } = {}): Promise<void> {
    if (!this.order) return;
    if (mask.height !== false) await this.uploadHeightType(this.order);
    if (mask.direction) this.uploadNoFlip(this.tex.direction, await loadImageEl(this.order.directionMap));
  }

  refreshPattern(): Promise<void> {
    if (!this.order?.quantizedImage) return Promise.resolve();
    return loadImageEl(this.order.quantizedImage).then((img) =>
      this.uploadNoFlip(this.tex.pattern, img, false));
  }

  updateSettings(settings: AppSettings): void {
    const geomDirty = settings.baseSegmentsX !== this.settings.baseSegmentsX
      || settings.baseSegmentsY !== this.settings.baseSegmentsY
      || settings.fiberScale !== this.settings.fiberScale
      || settings.maxFiberInstances !== this.settings.maxFiberInstances;
    this.settings = settings;
    if (geomDirty && this.order) {
      this.rebuildBaseMesh(this.order);
      this.rebuildFibers(this.order);
    }
  }

  applyLight(light: LightPreset): void {
    this.light = light;
    const az = (light.azimuth * Math.PI) / 180;
    const el = (light.elevation * Math.PI) / 180;
    vec3.set(this.lightDir,
      -Math.cos(el) * Math.cos(az),
      -Math.cos(el) * Math.sin(az),
      -Math.sin(el));
    // 阴影正交范围覆盖房间
    const proj = mat4.create();
    mat4.ortho(proj, -ROOM_HALF, ROOM_HALF, -ROOM_HALF, ROOM_HALF, 0.1, 25);
    const eye = vec3.scale(vec3.create(), this.lightDir, -9);
    const view = mat4.create();
    mat4.lookAt(view, eye, [0, 0, 0], [0, 0, 1]);
    mat4.multiply(this.lightVP, proj, view);
  }

  // ---------------- 渲染循环 ----------------
  private resize(): void {
    const canvas = this.gl.canvas as HTMLCanvasElement;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
    }
  }

  private loop(now: number): void {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    // 首两帧只计时不做降级判断，等待资源上传完成
    const frameMs = this.lastFrameMs ? now - this.lastFrameMs : 16;
    this.lastFrameMs = now;
    this.resize();
    this.camera.update();
    const gl = this.gl;
    const aspect = gl.canvas.width / gl.canvas.height;
    const proj = this.camera.projMatrix(aspect);
    const view = this.camera.viewMatrix();
    const vp = mat4.multiply(mat4.create(), proj, view);
    const viewPos = this.camera.position();

    if (this.settings.shadowEnabled && !this.adaptiveShadowOff) this.renderShadow();
    this.renderMain(vp, viewPos);

    this.frames++;
    // 帧间隔过大立即降载（不等 1 秒窗口，慢帧下也能快速收敛）
    if (frameMs > 55 && this.order) this.adaptQuality(frameMs);
    if (now - this.fpsTime >= 1000) {
      this.fps = Math.round((this.frames * 1000) / (now - this.fpsTime));
      this.fpsTime = now; this.frames = 0;
      this.onFps?.(this.fps, this.fiberCount);
    }
  }

  /** 软件渲染/低端显卡自动降载：先减纤维，再关阴影，保证可交互 */
  private lastAdapt = 0;
  private adaptQuality(frameMs: number): void {
    if (!this.order) return;
    const now = performance.now();
    if (now - this.lastAdapt < 700) return; // 给 GPU 缓冲上传留时间
    this.lastAdapt = now;
    if (!this.adaptiveShadowOff && this.settings.shadowEnabled && this.adaptiveScale <= 0.12) {
      // 纤维已经很少还慢：先关阴影（阴影通道开销最大）
      this.adaptiveShadowOff = true;
      return;
    }
    if (this.adaptiveScale > 0.008) {
      this.adaptiveScale = Math.max(0.008, this.adaptiveScale * 0.5);
      this.rebuildFibers(this.order, this.adaptiveScale);
    }
  }

  private renderShadow(): void {
    const gl = this.gl;
    if (this.adaptiveShadowOff) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.tex.shadowFbo);
    gl.viewport(0, 0, this.shadowSize, this.shadowSize);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.colorMask(false, false, false, false);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(this.shadowProg);
    gl.uniformMatrix4fv(this.u.shadow.uLightVP, false, this.lightVP);

    gl.bindVertexArray(this.baseVao);
    gl.drawElements(gl.TRIANGLES, this.baseVerts, gl.UNSIGNED_INT, 0);
    if (this.fiberCount > 0) {
      gl.bindVertexArray(this.fiberVao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, RIBBON_VERTS, this.fiberCount);
    }
    gl.colorMask(true, true, true, true);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private setCommon(u: Record<string, WebGLUniformLocation | null>, vp: mat4): void {
    const gl = this.gl;
    gl.uniformMatrix4fv(u.uViewProj, false, vp);
    gl.uniformMatrix4fv(u.uLightVP, false, this.lightVP);
    gl.uniform3fv(u.uLightDir, this.lightDir);
    gl.uniform3fv(u.uAmbient, this.light.ambient);
    gl.uniform3fv(u.uKeyColor, this.light.keyColor);
    gl.uniform1f(u.uIntensity, this.light.intensity);
    gl.uniform1f(u.uShadowEnabled, (this.settings.shadowEnabled && !this.adaptiveShadowOff) ? 1 : 0);
  }

  private renderMain(vp: mat4, viewPos: vec3): void {
    const gl = this.gl;
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const order = this.order;

    // 地板
    gl.useProgram(this.roomProg);
    this.setCommon(this.u.room, vp);
    gl.activeTexture(gl.TEXTURE0 + 4);
    gl.bindTexture(gl.TEXTURE_2D, this.tex.shadow);
    gl.uniform1i(this.u.room.uShadowMap, 4);
    gl.bindVertexArray(this.roomVao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // 墙
    gl.useProgram(this.wallProg);
    gl.uniformMatrix4fv(this.u.wall.uViewProj, false, vp);
    gl.uniform3fv(this.u.wall.uLightDir, this.lightDir);
    gl.uniform3fv(this.u.wall.uAmbient, this.light.ambient);
    gl.uniform3fv(this.u.wall.uKeyColor, this.light.keyColor);
    gl.uniform1f(this.u.wall.uIntensity, this.light.intensity);
    gl.uniform3f(this.u.wall.uTint, 0.86, 0.84, 0.8);
    gl.bindVertexArray(this.wallVao);
    gl.drawArrays(gl.TRIANGLES, 0, 12);

    if (!order) return;

    // 地毯底层
    gl.useProgram(this.baseProg);
    this.setCommon(this.u.base, vp);
    gl.activeTexture(gl.TEXTURE0 + 0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex.pattern);
    gl.uniform1i(this.u.base.uPattern, 0);
    gl.activeTexture(gl.TEXTURE0 + 1);
    gl.bindTexture(gl.TEXTURE_2D, this.tex.height);
    gl.uniform1i(this.u.base.uHeightMap, 1);
    gl.activeTexture(gl.TEXTURE0 + 3);
    gl.bindTexture(gl.TEXTURE_2D, this.tex.yarnLut);
    gl.uniform1i(this.u.base.uYarnLUT, 3);
    gl.activeTexture(gl.TEXTURE0 + 4);
    gl.bindTexture(gl.TEXTURE_2D, this.tex.shadow);
    gl.uniform1i(this.u.base.uShadowMap, 4);
    gl.uniform1f(this.u.base.uPileHeightM, order.pile.pileHeight / 1000);
    gl.uniform1f(this.u.base.uLoopHeightM, order.pile.loopHeight / 1000);
    gl.uniform2f(this.u.base.uTexel, 1 / this.mapW, 1 / this.mapH);
    gl.uniform2f(this.u.base.uRugSize, order.widthM, order.depthM);
    gl.bindVertexArray(this.baseVao);
    gl.drawElements(gl.TRIANGLES, this.baseVerts, gl.UNSIGNED_INT, 0);

    // 纤维
    if (this.fiberCount > 0) {
      gl.useProgram(this.fiberProg);
      this.setCommon(this.u.fiber, vp);
      gl.uniform3fv(this.u.fiber.uViewPos, viewPos);
      gl.uniform1f(this.u.fiber.uNapStrength, order.pile.napStrength);
      gl.uniform4fv(this.u.fiber.uMaterial, MATERIAL_PARAMS[order.pile.material]);
      gl.uniform1f(this.u.fiber.uPileHeightM, order.pile.pileHeight / 1000);
      gl.uniform1f(this.u.fiber.uLoopHeightM, order.pile.loopHeight / 1000);
      gl.uniform2f(this.u.fiber.uRugSize, order.widthM, order.depthM);
      gl.uniform1f(this.u.fiber.uTime, performance.now() / 1000);
      gl.activeTexture(gl.TEXTURE0 + 0);
      gl.bindTexture(gl.TEXTURE_2D, this.tex.pattern);
      gl.uniform1i(this.u.fiber.uPattern, 0);
      gl.activeTexture(gl.TEXTURE0 + 1);
      gl.bindTexture(gl.TEXTURE_2D, this.tex.height);
      gl.uniform1i(this.u.fiber.uHeightMap, 1);
      gl.activeTexture(gl.TEXTURE0 + 2);
      gl.bindTexture(gl.TEXTURE_2D, this.tex.direction);
      gl.uniform1i(this.u.fiber.uDirectionMap, 2);
      gl.activeTexture(gl.TEXTURE0 + 3);
      gl.bindTexture(gl.TEXTURE_2D, this.tex.yarnLut);
      gl.uniform1i(this.u.fiber.uYarnLUT, 3);
      gl.activeTexture(gl.TEXTURE0 + 4);
      gl.bindTexture(gl.TEXTURE_2D, this.tex.shadow);
      gl.uniform1i(this.u.fiber.uShadowMap, 4);
      gl.bindVertexArray(this.fiberVao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, RIBBON_VERTS, this.fiberCount);
    }
    gl.bindVertexArray(null);
  }

  screenshot(): string {
    const c = this.gl.canvas as HTMLCanvasElement;
    return c.toDataURL('image/png');
  }

  getFps(): number { return this.fps; }
  getFiberCount(): number { return this.fiberCount; }
  /** 调试用内部状态 */
  get debugState() {
    return {
      adaptiveScale: this.adaptiveScale,
      adaptiveShadowOff: this.adaptiveShadowOff,
      fiberCount: this.fiberCount,
      fps: this.fps,
      lastAdapt: this.lastAdapt,
      lastFrameMs: this.lastFrameMs,
    };
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.camera.dispose();
    const gl = this.gl;
    [this.baseProg, this.fiberProg, this.roomProg, this.wallProg, this.shadowProg]
      .forEach((p) => gl.deleteProgram(p));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

function blankCanvas(size: number, rgb: [number, number, number]): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  ctx.fillRect(0, 0, size, size);
  return c;
}

function loadImageEl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
