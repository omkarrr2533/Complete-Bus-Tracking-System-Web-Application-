// CityBus Tracker — Admin console
// Talks to the /api/v1 CRUD endpoints with a JWT bearer token.
// State lives server-side; this client just renders and edits it.

(() => {
    'use strict';

    const TOKEN_KEY = 'adminToken';
    const USER_KEY  = 'adminUser';

    let routes = [];
    let buses  = [];
    let alerts = [];
    let liveRefreshTimer = null;
    let confirmAction = null;
    let editingRouteId = null;
    let editingBusId = null;
    let editingAlertId = null;

    // ── API helper ─────────────────────────────────────────────────
    async function api(path, options = {}) {
        const headers = { 'Accept': 'application/json', ...(options.headers || {}) };
        if (options.body) headers['Content-Type'] = 'application/json';
        const token = sessionStorage.getItem(TOKEN_KEY);
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch(path, { ...options, headers });
        if (res.status === 204) return null;

        let body = null;
        try { body = await res.json(); } catch { /* no body */ }

        if (!res.ok) {
            if (res.status === 401 && path !== '/api/v1/auth/login') {
                signOut('Your session expired. Sign in again.');
            }
            const error = new Error(body?.message || `Request failed (${res.status})`);
            error.fieldErrors = body?.fieldErrors || [];
            error.status = res.status;
            throw error;
        }
        return body;
    }

    // ── Toasts ─────────────────────────────────────────────────────
    function toast(message, type = 'success') {
        const icons = { success: 'fa-check-circle', error: 'fa-circle-exclamation', warning: 'fa-bell', info: 'fa-circle-info' };
        const n = document.createElement('div');
        n.className = `notification notification-${type}`;
        n.innerHTML = `<div class="notification-content"><i class="fas ${icons[type]}"></i><span>${escapeHtml(message)}</span></div>`;
        document.body.appendChild(n);
        requestAnimationFrame(() => n.classList.add('visible'));
        setTimeout(() => { n.classList.remove('visible'); setTimeout(() => n.remove(), 350); }, 3500);
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text ?? '';
        return div.innerHTML;
    }

    // ── Auth ───────────────────────────────────────────────────────
    function currentUser() {
        try { return JSON.parse(sessionStorage.getItem(USER_KEY)); }
        catch { return null; }
    }

    function signOut(message) {
        sessionStorage.removeItem(TOKEN_KEY);
        sessionStorage.removeItem(USER_KEY);
        stopLiveRefresh();
        document.getElementById('admin-shell').style.display = 'none';
        document.getElementById('auth-screen').style.display = 'flex';
        if (message) showAuthError(message);
    }

    function showAuthError(message) {
        const el = document.getElementById('auth-error');
        el.textContent = message;
        el.classList.add('show');
        setTimeout(() => el.classList.remove('show'), 6000);
    }

    async function handleLogin(event) {
        event.preventDefault();
        const btn = document.getElementById('admin-login-btn');
        const username = document.getElementById('admin-username').value.trim();
        const password = document.getElementById('admin-password').value;

        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Signing in...';
        try {
            const data = await api('/api/v1/auth/login', {
                method: 'POST',
                body: JSON.stringify({ username, password })
            });
            if (data.role !== 'ADMIN') {
                showAuthError('This console requires an administrator account.');
                return;
            }
            sessionStorage.setItem(TOKEN_KEY, data.accessToken);
            sessionStorage.setItem(USER_KEY, JSON.stringify(data));
            enterShell(data);
        } catch (err) {
            showAuthError(err.message || 'Login failed.');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Sign In';
        }
    }

    function enterShell(user) {
        document.getElementById('auth-screen').style.display = 'none';
        const shell = document.getElementById('admin-shell');
        shell.style.display = 'flex';
        document.getElementById('admin-display-name').textContent = user.displayName || user.username;
        document.getElementById('admin-role-label').textContent = user.role;
        loadAll();
        startLiveRefresh();
    }

    // ── Section navigation ─────────────────────────────────────────
    const SECTION_META = {
        dashboard: ['Dashboard', 'Fleet overview and live operations'],
        routes:    ['Routes', 'Create, edit and retire routes — changes go live on the rider map instantly'],
        fleet:     ['Fleet', 'Vehicles and their route assignments'],
        alerts:    ['Alerts', 'Service notices riders see on the map site — delays, diversions, planned works']
    };

    function switchSection(name) {
        document.querySelectorAll('.admin-nav .nav-item[data-section]').forEach(item => {
            item.classList.toggle('active', item.dataset.section === name);
        });
        document.querySelectorAll('.admin-section').forEach(section => {
            section.style.display = section.id === `section-${name}` ? '' : 'none';
        });
        const [title, subtitle] = SECTION_META[name] || SECTION_META.dashboard;
        document.getElementById('section-title').textContent = title;
        document.getElementById('section-subtitle').textContent = subtitle;
        document.getElementById('admin-sidebar').classList.remove('open');
    }

    // ── Data loading ───────────────────────────────────────────────
    async function loadAll() {
        try {
            const [routesData, busPage, live, alertsData] = await Promise.all([
                api('/api/v1/routes'),
                api('/api/v1/buses?size=100'),
                api('/api/v1/buses/live'),
                api('/api/v1/alerts/all')
            ]);
            routes = routesData;
            buses = busPage.content;
            alerts = alertsData;
            renderStats(live);
            renderLiveTable(live);
            renderRoutesTable();
            renderFleetTable();
            renderAlertsTable();
        } catch (err) {
            toast(err.message || 'Failed to load data', 'error');
        }
    }

    async function refreshLive() {
        try {
            const live = await api('/api/v1/buses/live');
            renderStats(live);
            renderLiveTable(live);
        } catch { /* transient — next tick will retry */ }
    }

    function startLiveRefresh() {
        stopLiveRefresh();
        liveRefreshTimer = setInterval(refreshLive, 10_000);
    }

    function stopLiveRefresh() {
        if (liveRefreshTimer) clearInterval(liveRefreshTimer);
        liveRefreshTimer = null;
    }

    // ── Rendering ──────────────────────────────────────────────────
    function renderStats(live) {
        document.getElementById('stat-routes').textContent = routes.length;
        document.getElementById('stat-buses').textContent = buses.length;
        document.getElementById('stat-live').textContent = live.length;
        document.getElementById('stat-stops').textContent =
            routes.reduce((sum, r) => sum + r.stops.length, 0);
    }

    function renderLiveTable(live) {
        const tbody = document.getElementById('live-table-body');
        const empty = document.getElementById('live-empty');
        empty.style.display = live.length ? 'none' : 'block';
        tbody.innerHTML = live.map(bus => `
            <tr class="fade-in-row">
                <td><strong>${escapeHtml(bus.busId.toUpperCase())}</strong></td>
                <td>${escapeHtml(bus.driverId || '—')}</td>
                <td>${bus.coords ? bus.coords[0].toFixed(5) + ', ' + bus.coords[1].toFixed(5) : '—'}</td>
                <td>${bus.speedKmh != null ? bus.speedKmh + ' km/h' : '—'}</td>
                <td>${timeAgo(bus.lastSeen)}</td>
                <td><span class="badge badge-live">LIVE</span></td>
            </tr>`).join('');
        document.getElementById('live-updated').textContent =
            'updated ' + new Date().toLocaleTimeString();
    }

    function renderRoutesTable() {
        const tbody = document.getElementById('routes-admin-body');
        tbody.innerHTML = routes.map(r => `
            <tr class="fade-in-row">
                <td><span class="route-chip" style="--chip-color:${r.color}">${r.routeNumber}</span></td>
                <td><strong>${escapeHtml(r.name)}</strong></td>
                <td>${r.stops.length}</td>
                <td>${r.firstBus} – ${r.lastBus}</td>
                <td>${r.frequencyMinutes} min</td>
                <td>${r.busCount}</td>
                <td><span class="badge ${r.active ? 'badge-success' : 'badge-muted'}">${r.active ? 'Active' : 'Suspended'}</span></td>
                <td>
                    <div class="actions">
                        <button class="btn-icon" data-edit-route="${r.id}" title="Edit route" aria-label="Edit route ${r.routeNumber}">
                            <i class="fas fa-pen"></i>
                        </button>
                        <button class="btn-icon danger" data-delete-route="${r.id}" title="Delete route" aria-label="Delete route ${r.routeNumber}">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>`).join('');
    }

    function renderFleetTable() {
        const tbody = document.getElementById('fleet-admin-body');
        tbody.innerHTML = buses.map(b => `
            <tr class="fade-in-row">
                <td><strong>${escapeHtml(b.code.toUpperCase())}</strong></td>
                <td>${b.routeNumber != null
                    ? `<span class="route-chip" style="--chip-color:${b.routeColor || 'var(--primary)'}">${b.routeNumber}</span> ${escapeHtml(b.routeName || '')}`
                    : '<span class="badge badge-muted">Unassigned</span>'}</td>
                <td>${b.live && b.live.coords
                    ? '<span class="badge badge-live">LIVE</span>'
                    : '<span class="badge badge-muted">Offline</span>'}</td>
                <td><span class="badge ${b.active ? 'badge-success' : 'badge-warning'}">${b.active ? 'In service' : 'Out of service'}</span></td>
                <td>
                    <div class="actions">
                        <button class="btn-icon" data-edit-bus="${b.id}" title="Edit bus" aria-label="Edit ${b.code}">
                            <i class="fas fa-pen"></i>
                        </button>
                        <button class="btn-icon danger" data-delete-bus="${b.id}" title="Delete bus" aria-label="Delete ${b.code}">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>`).join('');
    }

    const SEVERITY_BADGES = {
        INFO:     'badge-muted',
        WARNING:  'badge-warning',
        CRITICAL: 'badge-danger'
    };

    function renderAlertsTable() {
        const tbody = document.getElementById('alerts-admin-body');
        const empty = document.getElementById('alerts-empty');
        if (!tbody) return;
        empty.style.display = alerts.length ? 'none' : 'block';
        tbody.innerHTML = alerts.map(a => `
            <tr class="fade-in-row">
                <td><span class="badge ${SEVERITY_BADGES[a.severity] || 'badge-muted'}">${a.severity}</span></td>
                <td><strong>${escapeHtml(a.title)}</strong><br><small style="color:var(--text-muted)">${escapeHtml(a.message)}</small></td>
                <td>${a.routeNumber != null
                    ? `<span class="route-chip" style="--chip-color:${a.routeColor || 'var(--primary)'}">${a.routeNumber}</span>`
                    : 'Network-wide'}</td>
                <td>${new Date(a.createdAt).toLocaleString()}</td>
                <td>${a.expiresAt ? new Date(a.expiresAt).toLocaleString() : '—'}</td>
                <td><span class="badge ${a.live ? 'badge-live' : 'badge-muted'}">${a.live ? 'LIVE' : (a.active ? 'Expired' : 'Inactive')}</span></td>
                <td>
                    <div class="actions">
                        <button class="btn-icon" data-edit-alert="${a.id}" title="Edit alert" aria-label="Edit alert">
                            <i class="fas fa-pen"></i>
                        </button>
                        <button class="btn-icon danger" data-delete-alert="${a.id}" title="Delete alert" aria-label="Delete alert">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>`).join('');
    }

    // ── Alert form ─────────────────────────────────────────────────
    function openAlertModal(alert) {
        editingAlertId = alert ? alert.id : null;
        const form = document.getElementById('alert-form');
        form.reset();
        clearFieldErrors(form);
        document.getElementById('alert-modal-title').innerHTML = alert
            ? '<i class="fas fa-bullhorn"></i> Edit Alert'
            : '<i class="fas fa-bullhorn"></i> Publish Alert';

        form.routeId.innerHTML = '<option value="">Whole network</option>' + routes.map(r =>
            `<option value="${r.id}">Route ${r.routeNumber} — ${escapeHtml(r.name)}</option>`).join('');

        if (alert) {
            form.title.value = alert.title;
            form.message.value = alert.message;
            form.severity.value = alert.severity;
            if (alert.routeId != null) form.routeId.value = alert.routeId;
            form.active.value = String(alert.active);
            if (alert.expiresAt) {
                const local = new Date(alert.expiresAt);
                local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
                form.expiresAt.value = local.toISOString().slice(0, 16);
            }
        }
        openModal('alert-modal');
    }

    async function saveAlert() {
        const form = document.getElementById('alert-form');
        const btn = document.getElementById('alert-save-btn');
        clearFieldErrors(form);

        const payload = {
            title: form.title.value.trim(),
            message: form.message.value.trim(),
            severity: form.severity.value,
            routeId: form.routeId.value ? +form.routeId.value : null,
            active: form.active.value === 'true',
            expiresAt: form.expiresAt.value ? new Date(form.expiresAt.value).toISOString() : null
        };

        btn.disabled = true;
        try {
            if (editingAlertId) {
                await api(`/api/v1/alerts/${editingAlertId}`, { method: 'PUT', body: JSON.stringify(payload) });
                toast('Alert updated');
            } else {
                await api('/api/v1/alerts', { method: 'POST', body: JSON.stringify(payload) });
                toast('Alert published — riders see it now');
            }
            closeModal('alert-modal');
            await loadAll();
        } catch (err) {
            applyFieldErrors(form, err.fieldErrors);
            if (!err.fieldErrors?.length) toast(err.message, 'error');
        } finally {
            btn.disabled = false;
        }
    }

    function timeAgo(ts) {
        if (!ts) return '—';
        const seconds = Math.round((Date.now() - ts) / 1000);
        if (seconds < 10) return 'just now';
        if (seconds < 60) return `${seconds}s ago`;
        const minutes = Math.round(seconds / 60);
        return minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`;
    }

    // ── Modals ─────────────────────────────────────────────────────
    function openModal(id)  { document.getElementById(id).classList.add('open'); }
    function closeModal(id) { document.getElementById(id).classList.remove('open'); }

    function clearFieldErrors(form) {
        form.querySelectorAll('.field.invalid').forEach(f => f.classList.remove('invalid'));
        form.querySelectorAll('.error-text').forEach(e => e.textContent = '');
    }

    function applyFieldErrors(form, fieldErrors) {
        (fieldErrors || []).forEach(({ field, message }) => {
            // "stops[0].name" → the stops field; "routeNumber" → itself
            const root = field.split(/[\.\[]/)[0];
            const wrapper = form.querySelector(`.field[data-field="${root}"]`);
            if (wrapper) {
                wrapper.classList.add('invalid');
                const errorText = wrapper.querySelector('.error-text');
                if (errorText && !errorText.textContent) errorText.textContent = message;
            }
        });
    }

    // ── Route form ─────────────────────────────────────────────────
    function openRouteModal(route) {
        editingRouteId = route ? route.id : null;
        const form = document.getElementById('route-form');
        form.reset();
        clearFieldErrors(form);
        document.getElementById('route-modal-title').innerHTML = route
            ? '<i class="fas fa-route"></i> Edit Route ' + route.routeNumber
            : '<i class="fas fa-route"></i> New Route';

        if (route) {
            form.routeNumber.value = route.routeNumber;
            form.name.value = route.name;
            form.color.value = route.color;
            form.firstBus.value = route.firstBus;
            form.lastBus.value = route.lastBus;
            form.frequencyMinutes.value = route.frequencyMinutes;
            form.active.value = String(route.active);
            form.stops.value = route.stops
                .map(s => `${s.name} | ${s.lat} | ${s.lng}`).join('\n');
            form.path.value = route.path
                .map(p => `${p[0]}, ${p[1]}`).join('\n');
        }
        openModal('route-modal');
    }

    function parseStops(text) {
        return text.split('\n').map(l => l.trim()).filter(Boolean).map((line, i) => {
            const parts = line.split('|').map(p => p.trim());
            if (parts.length !== 3) throw new Error(`Stop line ${i + 1}: expected "Name | lat | lng"`);
            const [name, lat, lng] = parts;
            if (!name) throw new Error(`Stop line ${i + 1}: name is empty`);
            if (isNaN(+lat) || isNaN(+lng)) throw new Error(`Stop line ${i + 1}: coordinates must be numbers`);
            return { name, lat: +lat, lng: +lng };
        });
    }

    function parsePath(text) {
        return text.split('\n').map(l => l.trim()).filter(Boolean).map((line, i) => {
            const parts = line.split(',').map(p => p.trim());
            if (parts.length !== 2 || isNaN(+parts[0]) || isNaN(+parts[1])) {
                throw new Error(`Path line ${i + 1}: expected "lat, lng"`);
            }
            return [+parts[0], +parts[1]];
        });
    }

    async function saveRoute() {
        const form = document.getElementById('route-form');
        const btn = document.getElementById('route-save-btn');
        clearFieldErrors(form);

        let stops, path;
        try {
            stops = parseStops(form.stops.value);
            if (stops.length < 2) throw new Error('A route needs at least 2 stops');
        } catch (err) {
            const wrapper = form.querySelector('.field[data-field="stops"]');
            wrapper.classList.add('invalid');
            wrapper.querySelector('.error-text').textContent = err.message;
            return;
        }
        try {
            path = form.path.value.trim()
                ? parsePath(form.path.value)
                : stops.map(s => [s.lat, s.lng]);
            if (path.length < 2) throw new Error('The path needs at least 2 points');
        } catch (err) {
            const wrapper = form.querySelector('.field[data-field="path"]');
            wrapper.classList.add('invalid');
            wrapper.querySelector('.error-text').textContent = err.message;
            return;
        }

        const payload = {
            routeNumber: +form.routeNumber.value,
            name: form.name.value.trim(),
            color: form.color.value,
            firstBus: form.firstBus.value,
            lastBus: form.lastBus.value,
            frequencyMinutes: +form.frequencyMinutes.value,
            active: form.active.value === 'true',
            stops,
            path
        };

        btn.disabled = true;
        try {
            if (editingRouteId) {
                await api(`/api/v1/routes/${editingRouteId}`, { method: 'PUT', body: JSON.stringify(payload) });
                toast(`Route ${payload.routeNumber} updated`);
            } else {
                await api('/api/v1/routes', { method: 'POST', body: JSON.stringify(payload) });
                toast(`Route ${payload.routeNumber} created`);
            }
            closeModal('route-modal');
            await loadAll();
        } catch (err) {
            applyFieldErrors(form, err.fieldErrors);
            if (!err.fieldErrors?.length) toast(err.message, 'error');
        } finally {
            btn.disabled = false;
        }
    }

    // ── Bus form ───────────────────────────────────────────────────
    function openBusModal(bus) {
        editingBusId = bus ? bus.id : null;
        const form = document.getElementById('bus-form');
        form.reset();
        clearFieldErrors(form);
        document.getElementById('bus-modal-title').innerHTML = bus
            ? '<i class="fas fa-bus-simple"></i> Edit ' + bus.code.toUpperCase()
            : '<i class="fas fa-bus-simple"></i> Register Bus';

        form.routeId.innerHTML = routes.map(r =>
            `<option value="${r.id}">Route ${r.routeNumber} — ${escapeHtml(r.name)}</option>`).join('');

        if (bus) {
            form.code.value = bus.code;
            if (bus.routeId != null) form.routeId.value = bus.routeId;
            form.active.value = String(bus.active);
        }
        openModal('bus-modal');
    }

    async function saveBus() {
        const form = document.getElementById('bus-form');
        const btn = document.getElementById('bus-save-btn');
        clearFieldErrors(form);

        const payload = {
            code: form.code.value.trim().toLowerCase(),
            routeId: +form.routeId.value,
            active: form.active.value === 'true'
        };

        btn.disabled = true;
        try {
            if (editingBusId) {
                await api(`/api/v1/buses/${editingBusId}`, { method: 'PUT', body: JSON.stringify(payload) });
                toast(`${payload.code.toUpperCase()} updated`);
            } else {
                await api('/api/v1/buses', { method: 'POST', body: JSON.stringify(payload) });
                toast(`${payload.code.toUpperCase()} registered`);
            }
            closeModal('bus-modal');
            await loadAll();
        } catch (err) {
            applyFieldErrors(form, err.fieldErrors);
            if (!err.fieldErrors?.length) toast(err.message, 'error');
        } finally {
            btn.disabled = false;
        }
    }

    // ── Delete confirmations ───────────────────────────────────────
    function confirmDelete(message, action) {
        document.getElementById('confirm-message').textContent = message;
        confirmAction = action;
        openModal('confirm-modal');
    }

    async function runConfirmedAction() {
        if (!confirmAction) return;
        const btn = document.getElementById('confirm-yes');
        btn.disabled = true;
        try {
            await confirmAction();
            closeModal('confirm-modal');
            await loadAll();
        } catch (err) {
            closeModal('confirm-modal');
            toast(err.message, 'error');
        } finally {
            btn.disabled = false;
            confirmAction = null;
        }
    }

    // ── Dark mode (shared behavior with rider site) ────────────────
    function initDarkMode() {
        const toggle = document.getElementById('dark-mode-toggle');
        const icon   = document.getElementById('theme-icon');
        const saved = localStorage.getItem('theme') || 'dark';
        document.documentElement.setAttribute('data-theme', saved);
        icon.className = saved === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
        toggle.addEventListener('click', () => {
            const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', next);
            localStorage.setItem('theme', next);
            icon.className = next === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
        });
    }

    // ── Wiring ─────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        initDarkMode();
        document.getElementById('admin-login-form').addEventListener('submit', handleLogin);
        document.getElementById('admin-logout').addEventListener('click', () => signOut());

        document.querySelectorAll('.admin-nav .nav-item[data-section]').forEach(item => {
            item.addEventListener('click', e => {
                e.preventDefault();
                switchSection(item.dataset.section);
            });
        });

        document.getElementById('admin-menu-toggle').addEventListener('click', () =>
            document.getElementById('admin-sidebar').classList.toggle('open'));

        document.getElementById('refresh-all').addEventListener('click', async e => {
            const icon = e.currentTarget.querySelector('i');
            icon.classList.add('spinning');
            await loadAll();
            setTimeout(() => icon.classList.remove('spinning'), 500);
        });

        document.getElementById('add-route-btn').addEventListener('click', () => openRouteModal(null));
        document.getElementById('add-bus-btn').addEventListener('click', () => openBusModal(null));
        document.getElementById('add-alert-btn').addEventListener('click', () => openAlertModal(null));
        document.getElementById('route-save-btn').addEventListener('click', saveRoute);
        document.getElementById('bus-save-btn').addEventListener('click', saveBus);
        document.getElementById('alert-save-btn').addEventListener('click', saveAlert);
        document.getElementById('confirm-yes').addEventListener('click', runConfirmedAction);

        // Close buttons + backdrop click + Escape
        document.querySelectorAll('[data-close]').forEach(el =>
            el.addEventListener('click', () => closeModal(el.dataset.close)));
        document.querySelectorAll('.modal-overlay').forEach(overlay =>
            overlay.addEventListener('click', e => {
                if (e.target === overlay) overlay.classList.remove('open');
            }));
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
            }
        });

        // Table action buttons (event delegation)
        document.getElementById('routes-admin-body').addEventListener('click', e => {
            const edit = e.target.closest('[data-edit-route]');
            const del  = e.target.closest('[data-delete-route]');
            if (edit) {
                const route = routes.find(r => r.id === +edit.dataset.editRoute);
                if (route) openRouteModal(route);
            } else if (del) {
                const route = routes.find(r => r.id === +del.dataset.deleteRoute);
                if (route) confirmDelete(
                    `Delete route ${route.routeNumber} (${route.name})? Buses must be reassigned first.`,
                    () => api(`/api/v1/routes/${route.id}`, { method: 'DELETE' })
                        .then(() => toast(`Route ${route.routeNumber} deleted`)));
            }
        });

        document.getElementById('fleet-admin-body').addEventListener('click', e => {
            const edit = e.target.closest('[data-edit-bus]');
            const del  = e.target.closest('[data-delete-bus]');
            if (edit) {
                const bus = buses.find(b => b.id === +edit.dataset.editBus);
                if (bus) openBusModal(bus);
            } else if (del) {
                const bus = buses.find(b => b.id === +del.dataset.deleteBus);
                if (bus) confirmDelete(
                    `Delete ${bus.code.toUpperCase()}? This cannot be undone.`,
                    () => api(`/api/v1/buses/${bus.id}`, { method: 'DELETE' })
                        .then(() => toast(`${bus.code.toUpperCase()} deleted`)));
            }
        });

        document.getElementById('alerts-admin-body').addEventListener('click', e => {
            const edit = e.target.closest('[data-edit-alert]');
            const del  = e.target.closest('[data-delete-alert]');
            if (edit) {
                const alert = alerts.find(a => a.id === +edit.dataset.editAlert);
                if (alert) openAlertModal(alert);
            } else if (del) {
                const alert = alerts.find(a => a.id === +del.dataset.deleteAlert);
                if (alert) confirmDelete(
                    `Delete the alert "${alert.title}"?`,
                    () => api(`/api/v1/alerts/${alert.id}`, { method: 'DELETE' })
                        .then(() => toast('Alert deleted')));
            }
        });

        // Resume session if a valid token is present
        const user = currentUser();
        if (user && sessionStorage.getItem(TOKEN_KEY)) {
            api('/api/v1/auth/me')
                .then(me => enterShell({ ...user, ...me }))
                .catch(() => signOut());
        }
    });
})();
