// WebGL2 基础工具

export function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('着色器编译失败: ' + log + '\n' + src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n'));
  }
  return sh;
}

export function createProgram(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compileShader(gl, gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(prog, compileShader(gl, gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error('着色器链接失败: ' + gl.getProgramInfoLog(prog));
  }
  return prog;
}

/** 收集 uniform 定位 */
export function uniforms<T extends string>(gl: WebGL2RenderingContext, prog: WebGLProgram, names: T[]): Record<T, WebGLUniformLocation | null> {
  const out = {} as Record<T, WebGLUniformLocation | null>;
  for (const n of names) out[n] = gl.getUniformLocation(prog, n);
  return out;
}

export function createTexture2D(
  gl: WebGL2RenderingContext,
  w: number,
  h: number,
  data: ArrayBufferView | null,
  opts: { filter?: number; wrap?: number; mipmap?: boolean; internal?: number; format?: number; type?: number } = {}
): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, opts.internal ?? gl.RGBA, w, h, 0, opts.format ?? gl.RGBA, opts.type ?? gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, opts.wrap ?? gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, opts.wrap ?? gl.CLAMP_TO_EDGE);
  if (opts.mipmap) {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, opts.filter ?? gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (aniso) {
      const max = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
      gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, max));
    }
  } else {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, opts.filter ?? gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, opts.filter ?? gl.LINEAR);
  }
  return tex;
}

export function updateTexture2D(gl: WebGL2RenderingContext, tex: WebGLTexture, source: TexImageSource, mipmap = false) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  if (mipmap) gl.generateMipmap(gl.TEXTURE_2D);
}

/** 生成绒毛密度噪声纹理:R=密度阈值 G=单簇明暗变化 B=簇随机 */
export function createFurNoiseTexture(gl: WebGL2RenderingContext, size = 256, strand = true): WebGLTexture {
  const data = new Uint8Array(size * size * 4);
  // 值噪声
  const grid = 64;
  const rnd = new Float32Array((grid + 1) * (grid + 1));
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < rnd.length; i++) rnd[i] = rand();
  const sample = (x: number, y: number) => {
    const xi = Math.floor(x) % grid, yi = Math.floor(y) % grid;
    const xf = x - Math.floor(x), yf = y - Math.floor(y);
    const s = (a: number, b: number, t: number) => a + (b - a) * (t * t * (3 - 2 * t));
    const v00 = rnd[yi * (grid + 1) + xi], v10 = rnd[yi * (grid + 1) + xi + 1];
    const v01 = rnd[(yi + 1) * (grid + 1) + xi], v11 = rnd[(yi + 1) * (grid + 1) + xi + 1];
    return s(s(v00, v10, xf), s(v01, v11, xf), yf);
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // 每像素一簇:用高频随机做密度,低频做变化
      const cellNoise = rand();
      const lowFreq = sample((x / size) * 8, (y / size) * 8);
      if (strand) {
        // 割绒:细长簇,密度阈值接近均匀随机
        data[i] = Math.round(255 * Math.pow(cellNoise, 0.8));
      } else {
        // 圈绒:团块感,低频成团
        data[i] = Math.round(255 * Math.min(1, Math.pow(cellNoise, 0.6) * 0.5 + lowFreq * 0.55));
      }
      data[i + 1] = Math.round(255 * (0.5 + 0.5 * cellNoise));
      data[i + 2] = Math.round(255 * lowFreq);
      data[i + 3] = 255;
    }
  }
  return createTexture2D(gl, size, size, data, { wrap: gl.REPEAT, mipmap: true });
}
