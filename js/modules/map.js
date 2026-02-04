// map.js - Map initialization and route styling
import CONFIG from '../config.js';
import { APP } from './state.js';
import { isDebugMode, notifyDarkModeChange } from './debug.js';

let tileLayer = null;
let isDarkMode = false; // Default to light mode

export function initializeMap() {
    APP.map = L.map('map', {
        zoomControl: false,
        zoom: CONFIG.MAPZOOM,
        center: CONFIG.MAPCENTER
    });

    L.control.zoom({ position: 'topright' }).addTo(APP.map);

    // OpenStreetMap tiles
    tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
    }).addTo(APP.map);

    // Apply light mode by default (no filter)
    applyDarkModeFilter(isDarkMode);

    // Layers
    APP.routeLayer = L.layerGroup().addTo(APP.map);
    APP.markerLayer = L.layerGroup().addTo(APP.map);

    // Geolocation
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((pos) => {
            const { latitude, longitude } = pos.coords;
            APP.map.setView([latitude, longitude], 12);
        }, (error) => {
            console.log('Geolocation denied or failed:', error.message);
        });
    }

    return APP.map;
}

function applyDarkModeFilter(dark) {
    // Dark Reader style: invert + hue-rotate to preserve colors but darken
    const tilePane = document.querySelector('.leaflet-tile-pane');
    const attribution = document.querySelector('.leaflet-control-attribution');

    const darkFilter = 'invert(1) hue-rotate(180deg) saturate(1.2) brightness(0.9)';

    if (tilePane) {
        tilePane.style.filter = dark ? darkFilter : 'none';
    }

    if (attribution) {
        attribution.style.filter = dark ? darkFilter : 'none';
    }
}

export function toggleDarkMode() {
    isDarkMode = !isDarkMode;
    applyDarkModeFilter(isDarkMode);

    // Notify debug module about dark mode change
    notifyDarkModeChange(isDarkMode);

    // Update toggle button appearance
    const btn = document.getElementById('darkModeToggleBtn');
    if (btn) {
        btn.classList.toggle('active', isDarkMode);
        btn.title = isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode';
    }

    return isDarkMode;
}

export function isDarkMapMode() {
    return isDarkMode;
}

export function updateRouteStyle() {
    if (!APP.routeLayer) return;

    APP.routeLayer.eachLayer(layer => {
        if (layer.setStyle) {
            if (isDebugMode()) {
                layer.setStyle({
                    dashArray: '5, 5',
                    opacity: 0.6,
                    weight: 3
                });
            } else {
                layer.setStyle({
                    dashArray: 'none',
                    opacity: 0.8,
                    weight: 4
                });
            }
        }
    });
}
