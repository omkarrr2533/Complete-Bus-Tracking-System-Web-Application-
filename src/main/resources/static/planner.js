// CityBus Tracker — Journey planner client
// Talks to GET /api/v1/journeys (Dijkstra over the stop graph, server-side).
// Origin/destination come from stop pickers, geolocation, or two map clicks.

(() => {
    'use strict';

    let plannerMap = null;
    let legLayers = [];
    let pickMarkers = { from: null, to: null };
    let mapPick = { from: null, to: null, next: 'from' };

    const $ = id => document.getElementById(id);

    // ── Setup ──────────────────────────────────────────────────────────
    function initPlannerMap() {
        if (plannerMap) { plannerMap.invalidateSize(); return; }
        const el = $('planner-map');
        if (!el) return;

        plannerMap = L.map('planner-map').setView([19.8762, 75.3433], 12);
        window.addThemedTiles(plannerMap);

        // Faint network underlay so users see where the buses go
        loadBusRoutes().then(routes => {
            Object.values(routes).forEach(route => {
                if (!route.active) return;
                L.polyline(route.path, { color: route.color, weight: 2, opacity: 0.35 }).addTo(plannerMap);
            });
        });

        plannerMap.on('click', e => {
            const { lat, lng } = e.latlng;
            setPickedPoint(mapPick.next, [lat, lng]);
            mapPick.next = mapPick.next === 'from' ? 'to' : 'from';
        });
    }

    function setPickedPoint(which, coords) {
        mapPick[which] = coords;
        const select = $(which === 'from' ? 'planner-from' : 'planner-to');
        ensureMapPointOption(select, which);
        select.value = `map:${which}`;

        if (pickMarkers[which]) plannerMap.removeLayer(pickMarkers[which]);
        pickMarkers[which] = L.marker(coords, {
            icon: L.divIcon({
                className: 'pick-marker',
                html: `<div class="pick-pin pick-pin-${which}">${which === 'from' ? 'A' : 'B'}</div>`,
                iconSize: [28, 28], iconAnchor: [14, 26]
            })
        }).addTo(plannerMap);
        showNotification(`${which === 'from' ? 'Origin' : 'Destination'} set on the map`, 'info');
    }

    function ensureMapPointOption(select, which) {
        if (![...select.options].some(o => o.value === `map:${which}`)) {
            const opt = document.createElement('option');
            opt.value = `map:${which}`;
            opt.textContent = `🗺 Point picked on map (${which === 'from' ? 'A' : 'B'})`;
            select.insertBefore(opt, select.options[1] || null);
        }
    }

    // Fill the pickers with every stop on the network (deduped by name)
    function populateStopPickers() {
        loadBusRoutes().then(routes => {
            const seen = new Map();
            Object.values(routes).forEach(route => {
                if (!route.active) return;
                route.stops.forEach(stop => {
                    if (!seen.has(stop.name)) seen.set(stop.name, stop.coords);
                });
            });
            const options = [...seen.entries()]
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([name, coords]) => `<option value="${coords[0]},${coords[1]}">${name}</option>`)
                .join('');
            $('planner-from').innerHTML =
                '<option value="my-location">📍 My current location</option>' + options;
            $('planner-to').innerHTML =
                '<option value="">Choose a destination stop…</option>' + options;
        });
    }

    // ── Resolution ─────────────────────────────────────────────────────
    function resolvePoint(value, which) {
        if (value === 'my-location') {
            return new Promise((resolve, reject) => {
                if (userLocation) return resolve([userLocation.lat, userLocation.lng]);
                if (!navigator.geolocation) return reject(new Error('Location unavailable — pick a stop instead'));
                navigator.geolocation.getCurrentPosition(
                    pos => resolve([pos.coords.latitude, pos.coords.longitude]),
                    () => reject(new Error('Could not read your location — pick a stop instead')),
                    { enableHighAccuracy: true, timeout: 8000 });
            });
        }
        if (value.startsWith('map:')) {
            const coords = mapPick[which];
            return coords ? Promise.resolve(coords)
                          : Promise.reject(new Error('Click the map to set that point first'));
        }
        if (!value) return Promise.reject(new Error('Choose a destination'));
        const [lat, lng] = value.split(',').map(Number);
        return Promise.resolve([lat, lng]);
    }

    // ── Planning ───────────────────────────────────────────────────────
    async function planJourney() {
        const btn = $('planner-go');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Planning…';
        try {
            const [from, to] = await Promise.all([
                resolvePoint($('planner-from').value, 'from'),
                resolvePoint($('planner-to').value, 'to')
            ]);
            const query = `fromLat=${from[0]}&fromLng=${from[1]}&toLat=${to[0]}&toLng=${to[1]}`;
            const res = await fetch(`/api/v1/journeys?${query}`, { headers: { Accept: 'application/json' } });
            const body = await res.json();
            if (!res.ok) throw new Error(body.message || 'Journey planning failed');
            renderJourney(body);
        } catch (err) {
            $('journey-result').style.display = 'none';
            clearLegLayers();
            showNotification(err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-diagram-project"></i> Find the fastest journey';
        }
    }

    // ── Rendering ──────────────────────────────────────────────────────
    function renderJourney(plan) {
        $('journey-result').style.display = 'block';

        $('journey-summary').innerHTML = `
            <div class="summary-cell">
                <span class="summary-num">${Math.round(plan.totalMinutes)}</span>
                <span class="summary-lbl">minutes</span>
            </div>
            <div class="summary-sep"></div>
            <div class="summary-cell">
                <span class="summary-num">${plan.totalKm.toFixed(1)}</span>
                <span class="summary-lbl">km</span>
            </div>
            <div class="summary-sep"></div>
            <div class="summary-cell">
                <span class="summary-num">${plan.transfers}</span>
                <span class="summary-lbl">transfer${plan.transfers === 1 ? '' : 's'}</span>
            </div>
            <div class="summary-route">${escapeHtml(plan.summary)}</div>`;

        $('journey-legs').innerHTML = plan.legs.map((leg, i) => legHtml(leg, i)).join('');
        drawLegsOnMap(plan.legs);
    }

    function legHtml(leg, index) {
        const duration = leg.durationMinutes < 1 ? '&lt;1' : Math.round(leg.durationMinutes);
        if (leg.mode === 'WALK') {
            return `
            <div class="journey-leg leg-walk" style="animation-delay:${index * 90}ms">
                <div class="leg-icon walk"><i class="fas fa-person-walking"></i></div>
                <div class="leg-body">
                    <div class="leg-title">Walk to <strong>${escapeHtml(leg.toName)}</strong></div>
                    <div class="leg-meta">${duration} min · ${(leg.distanceKm * 1000).toFixed(0)} m</div>
                </div>
            </div>`;
        }
        return `
        <div class="journey-leg leg-ride" style="animation-delay:${index * 90}ms">
            <div class="leg-icon ride" style="--leg-color:${leg.routeColor}"><i class="fas fa-bus-simple"></i></div>
            <div class="leg-body">
                <div class="leg-title">
                    <span class="route-chip" style="--chip-color:${leg.routeColor}">${leg.routeNumber}</span>
                    <strong>${escapeHtml(leg.fromName)}</strong> → <strong>${escapeHtml(leg.toName)}</strong>
                </div>
                <div class="leg-meta">
                    ${duration} min · ${leg.stopCount} stop${leg.stopCount === 1 ? '' : 's'} · ${leg.distanceKm.toFixed(1)} km
                    ${leg.waitMinutes != null ? ` · wait ≈${Math.round(leg.waitMinutes)} min` : ''}
                </div>
            </div>
        </div>`;
    }

    function drawLegsOnMap(legs) {
        if (!plannerMap) return;
        clearLegLayers();
        const bounds = [];
        legs.forEach(leg => {
            if (!leg.geometry || leg.geometry.length < 2) return;
            const line = leg.mode === 'WALK'
                ? L.polyline(leg.geometry, { color: '#64748b', weight: 4, opacity: 0.8, dashArray: '2 8', lineCap: 'round' })
                : L.polyline(leg.geometry, { color: leg.routeColor || '#1d4ed8', weight: 6, opacity: 0.9, lineCap: 'round' });
            line.addTo(plannerMap);
            legLayers.push(line);
            leg.geometry.forEach(p => bounds.push(p));
        });
        // Endpoint pins
        const first = legs[0]?.geometry?.[0];
        const lastLeg = legs[legs.length - 1];
        const last = lastLeg?.geometry?.[lastLeg.geometry.length - 1];
        [[first, 'A', 'from'], [last, 'B', 'to']].forEach(([pt, label, cls]) => {
            if (!pt) return;
            const marker = L.marker(pt, {
                icon: L.divIcon({
                    className: 'pick-marker',
                    html: `<div class="pick-pin pick-pin-${cls}">${label}</div>`,
                    iconSize: [28, 28], iconAnchor: [14, 26]
                })
            }).addTo(plannerMap);
            legLayers.push(marker);
        });
        if (bounds.length) plannerMap.fitBounds(bounds, { padding: [40, 40] });
    }

    function clearLegLayers() {
        legLayers.forEach(layer => plannerMap && plannerMap.removeLayer(layer));
        legLayers = [];
    }

    // ── Wiring ─────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        const goBtn = $('planner-go');
        if (!goBtn) return;

        goBtn.addEventListener('click', planJourney);

        $('planner-swap').addEventListener('click', () => {
            const from = $('planner-from');
            const to = $('planner-to');
            ensureMapPointOption(from, 'from');
            ensureMapPointOption(to, 'to');
            const fromVal = from.value === 'my-location' ? '' : from.value;
            const toVal = to.value;
            // Swap coordinates too if both are map picks
            [mapPick.from, mapPick.to] = [mapPick.to, mapPick.from];
            from.value = toVal.startsWith('map:') ? 'map:from' : (toVal || 'my-location');
            to.value = fromVal.startsWith('map:') ? 'map:to' : fromVal;
        });

        const homePlanBtn = $('plan-now-btn');
        if (homePlanBtn) homePlanBtn.addEventListener('click', () => switchToPage('planner'));

        // Init the map when the planner page becomes visible
        const plannerSection = $('planner');
        new MutationObserver(() => {
            if (plannerSection.classList.contains('active')) {
                setTimeout(() => { initPlannerMap(); populateStopPickers(); }, 100);
            }
        }).observe(plannerSection, { attributes: true, attributeFilter: ['class'] });
    });
})();
