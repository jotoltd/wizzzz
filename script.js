// Year
document.getElementById("year").textContent = new Date().getFullYear();

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

// Cursor glow
const glow = document.getElementById("cursorGlow");
let gx = -1000, gy = -1000, tx = -1000, ty = -1000;

window.addEventListener("mousemove", (e) => {
  tx = e.clientX;
  ty = e.clientY;
});

function raf() {
  gx += (tx - gx) * 0.12;
  gy += (ty - gy) * 0.12;
  glow.style.transform = `translate3d(${gx}px, ${gy}px, 0)`;
  requestAnimationFrame(raf);
}
raf();

// Hide glow on touch devices
window.addEventListener("touchstart", () => (glow.style.opacity = "0"), { once: true });

// Work slot radial follow
document.querySelectorAll(".work-slot").forEach((slot) => {
  slot.addEventListener("mousemove", (e) => {
    const r = slot.getBoundingClientRect();
    slot.style.setProperty("--mx", `${e.clientX - r.left}px`);
    slot.style.setProperty("--my", `${e.clientY - r.top}px`);
  });
});
