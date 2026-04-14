// Main application JavaScript - Updated with real-time location tracking

// Global variables
let trackingMap = null;
let homeMap = null;
let busMarkers = {};
let userMarker = null;
let routeLayers = {};
let selectedBusRoute = null;
let ws = null;
let currentUser = null;
let userLocation = null;

// Initialize particles background
function initParticles() {
    const particlesContainer = document.getElementById('particles');
    if (!particlesContainer) return;

    const particleCount = 60;

    for (let i = 0; i < particleCount; i++) {
        const particle = document.createElement('div');
        particle.classList.add('particle');

        const size = Math.random() * 5 + 3;
        particle.style.width = `${size}px`;
        particle.style.height = `${size}px`;
        particle.style.left = `${Math.random() * 100}%`;
        particle.style.top = `${Math.random() * 100}%`;
        particle.style.animationDelay = `${Math.random() * 18}s`;
        particle.style.animationDuration = `${18 + Math.random() * 12}s`;

        particlesContainer.appendChild(particle);
    }
}

// Initialize dark mode toggle
function initDarkModeToggle() {
    const darkModeToggle = document.getElementById('dark-mode-toggle');
    const themeIcon = document.getElementById('theme-icon');

    if (!darkModeToggle || !themeIcon) return;

    // Check for saved theme preference
    const currentTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', currentTheme);

    // Update icon based on current theme
    updateThemeIcon(currentTheme, themeIcon);

    darkModeToggle.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        updateThemeIcon(newTheme, themeIcon);
    });
}

function updateThemeIcon(theme, iconElement) {
    if (theme === 'dark') {
        iconElement.className = 'fas fa-sun';
    } else {
        iconElement.className = 'fas fa-moon';
    }
}

// Initialize navigation and button functionality
function setupNavigationAndButtons() {
    // Track Now button functionality
    const trackNowBtn = document.getElementById('track-now-btn');
    if (trackNowBtn) {
        trackNowBtn.addEventListener('click', (e) => {
            e.preventDefault();
            switchToPage('tracking');
        });
    }

    // Search button functionality
    const searchBtn = document.getElementById('search-btn');
    if (searchBtn) {
        searchBtn.addEventListener('click', (e) => {
            e.preventDefault();
            performBusSearch();
        });
    }

    // Contact form submission
    const contactForm = document.getElementById('contact-form');
    if (contactForm) {
        contactForm.addEventListener('submit', (e) => {
            e.preventDefault();
            handleContactFormSubmit();
        });
    }

    // FAQ functionality
    setupFAQ();
}

// Setup FAQ accordion functionality
function setupFAQ() {
    const faqQuestions = document.querySelectorAll('.faq-question');

    faqQuestions.forEach(question => {
        question.addEventListener('click', () => {
            const faqItem = question.closest('.faq-item');
            const isActive = faqItem.classList.contains('active');

            // Close all FAQ items
            document.querySelectorAll('.faq-item').forEach(item => {
                item.classList.remove('active');
            });

            // Open clicked item if it wasn't active
            if (!isActive) {
                faqItem.classList.add('active');
            }
        });
    });
}

// Switch to specific page
function switchToPage(pageName) {
    // Update navigation
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('data-page') === pageName) {
            link.classList.add('active');
        }
    });

    // Show target page
    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active');
        if (page.id === pageName) {
            page.classList.add('active');

            // Initialize map if tracking page
            if (pageName === 'tracking') {
                setTimeout(() => initTrackingMap(), 100);
            }
        }
    });

    window.scrollTo(0, 0);
}

// Navigation functionality with driver login fix
function setupNavigation() {
    const navLinks = document.querySelectorAll('.nav-link');

    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetPage = link.getAttribute('data-page');

            // Handle driver login specially
            if (link.id === 'driver-login-link') {
                // Redirect to driver page
                window.location.href = '/driver';
                return;
            }

            if (targetPage) {
                switchToPage(targetPage);
            }
        });
    });
}

// Auto-login user (no authentication required for regular users)
function autoLoginUser() {
    currentUser = {
        username: 'Guest User',
        role: 'user',
        isAuthenticated: true
    };

    updateUserInterface();

    // Store in session
    sessionStorage.setItem('currentUser', JSON.stringify(currentUser));

    console.log('User auto-logged in as guest');
}

// Update user interface based on login status
function updateUserInterface() {
    const userInfo = document.getElementById('user-info');
    const userStatusText = document.getElementById('user-status-text');
    const logoutBtn = document.getElementById('logout-btn');

    if (userInfo && userStatusText) {
        userInfo.style.display = 'block';
        userStatusText.textContent = currentUser ? currentUser.username : 'Guest';

        if (logoutBtn && currentUser && currentUser.role === 'driver') {
            logoutBtn.style.display = 'block';
        }
    }
}

// Initialize home map with enhanced styling
function initHomeMap() {
    const homeMapElement = document.getElementById('home-map');
    if (!homeMapElement || homeMap) return;

    homeMap = L.map('home-map').setView([19.8762, 75.3433], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(homeMap);

    // Add sample bus stop markers with fresh styling
    const sampleStops = [
        { name: "Central Bus Station", coords: [19.8762, 75.3433] },
        { name: "Railway Station", coords: [19.8610, 75.3101] },
        { name: "Airport Road", coords: [19.8650, 75.3980] },
        { name: "City Center Mall", coords: [19.8750, 75.3450] },
        { name: "Medical College", coords: [19.8690, 75.3200] }
    ];

    sampleStops.forEach(stop => {
        L.marker(stop.coords, {
            icon: L.divIcon({
                className: 'stop-marker',
                html: `<div style="background: linear-gradient(135deg, #ff6b6b, #4ecdc4); width: 15px; height: 15px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 8px rgba(255, 107, 107, 0.3);"></div>`,
                iconSize: [21, 21],
                iconAnchor: [10, 10]
            })
        }).addTo(homeMap).bindPopup(`
            <div style="text-align: center; font-weight: 600;">
                <strong style="color: #ff6b6b;">${stop.name}</strong><br>
                <small style="color: #4a5568;">Bus Stop</small>
            </div>
        `);
    });

    console.log('Home map initialized with fresh theme');
}

// Initialize tracking map with enhanced functionality
function initTrackingMap() {
    const trackingMapElement = document.getElementById('tracking-map');
    if (!trackingMapElement) {
        console.error('Tracking map element not found');
        return;
    }

    if (trackingMap) {
        trackingMap.invalidateSize();
        return;
    }

    // Create map
    trackingMap = L.map('tracking-map').setView([19.8762, 75.3433], 13);

    // Add tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 18
    }).addTo(trackingMap);

    // Get user location
    getUserLocation();

    // Load bus routes
    loadBusRoutes();

    // Generate bus list
    generateBusList();

    // Connect to WebSocket for real-time updates
    connectWebSocket();

    console.log('Tracking map initialized with fresh theme');
}

// Get user's current location with enhanced marker
function getUserLocation() {
    if (!navigator.geolocation) {
        console.log('Geolocation not supported');
        // Default to Aurangabad coordinates
        if (trackingMap) {
            trackingMap.setView([19.8762, 75.3433], 13);
        }
        return;
    }

    navigator.geolocation.getCurrentPosition(
        (position) => {
            const { latitude, longitude } = position.coords;
            userLocation = { lat: latitude, lng: longitude };

            if (!userMarker && trackingMap) {
                // Create user location marker with pulsing effect
                userMarker = L.marker([latitude, longitude], {
                    icon: L.divIcon({
                        className: 'user-marker',
                        html: `
                            <div style="
                                background: linear-gradient(135deg, #4ecdc4, #ffe66d);
                                width: 20px;
                                height: 20px;
                                border-radius: 50%;
                                border: 4px solid white;
                                box-shadow: 0 3px 12px rgba(78, 205, 196, 0.4);
                                position: relative;
                                animation: pulse 2s infinite;
                            ">
                                <div style="
                                    position: absolute;
                                    top: 50%;
                                    left: 50%;
                                    transform: translate(-50%, -50%);
                                    font-size: 10px;
                                    color: white;
                                    font-weight: bold;
                                ">📍</div>
                            </div>
                        `,
                        iconSize: [28, 28],
                        iconAnchor: [14, 14]
                    })
                }).addTo(trackingMap);

                userMarker.bindPopup(`
                    <div style="text-align: center; font-weight: 600;">
                        <strong style="color: #4ecdc4;">📍 Your Location</strong><br>
                        <small style="color: #4a5568;">Lat: ${latitude.toFixed(6)}</small><br>
                        <small style="color: #4a5568;">Lng: ${longitude.toFixed(6)}</small>
                    </div>
                `);

                // Center map on user location
                trackingMap.setView([latitude, longitude], 15);

                // Send user location to server
                sendUserLocation(latitude, longitude);
            }
        },
        (error) => {
            console.error('Error getting location:', error);
            // Default to Aurangabad coordinates
            if (trackingMap) {
                trackingMap.setView([19.8762, 75.3433], 13);
            }
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        }
    );
}

// Send user location to server via WebSocket
function sendUserLocation(lat, lng) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        const message = {
            type: 'user-location',
            data: {
                coords: [lat, lng],
                timestamp: Date.now()
            }
        };
        ws.send(JSON.stringify(message));
    }
}

// Load and display bus routes with fresh colors
function loadBusRoutes() {
    if (!trackingMap) return;

    const routes = {
        "1": {
            name: "Ranjangaon Phata",
            path: [
                [19.851408, 75.209897],
                [19.840466, 75.232433],
                [19.845526, 75.240380],
                [19.838546, 75.251527],
                [19.837301, 75.253563],
                [19.847091, 75.265890],
                [19.832842, 75.270292],
                [19.827377, 75.289950],
                [19.832516, 75.290357]
            ],
            color: '#ff6b6b',
            stops: [
                { name: "Ranjangaon Phata", coords: [19.875743, 75.334755] },
                { name: "Alphonsa", coords: [19.840466, 75.232433] },
                { name: "Pratap Chowk", coords: [19.839425, 75.241251] },
                { name: "MIDC RD", coords: [19.838546, 75.251527] },
                { name: "Gollwadi Chowk", coords: [19.847091, 75.265890] },
                { name: "Paithan RD", coords: [19.827377, 75.289950] },
                { name: "CSMSS", coords: [19.832516, 75.290357] }
            ]
        },
        "2": {
            name: "Fame Tapadia Signal",
            path: [
                [19.876796, 75.366045],
                [19.883883, 75.365047],
                [19.895284, 75.364767],
                [19.904718, 75.357021],
                [19.909854, 75.353163],
                [19.914915, 75.352384],
                [19.906784, 75.343839],
                [19.904839, 75.342060],
                [19.894397, 75.337078],
                [19.892250, 75.327619],
                [19.884206, 75.317144],
                [19.861054, 75.310145],
                [19.832545, 75.290382]
            ],
            color: '#4ecdc4',
            stops: [
                        { name: 'Fame Tapadia Signal', coords: [19.876796, 75.366045] },
                        { name: 'N1 Ganpati ', coords: [19.883883, 75.365047] },
                        { name: ' Wokhardt ', coords: [19.895284, 75.364767] },
                        { name: 'Ambedkar Chowk', coords: [19.898180, 75.362212] },
                        { name: 'Jaiswal Hall ', coords: [19.904718, 75.357021] },
                        { name: ' SBOA ', coords: [19.909854, 75.353163] },
                        { name: ' T. Point ', coords: [19.914915, 75.352384] },
                        { name: 'Power House ', coords: [19.906784, 75.343839] },
                        { name: 'Hudco Corner ', coords: [19.904839, 75.342060] },
                        { name: 'Collector Office ', coords: [19.894397, 75.337078] },
                        { name: 'Jubilee Park ', coords: [19.892250, 75.327619] },
                        { name: ' Mill Corner ', coords: [19.884206, 75.317144] },
                        { name: 'bharat petroleum ', coords: [19.884206, 75.317144] },
                        { name: 'Railway Station', coords: [19.861054, 75.310145] },
                        { name: 'Paithan RD', coords: [19.861054, 75.310145] },
                        { name: 'Csmss', coords: [19.832545, 75.290382] },
                    ]
        },

        "3": {
                    name: "Chikalthana",
                    path: [
                        [19.873573, 75.394782],
                        [19.869982, 75.394397],
                        [19.871974, 75.385324],
                        [19.873522, 75.370390],
                        [19.874840, 75.355761],
                        [19.875275, 75.352356],
                        [19.876049, 75.341475],
                        [19.873642, 75.328705],
                        [19.872266, 75.322000],
                        [19.860902, 75.310143],
                        [19.861369, 75.306988],
                        [19.847678, 75.296336],
                        [19.833201, 75.290463]
                    ],
                    color: '#ff6b6b',
                    stops: [
                                { name: 'Chikalthana', coords: [19.873573, 75.394782] },
                                { name: ' Dhoot Hospita', coords: [19.869982, 75.394397] },
                                { name: ' Ram Nagar', coords: [19.871974, 75.385324] },
                                { name: 'API Corner', coords: [19.873522, 75.370390] },
                                { name: 'Ramgiri Hotel', coords: [19.874840, 75.355761] },
                                { name: ' Seven Hills', coords: [19.875275, 75.352356] },
                                { name: 'Akashwani', coords: [19.876049, 75.341475] },
                                { name: 'Mondha Naka', coords: [19.873642, 75.328705] },
                                { name: ' Amarpreet', coords: [19.872266, 75.322000] },
                                { name: 'Kranti Chowk', coords: [19.872266, 75.322000] },
                                { name: ' Gopal T', coords: [19.860902, 75.310143] },
                                { name: ' Jai Tower', coords: [19.861369, 75.306988] },
                                { name: ' Padampura', coords: [19.847678, 75.296336] },
                                { name: ' csmss', coords: [19.833201, 75.290463] },
                            ]
                },

                "4": {
                                    name: "Baliram Patil High School",
                                    path: [
                                        [19.895877, 75.358173],
                                        [19.888110, 75.360340],
                                        [19.879980, 75.360448],
                                        [19.883450420753835, 75.35381853503729],
                                        [19.875295, 75.353286],
                                        [19.869060, 75.350870],
                                        [19.858987, 75.344975],
                                        [19.857757, 75.334539],
                                        [19.850451, 75.333036],
                                        [19.854130, 75.305745],
                                        [19.854687, 75.302286],
                                        [19.841854, 75.293056],
                                        [19.832519, 75.290360]
                                    ],
                                    color: '#ff6b6b',
                                    stops: [
                                                { name: ' Baliram Patil High School', coords: [19.895877, 75.358173] },
                                                { name: ' Bajrang Chowk RD', coords: [19.888110, 75.360340] },
                                                { name: ' Chistiya Chowk RD', coords: [19.879980, 75.360448] },
                                                { name: ' Central Naka RD', coords: [19.883450420753835, 75.35381853503729] },
                                                { name: ' Seven Hills Signal', coords: [19.875295, 75.353286] },
                                                { name: ' Gajanan Mandir', coords: [19.869060, 75.350870] },
                                                { name: ' Reliance Mall', coords: [19.865591, 75.349258] },
                                                { name: ' suthgirni showk RD', coords: [19.858987, 75.344975] },
                                                { name: ' Shivaji Nagar RD', coords: [19.857757, 75.334539] },
                                                { name: ' Darga RD', coords: [19.850451, 75.333036] },
                                                { name: ' Dhule- Solapur Hwy', coords: [19.854130, 75.305745] },
                                                { name: ' Dhule- Solapur Hwy Corner', coords: [19.854687, 75.302286] },
                                                { name: ' Jai Shriram Square', coords: [19.841854, 75.293056] },
                                                { name: ' CSMSS', coords: [19.832519, 75.290360] }
                                            ]
                                },
    };

    // Store routes but don't display initially
    window.busRoutes = routes;
    console.log('Bus routes loaded with fresh colors');
}

// Generate bus list with enhanced styling
function generateBusList() {
    const busList = document.getElementById('bus-list');
    if (!busList) return;

    // Default buses (will be updated with real data from WebSocket)
    const defaultBuses = [
        { id: 'bus-1', route: 'Route 1: Ranjangaon Phata', routeId: '1', status: 'Active', nextStop: 'Alphonsa' },
        { id: 'bus-2', route: 'Route 1: Fame Tapadia Signal', routeId: '1', status: 'Active', nextStop: 'MIDC RD' },
        { id: 'bus-3', route: 'Route 2: Chikalthana', routeId: '2', status: 'Active', nextStop: 'Wokhardt' },
        { id: 'bus-4', route: 'Route 2: Mahalaxmi Chowk', routeId: '2', status: 'Active', nextStop: 'Railway Station' },
        { id: 'bus-5', route: 'Route 1: Baliram Patil High School', routeId: '1', status: 'Active', nextStop: 'Pratap Chowk' }
    ];

    busList.innerHTML = '';

    defaultBuses.forEach(bus => {
        const busCard = document.createElement('div');
        busCard.className = 'bus-card';
        busCard.setAttribute('data-bus-id', bus.id);
        busCard.setAttribute('data-route-id', bus.routeId);

        busCard.innerHTML = `
            <div class="bus-number">${bus.id.toUpperCase()}</div>
            <div class="bus-route">${bus.route}</div>
            <div class="bus-status status-active">
                <i class="fas fa-circle"></i> ${bus.status}
            </div>
            <div class="bus-next-stop">Next: ${bus.nextStop}</div>
            <button class="track-bus-btn" data-bus-id="${bus.id}" data-route-id="${bus.routeId}">
                <i class="fas fa-map-marker-alt"></i> Track This Bus
            </button>
        `;

        busList.appendChild(busCard);

        // Add click event to track button
        const trackBtn = busCard.querySelector('.track-bus-btn');
        trackBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            trackBus(bus.id, bus.routeId);
        });

        // Add click event to entire card
        busCard.addEventListener('click', () => {
            selectBusRoute(bus.routeId);
        });
    });

    console.log('Bus list generated with fresh styling');
}

// Track specific bus and show route
function trackBus(busId, routeId) {
    console.log(`Tracking bus ${busId} on route ${routeId}`);

    // Clear previous selection
    clearRouteSelection();

    // Show route
    showRoute(routeId);

    // Send tracking request to server
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'track-bus',
            data: { busId: busId }
        }));
    }

    // Update UI to show tracking status
    updateTrackingStatus(busId, routeId);
}

// Select and highlight route
function selectBusRoute(routeId) {
    // Clear previous routes
    clearRouteSelection();

    // Show selected route
    showRoute(routeId);

    // Update bus cards visual state
    document.querySelectorAll('.bus-card').forEach(card => {
        card.classList.remove('selected');
        if (card.getAttribute('data-route-id') === routeId) {
            card.classList.add('selected');
        }
    });

    selectedBusRoute = routeId;
    console.log(`Selected route ${routeId}`);
}

// Show specific route on map with fresh colors
function showRoute(routeId) {
    if (!trackingMap || !window.busRoutes) return;

    const route = window.busRoutes[routeId];
    if (!route) return;

    // Draw route path with enhanced styling
    const routePath = L.polyline(route.path, {
        color: route.color,
        weight: 5,
        opacity: 0.9,
        dashArray: '10, 5',
        lineJoin: 'round',
        lineCap: 'round'
    }).addTo(trackingMap);

    // Store route layer
    routeLayers[routeId] = {
        path: routePath,
        stops: []
    };

    // Add stops with enhanced markers
    route.stops.forEach((stop, index) => {
        const stopMarker = L.marker(stop.coords, {
            icon: L.divIcon({
                className: 'stop-marker',
                html: `<div style="background: ${route.color}; width: 14px; height: 14px; border-radius: 50%; border: 3px solid white; box-shadow: 0 3px 10px rgba(255, 107, 107, 0.3);"></div>`,
                iconSize: [20, 20],
                iconAnchor: [10, 10]
            })
        }).addTo(trackingMap);

        stopMarker.bindPopup(`
            <div style="text-align: center; font-weight: 600;">
                <strong style="color: ${route.color};">Stop ${index + 1}</strong><br>
                <span style="color: #2d3748;">${stop.name}</span><br>
                <small style="color: #4a5568;">Route: ${route.name}</small>
            </div>
        `);
        routeLayers[routeId].stops.push(stopMarker);
    });

    // Fit map to route bounds
    const group = new L.featureGroup([routePath]);
    trackingMap.fitBounds(group.getBounds().pad(0.1));
}

// Clear all route selections
function clearRouteSelection() {
    // Remove route layers
    Object.keys(routeLayers).forEach(routeId => {
        const routeLayer = routeLayers[routeId];
        if (routeLayer.path) {
            trackingMap.removeLayer(routeLayer.path);
        }
        routeLayer.stops.forEach(stop => {
            trackingMap.removeLayer(stop);
        });
    });

    // Clear route layers object
    routeLayers = {};

    // Remove bus markers (but keep real-time driver markers)
    Object.keys(busMarkers).forEach(busId => {
        if (busMarkers[busId].isSimulated) {
            trackingMap.removeLayer(busMarkers[busId]);
        }
    });

    // Clear simulated bus markers only
    Object.keys(busMarkers).forEach(busId => {
        if (busMarkers[busId].isSimulated) {
            delete busMarkers[busId];
        }
    });

    // Clear visual selection
    document.querySelectorAll('.bus-card').forEach(card => {
        card.classList.remove('selected');
    });

    selectedBusRoute = null;
}

// Update bus locations from WebSocket data
function updateBusLocations(busData) {
    if (!trackingMap || !Array.isArray(busData)) return;

    busData.forEach(bus => {
        if (bus.coords && bus.coords.length >= 2) {
            const [lat, lng] = bus.coords;
            const busId = bus.busId;

            if (busMarkers[busId]) {
                // Update existing marker
                busMarkers[busId].setLatLng([lat, lng]);
            } else {
                // Create new real-time bus marker
                const busIcon = L.divIcon({
                    className: 'bus-marker real-time',
                    html: `
                        <div style="
                            background: linear-gradient(135deg, #ff6b6b, #4ecdc4);
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
                            box-shadow: 0 4px 15px rgba(255, 107, 107, 0.4);
                            animation: pulse 2s infinite;
                        ">🚌</div>
                    `,
                    iconSize: [32, 32],
                    iconAnchor: [16, 16]
                });

                busMarkers[busId] = L.marker([lat, lng], { icon: busIcon })
                    .addTo(trackingMap)
                    .bindPopup(`
                        <div style="text-align: center; font-weight: 600;">
                            <strong style="color: #ff6b6b;">${busId.toUpperCase()}</strong><br>
                            <span style="color: #2d3748;">Driver: ${bus.driverId || 'Unknown'}</span><br>
                            <span style="color: #4ecdc4; font-size: 0.9rem;">Status: Live Tracking</span><br>
                            <small style="color: #718096;">Last update: ${new Date(bus.lastSeen).toLocaleTimeString()}</small>
                        </div>
                    `);

                // Mark as real-time (not simulated)
                busMarkers[busId].isSimulated = false;
            }

            // Update bus card status if exists
            updateBusCardStatus(busId, 'Active', new Date(bus.lastSeen));
        }
    });
}

// Update bus card status in the list
function updateBusCardStatus(busId, status, lastSeen) {
    const busCard = document.querySelector(`[data-bus-id="${busId}"]`);
    if (busCard) {
        const statusElement = busCard.querySelector('.bus-status');
        const nextStopElement = busCard.querySelector('.bus-next-stop');

        if (statusElement) {
            statusElement.innerHTML = `<i class="fas fa-circle"></i> ${status}`;
            statusElement.className = `bus-status status-${status.toLowerCase()}`;
        }

        if (nextStopElement && lastSeen) {
            const timeAgo = Math.round((Date.now() - lastSeen) / 60000); // minutes ago
            nextStopElement.innerHTML = `Updated ${timeAgo} min ago`;
        }
    }
}

// Connect to WebSocket for real-time updates
    function connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/websocket`;

    try {
        ws = new WebSocket(wsUrl);

        ws.onopen = function() {
            console.log('WebSocket connected to server');

            // Register as user
            ws.send(JSON.stringify({
                type: 'user-register',
                data: {
                    userId: 'user_' + Math.random().toString(36).substr(2, 9),
                    timestamp: Date.now()
                }
            }));
        };

        ws.onmessage = function(event) {
            try {
                const message = JSON.parse(event.data);
                handleWebSocketMessage(message);
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
            }
        };

        ws.onclose = function() {
            console.log('WebSocket connection closed');
            // Try to reconnect after 5 seconds
            setTimeout(connectWebSocket, 5000);
        };

        ws.onerror = function(error) {
            console.error('WebSocket error:', error);
        };
    } catch (error) {
        console.error('Error establishing WebSocket connection:', error);
    }
}

// Handle WebSocket messages
function handleWebSocketMessage(message) {
    switch (message.type) {
        case 'user-registered':
            console.log('User registered successfully:', message.data);
            break;

        case 'active-buses':
            if (message.data) {
                updateBusLocations(message.data);
            }
            break;

        case 'bus-location-update':
            if (message.data) {
                updateSingleBusLocation(message.data);
            }
            break;

        case 'new-driver-available':
            console.log('New driver available:', message.data);
            break;

        case 'driver-left':
            console.log('Driver left:', message.data);
            removeBusMarker(message.data.driverId);
            break;

        case 'tracking-started':
            console.log('Tracking started:', message.data);
            showNotification(`Now tracking ${message.data.busId}`);
            break;

        default:
            console.log('Unknown message type:', message.type);
    }
}

// Update single bus location
function updateSingleBusLocation(busData) {
    if (busData.coords && busData.coords.length >= 2) {
        const [lat, lng] = busData.coords;
        const busId = busData.busId;

        if (busMarkers[busId]) {
            busMarkers[busId].setLatLng([lat, lng]);
        } else {
            updateBusLocations([busData]);
        }
    }
}

// Remove bus marker when driver disconnects
function removeBusMarker(busId) {
    if (busMarkers[busId]) {
        trackingMap.removeLayer(busMarkers[busId]);
        delete busMarkers[busId];

        // Update bus card status
        updateBusCardStatus(busId, 'Offline', new Date());
    }
}

// Show notification to user
function showNotification(message) {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.innerHTML = `
        <div class="notification-content">
            <i class="fas fa-bell"></i>
            <span>${message}</span>
        </div>
    `;

    // Add styles if not already added
    if (!document.querySelector('#notification-styles')) {
        const styles = document.createElement('style');
        styles.id = 'notification-styles';
        styles.textContent = `
            .notification {
                position: fixed;
                top: 20px;
                right: 20px;
                background: linear-gradient(135deg, #4ecdc4, #44a08d);
                color: white;
                padding: 15px 20px;
                border-radius: 10px;
                box-shadow: 0 4px 15px rgba(0,0,0,0.2);
                z-index: 1000;
                animation: slideIn 0.3s ease-out;
            }
            .notification-content {
                display: flex;
                align-items: center;
                gap: 10px;
            }
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
        `;
        document.head.appendChild(styles);
    }

    document.body.appendChild(notification);

    // Remove after 3 seconds
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// Update tracking status in UI
function updateTrackingStatus(busId, routeId) {
    showNotification(`Now tracking ${busId.toUpperCase()} on ${window.busRoutes[routeId]?.name || 'Route ' + routeId}`);
}

// Search functionality
function setupSearch() {
    const searchInput = document.getElementById('route-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            filterBusList(searchTerm);
        });

        // Allow Enter key to trigger search
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                performBusSearch();
            }
        });
    }
}

// Perform bus search
function performBusSearch() {
    const searchInput = document.getElementById('route-search');
    if (searchInput) {
        const searchTerm = searchInput.value.toLowerCase();
        filterBusList(searchTerm);
    }
}

// Filter bus list based on search
function filterBusList(searchTerm) {
    const busCards = document.querySelectorAll('.bus-card');

    busCards.forEach(card => {
        const busId = card.querySelector('.bus-number').textContent.toLowerCase();
        const routeName = card.querySelector('.bus-route').textContent.toLowerCase();

        if (busId.includes(searchTerm) || routeName.includes(searchTerm) || searchTerm === '') {
            card.style.display = 'block';
        } else {
            card.style.display = 'none';
        }
    });
}

// Route filter functionality
function setupRouteFilter() {
    const routeFilter = document.getElementById('route-filter');
    if (routeFilter) {
        routeFilter.addEventListener('change', (e) => {
            const selectedRoute = e.target.value;
            filterBusByRoute(selectedRoute);
        });
    }
}

// Filter buses by route
function filterBusByRoute(routeId) {
    const busCards = document.querySelectorAll('.bus-card');

    busCards.forEach(card => {
        const cardRouteId = card.getAttribute('data-route-id');

        if (routeId === 'all' || cardRouteId === routeId) {
            card.style.display = 'block';
        } else {
            card.style.display = 'none';
        }
    });
}

// Handle contact form submission
function handleContactFormSubmit() {
    const form = document.getElementById('contact-form');
    const successMessage = document.getElementById('contact-success');

    if (!form) return;

    const formData = new FormData(form);
    const name = formData.get('name');
    const email = formData.get('email');
    const message = formData.get('message');

    // Simple validation
    if (!name || !email || !message) {
        alert('Please fill in all required fields');
        return;
    }

    // Show success message
    if (successMessage) {
        successMessage.classList.add('show');
        setTimeout(() => {
            successMessage.classList.remove('show');
        }, 5000);
    }

    // Reset form
    form.reset();
    console.log('Contact form submitted successfully');
}

// Check for existing session
function checkExistingSession() {
    const userData = sessionStorage.getItem('currentUser');
    if (userData) {
        currentUser = JSON.parse(userData);
        updateUserInterface();
    } else {
        // Auto-login as guest
        autoLoginUser();
    }
}

// Initialize everything when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('Initializing CityBus application with real-time tracking...');

    // Initialize components
    initParticles();
    initDarkModeToggle();
    setupNavigation();
    setupNavigationAndButtons();
    setupSearch();
    setupRouteFilter();

    // Check/setup user session
    checkExistingSession();

    // Initialize home map when home page loads
    const homeSection = document.getElementById('home');
    if (homeSection && homeSection.classList.contains('active')) {
        setTimeout(() => initHomeMap(), 500);
    }

    // Set up observer to initialize maps when pages become visible
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                const target = mutation.target;
                if (target.classList.contains('active')) {
                    if (target.id === 'home' && !homeMap) {
                        setTimeout(() => initHomeMap(), 100);
                    } else if (target.id === 'tracking' && !trackingMap) {
                        setTimeout(() => initTrackingMap(), 100);
                    }
                }
            }
        });
    });

    // Observe all page elements
    document.querySelectorAll('.page').forEach(page => {
        observer.observe(page, { attributes: true });
    });

    console.log('CityBus application initialized with real-time tracking');
});

// Map click handler to clear route selection
document.addEventListener('click', (e) => {
    // If clicking on map (not on bus cards or buttons), clear route selection
    if (e.target.closest('#tracking-map') && !e.target.closest('.bus-card') && !e.target.closest('.track-bus-btn')) {
        if (selectedBusRoute) {
            clearRouteSelection();
        }
    }
});
// Add to your existing script.js
function integrateChatbot() {
    // Make chatbot functions available globally
    window.openBusChatbot = function(busNumber) {
        if (window.citybusChatbot) {
            window.citybusChatbot.openChatbot();
            setTimeout(() => {
                window.askChatbot(`Where is bus ${busNumber}?`);
            }, 300);
        }
    };

    // Add chatbot help to navigation
    const helpLink = document.createElement('a');
    helpLink.href = '#';
    helpLink.className = 'nav-item nav-link';
    helpLink.innerHTML = '<i class="nav-icon fas fa-robot"></i><span class="nav-text">AI Assistant</span>';
    helpLink.addEventListener('click', (e) => {
        e.preventDefault();
        if (window.citybusChatbot) {
            window.citybusChatbot.openChatbot();
        }
    });

    // Add to navigation menu
    const navMenu = document.querySelector('.nav-menu');
    if (navMenu) {
        navMenu.appendChild(helpLink);
    }
}

// Call this function in your DOMContentLoaded event
document.addEventListener('DOMContentLoaded', () => {
    // ... your existing code ...
    integrateChatbot();
});
// Handle page resize
window.addEventListener('resize', () => {
    if (trackingMap) {
        setTimeout(() => trackingMap.invalidateSize(), 100);
    }
    if (homeMap) {
        setTimeout(() => homeMap.invalidateSize(), 100);
    }
});

// Service Worker Registration for PWA functionality
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(registration => {
                console.log('SW registered: ', registration);
            })
            .catch(registrationError => {
                console.log('SW registration failed: ', registrationError);
            });
    });
}