/**
 * CityBus ETA Engine
 * Calculates bus-to-user arrival time along the route geometry.
 * Depends on: trackingMap, busMarkers, userLocation (from script.js)
 */

const ETA_FALLBACK_SPEED_KMH = 20;   // used until the bus reports real movement
const ETA_MIN_LIVE_SPEED_KMH = 3;    // below this the bus is basically stopped
let etaPolyline      = null;
let activeEtaBusId   = null;
let activeEtaRouteId = null;

/**
 * Preferred speed source: the rolling average measured by the backend from
 * real GPS pings (window.liveBusSpeeds, fed by script.js). Falls back to a
 * city average when the bus is stationary or just came online.
 */
function etaSpeedFor(busId) {
    const live = window.liveBusSpeeds && window.liveBusSpeeds[busId];
    if (typeof live === 'number' && live >= ETA_MIN_LIVE_SPEED_KMH) {
        return { speed: live, measured: true };
    }
    return { speed: ETA_FALLBACK_SPEED_KMH, measured: false };
}

/* ─── Geometry helpers ──────────────────────────────────────── */

function eta_haversine(p1, p2) {
    const R = 6371;
    const φ1 = p1[0] * Math.PI / 180, φ2 = p2[0] * Math.PI / 180;
    const Δφ = (p2[0] - p1[0]) * Math.PI / 180;
    const Δλ = (p2[1] - p1[1]) * Math.PI / 180;
    const a = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// Project point p onto segment a→b, return interpolated point + t ∈ [0,1]
function eta_projectSeg(p, a, b) {
    const dx = b[0]-a[0], dy = b[1]-a[1];
    const len2 = dx*dx + dy*dy;
    if (len2 === 0) return { pt: a, t: 0 };
    const t = Math.max(0, Math.min(1, ((p[0]-a[0])*dx + (p[1]-a[1])*dy) / len2));
    return { pt: [a[0]+t*dx, a[1]+t*dy], t };
}

// Find the closest point on the route polyline and its linear position
function eta_routePos(coords, path) {
    let best = { dist: Infinity, seg: 0, t: 0, pt: path[0] };
    for (let i = 0; i < path.length-1; i++) {
        const { pt, t } = eta_projectSeg(coords, path[i], path[i+1]);
        const d = eta_haversine(pt, coords);
        if (d < best.dist) best = { dist: d, seg: i, t, pt };
    }
    return best;
}

// Total km from route start to a given projected position
function eta_cumKm(pos, path) {
    let km = 0;
    for (let i = 0; i < pos.seg; i++) km += eta_haversine(path[i], path[i+1]);
    if (pos.seg < path.length-1)
        km += pos.t * eta_haversine(path[pos.seg], path[pos.seg+1]);
    return km;
}

// Extract the polyline sub-path between two projected positions
function eta_subPath(path, busPos, userPos) {
    const pts = [busPos.pt];
    for (let i = busPos.seg+1; i <= userPos.seg; i++) pts.push(path[i]);
    if (userPos.seg < path.length-1) {
        const s = path[userPos.seg], e = path[userPos.seg+1];
        pts.push([s[0]+userPos.t*(e[0]-s[0]), s[1]+userPos.t*(e[1]-s[1])]);
    } else {
        pts.push(path[path.length-1]);
    }
    return pts;
}

/* ─── Core ETA calculation ──────────────────────────────────── */

function calculateAndShowETA(busId, routeId, busCoords) {
    const route = window.busRoutes && window.busRoutes[routeId];
    if (!route || !route.path || route.path.length < 2) return;

    activeEtaBusId   = busId;
    activeEtaRouteId = routeId;

    if (!userLocation) {
        showETAPanel(busId, route.name, null, null, 'Enable location for ETA');
        return;
    }

    const userCoords = [userLocation.lat, userLocation.lng];
    const path = route.path;

    const busPos  = eta_routePos(busCoords,  path);
    const userPos = eta_routePos(userCoords, path);

    const busKm  = eta_cumKm(busPos,  path);
    const userKm = eta_cumKm(userPos, path);
    const distKm = userKm - busKm;   // positive = bus is approaching user

    if (distKm < -0.05) {
        clearETAPolyline();
        showETAPanel(busId, route.name, Math.abs(distKm), null, 'Bus has passed your stop');
        return;
    }

    if (distKm < 0.05) {
        clearETAPolyline();
        showETAPanel(busId, route.name, 0, 0, 'Arriving now!');
        return;
    }

    const { speed, measured } = etaSpeedFor(busId);
    const etaMins = Math.max(1, Math.round((distKm / speed) * 60));
    const sub = eta_subPath(path, busPos, userPos);
    drawETAPolyline(sub);
    showETAPanel(busId, route.name, distKm, etaMins,
        measured ? 'Live GPS speed' : 'Estimated speed');
    setETASpeed(speed);
}

/* ─── Map layer ─────────────────────────────────────────────── */

function drawETAPolyline(points) {
    if (!trackingMap || points.length < 2) return;
    clearETAPolyline();
    etaPolyline = L.polyline(points, {
        color: '#f59e0b',
        weight: 7,
        opacity: 0.92,
        lineJoin: 'round',
        lineCap: 'round'
    }).addTo(trackingMap);
}

function clearETAPolyline() {
    if (etaPolyline && trackingMap) {
        trackingMap.removeLayer(etaPolyline);
        etaPolyline = null;
    }
}

/* ─── Panel UI ──────────────────────────────────────────────── */

function showETAPanel(busId, routeName, distKm, etaMins, statusMsg) {
    const panel = document.getElementById('eta-panel');
    if (!panel) return;
    panel.style.display = 'flex';

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

    set('eta-bus-label',   busId     ? busId.toUpperCase()  : '--');
    set('eta-route-name',  routeName || '');
    set('eta-status-msg',  statusMsg || '');

    if (distKm !== null) {
        set('eta-dist-value', distKm < 1
            ? Math.round(distKm * 1000) + ' m'
            : distKm.toFixed(1) + ' km');
    } else {
        set('eta-dist-value', '--');
    }

    if (etaMins !== null) {
        set('eta-mins-value', etaMins === 0 ? 'Now' : etaMins);
        if (etaMins > 0) {
            const arr = new Date(Date.now() + etaMins * 60000);
            set('eta-clock', 'Arrives at ' + arr.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        } else {
            set('eta-clock', '');
        }
    } else {
        set('eta-mins-value', '--');
        set('eta-clock', '');
    }
}

function setETASpeed(speedKmh) {
    const el = document.getElementById('eta-speed-value');
    if (el) el.textContent = Math.round(speedKmh);
}

// Called from script.js clearRouteSelection() and the ✕ button
function hideETAPanel() {
    const panel = document.getElementById('eta-panel');
    if (panel) panel.style.display = 'none';
    clearETAPolyline();
    activeEtaBusId   = null;
    activeEtaRouteId = null;
}

/* ─── Integration hooks (called from script.js) ─────────────── */

/**
 * Call this from trackBus(busId, routeId) in script.js
 */
function triggerETA(busId, routeId) {
    let busCoords = null;

    // Only real driver GPS counts — no simulated positions.
    if (typeof busMarkers !== 'undefined' && busMarkers[busId]) {
        const ll = busMarkers[busId].getLatLng();
        busCoords = [ll.lat, ll.lng];
    }

    if (!busCoords) {
        // Arm the panel so the ETA appears the moment the driver comes online
        // (refreshETAIfActive fires on every incoming GPS update).
        activeEtaBusId   = busId;
        activeEtaRouteId = routeId;
        const route = window.busRoutes && window.busRoutes[routeId];
        showETAPanel(busId, route ? route.name : '', null, null,
            'Bus is offline — waiting for live GPS');
        return;
    }

    calculateAndShowETA(busId, routeId, busCoords);
}

/**
 * Call this from updateSingleBusLocation() in script.js
 * so the ETA refreshes every time the driver sends a GPS update.
 */
function refreshETAIfActive(busId, coords) {
    if (busId === activeEtaBusId && activeEtaRouteId) {
        calculateAndShowETA(busId, activeEtaRouteId, coords);
    }
}