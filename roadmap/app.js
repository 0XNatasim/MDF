// MMM One-Pager interactions:
// - Mobile nav toggle
// - Smooth scroll
// - Scrollspy (active section highlight)

const nav = document.getElementById("nav");
const navToggle = document.getElementById("navToggle");
const navLinks = Array.from(document.querySelectorAll(".nav__link"));

function setExpanded(isOpen) {
  navToggle.setAttribute("aria-expanded", String(isOpen));
  nav.classList.toggle("open", isOpen);
}

navToggle?.addEventListener("click", () => {
  const isOpen = nav.classList.contains("open");
  setExpanded(!isOpen);
});

// Close nav after clicking a link (mobile)
navLinks.forEach((a) => {
  a.addEventListener("click", () => {
    setExpanded(false);
  });
});

// Smooth scroll (respect reduced motion)
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

navLinks.forEach((a) => {
  a.addEventListener("click", (e) => {
    const href = a.getAttribute("href") || "";
    if (!href.startsWith("#")) return;

    const target = document.querySelector(href);
    if (!target) return;

    e.preventDefault();

    const topbar = document.querySelector(".topbar");
    const offset = (topbar?.getBoundingClientRect().height || 0) + 10;

    const y = target.getBoundingClientRect().top + window.scrollY - offset;

    window.scrollTo({
      top: y,
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });

    history.replaceState(null, "", href);
  });
});

// Scrollspy - Updated with new section IDs
const sectionIds = navLinks
  .map((a) => a.getAttribute("href"))
  .filter((h) => h && h.startsWith("#"))
  .map((h) => h.substring(1));

const sections = sectionIds
  .map((id) => document.getElementById(id))
  .filter((section) => section !== null);

function updateActiveNavLink() {
  const scrollY = window.scrollY + 100; // Offset for better UX

  let currentSectionId = "";
  
  sections.forEach((section) => {
    const sectionTop = section.offsetTop;
    const sectionHeight = section.offsetHeight;
    
    if (scrollY >= sectionTop && scrollY < sectionTop + sectionHeight) {
      currentSectionId = section.id;
    }
  });

  // If we're at the very top, default to first section
  if (scrollY < sections[0]?.offsetTop) {
    currentSectionId = sections[0]?.id || "";
  }

  navLinks.forEach((link) => {
    const href = link.getAttribute("href") || "";
    const isActive = href === `#${currentSectionId}`;
    
    link.classList.toggle("active", isActive);
    link.setAttribute("aria-current", isActive ? "page" : "false");
  });
}

// Initialize and update on scroll
updateActiveNavLink();
window.addEventListener("scroll", updateActiveNavLink);
window.addEventListener("resize", updateActiveNavLink);

// Add animation for allocation items on scroll
const observerOptions = {
  threshold: 0.1,
  rootMargin: "0px 0px -50px 0px"
};

const allocationObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.style.opacity = "1";
      entry.target.style.transform = "translateY(0)";
    }
  });
}, observerOptions);

// Observe allocation items
document.querySelectorAll('.allocation-item').forEach(item => {
  item.style.opacity = "0";
  item.style.transform = "translateY(20px)";
  item.style.transition = "opacity 0.5s ease, transform 0.5s ease";
  allocationObserver.observe(item);
});

// Observe tax items
document.querySelectorAll('.tax-item').forEach(item => {
  item.style.opacity = "0";
  item.style.transform = "scale(0.9)";
  item.style.transition = "opacity 0.4s ease, transform 0.4s ease";
  setTimeout(() => {
    item.style.opacity = "1";
    item.style.transform = "scale(1)";
  }, 100);
});