// CityBus Tracker — rider assist features
//
// Everything here helps a person actually USE the bus, built only on data the
// app already has (schedules, live ETAs, geometry):
//   1. Next departures  — computed from firstBus/lastBus/frequency vs the clock,
//                         shown on bus cards, stop popups and the favorites strip.
//   2. Favorite routes  — starred routes pinned to the home page (localStorage),
//                         each with a live "next bus in X min" countdown.
//   3. Arrival alerts   — "Alert me": a browser notification (with toast
//                         fallback) fired when the tracked bus is ≤5 min away.
//   4. Share trip       — Web Share / clipboard: send your bus + ETA to family,
//                         or a whole journey plan.
//   5. Fare & CO₂       — estimated ticket price and CO₂ saved vs driving,
//                         shown on every journey plan.
//   6. Helplines        — one-tap emergency numbers from the navbar.
//
// Each feature degrades gracefully: no Notification API → toasts; no Web Share
// → clipboard → prompt; no localStorage → favorites just don't persist.

(() => {
    'use strict';

    /* ── 1. Next departures (pure schedule math) ─────────────────────── */

    function hhmmToMin(hhmm) {
        const [h, m] = String(hhmm).split(':').map(Number);
        return h * 60 + m;
    }
    function minToLabel(totalMin) {
        const h = Math.floor(totalMin / 60) % 24;
        const m = totalMin % 60;
        const suffix = h >= 12 ? 'PM' : 'AM';
        const h12 = h % 12 === 0 ? 12 : h % 12;
        return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
    }

    /**
     * Upcoming departures from the route's origin terminal.
     * @returns [{atMin, label, inMin}] — empty if service has ended for today.
     */
    function nextDepartures(route, count = 2) {
        if (!route || !route.firstBus || !route.frequencyMinutes) return [];
        const now = new Date();
        const nowMin = now.getHours() * 60 + now.getMinutes();
        const first = hhmmToMin(route.firstBus);
        const last = hhmmToMin(route.lastBus || route.firstBus);
        const freq = route.frequencyMinutes;

        let k = nowMin <= first ? 0 : Math.ceil((nowMin - first) / freq);
        const out = [];
        while (out.length < count) {
            const t = first + k * freq;
            if (t > last) break;
            out.push({ atMin: t, label: minToLabel(t), inMin: Math.max(0, t - nowMin) });
            k++;
        }
        return out;
    }

    /** One-line label for bus cards: "Next bus ≈ 5:40 PM (in 12 min)". */
    function nextDepartureLabel(routeId) {
        const route = window.busRoutes && window.busRoutes[routeId];
        const deps = nextDepartures(route, 1);
        if (!deps.length) {
            return route ? `Service ended — first bus ${formatTime12h(route.firstBus)}` : 'Schedule unavailable';
        }
        const d = deps[0];
        return d.inMin === 0 ? `Next bus ≈ now (${d.label})`
                             : `Next bus ≈ ${d.label} (in ${d.inMin} min)`;
    }

    /** Small block for stop-marker popups: the next two departures. */
    function nextDeparturesHtml(route) {
        const deps = nextDepartures(route, 2);
        if (!deps.length) return `<div class="popup-deps">Service ended for today</div>`;
        return `<div class="popup-deps"><i class="fas fa-clock"></i> Next: ${
            deps.map(d => `<b>${d.label}</b>`).join(' · ')}</div>`;
    }

    /* ── 2. Favorite routes ──────────────────────────────────────────── */

    const FAV_KEY = 'cb:favRoutes';

    function getFavs() {
        try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); }
        catch { return []; }
    }
    function saveFavs(list) {
        try { localStorage.setItem(FAV_KEY, JSON.stringify(list)); } catch { /* private mode */ }
    }
    function isFavRoute(routeId) {
        return getFavs().includes(String(routeId));
    }
    function toggleFavRoute(routeId, btnEl) {
        const id = String(routeId);
        let favs = getFavs();
        const adding = !favs.includes(id);
        favs = adding ? [...favs, id] : favs.filter(f => f !== id);
        saveFavs(favs);
        if (btnEl) {
            btnEl.classList.toggle('active', adding);
            const icon = btnEl.querySelector('i');
            if (icon) icon.className = adding ? 'fas fa-star' : 'far fa-star';
        }
        showNotification(adding
            ? `Route ${id} saved — it's pinned on your home page`
            : `Route ${id} removed from saved routes`, 'info');
        renderFavStrip();
    }

    function renderFavStrip() {
        const strip = document.getElementById('fav-strip');
        if (!strip || !window.busRoutes) return;
        const favs = getFavs().filter(id => window.busRoutes[id]);
        if (!favs.length) { strip.style.display = 'none'; strip.innerHTML = ''; return; }

        strip.innerHTML = `<div class="fav-strip-head">
                <span class="section-eyebrow" style="margin-bottom:0">Saved routes</span>
            </div>` +
            favs.map(id => {
                const r = window.busRoutes[id];
                const deps = nextDepartures(r, 1);
                const next = deps.length
                    ? (deps[0].inMin === 0 ? 'due now' : `in ${deps[0].inMin} min`)
                    : 'service ended';
                return `
                <div class="fav-chip" data-route="${id}" role="button" tabindex="0"
                     aria-label="Track route ${id} ${escapeHtml(r.name)}">
                    <span class="route-chip" style="--chip-color:${r.color}">${id}</span>
                    <span class="fav-name">${escapeHtml(r.name)}</span>
                    <span class="fav-next"><i class="fas fa-clock"></i> ${next}</span>
                    <button class="fav-remove" data-route="${id}" aria-label="Remove saved route ${id}">
                        <i class="fas fa-xmark"></i>
                    </button>
                </div>`;
            }).join('');
        strip.style.display = '';

        strip.querySelectorAll('.fav-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                switchToPage('tracking');
                setTimeout(() => selectBusRoute(chip.dataset.route, null), 400);
            });
        });
        strip.querySelectorAll('.fav-remove').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                toggleFavRoute(btn.dataset.route, null);
                // also un-star any matching bus card
                document.querySelectorAll(`.fav-btn[data-route="${btn.dataset.route}"]`).forEach(b => {
                    b.classList.remove('active');
                    const i = b.querySelector('i');
                    if (i) i.className = 'far fa-star';
                });
            });
        });
    }

    /* ── 3. Arrival alert ("Alert me") ───────────────────────────────── */

    const etaNotify = {
        busId: null,
        thresholdMin: 5,
        fired: false,

        arm(busId) {
            this.busId = busId;
            this.fired = false;
            if ('Notification' in window && Notification.permission === 'default') {
                Notification.requestPermission().catch(() => {});
            }
            this.paint(true);
            showNotification(`You'll be alerted when ${busId.toUpperCase()} is ~${this.thresholdMin} min away`, 'info');
        },
        disarm(silent) {
            this.busId = null;
            this.fired = false;
            this.paint(false);
            if (!silent) showNotification('Arrival alert cancelled', 'info');
        },
        toggle(busId) {
            if (this.busId === busId) this.disarm(); else this.arm(busId);
        },
        /** Called by eta.js on every live ETA recomputation. */
        check(busId, etaMins) {
            if (this.fired || !this.busId || this.busId !== busId || etaMins == null) return;
            if (etaMins <= this.thresholdMin) {
                this.fired = true;
                const msg = `${busId.toUpperCase()} is about ${etaMins} min away — head to your stop!`;
                if ('Notification' in window && Notification.permission === 'granted') {
                    try { new Notification('🚌 Your bus is close', { body: msg }); } catch { /* fall through */ }
                }
                showNotification(msg, 'warning');
                this.paint(false);
                this.busId = null;
            }
        },
        paint(on) {
            const btn = document.getElementById('eta-notify-btn');
            const lbl = document.getElementById('eta-notify-label');
            if (!btn) return;
            btn.classList.toggle('armed', on);
            const icon = btn.querySelector('i');
            if (icon) icon.className = on ? 'fas fa-bell' : 'far fa-bell';
            if (lbl) lbl.textContent = on ? 'Alert set' : 'Alert me';
        }
    };

    /* ── 4. Share trip ───────────────────────────────────────────────── */

    async function shareTrip(text) {
        const payload = { title: 'CityBus Tracker', text };
        try {
            if (navigator.share) { await navigator.share(payload); return; }
        } catch (err) {
            if (err && err.name === 'AbortError') return; // user closed the sheet
        }
        try {
            await navigator.clipboard.writeText(text);
            showNotification('Trip details copied — paste them anywhere', 'success');
        } catch {
            window.prompt('Copy your trip details:', text);
        }
    }

    function shareEtaNow() {
        const info = window.lastEtaInfo;
        if (!info || info.etaMins == null) {
            showNotification('Track a live bus first, then share its ETA', 'info');
            return;
        }
        const arr = new Date(Date.now() + info.etaMins * 60000)
            .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        shareTrip(`I'm taking ${info.busId.toUpperCase()} (${info.routeName}). ` +
            `It's ${info.distKm < 1 ? Math.round(info.distKm * 1000) + ' m' : info.distKm.toFixed(1) + ' km'} away, ` +
            `arriving around ${arr}. Live map: ${location.origin}`);
    }

    /* ── 5. Fare & CO₂ estimates ─────────────────────────────────────── */

    // City-bus style tariff: ₹10 covers the first 2 km, ₹2/km after (estimate).
    function estimateFare(rideKm) {
        if (!rideKm || rideKm <= 0) return 0;
        return Math.round(Math.max(10, 10 + Math.max(0, rideKm - 2) * 2));
    }
    // ~100 g CO₂ saved per passenger-km vs an average petrol car (estimate).
    function co2SavedKg(rideKm) {
        return Math.max(0, rideKm) * 0.10;
    }

    /* ── 6. Helpline modal ───────────────────────────────────────────── */

    function initHelpline() {
        const modal = document.getElementById('helpline-modal');
        const open = document.getElementById('helpline-btn');
        const close = document.getElementById('helpline-close');
        if (!modal || !open) return;
        open.addEventListener('click', () => modal.classList.add('open'));
        if (close) close.addEventListener('click', () => modal.classList.remove('open'));
        modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') modal.classList.remove('open');
        });
    }

    /* ── Wiring ──────────────────────────────────────────────────────── */

    document.addEventListener('DOMContentLoaded', () => {
        initHelpline();

        const notifyBtn = document.getElementById('eta-notify-btn');
        if (notifyBtn) notifyBtn.addEventListener('click', () => {
            const busId = window.lastEtaInfo && window.lastEtaInfo.busId;
            if (!busId) { showNotification('Track a live bus first', 'info'); return; }
            etaNotify.toggle(busId);
        });

        const shareBtn = document.getElementById('eta-share-btn');
        if (shareBtn) shareBtn.addEventListener('click', shareEtaNow);

        // Favorites strip appears once the route network is in
        if (typeof loadBusRoutes === 'function') {
            loadBusRoutes().then(renderFavStrip);
        }
        // Countdowns stay honest across minutes
        setInterval(renderFavStrip, 60_000);
    });

    /* ── Exports used by script.js / planner.js / eta.js ─────────────── */
    window.nextDepartures = nextDepartures;
    window.nextDepartureLabel = nextDepartureLabel;
    window.nextDeparturesHtml = nextDeparturesHtml;
    window.isFavRoute = isFavRoute;
    window.toggleFavRoute = toggleFavRoute;
    window.renderFavStrip = renderFavStrip;
    window.etaNotify = etaNotify;
    window.shareTrip = shareTrip;
    window.estimateFare = estimateFare;
    window.co2SavedKg = co2SavedKg;
})();
