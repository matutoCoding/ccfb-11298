// 三维预览场景:相机、纹理装配、笔刷交互、渲染循环
import { RugRenderer, RugTextures, FurUniforms } from './rugRenderer';
import { Room, LIGHT_PRESETS } from './room';
import { mat4Perspective, mat4LookAt, normalize3, sub3, cross3, Vec3 } from './mat4';
import { createTexture2D, updateTexture2D } from './glutil';
import { Order, Settings } from '../types';
import { readPixels } from '../quantize';
import { hexToRgb } from '../yarnPalette';
import { store } from '../store';

export type BrushMode = 'orbit' | 'nap' | 'footprint' | 'erase';

const MAP_SIZE = 256;

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

export class PreviewScene {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  private rug: RugRenderer;
  private room: Room;
  private order: Order | null = null;
  private settings: Settings;

  // 相机
  private yaw = 0.6;
  private pitch = 0.9;
  private dist = 3.2;
  private tYaw = 0.6;   // 目标值(阻尼)
  private tPitch = 0.9;
  private tDist = 3.2;
  private target: Vec3 = [0, 0.02, 0];

  // 可编辑画布(笔刷直接画在上面)
  napCanvas: HTMLCanvasElement;
  private heightCanvas: HTMLCanvasElement;
  private regionCanvas: HTMLCanvasElement;
  /** 图案纹理原始数据(直接 texImage2D,避免 canvas 预乘 alpha 吃掉 RGB) */
  private patternData: { w: number; h: number; data: Uint8ClampedArray } | null = null;
  private tex: RugTextures;
  private dirty = true;
  private running = false;
  private saveTimer: number | null = null;
  brush: BrushMode = 'orbit';
  brushSize = 30; // 像素(贴图空间)
  onMapSaved: (() => void) | null = null;
  lightIndex = 0;
  roomVisible = true;
  fps = 0;
  private lastFrame = 0;
  private frameTimes: number[] = [];

  constructor(canvas: HTMLCanvasElement, settings: Settings) {
    this.canvas = canvas;
    this.settings = settings;
    const gl = canvas.getContext('webgl2', {
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('当前浏览器不支持 WebGL2');
    this.gl = gl;
    gl.clearColor(0.13, 0.13, 0.14, 1);
    gl.enable(gl.DEPTH_TEST);

    this.rug = new RugRenderer(gl);
    this.room = new Room(gl);

    this.napCanvas = document.createElement('canvas');
    this.heightCanvas = document.createElement('canvas');
    this.regionCanvas = document.createElement('canvas');
    for (const c of [this.napCanvas, this.heightCanvas, this.regionCanvas]) {
      c.width = c.height = MAP_SIZE;
    }
    this.resetCanvases();

    this.tex = {
      height: createTexture2D(gl, MAP_SIZE, MAP_SIZE, null),
      region: createTexture2D(gl, MAP_SIZE, MAP_SIZE, null),
      nap: createTexture2D(gl, MAP_SIZE, MAP_SIZE, null),
      pattern: createTexture2D(gl, 4, 4, null, { mipmap: true }),
    };
    this.uploadAll();

    this.bindPointer();
  }

  private resetCanvases() {
    // 默认:满绒高、全割绒、倒毛朝 -v 方向
    let ctx = this.heightCanvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
    ctx = this.regionCanvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
    ctx = this.napCanvas.getContext('2d')!;
    ctx.fillStyle = 'rgb(128,0,0)';
    ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
  }

  /** 载入订单数据(异步贴图) */
  async setOrder(order: Order) {
    this.order = order;
    this.rug.buildMesh(order.widthM, order.heightM, order.shape);
    // 高度图
    if (order.craft.heightMapUrl) {
      const img = await loadImage(order.craft.heightMapUrl);
      const ctx = this.heightCanvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, MAP_SIZE, MAP_SIZE);
    }
    if (order.craft.regionMapUrl) {
      const img = await loadImage(order.craft.regionMapUrl);
      const ctx = this.regionCanvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, MAP_SIZE, MAP_SIZE);
    }
    if (order.craft.napMapUrl) {
      const img = await loadImage(order.craft.napMapUrl);
      const ctx = this.napCanvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, MAP_SIZE, MAP_SIZE);
    }
    // 图案:RGB 纱线色 + A 材质
    if (order.pattern) {
      const { width, height, data } = await readPixels(order.pattern.indexedUrl);
      const colorMap = new Map(order.pattern.colors.map((c) => [c.hex.toLowerCase(), c]));
      const out = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < width * height; i++) {
        const hex = '#' + [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]
          .map((v) => v.toString(16).padStart(2, '0')).join('');
        const c = colorMap.get(hex);
        const [r, g, b] = c ? hexToRgb(c.hex) : [200, 200, 200];
        out[i * 4] = r;
        out[i * 4 + 1] = g;
        out[i * 4 + 2] = b;
        out[i * 4 + 3] = c ? Math.round((c.material / 2) * 255) : 0;
      }
      this.patternData = { w: width, h: height, data: out };
    } else {
      // 默认素色羊毛
      this.patternData = {
        w: 1, h: 1,
        data: new Uint8ClampedArray([207, 200, 184, 0]),
      };
    }
    this.uploadAll();
    this.dirty = true;
  }

  private uploadAll() {
    const gl = this.gl;
    updateTexture2D(gl, this.tex.height, this.heightCanvas);
    updateTexture2D(gl, this.tex.region, this.regionCanvas);
    updateTexture2D(gl, this.tex.nap, this.napCanvas);
    if (this.patternData) {
      gl.bindTexture(gl.TEXTURE_2D, this.tex.pattern);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.patternData.w, this.patternData.h, 0,
        gl.RGBA, gl.UNSIGNED_BYTE, this.patternData.data);
      gl.generateMipmap(gl.TEXTURE_2D);
    }
    this.dirty = true;
  }

  /** 工艺页改了图后重新上传 */
  reloadMaps() {
    if (!this.order) return;
    this.setOrder(this.order);
  }

  // ---------- 交互 ----------
  private pointers = new Map<number, { x: number; y: number }>();
  private lastBrushUV: [number, number] | null = null;

  private bindPointer() {
    const cv = this.canvas;
    cv.style.touchAction = 'none';
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.brush !== 'orbit') {
        const uv = this.raycastToUV(e.clientX, e.clientY);
        this.lastBrushUV = uv;
        if (uv) this.paintBrush(uv, uv);
      }
    });
    cv.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (this.brush === 'orbit') {
        if (this.pointers.size === 1) {
          this.tYaw -= dx * 0.006;
          this.tPitch = clamp(this.tPitch + dy * 0.005, 0.15, 1.45);
        }
      } else {
        const uv = this.raycastToUV(e.clientX, e.clientY);
        if (uv && this.lastBrushUV) this.paintBrush(this.lastBrushUV, uv);
        if (uv) this.lastBrushUV = uv;
      }
    });
    const up = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      this.lastBrushUV = null;
      if (this.brush !== 'orbit') this.scheduleSave();
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.tDist = clamp(this.tDist * (1 + Math.sign(e.deltaY) * 0.12), 0.35, 8);
    }, { passive: false });
  }

  /** 笔刷在倒毛图上画一笔 */
  private paintBrush(from: [number, number], to: [number, number]) {
    const ctx = this.napCanvas.getContext('2d')!;
    const dx = to[0] - from[0], dy = to[1] - from[1];
    const len = Math.hypot(dx, dy);
    let dirX = 0, dirY = -1;
    if (len > 0.0005) { dirX = dx / len; dirY = dy / len; }
    const r = Math.round((dirX + 1) / 2 * 255);
    const g = Math.round((dirY + 1) / 2 * 255);
    const steps = Math.max(1, Math.round(len * MAP_SIZE / 4));
    for (let i = 0; i <= steps; i++) {
      const u = from[0] + (dx * i) / steps;
      const v = from[1] + (dy * i) / steps;
      const x = u * MAP_SIZE, y = v * MAP_SIZE;
      const rad = this.brushSize / 2;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, rad);
      if (this.brush === 'nap') {
        grad.addColorStop(0, `rgba(${r},${g},0,0.9)`);
        grad.addColorStop(1, `rgba(${r},${g},0,0)`);
      } else if (this.brush === 'footprint') {
        grad.addColorStop(0, `rgba(${r},${g},255,0.95)`);
        grad.addColorStop(0.7, `rgba(${r},${g},230,0.6)`);
        grad.addColorStop(1, `rgba(${r},${g},200,0)`);
      } else {
        // erase:恢复默认倒毛
        grad.addColorStop(0, 'rgba(128,0,0,0.9)');
        grad.addColorStop(1, 'rgba(128,0,0,0)');
      }
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
    updateTexture2D(this.gl, this.tex.nap, this.napCanvas);
    this.dirty = true;
  }

  private scheduleSave() {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      if (!this.order) return;
      this.order.craft.napMapUrl = this.napCanvas.toDataURL('image/png');
      store.save(this.order);
      this.onMapSaved?.();
    }, 800);
  }

  /** 屏幕坐标 -> 毯面 uv */
  raycastToUV(clientX: number, clientY: number): [number, number] | null {
    if (!this.order) return null;
    const rect = this.canvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = 1 - ((clientY - rect.top) / rect.height) * 2;
    const aspect = rect.width / rect.height;
    const fov = Math.PI / 4;
    const eye = this.eyePos();
    const fwd = normalize3(sub3(this.target, eye));
    const right = normalize3(cross3(fwd, [0, 1, 0]));
    const up2 = cross3(right, fwd);
    const t = Math.tan(fov / 2);
    const dir = normalize3([
      fwd[0] + right[0] * nx * t * aspect + up2[0] * ny * t,
      fwd[1] + right[1] * nx * t * aspect + up2[1] * ny * t,
      fwd[2] + right[2] * nx * t * aspect + up2[2] * ny * t,
    ]);
    if (dir[1] >= -1e-5) return null;
    const hTop = (this.order.pileHeightMm / 1000) * 0.9;
    const tt = (hTop - eye[1]) / dir[1];
    if (tt <= 0) return null;
    const px = eye[0] + dir[0] * tt;
    const pz = eye[2] + dir[2] * tt;
    const u = px / this.order.widthM + 0.5;
    const v = pz / this.order.heightM + 0.5;
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    return [u, v];
  }

  private eyePos(): Vec3 {
    return [
      this.target[0] + this.dist * Math.cos(this.pitch) * Math.sin(this.yaw),
      this.target[1] + this.dist * Math.sin(this.pitch),
      this.target[2] + this.dist * Math.cos(this.pitch) * Math.cos(this.yaw),
    ];
  }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = (now: number) => {
      if (!this.running) return;
      // 帧率统计
      if (this.lastFrame) {
        this.frameTimes.push(now - this.lastFrame);
        if (this.frameTimes.length > 60) this.frameTimes.shift();
        this.fps = 1000 / (this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length);
      }
      this.lastFrame = now;
      // 相机阻尼
      const k = 0.18;
      this.yaw += (this.tYaw - this.yaw) * k;
      this.pitch += (this.tPitch - this.pitch) * k;
      this.dist += (this.tDist - this.dist) * k;
      this.render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    // 释放 GL 上下文,避免多次进出页面累积超过浏览器上限
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * this.settings.renderScale;
    const w = Math.round(this.canvas.clientWidth * dpr);
    const h = Math.round(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.dirty = true;
    }
  }

  render() {
    if (!this.order) return;
    this.resize();
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const aspect = this.canvas.width / this.canvas.height;
    const proj = mat4Perspective(Math.PI / 4, aspect, 0.02, 30);
    const eye = this.eyePos();
    const view = mat4LookAt(eye, this.target, [0, 1, 0]);
    const preset = LIGHT_PRESETS[this.lightIndex];
    this.room.preset = preset;
    this.room.visible = this.roomVisible;
    this.room.render(proj, view, eye, this.order.widthM, this.order.heightM, this.order.shape !== 'rect');

    // 近距离自动增加壳层,远处减少(保帧率)
    const base = this.settings.shellCount;
    const near = clamp(1.6 - this.dist / 3.5, 0.45, 1.4);
    const shells = Math.round(base * near);

    const fu: FurUniforms = {
      proj, view, camPos: eye,
      lightDir: preset.dir,
      lightColor: preset.color,
      ambient: preset.ambient,
      maxHeight: this.order.pileHeightMm / 1000,
      rugW: this.order.widthM,
      rugH: this.order.heightM,
      tuftsPerMeter: 220,
      napContrast: 0.22,
      shellCount: shells,
      shape: this.order.shape,
    };
    this.rug.render(this.tex, fu);
  }

  /** 高清截图(临时提高壳层数渲染一帧) */
  screenshot(): string {
    const oldShells = this.settings.shellCount;
    this.settings.shellCount = Math.max(oldShells, 56);
    this.render();
    const url = this.canvas.toDataURL('image/png');
    this.settings.shellCount = oldShells;
    this.dirty = true;
    return url;
  }
}

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}
