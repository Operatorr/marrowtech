/* ============================================================
   marrowtech — interactive shader backgrounds (vanilla port).
   Ported from design_system/components/shaders/{DitherCanvas,
   AsciiField}.jsx. Auto-mounts onto any element carrying a
   [data-dither] or [data-ascii] attribute, reading config from
   data-* attributes. Both pause when offscreen.
   ============================================================ */

function hexRGB01(hex: string): [number, number, number] {
  let h = (hex || '#000000').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
function hexRGB(hex: string): [number, number, number] {
  let h = (hex || '#000').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const num = (el: HTMLElement, key: string, def: number): number => {
  const v = el.dataset[key];
  return v == null || v === '' ? def : Number(v);
};
const str = (el: HTMLElement, key: string, def: string): string => {
  const v = el.dataset[key];
  return v == null || v === '' ? def : v;
};
const prefersReduced = () =>
  typeof window !== 'undefined' && window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------------- DitherCanvas (WebGL Bayer dither field) ---------------- */
const VERT = `
attribute vec2 a_pos;
void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }
`;
const FRAG = `
precision highp float;
uniform vec2  u_res;
uniform float u_time;
uniform float u_pixel;
uniform float u_scale;
uniform float u_speed;
uniform vec3  u_colA;
uniform vec3  u_colB;
uniform vec3  u_accent;
uniform sampler2D u_field;   // CPU wave/wake heightfield (height in R)
uniform vec2  u_fieldTexel;  // 1.0 / grid dimensions
uniform float u_warp;        // how much ripples bend the dither pattern
uniform float u_waveGain;    // how much crests/troughs add/remove dots

float hash(vec2 p){ p = fract(p*vec2(123.34, 345.45)); p += dot(p, p+34.345); return fract(p.x*p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  float a = hash(i), b = hash(i+vec2(1.0,0.0));
  float c = hash(i+vec2(0.0,1.0)), d = hash(i+vec2(1.0,1.0));
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, amp = 0.5;
  for(int i=0;i<5;i++){ v += amp*noise(p); p *= 2.02; amp *= 0.5; }
  return v;
}
float bayer(vec2 c){
  int x = int(mod(c.x,4.0));
  int y = int(mod(c.y,4.0));
  int i = x + y*4;
  float m[16];
  m[0]=0.0;  m[1]=8.0;  m[2]=2.0;  m[3]=10.0;
  m[4]=12.0; m[5]=4.0;  m[6]=14.0; m[7]=6.0;
  m[8]=3.0;  m[9]=11.0; m[10]=1.0; m[11]=9.0;
  m[12]=15.0;m[13]=7.0; m[14]=13.0;m[15]=5.0;
  float t = 0.0;
  for(int k=0;k<16;k++){ if(k==i){ t = m[k]; } }
  return (t + 0.5) / 16.0;
}

void main(){
  vec2 cell = floor(gl_FragCoord.xy / u_pixel);
  vec2 center = (cell + 0.5) * u_pixel;
  vec2 uv = center / u_res;

  // sample the simulated wake field (grid is top-down; uv.y is bottom-up)
  vec2 fuv = vec2(uv.x, 1.0 - uv.y);
  float hC = texture2D(u_field, fuv).r;
  float hr = texture2D(u_field, fuv + vec2(u_fieldTexel.x, 0.0)).r;
  float hu = texture2D(u_field, fuv + vec2(0.0, u_fieldTexel.y)).r;
  float height = hC * 2.0 - 1.0;            // ~[-1,1], 0 at rest
  vec2  slope  = vec2(hr - hC, hu - hC);     // local gradient of the surface

  vec2 p = uv;
  p.x *= u_res.x / u_res.y;
  p += slope * u_warp;                       // ripples bend the dither

  float t = u_time * u_speed;
  float f = fbm(p * u_scale + vec2(t*0.15, t*0.10));
  f = mix(f, fbm(p * u_scale * 1.8 - vec2(t*0.07, 0.0)), 0.45);

  f *= mix(0.62, 1.02, uv.y);                // calm, sparse resting field
  f += height * u_waveGain;                  // crests gain dots, troughs lose them
  float b = clamp(f, 0.0, 1.0);

  float th = bayer(cell);
  float on = step(th, b);

  // muted base; the brightest cells (incl. wave crests) lean toward the accent
  float accentMix = smoothstep(0.74, 1.0, b) * 0.6;
  vec3 dotc = mix(u_colB, u_accent, accentMix);
  vec3 col = mix(u_colA, dotc, on);
  gl_FragColor = vec4(col, 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.warn('DitherCanvas shader:', gl.getShaderInfoLog(s));
  }
  return s;
}

function mountDither(wrap: HTMLElement) {
  const colorA = str(wrap, 'colorA', '#0d0f13');
  const colorB = str(wrap, 'colorB', '#290cff');
  const accent = str(wrap, 'accent', '#7b5cff');
  const pixelSize = num(wrap, 'pixelSize', 5);
  const scale = num(wrap, 'scale', 3.2);
  const speed = num(wrap, 'speed', 1);
  const mouseRadius = num(wrap, 'mouseRadius', 180);
  const interactive = str(wrap, 'interactive', 'true') !== 'false';

  // Keep the element's own CSS positioning (the shader hosts are
  // already absolute/inset:0 or sized media slots); only ensure the
  // canvas is clipped to it.
  if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
  wrap.style.overflow = 'hidden';
  const canvas = document.createElement('canvas');
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  wrap.appendChild(canvas);

  const gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false });
  if (!gl) { wrap.style.background = colorA; return; }

  if (prefersReduced()) {
    // Render one static frame, no animation / no listeners.
    renderStatic(gl, canvas, wrap, { colorA, colorB, accent, pixelSize, scale, speed, mouseRadius });
    return;
  }

  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'a_pos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const U = (n: string) => gl.getUniformLocation(prog, n);
  const u = {
    res: U('u_res'), time: U('u_time'),
    pixel: U('u_pixel'), scale: U('u_scale'), speed: U('u_speed'),
    colA: U('u_colA'), colB: U('u_colB'), accent: U('u_accent'),
    field: U('u_field'), fieldTexel: U('u_fieldTexel'),
    warp: U('u_warp'), waveGain: U('u_waveGain'),
  };
  gl.uniform3fv(u.colA, hexRGB01(colorA));
  gl.uniform3fv(u.colB, hexRGB01(colorB));
  gl.uniform3fv(u.accent, hexRGB01(accent));
  gl.uniform1f(u.scale, scale);
  gl.uniform1f(u.speed, speed);
  gl.uniform1i(u.field, 0);
  gl.uniform1f(u.warp, 0.16);       // ripple bend strength
  gl.uniform1f(u.waveGain, 0.5);    // how strongly the wake reveals dots

  // ---- wake field: a damped wave equation solved on a small CPU grid,
  // uploaded each frame as a texture. The pointer injects disturbance along
  // its path (scaled by speed), so dragging carves ripples that propagate and
  // fade — like a finger through sand or a boat's wake. ----
  const fieldTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, fieldTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

  const DAMP = 0.992, C2 = 0.28, ENC = 118;
  let gw = 0, gh = 0, cssW = 1, cssH = 1;
  let cur = new Float32Array(0), prev = new Float32Array(0), tex = new Uint8Array(0);
  let pmx = -1, pmy = -1; // previous pointer position in grid coords
  function allocGrid(w: number, h: number) {
    const nw = Math.max(24, Math.min(160, Math.round(w / 16)));
    const nh = Math.max(18, Math.min(160, Math.round(h / 16)));
    if (nw === gw && nh === gh) return;
    gw = nw; gh = nh; pmx = -1; pmy = -1;
    cur = new Float32Array(gw * gh);
    prev = new Float32Array(gw * gh);
    tex = new Uint8Array(gw * gh);
    gl!.bindTexture(gl!.TEXTURE_2D, fieldTex);
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.LUMINANCE, gw, gh, 0, gl!.LUMINANCE, gl!.UNSIGNED_BYTE, tex);
    gl!.uniform2f(u.fieldTexel, 1 / gw, 1 / gh);
  }
  function inject(fx: number, fy: number, amp: number) {
    const R = 1.7;
    const x0 = Math.max(1, Math.floor(fx - R)), x1 = Math.min(gw - 2, Math.ceil(fx + R));
    const y0 = Math.max(1, Math.floor(fy - R)), y1 = Math.min(gh - 2, Math.ceil(fy + R));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const d2 = (x - fx) * (x - fx) + (y - fy) * (y - fy);
      cur[y * gw + x] += amp * Math.exp(-d2 / (R * R));
    }
  }
  function stepSim() {
    if (gw === 0) return;
    if (state.on) {
      const fx = (state.mx / cssW) * gw, fy = (state.my / cssH) * gh;
      if (pmx >= 0) {
        const dx = fx - pmx, dy = fy - pmy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const steps = Math.max(1, Math.min(10, Math.round(dist)));
        const amp = -Math.min(1.4, dist * 0.55); // displace downward, by speed
        for (let s = 1; s <= steps; s++) inject(pmx + dx * (s / steps), pmy + dy * (s / steps), amp / steps);
      }
      pmx = fx; pmy = fy;
    } else { pmx = -1; pmy = -1; }
    for (let y = 1; y < gh - 1; y++) {
      const row = y * gw;
      for (let x = 1; x < gw - 1; x++) {
        const i = row + x;
        const lap = cur[i - 1] + cur[i + 1] + cur[i - gw] + cur[i + gw] - 4 * cur[i];
        prev[i] = (2 * cur[i] - prev[i] + C2 * lap) * DAMP; // next → prev buffer
      }
    }
    const tmp = cur; cur = prev; prev = tmp; // swap so cur holds the new state
  }
  function uploadField() {
    if (gw === 0) return;
    for (let i = 0; i < cur.length; i++) {
      let v = 128 + cur[i] * ENC;
      tex[i] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
    gl!.activeTexture(gl!.TEXTURE0);
    gl!.bindTexture(gl!.TEXTURE_2D, fieldTex);
    gl!.texSubImage2D(gl!.TEXTURE_2D, 0, 0, 0, gw, gh, gl!.LUMINANCE, gl!.UNSIGNED_BYTE, tex);
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  function resize() {
    const r = wrap.getBoundingClientRect();
    cssW = Math.max(1, r.width); cssH = Math.max(1, r.height);
    const w = Math.max(1, Math.floor(r.width * dpr));
    const h = Math.max(1, Math.floor(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
      gl!.viewport(0, 0, w, h);
    }
    gl!.uniform2f(u.res, w, h);
    gl!.uniform1f(u.pixel, pixelSize * dpr);
    allocGrid(cssW, cssH);
  }
  const ro = new ResizeObserver(resize); ro.observe(wrap); resize();

  const state = { mx: -9999, my: -9999, on: 0 };
  let raf = 0, start = performance.now(), running = true;
  function frame(now: number) {
    if (!running) return;
    stepSim();
    uploadField();
    gl!.uniform1f(u.time, (now - start) / 1000);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  const io = new IntersectionObserver((es) => {
    es.forEach((e) => {
      if (e.isIntersecting && !running) { running = true; start = performance.now(); raf = requestAnimationFrame(frame); }
      else if (!e.isIntersecting) { running = false; cancelAnimationFrame(raf); }
    });
  }, { threshold: 0 });
  io.observe(wrap);

  if (interactive) {
    // Track pointer over the whole container (e.g. the hero), not just the
    // canvas — overlay content sits above [data-dither] and would otherwise
    // swallow the events, killing the effect wherever text/buttons cover it.
    const target = wrap.parentElement ?? wrap;
    const onMove = (e: PointerEvent | TouchEvent) => {
      const r = wrap.getBoundingClientRect();
      const t = (e as TouchEvent).touches;
      state.mx = (t ? t[0].clientX : (e as PointerEvent).clientX) - r.left;
      state.my = (t ? t[0].clientY : (e as PointerEvent).clientY) - r.top;
      state.on = 1;
    };
    const onLeave = () => { state.on = 0; };
    target.addEventListener('pointermove', onMove as EventListener);
    target.addEventListener('pointerleave', onLeave);
    target.addEventListener('touchmove', onMove as EventListener, { passive: true });
  }
}

function renderStatic(
  gl: WebGLRenderingContext, canvas: HTMLCanvasElement, wrap: HTMLElement,
  o: { colorA: string; colorB: string; accent: string; pixelSize: number; scale: number; speed: number; mouseRadius: number },
) {
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog); gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'a_pos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = (n: string) => gl.getUniformLocation(prog, n);
  gl.uniform3fv(U('u_colA'), hexRGB01(o.colorA));
  gl.uniform3fv(U('u_colB'), hexRGB01(o.colorB));
  gl.uniform3fv(U('u_accent'), hexRGB01(o.accent));
  gl.uniform1f(U('u_scale'), o.scale);
  gl.uniform1f(U('u_speed'), o.speed);
  // u_warp / u_waveGain default to 0, so the (unbound) wake field is inert here.
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const r = wrap.getBoundingClientRect();
  const w = Math.max(1, Math.floor(r.width * dpr));
  const h = Math.max(1, Math.floor(r.height * dpr));
  canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h);
  gl.uniform2f(U('u_res'), w, h);
  gl.uniform1f(U('u_pixel'), o.pixelSize * dpr);
  gl.uniform1f(U('u_time'), 12.0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

/* ---------------- AsciiField (canvas2d ASCII grid) ---------------- */
function makeNoise() {
  const p = new Uint8Array(512);
  const perm = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a: number, b: number, t: number) => a + t * (b - a);
  const grad = (h: number, x: number, y: number) => ((h & 1) ? -x : x) + ((h & 2) ? -y : y);
  function noise(x: number, y: number) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    x -= Math.floor(x); y -= Math.floor(y);
    const u = fade(x), v = fade(y);
    const A = p[X] + Y, B = p[X + 1] + Y;
    return (lerp(
      lerp(grad(p[A], x, y), grad(p[B], x - 1, y), u),
      lerp(grad(p[A + 1], x, y - 1), grad(p[B + 1], x - 1, y - 1), u), v) + 1) / 2;
  }
  return (x: number, y: number) => {
    let v = 0, amp = 0.5, f = 1;
    for (let i = 0; i < 4; i++) { v += amp * noise(x * f, y * f); f *= 2.03; amp *= 0.5; }
    return v;
  };
}

function mountAscii(wrap: HTMLElement) {
  const chars = str(wrap, 'chars', ' ·.:-=+*o#%@');
  const cellSize = num(wrap, 'cellSize', 13);
  const color = str(wrap, 'color', '#646a78');
  const accent = str(wrap, 'accent', '#290cff');
  const background = str(wrap, 'background', '#0d0f13');
  const speed = num(wrap, 'speed', 1);
  const scale = num(wrap, 'scale', 0.08);
  const mouseRadius = num(wrap, 'mouseRadius', 130);
  const interactive = str(wrap, 'interactive', 'true') !== 'false';
  const fade = str(wrap, 'fade', 'false') === 'true';

  if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
  wrap.style.overflow = 'hidden';
  wrap.style.background = background;
  const canvas = document.createElement('canvas');
  canvas.style.display = 'block';
  wrap.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const noise = makeNoise();
  const baseC = hexRGB(color), accC = hexRGB(accent);
  const ramp = chars;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let cols = 0, rows = 0, W = 0, H = 0;
  const mouse = { x: -9999, y: -9999, on: 0 };

  function resize() {
    const r = wrap.getBoundingClientRect();
    W = r.width; H = r.height;
    canvas.width = Math.floor(W * dpr); canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    cols = Math.ceil(W / cellSize); rows = Math.ceil(H / cellSize);
    ctx!.font = `${Math.round(cellSize * 0.92)}px "JetBrains Mono", ui-monospace, monospace`;
    ctx!.textBaseline = 'top';
  }
  const ro = new ResizeObserver(resize); ro.observe(wrap); resize();

  const drawFrame = (t: number) => {
    if (fade) { ctx!.fillStyle = 'rgba(13,15,19,0.22)'; ctx!.fillRect(0, 0, W, H); }
    else { ctx!.fillStyle = background; ctx!.fillRect(0, 0, W, H); }
    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        const px = gx * cellSize, py = gy * cellSize;
        let b = noise(gx * scale + t * 0.25, gy * scale - t * 0.18);
        b = b * 0.7 + noise(gx * scale * 2.1 - t * 0.12, gy * scale * 2.1) * 0.3;
        b *= 0.7 + 0.5 * (gy / rows);
        let infl = 0;
        if (mouse.on) {
          const dx = px - mouse.x, dy = py - mouse.y;
          const d = Math.sqrt(dx * dx + dy * dy) / mouseRadius;
          if (d < 1) { infl = (1 - d); b += infl * 0.6; }
        }
        b = b < 0 ? 0 : b > 1 ? 1 : b;
        const ci = Math.min(ramp.length - 1, Math.floor(b * ramp.length));
        const ch = ramp[ci];
        if (ch === ' ') continue;
        const mixA = Math.min(1, Math.max(0, (b - 0.55) / 0.45) + infl);
        const r = Math.round(baseC[0] + (accC[0] - baseC[0]) * mixA);
        const g = Math.round(baseC[1] + (accC[1] - baseC[1]) * mixA);
        const bl = Math.round(baseC[2] + (accC[2] - baseC[2]) * mixA);
        ctx!.fillStyle = `rgb(${r},${g},${bl})`;
        ctx!.fillText(ch, px, py);
      }
    }
  };

  if (prefersReduced()) { drawFrame(8); return; }

  let raf = 0, t0 = performance.now(), running = true;
  function frame(now: number) {
    if (!running) return;
    drawFrame((now - t0) / 1000 * speed);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  const io = new IntersectionObserver((es) => es.forEach((e) => {
    if (e.isIntersecting && !running) { running = true; t0 = performance.now(); raf = requestAnimationFrame(frame); }
    else if (!e.isIntersecting) { running = false; cancelAnimationFrame(raf); }
  }), { threshold: 0 });
  io.observe(wrap);

  if (interactive) {
    const onMove = (e: PointerEvent | TouchEvent) => {
      const r = wrap.getBoundingClientRect();
      const t = (e as TouchEvent).touches;
      mouse.x = (t ? t[0].clientX : (e as PointerEvent).clientX) - r.left;
      mouse.y = (t ? t[0].clientY : (e as PointerEvent).clientY) - r.top;
      mouse.on = 1;
    };
    const onLeave = () => { mouse.on = 0; };
    wrap.addEventListener('pointermove', onMove as EventListener);
    wrap.addEventListener('pointerleave', onLeave);
    wrap.addEventListener('touchmove', onMove as EventListener, { passive: true });
  }
}

/* ---------------- auto-init ---------------- */
function init() {
  document.querySelectorAll<HTMLElement>('[data-dither]').forEach(mountDither);
  document.querySelectorAll<HTMLElement>('[data-ascii]').forEach(mountAscii);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
