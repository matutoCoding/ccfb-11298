// 轨道相机：左键旋转、滚轮缩放、右键平移，带阻尼
import { mat4, vec3 } from 'gl-matrix';

export class OrbitCamera {
  target = vec3.fromValues(0, 0, 0.01);
  distance = 3.2;
  azimuth = Math.PI * 0.25;   // 绕 z
  polar = Math.PI * 0.32;     // 与地面夹角
  minDistance = 0.45;
  maxDistance = 9;
  fov = (45 * Math.PI) / 180;

  private azVel = 0;
  private poVel = 0;
  private distVel = 0;
  private panVel = vec3.create();
  private el: HTMLElement;
  private dragging: 0 | 1 | 2 = 0;
  private lastX = 0;
  private lastY = 0;

  constructor(el: HTMLElement) {
    this.el = el;
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  dispose(): void {
    this.el.removeEventListener('pointerdown', this.onDown);
    this.el.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
  }

  private onDown = (e: PointerEvent) => {
    this.dragging = (e.button === 2 ? 2 : 1) as 1 | 2;
    this.lastX = e.clientX; this.lastY = e.clientY;
  };
  private onUp = () => { this.dragging = 0; };
  private onMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX; this.lastY = e.clientY;
    if (this.dragging === 1) {
      this.azVel = -dx * 0.006;
      this.poVel = -dy * 0.005;
    } else {
      const scale = this.distance * 0.0016;
      vec3.add(this.panVel, this.panVel, vec3.fromValues(-dx * scale, dy * scale, 0));
    }
  };
  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.distVel += e.deltaY * 0.0022;
  };

  update(): void {
    this.azimuth += this.azVel;
    this.polar = Math.min(Math.PI * 0.495, Math.max(0.06, this.polar + this.poVel));
    this.distance = Math.min(this.maxDistance, Math.max(this.minDistance, this.distance + this.distVel));
    vec3.add(this.target, this.target, this.panVel);
    // 阻尼
    this.azVel *= 0.82; this.poVel *= 0.82; this.distVel *= 0.8;
    vec3.scale(this.panVel, this.panVel, 0.8);
  }

  position(): vec3 {
    const cp = Math.cos(this.polar);
    return vec3.fromValues(
      this.target[0] + this.distance * cp * Math.cos(this.azimuth),
      this.target[1] + this.distance * cp * Math.sin(this.azimuth),
      this.target[2] + this.distance * Math.sin(this.polar),
    );
  }

  viewMatrix(): mat4 {
    const m = mat4.create();
    mat4.lookAt(m, this.position(), this.target, [0, 0, 1]);
    return m;
  }

  projMatrix(aspect: number): mat4 {
    const m = mat4.create();
    mat4.perspective(m, this.fov, aspect, 0.02, 60);
    return m;
  }

  frameRug(widthM: number, depthM: number): void {
    this.target = vec3.fromValues(0, 0, 0.01);
    this.distance = Math.max(widthM, depthM) * 1.35 + 0.6;
    this.azimuth = Math.PI * 0.25;
    this.polar = Math.PI * 0.3;
  }
}
