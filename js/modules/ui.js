// ui.js - UI interaction and rendering
import { APP } from './state.js';
import { reverseGeocodeWithRateLimit } from '../geocoding.js';

import { attachAutocompleteToInput } from './autocomplete.js';
export { attachAutocompleteToInput }; // Re-export for main.js if needed or use directly
import { isClickOnRoute } from './utils_local.js';

// Callbacks
let _calculateRoute = () => { };
let _throttledPreview = () => { };

export function setUICallbacks(calcRoute, throttledPreview) {
    _calculateRoute = calcRoute;
    _throttledPreview = throttledPreview;
}

export function showRouteContent() {
    document.getElementById('initialSearch').style.display = 'none';
    document.getElementById('routeContent').style.display = 'block';
}

export function hideRouteContent() {
    document.getElementById('initialSearch').style.display = 'block';
    document.getElementById('routeContent').style.display = 'none';
}

export function updatePointTypes() {
    if (APP.routePoints.length === 0) return;
    APP.routePoints.forEach((point, index) => {
        if (index === 0) {
            point.type = 'start';
        } else if (index === APP.routePoints.length - 1 && APP.routePoints.length > 1) {
            point.type = 'dest';
        } else {
            point.type = 'waypoint';
        }
    });
}

export function removePoint(id) {
    APP.routePoints = APP.routePoints.filter(p => p.id !== id);
    if (APP.routePoints.length === 1) {
        APP.routePoints.push({
            id: APP.nextPointId++,
            lat: null,
            lng: null,
            address: '',
            type: 'dest'
        });
    }
    updatePointTypes();
    renderRoutePoints();
    updateMapMarkers();
    if (_calculateRoute) _calculateRoute();
}

export function updatePointAddress(id, newAddress, newLat, newLng) {
    const point = APP.routePoints.find(p => p.id === id);
    if (point) {
        point.address = newAddress;
        if (newLat !== undefined && newLng !== undefined) {
            point.lat = newLat;
            point.lng = newLng;
        }
    }
}

export function addPoint(lat, lng, address) {
    const newPoint = {
        id: APP.nextPointId++,
        lat: parseFloat(lat.toFixed(4)),
        lng: parseFloat(lng.toFixed(4)),
        address: address,
        type: 'start'
    };
    APP.routePoints.push(newPoint);
    updatePointTypes();
    renderRoutePoints();
    updateMapMarkers();
    if (_calculateRoute) _calculateRoute();
}

export function addNewWaypoint() {
    const newPoint = {
        id: APP.nextPointId++,
        lat: null,
        lng: null,
        address: '',
        type: 'waypoint'
    };

    if (APP.routePoints.length >= 2) {
        APP.routePoints.splice(APP.routePoints.length - 1, 0, newPoint);
    } else {
        APP.routePoints.push(newPoint);
    }

    updatePointTypes();
    renderRoutePoints();
}

export function renderRoutePoints() {
    const container = document.getElementById('routePointsList');
    if (!container) return;
    container.innerHTML = '';

    APP.routePoints.forEach((point, index) => {
        let label, badgeClass;
        if (point.type === 'start') {
            label = 'A';
            badgeClass = 'point-type-start';
        } else if (point.type === 'dest') {
            label = 'B';
            badgeClass = 'point-type-dest';
        } else {
            label = index.toString();
            badgeClass = 'point-type-waypoint';
        }

        const placeholder = point.type === 'start' ? 'Start Point' : point.type === 'dest' ? 'Destination' : 'Waypoint';

        const div = document.createElement('div');
        div.className = 'route-point-item';
        div.draggable = true;
        div.dataset.id = point.id;

        div.innerHTML = `
            <button class="btn-drag" title="Drag to reorder">☰</button>
            <div class="point-type-badge ${badgeClass}">${label}</div>
            <div class="address-input-wrapper">
                <input type="text" id="input-${point.id}" value="${point.address}" placeholder="${placeholder}">
            </div>
            <button class="btn-danger" onclick="removePoint(${point.id})">✕</button>
        `;

        container.appendChild(div);

        const input = document.getElementById(`input-${point.id}`);
        input.classList.add('search-input');
        input.addEventListener('focus', () => {
            APP.lastFocusedInputId = point.id;
        });

        // clicking the point-type badge should center the map on the point
        const badge = div.querySelector('.point-type-badge');
        if (badge) {
            badge.style.cursor = 'pointer';
            badge.addEventListener('click', (e) => {
                e.stopPropagation();
                if (point.lat !== null && point.lng !== null && APP.map) {
                    // keep current zoom level
                    APP.map.setView([point.lat, point.lng], APP.map.getZoom(), { animate: true });
                }
            });
        }

        input.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // Attach autocomplete to each dynamically created input (idempotent per DOM element)
        if (!input.dataset.autocompleteAttached) {
            attachAutocompleteToInput(input, point.id, {
                onSelect: ({ display, lat, lon }) => {
                    const dataId = input.dataset.pointId;
                    if (dataId === 'initial') {
                        APP.routePoints[0].lat = lat;
                        APP.routePoints[0].lng = lon;
                        APP.routePoints[0].address = display;
                    } else {
                        const pid = parseInt(dataId, 10);
                        const p = APP.routePoints.find(x => x.id === pid);
                        if (p) {
                            p.lat = lat;
                            p.lng = lon;
                            p.address = display;
                        }
                    }

                    input.value = display;
                    renderRoutePoints();
                    updateMapMarkers();
                    if (_calculateRoute) _calculateRoute();
                    showRouteContent();
                }
            });
            input.dataset.autocompleteAttached = '1';
        }

        div.addEventListener('dragstart', (e) => {
            APP.draggedElement = div;
            e.dataTransfer.effectAllowed = 'move';
        });

        div.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';

            // Remove existing indicator
            document.querySelectorAll('.drop-indicator-line').forEach(el => el.remove());

            // Show drop indicator line between elements
            const rect = div.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            const isTopHalf = e.clientY < midpoint;

            // Store the drop position for use in drop event
            div.dataset.dropBefore = isTopHalf ? 'true' : 'false';

            const indicator = document.createElement('div');
            indicator.className = 'drop-indicator-line';
            indicator.style.cssText = 'position:absolute;left:0;right:0;height:2px;background:#32b8c6;pointer-events:none;z-index:100;';

            const container = div.parentElement;
            if (isTopHalf) {
                // Insert before this element (gap is 8px, line is 2px, so center at -5px)
                indicator.style.top = (div.offsetTop - 5) + 'px';
            } else {
                // Insert after this element (gap is 8px, line is 2px, so center at +3px)
                indicator.style.top = (div.offsetTop + div.offsetHeight + 3) + 'px';
            }

            container.style.position = 'relative';
            container.appendChild(indicator);
        });

        div.addEventListener('drop', (e) => {
            e.preventDefault();

            // Remove drop indicator
            document.querySelectorAll('.drop-indicator-line').forEach(el => el.remove());

            if (!APP.draggedElement || APP.draggedElement === div) return;

            const fromIndex = APP.routePoints.findIndex(p => p.id == APP.draggedElement.dataset.id);
            const toIndex = APP.routePoints.findIndex(p => p.id == div.dataset.id);
            const dropBefore = div.dataset.dropBefore === 'true';

            if (fromIndex !== -1 && toIndex !== -1) {
                const [removed] = APP.routePoints.splice(fromIndex, 1);

                // Adjust target index if needed
                let insertIndex = toIndex;
                if (fromIndex < toIndex && !dropBefore) {
                    // Moving down and dropping after: no adjustment needed
                } else if (fromIndex < toIndex && dropBefore) {
                    // Moving down and dropping before: adjust by -1
                    insertIndex = toIndex - 1;
                } else if (fromIndex > toIndex && !dropBefore) {
                    // Moving up and dropping after: adjust by +1
                    insertIndex = toIndex + 1;
                }
                // Moving up and dropping before: no adjustment needed

                APP.routePoints.splice(insertIndex, 0, removed);
                updatePointTypes();
                renderRoutePoints();
                updateMapMarkers();
                if (_calculateRoute) _calculateRoute();
            }

            delete div.dataset.dropBefore;
        });

        div.addEventListener('dragend', () => {
            APP.draggedElement = null;
            // Remove any remaining drop indicators
            document.querySelectorAll('.drop-indicator-line').forEach(el => el.remove());
        });
    });
}

export function updateMapMarkers() {
    if (!APP.markerLayer) return;
    APP.markerLayer.clearLayers();
    APP.mapMarkers = {};

    APP.routePoints.forEach((point, index) => {
        if (point.lat === null || point.lng === null) return;

        let label, type;
        if (point.type === 'start') {
            label = 'A';
            type = 'start';
        } else if (point.type === 'dest') {
            label = 'B';
            type = 'dest';
        } else {
            label = index.toString();
            type = 'waypoint';
        }

        const icon = L.divIcon({
            html: `<div class="map-pin ${type}">${label}</div>`,
            className: 'leaflet-div-icon',
            iconSize: [24, 24],
            iconAnchor: [12, 12]
        });

        const marker = L.marker([point.lat, point.lng], { icon, draggable: true })
            .addTo(APP.markerLayer);

        const popupContent = `
            <div style="padding: 8px; font-size: 12px;">
                <strong>${point.address || 'Location'}</strong>
                <button onclick="removePoint(${point.id})" style="
                    display: block;
                    margin-top: 8px;
                    padding: 4px 8px;
                    background: #ff6b7a;
                    color: white;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 11px;
                    width: 100%;
                ">Remove</button>
            </div>
        `;
        marker.bindPopup(popupContent);

        APP.mapMarkers[point.id] = marker;

        marker.on('dragstart', (e) => {
            APP.isDraggingMarker = true;
            APP.draggedMarkerStartPos = { lat: point.lat, lng: point.lng };
            marker.closePopup();
        });

        marker.on('drag', (e) => {
            const pos = e.target.getLatLng();
            point.lat = parseFloat(pos.lat.toFixed(4));
            point.lng = parseFloat(pos.lng.toFixed(4));
            if (_throttledPreview) _throttledPreview();
        });

        marker.on('dragend', (e) => {
            APP.isDraggingMarker = false;
            if (APP.map && APP.map.dragging) APP.map.dragging.enable();
            const pos = e.target.getLatLng();
            const lat = parseFloat(pos.lat.toFixed(4));
            const lng = parseFloat(pos.lng.toFixed(4));
            reverseGeocodeWithRateLimit(lat, lng).then((address) => {
                updatePointAddress(point.id, address, lat, lng);
                const input = document.getElementById(`input-${point.id}`);
                if (input) input.value = address;
                renderRoutePoints();
                if (_calculateRoute) _calculateRoute();
            });
        });
    });
}

export function handleMapClick(latlng) {
    const contextMenu = document.getElementById('contextMenu');
    if (APP.contextMenuOpen) {
        contextMenu.classList.remove('active');
        APP.contextMenuOpen = false;
        return;
    }

    if (APP.routeClickJustHappened) {
        return;
    }

    const routeCheck = APP.routePolylineMouseDown;
    const markerCheck = APP.isDraggingMarker;
    const polylineCheck = APP.isPolylineMouseDown;
    const routeLineCheck = isClickOnRoute(latlng);

    if (!latlng || routeCheck || markerCheck || polylineCheck || routeLineCheck) {
        return;
    }

    const lat = latlng.lat;
    const lng = latlng.lng;

    if (APP.lastFocusedInputId !== null) {
        const point = APP.routePoints.find(p => p.id === APP.lastFocusedInputId);
        if (point) {
            const input = document.getElementById(`input-${APP.lastFocusedInputId}`);
            point.lat = lat;
            point.lng = lng;
            point.address = 'Locating...';
            if (input) input.value = 'Locating...';

            updatePointTypes();
            updateMapMarkers();
            renderRoutePoints();
            if (_calculateRoute) _calculateRoute();

            APP.lastFocusedInputId = null;

            reverseGeocodeWithRateLimit(lat, lng).then((address) => {
                point.address = address;
                if (input) input.value = address;
                renderRoutePoints();
            });
        }
        return;
    }

    const startPoint = APP.routePoints.find(p => p.type === 'start');
    const destPoint = APP.routePoints.find(p => p.type === 'dest');

    const hasStart = startPoint && startPoint.lat !== null;
    const hasDestination = destPoint && destPoint.lng !== null;

    if (!hasStart) {
        APP.routePoints[0].lat = lat;
        APP.routePoints[0].lng = lng;
        APP.routePoints[0].address = 'Locating...';
        renderRoutePoints();
        updateMapMarkers();
        showRouteContent();

        reverseGeocodeWithRateLimit(lat, lng).then((address) => {
            APP.routePoints[0].address = address;
            renderRoutePoints();
        });
    } else if (!hasDestination) {
        APP.routePoints[1].lat = lat;
        APP.routePoints[1].lng = lng;
        APP.routePoints[1].address = 'Locating...';
        renderRoutePoints();
        updateMapMarkers();
        if (_calculateRoute) _calculateRoute();

        reverseGeocodeWithRateLimit(lat, lng).then((address) => {
            APP.routePoints[1].address = address;
            renderRoutePoints();
        });
    } else {
        destPoint.type = 'waypoint';

        const newDest = {
            id: APP.nextPointId++,
            lat: lat,
            lng: lng,
            address: 'Locating...',
            type: 'dest'
        };
        APP.routePoints.push(newDest);

        updatePointTypes();
        renderRoutePoints();
        updateMapMarkers();
        if (_calculateRoute) _calculateRoute();

        reverseGeocodeWithRateLimit(lat, lng).then((address) => {
            newDest.address = address;
            renderRoutePoints();
        });
    }
}

export function addPointAsStart(lat, lng) {
    reverseGeocodeWithRateLimit(lat, lng).then((address) => {
        if (APP.routePoints.length > 0 && APP.routePoints[0].lat === null) {
            APP.routePoints[0].lat = lat;
            APP.routePoints[0].lng = lng;
            APP.routePoints[0].address = address;
        } else {
            const newPoint = {
                id: APP.nextPointId++,
                lat: lat,
                lng: lng,
                address: address,
                type: 'start'
            };
            APP.routePoints.unshift(newPoint);
        }
        updatePointTypes();
        renderRoutePoints();
        updateMapMarkers();
        if (_calculateRoute) _calculateRoute();
        document.getElementById('contextMenu').classList.remove('active');
        APP.contextMenuOpen = false;
        showRouteContent();
    });
}

export function addPointAsDestination(lat, lng) {
    reverseGeocodeWithRateLimit(lat, lng).then((address) => {
        if (APP.routePoints.length > 0 && APP.routePoints[APP.routePoints.length - 1].lat === null) {
            APP.routePoints[APP.routePoints.length - 1].lat = lat;
            APP.routePoints[APP.routePoints.length - 1].lng = lng;
            APP.routePoints[APP.routePoints.length - 1].address = address;
        } else {
            const newPoint = {
                id: APP.nextPointId++,
                lat: lat,
                lng: lng,
                address: address,
                type: 'dest'
            };
            APP.routePoints.push(newPoint);
        }
        updatePointTypes();
        renderRoutePoints();
        updateMapMarkers();
        if (_calculateRoute) _calculateRoute();
        document.getElementById('contextMenu').classList.remove('active');
        APP.contextMenuOpen = false;
    });
}

export function addPointAsWaypoint(lat, lng) {
    reverseGeocodeWithRateLimit(lat, lng).then((address) => {
        const newPoint = {
            id: APP.nextPointId++,
            lat: lat,
            lng: lng,
            address: address,
            type: 'waypoint'
        };
        if (APP.routePoints.length >= 2) {
            APP.routePoints.splice(APP.routePoints.length - 1, 0, newPoint);
        } else {
            APP.routePoints.push(newPoint);
        }
        updatePointTypes();
        renderRoutePoints();
        updateMapMarkers();
        if (_calculateRoute) _calculateRoute();
        document.getElementById('contextMenu').classList.remove('active');
        APP.contextMenuOpen = false;
    });
}

export function createOrUpdateRoutePreview(point) {
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

export function removeRoutePreview() {
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
