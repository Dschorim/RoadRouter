// main.js - Application Entry Point
import { APP } from './modules/state.js';
import CONFIG from './config.js';
import { initializeMap, updateRouteStyle, toggleDarkMode } from './modules/map.js';
import { toggleDebugMode, setUpdateRouteStyleCallback } from './modules/debug.js';
import * as UI from './modules/ui.js';
import { attachAutocompleteToInput } from './modules/autocomplete.js';
import { reverseGeocode } from './geocoding.js';
import { formatDistance, formatDuration } from './utils.js';
import { initialize as initElevation, getElevations } from './elevation.js';
import { fetchAndRenderElevation } from './modules/elevation_renderer.js';
import { AUTH } from './modules/auth.js';
import { UI_MODAL } from './modules/ui_modals.js';

// ==================== INITIALIZATION ====================

document.addEventListener('DOMContentLoaded', () => {
    // Initialize Map
    initializeMap();

    // Initialize UI Callbacks
    UI.setUICallbacks(debouncedCalculateRoute, throttledPreviewRouteCalculation);

    // Initialize Auth
    AUTH.init();
    setupAuthUI();

    // Attach Global Functions for HTML Buttons
    window.addNewWaypoint = UI.addNewWaypoint;
    window.removePoint = UI.removePoint;
    window.addPointAsStart = UI.addPointAsStart;
    window.toggleDebugMode = toggleDebugMode;
    window.generateGPX = generateGPX;
    window.importGPX = importGPX;
    window.exportGPX = exportGPX;

    // Setup Debug Callback
    setUpdateRouteStyleCallback(updateRouteStyle);

    // Initial Route State (1 start, 1 dest)
    APP.routePoints = [
        { id: APP.nextPointId++, lat: null, lng: null, address: '', type: 'start' },
        { id: APP.nextPointId++, lat: null, lng: null, address: '', type: 'dest' }
    ];

    UI.updatePointTypes();
    UI.renderRoutePoints();

    // Initial UI Elements Setup
    const initialInput = document.getElementById('initialSearchInput');
    if (initialInput) {
        UI.attachAutocompleteToInput(initialInput, 'initial', {
            onSelect: ({ display, lat, lon }) => {
                if (APP.routePoints.length > 0) {
                    APP.routePoints[0].lat = lat;
                    APP.routePoints[0].lng = lon;
                    APP.routePoints[0].address = display;
                }

                initialInput.value = display;
                UI.renderRoutePoints();
                UI.updateMapMarkers();
                UI.showRouteContent();

                if (APP.map) {
                    APP.map.setView([lat, lon], 14, { animate: true });
                }
            }
        });
    }

    // Initial UI Elements Setup
    const debugBtn = document.getElementById('debugToggleBtn');
    if (debugBtn && CONFIG.ENABLE_DEBUG_MODE) {
        debugBtn.addEventListener('click', toggleDebugMode);
    }

    const darkModeBtn = document.getElementById('darkModeToggleBtn');
    if (darkModeBtn) {
        darkModeBtn.addEventListener('click', toggleDarkMode);
    }

    const importBtn = document.getElementById('importGpxHeaderBtn');
    if (importBtn) importBtn.addEventListener('click', importGPX);

    const profileBtn = document.getElementById('profileBtn');
    if (profileBtn) {
        profileBtn.addEventListener('click', () => {
            if (!AUTH.isAuthenticated()) {
                authModal?.classList.add('active');
                return;
            }
            const modal = document.getElementById('userProfileModal');
            if (modal) {
                modal.classList.add('active');
                renderSavedRoutes();
            }
        });
    }

    const exportBtn = document.getElementById('exportGpxHeaderBtn');
    if (exportBtn) exportBtn.addEventListener('click', () => exportGPX());

    const newRouteBtn = document.getElementById('newRouteBtn');
    if (newRouteBtn) newRouteBtn.addEventListener('click', startNewRoute);

    // Map Event Listeners
    APP.map.on('click', (e) => {
        if (!APP.routePolylineMouseDown && !APP.isDraggingMarker) {
            UI.handleMapClick(e.latlng);
        }
    });

    APP.map.on('contextmenu', (e) => {
        UI.handleMapRightClick(e);
    });
});


// ==================== ROUTE CALCULATION ====================

function debouncedCalculateRoute() {
    clearTimeout(APP.calculateRouteTimer);
    APP.calculateRouteTimer = setTimeout(calculateRoute, 500);
}

debouncedCalculateRoute.cancel = function () {
    clearTimeout(APP.calculateRouteTimer);
};

function throttledPreviewRouteCalculation() {
    const now = Date.now();
    if (now - APP.lastPreviewTime >= 500) {
        APP.lastPreviewTime = now;
        calculateRoute();
    }
}

async function calculateRoute() {
    const validPoints = APP.routePoints.filter(p => p.lat !== null && p.lng !== null);

    if (validPoints.length < 2) {
        APP.routeLayer.clearLayers();
        APP.currentPolyline = null;
        return;
    }

    try {
        const coordString = validPoints.map(c => `${c.lng},${c.lat}`).join(';');
        const url = `${CONFIG.OSRMAPI}/route/v1/${APP.selectedProfile}/${coordString}?overview=full&geometries=geojson&steps=true&annotations=distance,duration`;

        const response = await fetch(url);
        if (!response.ok) return;

        const result = await response.json();
        if (result.code !== 'Ok') return;

        APP.currentRoute = result.routes[0];
        // Remove any existing preview marker before clearing old route layers
        removeRoutePreview();
        APP.routeLayer.clearLayers();

        if (APP.routeMouseMoveHandler) APP.map.off('mousemove', APP.routeMouseMoveHandler);
        if (APP.routeMouseUpHandler) APP.map.off('mouseup', APP.routeMouseUpHandler);

        const routePolyline = L.geoJSON(APP.currentRoute.geometry, {
            style: {
                color: '#32b8c6',
                weight: 5,
                opacity: 0.85,
                lineCap: 'round',
                lineJoin: 'round',
                dashArray: 'none'
            },
            interactive: true
        }).addTo(APP.routeLayer);

        updateRouteStyle();
        APP.currentPolyline = routePolyline;

        // Route Interaction
        routePolyline.on('mousemove', (e) => {
            if (APP.routePolylineMouseDown) return;
            const closest = findClosestPointOnPolyline(e.latlng);
            if (closest) {
                createOrUpdateRoutePreview(closest);
                if (APP.map && APP.map._container) APP.map._container.style.cursor = 'pointer';
            }
        });

        routePolyline.on('mouseout', () => {
            removeRoutePreview();
            if (APP.map && APP.map._container) APP.map._container.style.cursor = '';
        });

        routePolyline.on('mousedown', handleRoutePolylineMouseDown);

        APP.map.on('mousemove', APP.routeMouseMoveHandler || routeMouseMoveHandler);
        APP.map.on('mouseup', APP.routeMouseUpHandler || routeMouseUpHandler);

        // Update Stats
        const distance = APP.currentRoute.distance;
        const duration = APP.currentRoute.duration;
        const distEl = document.getElementById('elev-distance-val');
        const durEl = document.getElementById('elev-duration-val');
        if (distEl) distEl.textContent = formatDistance(distance);
        if (durEl) durEl.textContent = formatDuration(duration);

        // Show Elevation Card (Simplified)
        const elevCard = document.getElementById('elevationCard');
        if (elevCard) elevCard.style.display = 'block';

        // Fetch and Render Elevation
        fetchAndRenderElevation();

        // Update Save button visibility
        updateSaveButton();

    } catch (error) {
        console.error('Route calculation failed:', error);
    }
}


// ==================== INTERACTION HELPERS ====================

function handleRoutePolylineMouseDown(e) {
    if (e.originalEvent.button !== 0) return;
    removeRoutePreview();

    APP.routeClickJustHappened = true;
    setTimeout(() => { APP.routeClickJustHappened = false; }, 150);

    const alt = findClosestPointOnPolyline(e.latlng);
    if (!alt) return;

    const latlng = L.latLng(alt.lat, alt.lng);
    const clickPoint = { lat: latlng.lat, lng: latlng.lng };

    // Find insertion index
    const validIndices = [];
    APP.routePoints.forEach((p, idx) => {
        if (p.lat !== null && p.lng !== null) {
            validIndices.push(idx);
        }
    });

    let closestSegmentIdx = 0;
    let closestSegmentDist = Infinity;

    for (let i = 0; i < validIndices.length - 1; i++) {
        const startPt = APP.routePoints[validIndices[i]];
        const endPt = APP.routePoints[validIndices[i + 1]];
        const dist = distanceToLineSegment(clickPoint, startPt, endPt);
        if (dist < closestSegmentDist) {
            closestSegmentDist = dist;
            closestSegmentIdx = i;
        }
    }

    const insertIndex = validIndices[closestSegmentIdx] + 1;

    const newPoint = {
        id: APP.nextPointId++,
        lat: parseFloat(latlng.lat.toFixed(4)),
        lng: parseFloat(latlng.lng.toFixed(4)),
        address: 'Locating...',
        type: 'waypoint'
    };

    APP.routePoints.splice(insertIndex, 0, newPoint);
    UI.updatePointTypes();
    UI.renderRoutePoints();
    UI.updateMapMarkers();
    debouncedCalculateRoute();

    APP.waypointBeingDragged = newPoint.id;
    APP.routePolylineMouseDown = true;
    APP.isPolylineMouseDown = true;
    APP.map.dragging.disable();
    APP.map._container.classList.add('dragging-disabled');

    e.originalEvent.stopPropagation();

    reverseGeocode(latlng.lat, latlng.lng).then((address) => {
        newPoint.address = address;
        UI.renderRoutePoints();
    });
}

function routeMouseMoveHandler(e) {
    if (!APP.routePolylineMouseDown) return;

    if (APP.waypointBeingDragged !== null) {
        const point = APP.routePoints.find(p => p.id === APP.waypointBeingDragged);
        if (point && APP.mapMarkers[point.id] && e.latlng) {
            const latlng = e.latlng;
            point.lat = parseFloat(latlng.lat.toFixed(4));
            point.lng = parseFloat(latlng.lng.toFixed(4));

            APP.mapMarkers[point.id].setLatLng([point.lat, point.lng]);
            throttledPreviewRouteCalculation();
            APP.map._container.classList.add('dragging-route');
        }
    }
}

function routeMouseUpHandler(e) {
    if (!APP.routePolylineMouseDown) return;

    APP.routePolylineMouseDown = false;
    APP.isPolylineMouseDown = false;
    APP.map._container.classList.remove('dragging-route');
    APP.map._container.classList.remove('dragging-disabled');
    APP.map.dragging.enable();

    if (APP.waypointBeingDragged !== null) {
        const point = APP.routePoints.find(p => p.id === APP.waypointBeingDragged);
        if (point) {
            reverseGeocode(point.lat, point.lng).then((address) => {
                point.address = address;
                UI.updatePointAddress(APP.waypointBeingDragged, address, point.lat, point.lng);
                UI.renderRoutePoints();
                calculateRoute();
            });
        }
        APP.waypointBeingDragged = null;
    }
}

// ==================== UTILS ====================

function smoothElevationData(elevArray) {
    if (elevArray.length < 3) return elevArray;

    // Apply three-pass smoothing with doubled window sizes
    // First pass: window size 30
    let smoothed = [];
    let windowSize = 30;

    for (let i = 0; i < elevArray.length; i++) {
        let sum = 0, count = 0;
        const start = Math.max(0, i - Math.floor(windowSize / 2));
        const end = Math.min(elevArray.length - 1, i + Math.floor(windowSize / 2));

        for (let j = start; j <= end; j++) {
            sum += elevArray[j].elev;
            count++;
        }

        smoothed.push({ ...elevArray[i], elev: sum / count });
    }

    // Second pass: window size 22
    const secondSmoothed = [];
    windowSize = 22;

    for (let i = 0; i < smoothed.length; i++) {
        let sum = 0, count = 0;
        const start = Math.max(0, i - Math.floor(windowSize / 2));
        const end = Math.min(smoothed.length - 1, i + Math.floor(windowSize / 2));

        for (let j = start; j <= end; j++) {
            sum += smoothed[j].elev;
            count++;
        }

        secondSmoothed.push({ ...elevArray[i], elev: sum / count });
    }

    // Third pass: window size 14
    const finalSmoothed = [];
    windowSize = 14;

    for (let i = 0; i < secondSmoothed.length; i++) {
        let sum = 0, count = 0;
        const start = Math.max(0, i - Math.floor(windowSize / 2));
        const end = Math.min(secondSmoothed.length - 1, i + Math.floor(windowSize / 2));

        for (let j = start; j <= end; j++) {
            sum += secondSmoothed[j].elev;
            count++;
        }

        finalSmoothed.push({ ...elevArray[i], elev: sum / count });
    }

    return finalSmoothed;
}

function distanceToLineSegment(point, lineStart, lineEnd) {
    const dx = lineEnd.lng - lineStart.lng;
    const dy = lineEnd.lat - lineStart.lat;
    if (dx === 0 && dy === 0) return 0;

    let t = ((point.lng - lineStart.lng) * dx + (point.lat - lineStart.lat) * dy) / (dx * dx + dy * dy);
    t = Math.max(0, Math.min(1, t));

    const closestX = lineStart.lng + t * dx;
    const closestY = lineStart.lat + t * dy;

    const ddx = point.lng - closestX;
    const ddy = point.lat - closestY;

    return Math.sqrt(ddx * ddx + ddy * ddy);
}

function findClosestPointOnPolyline(latlng) {
    if (!APP.currentPolyline || !APP.map) return null;
    const clickPoint = { lat: latlng.lat, lng: latlng.lng };
    const clickPixel = APP.map.latLngToLayerPoint([latlng.lat, latlng.lng]);

    let minPixelDist = Infinity;
    let closest = null;

    const geoJSONLayers = APP.currentPolyline._layers || {};
    let routeWeight = 5;
    for (let lid in geoJSONLayers) {
        const layer = geoJSONLayers[lid];
        if (layer && layer.options && layer.options.weight) {
            routeWeight = layer.options.weight;
            break;
        }
    }

    const thresholdPx = routeWeight * 3;

    for (let layerId in geoJSONLayers) {
        const layer = geoJSONLayers[layerId];
        if (layer.getLatLngs && typeof layer.getLatLngs === 'function') {
            const latlngs = layer.getLatLngs();
            if (!latlngs || latlngs.length === 0) continue;

            for (let i = 0; i < latlngs.length - 1; i++) {
                const a = latlngs[i];
                const b = latlngs[i + 1];
                const dx = b.lng - a.lng;
                const dy = b.lat - a.lat;
                const denom = (dx * dx + dy * dy);
                if (denom === 0) continue;

                const t = ((clickPoint.lng - a.lng) * dx + (clickPoint.lat - a.lat) * dy) / denom;
                const tt = Math.max(0, Math.min(1, t));
                const cx = a.lng + tt * dx;
                const cy = a.lat + tt * dy;

                const candidatePixel = APP.map.latLngToLayerPoint([cy, cx]);
                const pdx = clickPixel.x - candidatePixel.x;
                const pdy = clickPixel.y - candidatePixel.y;
                const pixelDist = Math.sqrt(pdx * pdx + pdy * pdy);

                if (pixelDist < minPixelDist) {
                    minPixelDist = pixelDist;
                    closest = { lat: cy, lng: cx, dist: pixelDist, pixelDist };
                }
            }
        }
    }

    if (closest && minPixelDist <= thresholdPx) {
        return closest;
    }

    return null;
}

function createOrUpdateRoutePreview(point) {
    if (!point || !APP.markerLayer) return;

    const html = `<div class="map-pin-preview"><div class="map-pin-preview-inner"></div></div>`;

    if (!APP.previewMarker) {
        const icon = L.divIcon({
            html,
            className: 'leaflet-div-icon',
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        });
        APP.previewMarker = L.marker([point.lat, point.lng], { icon, interactive: false, bubblingMouseEvents: false }).addTo(APP.markerLayer);

        const el = APP.previewMarker.getElement();
        if (el) {
            const inner = el.querySelector('.map-pin-preview');
            if (inner) setTimeout(() => inner.classList.add('visible'), 20);
        }
    } else {
        APP.previewMarker.setLatLng([point.lat, point.lng]);
        const el = APP.previewMarker.getElement();
        if (el) {
            const inner = el.querySelector('.map-pin-preview');
            if (inner && !inner.classList.contains('visible')) {
                setTimeout(() => inner.classList.add('visible'), 20);
            }
        }
    }
}

function removeRoutePreview() {
    if (APP.previewMarker && APP.markerLayer) {
        const el = APP.previewMarker.getElement && APP.previewMarker.getElement();
        const inner = el && el.querySelector('.map-pin-preview');
        if (inner && inner.classList.contains('visible')) {
            inner.classList.remove('visible');
            setTimeout(() => {
                try { APP.markerLayer.removeLayer(APP.previewMarker); } catch (e) { }
                APP.previewMarker = null;
            }, 120);
        } else {
            try { APP.markerLayer.removeLayer(APP.previewMarker); } catch (e) { }
            APP.previewMarker = null;
        }
    }
}

// ==================== GPX (Simplified Placeholders) ====================

function generateGPX(name = 'Route') {
    const date = new Date().toISOString();
    const routeName = APP.activeRouteName || name;
    const duration = APP.currentRoute?.duration || 0;
    
    let coords = [];
    let elevations = [];
    
    // Use elevation data if available and apply smoothing
    if (APP.elevationData && APP.elevationData.length > 0) {
        const smoothedData = smoothElevationData(APP.elevationData);
        coords = smoothedData.map(p => [p.lng, p.lat]);
        elevations = smoothedData.map(p => Math.round(p.elev));
    } else if (APP.currentRoute && APP.currentRoute.geometry && Array.isArray(APP.currentRoute.geometry.coordinates)) {
        coords = APP.currentRoute.geometry.coordinates;
    } else {
        coords = APP.routePoints.filter(p => p.lat !== null && p.lng !== null).map(p => [p.lng, p.lat]);
    }
    
    const trkpts = coords.map(([lon, lat], i) => {
        const ele = elevations[i] !== undefined ? `\n          <ele>${elevations[i]}</ele>` : '';
        return `        <trkpt lat="${lat}" lon="${lon}">${ele}\n        </trkpt>`;
    }).join('\n');
    
    const durationExt = duration > 0 ? `\n    <extensions>\n      <duration>${Math.round(duration)}</duration>\n    </extensions>` : '';
    
    return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Route Planner" xmlns="http://www.topografix.com/GPX/1/1">\n  <metadata>\n    <name>${routeName}</name>\n    <time>${date}</time>\n  </metadata>\n  <trk>\n    <name>${routeName}</name>${durationExt}\n    <trkseg>\n${trkpts}\n    </trkseg>\n  </trk>\n</gpx>`;
}

function exportGPX(filename = 'route.gpx') {
    const gpx = generateGPX('Route');
    const blob = new Blob([gpx], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
}

function importGPX() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.gpx';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (file) parseGPXFile(file);
    };
    input.click();
}

function parseGPXFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const parser = new DOMParser();
            const gpx = parser.parseFromString(e.target.result, 'text/xml');
            const trkpts = gpx.querySelectorAll('trkpt');
            if (trkpts.length === 0) return;

            APP.routePoints = [];
            APP.nextPointId = 1;

            // Start
            APP.routePoints.push({
                id: APP.nextPointId++,
                lat: parseFloat(trkpts[0].getAttribute('lat')),
                lng: parseFloat(trkpts[0].getAttribute('lon')),
                address: 'Locating...',
                type: 'start'
            });

            // Mid
            const step = Math.max(1, Math.floor(trkpts.length / 10));
            for (let i = step; i < trkpts.length - step; i += step) {
                APP.routePoints.push({
                    id: APP.nextPointId++,
                    lat: parseFloat(trkpts[i].getAttribute('lat')),
                    lng: parseFloat(trkpts[i].getAttribute('lon')),
                    address: 'Locating...',
                    type: 'waypoint'
                });
            }

            // End
            const last = trkpts[trkpts.length - 1];
            APP.routePoints.push({
                id: APP.nextPointId++,
                lat: parseFloat(last.getAttribute('lat')),
                lng: parseFloat(last.getAttribute('lon')),
                address: 'Locating...',
                type: 'dest'
            });

            UI.updatePointTypes();
            UI.renderRoutePoints();
            UI.updateMapMarkers();
            calculateRoute();

            // Reverse Geocode
            APP.routePoints.forEach(point => {
                reverseGeocode(point.lat, point.lng).then(address => {
                    point.address = address;
                    const input = document.getElementById(`input-${point.id}`);
                    if (input) input.value = address;
                    UI.renderRoutePoints();
                });
            });

        } catch (error) {
            console.error(error);
        }
    };
    reader.readAsText(file);
}

// ==================== AUTH & PROFILE UI ====================

function setupAuthUI() {
    const authModal = document.getElementById('authModal');
    const profileBtn = document.getElementById('profileBtn');
    const closeAuthBtn = authModal?.querySelector('.close-modal');
    const authForm = document.getElementById('authForm');
    const authToggleLink = document.getElementById('authToggleLink');
    const saveRouteBtn = document.getElementById('saveRouteBtn');
    const userProfileModal = document.getElementById('userProfileModal');
    const closeProfileBtn = userProfileModal?.querySelector('.close-modal');
    const logoutBtn = document.getElementById('logoutBtn');

    let isSignupMode = false;

    // Toggle Profile / Login
    profileBtn?.addEventListener('click', () => {
        if (!AUTH.isAuthenticated()) {
            authModal?.classList.add('active');
            return;
        }
        userProfileModal?.classList.add('active');
        
        // Only reset to account tab on first login
        if (!APP.lastActiveTab) {
            const tabBtns = document.querySelectorAll('.tab-btn');
            tabBtns.forEach(b => b.classList.remove('active'));
            document.querySelector('.tab-btn[data-tab="account"]')?.classList.add('active');
            
            const panes = document.querySelectorAll('.tab-pane');
            panes.forEach(p => p.classList.remove('active'));
            document.getElementById('tab-account')?.classList.add('active');
        }
        
        renderSavedRoutes();
    });

    closeProfileBtn?.addEventListener('click', () => userProfileModal?.classList.remove('active'));

    closeAuthBtn?.addEventListener('click', () => authModal?.classList.remove('active'));

    authToggleLink?.addEventListener('click', (e) => {
        e.preventDefault();
        isSignupMode = !isSignupMode;
        document.getElementById('authModalTitle').textContent = isSignupMode ? 'Sign Up' : 'Sign In';
        document.getElementById('authSubmitBtn').textContent = isSignupMode ? 'Register' : 'Login';
        document.getElementById('authToggleText').textContent = isSignupMode ? 'Already have an account?' : "Don't have an account?";
        authToggleLink.textContent = isSignupMode ? 'Sign In' : 'Sign Up';

        const confirmGroup = document.getElementById('confirmPasswordGroup');
        if (confirmGroup) {
            confirmGroup.style.display = isSignupMode ? 'block' : 'none';
            const confirmInput = confirmGroup.querySelector('input');
            if (confirmInput) confirmInput.required = isSignupMode;
        }
    });

    authForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('authUsername').value;
        const password = document.getElementById('authPassword').value;
        const errorEl = document.getElementById('authError');
        const mfaGroup = document.getElementById('mfaGroup');
        const mfaCode = document.getElementById('authMfaCode')?.value;
        const usernameGroup = document.getElementById('authUsername').parentElement;
        const passwordGroup = document.getElementById('authPassword').parentElement;

        if (errorEl) errorEl.style.display = 'none';

        try {
            if (isSignupMode) {
                const confirmPassword = document.getElementById('authConfirmPassword').value;
                if (password !== confirmPassword) {
                    throw new Error('Passwords do not match');
                }
                await AUTH.signup(username, password, confirmPassword);
                APP.lastActiveTab = null;
            } else {
                const res = await AUTH.login(username, password, mfaCode || null);
                if (res.mfa_required) {
                    if (mfaGroup) mfaGroup.style.display = 'block';
                    if (usernameGroup) usernameGroup.style.display = 'none';
                    if (passwordGroup) passwordGroup.style.display = 'none';
                    const mfaInput = document.getElementById('authMfaCode');
                    if (mfaInput) {
                        mfaInput.required = true;
                        mfaInput.focus();
                    }
                    if (errorEl) {
                        errorEl.textContent = 'Enter your MFA code';
                        errorEl.style.color = 'var(--color-primary)';
                        errorEl.style.display = 'block';
                    }
                    return;
                }
                APP.lastActiveTab = null;
            }
            authModal?.classList.remove('active');
            authForm?.reset();
            if (mfaGroup) mfaGroup.style.display = 'none';
            if (usernameGroup) usernameGroup.style.display = 'block';
            if (passwordGroup) passwordGroup.style.display = 'block';
            const mfaInput = document.getElementById('authMfaCode');
            if (mfaInput) mfaInput.required = false;
        } catch (err) {
            if (errorEl) {
                errorEl.textContent = err.message;
                errorEl.style.color = 'var(--color-error)';
                errorEl.style.display = 'block';
            }
        }
    });

    // Security Tab Listeners
    const changePassBtn = document.getElementById('changePassBtn');
    if (changePassBtn) {
        changePassBtn.addEventListener('click', async () => {
            const oldPass = document.getElementById('oldPassword').value;
            const newPass = document.getElementById('newPassword').value;
            const confirmPass = document.getElementById('confirmNewPassword').value;

            if (!oldPass || !newPass || !confirmPass) {
                UI_MODAL.alert("Error", "Please fill in all password fields.");
                return;
            }

            if (newPass !== confirmPass) {
                UI_MODAL.alert("Error", "New passwords do not match.");
                return;
            }

            try {
                await AUTH.changePassword(oldPass, newPass, confirmPass);
                UI_MODAL.alert("Success", "Password changed successfully!");
                document.getElementById('oldPassword').value = '';
                document.getElementById('newPassword').value = '';
                document.getElementById('confirmNewPassword').value = '';
            } catch (err) {
                UI_MODAL.alert("Error", err.message);
            }
        });
    }

    const setupMfaBtn = document.getElementById('setupMfaBtn');
    if (setupMfaBtn) {
        setupMfaBtn.addEventListener('click', async () => {
            try {
                const res = await AUTH.setupMFA();
                const qrContainer = document.getElementById('mfaQrCode');
                if (qrContainer) {
                    qrContainer.innerHTML = `<img src="${res.qr_code_url}" alt="MFA QR Code" style="width:100%; border-radius: 8px;">`;
                }
                const setupContent = document.getElementById('mfaSetupContent');
                if (setupContent) setupContent.style.display = 'block';
                setupMfaBtn.style.display = 'none';
            } catch (err) {
                UI_MODAL.alert("Error", "Failed to setup MFA: " + err.message);
            }
        });
    }

    const verifyMfaBtn = document.getElementById('verifyMfaBtn');
    if (verifyMfaBtn) {
        verifyMfaBtn.addEventListener('click', async () => {
            const code = document.getElementById('mfaCodeVerify').value;
            if (!code) return;
            try {
                await AUTH.verifyMFA(code);
                const mfaStatus = document.getElementById('mfaStatus');
                if (mfaStatus) {
                    mfaStatus.innerHTML = '<div class="mfa-enabled-info" style="color: var(--color-primary); font-weight: 600; text-align: center; padding: 20px;">MFA is active on your account.</div>';
                }
                const setupContent = document.getElementById('mfaSetupContent');
                if (setupContent) setupContent.style.display = 'none';
            } catch (err) {
                UI_MODAL.alert("Error", err.message);
            }
        });
    }

    logoutBtn?.addEventListener('click', () => {
        AUTH.logout();
        userProfileModal?.classList.remove('active');
        renderSavedRoutes();
    });

    newRouteBtn?.addEventListener('click', startNewRoute);

    saveRouteBtn?.addEventListener('click', async () => {
        if (!APP.currentRoute) return;

        // Collect metadata
        const metadata = {
            distance: document.getElementById('elev-distance-val')?.textContent || '0 km',
            duration: document.getElementById('elev-duration-val')?.textContent || '0m',
            gain: document.getElementById('elev-gain-val')?.textContent || '0 m',
            loss: document.getElementById('elev-loss-val')?.textContent || '0 m'
        };

        if (APP.activeRouteId) {
            const mode = await UI_MODAL.confirm(
                "Update Route",
                `Update existing route "${APP.activeRouteName}"? \n\n(Choose 'No' to save as a new route instead)`,
                "Update",
                "Save as New"
            );

            if (mode === true) {
                // Update existing
                try {
                    // Add elevation data to route geometry before updating
                    const routeToSave = JSON.parse(JSON.stringify(APP.currentRoute));
                    
                    // Use the densely sampled elevation data from APP.elevationData
                    if (APP.elevationData && APP.elevationData.length > 0) {
                        // Apply smoothing before saving (same as used for gain/loss calculation)
                        const smoothedData = smoothElevationData(APP.elevationData);
                        
                        // Replace the route geometry with densely sampled points that have elevation
                        const newCoordinates = smoothedData.map(point => {
                            return [point.lng, point.lat, Math.round(point.elev)];
                        });
                        routeToSave.geometry.coordinates = newCoordinates;
                        console.log(`Updating route with ${newCoordinates.length} smoothed elevation points (was ${APP.currentRoute.geometry.coordinates.length})`);
                    }
                    
                    await AUTH.updateExistingRoute(APP.activeRouteId, APP.activeRouteName, {
                        points: APP.routePoints,
                        route: routeToSave,
                        metadata
                    });
                    renderSavedRoutes();
                } catch (err) {
                    await UI_MODAL.alert("Error", "Failed to update route: " + err.message);
                }
                return;
            } else if (mode === null) {
                // Cancelled or dismissed
                return;
            }
            // If mode is false, it falls through to "Save as new prompt"
        }

        // Save as new prompt
        const name = await UI_MODAL.prompt("Save Route", "Enter a name for this route:", "My Awesome Route");
        if (!name) return;

        // Silent sanitization: letters, numbers, spaces only
        const sanitizedName = name.replace(/[^a-zA-Z0-9 ]/g, '').trim();
        if (!sanitizedName) return; // ignore completely empty after sanitization

        try {
            // Add elevation data to route geometry before saving
            const routeToSave = JSON.parse(JSON.stringify(APP.currentRoute));
            
            // Use the densely sampled elevation data from APP.elevationData
            if (APP.elevationData && APP.elevationData.length > 0) {
                // Apply smoothing before saving (same as used for gain/loss calculation)
                const smoothedData = smoothElevationData(APP.elevationData);
                
                // Replace the route geometry with densely sampled points that have elevation
                const newCoordinates = smoothedData.map(point => {
                    return [point.lng, point.lat, Math.round(point.elev)];
                });
                routeToSave.geometry.coordinates = newCoordinates;
                console.log(`Saving route with ${newCoordinates.length} smoothed elevation points (was ${APP.currentRoute.geometry.coordinates.length})`);
            }
            
            const res = await AUTH.saveRoute(sanitizedName, {
                points: APP.routePoints,
                route: routeToSave,
                metadata
            });
            APP.activeRouteId = res.id;
            APP.activeRouteName = name;
            renderSavedRoutes();
            updateUIForAuth(AUTH.user); // update display
            updateRoutePointsLabel();
        } catch (err) {
            await UI_MODAL.alert("Error", "Failed to save route: " + err.message);
        }
    });



    // Close modals on click outside
    document.addEventListener('click', (e) => {
        if (authModal && e.target === authModal) {
            authModal.classList.remove('active');
        }
        if (userProfileModal && e.target === userProfileModal) {
            userProfileModal.classList.remove('active');
        }
    });

    AUTH.subscribe(updateUIForAuth);

    // Profile Tab Switching
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.getAttribute('data-tab');
            
            APP.lastActiveTab = tabId;

            // Update buttons
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Update panes
            const panes = document.querySelectorAll('.tab-pane');
            panes.forEach(p => p.classList.remove('active'));
            document.getElementById(`tab-${tabId}`).classList.add('active');

            // Refresh routes when switching to routes tab
            if (tabId === 'routes') {
                renderSavedRoutes();
            }
            
            // Load users when switching to admin tab
            if (tabId === 'admin') {
                loadAdminUsers();
            }
            
            // Update MFA status when switching to security tab
            if (tabId === 'security') {
                updateMfaStatus();
            }
        });
    });

    // Avatar Edit Listener
    const editAvatarBtn = document.getElementById('editAvatarBtn');
    const avatarInput = document.getElementById('avatarInput');

    if (editAvatarBtn && avatarInput) {
        editAvatarBtn.addEventListener('click', () => {
            avatarInput.click();
        });

        avatarInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            if (file.size > 1024 * 1024) {
                UI_MODAL.alert("Error", "Image is too large. Please select a file smaller than 1MB.");
                return;
            }

            const reader = new FileReader();
            reader.onload = async (event) => {
                const img = new Image();
                img.onload = async () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = 256;
                    canvas.height = 256;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, 256, 256);
                    const base64Data = canvas.toDataURL('image/jpeg', 0.8);
                    
                    try {
                        await AUTH.updateProfile({ avatar_data: base64Data });
                        updateUIForAuth(AUTH.user);
                    } catch (err) {
                        UI_MODAL.alert("Error", "Failed to upload avatar: " + err.message);
                    }
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    // Initial UI state
    updateUIForAuth(AUTH.user);

    // Device Credentials Handlers
    setupDeviceCredentialsUI();
}

function updateUIForAuth(user) {
    const saveRouteBtn = document.getElementById('saveRouteBtn');
    const savedRoutesSection = document.getElementById('savedRoutesSection');
    const headerUsername = document.getElementById('headerUsername');
    const profileUsername = document.getElementById('profileUsername');
    const headerRole = document.getElementById('headerRole');
    const profileRole = document.getElementById('profileRole');
    const headerAvatar = document.getElementById('headerAvatar');
    const headerAvatarLarge = document.getElementById('headerAvatarLarge');
    const adminTabBtn = document.getElementById('adminTabBtn');

    if (user) {
        if (saveRouteBtn) {
            saveRouteBtn.style.display = APP.currentRoute ? 'flex' : 'none';
            saveRouteBtn.title = APP.activeRouteId ? `Update "${APP.activeRouteName}"` : 'Save to Profile';
        }
        if (document.getElementById('newRouteBtn')) {
            const hasPoints = APP.routePoints.length > 0 &&
                (APP.routePoints.some(p => p.lat !== null) || APP.activeRouteId);
            document.getElementById('newRouteBtn').style.display = hasPoints ? 'flex' : 'none';
        }
        if (savedRoutesSection) savedRoutesSection.style.display = 'block';

        const usernameDisplay = user.username;
        const roleDisplay = user.role || 'User';
        const avatarChar = usernameDisplay.charAt(0).toUpperCase();

        if (headerUsername) headerUsername.textContent = usernameDisplay;
        if (profileUsername) profileUsername.textContent = usernameDisplay;
        if (headerRole) headerRole.textContent = roleDisplay;
        if (profileRole) profileRole.textContent = roleDisplay;
        
        // Show admin tab if user is admin
        if (adminTabBtn) {
            adminTabBtn.style.display = user.role === 'ADMIN' ? 'flex' : 'none';
        }
        
        if (user.avatar_data) {
            if (headerAvatar) {
                headerAvatar.innerHTML = `<img src="${user.avatar_data}" style="display:block; width:100%; height:100%; object-fit:cover; border-radius:50%;">`;
            }
            if (headerAvatarLarge) {
                headerAvatarLarge.innerHTML = `<img src="${user.avatar_data}" style="display:block; width:100%; height:100%; object-fit:cover; border-radius:50%;">`;
            }
        } else {
            if (headerAvatar) {
                headerAvatar.innerHTML = '';
                headerAvatar.textContent = avatarChar;
            }
            if (headerAvatarLarge) {
                headerAvatarLarge.innerHTML = '';
                headerAvatarLarge.textContent = avatarChar;
            }
        }

        renderSavedRoutes();
    } else {
        if (saveRouteBtn) saveRouteBtn.style.display = 'none';
        if (savedRoutesSection) savedRoutesSection.style.display = 'none';
        if (headerUsername) headerUsername.textContent = 'Guest';
        if (profileUsername) profileUsername.textContent = 'Guest';
        if (headerRole) headerRole.textContent = 'Anonymous';
        if (profileRole) profileRole.textContent = 'Anonymous';
        if (headerAvatar) headerAvatar.textContent = '?';
        if (headerAvatarLarge) headerAvatarLarge.textContent = '?';
        if (adminTabBtn) adminTabBtn.style.display = 'none';
    }
}

async function renderSavedRoutes() {
    const list = document.getElementById('savedRoutesList');
    if (!list || !AUTH.isAuthenticated()) {
        if (list) list.innerHTML = '<div class="empty-state">Sign in to see saved routes</div>';
        return;
    }

    try {
        const routes = await AUTH.getSavedRoutes();
        const hasDeviceCreds = await AUTH.getDeviceCredentials();
        
        if (routes.length === 0) {
            list.innerHTML = '<div class="empty-state">No saved routes yet</div>';
            return;
        }

        list.innerHTML = routes.map(r => {
            const meta = r.data.metadata || {};
            const dist = meta.distance || '0 km';
            const elev = (meta.gain && meta.loss) ? `${meta.gain} / ${meta.loss}` : '--';

            return `
            <div class="saved-route-item ${APP.activeRouteId === r.id ? 'active' : ''}" data-id="${r.id}">
                <div class="saved-route-info">
                    <div class="saved-route-name">${r.name}</div>
                    <div class="saved-route-meta">
                        <span class="meta-tag">${dist}</span>
                        <span class="meta-tag elevation">${elev}</span>
                    </div>
                </div>
                <div class="saved-route-actions">
                    ${hasDeviceCreds ? `<button class="btn-route-action btn-upload" title="Upload to Device" data-id="${r.id}" onclick="event.stopPropagation(); uploadRouteToDevice('${r.id}')">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>
                    </button>` : ''}
                    <button class="btn-route-action btn-rename" title="Rename" data-id="${r.id}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </button>
                    <button class="btn-route-action btn-delete" title="Delete" data-id="${r.id}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                </div>
            </div>
        `;
        }).join('');

        list.querySelectorAll('.saved-route-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.closest('.btn-route-action')) return;

                const routeId = item.dataset.id;
                const route = routes.find(r => r.id === routeId);
                if (route) {
                    loadSavedRoute(route);
                    const userProfileModal = document.getElementById('userProfileModal');
                    if (userProfileModal) userProfileModal.classList.remove('active');
                }
            });
        });

        // Add action button listeners
        list.querySelectorAll('.btn-rename').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                const route = routes.find(r => r.id === id);
                const newName = await UI_MODAL.prompt("Rename Route", "Enter new name:", "My Route", route.name);

                if (newName && newName !== route.name) {
                    // Validation
                    if (!/^[a-zA-Z0-9 ]+$/.test(newName)) {
                        await UI_MODAL.alert("Invalid Name", "Route name can only contain letters, numbers, and spaces.");
                        return;
                    }
                    try {
                        await AUTH.renameRoute(id, newName);
                        if (APP.activeRouteId === id) APP.activeRouteName = newName;
                        renderSavedRoutes();
                        updateRoutePointsLabel(); // update label if it's the active one
                    } catch (err) {
                        await UI_MODAL.alert("Error", "Rename failed: " + err.message);
                    }
                }
            });
        });

        list.querySelectorAll('.btn-delete').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                const route = routes.find(r => r.id === id);
                const confirmed = await UI_MODAL.confirm("Delete Route", `Are you sure you want to delete "${route.name}"?`, "Delete", "Cancel");
                if (confirmed) {
                    try {
                        await AUTH.deleteRoute(id);
                        if (APP.activeRouteId === id) {
                            APP.activeRouteId = null;
                            APP.activeRouteName = null;
                            updateRoutePointsLabel();
                        }
                        renderSavedRoutes();
                    } catch (err) {
                        await UI_MODAL.alert("Error", "Delete failed: " + err.message);
                    }
                }
            });
        });
    } catch (err) {
        list.innerHTML = `<div class="empty-state">Error: ${err.message}</div>`;
    }
}

function loadSavedRoute(route) {
    if (!route || !route.data || !route.data.points) return;

    // Restore state
    APP.activeRouteId = route.id;
    APP.activeRouteName = route.name;
    APP.routePoints = route.data.points;
    APP.nextPointId = (APP.routePoints.length > 0) ? Math.max(...APP.routePoints.map(p => p.id)) + 1 : 1;

    // Update UI
    UI.updatePointTypes();
    UI.renderRoutePoints();
    UI.updateMapMarkers();
    UI.showRouteContent(); // Ensure sidebar switches to Route view
    updateRoutePointsLabel();
    updateUIForAuth(AUTH.user);
    calculateRoute();

    // Zoom to route - Use correct Leaflet fitBounds options
    if (route.data.route && route.data.route.geometry && APP.map) {
        const bounds = L.geoJSON(route.data.route.geometry).getBounds();
        APP.map.fitBounds(bounds, {
            paddingTopLeft: [400, 50], // Avoid sidebar
            paddingBottomRight: [50, 260] // Avoid elevation card
        });
    }
}

function updateRoutePointsLabel() {
    const label = document.querySelector('#routeContent label');
    if (label) {
        label.textContent = APP.activeRouteName ? APP.activeRouteName : 'Route Points';
    }
}

async function startNewRoute() {
    if (APP.routePoints.length > 0) {
        const confirmed = await UI_MODAL.confirm("New Route", "Clear current route and start fresh?", "New Route", "Cancel");
        if (!confirmed) return;
    }

    APP.activeRouteId = null;
    APP.activeRouteName = null;
    APP.routePoints = [
        { id: APP.nextPointId++, lat: null, lng: null, address: '', type: 'start' },
        { id: APP.nextPointId++, lat: null, lng: null, address: '', type: 'dest' }
    ];

    UI.updatePointTypes();
    UI.renderRoutePoints();
    UI.updateMapMarkers();
    if (APP.markerLayer) APP.markerLayer.clearLayers();
    if (APP.routeLayer) APP.routeLayer.clearLayers();
    APP.currentRoute = null;
    APP.elevationData = null;
    document.getElementById('elevationCard').style.display = 'none';

    updateRoutePointsLabel();
    updateUIForAuth(AUTH.user); // updates save/new buttons
}

function updateSaveButton() {
    const saveRouteBtn = document.getElementById('saveRouteBtn');
    if (saveRouteBtn && AUTH.isAuthenticated()) {
        saveRouteBtn.style.display = APP.currentRoute ? 'flex' : 'none';
    }
}

async function loadAdminUsers() {
    const list = document.getElementById('adminUsersList');
    if (!list || !AUTH.isAuthenticated() || AUTH.user?.role !== 'ADMIN') return;

    try {
        const users = await AUTH.adminListUsers();
        
        if (users.length === 0) {
            list.innerHTML = '<div class="empty-state">No users found</div>';
            return;
        }

        const adminCount = users.filter(u => u.role === 'ADMIN').length;

        list.innerHTML = users.map(u => `
            <div class="admin-user-item">
                <div class="admin-user-info">
                    <div class="admin-user-name">${u.username}</div>
                    <div class="admin-user-role">${u.role}</div>
                </div>
                <div class="admin-user-actions">
                    <button class="btn-admin-action" onclick="resetUserPassword('${u.username}')" title="Reset Password">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                        </svg>
                    </button>
                    <button class="btn-admin-action" onclick="resetUserMfa('${u.username}')" id="mfa-btn-${u.username}" title="Reset MFA">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                        </svg>
                    </button>
                    ${u.role !== 'ADMIN' ? `<button class="btn-admin-action" onclick="promoteUser('${u.username}')" title="Make Admin">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                        </svg>
                    </button>` : (adminCount > 1 ? `<button class="btn-admin-action" onclick="demoteUser('${u.username}')" title="Demote to User">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="8" y1="12" x2="16" y2="12"></line>
                        </svg>
                    </button>` : '')}
                    <button class="btn-admin-action delete" onclick="deleteUser('${u.username}')" title="Delete User">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </div>
            </div>
        `).join('');
        
        // Check MFA status for each user
        users.forEach(async u => {
            const hasMfa = await checkUserMfaStatus(u.username);
            const btn = document.getElementById(`mfa-btn-${u.username}`);
            if (btn && !hasMfa) {
                btn.disabled = true;
                btn.style.opacity = '0.5';
                btn.style.cursor = 'not-allowed';
            }
        });
    } catch (err) {
        list.innerHTML = `<div class="empty-state">Error: ${err.message}</div>`;
    }
}

async function checkUserMfaStatus(username) {
    try {
        const users = await AUTH.adminListUsers();
        const user = users.find(u => u.username === username);
        return user?.mfa_enabled || false;
    } catch {
        return false;
    }
}

function updateMfaStatus() {
    const mfaStatus = document.getElementById('mfaStatus');
    if (!mfaStatus || !AUTH.isAuthenticated()) return;
    
    // Check if user has MFA enabled by checking if they can setup (no active MFA)
    AUTH.adminListUsers().then(users => {
        const currentUser = users.find(u => u.username === AUTH.user.username);
        if (currentUser?.mfa_enabled) {
            mfaStatus.innerHTML = '<div class="mfa-enabled-info" style="color: var(--color-primary); font-weight: 600; text-align: center; padding: 20px;">MFA is active on your account.</div>';
        } else {
            mfaStatus.innerHTML = '<button id="setupMfaBtn" class="btn btn-outline" style="width:100%;">Set Up Authenticator</button>';
            const setupMfaBtn = document.getElementById('setupMfaBtn');
            if (setupMfaBtn) {
                setupMfaBtn.addEventListener('click', async () => {
                    try {
                        const res = await AUTH.setupMFA();
                        const qrContainer = document.getElementById('mfaQrCode');
                        if (qrContainer) {
                            qrContainer.innerHTML = `<img src="${res.qr_code_url}" alt="MFA QR Code" style="width:100%; border-radius: 8px;">`;
                        }
                        const setupContent = document.getElementById('mfaSetupContent');
                        if (setupContent) setupContent.style.display = 'block';
                        setupMfaBtn.style.display = 'none';
                    } catch (err) {
                        UI_MODAL.alert("Error", "Failed to setup MFA: " + err.message);
                    }
                });
            }
        }
    }).catch(() => {});
}

window.resetUserPassword = async function(username) {
    const newPassword = await UI_MODAL.prompt('Reset Password', `Enter new password for ${username}:`, 'New password');
    if (!newPassword) return;

    try {
        await AUTH.adminResetPassword(username, newPassword);
        await UI_MODAL.alert('Success', `Password reset for ${username}`);
    } catch (err) {
        await UI_MODAL.alert('Error', err.message);
    }
};

window.resetUserMfa = async function(username) {
    const confirmed = await UI_MODAL.confirm('Reset MFA', `Reset MFA for ${username}?`, 'Reset', 'Cancel');
    if (!confirmed) return;

    try {
        await AUTH.adminResetMfa(username);
        await UI_MODAL.alert('Success', `MFA reset for ${username}`);
        loadAdminUsers();
    } catch (err) {
        await UI_MODAL.alert('Error', err.message);
    }
};

window.deleteUser = async function(username) {
    const confirmed = await UI_MODAL.confirm('Delete User', `Are you sure you want to delete ${username}? This cannot be undone.`, 'Delete', 'Cancel');
    if (!confirmed) return;

    try {
        await AUTH.adminDeleteUser(username);
        await UI_MODAL.alert('Success', `User ${username} deleted`);
        loadAdminUsers();
    } catch (err) {
        await UI_MODAL.alert('Error', err.message);
    }
};

window.promoteUser = async function(username) {
    const confirmed = await UI_MODAL.confirm('Make Admin', `Promote ${username} to admin?`, 'Promote', 'Cancel');
    if (!confirmed) return;

    try {
        await AUTH.adminPromoteUser(username);
        await UI_MODAL.alert('Success', `${username} is now an admin`);
        loadAdminUsers();
    } catch (err) {
        await UI_MODAL.alert('Error', err.message);
    }
};

window.demoteUser = async function(username) {
    const confirmed = await UI_MODAL.confirm('Demote to User', `Demote ${username} to regular user?`, 'Demote', 'Cancel');
    if (!confirmed) return;

    try {
        await AUTH.adminDemoteUser(username);
        await UI_MODAL.alert('Success', `${username} is now a regular user`);
        loadAdminUsers();
    } catch (err) {
        await UI_MODAL.alert('Error', err.message);
    }
};

function setupDeviceCredentialsUI() {
    const testBtn = document.getElementById('testDeviceCredsBtn');
    const saveBtn = document.getElementById('saveDeviceCredsBtn');
    const deleteBtn = document.getElementById('deleteDeviceCredsBtn');
    const emailInput = document.getElementById('oneLapFitEmail');
    const passwordInput = document.getElementById('oneLapFitPassword');

    // Load existing credentials when devices tab is opened
    document.querySelector('.tab-btn[data-tab="devices"]')?.addEventListener('click', loadDeviceCredentials);

    testBtn?.addEventListener('click', async () => {
        const email = emailInput.value;
        const password = passwordInput.value;

        if (!email || !password) {
            await UI_MODAL.alert('Error', 'Please fill in all fields');
            return;
        }

        testBtn.disabled = true;
        testBtn.textContent = 'Testing...';

        try {
            await AUTH.saveDeviceCredentials({
                onelapfit_email: email,
                onelapfit_password: password
            });
            await UI_MODAL.alert('Success', 'Credentials are valid!');
            deleteBtn.style.display = 'block';
        } catch (err) {
            await UI_MODAL.alert('Error', err.message);
        } finally {
            testBtn.disabled = false;
            testBtn.textContent = 'Test Connection';
        }
    });

    saveBtn?.addEventListener('click', async () => {
        const email = emailInput.value;
        const password = passwordInput.value;

        if (!email || !password) {
            await UI_MODAL.alert('Error', 'Please fill in all fields');
            return;
        }

        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';

        try {
            await AUTH.saveDeviceCredentials({
                onelapfit_email: email,
                onelapfit_password: password
            });
            await UI_MODAL.alert('Success', 'Credentials saved successfully!');
            deleteBtn.style.display = 'block';
        } catch (err) {
            await UI_MODAL.alert('Error', err.message);
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save';
        }
    });

    deleteBtn?.addEventListener('click', async () => {
        const confirmed = await UI_MODAL.confirm('Disconnect Device', 'Remove device credentials?', 'Remove', 'Cancel');
        if (!confirmed) return;

        try {
            await AUTH.deleteDeviceCredentials();
            emailInput.value = '';
            passwordInput.value = '';
            deleteBtn.style.display = 'none';
            await UI_MODAL.alert('Success', 'Device disconnected');
        } catch (err) {
            await UI_MODAL.alert('Error', err.message);
        }
    });
}

async function loadDeviceCredentials() {
    const emailInput = document.getElementById('oneLapFitEmail');
    const passwordInput = document.getElementById('oneLapFitPassword');
    const deleteBtn = document.getElementById('deleteDeviceCredsBtn');

    try {
        const creds = await AUTH.getDeviceCredentials();
        if (creds) {
            emailInput.value = creds.onelapfit_email;
            passwordInput.value = creds.onelapfit_password;
            deleteBtn.style.display = 'block';
        } else {
            deleteBtn.style.display = 'none';
        }
    } catch (err) {
        deleteBtn.style.display = 'none';
    }
}

window.uploadRouteToDevice = async function(routeId) {
    event.stopPropagation();
    event.preventDefault();
    
    try {
        const btn = event.target.closest('button');
        btn.disabled = true;
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>';
        
        await AUTH.uploadRouteToDevice(routeId);
        await UI_MODAL.alert('Success', 'Route uploaded to device!');
        
        btn.disabled = false;
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>';
    } catch (err) {
        await UI_MODAL.alert('Error', err.message);
        const btn = event.target.closest('button');
        btn.disabled = false;
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>';
    }
};