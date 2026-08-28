// CivicSays — landing page behavior
// Navbar scroll shadow, FAQ accordion (close others), fade-in observer.

import { injectSprite } from './icons.js';

injectSprite();

// ----- Navbar shadow on scroll ---------------------------------------------
const navbar = document.getElementById('navbar');
if (navbar) {
  const onScroll = () => {
    if (window.scrollY > 8) navbar.classList.add('scrolled');
    else navbar.classList.remove('scrolled');
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

// ----- FAQ: close other items when one opens (accordion behavior) ---------
const faqItems = document.querySelectorAll('.faq-item');
faqItems.forEach((item) => {
  item.addEventListener('toggle', () => {
    if (item.open) {
      faqItems.forEach((other) => {
        if (other !== item && other.open) other.open = false;
      });
    }
  });
});

// ----- Fade-in on scroll ---------------------------------------------------
const fadeEls = document.querySelectorAll('.fade-in, .feature-row, .timeline-item, .stat-item');
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    },
    { rootMargin: '0px 0px -10% 0px', threshold: 0.05 }
  );
  fadeEls.forEach((el) => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(12px)';
    el.style.transition = 'opacity 480ms cubic-bezier(0.16, 1, 0.3, 1), transform 480ms cubic-bezier(0.16, 1, 0.3, 1)';
    io.observe(el);
  });
  // Once visible, set final state
  document.addEventListener('animationend', (e) => {
    if (e.target.classList && e.target.classList.contains('is-visible')) {
      e.target.style.opacity = '1';
      e.target.style.transform = 'none';
    }
  });
  // Use a more reliable approach: when is-visible is added, also reset
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    .is-visible {
      opacity: 1 !important;
      transform: none !important;
    }
  `;
  document.head.appendChild(styleEl);
}

// ----- Smooth scroll for hash links ----------------------------------------
document.querySelectorAll('a[href^="#"]').forEach((a) => {
  a.addEventListener('click', (e) => {
    const id = a.getAttribute('href');
    if (id && id.length > 1) {
      const target = document.querySelector(id);
      if (target) {
        e.preventDefault();
        const top = target.getBoundingClientRect().top + window.scrollY - 80;
        window.scrollTo({ top, behavior: 'smooth' });
      }
    }
  });
});
