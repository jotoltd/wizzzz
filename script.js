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

// Cursor glow + flame
const glow = document.getElementById("cursorGlow");
const flame = document.getElementById("cursorFlame");
let gx = -1000, gy = -1000, tx = -1000, ty = -1000;

window.addEventListener("mousemove", (e) => {
  tx = e.clientX;
  ty = e.clientY;
  flame.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
});

function raf() {
  gx += (tx - gx) * 0.12;
  gy += (ty - gy) * 0.12;
  glow.style.transform = `translate3d(${gx}px, ${gy}px, 0)`;
  requestAnimationFrame(raf);
}
raf();

// Hide glow on touch devices
window.addEventListener("touchstart", () => {
  glow.style.opacity = "0";
  flame.style.opacity = "0";
}, { once: true });

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
