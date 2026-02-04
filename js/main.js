// main.js - Application Entry Point
import { APP } from './modules/state.js';
import CONFIG from './config.js';
import { initializeMap, updateRouteStyle, toggleDarkMode } from './modules/map.js';
import { toggleDebugMode, setUpdateRouteStyleCallback } from './modules/debug.js';
import * as UI from './modules/ui.js';
import { attachAutocompleteToInput } from './modules/autocomplete.js';
import { reverseGeocodeWithRateLimit } from './geocoding.js';
import { formatDistance, formatDuration } from './utils.js';
import { initialize as initElevation, getElevations } from './elevation.js';
import { fetchAndRenderElevation } from './modules/elevation_renderer.js';

// ==================== INITIALIZATION ====================

document.addEventListener('DOMContentLoaded', () => {
    // Initialize Map
    initializeMap();

    // Initialize UI Callbacks
    UI.setUICallbacks(debouncedCalculateRoute, throttledPreviewRouteCalculation);

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

    const exportBtn = document.getElementById('exportGpxHeaderBtn');
    if (exportBtn) exportBtn.addEventListener('click', () => exportGPX());

    // Map Event Listeners
    APP.map.on('click', (e) => {
        if (!APP.routePolylineMouseDown && !APP.isDraggingMarker) {
            UI.handleMapClick(e.latlng); // Need to implement/export handleMapClick in UI
        }
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

    reverseGeocodeWithRateLimit(latlng.lat, latlng.lng).then((address) => {
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
            reverseGeocodeWithRateLimit(point.lat, point.lng).then((address) => {
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
                reverseGeocodeWithRateLimit(point.lat, point.lng).then(address => {
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