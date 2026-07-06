// CityBus Tracker — motion choreography (GSAP + ScrollTrigger)
//
// Three jobs:
//  1. Drive the landing stage: scrubbed camera progress for the WebGL scene
//     (window.__scrollP) and the Act 1 → Act 2 copy crossfade.
//  2. Scroll-reveal every section with intent (cards rise with a slight 3D
//     pitch, the map slides in, table rows cascade).
//  3. Micro-physicality: pointer-tracked 3D tilt on cards, page-entrance
//     staggers when the SPA switches pages.
//
// Everything degrades: no GSAP → static site; prefers-reduced-motion → all
// choreography off.

(() => {
    'use strict';

    if (!window.gsap || !window.ScrollTrigger) return;
    gsap.registerPlugin(ScrollTrigger);

    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isTouch = matchMedia('(pointer: coarse)').matches;
    window.__scrollP = 0;

    if (reduced) return; // the design stands still, completely

    // Gate the tall scroll stage on choreography actually being available —
    // without this class the landing collapses to a normal hero (CSS default),
    // so a failed CDN load never leaves 240vh of dead scroll.
    document.documentElement.classList.add('motion-ok');

    // ── 1. Landing stage: scrub the dive + act crossfade ───────────────
    function initLandingStage() {
        const stage = document.getElementById('landing-stage');
        if (!stage) return;

        const tl = gsap.timeline({
            scrollTrigger: {
                trigger: stage,
                start: 'top 76px',
                end: 'bottom bottom',
                scrub: 0.6,
                onUpdate(self) { window.__scrollP = self.progress; }
            },
            defaults: { ease: 'none' }
        });

        // Act 1 steps aside as the camera starts diving
        tl.to('.act-1', { autoAlpha: 0, y: -70, duration: 0.30 }, 0.16)
          .to('.scroll-hint', { autoAlpha: 0, duration: 0.10 }, 0.05)
        // Act 2 rides in at street level
          .fromTo('.act-2', { autoAlpha: 0, y: 60 },
                            { autoAlpha: 1, y: 0, duration: 0.28 }, 0.52)
          .to('.act-2', { autoAlpha: 0, y: -40, duration: 0.18 }, 0.86);
    }

    // ── 2. Scroll reveals ───────────────────────────────────────────────
    function revealOnScroll(targets, vars = {}) {
        gsap.utils.toArray(targets).forEach((el, i) => {
            if (el.dataset.revealed) return;
            el.dataset.revealed = '1';
            gsap.from(el, {
                scrollTrigger: { trigger: el, start: 'top 88%', once: true },
                y: 54,
                autoAlpha: 0,
                rotateX: 7,
                transformPerspective: 900,
                transformOrigin: 'center bottom',
                duration: 0.75,
                delay: (i % 4) * 0.08,
                ease: 'power3.out',
                clearProps: 'transform',
                ...vars
            });
        });
    }

    function initReveals() {
        revealOnScroll('.feature-card');
        revealOnScroll('.map-section', { rotateX: 0, y: 70 });
        revealOnScroll('.schedule-card');
        revealOnScroll('.contact-container > *', { rotateX: 0 });
        revealOnScroll('.faq-item', { y: 30, rotateX: 0 });
    }

    // ── 3. Pointer-tracked 3D tilt ──────────────────────────────────────
    const TILT_SELECTOR = '.feature-card, .bus-card, .schedule-card, .stat-card, .info-card, .journey-result';
    const TILT_MAX = 7; // degrees

    function attachTilt(card) {
        if (card.dataset.tilt || isTouch) return;
        card.dataset.tilt = '1';
        card.classList.add('tilt-card');
        const glare = document.createElement('span');
        glare.className = 'tilt-glare';
        card.appendChild(glare);

        const setRX = gsap.quickTo(card, 'rotationX', { duration: 0.4, ease: 'power2.out' });
        const setRY = gsap.quickTo(card, 'rotationY', { duration: 0.4, ease: 'power2.out' });
        gsap.set(card, { transformPerspective: 800 });

        card.addEventListener('pointermove', e => {
            const r = card.getBoundingClientRect();
            const nx = (e.clientX - r.left) / r.width - 0.5;
            const ny = (e.clientY - r.top) / r.height - 0.5;
            setRX(-ny * TILT_MAX);
            setRY(nx * TILT_MAX);
            glare.style.opacity = '1';
            glare.style.transform =
                `translate(${nx * 130 + 50}%, ${ny * 130 + 50}%) translate(-50%,-50%)`;
        });
        card.addEventListener('pointerleave', () => {
            setRX(0);
            setRY(0);
            glare.style.opacity = '0';
        });
    }

    function initTilt(scope) {
        (scope || document).querySelectorAll(TILT_SELECTOR).forEach(attachTilt);
    }

    // Dynamic content (bus list, schedule, admin tables) gets tilt as it renders
    const growRoots = ['bus-list', 'schedule-container', 'stat-grid'];
    function watchDynamicContent() {
        growRoots.forEach(id => {
            const root = document.getElementById(id);
            if (!root) return;
            new MutationObserver(() => initTilt(root)).observe(root, { childList: true });
        });
    }

    // ── 4. Page-entrance hook for the SPA ──────────────────────────────
    function hookPageTransitions() {
        const original = window.switchToPage;
        if (typeof original !== 'function') return;
        window.switchToPage = function (pageName) {
            original(pageName);
            const page = document.getElementById(pageName);
            if (page) {
                const blocks = page.querySelectorAll(':scope > *:not(.landing-stage)');
                gsap.fromTo(blocks,
                    { y: 26, autoAlpha: 0 },
                    { y: 0, autoAlpha: 1, duration: 0.55, stagger: 0.07,
                      ease: 'power2.out', clearProps: 'transform,opacity,visibility' });
            }
            ScrollTrigger.refresh();
        };
    }

    // ── 5. The header logo answers scroll (tiny, constant delight) ─────
    function initHeaderShift() {
        const header = document.querySelector('.header-container');
        if (!header) return;
        ScrollTrigger.create({
            start: 'top -80',
            onUpdate(self) {
                header.classList.toggle('scrolled', self.scroll() > 80);
            }
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        initLandingStage();
        initReveals();
        initTilt(document);
        watchDynamicContent();
        hookPageTransitions();
        initHeaderShift();
        // Late layout shifts (fonts, maps, fetched lists) move trigger points
        setTimeout(() => ScrollTrigger.refresh(), 800);
    });
})();
