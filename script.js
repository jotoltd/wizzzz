// Mark JS as active so reveal animations hide elements only when JS can reveal them
document.documentElement.classList.add("js");

const prefersReducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = matchMedia("(pointer: fine)").matches;

// Preloader — first visit per session only; markup self-removes on repeat views
const loader = document.getElementById("loader");
if (loader) {
  const isBot = /Lighthouse|Chrome-Lighthouse|Googlebot|AdsBot|PageSpeed|HeadlessChrome/i.test(navigator.userAgent);
  if (prefersReducedMotion || isBot) {
    loader.remove();
  } else {
    const count = loader.querySelector(".loader-count");
    const fill = loader.querySelector(".loader-fill");
    let p = 0, done = false;
    const tick = setInterval(() => {
      p = Math.min(p + Math.random() * 14 + 6, 92);
      if (count) count.textContent = Math.floor(p);
      if (fill) fill.style.width = p + "%";
    }, 90);
    const finish = () => {
      if (done) return;
      done = true;
      clearInterval(tick);
      if (count) count.textContent = "100";
      if (fill) fill.style.width = "100%";
      loader.classList.add("loader-done");
      sessionStorage.setItem("wz_l", "1");
      setTimeout(() => loader.remove(), 800);
    };
    const minWait = new Promise((r) => setTimeout(r, 700));
    const loaded = new Promise((r) =>
      document.readyState === "complete" ? r() : addEventListener("load", r)
    );
    Promise.all([minWait, loaded]).then(finish);
    setTimeout(finish, 3000);
  }
}

// Scroll progress bar
const scrollProgress = document.getElementById("scrollProgress");
if (scrollProgress) {
  window.addEventListener("scroll", () => {
    const h = document.documentElement;
    const scrolled = (h.scrollTop / (h.scrollHeight - h.clientHeight)) * 100;
    scrollProgress.style.width = `${scrolled}%`;
  }, { passive: true });
}

// Year
const yearEl = document.getElementById("year");
if (yearEl) yearEl.textContent = new Date().getFullYear();

// Reveal on scroll
const reveals = document.querySelectorAll(".reveal");
const io = new IntersectionObserver(
  (entries) => {
    entries.forEach((e, i) => {
      if (e.isIntersecting) {
        // small stagger within a section
        setTimeout(() => e.target.classList.add("in"), i * 80);
        io.unobserve(e.target);
      }
    });
  },
  { threshold: 0.15 }
);
reveals.forEach((r) => io.observe(r));

// Mobile menu
const burger = document.getElementById("navBurger");
const mobileMenu = document.getElementById("mobileMenu");

if (burger && mobileMenu) {
  function closeMenu() {
    burger.classList.remove("open");
    mobileMenu.classList.remove("open");
    burger.setAttribute("aria-expanded", "false");
    mobileMenu.setAttribute("aria-hidden", "true");
  }

  burger.addEventListener("click", () => {
    const isOpen = burger.classList.toggle("open");
    mobileMenu.classList.toggle("open", isOpen);
    burger.setAttribute("aria-expanded", String(isOpen));
    mobileMenu.setAttribute("aria-hidden", String(!isOpen));
  });

  mobileMenu.querySelectorAll(".mobile-link").forEach((link) => {
    link.addEventListener("click", closeMenu);
  });
}

// Shuffle work cards in random order on each load
const workGrid = document.querySelector(".work-grid");
if (workGrid) {
  const cards = Array.from(workGrid.children);
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    workGrid.appendChild(cards[j]);
    cards.splice(j, 1);
  }
}

// Work card radial follow
document.querySelectorAll(".work-card").forEach((card) => {
  card.addEventListener("mousemove", (e) => {
    const r = card.getBoundingClientRect();
    card.style.setProperty("--mx", `${e.clientX - r.left}px`);
    card.style.setProperty("--my", `${e.clientY - r.top}px`);
  });
});

// Nav: tuck away scrolling down, return scrolling up
const nav = document.querySelector(".nav");
if (nav) {
  let lastY = 0;
  addEventListener("scroll", () => {
    const y = scrollY;
    nav.classList.toggle("nav-hidden", y > lastY && y > 140);
    lastY = y;
  }, { passive: true });
}

// Hero parallax — content drifts up and fades as it leaves the viewport
const heroSec = document.querySelector(".hero, .service-hero");
if (heroSec && !prefersReducedMotion) {
  addEventListener("scroll", () => {
    const y = scrollY;
    if (y < innerHeight * 1.2) {
      heroSec.style.transform = `translateY(${y * 0.22}px)`;
      heroSec.style.opacity = String(1 - y / (innerHeight * 1.1));
    }
  }, { passive: true });
}

// ===== Liquid hero — raymarched metaballs (WebGL) =====
const fluidCanvas = document.getElementById("fluidHero");
if (fluidCanvas) initFluidHero(fluidCanvas);

function initFluidHero(canvas) {
  const gl = canvas.getContext("webgl", { alpha: true, antialias: true, premultipliedAlpha: false });
  if (!gl) return;

  const VERT = `attribute vec2 aPos; void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;
  const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uLead;
#define N 6

vec3 blobPos(int i, float t){
  float fi = float(i);
  float a = t * (0.22 + 0.06 * fi) + fi * 2.39;
  float r = 0.9 + 0.45 * sin(t * 0.27 + fi * 1.31);
  return vec3(cos(a) * r, sin(a * 0.83 + fi) * r * 0.6, -1.2 + 0.5 * sin(t * 0.19 + fi * 2.1));
}
float smin(float a, float b, float k){
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
float map(vec3 p){
  float d = smin(1e9, length(p - vec3(uLead, -0.8)) - 0.5, 0.8);
  for (int i = 1; i < N; i++) {
    float fi = float(i);
    d = smin(d, length(p - blobPos(i, uTime)) - (0.38 + 0.1 * sin(uTime * 0.5 + fi * 3.3)), 0.7);
  }
  return d;
}
vec3 calcNormal(vec3 p){
  vec2 e = vec2(0.0015, 0.0);
  return normalize(vec3(
    map(p + e.xyy) - map(p - e.xyy),
    map(p + e.yxy) - map(p - e.yxy),
    map(p + e.yyx) - map(p - e.yyx)));
}
void main(){
  vec2 uv = (gl_FragCoord.xy * 2.0 - uRes) / uRes.y;
  vec3 ro = vec3(0.0, 0.0, 2.6);
  vec3 rd = normalize(vec3(uv, -1.7));
  float t = 0.0;
  bool hit = false;
  vec3 p = ro;
  for (int i = 0; i < 72; i++) {
    p = ro + rd * t;
    float d = map(p);
    if (d < 0.0012) { hit = true; break; }
    t += max(d * 0.85, 0.01);
    if (t > 9.0) break;
  }
  if (!hit) discard;
  vec3 n = calcNormal(p);
  vec3 l = normalize(vec3(0.55, 0.85, 0.9));
  float dif = max(dot(n, l), 0.0);
  float spec = pow(max(dot(reflect(-l, n), -rd), 0.0), 48.0);
  float spec2 = pow(max(dot(reflect(-l, n), -rd), 0.0), 8.0);
  float fres = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
  float h = clamp(p.y * 0.45 + 0.55, 0.0, 1.0);
  vec3 base = mix(vec3(0.16, 0.03, 0.02), vec3(1.0, 0.42, 0.05), h);
  base = mix(base, vec3(1.0, 0.7, 0.3), fres * 0.75);
  vec3 col = base * (0.22 + dif * 0.95)
           + spec * vec3(1.0, 0.85, 0.6) * 1.1
           + spec2 * vec3(1.0, 0.5, 0.15) * 0.35
           + fres * vec3(1.0, 0.4, 0.08) * 0.55;
  gl_FragColor = vec4(col, 1.0);
}`;

  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  };
  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return;

  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const uRes = gl.getUniformLocation(prog, "uRes");
  const uTime = gl.getUniformLocation(prog, "uTime");
  const uLead = gl.getUniformLocation(prog, "uLead");

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);

  const SCALE = Math.min(devicePixelRatio || 1, 2) * 0.55;
  const resize = () => {
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.max(2, Math.round(r.width * SCALE));
    canvas.height = Math.max(2, Math.round(r.height * SCALE));
    gl.viewport(0, 0, canvas.width, canvas.height);
  };
  resize();
  addEventListener("resize", resize);

  // Lead blob: chases cursor while it's moving, drifts back to orbit when idle
  let lx = 0, ly = 0, tx = 0, ty = 0, lastMove = -1e9;
  const orbit0 = (t) => [Math.cos(t * 0.22) * 0.9, Math.sin(t * 0.1826) * 0.9 * 0.6];
  addEventListener("mousemove", (e) => {
    const r = canvas.getBoundingClientRect();
    tx = (2 * (e.clientX - r.left) - r.width) / r.height;
    ty = (r.height - 2 * (e.clientY - r.top)) / r.height;
    lastMove = performance.now();
  }, { passive: true });

  let visible = true;
  new IntersectionObserver((en) => { visible = en[0].isIntersecting; }).observe(canvas);

  let t = 3; // start mid-formation so first frame already looks good
  let last = performance.now();
  const frame = (now) => {
    requestAnimationFrame(frame);
    if (!visible || document.hidden) { last = now; return; }
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    t += dt;
    const [ox, oy] = orbit0(t);
    const gx = now - lastMove < 3000 ? tx : ox;
    const gy = now - lastMove < 3000 ? ty : oy;
    lx += (gx - lx) * 0.06;
    ly += (gy - ly) * 0.06;
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, t);
    gl.uniform2f(uLead, lx, ly);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  if (prefersReducedMotion) {
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, t);
    gl.uniform2f(uLead, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  } else {
    requestAnimationFrame(frame);
  }
}
// Uses the `translate` property (not `transform`) so :active press states still compose.
if (!prefersReducedMotion && finePointer) {
  document.querySelectorAll(".btn-primary, .nav-cta").forEach((btn) => {
    btn.addEventListener("mousemove", (e) => {
      const r = btn.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      btn.style.translate = `${dx * 0.22}px ${dy * 0.22}px`;
    });
    btn.addEventListener("mouseleave", () => { btn.style.translate = ""; });
  });
}

// Escape blurs the focused Services trigger, closing the dropdown
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && document.activeElement?.closest(".nav-item-dropdown")) {
    document.activeElement.blur();
  }
});

// FAQ accordion — smooth height animation on <details>
document.querySelectorAll(".faq-item").forEach((item) => {
  const summary = item.querySelector("summary");
  const panel = item.querySelector("p");
  if (!summary || !panel) return;
  summary.addEventListener("click", (e) => {
    e.preventDefault();
    if (prefersReducedMotion) { item.open = !item.open; return; }
    panel.style.overflow = "hidden";
    if (item.open) {
      const h = panel.offsetHeight;
      panel.animate(
        [{ height: h + "px", opacity: 1 }, { height: "0px", opacity: 0 }],
        { duration: 240, easing: "cubic-bezier(0.4, 0, 0.2, 1)" }
      ).onfinish = () => { item.open = false; panel.style.overflow = ""; };
    } else {
      item.open = true;
      const h = panel.offsetHeight;
      panel.animate(
        [{ height: "0px", opacity: 0 }, { height: h + "px", opacity: 1 }],
        { duration: 280, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }
      ).onfinish = () => { panel.style.overflow = ""; };
    }
  });
});
