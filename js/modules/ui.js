// ui.js - UI interaction and rendering
import { APP } from './state.js';
import { reverseGeocode } from '../geocoding.js';

import { attachAutocompleteToInput } from './autocomplete.js';
export { attachAutocompleteToInput };
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

function closeAllMenus() {
    const menus = document.querySelectorAll('.custom-menu-overlay');
    menus.forEach(m => m.remove());

    // Also remove any existing context menus
    const oldContext = document.getElementById('contextMenu');
    if (oldContext) {
        oldContext.classList.remove('active');
        oldContext.style.display = 'none';
        APP.contextMenuOpen = false;
    }
}

// Global listener to close menus and deselect points on outside click
document.addEventListener('click', (e) => {
    const isMenuClick = e.target.closest('.custom-menu-overlay') || e.target.closest('#contextMenu');
    const isPinClick = e.target.closest('.map-pin');
    const isInputClick = e.target.closest('.route-point-item');
    const isMapClick = e.target.closest('#map');

    if (!isMenuClick && !isPinClick) {
        closeAllMenus();
    }

    if (!isInputClick && !isMapClick && !isMenuClick) {
        if (APP.lastFocusedInputId !== null) {
            APP.lastFocusedInputId = null;
            document.querySelectorAll('.route-point-item.selected').forEach(el => el.classList.remove('selected'));
        }
    }
});

// Make removePoint globally available for the menu onclicks
window.removePoint = removePoint;

export function removePoint(id) {
    if (APP.lastFocusedInputId === id) APP.lastFocusedInputId = null;
    const removedPoint = APP.routePoints.find(p => p.id === id);
    APP.routePoints = APP.routePoints.filter(p => p.id !== id);

    if (APP.routePoints.length === 1) {
        const remaining = APP.routePoints[0];
        // If we removed the start, remaining point stays as destination
        // If we removed the destination, remaining point stays as start
        if (removedPoint.type === 'start') {
            remaining.type = 'dest';
            APP.routePoints.unshift({
                id: APP.nextPointId++,
                lat: null,
                lng: null,
                address: '',
                type: 'start'
            });
        } else {
            remaining.type = 'start';
            APP.routePoints.push({
                id: APP.nextPointId++,
                lat: null,
                lng: null,
                address: '',
                type: 'dest'
            });
        }
    } else {
        updatePointTypes();
    }

    renderRoutePoints();
    updateMapMarkers();
    if (_calculateRoute) _calculateRoute();
    closeAllMenus();
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
    // legacy support if needed
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
    // Focus the new input
    setTimeout(() => {
        const input = document.getElementById(`input-${newPoint.id}`);
        if (input) input.focus();
    }, 50);
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
        const locationBtn = (point.type === 'start' && point.lat === null) ? '<button class="btn-location" onclick="useCurrentLocation()" title="Use current location"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-secondary)" stroke-width="2"><circle cx="12" cy="12" r="8"></circle><line x1="12" y1="2" x2="12" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line></svg></button>' : '';

        const isSelected = APP.lastFocusedInputId === point.id;
        const div = document.createElement('div');
        div.className = `route-point-item ${isSelected ? 'selected' : ''}`;
        div.draggable = true;
        div.dataset.id = point.id;

        div.innerHTML = `
            <button class="btn-drag" title="Drag to reorder">☰</button>
            <div class="point-type-badge ${badgeClass}">${label}</div>
            <div class="address-input-wrapper">
                <input type="text" id="input-${point.id}" value="${point.address}" placeholder="${placeholder}">
                ${locationBtn}
            </div>
            <button class="btn-danger" onclick="removePoint(${point.id})">✕</button>
        `;

        container.appendChild(div);

        const input = document.getElementById(`input-${point.id}`);
        input.classList.add('search-input');
        input.addEventListener('focus', () => {
            // Remove selection from others
            document.querySelectorAll('.route-point-item.selected').forEach(el => el.classList.remove('selected'));

            // Add selection to this one
            div.classList.add('selected');
            APP.lastFocusedInputId = point.id;
        });
        input.addEventListener('blur', () => {
            // We don't remove the class or null the ID here, 
            // allowing the map click handler to catch it.
        });

        const badge = div.querySelector('.point-type-badge');
        if (badge) {
            badge.style.cursor = 'pointer';
            badge.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (point.lat !== null && point.lng !== null && APP.map) {
                    APP.map.setView([point.lat, point.lng], APP.map.getZoom(), { animate: true });
                }
            });
        }

        input.addEventListener('click', (e) => {
            e.stopPropagation();
        });

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

        // Drag and Drop Logic
        div.addEventListener('dragstart', (e) => {
            APP.draggedElement = div;
            e.dataTransfer.effectAllowed = 'move';
        });

        div.addEventListener('dragover', (e) => {
            e.preventDefault();

            // Only show drop indicator for waypoint reordering, not for file drops
            if (e.dataTransfer.types.includes('Files')) {
                return;
            }

            e.dataTransfer.dropEffect = 'move';
            document.querySelectorAll('.drop-indicator-line').forEach(el => el.remove());

            const rect = div.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            const isTopHalf = e.clientY < midpoint;
            div.dataset.dropBefore = isTopHalf ? 'true' : 'false';

            const indicator = document.createElement('div');
            indicator.className = 'drop-indicator-line';
            indicator.style.cssText = 'position:absolute;left:0;right:0;height:2px;background:#32b8c6;pointer-events:none;z-index:100;';

            const container = div.parentElement;
            if (isTopHalf) {
                indicator.style.top = (div.offsetTop - 5) + 'px';
            } else {
                indicator.style.top = (div.offsetTop + div.offsetHeight + 3) + 'px';
            }
            container.style.position = 'relative';
            container.appendChild(indicator);
        });

        div.addEventListener('drop', (e) => {
            e.preventDefault();
            document.querySelectorAll('.drop-indicator-line').forEach(el => el.remove());

            if (!APP.draggedElement || APP.draggedElement === div) return;

            const fromIndex = APP.routePoints.findIndex(p => p.id == APP.draggedElement.dataset.id);
            const toIndex = APP.routePoints.findIndex(p => p.id == div.dataset.id);
            const dropBefore = div.dataset.dropBefore === 'true';

            if (fromIndex !== -1 && toIndex !== -1) {
                const [removed] = APP.routePoints.splice(fromIndex, 1);
                let insertIndex = toIndex;
                if (fromIndex < toIndex && !dropBefore) {
                } else if (fromIndex < toIndex && dropBefore) {
                    insertIndex = toIndex - 1;
                } else if (fromIndex > toIndex && !dropBefore) {
                    insertIndex = toIndex + 1;
                }

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
            document.querySelectorAll('.drop-indicator-line').forEach(el => el.remove());
        });

        // Touch support for mobile
        let touchStartY = 0;
        let touchElement = null;

        div.addEventListener('touchstart', (e) => {
            if (!e.target.closest('.btn-drag')) return;
            touchStartY = e.touches[0].clientY;
            touchElement = div;
            div.style.opacity = '0.5';
        });

        div.addEventListener('touchmove', (e) => {
            if (!touchElement) return;
            e.preventDefault();
            const touch = e.touches[0];
            const elements = document.elementsFromPoint(touch.clientX, touch.clientY);
            const targetItem = elements.find(el => el.classList.contains('route-point-item') && el !== touchElement);

            document.querySelectorAll('.drop-indicator-line').forEach(el => el.remove());

            if (targetItem) {
                const rect = targetItem.getBoundingClientRect();
                const midpoint = rect.top + rect.height / 2;
                const isTopHalf = touch.clientY < midpoint;

                const indicator = document.createElement('div');
                indicator.className = 'drop-indicator-line';
                indicator.style.cssText = 'position:absolute;left:0;right:0;height:2px;background:#32b8c6;pointer-events:none;z-index:100;';

                const container = targetItem.parentElement;
                if (isTopHalf) {
                    indicator.style.top = (targetItem.offsetTop - 5) + 'px';
                } else {
                    indicator.style.top = (targetItem.offsetTop + targetItem.offsetHeight + 3) + 'px';
                }

                container.style.position = 'relative';
                container.appendChild(indicator);
                targetItem.dataset.dropBefore = isTopHalf ? 'true' : 'false';
            }
        });

        div.addEventListener('touchend', (e) => {
            if (!touchElement) return;
            div.style.opacity = '1';

            const touch = e.changedTouches[0];
            const elements = document.elementsFromPoint(touch.clientX, touch.clientY);
            const targetItem = elements.find(el => el.classList.contains('route-point-item') && el !== touchElement);

            document.querySelectorAll('.drop-indicator-line').forEach(el => el.remove());

            if (targetItem) {
                const fromIndex = APP.routePoints.findIndex(p => p.id == touchElement.dataset.id);
                const toIndex = APP.routePoints.findIndex(p => p.id == targetItem.dataset.id);
                const dropBefore = targetItem.dataset.dropBefore === 'true';

                if (fromIndex !== -1 && toIndex !== -1) {
                    const [removed] = APP.routePoints.splice(fromIndex, 1);
                    let insertIndex = toIndex;
                    if (fromIndex < toIndex && !dropBefore) {
                    } else if (fromIndex < toIndex && dropBefore) {
                        insertIndex = toIndex - 1;
                    } else if (fromIndex > toIndex && !dropBefore) {
                        insertIndex = toIndex + 1;
                    }

                    APP.routePoints.splice(insertIndex, 0, removed);
                    updatePointTypes();
                    renderRoutePoints();
                    updateMapMarkers();
                    if (_calculateRoute) _calculateRoute();
                }

                delete targetItem.dataset.dropBefore;
            }

            touchElement = null;
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

        // Custom Overlay for Marker Menu (instead of Leaflet popup)
        marker.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            closeAllMenus();

            const mapContainer = APP.map.getContainer();
            const pointPx = APP.map.latLngToContainerPoint([point.lat, point.lng]);

            const menu = document.createElement('div');
            menu.className = 'custom-menu-overlay';
            // Center horizontally above point
            menu.style.left = pointPx.x + 'px';
            menu.style.top = pointPx.y + 'px';

            // Modern, dark-mode compatible menu content
            const addr = point.address || 'Locating...';

            // SVG Icons
            const trashIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;

            menu.innerHTML = `
                <div class="menu-content">
                    <div class="menu-header">
                        <div class="menu-title">${addr}</div>
                        <div class="menu-coords">${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}</div>
                    </div>
                    <div class="menu-divider"></div>
                    <button class="menu-item danger" onclick="removePoint(${point.id})">
                        ${trashIcon}
                        <span>Remove Point</span>
                    </button>
                </div>
            `;

            mapContainer.appendChild(menu);

            const removeBtn = menu.querySelector('.menu-item.danger');
            if (removeBtn) {
                removeBtn.onclick = (e) => {
                    L.DomEvent.stopPropagation(e);
                    removePoint(point.id);
                };
            }

            // If address is "Locating...", try to refresh it
            if (addr === 'Locating...') {
                reverseGeocode(point.lat, point.lng).then(res => {
                    point.address = res;
                    const title = menu.querySelector('.menu-title');
                    if (title) title.textContent = res;
                });
            }
        });

        APP.mapMarkers[point.id] = marker;

        marker.on('dragstart', (e) => {
            APP.isDraggingMarker = true;
            APP.draggedMarkerStartPos = { lat: point.lat, lng: point.lng };
            closeAllMenus();
        });

        marker.on('drag', (e) => {
            const pos = e.target.getLatLng();
            point.lat = parseFloat(pos.lat.toFixed(4));
            point.lng = parseFloat(pos.lng.toFixed(4));
            if (_throttledPreview) _throttledPreview();
        });

        marker.on('dragend', (e) => {
            APP.isDraggingMarker = false;
            const pos = e.target.getLatLng();
            const lat = parseFloat(pos.lat.toFixed(4));
            const lng = parseFloat(pos.lng.toFixed(4));
            reverseGeocode(lat, lng).then((address) => {
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
    if (document.querySelector('.custom-menu-overlay') || APP.contextMenuOpen) {
        closeAllMenus();
        return;
    }

    if (APP.routeClickJustHappened) return;

    const routeCheck = APP.routePolylineMouseDown;
    const markerCheck = APP.isDraggingMarker;
    const polylineCheck = APP.isPolylineMouseDown;
    const routeLineCheck = isClickOnRoute(latlng);

    if (!latlng || routeCheck || markerCheck || polylineCheck || routeLineCheck) {
        return;
    }

    const { lat, lng } = latlng;

    // If a point is selected, replace its coordinates
    if (APP.lastFocusedInputId !== null) {
        const selectedPoint = APP.routePoints.find(p => p.id === APP.lastFocusedInputId);
        if (selectedPoint) {
            selectedPoint.lat = lat;
            selectedPoint.lng = lng;
            selectedPoint.address = 'Locating...';
            finishMapClickAction(lat, lng, selectedPoint);
            return; // Exit after replacing
        }
    }

    const startPoint = APP.routePoints.find(p => p.type === 'start');
    const destPoint = APP.routePoints.find(p => p.type === 'dest');

    // First click sets destination, second sets start
    if (!destPoint || destPoint.lat === null) {
        const p = APP.routePoints[APP.routePoints.length - 1];
        p.lat = lat;
        p.lng = lng;
        p.address = 'Locating...';
        finishMapClickAction(lat, lng, p);
        showRouteContent();
    } else if (!startPoint || startPoint.lat === null) {
        APP.routePoints[0].lat = lat;
        APP.routePoints[0].lng = lng;
        APP.routePoints[0].address = 'Locating...';
        finishMapClickAction(lat, lng, APP.routePoints[0]);
    } else {
        destPoint.type = 'waypoint';
        const newDest = {
            id: APP.nextPointId++,
            lat, lng, address: 'Locating...', type: 'dest'
        };
        APP.routePoints.push(newDest);
        finishMapClickAction(lat, lng, newDest);
    }
}

function finishMapClickAction(lat, lng, pointObj) {
    renderRoutePoints();
    updateMapMarkers();
    if (_calculateRoute) _calculateRoute();

    reverseGeocode(lat, lng).then(addr => {
        pointObj.address = addr;
        // If this was the selected point, update input focus state
        if (APP.lastFocusedInputId === pointObj.id) {
            APP.lastFocusedInputId = null;
        }
        renderRoutePoints();
    });
}

// Right Click Context Menu Handler
export function handleMapRightClick(e) {
    if (e.originalEvent) {
        L.DomEvent.preventDefault(e.originalEvent);
        L.DomEvent.stopPropagation(e.originalEvent);
    }

    closeAllMenus();

    const { latlng, originalEvent } = e;
    const menu = document.getElementById('contextMenu');
    if (!menu) return;

    APP.contextMenuOpen = true;

    menu.dataset.lat = latlng.lat;
    menu.dataset.lng = latlng.lng;

    // Center horizontally above point
    menu.style.display = 'block';
    menu.style.left = originalEvent.clientX + 'px';
    menu.style.top = originalEvent.clientY + 'px';
    menu.classList.add('active');

    const latStr = latlng.lat.toFixed(4);
    const lngStr = latlng.lng.toFixed(4);

    const startIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>`;
    const destIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="3"/></svg>`;
    const wayIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`;

    menu.innerHTML = `
        <div class="menu-content">
            <div class="menu-header" style="border-radius: 12px 12px 0 0; overflow: hidden;">
                <div class="menu-title">Locating...</div>
                <div class="menu-coords">${latStr}, ${lngStr}</div>
            </div>
            <div class="menu-divider"></div>
            <button class="menu-item" onclick="addPointAsStart(${latlng.lat}, ${latlng.lng})">
                ${startIcon} <span>Set as Start</span>
            </button>
            <button class="menu-item" onclick="addPointAsDestination(${latlng.lat}, ${latlng.lng})">
                ${destIcon} <span>Set as Destination</span>
            </button>
            <button class="menu-item" onclick="addPointAsWaypoint(${latlng.lat}, ${latlng.lng})">
                ${wayIcon} <span>Add as Waypoint</span>
            </button>
        </div>
    `;

    reverseGeocode(latlng.lat, latlng.lng).then(address => {
        const titleEl = menu.querySelector('.menu-title');
        if (titleEl) titleEl.textContent = address;
    });
}

// Global functions for menu buttons - Defined ONCE and exported
export function addPointAsStart(lat, lng) {
    if (APP.routePoints.length > 0) {
        APP.routePoints[0].lat = lat;
        APP.routePoints[0].lng = lng;
        APP.routePoints[0].address = 'Locating...';
    } else {
        APP.routePoints.push({ id: APP.nextPointId++, lat, lng, address: 'Locating...', type: 'start' });
    }
    APP.lastFocusedInputId = null;
    closeAllMenus();
    finishMapClickAction(lat, lng, APP.routePoints[0]);
    showRouteContent();
}
window.addPointAsStart = addPointAsStart;

export function addPointAsDestination(lat, lng) {
    const last = APP.routePoints[APP.routePoints.length - 1];
    if (last && last.type === 'dest') {
        last.lat = lat;
        last.lng = lng;
        last.address = 'Locating...';
        APP.lastFocusedInputId = null;
        closeAllMenus();
        finishMapClickAction(lat, lng, last);
    } else {
        const newDest = { id: APP.nextPointId++, lat, lng, address: 'Locating...', type: 'dest' };
        APP.routePoints.push(newDest);
        APP.lastFocusedInputId = null;
        closeAllMenus();
        finishMapClickAction(lat, lng, newDest);
    }
    showRouteContent(); // Ensure UI is updated
}
window.addPointAsDestination = addPointAsDestination;

export function addPointAsWaypoint(lat, lng) {
    const newPoint = {
        id: APP.nextPointId++,
        lat, lng,
        address: 'Locating...',
        type: 'waypoint'
    };

    if (APP.routePoints.length > 1) {
        APP.routePoints.splice(APP.routePoints.length - 1, 0, newPoint);
    } else {
        APP.routePoints.push(newPoint);
    }

    APP.lastFocusedInputId = null;
    closeAllMenus();
    updatePointTypes();
    renderRoutePoints();
    updateMapMarkers();
    if (_calculateRoute) _calculateRoute();
    showRouteContent(); // Ensure UI is updated

    reverseGeocode(lat, lng).then(addr => {
        newPoint.address = addr;
        renderRoutePoints();
    });
}
window.addPointAsWaypoint = addPointAsWaypoint;

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
