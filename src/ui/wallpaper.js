// @ts-check
/** The liquid glass wallpaper: soft colour fields drifting behind the window, drawn by a small WebGL
 *  shader (in the spirit of ShaderGradient, without a library). It is a slow, smooth image, so it is
 *  drawn at an eighth of the screen's resolution, 24 times a second, and stops whenever it cannot
 *  be seen: a hidden tab, a full-screen photo view, or when the system asks for reduced motion (one
 *  still frame). Without WebGL the CSS gradient behind it stays. */

const VERT = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";
const FRAG = `precision mediump float;
uniform vec2 r;uniform float t;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(h(i),h(i+vec2(1.,0.)),f.x),mix(h(i+vec2(0.,1.)),h(i+1.),f.x),f.y);}
vec3 blob(vec2 q,vec2 c,float s,vec3 col){vec2 d=q-c;return col*exp(-dot(d,d)/s);}
void main(){
  vec2 uv=gl_FragCoord.xy/r;float a=r.x/r.y;vec2 q=vec2(uv.x*a,uv.y);
  // a slow warp of the plane: the colours flow into each other like a liquid
  q+=.5*vec2(n(q*1.6+vec2(t*.5,0.)),n(q*1.6+vec2(5.2,-t*.4)))-.25;
  vec3 c=mix(vec3(.106,.047,.114),vec3(.039,.059,.18),uv.y);
  c+=blob(q,vec2(a*(.46+.30*sin(t*.61)),1.02+.12*cos(t*.43)),.30,vec3(.20,.41,1.)*.72);
  c+=blob(q,vec2(a*(.92+.12*sin(t*.37+1.)),.92+.14*sin(t*.52)),.22,vec3(.47,.31,1.)*.52);
  c+=blob(q,vec2(a*(.08+.18*cos(t*.47)),.02+.16*sin(t*.33+2.)),.30,vec3(.84,.23,.57)*.56);
  c+=blob(q,vec2(a*(.84+.16*cos(t*.29+3.)),-.04+.14*cos(t*.41)),.32,vec3(1.,.54,.25)*.58);
  c+=blob(q,vec2(a*(.50+.36*sin(t*.23+4.)),.36+.2*cos(t*.31)),.20,vec3(.16,.75,.70)*.22);
  gl_FragColor=vec4(1.-exp(-c*1.35),1.);
}`;
const FPS = 24, SPEED = 0.6, SCALE = 8; // the colour fields circle every 17 to 45 s

let canvas = null, gl = null, uni = null, timer = 0, t0 = 0, bound = false;
const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const covered = () => !!document.querySelector("#lb:not([hidden]),#cull:not([hidden]),#cmp:not([hidden])");

function size() {
  const w = Math.max(64, Math.round(innerWidth / SCALE)), h = Math.max(48, Math.round(innerHeight / SCALE));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
}
function draw() {
  size();
  gl.uniform2f(uni.r, canvas.width, canvas.height);
  gl.uniform1f(uni.t, 20 + ((performance.now() - t0) / 1000) * SPEED);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
function tick() {
  timer = 0;
  if (!gl) return;
  if (!document.hidden && !covered()) draw();
  if (!still()) timer = window.setTimeout(() => requestAnimationFrame(tick), 1000 / FPS);
}

function start() {
  canvas = document.createElement("canvas");
  canvas.id = "wall";
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none;display:block";
  gl = /** @type {WebGLRenderingContext|null} */ (canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, powerPreference: "low-power" }));
  if (!gl) { canvas = null; return; }
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { gl = null; canvas = null; return; }
  gl.useProgram(pr);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); // one triangle covers the screen
  const loc = gl.getAttribLocation(pr, "p");
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  uni = { r: gl.getUniformLocation(pr, "r"), t: gl.getUniformLocation(pr, "t") };
  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); stop(); });
  document.body.prepend(canvas);
  if (!bound) {
    bound = true;
    // a still frame follows a resize under reduced motion
    addEventListener("resize", () => { if (gl && still()) draw(); });
  }
  t0 = performance.now();
  tick();
}
function stop() {
  clearTimeout(timer); timer = 0;
  canvas?.remove();
  canvas = gl = uni = null;
}

/** Shows the moving wallpaper (glass theme) or removes it. */
export function setWallpaper(on) {
  if (on && !canvas) start();
  else if (!on && canvas) stop();
}
