// ============================================================
// MMM Roadmap UI Logic
// - Mobile nav toggle
// - Smooth scroll with offset
// - Scrollspy (active section highlight)
// - Reveal animations
// ============================================================

/* ============================================================
   NAV ELEMENTS
============================================================ */

const nav = document.getElementById("nav");
const navLinks = Array.from(document.querySelectorAll(".nav-link"));
const topbar = document.querySelector(".topbar");

/* ============================================================
   MOBILE NAV TOGGLE (future-proofed)
   If you add a toggle button later, this is ready.
============================================================ */

const navToggle = document.getElementById("navToggle");

function setExpanded(isOpen) {
  if (!navToggle || !nav) return;

  navToggle.setAttribute("aria-expanded", String(isOpen));
  nav.classList.toggle("open", isOpen);
}

if (navToggle) {
  navToggle.addEventListener("click", () => {
    const isOpen = nav.classList.contains("open");
    setExpanded(!isOpen);
  });
}

// Close nav after clicking a link (mobile behavior)
navLinks.forEach((link) => {
  link.addEventListener("click", () => {
    setExpanded(false);
  });
});

/* ============================================================
   SMOOTH SCROLL
============================================================ */

const prefersReducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)"
).matches;

function getHeaderOffset() {
  if (!topbar) return 0;
  return topbar.getBoundingClientRect().height + 10;
}

navLinks.forEach((link) => {
  link.addEventListener("click", (e) => {
    const href = link.getAttribute("href");
    if (!href || !href.startsWith("#")) return;

    const target = document.querySelector(href);
    if (!target) return;

    e.preventDefault();

    const y =
      target.getBoundingClientRect().top +
      window.scrollY -
      getHeaderOffset();

    window.scrollTo({
      top: y,
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });

    history.replaceState(null, "", href);
  });
});

/* ============================================================
   SCROLLSPY (ACTIVE NAV HIGHLIGHT)
============================================================ */

const sections = navLinks
  .map((link) => link.getAttribute("href"))
  .filter((href) => href && href.startsWith("#"))
  .map((id) => document.querySelector(id))
  .filter(Boolean);

function updateActiveNavLink() {
  if (!sections.length) return;

  const scrollPosition = window.scrollY + getHeaderOffset() + 20;

  let currentSection = sections[0];

  for (const section of sections) {
    if (
      scrollPosition >= section.offsetTop &&
      scrollPosition < section.offsetTop + section.offsetHeight
    ) {
      currentSection = section;
      break;
    }
  }

  navLinks.forEach((link) => {
    const href = link.getAttribute("href");
    const isActive = href === `#${currentSection.id}`;

    link.classList.toggle("active", isActive);
    link.setAttribute("aria-current", isActive ? "page" : "false");
  });
}

window.addEventListener("scroll", updateActiveNavLink);
window.addEventListener("resize", updateActiveNavLink);
updateActiveNavLink();

/* ============================================================
   INTERSECTION REVEAL ANIMATIONS
============================================================ */

const revealElements = document.querySelectorAll(".card, .panel");

const observerOptions = {
  threshold: 0.08,
  rootMargin: "0px 0px -40px 0px",
};

const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.style.opacity = "1";
      entry.target.style.transform = "translateY(0)";
      entry.target.style.transition =
        "opacity 0.45s ease, transform 0.45s ease";
    }
  });
}, observerOptions);

revealElements.forEach((el) => {
  el.style.opacity = "0";
  el.style.transform = "translateY(18px)";
  revealObserver.observe(el);
});

/* ============================================================
   SAFETY: HANDLE EDGE CASES
============================================================ */

// Ensure no JS errors break the page silently
window.addEventListener("error", (e) => {
  console.error("MMM UI error:", e.message);
});