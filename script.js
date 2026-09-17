// Mark JS as active so reveal animations hide elements only when JS can reveal them
document.documentElement.classList.add("js");

// Scroll progress bar
const scrollProgress = document.getElementById("scrollProgress");
window.addEventListener("scroll", () => {
  const h = document.documentElement;
  const scrolled = (h.scrollTop / (h.scrollHeight - h.clientHeight)) * 100;
  scrollProgress.style.width = `${scrolled}%`;
}, { passive: true });

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

// Mobile menu
const burger = document.getElementById("navBurger");
const mobileMenu = document.getElementById("mobileMenu");

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
