// CityBus Tracker — road snapping
//
// The seeded route paths are sparse waypoints, so a raw polyline cuts across
// blocks instead of hugging the road. This module snaps a waypoint list to the
// real street network with the public OSRM routing service and returns dense,
// road-following geometry for Leaflet.
//
// It is defensive by design: results are memo-cached (in-memory + localStorage
// for a week), requests time out, and ANY failure falls back to the original
// waypoints — so a blocked/oflfline OSRM never breaks the map, it just looks
// like it did before.

(() => {
    'use strict';

    const OSRM = 'https://router.project-osrm.org/route/v1/driving/';
    const TIMEOUT_MS = 7000;
    const CACHE_PREFIX = 'roadsnap:v1:';
    const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
    const MAX_WAYPOINTS = 24;            // keep the request URL well-formed

    const memo = new Map();

    function keyFor(waypoints) {
        // 5-decimal rounding (~1 m) keeps the key stable across float noise
        return CACHE_PREFIX + waypoints.map(p => p.map(n => n.toFixed(5)).join(',')).join(';');
    }

    function readCache(key) {
        if (memo.has(key)) return memo.get(key);
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            const { t, geom } = JSON.parse(raw);
            if (Date.now() - t > CACHE_TTL_MS) { localStorage.removeItem(key); return null; }
            memo.set(key, geom);
            return geom;
        } catch { return null; }
    }

    function writeCache(key, geom) {
        memo.set(key, geom);
        try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), geom })); }
        catch { /* quota — in-memory memo still serves this session */ }
    }

    // Thin a long waypoint list to <= MAX so the OSRM URL stays valid, always
    // keeping the first and last points.
    function thin(waypoints) {
        if (waypoints.length <= MAX_WAYPOINTS) return waypoints;
        const step = (waypoints.length - 1) / (MAX_WAYPOINTS - 1);
        const out = [];
        for (let i = 0; i < MAX_WAYPOINTS; i++) out.push(waypoints[Math.round(i * step)]);
        return out;
    }

    /**
     * Snap [ [lat,lng], ... ] to the road network.
     * @returns Promise<[lat,lng][]> — road geometry, or the input on any failure.
     */
    async function snapToRoads(waypoints) {
        if (!Array.isArray(waypoints) || waypoints.length < 2) return waypoints || [];
        const key = keyFor(waypoints);
        const cached = readCache(key);
        if (cached) return cached;

        const pts = thin(waypoints);
        // OSRM wants lng,lat pairs
        const coords = pts.map(p => `${p[1].toFixed(6)},${p[0].toFixed(6)}`).join(';');
        const url = `${OSRM}${coords}?overview=full&geometries=geojson&continue_straight=true`;

        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        try {
            const res = await fetch(url, { signal: ctrl.signal });
            if (!res.ok) throw new Error('OSRM ' + res.status);
            const data = await res.json();
            const line = data?.routes?.[0]?.geometry?.coordinates;
            if (!Array.isArray(line) || line.length < 2) throw new Error('no geometry');
            const geom = line.map(c => [c[1], c[0]]);  // → [lat,lng]
            writeCache(key, geom);
            return geom;
        } catch {
            // Cache the fallback too, so we don't re-hit a failing service each draw
            writeCache(key, waypoints);
            return waypoints;
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * Draw a road-snapped polyline on a Leaflet map. Draws the raw path first
     * for instant feedback, then upgrades to the snapped geometry when it
     * resolves. Returns the Leaflet layer immediately.
     */
    function drawSnappedPolyline(map, waypoints, options) {
        const line = L.polyline(waypoints, options).addTo(map);
        snapToRoads(waypoints).then(geom => {
            if (map.hasLayer(line)) line.setLatLngs(geom);
        });
        return line;
    }

    window.snapToRoads = snapToRoads;
    window.drawSnappedPolyline = drawSnappedPolyline;
})();
