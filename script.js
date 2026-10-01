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

// Magnetic CTAs — subtle pull toward the cursor.
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
