"use client";

/*
 * Mosaic sky and pixel type for the Home hero.
 * Adapted from "mosaic-prompt-template" by Kedhareswer Naidu (MIT, https://kedhar.pages.dev):
 * the pixel face (GLYPHS, layoutPixels) and the mosaic-of-light fragment shader. The rest of that
 * template (header, features, pricing, GSAP timelines) is not used. Entrance motion here is CSS,
 * so Nexus adds no animation dependency.
 */

import { useEffect, useMemo, useRef, useState } from "react";

const GLYPHS: Record<string, string> = {
  A: ".###./#...#/#...#/#####/#...#/#...#/#...#",
  B: "####./#...#/#...#/####./#...#/#...#/####.",
  C: ".###./#...#/#..../#..../#..../#...#/.###.",
  D: "####./#...#/#...#/#...#/#...#/#...#/####.",
  E: "#####/#..../#..../####./#..../#..../#####",
  F: "#####/#..../#..../####./#..../#..../#....",
  G: ".###./#...#/#..../#.###/#...#/#...#/.####",
  H: "#...#/#...#/#...#/#####/#...#/#...#/#...#",
  I: "###/.#./.#./.#./.#./.#./###",
  J: "..###/...#./...#./...#./...#./#..#./.##..",
  K: "#...#/#..#./#.#../##.../#.#../#..#./#...#",
  L: "#..../#..../#..../#..../#..../#..../#####",
  M: "#...#/##.##/#.#.#/#.#.#/#...#/#...#/#...#",
  N: "#...#/##..#/#.#.#/#..##/#...#/#...#/#...#",
  O: ".###./#...#/#...#/#...#/#...#/#...#/.###.",
  P: "####./#...#/#...#/####./#..../#..../#....",
  Q: ".###./#...#/#...#/#...#/#.#.#/#..#./.##.#",
  R: "####./#...#/#...#/####./#.#../#..#./#...#",
  S: ".####/#..../#..../.###./....#/....#/####.",
  T: "#####/..#../..#../..#../..#../..#../..#..",
  U: "#...#/#...#/#...#/#...#/#...#/#...#/.###.",
  V: "#...#/#...#/#...#/#...#/#...#/.#.#./..#..",
  W: "#...#/#...#/#...#/#.#.#/#.#.#/#.#.#/.#.#.",
  X: "#...#/#...#/.#.#./..#../.#.#./#...#/#...#",
  Y: "#...#/#...#/.#.#./..#../..#../..#../..#..",
  Z: "#####/....#/...#./..#../.#.../#..../#####",
  a: "...../...../.###./....#/.####/#...#/.####",
  b: "#..../#..../####./#...#/#...#/#...#/####.",
  c: "..../..../.###/#.../#.../#.../.###",
  d: "....#/....#/.####/#...#/#...#/#...#/.####",
  e: "...../...../.###./#...#/#####/#..../.###.",
  f: ".##/#../###/#../#../#../#..",
  g: "...../...../.####/#...#/#...#/.####/....#/.###.",
  h: "#..../#..../####./#...#/#...#/#...#/#...#",
  i: "#/./#/#/#/#/#",
  j: "..#/.../..#/..#/..#/..#/..#/##.",
  k: "#.../#.../#..#/#.#./##../#.#./#..#",
  l: "#./#./#./#./#./#./.#",
  m: "...../...../##.#./#.#.#/#.#.#/#...#/#...#",
  n: "...../...../####./#...#/#...#/#...#/#...#",
  o: "...../...../.###./#...#/#...#/#...#/.###.",
  p: "...../...../####./#...#/#...#/####./#..../#....",
  q: "...../...../.####/#...#/#...#/.####/....#/....#",
  r: "..../..../#.##/##../#.../#.../#...",
  s: "...../...../.####/#..../.###./....#/####.",
  t: ".#../.#../####/.#../.#../.#../..##",
  u: "...../...../#...#/#...#/#...#/#...#/.####",
  v: "...../...../#...#/#...#/#...#/.#.#./..#..",
  w: "...../...../#...#/#...#/#.#.#/#.#.#/.#.#.",
  x: "...../...../#...#/.#.#./..#../.#.#./#...#",
  y: "...../...../#...#/#...#/#...#/.####/....#/.###.",
  z: "...../...../#####/...#./..#../.#.../#####",
  ".": "././././././#",
  ",": "././././././#/#",
  "'": "#/#/././././.",
  "!": "#/#/#/#/#/./#",
  "?": ".###./#...#/....#/...#./..#../...../..#..",
  "-": ".../.../.../###/.../.../...",
};

/** Lays a line of text out on the pixel grid: one blank column between glyphs, 3 columns for a space. */
export function layoutPixels(text: string) {
  const glyphs: { x: number; cells: [number, number][] }[] = [];
  let x = 0;
  for (const ch of text) {
    const g = GLYPHS[ch] || GLYPHS[ch.toUpperCase()];
    if (!g) {
      x += 3;
      continue;
    }
    const rows = g.split("/");
    const w = Math.max(...rows.map((r) => r.length));
    const cells: [number, number][] = [];
    rows.forEach((r, y) => {
      for (let i = 0; i < r.length; i++) if (r[i] === "#") cells.push([x + i, y]);
    });
    glyphs.push({ x, cells });
    x += w + 1;
  }
  return { width: Math.max(1, x - 1), height: 8, glyphs };
}

// Deterministic per-pixel scatter, so server and client render the same markup.
const rand = (n: number) => {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
};

// Pixel lines that already entered during this visit. Nexus keeps pages mounted and re-shows them,
// which would restart a CSS animation, so a line enters once and then stands.
const entered = new Set<string>();

/** A line of pixel type. Pixels fly in from scattered positions once a visit (CSS only). */
export function PixelText({ text, className, line = 0 }: { text: string; className?: string; line?: number }) {
  const lay = useMemo(() => layoutPixels(text), [text]);
  const [still] = useState(() => entered.has(`${text}:${line}`));
  useEffect(() => {
    entered.add(`${text}:${line}`);
  }, [text, line]);
  const vw = lay.width + 1;
  const vh = lay.height + 1;
  let k = line * 1000;
  return (
    <svg className={`px-text ${still ? "is-still" : ""} ${className ?? ""}`} viewBox={`-0.5 -0.5 ${vw} ${vh}`} aria-hidden="true" focusable="false" style={{ aspectRatio: `${vw} / ${vh}` }}>
      {lay.glyphs.map((g, gi) => (
        <g key={gi}>
          {g.cells.map(([x, y]) => {
            k++;
            const style = { "--dx": `${((rand(k) - 0.5) * 24).toFixed(1)}px`, "--dy": `${((rand(k + 7) - 0.5) * 14).toFixed(1)}px`, "--d": `${(gi * 0.035 + rand(k + 3) * 0.25 + line * 0.15).toFixed(2)}s` } as React.CSSProperties;
            return <rect key={`${x}-${y}`} className="px" x={x + 0.06} y={y + 0.06} width={0.88} height={0.88} rx={0.16} style={style} />;
          })}
        </g>
      ))}
    </svg>
  );
}

const VERT = "attribute vec2 aPos;void main(){gl_Position=vec4(aPos,0.0,1.0);}";

// The template's "mosaic" sky: soft light quantised into rounded tiles, drifting slowly.
const FRAG = `precision highp float;
uniform vec2 uRes; uniform float uTime; uniform vec2 uPtr; uniform float uPtrOn;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y); }
float fbm(vec2 p){ float v = 0.0; float a = 0.5; for (int i = 0; i < 4; i++){ v += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; } return v; }
void main(){
  vec2 frag = gl_FragCoord.xy;
  float cell = max(uRes.y / 26.0, 9.0);
  vec2 id = floor(frag / cell); vec2 f = fract(frag / cell);
  vec2 p = (id + 0.5) * cell / uRes.y; float ax = uRes.x / uRes.y; float t = uTime * 0.07;
  vec2 l1 = vec2(ax * 0.62 + 0.38 * sin(t * 2.1), 0.56 + 0.14 * cos(t * 1.7));
  vec2 l2 = vec2(ax * 0.3 - 0.4 * cos(t * 1.3), 0.25 + 0.1 * sin(t * 2.3));
  vec2 l3 = vec2(ax * 0.8 + 0.4 * cos(t * 0.9 + 2.0), 0.86 + 0.08 * sin(t * 1.1));
  float L = 0.62 * exp(-2.6 * dot(p - l1, p - l1)) + 0.42 * exp(-3.8 * dot(p - l2, p - l2)) + 0.3 * exp(-5.0 * dot(p - l3, p - l3));
  L += uPtrOn * 0.45 * exp(-14.0 * dot(p - uPtr, p - uPtr));
  float n = fbm(p * 3.0 + vec2(t * 1.6, -t * 1.1)); L *= 0.45 + n;
  float h = hash(id); L *= 0.8 + 0.28 * sin(uTime * (0.5 + h * 1.4) + h * 40.0);
  L = clamp(L, 0.0, 1.0); L = floor(L * 8.0 + h * 0.6) / 8.0;
  vec2 q = abs(f - 0.5); float tile = smoothstep(0.47, 0.41, max(q.x, q.y));
  vec3 cool = vec3(0.62, 0.68, 0.78); vec3 warm = vec3(0.92, 0.88, 0.82);
  vec3 col = mix(cool, warm, smoothstep(0.25, 0.75, n)) * L * 0.55;
  col *= tile * (0.82 + 0.36 * f.y);
  vec2 uv = frag / uRes; float vig = smoothstep(1.25, 0.25, length((uv - 0.5) * vec2(1.0, 1.15)));
  col *= 0.5 + 0.5 * vig;
  col += (hash(frag + fract(uTime)) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}`;

/** WebGL mosaic background. Pauses off screen, draws once under reduced motion, falls back to CSS. */
export function MosaicSky({ className }: { className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const canvas = document.createElement("canvas");
    canvas.className = "absolute inset-0 h-full w-full";
    el.prepend(canvas);
    const gl = canvas.getContext("webgl", { antialias: false, premultipliedAlpha: false, powerPreference: "low-power" });
    const fail = () => {
      el.dataset.sky = "fallback";
      canvas.remove();
    };
    if (!gl) return fail();
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram();
    if (!vs || !fs || !prog) return fail();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return fail();
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = { res: gl.getUniformLocation(prog, "uRes"), time: gl.getUniformLocation(prog, "uTime"), ptr: gl.getUniformLocation(prog, "uPtr"), ptrOn: gl.getUniformLocation(prog, "uPtrOn") };
    el.dataset.sky = "webgl";
    let w = 1;
    let h = 1;
    let dirty = true;
    const size = () => {
      const r = el.getBoundingClientRect();
      const scale = Math.min(window.devicePixelRatio || 1, 1.5) * 0.75;
      w = Math.max(1, Math.round(r.width * scale));
      h = Math.max(1, Math.round(r.height * scale));
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
      dirty = true;
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(el);
    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(el);
    let ptr = [0, 0];
    let ptrTarget = 0;
    let ptrOn = 0;
    const t0 = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!visible || document.hidden) return;
      if (reduced && !dirty) return;
      dirty = false;
      ptrOn += (ptrTarget - ptrOn) * 0.08;
      gl.uniform2f(U.res, w, h);
      gl.uniform1f(U.time, reduced ? 12 : (now - t0) / 1000);
      gl.uniform2f(U.ptr, ptr[0], ptr[1]);
      gl.uniform1f(U.ptrOn, reduced ? 0 : ptrOn);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    raf = requestAnimationFrame(frame);
    const parent = el.parentElement ?? el;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      ptr = [(e.clientX - r.left) / r.height, (r.bottom - e.clientY) / r.height];
      ptrTarget = 1;
    };
    const leave = () => (ptrTarget = 0);
    parent.addEventListener("pointermove", move);
    parent.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      parent.removeEventListener("pointermove", move);
      parent.removeEventListener("pointerleave", leave);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
    };
  }, []);
  return <div ref={host} aria-hidden="true" className={`mosaic-sky ${className ?? ""}`} />;
}
