// Driver Dashboard JavaScript - Updated with real-time location sharing

let driverMap = null;
let driverMarker = null;
let otherDriverMarkers = {};
let ws = null;
let locationUpdates = 0;
let currentUser = null;
let watchId = null;
let showOtherDrivers = false;

// Handle login form submission with proper authentication
function setupLogin() {
    const loginForm = document.getElementById('driver-login-form');
    const loginError = document.getElementById('login-error-message');
    const loginPanel = document.getElementById('login-panel');
    const driverPanel = document.getElementById('driver-panel');

    if (!loginForm) {
        console.error('Login form not found');
        return;
    }

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value.trim();

        // Clear previous errors
        if (loginError) {
            loginError.style.display = 'none';
        }

        if (!username || !password) {
            showError('Please enter both driver ID and password');
            return;
        }

        // Show loading state
        const submitBtn = loginForm.querySelector('button[type="submit"]');
        const originalText = submitBtn.innerHTML;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Logging in...';
        submitBtn.disabled = true;

        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (response.ok) {
                // Check if user is a driver
                if (data.role !== 'driver') {
                    showError('Access denied. Driver credentials required.');
                    return;
                }

                // Store user data
                currentUser = data;
                sessionStorage.setItem('driverToken', data.accessToken);
                sessionStorage.setItem('driverData', JSON.stringify(data));

                // Hide login panel and show driver panel
                loginPanel.style.display = 'none';
                driverPanel.style.display = 'block';

                // Initialize dashboard
                await initializeDashboard(data);

            } else {
                const errorMsg = data.error || data.message || 'Login failed. Please check your credentials.';
                showError(errorMsg);
            }
        } catch (error) {
            console.error('Login error:', error);
            showError('Network error. Please check your connection and try again.');
        } finally {
            // Reset button state
            submitBtn.innerHTML = originalText;
            submitBtn.disabled = false;
        }
    });

    function showError(message) {
        if (loginError) {
            loginError.textContent = message;
            loginError.style.display = 'block';
            setTimeout(() => {
                loginError.style.display = 'none';
            }, 5000);
        }
    }
}

// Initialize dashboard after successful login
async function initializeDashboard(userData) {
    try {
        console.log('Initializing dashboard for:', userData.username);

        // Update driver info in UI
        updateDriverInfo(userData);

        // Initialize map
        await initDriverMap();

        // Setup control panel functionality
        setupControlPanel();

        // Connect to WebSocket
        connectWebSocket();

        // Start location tracking
        startLocationTracking();

        // Update connection status
        updateConnectionStatus('Connected');

        // Setup other drivers list
        setupOtherDriversList();

        console.log('Driver dashboard initialized successfully');

    } catch (error) {
        console.error('Error initializing dashboard:', error);
        updateConnectionStatus('Initialization Error');
    }
}

// Update driver information in the UI
function updateDriverInfo(userData) {
    const elements = {
        'driver-username': userData.username || 'Driver',
        'driver-bus-id': userData.busId || 'N/A',
        'current-route': `Route ${userData.busId?.split('-')[1] || '1'}`
    };

    Object.entries(elements).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = value;
        }
    });

    // Update passenger count (simulated)
    const passengerCount = document.getElementById('passenger-count');
    if (passengerCount) {
        passengerCount.textContent = Math.floor(Math.random() * 45) + 5; // Random 5-50
    }
}

// Initialize the map for driver
async function initDriverMap() {
    const mapElement = document.getElementById('driver-map');
    if (!mapElement) {
        console.error('Driver map element not found');
        return;
    }

    if (driverMap) {
        driverMap.invalidateSize();
        return;
    }

    // Create map centered on Aurangabad
    driverMap = L.map('driver-map').setView([19.8762, 75.3433], 13);

    // Add tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 18
    }).addTo(driverMap);

    console.log('Driver map initialized');
}

// Setup control panel functionality
function setupControlPanel() {
    // Center map button
    const centerMapBtn = document.getElementById('center-map');
    if (centerMapBtn) {
        centerMapBtn.addEventListener('click', () => {
            if (driverMarker && driverMap) {
                driverMap.setView(driverMarker.getLatLng(), 16);
                driverMarker.openPopup();
            }
        });
    }

    // Toggle other drivers button
    const toggleDriversBtn = document.getElementById('toggle-other-drivers');
    if (toggleDriversBtn) {
        toggleDriversBtn.addEventListener('click', () => {
            showOtherDrivers = !showOtherDrivers;
            toggleOtherDriversDisplay();

            // Update button text
            const icon = toggleDriversBtn.querySelector('i');
            const text = showOtherDrivers ? 'Hide Other Drivers' : 'Show Other Drivers';
            toggleDriversBtn.innerHTML = `<i class="${icon.className}"></i> ${text}`;
        });
    }

    // Visibility toggle
    const visibilityToggle = document.getElementById('visibility-toggle');
    if (visibilityToggle) {
        visibilityToggle.addEventListener('change', (e) => {
            const isVisible = e.target.checked;
            handleVisibilityToggle(isVisible);
        });
    }

    // Refresh drivers button
    const refreshBtn = document.getElementById('refresh-drivers');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            refreshOtherDriversList();
        });
    }
}

// Handle visibility toggle
function handleVisibilityToggle(isVisible) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        const message = {
            type: 'driver-visibility',
            data: {
                driverId: currentUser?.username,
                busId: currentUser?.busId,
                visible: isVisible
            }
        };
        ws.send(JSON.stringify(message));
    }

    console.log(`Driver visibility set to: ${isVisible ? 'visible' : 'hidden'}`);
}

// Toggle other drivers display
function toggleOtherDriversDisplay() {
    if (showOtherDrivers) {
        // Request other drivers data
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'get-other-drivers',
                data: { driverId: currentUser?.username }
            }));
        }
    } else {
        // Hide other drivers
        Object.keys(otherDriverMarkers).forEach(driverId => {
            driverMap.removeLayer(otherDriverMarkers[driverId]);
        });
        otherDriverMarkers = {};
    }
}

// Start location tracking
function startLocationTracking() {
    if (!navigator.geolocation) {
        console.error('Geolocation is not supported by this browser');
        updateConnectionStatus('Location not supported');
        return;
    }

    const options = {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 5000
    };

    // Get initial position
    navigator.geolocation.getCurrentPosition(
        (position) => {
            handleLocationUpdate(position);
        },
        (error) => {
            console.error('Initial location error:', error);
            updateConnectionStatus('Location access denied');
        },
        options
    );

    // Watch position changes
    watchId = navigator.geolocation.watchPosition(
        (position) => {
            handleLocationUpdate(position);
        },
        (error) => {
            console.error('Location tracking error:', error);
            updateConnectionStatus('Location error');
        },
        options
    );

    console.log('Location tracking started');
}

// Handle location updates
function handleLocationUpdate(position) {
    const { latitude, longitude, accuracy } = position.coords;

    console.log(`Location update: ${latitude.toFixed(6)}, ${longitude.toFixed(6)} (±${accuracy}m)`);

    // Update map marker
    if (driverMap) {
        const newLatLng = [latitude, longitude];

        if (!driverMarker) {
            // Create driver marker with pulsing effect
            const driverIcon = L.divIcon({
                className: 'driver-marker',
                html: `
                    <div style="
                        background: linear-gradient(135deg, #2563eb, #1d4ed8);
                        width: 24px;
                        height: 24px;
                        border-radius: 50%;
                        border: 4px solid white;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        color: white;
                        font-weight: bold;
                        font-size: 12px;
                        box-shadow: 0 4px 15px rgba(37, 99, 235, 0.4);
                        animation: pulse 2s infinite;
                    ">🚌</div>
                `,
                iconSize: [32, 32],
                iconAnchor: [16, 16]
            });

            driverMarker = L.marker(newLatLng, { icon: driverIcon })
                .addTo(driverMap)
                .bindPopup(`
                    <div style="text-align: center;">
                        <strong>Your Bus Location</strong><br>
                        <small>Driver: ${currentUser?.username || 'Unknown'}</small><br>
                        <small>Bus: ${currentUser?.busId || 'Unknown'}</small>
                    </div>
                `);

            // Center map on driver location
            driverMap.setView(newLatLng, 16);
        } else {
            driverMarker.setLatLng(newLatLng);
        }

        // Update popup with current location and accuracy
        driverMarker.setPopupContent(`
            <div style="text-align: center;">
                <strong>Your Bus Location</strong><br>
                <small>Driver: ${currentUser?.username || 'Unknown'}</small><br>
                <small>Bus: ${currentUser?.busId || 'Unknown'}</small><br>
                <hr style="margin: 5px 0;">
                <small>Lat: ${latitude.toFixed(6)}</small><br>
                <small>Lng: ${longitude.toFixed(6)}</small><br>
                <small>Accuracy: ±${Math.round(accuracy)}m</small><br>
                <small style="color: #10b981;">Last updated: ${new Date().toLocaleTimeString()}</small>
            </div>
        `);
    }

    // Send location to server via WebSocket
    if (ws && ws.readyState === WebSocket.OPEN && currentUser) {
        const locationData = {
            type: 'driver-location',
            data: {
                busId: currentUser.busId,
                driverId: currentUser.username,
                coords: [latitude, longitude],
                accuracy: accuracy,
                timestamp: Date.now(),
                visible: document.getElementById('visibility-toggle')?.checked || true
            }
        };

        ws.send(JSON.stringify(locationData));

        // Update metrics
        locationUpdates++;
        updateLocationUpdates(locationUpdates);
        updateLastUpdate(new Date());
    }
}

// Connect to WebSocket
    function connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/websocket`;

    console.log('Connecting to WebSocket...');

    try {
        ws = new WebSocket(wsUrl);

        ws.onopen = function() {
            console.log('WebSocket connected successfully');
            updateConnectionStatus('Connected');

            // Send driver registration
            if (currentUser) {
                ws.send(JSON.stringify({
                    type: 'driver-register',
                    data: {
                        driverId: currentUser.username,
                        busId: currentUser.busId,
                        timestamp: Date.now()
                    }
                }));
            }
        };

        ws.onmessage = function(event) {
            try {
                const message = JSON.parse(event.data);
                handleWebSocketMessage(message);
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
            }
        };

        ws.onclose = function(event) {
            console.log('WebSocket connection closed:', event.code, event.reason);
            updateConnectionStatus('Disconnected');

            // Try to reconnect after 5 seconds
            setTimeout(() => {
                connectWebSocket();
            }, 5000);
        };

        ws.onerror = function(error) {
            console.error('WebSocket error:', error);
            updateConnectionStatus('Connection Error');
        };

    } catch (error) {
        console.error('Error establishing WebSocket connection:', error);
        updateConnectionStatus('Connection Failed');
    }
}

// Handle WebSocket messages
function handleWebSocketMessage(message) {
    switch (message.type) {
        case 'driver-registered':
            console.log('Driver registered successfully:', message.data);
            break;

        case 'location-acknowledged':
            console.log('Location update acknowledged');
            break;

        case 'other-drivers':
            if (showOtherDrivers && message.data) {
                updateOtherDriversOnMap(message.data);
                updateOtherDriversList(message.data);
            }
            break;

        case 'driver-location-update':
            if (showOtherDrivers && message.data) {
                updateSingleDriverLocation(message.data);
            }
            break;

        case 'new-driver-available':
            console.log('New driver available:', message.data);
            if (showOtherDrivers) {
                refreshOtherDriversList();
            }
            break;

        case 'driver-left':
            console.log('Driver left:', message.data);
            removeDriverMarker(message.data.driverId);
            break;

        default:
            console.log('Unknown WebSocket message type:', message.type);
    }
}

// Update other drivers on map
function updateOtherDriversOnMap(drivers) {
    if (!driverMap || !Array.isArray(drivers)) return;

    drivers.forEach(driver => {
        if (driver.driverId === currentUser?.username) return; // Skip self

        if (driver.coords && driver.coords.length >= 2) {
            const [lat, lng] = driver.coords;

            if (otherDriverMarkers[driver.driverId]) {
                // Update existing marker
                otherDriverMarkers[driver.driverId].setLatLng([lat, lng]);
            } else {
                // Create new marker for other driver
                const otherDriverIcon = L.divIcon({
                    className: 'other-driver-marker',
                    html: `
                        <div style="
                            background: linear-gradient(135deg, #10b981, #059669);
                            width: 20px;
                            height: 20px;
                            border-radius: 50%;
                            border: 3px solid white;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            color: white;
                            font-weight: bold;
                            font-size: 10px;
                            box-shadow: 0 3px 12px rgba(16, 185, 129, 0.4);
                            animation: pulse 2s infinite;
                        ">🚌</div>
                    `,
                    iconSize: [26, 26],
                    iconAnchor: [13, 13]
                });

                otherDriverMarkers[driver.driverId] = L.marker([lat, lng], { icon: otherDriverIcon })
                    .addTo(driverMap)
                    .bindPopup(`
                        <div style="text-align: center;">
                            <strong>Driver: ${driver.driverId}</strong><br>
                            <small>Bus: ${driver.busId}</small><br>
                            <small>Last seen: ${new Date(driver.lastSeen || Date.now()).toLocaleTimeString()}</small>
                        </div>
                    `);
            }
        }
    });
}

// Update single driver location
function updateSingleDriverLocation(driver) {
    if (driver.driverId === currentUser?.username) return; // Skip self

    if (otherDriverMarkers[driver.driverId] && driver.coords) {
        const [lat, lng] = driver.coords;
        otherDriverMarkers[driver.driverId].setLatLng([lat, lng]);

        // Update popup with latest time
        otherDriverMarkers[driver.driverId].setPopupContent(`
            <div style="text-align: center;">
                <strong>Driver: ${driver.driverId}</strong><br>
                <small>Bus: ${driver.busId}</small><br>
                <small>Last seen: ${new Date().toLocaleTimeString()}</small>
            </div>
        `);
    }
}

// Remove driver marker when driver disconnects
function removeDriverMarker(driverId) {
    if (otherDriverMarkers[driverId]) {
        driverMap.removeLayer(otherDriverMarkers[driverId]);
        delete otherDriverMarkers[driverId];
        updateOtherDriversList([]); // Refresh list
    }
}

// Setup other drivers list
function setupOtherDriversList() {
    const otherDriversList = document.getElementById('other-drivers-list');
    if (!otherDriversList) return;

    // Initial empty state
    otherDriversList.innerHTML = `
        <div style="text-align: center; color: #64748b; padding: 2rem;">
            <i class="fas fa-users" style="font-size: 2rem; margin-bottom: 1rem;"></i><br>
            Click "Show Other Drivers" to see active drivers
        </div>
    `;
}

// Update other drivers list
function updateOtherDriversList(drivers) {
    const otherDriversList = document.getElementById('other-drivers-list');
    if (!otherDriversList || !Array.isArray(drivers)) return;

    const otherDrivers = drivers.filter(driver => driver.driverId !== currentUser?.username);

    if (otherDrivers.length === 0) {
        otherDriversList.innerHTML = `
            <div style="text-align: center; color: #64748b; padding: 2rem;">
                <i class="fas fa-user-slash" style="font-size: 2rem; margin-bottom: 1rem;"></i><br>
                No other active drivers found
            </div>
        `;
        return;
    }

    otherDriversList.innerHTML = otherDrivers.map(driver => `
        <div class="driver-item">
            <div class="driver-avatar">
                <i class="fas fa-user-circle"></i>
            </div>
            <div class="driver-details">
                <h4>${driver.driverId}</h4>
                <p>Bus: ${driver.busId || 'Unknown'}</p>
                <p>Status: <span class="status-active">Active</span></p>
                <p>Last seen: ${new Date(driver.lastSeen || Date.now()).toLocaleTimeString()}</p>
            </div>
        </div>
    `).join('');
}

// Refresh other drivers list
function refreshOtherDriversList() {
    if (ws && ws.readyState === WebSocket.OPEN && currentUser) {
        ws.send(JSON.stringify({
            type: 'get-other-drivers',
            data: { driverId: currentUser.username }
        }));

        // Show loading state
        const refreshBtn = document.getElementById('refresh-drivers');
        if (refreshBtn) {
            const icon = refreshBtn.querySelector('i');
            const originalClass = icon.className;
            icon.className = 'fas fa-spinner fa-spin';
            setTimeout(() => {
                icon.className = originalClass;
            }, 1000);
        }
    }
}

// Update UI elements
function updateConnectionStatus(status) {
    const statusElement = document.getElementById('connection-status');
    if (statusElement) {
        statusElement.textContent = status;

        // Update color based on status
        const colors = {
            'Connected': '#10b981',
            'Disconnected': '#ef4444',
            'Connecting...': '#f59e0b',
            'Connection Error': '#ef4444',
            'Connection Failed': '#ef4444',
            'Location not supported': '#ef4444',
            'Location access denied': '#f59e0b',
            'Location error': '#ef4444'
        };

        statusElement.style.color = colors[status] || '#f59e0b';
    }
}

function updateLocationUpdates(count) {
    const updatesElement = document.getElementById('location-updates');
    if (updatesElement) {
        updatesElement.textContent = count.toLocaleString();
    }
}

function updateLastUpdate(date) {
    const lastUpdateElement = document.getElementById('last-update');
    if (lastUpdateElement) {
        lastUpdateElement.textContent = date.toLocaleTimeString();
    }
}

// Logout functionality
function setupLogout() {
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            try {
                // Stop location tracking
                if (watchId) {
                    navigator.geolocation.clearWatch(watchId);
                    watchId = null;
                }

                // Close WebSocket connection
                if (ws) {
                    ws.close();
                    ws = null;
                }

                // Call logout API
                if (currentUser?.accessToken) {
                    await fetch('/api/auth/logout', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${currentUser.accessToken}`,
                            'Content-Type': 'application/json'
                        }
                    }).catch(error => {
                        console.error('Logout API error:', error);
                    });
                }

                // Clear stored data
                sessionStorage.removeItem('driverToken');
                sessionStorage.removeItem('driverData');
                currentUser = null;

                // Reload page to return to login
                window.location.reload();

            } catch (error) {
                console.error('Error during logout:', error);
                // Force reload anyway
                window.location.reload();
            }
        });
    }
}

// Check for existing session on page load
function checkExistingSession() {
    const token = sessionStorage.getItem('driverToken');
    const driverData = sessionStorage.getItem('driverData');

    if (token && driverData) {
        try {
            const userData = JSON.parse(driverData);

            // Validate token (basic check)
            if (userData.username && userData.role === 'driver') {
                currentUser = userData;

                // Hide login panel and show driver panel
                const loginPanel = document.getElementById('login-panel');
                const driverPanel = document.getElementById('driver-panel');

                if (loginPanel && driverPanel) {
                    loginPanel.style.display = 'none';
                    driverPanel.style.display = 'block';

                    // Initialize dashboard
                    initializeDashboard(userData);
                }
            }

        } catch (error) {
            console.error('Error parsing stored driver data:', error);
            // Clear invalid data
            sessionStorage.removeItem('driverToken');
            sessionStorage.removeItem('driverData');
        }
    }
}

// Initialize everything when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('Initializing Driver Dashboard...');

    // Initialize components
    setupLogin();
    setupLogout();

    // Check for existing session
    checkExistingSession();

    console.log('Driver Dashboard initialization complete');
});

// Handle page unload
window.addEventListener('beforeunload', () => {
    // Clean up resources
    if (watchId) {
        navigator.geolocation.clearWatch(watchId);
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
    }
});

// Handle map resize
window.addEventListener('resize', () => {
    if (driverMap) {
        setTimeout(() => driverMap.invalidateSize(), 100);
    }
});