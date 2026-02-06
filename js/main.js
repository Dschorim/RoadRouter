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
            const modal = document.getElementById('userProfileModal');
            if (modal) {
                modal.classList.add('active');
                renderSavedRoutes(); // Ensure highlighting is fresh
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
        const url = `${CONFIG.OSRMAPI}/route/v1/driving/${coordString}?overview=full&geometries=geojson&steps=true&annotations=distance,duration`;

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
    let coords = [];
    if (APP.currentRoute && APP.currentRoute.geometry && Array.isArray(APP.currentRoute.geometry.coordinates)) {
        coords = APP.currentRoute.geometry.coordinates;
    } else {
        coords = APP.routePoints.filter(p => p.lat !== null && p.lng !== null).map(p => [p.lng, p.lat]);
    }
    const trkpts = coords.map(([lon, lat]) => `        <trkpt lat="${lat}" lon="${lon}"/>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Route Planner">\n  <metadata><name>${name}</name><time>${date}</time></metadata>\n  <trk><name>${name}</name><trkseg>\n${trkpts}\n    </trkseg></trk>\n</gpx>`;
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
        if (AUTH.isAuthenticated()) {
            userProfileModal?.classList.add('active');
        } else {
            authModal?.classList.add('active');
        }
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
        if (errorEl) errorEl.style.display = 'none';

        try {
            if (isSignupMode) {
                const confirmPassword = document.getElementById('authConfirmPassword').value;
                if (password !== confirmPassword) {
                    throw new Error('Passwords do not match');
                }
                await AUTH.signup(username, password, confirmPassword);
            } else {
                await AUTH.login(username, password);
            }
            authModal?.classList.remove('active');
            authForm?.reset();
        } catch (err) {
            if (errorEl) {
                errorEl.textContent = err.message;
                errorEl.style.display = 'block';
            }
        }
    });

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
                    await AUTH.updateExistingRoute(APP.activeRouteId, APP.activeRouteName, {
                        points: APP.routePoints,
                        route: APP.currentRoute,
                        metadata
                    });
                    renderSavedRoutes();
                    await UI_MODAL.alert("Success", "Route updated successfully!");
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

        // Validation: letters, numbers, spaces only
        if (!/^[a-zA-Z0-9 ]+$/.test(name)) {
            await UI_MODAL.alert("Invalid Name", "Route name can only contain letters, numbers, and spaces.");
            return;
        }

        try {
            const res = await AUTH.saveRoute(name, {
                points: APP.routePoints,
                route: APP.currentRoute,
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
    // Initial UI state
    updateUIForAuth(AUTH.user);
}

function updateUIForAuth(user) {
    const saveRouteBtn = document.getElementById('saveRouteBtn');
    const savedRoutesSection = document.getElementById('savedRoutesSection');
    const headerUsername = document.getElementById('headerUsername');
    const headerRole = document.getElementById('headerRole');
    const headerAvatar = document.getElementById('headerAvatar');

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
        if (headerUsername) headerUsername.textContent = user.username;
        if (headerRole) headerRole.textContent = user.role;
        if (headerAvatar) headerAvatar.textContent = user.username.charAt(0).toUpperCase();
        renderSavedRoutes();
    } else {
        if (saveRouteBtn) saveRouteBtn.style.display = 'none';
        if (savedRoutesSection) savedRoutesSection.style.display = 'none';
        if (headerUsername) headerUsername.textContent = 'Guest';
        if (headerRole) headerRole.textContent = 'Anonymous';
        if (headerAvatar) headerAvatar.textContent = '?';
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
                // Ignore if clicked on an action button
                if (e.target.closest('.btn-route-action')) return;

                const routeId = item.dataset.id;
                const route = routes.find(r => r.id === routeId);
                if (route) {
                    loadSavedRoute(route); // Pass the whole route object now
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