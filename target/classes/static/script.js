// CityBus Tracker — Main application JavaScript

let trackingMap = null;
let homeMap = null;
let busMarkers = {};
let userMarker = null;
let routeLayers = {};
let selectedBusRoute = null;
let ws = null;
let currentUser = null;
let userLocation = null;

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
    // Sidebar nav links
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', e => {
            e.preventDefault();
            if (link.id === 'driver-login-link') {
                window.location.href = '/driver';
                return;
            }
            const page = link.getAttribute('data-page');
            if (page) switchToPage(page);
        });
    });

    // Footer links that have data-page
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
    const logoutBtn      = document.getElementById('logout-btn');
    if (userInfo && userStatusText) {
        userInfo.style.display = 'block';
        userStatusText.textContent = currentUser ? currentUser.username : 'Guest';
        if (logoutBtn && currentUser && currentUser.role === 'driver') {
            logoutBtn.style.display = 'block';
        }
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

// ── Home map ──
function initHomeMap() {
    const el = document.getElementById('home-map');
    if (!el || homeMap) return;

    homeMap = L.map('home-map').setView([19.8762, 75.3433], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(homeMap);

    const stops = [
        { name: 'Central Bus Station', coords: [19.8762, 75.3433] },
        { name: 'Railway Station',     coords: [19.8610, 75.3101] },
        { name: 'Airport Road',        coords: [19.8650, 75.3980] },
        { name: 'City Center Mall',    coords: [19.8750, 75.3450] },
        { name: 'Medical College',     coords: [19.8690, 75.3200] }
    ];

    stops.forEach(s => {
        L.marker(s.coords, {
            icon: L.divIcon({
                className: 'stop-marker',
                html: `<div style="background:#1d4ed8;width:12px;height:12px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 6px rgba(29,78,216,0.4);"></div>`,
                iconSize: [18, 18],
                iconAnchor: [9, 9]
            })
        }).addTo(homeMap).bindPopup(`<strong>${s.name}</strong><br><small>Bus Stop</small>`);
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
    loadBusRoutes();
    generateBusList();
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

// ── Bus routes data ──
function loadBusRoutes() {
    window.busRoutes = {
        "1": {
            name: "Ranjangaon Phata",
            path: [
                [19.851408,75.209897],[19.840466,75.232433],[19.845526,75.240380],
                [19.838546,75.251527],[19.837301,75.253563],[19.847091,75.265890],
                [19.832842,75.270292],[19.827377,75.289950],[19.832516,75.290357]
            ],
            color: '#1d4ed8',
            stops: [
                { name:'Ranjangaon Phata', coords:[19.875743,75.334755] },
                { name:'Alphonsa',         coords:[19.840466,75.232433] },
                { name:'Pratap Chowk',     coords:[19.839425,75.241251] },
                { name:'MIDC RD',          coords:[19.838546,75.251527] },
                { name:'Gollwadi Chowk',   coords:[19.847091,75.265890] },
                { name:'Paithan RD',       coords:[19.827377,75.289950] },
                { name:'CSMSS',            coords:[19.832516,75.290357] }
            ]
        },
        "2": {
            name: "Fame Tapadia Signal",
            path: [
                [19.876796,75.366045],[19.883883,75.365047],[19.895284,75.364767],
                [19.904718,75.357021],[19.909854,75.353163],[19.914915,75.352384],
                [19.906784,75.343839],[19.904839,75.342060],[19.894397,75.337078],
                [19.892250,75.327619],[19.884206,75.317144],[19.861054,75.310145],[19.832545,75.290382]
            ],
            color: '#0f766e',
            stops: [
                { name:'Fame Tapadia Signal', coords:[19.876796,75.366045] },
                { name:'N1 Ganpati',          coords:[19.883883,75.365047] },
                { name:'Wokhardt',            coords:[19.895284,75.364767] },
                { name:'Ambedkar Chowk',      coords:[19.898180,75.362212] },
                { name:'Railway Station',     coords:[19.861054,75.310145] },
                { name:'Paithan RD',          coords:[19.861054,75.310145] },
                { name:'CSMSS',               coords:[19.832545,75.290382] }
            ]
        },
        "3": {
            name: "Chikalthana",
            path: [
                [19.873573,75.394782],[19.869982,75.394397],[19.871974,75.385324],
                [19.873522,75.370390],[19.874840,75.355761],[19.875275,75.352356],
                [19.876049,75.341475],[19.873642,75.328705],[19.872266,75.322000],
                [19.860902,75.310143],[19.861369,75.306988],[19.847678,75.296336],[19.833201,75.290463]
            ],
            color: '#7c3aed',
            stops: [
                { name:'Chikalthana',    coords:[19.873573,75.394782] },
                { name:'Dhoot Hospital', coords:[19.869982,75.394397] },
                { name:'Akashwani',      coords:[19.876049,75.341475] },
                { name:'Jai Tower',      coords:[19.861369,75.306988] },
                { name:'CSMSS',          coords:[19.833201,75.290463] }
            ]
        },
        "4": {
            name: "Baliram Patil High School",
            path: [
                [19.895877,75.358173],[19.888110,75.360340],[19.879980,75.360448],
                [19.875295,75.353286],[19.869060,75.350870],[19.858987,75.344975],
                [19.857757,75.334539],[19.850451,75.333036],[19.854130,75.305745],
                [19.841854,75.293056],[19.832519,75.290360]
            ],
            color: '#d97706',
            stops: [
                { name:'Baliram Patil H.S.', coords:[19.895877,75.358173] },
                { name:'Seven Hills Signal',  coords:[19.875295,75.353286] },
                { name:'Shivaji Nagar',       coords:[19.857757,75.334539] },
                { name:'CSMSS',              coords:[19.832519,75.290360] }
            ]
        }
    };
}

// ── Bus list ──
function generateBusList() {
    const list = document.getElementById('bus-list');
    if (!list) return;

    const buses = [
        { id:'bus-1', route:'Route 1 — Ranjangaon Phata',       routeId:'1', nextStop:'Alphonsa' },
        { id:'bus-2', route:'Route 2 — Fame Tapadia Signal',     routeId:'2', nextStop:'Wokhardt' },
        { id:'bus-3', route:'Route 3 — Chikalthana',             routeId:'3', nextStop:'Akashwani' },
        { id:'bus-4', route:'Route 4 — Baliram Patil H.S.',     routeId:'4', nextStop:'Shivaji Nagar' },
        { id:'bus-5', route:'Route 1 — Ranjangaon Phata (2nd)', routeId:'1', nextStop:'MIDC RD' }
    ];

    list.innerHTML = '';
    buses.forEach(bus => {
        const card = document.createElement('div');
        card.className = 'bus-card';
        card.setAttribute('data-bus-id', bus.id);
        card.setAttribute('data-route-id', bus.routeId);
        card.innerHTML = `
            <div class="bus-number">${bus.id.toUpperCase()}</div>
            <div class="bus-route">${bus.route}</div>
            <div class="bus-status status-active"><i class="fas fa-circle" style="font-size:6px;"></i> Active</div>
            <div class="bus-next-stop">Next stop: ${bus.nextStop}</div>
            <button class="track-bus-btn" data-bus-id="${bus.id}" data-route-id="${bus.routeId}">
                <i class="fas fa-map-marker-alt"></i> Track This Bus
            </button>`;
        list.appendChild(card);

        card.querySelector('.track-bus-btn').addEventListener('click', e => {
            e.stopPropagation();
            trackBus(bus.id, bus.routeId);
        });
        card.addEventListener('click', () => selectBusRoute(bus.routeId));
    });
}

// ── Route display ──
function trackBus(busId, routeId) {
    clearRouteSelection();
    showRoute(routeId);
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'track-bus', data: { busId } }));
    }
    showNotification(`Tracking ${busId.toUpperCase()} on ${window.busRoutes[routeId]?.name || 'Route ' + routeId}`);
}

function selectBusRoute(routeId) {
    clearRouteSelection();
    showRoute(routeId);
    document.querySelectorAll('.bus-card').forEach(card => {
        card.classList.toggle('selected', card.getAttribute('data-route-id') === routeId);
    });
    selectedBusRoute = routeId;
    if (typeof triggerETA === 'function') triggerETA(busId, routeId);
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
          .bindPopup(`<strong>Stop ${i+1}: ${stop.name}</strong><br><small>${route.name}</small>`);
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
    Object.keys(busMarkers).forEach(id => {
        if (busMarkers[id].isSimulated) {
            trackingMap.removeLayer(busMarkers[id]);
            delete busMarkers[id];
        }
    });
    document.querySelectorAll('.bus-card').forEach(c => c.classList.remove('selected'));
    selectedBusRoute = null;
}

// ── Real-time bus updates ──
function updateBusLocations(busData) {
    if (!trackingMap || !Array.isArray(busData)) return;
    busData.forEach(bus => {
        if (!bus.coords || bus.coords.length < 2) return;
        const [lat, lng] = bus.coords;
        const id = bus.busId;
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
                .bindPopup(`<strong>${id.toUpperCase()}</strong><br>Driver: ${bus.driverId || 'Unknown'}<br><small>Live tracking</small>`);
            busMarkers[id].isSimulated = false;
        }
        updateBusCardStatus(id, 'Active', new Date(bus.lastSeen));
    });
}

function updateBusCardStatus(busId, status, lastSeen) {
    const card = document.querySelector(`[data-bus-id="${busId}"]`);
    if (!card) return;
    const el = card.querySelector('.bus-status');
    const ns = card.querySelector('.bus-next-stop');
    if (el) {
        el.className = `bus-status status-${status.toLowerCase()}`;
        el.innerHTML = `<i class="fas fa-circle" style="font-size:6px;"></i> ${status}`;
    }
    if (ns && lastSeen) {
        const mins = Math.round((Date.now() - lastSeen) / 60000);
        ns.textContent = `Updated ${mins} min ago`;
    }
}

function updateSingleBusLocation(data) {
    if (data.coords && data.coords.length >= 2) {
        const id = data.busId;
        if (busMarkers[id]) busMarkers[id].setLatLng(data.coords);
        else updateBusLocations([data]);
        if (typeof refreshETAIfActive === 'function') refreshETAIfActive(id, data.coords);
    }
}

function removeBusMarker(busId) {
    if (busMarkers[busId]) {
        trackingMap.removeLayer(busMarkers[busId]);
        delete busMarkers[busId];
        updateBusCardStatus(busId, 'Offline', new Date());
    }
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
                data: { userId: 'user_' + Math.random().toString(36).substr(2, 9), timestamp: Date.now() }
            }));
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
        case 'active-buses':      if (msg.data) updateBusLocations(msg.data); break;
        case 'bus-location-update': if (msg.data) updateSingleBusLocation(msg.data); break;
        case 'driver-left':       if (msg.data) removeBusMarker(msg.data.driverId); break;
        case 'tracking-started':  if (msg.data) showNotification(`Now tracking ${msg.data.busId}`); break;
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
    document.querySelectorAll('.bus-card').forEach(card => {
        const num   = card.querySelector('.bus-number').textContent.toLowerCase();
        const route = card.querySelector('.bus-route').textContent.toLowerCase();
        card.style.display = (!term || num.includes(term) || route.includes(term)) ? '' : 'none';
    });
}

function setupRouteFilter() {
    const sel = document.getElementById('route-filter');
    if (!sel) return;
    sel.addEventListener('change', e => {
        const val = e.target.value;
        document.querySelectorAll('.bus-card').forEach(card => {
            card.style.display = (!val || val === 'all' || card.getAttribute('data-route-id') === val) ? '' : 'none';
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
        alert('Please fill in all required fields');
        return;
    }
    if (banner) { banner.classList.add('show'); setTimeout(() => banner.classList.remove('show'), 5000); }
    form.reset();
}

// ── Notification ──
function showNotification(message) {
    const n = document.createElement('div');
    n.className = 'notification';
    n.innerHTML = `<div class="notification-content"><i class="fas fa-check-circle"></i><span>${message}</span></div>`;
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 3000);
}

// ── Chatbot integration ──
function integrateChatbot() {
    window.openBusChatbot = busNumber => {
        if (window.citybusChatbot) {
            window.citybusChatbot.openChatbot();
            setTimeout(() => window.askChatbot(`Where is bus ${busNumber}?`), 300);
        }
    };
    const navMenu = document.querySelector('.nav-menu');
    if (navMenu) {
        const helpLink = document.createElement('a');
        helpLink.href = '#';
        helpLink.className = 'nav-item nav-link';
        helpLink.innerHTML = '<i class="nav-icon fas fa-robot"></i><span class="nav-text">AI Assistant</span>';
        helpLink.addEventListener('click', e => {
            e.preventDefault();
            if (window.citybusChatbot) window.citybusChatbot.openChatbot();
        });
        navMenu.appendChild(helpLink);
    }
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

    // Init home map if home page is active
    const home = document.getElementById('home');
    if (home && home.classList.contains('active')) {
        setTimeout(() => initHomeMap(), 300);
    }

    // Watch for page activation
    const observer = new MutationObserver(mutations => {
        mutations.forEach(m => {
            if (m.type !== 'attributes' || m.attributeName !== 'class') return;
            const target = m.target;
            if (!target.classList.contains('active')) return;
            if (target.id === 'home' && !homeMap)     setTimeout(() => initHomeMap(), 100);
            if (target.id === 'tracking' && !trackingMap) setTimeout(() => initTrackingMap(), 100);
        });
    });
    document.querySelectorAll('.page').forEach(p => observer.observe(p, { attributes: true }));
});

window.addEventListener('resize', () => {
    if (trackingMap) setTimeout(() => trackingMap.invalidateSize(), 100);
    if (homeMap)     setTimeout(() => homeMap.invalidateSize(), 100);
});

document.addEventListener('click', e => {
    if (e.target.closest('#tracking-map') && !e.target.closest('.bus-card') && !e.target.closest('.track-bus-btn')) {
        if (selectedBusRoute) clearRouteSelection();
    }
});

// PWA service worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
}