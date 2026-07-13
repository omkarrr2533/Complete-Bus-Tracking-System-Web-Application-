// CityBus Tracker — Rider application
// Data flows: REST API (/api/v1) for the route network + fleet,
// WebSocket (/websocket) for live positions, speed and proximity alerts.

let trackingMap = null;
let homeMap = null;
let busMarkers = {};
let userMarker = null;
let routeLayers = {};
let selectedBusRoute = null;
let ws = null;
let currentUser = null;
let userLocation = null;
let routesLoaded = null;   // promise so map init can await the network data

// Live measured speed per bus (km/h), fed by WebSocket updates; eta.js reads this.
window.liveBusSpeeds = {};

// ── API helper ──
async function apiGet(path) {
    const res = await fetch(path, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
    return res.json();
}

// ── Route road geometry ─────────────────────────────────────────────
// Snapping through the sparse `path` waypoints makes OSRM take big detours
// (a divided-road waypoint snaps to the wrong carriageway). Routing through
// the STOPS instead yields a clean, sensible line that visibly passes through
// every stop and clearly starts/ends at the terminals. The result is memoised
// on the route so the ETA highlight can reuse the exact same road geometry.
function routeStopCoords(route) {
    return route.stops.map(s => s.coords);
}

function getRouteRoadGeom(route) {
    if (route.roadGeomPromise) return route.roadGeomPromise;
    const stops = routeStopCoords(route);
    const p = (typeof window.snapToRoads === 'function')
        ? window.snapToRoads(stops).catch(() => stops)
        : Promise.resolve(stops);
    route.roadGeomPromise = p.then(geom => { route.roadGeom = geom; return geom; });
    return route.roadGeomPromise;
}

// Draw a route: instant straight line through its stops, upgraded to the
// road-snapped geometry as soon as it resolves. Never breaks — worst case it
// stays the stop-to-stop line.
function drawRoutePolyline(map, route, options) {
    const stops = routeStopCoords(route);
    const line = L.polyline(stops, options).addTo(map);
    getRouteRoadGeom(route).then(geom => { if (map.hasLayer(line)) line.setLatLngs(geom); });
    return line;
}

// ── Occupancy presentation ──
const OCCUPANCY_META = {
    LOW:    { label: 'Seats available', cls: 'occupancy-low',    icon: 'fa-chair' },
    MEDIUM: { label: 'Filling up',      cls: 'occupancy-medium', icon: 'fa-users' },
    FULL:   { label: 'Full — standing', cls: 'occupancy-full',   icon: 'fa-users-line' }
};
window.liveBusOccupancy = {};

function occupancyBadgeHtml(level) {
    const meta = OCCUPANCY_META[level];
    if (!meta) return '';
    return `<span class="occupancy-badge ${meta.cls}"><i class="fas ${meta.icon}"></i> ${meta.label}</span>`;
}

// ── Service alerts banner ──
function loadAlerts() {
    apiGet('/api/v1/alerts')
        .then(renderAlertsBanner)
        .catch(() => { /* banner is best-effort */ });
}

function renderAlertsBanner(alerts) {
    const banner = document.getElementById('alerts-banner');
    if (!banner) return;
    const dismissed = new Set(JSON.parse(sessionStorage.getItem('dismissedAlerts') || '[]'));
    const visible = alerts.filter(a => !dismissed.has(a.id));
    banner.innerHTML = visible.map(a => `
        <div class="alert-strip alert-${a.severity.toLowerCase()}" data-alert-id="${a.id}">
            <i class="fas ${a.severity === 'CRITICAL' ? 'fa-triangle-exclamation'
                          : a.severity === 'WARNING' ? 'fa-circle-exclamation' : 'fa-circle-info'}"></i>
            ${a.routeNumber != null ? `<span class="route-chip" style="--chip-color:${a.routeColor || 'var(--primary)'}">${a.routeNumber}</span>` : ''}
            <div class="alert-copy">
                <strong>${escapeHtml(a.title)}</strong>
                <span>${escapeHtml(a.message)}</span>
            </div>
            <button class="alert-dismiss" aria-label="Dismiss alert" data-dismiss-alert="${a.id}">
                <i class="fas fa-xmark"></i>
            </button>
        </div>`).join('');

    banner.querySelectorAll('[data-dismiss-alert]').forEach(btn => {
        btn.addEventListener('click', () => {
            dismissed.add(Number(btn.dataset.dismissAlert));
            sessionStorage.setItem('dismissedAlerts', JSON.stringify([...dismissed]));
            const strip = btn.closest('.alert-strip');
            strip.classList.add('leaving');
            setTimeout(() => strip.remove(), 300);
        });
    });
}

// ── Theme (night depot by default; paper timetable on toggle) ──
function initDarkModeToggle() {
    const toggle = document.getElementById('dark-mode-toggle');
    const icon   = document.getElementById('theme-icon');
    if (!toggle || !icon) return;

    const saved = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    icon.className = saved === 'dark' ? 'fas fa-sun' : 'fas fa-moon';

    toggle.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme');
        const next    = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('theme', next);
        icon.className = next === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
        refreshMapTiles();
    });
}

// ── Theme-aware map tiles (dark depot ↔ paper) ──
const TILE_THEMES = {
    light: {
        url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
    },
    dark: {
        url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
    }
};
const themedMaps = [];

function addThemedTiles(map) {
    const theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const spec = TILE_THEMES[theme];
    const layer = L.tileLayer(spec.url, { attribution: spec.attribution, maxZoom: 19 }).addTo(map);
    themedMaps.push({ map, layer });
}
window.addThemedTiles = addThemedTiles; // planner.js reuses this

function refreshMapTiles() {
    const theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const spec = TILE_THEMES[theme];
    themedMaps.forEach(entry => {
        entry.map.removeLayer(entry.layer);
        entry.layer = L.tileLayer(spec.url, { attribution: spec.attribution, maxZoom: 19 }).addTo(entry.map);
    });
}

// ── Navigation ──
function switchToPage(pageName) {
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.toggle('active', link.getAttribute('data-page') === pageName);
    });
    document.querySelectorAll('.page').forEach(page => {
        const isTarget = page.id === pageName;
        page.classList.toggle('active', isTarget);
        if (isTarget && pageName === 'tracking') {
            setTimeout(() => initTrackingMap(), 100);
        }
        if (isTarget && pageName === 'home' && !homeMap) {
            setTimeout(() => initHomeMap(), 100);
        }
    });
    window.scrollTo(0, 0);
}

function setupNavigation() {
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', e => {
            const page = link.getAttribute('data-page');
            if (!page) return; // real links (driver/admin) navigate normally
            e.preventDefault();
            switchToPage(page);
        });
    });

    document.querySelectorAll('[data-page]').forEach(el => {
        if (!el.classList.contains('nav-link')) {
            el.addEventListener('click', e => {
                e.preventDefault();
                const page = el.getAttribute('data-page');
                if (page) switchToPage(page);
            });
        }
    });
}

// ── Buttons and forms ──
function setupNavigationAndButtons() {
    const trackNowBtn = document.getElementById('track-now-btn');
    if (trackNowBtn) {
        trackNowBtn.addEventListener('click', e => {
            e.preventDefault();
            switchToPage('tracking');
        });
    }

    const searchBtn = document.getElementById('search-btn');
    if (searchBtn) {
        searchBtn.addEventListener('click', e => {
            e.preventDefault();
            performBusSearch();
        });
    }

    const contactForm = document.getElementById('contact-form');
    if (contactForm) {
        contactForm.addEventListener('submit', e => {
            e.preventDefault();
            handleContactFormSubmit();
        });
    }

    setupFAQ();
}

function setupFAQ() {
    document.querySelectorAll('.faq-question').forEach(q => {
        q.addEventListener('click', () => {
            const item     = q.closest('.faq-item');
            const isActive = item.classList.contains('active');
            document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('active'));
            if (!isActive) item.classList.add('active');
        });
    });
}

// ── Session ──
function autoLoginUser() {
    currentUser = { username: 'Guest User', role: 'user', isAuthenticated: true };
    updateUserInterface();
    sessionStorage.setItem('currentUser', JSON.stringify(currentUser));
}

function updateUserInterface() {
    const userInfo       = document.getElementById('user-info');
    const userStatusText = document.getElementById('user-status-text');
    if (userInfo && userStatusText) {
        userInfo.style.display = 'block';
        userStatusText.textContent = currentUser ? currentUser.username : 'Guest';
    }
}

function checkExistingSession() {
    const saved = sessionStorage.getItem('currentUser');
    if (saved) {
        try { currentUser = JSON.parse(saved); updateUserInterface(); }
        catch { autoLoginUser(); }
    } else {
        autoLoginUser();
    }
}

// ── Route network (fetched from the API — reflects admin CRUD changes) ──
function loadBusRoutes() {
    if (routesLoaded) return routesLoaded;
    routesLoaded = apiGet('/api/v1/routes')
        .then(routes => {
            window.busRoutes = {};
            routes.forEach(r => {
                window.busRoutes[String(r.routeNumber)] = {
                    id: r.id,
                    name: r.name,
                    color: r.color,
                    path: r.path,
                    firstBus: r.firstBus,
                    lastBus: r.lastBus,
                    frequencyMinutes: r.frequencyMinutes,
                    active: r.active,
                    stops: r.stops.map(s => ({ name: s.name, coords: [s.lat, s.lng] }))
                };
            });
            renderRoutesTable(routes);
            renderRouteFilter(routes);
            renderSchedule(routes);
            return window.busRoutes;
        })
        .catch(err => {
            console.error('Failed to load routes', err);
            showNotification('Could not load route data. Is the server running?', 'error');
            window.busRoutes = {};
            return window.busRoutes;
        });
    return routesLoaded;
}

// ── Routes page table ──
function renderRoutesTable(routes) {
    const tbody = document.getElementById('routes-table-body');
    if (!tbody) return;
    tbody.innerHTML = routes.map(r => `
        <tr data-route-id="${r.routeNumber}" class="fade-in-row">
            <td><span class="route-chip" style="--chip-color:${r.color}">${r.routeNumber}</span></td>
            <td>${escapeHtml(r.name)}</td>
            <td>${r.stops.length}</td>
            <td>${r.frequencyMinutes} mins</td>
            <td>${formatTime12h(r.firstBus)}</td>
            <td>${formatTime12h(r.lastBus)}</td>
            <td><span class="badge ${r.active ? 'badge-success' : 'badge-muted'}">${r.active ? 'Active' : 'Suspended'}</span></td>
        </tr>`).join('');
}

function renderRouteFilter(routes) {
    const sel = document.getElementById('route-filter');
    if (!sel) return;
    sel.innerHTML = '<option value="all">All Routes</option>' + routes.map(r =>
        `<option value="${r.routeNumber}">Route ${r.routeNumber}: ${escapeHtml(r.name)}</option>`).join('');
}

// ── Schedule page (derived from live route data) ──
function renderSchedule(routes) {
    const filters   = document.getElementById('schedule-filters');
    const container = document.getElementById('schedule-container');
    if (!filters || !container) return;

    filters.innerHTML = '<button class="schedule-filter-btn active" data-route="all">All Routes</button>' +
        routes.map(r => `<button class="schedule-filter-btn" data-route="${r.routeNumber}">Route ${r.routeNumber}</button>`).join('');

    container.innerHTML = routes.map(r => {
        const stopRows = r.stops.slice(0, 5).map((s, i) => `
            <li>
                <span class="stop-name">${escapeHtml(s.name)}</span>
                <span class="stop-time">${formatTime12h(addMinutes(r.firstBus, i * r.frequencyMinutes))}</span>
            </li>`).join('');
        const busesPerDay = estimateBusesPerDay(r.firstBus, r.lastBus, r.frequencyMinutes);
        return `
        <div class="schedule-card" data-route="${r.routeNumber}">
            <div class="schedule-header" style="--route-color:${r.color}">
                <h3>Route ${r.routeNumber}: ${escapeHtml(r.name)}</h3>
                <div class="schedule-time">${formatTime12h(r.firstBus)} - ${formatTime12h(r.lastBus)}</div>
            </div>
            <div class="schedule-content">
                <ul class="schedule-stops">${stopRows}</ul>
                <div class="route-stats">
                    <div class="stat-item"><div class="stat-value">${r.stops.length}</div><div class="stat-label">Total Stops</div></div>
                    <div class="stat-item"><div class="stat-value">${r.frequencyMinutes}</div><div class="stat-label">Min Frequency</div></div>
                    <div class="stat-item"><div class="stat-value">${busesPerDay}</div><div class="stat-label">Buses/Day</div></div>
                </div>
            </div>
        </div>`;
    }).join('');

    filters.querySelectorAll('.schedule-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            filters.querySelectorAll('.schedule-filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const route = btn.getAttribute('data-route');
            container.querySelectorAll('.schedule-card').forEach(card => {
                card.style.display = (route === 'all' || card.getAttribute('data-route') === route) ? '' : 'none';
            });
        });
    });
}

function addMinutes(hhmm, minutes) {
    const [h, m] = hhmm.split(':').map(Number);
    const total = (h * 60 + m + minutes) % (24 * 60);
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function formatTime12h(hhmm) {
    if (!hhmm) return '--';
    const [h, m] = hhmm.split(':').map(Number);
    const suffix = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return `${hour12}:${String(m).padStart(2, '0')} ${suffix}`;
}

function estimateBusesPerDay(firstBus, lastBus, frequencyMinutes) {
    const [fh, fm] = firstBus.split(':').map(Number);
    const [lh, lm] = lastBus.split(':').map(Number);
    const span = (lh * 60 + lm) - (fh * 60 + fm);
    return span > 0 ? Math.floor(span / frequencyMinutes) : 0;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text ?? '';
    return div.innerHTML;
}

// ── Home map ──
function initHomeMap() {
    const el = document.getElementById('home-map');
    if (!el || homeMap) return;

    homeMap = L.map('home-map').setView([19.8762, 75.3433], 12);
    addThemedTiles(homeMap);

    loadBusRoutes().then(routes => {
        Object.values(routes).forEach(route => {
            if (!route.active) return;
            drawRoutePolyline(homeMap, route, { color: route.color, weight: 3, opacity: 0.6 });
            route.stops.forEach(s => {
                L.marker(s.coords, {
                    icon: L.divIcon({
                        className: 'stop-marker',
                        html: `<div style="background:${route.color};width:10px;height:10px;border-radius:50%;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3);"></div>`,
                        iconSize: [14, 14],
                        iconAnchor: [7, 7]
                    })
                }).addTo(homeMap).bindPopup(`<strong>${escapeHtml(s.name)}</strong><br><small>${escapeHtml(route.name)}</small>`);
            });
        });
    });
}

// ── Tracking map ──
function initTrackingMap() {
    const el = document.getElementById('tracking-map');
    if (!el) return;

    if (trackingMap) {
        trackingMap.invalidateSize();
        return;
    }

    trackingMap = L.map('tracking-map').setView([19.8762, 75.3433], 13);
    addThemedTiles(trackingMap);

    getUserLocation();
    loadBusRoutes().then(() => generateBusList());
    connectWebSocket();
}

// ── Geolocation ──
function getUserLocation() {
    if (!navigator.geolocation) {
        if (trackingMap) trackingMap.setView([19.8762, 75.3433], 13);
        return;
    }
    navigator.geolocation.getCurrentPosition(pos => {
        const { latitude, longitude } = pos.coords;
        userLocation = { lat: latitude, lng: longitude };
        if (!userMarker && trackingMap) {
            userMarker = L.marker([latitude, longitude], {
                icon: L.divIcon({
                    className: 'user-marker',
                    html: `<div style="background:#10b77f;width:16px;height:16px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 8px rgba(16,183,127,0.55);"></div>`,
                    iconSize: [22, 22],
                    iconAnchor: [11, 11]
                })
            }).addTo(trackingMap)
              .bindPopup(`<strong>Your Location</strong><br><small>${latitude.toFixed(5)}, ${longitude.toFixed(5)}</small>`);
            trackingMap.setView([latitude, longitude], 15);
            sendUserLocation(latitude, longitude);
        }
    }, () => {
        if (trackingMap) trackingMap.setView([19.8762, 75.3433], 13);
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
}

function sendUserLocation(lat, lng) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'user-location', data: { coords: [lat, lng], timestamp: Date.now() } }));
    }
}

// ── Bus list (fetched from the fleet API, live status merged in) ──
async function generateBusList() {
    const list = document.getElementById('bus-list');
    if (!list) return;

    list.innerHTML = Array.from({ length: 4 }, () =>
        '<div class="bus-card skeleton-card"><div class="skeleton skeleton-title"></div><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line short"></div></div>'
    ).join('');

    let buses;
    try {
        const page = await apiGet('/api/v1/buses?size=100');
        buses = page.content;
    } catch (err) {
        console.error('Failed to load buses', err);
        list.innerHTML = '<div class="empty-state"><i class="fas fa-bus"></i><p>Could not load the fleet. Check that the server is running.</p></div>';
        return;
    }

    if (!buses.length) {
        list.innerHTML = '<div class="empty-state"><i class="fas fa-bus"></i><p>No buses registered yet.</p></div>';
        return;
    }

    list.innerHTML = '';
    buses.forEach(bus => {
        const routeId = bus.routeNumber != null ? String(bus.routeNumber) : null;
        const online  = !!(bus.live && bus.live.visible && bus.live.coords);
        const card = document.createElement('div');
        card.className = 'bus-card';
        card.setAttribute('data-bus-id', bus.code);
        card.setAttribute('data-route-id', routeId ?? '');
        card.innerHTML = `
            <div class="bus-number">${escapeHtml(bus.code.toUpperCase())}</div>
            <div class="bus-route">Route ${bus.routeNumber ?? '—'} — ${escapeHtml(bus.routeName ?? 'Unassigned')}</div>
            <div class="bus-status ${online ? 'status-active' : 'status-offline'}">
                <i class="fas fa-circle" style="font-size:6px;"></i> ${online ? 'Live' : 'Offline'}
            </div>
            <div class="bus-occupancy">${online ? occupancyBadgeHtml(bus.live.occupancy) : ''}</div>
            <div class="bus-next-stop">${online && bus.live.speedKmh != null
                ? `Moving at ${bus.live.speedKmh} km/h`
                : `Every ${busFrequency(routeId)} min from ${busFirstBus(routeId)}`}</div>
            <button class="track-bus-btn" data-bus-id="${bus.code}" data-route-id="${routeId ?? ''}">
                <i class="fas fa-map-marker-alt"></i> Track This Bus
            </button>`;
        list.appendChild(card);

        if (online && bus.live.speedKmh != null) {
            window.liveBusSpeeds[bus.code] = bus.live.speedKmh;
        }
        if (online && bus.live.occupancy) {
            window.liveBusOccupancy[bus.code] = bus.live.occupancy;
        }

        card.querySelector('.track-bus-btn').addEventListener('click', e => {
            e.stopPropagation();
            if (routeId) trackBus(bus.code, routeId);
        });
        card.addEventListener('click', () => {
            if (routeId) selectBusRoute(routeId, bus.code);
        });
    });
}

function busFrequency(routeId) {
    return (routeId && window.busRoutes?.[routeId]?.frequencyMinutes) ?? '—';
}
function busFirstBus(routeId) {
    const t = routeId && window.busRoutes?.[routeId]?.firstBus;
    return t ? formatTime12h(t) : '--';
}

// ── Route display ──
function subscribeToRoute(routeId) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'subscribe-route',
            data: { routeNumber: routeId == null ? null : Number(routeId) }
        }));
    }
}

function trackBus(busId, routeId) {
    clearRouteSelection();
    showRoute(routeId);
    subscribeToRoute(routeId);
    showRouteLadder(routeId, busId);
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'track-bus', data: { busId } }));
    }
    if (typeof triggerETA === 'function') triggerETA(busId, routeId);
    showNotification(`Tracking ${busId.toUpperCase()} on ${window.busRoutes[routeId]?.name || 'Route ' + routeId}`);
}

function selectBusRoute(routeId, busId) {
    clearRouteSelection();
    showRoute(routeId);
    subscribeToRoute(routeId);
    showRouteLadder(routeId, busId);
    document.querySelectorAll('.bus-card').forEach(card => {
        card.classList.toggle('selected', card.getAttribute('data-bus-id') === busId);
    });
    selectedBusRoute = routeId;
    if (busId && typeof triggerETA === 'function') triggerETA(busId, routeId);
}

function showRoute(routeId) {
    if (!trackingMap || !window.busRoutes) return;
    const route = window.busRoutes[routeId];
    if (!route) return;

    const path = drawRoutePolyline(trackingMap, route, {
        color: route.color, weight: 5, opacity: 0.9,
        lineJoin: 'round', lineCap: 'round'
    });

    routeLayers[routeId] = { path, stops: [] };

    const lastIdx = route.stops.length - 1;
    route.stops.forEach((stop, i) => {
        const terminal = i === 0 ? 'start' : i === lastIdx ? 'end' : null;
        const m = L.marker(stop.coords, {
            icon: terminal ? terminalIcon(terminal, route.color) : stopDotIcon(route.color),
            zIndexOffset: terminal ? 1000 : 0
        }).addTo(trackingMap)
          .bindPopup(`<strong>${terminal === 'start' ? '🚩 Start · ' : terminal === 'end' ? '🏁 Terminus · ' : 'Stop ' + (i + 1) + ': '}${escapeHtml(stop.name)}</strong><br><small>${escapeHtml(route.name)}</small>`);
        routeLayers[routeId].stops.push(m);
    });

    const group = new L.featureGroup([path]);
    trackingMap.fitBounds(group.getBounds().pad(0.15));
}

// Plain interior stop bead
function stopDotIcon(color) {
    return L.divIcon({
        className: 'stop-marker',
        html: `<div style="background:${color};width:11px;height:11px;border-radius:50%;border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.25);"></div>`,
        iconSize: [16, 16], iconAnchor: [8, 8]
    });
}

// Distinct pin for the first (start) and last (terminus) stop
function terminalIcon(kind, color) {
    const label = kind === 'start' ? 'A' : 'B';
    return L.divIcon({
        className: 'terminal-marker',
        html: `<div style="position:relative;display:flex;align-items:center;justify-content:center;
                    width:26px;height:26px;border-radius:50% 50% 50% 2px;transform:rotate(45deg);
                    background:${color};border:2.5px solid #fff;box-shadow:0 3px 10px rgba(0,0,0,0.4);">
                    <span style="transform:rotate(-45deg);color:#fff;font-family:'JetBrains Mono',monospace;font-weight:700;font-size:12px;">${label}</span>
                </div>`,
        iconSize: [26, 26], iconAnchor: [13, 24]
    });
}

function clearRouteSelection() {
    Object.keys(routeLayers).forEach(id => {
        trackingMap.removeLayer(routeLayers[id].path);
        routeLayers[id].stops.forEach(m => trackingMap.removeLayer(m));
    });
    routeLayers = {};
    document.querySelectorAll('.bus-card').forEach(c => c.classList.remove('selected'));
    selectedBusRoute = null;
    subscribeToRoute(null); // widen live updates back to the whole network
    hideRouteLadder();
    if (typeof hideETAPanel === 'function') hideETAPanel();
}

// ── Live line diagram (route ladder) ──
let ladderState = null; // { routeId, busId, stopCumKm: number[], pathTotalKm }

function showRouteLadder(routeId, busId) {
    const ladder = document.getElementById('route-ladder');
    const route = window.busRoutes?.[routeId];
    if (!ladder || !route || !route.stops.length) return;

    const chip = document.getElementById('ladder-chip');
    chip.textContent = routeId;
    chip.style.setProperty('--chip-color', route.color);
    document.getElementById('ladder-route-name').textContent = route.name;
    document.getElementById('ladder-status').textContent = 'Waiting for a live bus…';

    const body = document.getElementById('ladder-body');
    body.innerHTML = `
        <div class="ladder-line" style="--route-color:${route.color}"></div>
        <div class="ladder-bus" id="ladder-bus" style="--route-color:${route.color}; display:none;">
            <i class="fas fa-bus-simple"></i>
        </div>` +
        route.stops.map((stop, i) => `
        <div class="ladder-stop" data-stop-index="${i}">
            <span class="ladder-bead" style="--route-color:${route.color}"></span>
            <span class="ladder-stop-name">${escapeHtml(stop.name)}</span>
        </div>`).join('');

    // Pre-compute each stop's along-path position for live interpolation
    const stopCumKm = route.stops.map(stop =>
        eta_cumKm(eta_routePos(stop.coords, route.path), route.path));
    ladderState = { routeId, busId, stopCumKm };

    ladder.style.display = 'flex';

    // If the bus is already live, place it immediately
    if (busId && busMarkers[busId]) {
        const ll = busMarkers[busId].getLatLng();
        updateLadderBusPosition(busId, [ll.lat, ll.lng]);
    }
}

function hideRouteLadder() {
    const ladder = document.getElementById('route-ladder');
    if (ladder) ladder.style.display = 'none';
    ladderState = null;
}

function updateLadderBusPosition(busId, coords) {
    if (!ladderState || (ladderState.busId && ladderState.busId !== busId)) return;
    const route = window.busRoutes?.[ladderState.routeId];
    const busEl = document.getElementById('ladder-bus');
    const body = document.getElementById('ladder-body');
    if (!route || !busEl || !body) return;

    const busKm = eta_cumKm(eta_routePos(coords, route.path), route.path);
    const cum = ladderState.stopCumKm;

    // Find the stop pair bracketing the bus, interpolate between their rows
    let seg = 0;
    while (seg < cum.length - 2 && busKm > cum[seg + 1]) seg++;
    const span = cum[seg + 1] - cum[seg];
    const t = span > 0 ? Math.max(0, Math.min(1, (busKm - cum[seg]) / span)) : 0;

    const rows = body.querySelectorAll('.ladder-stop');
    if (!rows.length) return;
    const rowA = rows[seg].offsetTop + rows[seg].offsetHeight / 2;
    const rowB = rows[Math.min(seg + 1, rows.length - 1)].offsetTop
               + rows[Math.min(seg + 1, rows.length - 1)].offsetHeight / 2;

    busEl.style.display = 'flex';
    busEl.style.top = `${rowA + t * (rowB - rowA) - 11}px`;

    rows.forEach((row, i) => row.classList.toggle('passed', cum[i] < busKm - 0.02));

    const speed = window.liveBusSpeeds[busId];
    document.getElementById('ladder-status').textContent =
        `${busId.toUpperCase()} — next: ${route.stops[Math.min(seg + 1, route.stops.length - 1)].name}`
        + (speed != null ? ` · ${speed} km/h` : '');
}

// ── Real-time bus updates ──
function updateBusLocations(busData) {
    if (!trackingMap || !Array.isArray(busData)) return;
    busData.forEach(bus => {
        if (!bus.coords || bus.coords.length < 2) return;
        const [lat, lng] = bus.coords;
        const id = bus.busId;
        if (bus.speedKmh != null) window.liveBusSpeeds[id] = bus.speedKmh;
        if (busMarkers[id]) {
            busMarkers[id].setLatLng([lat, lng]);
        } else {
            const color = bus.routeColor || '#34d399';
            const label = bus.routeNumber != null ? bus.routeNumber : 'B';
            const icon = L.divIcon({
                className: 'bus-marker',
                html: `<div style="background:${color};width:22px;height:22px;border-radius:7px;border:2.5px solid #fff;display:flex;align-items:center;justify-content:center;font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:600;color:#fff;box-shadow:0 0 0 2px ${color}55, 0 3px 10px rgba(0,0,0,0.45);">${label}</div>`,
                iconSize: [27, 27], iconAnchor: [13, 13]
            });
            busMarkers[id] = L.marker([lat, lng], { icon })
                .addTo(trackingMap)
                .bindPopup(`<strong>${escapeHtml(id.toUpperCase())}</strong><br>Driver: ${escapeHtml(bus.driverId || 'Unknown')}<br><small>Live tracking</small>`);
        }
        updateBusCardStatus(id, 'Live', bus.lastSeen ? new Date(bus.lastSeen) : null, bus.speedKmh);
    });
}

function updateBusCardStatus(busId, status, lastSeen, speedKmh) {
    const card = document.querySelector(`[data-bus-id="${busId}"]`);
    if (!card) return;
    const el = card.querySelector('.bus-status');
    const ns = card.querySelector('.bus-next-stop');
    if (el) {
        const cls = status === 'Live' ? 'status-active' : 'status-offline';
        el.className = `bus-status ${cls}`;
        el.innerHTML = `<i class="fas fa-circle" style="font-size:6px;"></i> ${status}`;
    }
    if (ns) {
        if (speedKmh != null) {
            ns.textContent = `Moving at ${speedKmh} km/h`;
        } else if (lastSeen) {
            const mins = Math.round((Date.now() - lastSeen.getTime()) / 60000);
            ns.textContent = mins <= 0 ? 'Updated just now' : `Updated ${mins} min ago`;
        }
    }
}

function updateSingleBusLocation(data) {
    if (data.coords && data.coords.length >= 2) {
        const id = data.busId;
        if (data.speedKmh != null) window.liveBusSpeeds[id] = data.speedKmh;
        if (data.occupancy) updateBusOccupancy(id, data.occupancy);
        if (busMarkers[id]) busMarkers[id].setLatLng(data.coords);
        else updateBusLocations([data]);
        updateBusCardStatus(id, 'Live', new Date(), data.speedKmh);
        updateLadderBusPosition(id, data.coords);
        if (typeof refreshETAIfActive === 'function') refreshETAIfActive(id, data.coords);
    }
}

function updateBusOccupancy(busId, level) {
    window.liveBusOccupancy[busId] = level;
    const card = document.querySelector(`[data-bus-id="${busId}"]`);
    const slot = card?.querySelector('.bus-occupancy');
    if (slot) slot.innerHTML = occupancyBadgeHtml(level);

    // Reflect in the ETA panel when this is the tracked bus
    const etaLabel = document.getElementById('eta-bus-label');
    if (etaLabel && etaLabel.textContent.toLowerCase() === busId.toLowerCase()) {
        const row = document.getElementById('eta-occupancy-row');
        const badge = document.getElementById('eta-occupancy-badge');
        const meta = OCCUPANCY_META[level];
        if (row && badge && meta) {
            row.style.display = 'flex';
            badge.className = `occupancy-badge ${meta.cls}`;
            badge.innerHTML = `<i class="fas ${meta.icon}"></i> ${meta.label}`;
        }
    }
}

function removeBusMarker(busId) {
    if (busId && busMarkers[busId]) {
        trackingMap.removeLayer(busMarkers[busId]);
        delete busMarkers[busId];
    }
    delete window.liveBusSpeeds[busId];
    updateBusCardStatus(busId, 'Offline', new Date(), null);
}

// ── WebSocket ──
function connectWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${location.host}/websocket`;
    try {
        ws = new WebSocket(url);
        ws.onopen = () => {
            ws.send(JSON.stringify({
                type: 'user-register',
                data: { userId: 'user-' + Math.random().toString(36).slice(2, 11), timestamp: Date.now() }
            }));
            if (userLocation) sendUserLocation(userLocation.lat, userLocation.lng);
        };
        ws.onmessage = e => {
            try { handleWebSocketMessage(JSON.parse(e.data)); }
            catch (err) { /* ignore parse errors */ }
        };
        ws.onclose = () => setTimeout(connectWebSocket, 5000);
        ws.onerror = () => {};
    } catch (e) { /* connection failed */ }
}

function handleWebSocketMessage(msg) {
    switch (msg.type) {
        case 'active-buses':        if (msg.data) updateBusLocations(msg.data); break;
        case 'bus-location-update': if (msg.data) updateSingleBusLocation(msg.data); break;
        case 'bus-occupancy-update': if (msg.data) updateBusOccupancy(msg.data.busId, msg.data.occupancy); break;
        case 'driver-left':         if (msg.data) removeBusMarker(msg.data.busId); break;
        case 'new-driver-available': generateBusList(); break;
        case 'tracking-started':    if (msg.data) showNotification(`Now tracking ${msg.data.busId.toUpperCase()}`); break;
        case 'proximity-alert':     if (msg.data) showNotification(msg.data.message, 'warning'); break;
    }
}

// ── Search and filter ──
function setupSearch() {
    const input = document.getElementById('route-search');
    if (!input) return;
    input.addEventListener('input', e => filterBusList(e.target.value.toLowerCase()));
    input.addEventListener('keypress', e => { if (e.key === 'Enter') performBusSearch(); });
}
function performBusSearch() {
    const input = document.getElementById('route-search');
    if (input) filterBusList(input.value.toLowerCase());
}
function filterBusList(term) {
    document.querySelectorAll('#bus-list .bus-card').forEach(card => {
        const num   = card.querySelector('.bus-number')?.textContent.toLowerCase() ?? '';
        const route = card.querySelector('.bus-route')?.textContent.toLowerCase() ?? '';
        card.style.display = (!term || num.includes(term) || route.includes(term)) ? '' : 'none';
    });
}

function setupRouteFilter() {
    const sel = document.getElementById('route-filter');
    if (!sel) return;
    sel.addEventListener('change', e => {
        const val = e.target.value;
        document.querySelectorAll('#routes-table-body tr').forEach(row => {
            row.style.display = (!val || val === 'all' || row.getAttribute('data-route-id') === val) ? '' : 'none';
        });
    });
}

// ── Contact form ──
function handleContactFormSubmit() {
    const form   = document.getElementById('contact-form');
    const banner = document.getElementById('contact-success');
    if (!form) return;
    const data = new FormData(form);
    if (!data.get('name') || !data.get('email') || !data.get('message')) {
        showNotification('Please fill in all required fields', 'error');
        return;
    }
    if (banner) { banner.classList.add('show'); setTimeout(() => banner.classList.remove('show'), 5000); }
    form.reset();
}

// ── Toast notifications ──
function showNotification(message, type = 'success') {
    const icons = { success: 'fa-check-circle', error: 'fa-circle-exclamation', warning: 'fa-bell', info: 'fa-circle-info' };
    const n = document.createElement('div');
    n.className = `notification notification-${type}`;
    n.innerHTML = `<div class="notification-content"><i class="fas ${icons[type] || icons.info}"></i><span>${escapeHtml(message)}</span></div>`;
    document.body.appendChild(n);
    requestAnimationFrame(() => n.classList.add('visible'));
    setTimeout(() => {
        n.classList.remove('visible');
        setTimeout(() => n.remove(), 350);
    }, 3500);
}

// ── Chatbot integration ──
function integrateChatbot() {
    window.openBusChatbot = busNumber => {
        if (window.citybusChatbot) {
            window.citybusChatbot.openChatbot();
            setTimeout(() => window.askChatbot(`Where is bus ${busNumber}?`), 300);
        }
    };
}

// ── Hero stats (count-up) + departure-board ticker ──
function loadHeroStats() {
    Promise.all([
        loadBusRoutes(),
        apiGet('/api/v1/buses/live').catch(() => [])
    ]).then(([routes, live]) => {
        const routeList = Object.values(routes);
        const nRoutes = routeList.length;
        const nStops  = routeList.reduce((sum, r) => sum + r.stops.length, 0);
        const nLive   = live.length;

        // Hero copy stats
        countUp('hero-routes', nRoutes);
        countUp('hero-stops', nStops);
        countUp('hero-live', nLive);

        // Floating hero chips (plain set — they sit behind the copy)
        setText('chip-routes', nRoutes);
        setText('chip-stops', nStops);
        setText('chip-live', nLive);

        // Editorial stats strip + achievement grid (respect the scroll count-up)
        setLiveStat('strip-routes', nRoutes);
        setLiveStat('strip-stops', nStops);
        setLiveStat('strip-live', nLive);
        setLiveStat('ac-routes', nRoutes);
        setLiveStat('ac-stops', nStops);

        renderTicker(routeList, live);
    });
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

// Feed a real value into a [data-count] tile. If the tile is already in view
// (observer fired), count up to the real number now; otherwise leave the
// value for emerald.js's IntersectionObserver to animate on entry.
function setLiveStat(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.setAttribute('data-count', value);
    if (el.classList.contains('in') && typeof window.emeraldCountTo === 'function') {
        window.emeraldCountTo(el, value, el.getAttribute('data-suffix') || '');
    }
}

function renderTicker(routeList, live) {
    const track = document.getElementById('ticker-track');
    if (!track) return;
    const items = [];
    Object.entries(window.busRoutes || {}).forEach(([number, route]) => {
        if (route.active) {
            items.push(`ROUTE ${number} · ${route.name.toUpperCase()} · EVERY ${route.frequencyMinutes} MIN`);
        }
    });
    items.push(live.length > 0
        ? `${live.length} BUS${live.length === 1 ? '' : 'ES'} BROADCASTING LIVE`
        : 'NETWORK STANDBY — NO BUSES ON AIR');
    // Duplicate the sequence so the -50% scroll loops seamlessly
    const spans = items.map(t => `<span class="ticker-item">${escapeHtml(t)}</span>`).join('');
    track.innerHTML = spans + spans;
}

function countUp(id, target) {
    const el = document.getElementById(id);
    if (!el) return;
    const duration = 900;
    const start = performance.now();
    (function tick(now) {
        const t = Math.min(1, (now - start) / duration);
        el.textContent = Math.round(target * (1 - Math.pow(1 - t, 3)));
        if (t < 1) requestAnimationFrame(tick);
    })(start);
}

// ── Nearest route (auto-assigned to the rider on load) ──────────────
function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371, toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Nearest boardable stop across the whole network → its route.
function findNearestRoute(lat, lng) {
    let best = null;
    Object.entries(window.busRoutes || {}).forEach(([routeNumber, route]) => {
        if (!route.active) return;
        route.stops.forEach(stop => {
            const km = haversineKm(lat, lng, stop.coords[0], stop.coords[1]);
            if (!best || km < best.km) best = { routeNumber, route, stop, km };
        });
    });
    return best;
}

function initNearestRoute() {
    const box = document.getElementById('nearest-route');
    if (!box || !navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(pos => {
        userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        loadBusRoutes().then(() => {
            const near = findNearestRoute(userLocation.lat, userLocation.lng);
            if (!near) return;
            window.userNearestRoute = near;
            renderNearestRoute(near);
        });
    }, () => { /* denied — the card simply stays hidden */ },
    { enableHighAccuracy: true, timeout: 9000, maximumAge: 60000 });
}

function renderNearestRoute(near) {
    const box = document.getElementById('nearest-route');
    if (!box) return;
    const walkMin = Math.max(1, Math.round(near.km / 4.5 * 60));
    const metres = near.km < 1 ? `${Math.round(near.km * 1000)} m` : `${near.km.toFixed(1)} km`;
    box.innerHTML = `
        <div class="nr-badge"><span class="live-dot"></span> Assigned to you</div>
        <div class="nr-main">
            <div class="nr-icon"><i class="fas fa-location-crosshairs"></i></div>
            <div class="nr-copy">
                <div class="nr-title">Your nearest route is
                    <span class="route-chip" style="--chip-color:${near.route.color}">${near.routeNumber}</span>
                    ${escapeHtml(near.route.name)}
                </div>
                <div class="nr-meta">Board at <strong>${escapeHtml(near.stop.name)}</strong>
                    · ${metres} away · ~${walkMin} min walk · every ${near.route.frequencyMinutes} min</div>
            </div>
        </div>
        <div class="nr-actions">
            <button class="btn btn-small" id="nr-track"><i class="fas fa-map-marker-alt"></i> Track this route</button>
            <button class="btn btn-outline btn-small" id="nr-plan"><i class="fas fa-diagram-project"></i> Plan from here</button>
        </div>`;
    box.style.display = '';

    document.getElementById('nr-track').addEventListener('click', () => {
        switchToPage('tracking');
        setTimeout(() => selectBusRoute(near.routeNumber, null), 400);
    });
    document.getElementById('nr-plan').addEventListener('click', () => switchToPage('planner'));
}

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
    initDarkModeToggle();
    setupNavigation();
    setupNavigationAndButtons();
    setupSearch();
    setupRouteFilter();
    checkExistingSession();
    integrateChatbot();
    loadBusRoutes();
    loadHeroStats();
    loadAlerts();
    initNearestRoute();
    setInterval(loadAlerts, 60_000);

    const ladderClose = document.getElementById('ladder-close');
    if (ladderClose) ladderClose.addEventListener('click', hideRouteLadder);

    const home = document.getElementById('home');
    if (home && home.classList.contains('active')) {
        setTimeout(() => initHomeMap(), 300);
    }
});

window.addEventListener('resize', () => {
    if (trackingMap) setTimeout(() => trackingMap.invalidateSize(), 100);
    if (homeMap)     setTimeout(() => homeMap.invalidateSize(), 100);
});

// PWA service worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
}
