// CityBus Tracker — Emerald Noir interaction layer
//
// Framework-free enhancements that work with or without GSAP:
//   1. Thin emerald scroll-progress bar that fills down the page.
//   2. Scroll-reveal (.reveal-up) + section-title brighten (.title-brighten)
//      via IntersectionObserver — headings fade up and brighten on entry.
//   3. Count-up for any [data-count] number when it scrolls into view
//      (supports data-suffix like "%", "/7", "s").
//   4. A fixed floating action button that returns to the top.
//
// Everything degrades: no IntersectionObserver → content shows immediately;
// prefers-reduced-motion → no motion, final state applied at once.

(() => {
    'use strict';

    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ── 1. Scroll-progress bar ──────────────────────────────────────────
    const bar = document.getElementById('scroll-progress');
    function updateProgress() {
        if (!bar) return;
        const h = document.documentElement;
        const scrolled = h.scrollTop || document.body.scrollTop;
        const max = h.scrollHeight - h.clientHeight;
        bar.style.width = max > 0 ? `${(scrolled / max) * 100}%` : '0%';
    }

    // ── 4. Floating action button (back to top) ─────────────────────────
    const fab = document.getElementById('fab-scroll-top');
    if (fab) {
        fab.addEventListener('click', () =>
            window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' }));
    }
    function updateFab() {
        if (fab) fab.classList.toggle('show', window.scrollY > 600);
    }

    let ticking = false;
    addEventListener('scroll', () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => { updateProgress(); updateFab(); ticking = false; });
    }, { passive: true });

    // ── 3. Count-up ─────────────────────────────────────────────────────
    function countTo(el, target, suffix = '') {
        if (reduced) { el.textContent = target + suffix; return; }
        const dur = 1100;
        const start = performance.now();
        (function tick(now) {
            const t = Math.min(1, (now - start) / dur);
            const eased = 1 - Math.pow(1 - t, 3);
            el.textContent = Math.round(target * eased) + suffix;
            if (t < 1) requestAnimationFrame(tick);
        })(start);
    }
    // Exposed so script.js can retarget these once live data arrives.
    window.emeraldCountTo = countTo;

    // ── 2 + 3. IntersectionObserver: reveal, brighten, count ────────────
    function activate(el) {
        el.classList.add('in');
        if (el.hasAttribute('data-count')) {
            const target = Number(el.getAttribute('data-count')) || 0;
            countTo(el, target, el.getAttribute('data-suffix') || '');
        }
        el.querySelectorAll?.('[data-count]').forEach(n => {
            const target = Number(n.getAttribute('data-count')) || 0;
            countTo(n, target, n.getAttribute('data-suffix') || '');
        });
    }

    function initReveals() {
        const targets = document.querySelectorAll('.reveal-up, .title-brighten, [data-count]');
        if (!('IntersectionObserver' in window)) {
            targets.forEach(activate);   // no observer → show everything now
            return;
        }
        const io = new IntersectionObserver((entries, obs) => {
            entries.forEach(e => {
                if (!e.isIntersecting) return;
                activate(e.target);
                obs.unobserve(e.target);
            });
        }, { threshold: 0.18, rootMargin: '0px 0px -8% 0px' });
        targets.forEach(t => io.observe(t));

        // Failsafe: nothing should ever stay invisible. If the observer never
        // fires for an element (edge-case browsers, tab restore), reveal it.
        setTimeout(() => {
            document.querySelectorAll('.reveal-up:not(.in), .title-brighten:not(.in)')
                .forEach(el => {
                    const r = el.getBoundingClientRect();
                    if (r.top < innerHeight && r.bottom > 0) activate(el);
                });
        }, 2600);
    }

    document.addEventListener('DOMContentLoaded', () => {
        updateProgress();
        updateFab();
        initReveals();
    });
})();
