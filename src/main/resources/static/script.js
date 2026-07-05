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

// ── Dark mode ──
function initDarkModeToggle() {
    const toggle = document.getElementById('dark-mode-toggle');
    const icon   = document.getElementById('theme-icon');
    if (!toggle || !icon) return;

    const saved = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', saved);
    icon.className = saved === 'dark' ? 'fas fa-sun' : 'fas fa-moon';

    toggle.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme');
        const next    = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('theme', next);
        icon.className = next === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
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
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(homeMap);

    loadBusRoutes().then(routes => {
        Object.values(routes).forEach(route => {
            if (!route.active) return;
            L.polyline(route.path, { color: route.color, weight: 3, opacity: 0.6 }).addTo(homeMap);
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
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 18
    }).addTo(trackingMap);

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
                    html: `<div style="background:#1d4ed8;width:16px;height:16px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 8px rgba(29,78,216,0.5);"></div>`,
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
function trackBus(busId, routeId) {
    clearRouteSelection();
    showRoute(routeId);
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'track-bus', data: { busId } }));
    }
    if (typeof triggerETA === 'function') triggerETA(busId, routeId);
    showNotification(`Tracking ${busId.toUpperCase()} on ${window.busRoutes[routeId]?.name || 'Route ' + routeId}`);
}

function selectBusRoute(routeId, busId) {
    clearRouteSelection();
    showRoute(routeId);
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

    const path = L.polyline(route.path, {
        color: route.color, weight: 4, opacity: 0.85,
        dashArray: '8 4', lineJoin: 'round', lineCap: 'round'
    }).addTo(trackingMap);

    routeLayers[routeId] = { path, stops: [] };

    route.stops.forEach((stop, i) => {
        const m = L.marker(stop.coords, {
            icon: L.divIcon({
                className: 'stop-marker',
                html: `<div style="background:${route.color};width:11px;height:11px;border-radius:50%;border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.25);"></div>`,
                iconSize: [16, 16], iconAnchor: [8, 8]
            })
        }).addTo(trackingMap)
          .bindPopup(`<strong>Stop ${i + 1}: ${escapeHtml(stop.name)}</strong><br><small>${escapeHtml(route.name)}</small>`);
        routeLayers[routeId].stops.push(m);
    });

    const group = new L.featureGroup([path]);
    trackingMap.fitBounds(group.getBounds().pad(0.15));
}

function clearRouteSelection() {
    Object.keys(routeLayers).forEach(id => {
        trackingMap.removeLayer(routeLayers[id].path);
        routeLayers[id].stops.forEach(m => trackingMap.removeLayer(m));
    });
    routeLayers = {};
    document.querySelectorAll('.bus-card').forEach(c => c.classList.remove('selected'));
    selectedBusRoute = null;
    if (typeof hideETAPanel === 'function') hideETAPanel();
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
            const icon = L.divIcon({
                className: 'bus-marker',
                html: `<div style="background:#1d4ed8;width:20px;height:20px;border-radius:50%;border:3px solid #fff;display:flex;align-items:center;justify-content:center;font-size:9px;color:#fff;box-shadow:0 3px 10px rgba(29,78,216,0.5);">B</div>`,
                iconSize: [26, 26], iconAnchor: [13, 13]
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
        if (busMarkers[id]) busMarkers[id].setLatLng(data.coords);
        else updateBusLocations([data]);
        updateBusCardStatus(id, 'Live', new Date(), data.speedKmh);
        if (typeof refreshETAIfActive === 'function') refreshETAIfActive(id, data.coords);
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
