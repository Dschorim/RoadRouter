// amenity_search.js - Amenity search logic and UI
import { APP } from './state.js';
import { fetchAmenitiesInBounds } from '../osm_data.js';

const AMENITY_LABELS = {
    drinking_water: 'Drinking Water',
    toilets: 'Toilets',
    water_point: 'Water Point',
    bicycle_repair_station: 'Repair Station',
    shelter: 'Shelter',
    bench: 'Bench',
    fuel: 'Fuel Station',
    cafe: 'Cafe',
    restaurant: 'Restaurant',
    supermarket: 'Supermarket',
    biergarten: 'Biergarten',
    fast_food: 'Fast Food',
    food_court: 'Food Court',
    library: 'Library',
    compressed_air: 'Compressed Air',
    atm: 'ATM',
    public_bookcase: 'Bookcase',
    bbq: 'BBQ',
    dressing_room: 'Dressing Room',
    give_box: 'Give Box',
    shower: 'Shower',
    lounger: 'Lounger',
    vending_machine: 'Vending Machine'
};

const AMENITY_ICONS = {
    drinking_water: '<path d="M7 7h10 M12 7v10 M12 17h5 M9 10a3 3 0 0 1 6 0"></path>', // Faucet
    toilets: '<path d="M10 22v-6.5 M10 15v-4.5a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v4.5 M14 22v-6.5 M12 4a2 2 0 1 1 0 4 2 2 0 0 1 0-4z M7 15l1.5-3.5h7L17 15"></path>', // Silhouette
    water_point: '<path d="M12 3L5 12a7 7 0 0 0 14 0L12 3z"></path>', // Droplet pointed top
    bicycle_repair_station: '<circle cx="18.5" cy="17.5" r="3.5"></circle><circle cx="5.5" cy="17.5" r="3.5"></circle><path d="M15 17.5L14.5 12.5H6L5.5 17.5 M12 12V7h2"></path>', // Better bike
    shelter: '<path d="M3 11l9-9 9 9 M5 11v10h14V11"></path>',
    bench: '<path d="M3 14h18 M3 11v6 M21 11v6 M6 11h12"></path>', // Better bench
    fuel: '<path d="M3 19V5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v14 M18 8l2-2 M20 6v5a2 2 0 0 1-2 2h-1 M6 6h7v4H6z"></path>', // Gas pump
    cafe: '<path d="M18 8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V5h15v3z M6 14h9a3 3 0 0 1 3 3v2H3v-2a3 3 0 0 1 3-3z M9 2v2 M12 1v3 M15 2v2"></path>', // Steaming coffee
    restaurant: '<path d="M18 2v20 M2 2v7a3 3 0 0 0 6 0V2 M5 22V12 M13 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"></path>', // Plate/Cutlery
    supermarket: '<path d="M6 6h15l-1.5 9h-12L6 6z M6 6L5 3H2 M9 20a2 2 0 1 0 4 0 2 2 0 1 0-4 0 M17 20a2 2 0 1 0 4 0 2 2 0 1 0-4 0"></path>',
    biergarten: '<path d="M7 2a2 2 0 0 0-2 2v1h14V4a2 2 0 0 0-2-2H7z M5 5h14v10a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V5z M19 8h2a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-2"></path>',
    fast_food: '<path d="M3 11c0-1.7 1.3-3 3-3h12a3 3 0 0 1 3 3v2H3v-2z M2 14h20 M2 17h20 M4 17a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2"></path>', // Burger
    food_court: '<path d="M3 3h18v2H3V3z M4 21h16v-8H4v8z M8 13v3 M11 13v3 M14 13v3 M17 13v3"></path>',
    library: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20 M4 19.5A2.5 2.5 0 0 0 6.5 22H20V5H6.5A2.5 2.5 0 0 0 4 7.5v12z"></path>',
    compressed_air: '<path d="M3 20h18 M12 20V8 M7 12h10 M9 8l3-5 3 5 M12 3v3"></path>', // Pump
    atm: '<text x="12" y="16" font-family="Arial" font-size="10" font-weight="bold" text-anchor="middle" fill="currentColor">$</text><rect x="4" y="6" width="16" height="12" rx="2" stroke="currentColor" fill="none"></rect>',
    public_bookcase: '<path d="M4 3h16v18H4V3z M4 9h16 M4 15h16 M8 4v4 M12 4v4 M16 4v4 M6 10v4 M10 10v4 M14 10v4 M18 10v4"></path>',
    bbq: '<path d="M4 10h16 M5 10v10 M19 10v10 M2 10a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2 M7 8V5 M12 8V4 M17 8V5"></path>', // Grill
    dressing_room: '<path d="M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"></path>',
    give_box: '<path d="M21 8a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8z M12 12l8-4 M12 12L4 8 M12 12v8"></path>',
    shower: '<path d="M7 4a5 5 0 0 1 10 0v1 M12 5v3 M10 7L8 9 M12 6v3 M14 7l2 2 M12 12v1 M11 15v1 M13 18v1"></path>', // Better shower
    lounger: '<path d="M18 20l-4-10-8 6-3-3 M18 20h4 M2 10h3"></path>',
    vending_machine: '<rect x="5" y="3" width="14" height="18" rx="2"></rect><path d="M8 6h3 M8 9h3 M8 12h3 M14 6h2v9h-2z M9 18h6"></path>',
    _default: '<circle cx="12" cy="12" r="3"></circle>'
};
window.AMENITY_ICONS = AMENITY_ICONS;

export function initAmenitySearch() {
    const searchBtn = document.getElementById('amenitySearchBtn');
    if (!searchBtn) return;

    // Sanitize state on initialization to remove legacy/removed types
    const common = [
        'drinking_water', 'toilets', 'water_point', 'bicycle_repair_station', 'shelter',
        'bench', 'fuel', 'cafe', 'restaurant', 'supermarket',
        'biergarten', 'fast_food', 'food_court', 'library', 'compressed_air', 'atm',
        'public_bookcase', 'bbq', 'dressing_room', 'give_box', 'shower',
        'lounger', 'vending_machine'
    ];
    APP.amenitySettings.enabled = APP.amenitySettings.enabled.filter(t => common.includes(t));
    APP.amenitySettings.disabled = APP.amenitySettings.disabled.filter(t => common.includes(t));
    const tabBtn = document.querySelector('.tab-btn[data-tab="amenities"]');

    if (!searchBtn) return;

    // Search Button Click - Toggle Selection Mode
    searchBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleAmenitySelectionMode();
    });

    // Tab Switch Listener
    if (tabBtn) {
        tabBtn.addEventListener('click', renderAmenitySettings);
    }

    // Clear Amenities Button
    const clearBtn = document.getElementById('clearAmenitiesBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            clearAllAmenities();
        });
    }
}

export function clearAllAmenities() {
    if (APP.amenityHighlightLayer) {
        APP.map.removeLayer(APP.amenityHighlightLayer);
        APP.amenityHighlightLayer = null;
    }
    console.log("All temporary amenity markers cleared.");
}

function toggleAmenitySelectionMode() {
    const searchBtn = document.getElementById('amenitySearchBtn');
    const routeContent = document.getElementById('routeContent');
    const initialSearch = document.getElementById('initialSearch');
    const amenitySelection = document.getElementById('amenitySearchSelection');

    const isActive = searchBtn.classList.toggle('active');

    if (isActive) {
        // Show Amenity Selection, Hide Route Stuff
        if (routeContent) routeContent.style.display = 'none';
        if (initialSearch) initialSearch.style.display = 'none';
        if (amenitySelection) {
            amenitySelection.style.display = 'block';
            renderInplaceSelection();
        }
    } else {
        restoreNormalSidecard();
    }
}

function restoreNormalSidecard() {
    const searchBtn = document.getElementById('amenitySearchBtn');
    const routeContent = document.getElementById('routeContent');
    const initialSearch = document.getElementById('initialSearch');
    const amenitySelection = document.getElementById('amenitySearchSelection');

    searchBtn.classList.remove('active');
    if (amenitySelection) amenitySelection.style.display = 'none';

    // Decide what to show (Initial Search or Route Content)
    if (APP.routePoints && APP.routePoints.some(p => p.lat !== null)) {
        if (routeContent) routeContent.style.display = 'block';
    } else {
        if (initialSearch) initialSearch.style.display = 'block';
    }
}

function renderInplaceSelection() {
    const list = document.getElementById('amenityInplaceList');
    if (!list) return;

    const common = [
        'drinking_water', 'toilets', 'water_point', 'bicycle_repair_station', 'shelter',
        'bench', 'fuel', 'cafe', 'restaurant', 'supermarket',
        'biergarten', 'fast_food', 'food_court', 'library', 'compressed_air', 'atm',
        'public_bookcase', 'bbq', 'dressing_room', 'give_box', 'shower',
        'lounger', 'vending_machine'
    ];
    const enabled = APP.amenitySettings.enabled.filter(t => common.includes(t));

    if (enabled.length === 0) {
        list.innerHTML = '<div style="grid-column: span 2; padding: 20px; text-align: center; color: var(--color-text-secondary); font-size: 13px;">No amenities enabled in settings.</div>';
        return;
    }

    list.innerHTML = enabled.map(type => `
        <div class="amenity-selection-item" data-type="${type}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                ${AMENITY_ICONS[type] || AMENITY_ICONS._default}
            </svg>
            <span>${AMENITY_LABELS[type] || type.replace(/_/g, ' ')}</span>
        </div>
    `).join('');

    list.querySelectorAll('.amenity-selection-item').forEach(item => {
        item.addEventListener('click', () => {
            const type = item.getAttribute('data-type');
            searchAndHighlight(type);
            restoreNormalSidecard();
        });
    });
}

async function searchAndHighlight(type) {
    if (!APP.map) return;

    // Zoom in if level is too far out (closest 9 levels allowed now, threshold changed to 12)
    if (APP.map.getZoom() < 12) {
        await new Promise(resolve => {
            APP.map.once('moveend', resolve);
            APP.map.setZoom(12);
        });
    }

    const bounds = APP.map.getBounds();
    const results = await fetchAmenitiesInBounds(bounds, type);

    // 3. Filter results to avoid duplicates (points already in route or as non-essential)
    const filteredElements = (results.elements || []).filter(el => {
        const lat = el.lat1 || (el.lat1 + el.lat2) / 2;
        const lon = el.lon1 || (el.lon1 + el.lon2) / 2;

        // Check route points
        const isAlreadyWaypoint = APP.routePoints.some(p =>
            p.lat !== null &&
            Math.abs(p.lat - lat) < 0.0001 &&
            Math.abs(p.lng - lon) < 0.0001
        );
        if (isAlreadyWaypoint) return false;

        // Check non-essential waypoints
        const isAlreadyNonEssential = (APP.nonEssentialWaypoints || []).some(p =>
            Math.abs(p.lat - lat) < 0.0001 &&
            Math.abs(p.lng - lon) < 0.0001
        );
        if (isAlreadyNonEssential) return false;

        return true;
    });

    // Clear existing highlights
    if (APP.amenityHighlightLayer) {
        APP.map.removeLayer(APP.amenityHighlightLayer);
    }

    const markers = filteredElements.map(el => {
        const lat = el.lat1 || (el.lat1 + el.lat2) / 2;
        const lon = el.lon1 || (el.lon1 + el.lon2) / 2;

        const iconHtml = `
            <div class="amenity-marker">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    ${AMENITY_ICONS[type] || AMENITY_ICONS._default}
                </svg>
            </div>
        `;

        const icon = L.divIcon({
            className: 'amenity-marker-container',
            iconSize: [28, 28],
            iconAnchor: [14, 14],
            html: iconHtml
        });

        const marker = L.marker([lat, lon], {
            icon,
            title: el.tags?.name || 'Amenity'
        });

        marker.on('click', (e) => {
            console.log("Amenity marker clicked:", el.id);
            if (e.originalEvent) {
                L.DomEvent.stopPropagation(e.originalEvent);
            }
            showAmenityMenu(lat, lon, el.tags?.name || AMENITY_LABELS[type] || type, type, marker);
        });

        return marker;
    });

    APP.amenityHighlightLayer = L.layerGroup(markers).addTo(APP.map);
}

function showAmenityMenu(lat, lon, name, type, marker) {
    const menus = document.querySelectorAll('.custom-menu-overlay');
    menus.forEach(m => m.remove());

    const mapContainer = APP.map.getContainer();
    const pointPx = APP.map.latLngToContainerPoint([lat, lon]);

    const menu = document.createElement('div');
    menu.className = 'custom-menu-overlay';
    menu.style.left = pointPx.x + 'px';
    menu.style.top = pointPx.y + 'px';

    console.log(`Showing amenity menu for: ${name} at`, pointPx);

    menu.innerHTML = `
        <div class="menu-content">
            <div class="menu-header">
                <div class="menu-title">${name}</div>
                <div class="menu-coords">${lat.toFixed(4)}, ${lon.toFixed(4)}</div>
            </div>
            <div class="menu-divider"></div>
            <button class="menu-item" id="addWaypointBtn">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
                <span>Add as Waypoint</span>
            </button>
            <button class="menu-item" id="addNonEssentialBtn">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                <span>Add as Non-Essential</span>
            </button>
            <button class="menu-item" id="hideAmenityBtn">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22"/></svg>
                <span>Hide</span>
            </button>
        </div>
    `;

    mapContainer.appendChild(menu);

    menu.querySelector('#addWaypointBtn').onclick = (e) => {
        e.stopPropagation();
        addAmenityAsWaypoint(lat, lon, name);
        if (APP.amenityHighlightLayer) {
            APP.amenityHighlightLayer.removeLayer(marker);
        }
        menu.remove();
    };

    menu.querySelector('#addNonEssentialBtn').onclick = (e) => {
        e.stopPropagation();
        addAsNonEssential(lat, lon, name, type);
        if (APP.amenityHighlightLayer) {
            APP.amenityHighlightLayer.removeLayer(marker);
        }
        menu.remove();
    };

    menu.querySelector('#hideAmenityBtn').onclick = (e) => {
        e.stopPropagation();
        if (APP.amenityHighlightLayer) {
            APP.amenityHighlightLayer.removeLayer(marker);
        }
        menu.remove();
    };
}

function addAmenityAsWaypoint(lat, lon, name) {
    const destIndex = APP.routePoints.findIndex(p => p.type === 'dest');

    if (destIndex !== -1) {
        // Insert just before the destination
        const newWaypoint = {
            id: APP.nextPointId++,
            lat,
            lng: lon,
            address: name,
            type: 'waypoint'
        };

        APP.routePoints.splice(destIndex, 0, newWaypoint);

        import('./ui.js').then(UI => {
            UI.updatePointTypes(); // Ensure indices and types are updated (A, 1, 2, B)
            UI.renderRoutePoints();
            UI.updateMapMarkers();
            UI.triggerRouteCalculation();
        });
    }
}

function addAsNonEssential(lat, lon, name, type) {
    const id = Date.now();
    const point = {
        id,
        lat,
        lng: lon,
        address: name,
        type: 'non-essential',
        amenityType: type // Keep the icon type
    };
    APP.routePoints.push(point);

    import('./ui.js').then(UI => {
        UI.updateMapMarkers();
    });
}

// Global for popup click - re-uses map markers update
window.removeNonEssential = (id) => {
    if (window.removePoint) {
        window.removePoint(id);
    }
};

function renderAmenitySettings() {
    const list = document.getElementById('amenitySettingsList');
    if (!list) return;

    const common = [
        'drinking_water', 'toilets', 'water_point', 'bicycle_repair_station', 'shelter',
        'bench', 'fuel', 'cafe', 'restaurant', 'supermarket',
        'biergarten', 'fast_food', 'food_court', 'library', 'compressed_air', 'atm',
        'public_bookcase', 'bbq', 'dressing_room', 'give_box', 'shower',
        'lounger', 'vending_machine'
    ];

    APP.amenitySettings.enabled = APP.amenitySettings.enabled.filter(t => common.includes(t));
    APP.amenitySettings.disabled = APP.amenitySettings.disabled.filter(t => common.includes(t));

    const allTypes = [...APP.amenitySettings.enabled, ...APP.amenitySettings.disabled];

    // Add missing common types as disabled
    common.forEach(c => {
        if (!allTypes.includes(c)) APP.amenitySettings.disabled.push(c);
    });

    list.innerHTML = '';

    // Combined list for settings (enabled first, then disabled sorted alphabetically)
    const sortedDisabled = [...APP.amenitySettings.disabled].sort((a, b) => {
        const labelA = AMENITY_LABELS[a] || a.replace(/_/g, ' ');
        const labelB = AMENITY_LABELS[b] || b.replace(/_/g, ' ');
        return labelA.localeCompare(labelB);
    });

    const settings = [
        ...APP.amenitySettings.enabled.map(t => ({ type: t, enabled: true })),
        ...sortedDisabled.map(t => ({ type: t, enabled: false }))
    ];

    settings.forEach(item => {
        const el = document.createElement('div');
        el.className = 'amenity-setting-item';
        el.setAttribute('data-type', item.type);
        el.draggable = true;

        el.innerHTML = `
            <div class="amenity-info" style="display:flex; align-items:center; gap:12px; flex:1;">
                <div class="btn-drag" style="margin:0; padding:0; cursor:grab;">⋮⋮</div>
                <div class="amenity-icon-wrapper" style="display:flex; align-items:center; justify-content:center; width:20px; color:var(--color-text-secondary);">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        ${AMENITY_ICONS[item.type] || AMENITY_ICONS._default}
                    </svg>
                </div>
                <span class="amenity-label" style="font-weight:500;">${AMENITY_LABELS[item.type] || item.type.replace(/_/g, ' ')}</span>
            </div>
            <label class="switch" style="margin:0;">
                <input type="checkbox" ${item.enabled ? 'checked' : ''}>
                <span class="slider"></span>
            </label>
        `;

        const checkbox = el.querySelector('input');
        checkbox.addEventListener('change', () => {
            toggleAmenity(item.type, checkbox.checked);
        });

        // Drag and Drop (Simple implementation)
        el.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', item.type);
            el.classList.add('dragging');
        });

        el.addEventListener('dragend', () => {
            el.classList.remove('dragging');
        });

        list.appendChild(el);
    });

    list.addEventListener('dragover', (e) => {
        e.preventDefault();
        const dragging = list.querySelector('.dragging');
        const closest = getDragAfterElement(list, e.clientY);
        if (closest == null) {
            list.appendChild(dragging);
        } else {
            list.insertBefore(dragging, closest);
        }
    });

    list.addEventListener('drop', saveAmenityOrder);
}

function toggleAmenity(type, enabled) {
    if (enabled) {
        APP.amenitySettings.disabled = APP.amenitySettings.disabled.filter(t => t !== type);
        if (!APP.amenitySettings.enabled.includes(type)) {
            APP.amenitySettings.enabled.push(type);
        }
    } else {
        APP.amenitySettings.enabled = APP.amenitySettings.enabled.filter(t => t !== type);
        if (!APP.amenitySettings.disabled.includes(type)) {
            APP.amenitySettings.disabled.push(type);
        }
    }
    saveAmenitySettings();
    renderAmenitySettings(); // Immediately refresh to reflect order change
}

function saveAmenityOrder() {
    const items = [...document.querySelectorAll('.amenity-setting-item')];
    const newEnabled = [];
    const newDisabled = [];

    items.forEach(item => {
        const type = item.getAttribute('data-type');
        const enabled = item.querySelector('input').checked;
        if (enabled) newEnabled.push(type);
        else newDisabled.push(type);
    });

    APP.amenitySettings.enabled = newEnabled;
    APP.amenitySettings.disabled = newDisabled;
    saveAmenitySettings();
}

function saveAmenitySettings() {
    localStorage.setItem('amenitySettings', JSON.stringify(APP.amenitySettings));
    renderInplaceSelection();
}

function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.amenity-setting-item:not(.dragging)')];

    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}
