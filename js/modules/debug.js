// debug.js - Debug visualization logic
import CONFIG from '../config.js';
import { APP } from './state.js';
import { parseMVTTile } from './mvt_parser.js';

let debugMode = false;
let debugTileLayer = null;
let speedStats = { min: Infinity, max: 0, speeds: [] };
let debugLegendControl = null;
let isDarkModeActive = false; // Track dark mode state
let debugTooltip = null;
let mapHoverHandler = null;

// Callback to update route style in main app
let _updateRouteStyleCallback = null;

export function setUpdateRouteStyleCallback(cb) {
    _updateRouteStyleCallback = cb;
}

export function isDebugMode() {
    return debugMode;
}

export function notifyDarkModeChange(isDark) {
    isDarkModeActive = isDark;
    // Refresh debug visualization if active
    if (debugMode && debugTileLayer) {
        // Force redraw by removing and re-adding the layer
        APP.map.removeLayer(debugTileLayer);
        debugTileLayer.addTo(APP.map);
        updateDebugLegend();
    }
}

export function toggleDebugMode() {
    if (!CONFIG.ENABLE_DEBUG_MODE) return;

    debugMode = !debugMode;
    const btn = document.getElementById('debugToggleBtn');

    if (debugMode) {
        btn.classList.add('active');
        speedStats = { min: Infinity, max: 0, speeds: [] };
        loadDebugVisualization();
        if (_updateRouteStyleCallback) _updateRouteStyleCallback();
    } else {
        btn.classList.remove('active');
        removeDebugVisualization();
        if (_updateRouteStyleCallback) _updateRouteStyleCallback();
    }
}

function loadDebugVisualization() {
    try {
        const GridLayer = L.GridLayer.extend({
            createTile: function (coords) {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                const size = this.getTileSize();
                canvas.width = size.x;
                canvas.height = size.y;

                const z = coords.z;
                const x = coords.x;
                const y = coords.y;

                this.fetchAndRenderTile(ctx, x, y, z, size, canvas, coords);

                return canvas;
            },

            fetchAndRenderTile: function (ctx, x, y, z, size, canvas, coords) {
                const url = `${CONFIG.OSRMAPI}/tile/v1/driving/tile(${x},${y},${z}).mvt`;

                fetch(url)
                    .then(r => {
                        if (!r.ok) {
                            if (r.status === 400) {
                                console.warn('OSRM tiles not available. Tiles require data to be prepared with --generate-edge-expanded-edges flag.');
                            }
                            this.drawEmptyTile(ctx, size);
                            return null;
                        }
                        return r.arrayBuffer();
                    })
                    .then(buffer => {
                        if (!buffer) return;

                        try {
                            this.renderTile(ctx, buffer, size, z, canvas, coords);
                        } catch (e) {
                            console.error('Tile render error:', e);
                            this.drawEmptyTile(ctx, size);
                        }
                    })
                    .catch(() => {
                        this.drawEmptyTile(ctx, size);
                    });
            },

            renderTile: function (ctx, buffer, size, z, canvas, coords) {
                ctx.fillStyle = 'rgba(0, 0, 0, 0)';
                ctx.fillRect(0, 0, size.x, size.y);

                // Only render debug lines at zoom levels 15-18
                if (APP.map.getZoom() < 15) {
                    return;
                }

                try {
                    const features = parseMVTTile(buffer);

                    features.forEach(f => {
                        speedStats.speeds.push(f.speed);
                        speedStats.min = Math.min(speedStats.min, f.speed);
                        speedStats.max = Math.max(speedStats.max, f.speed);
                    });

                    updateDebugLegend();

                    // Store features on canvas for hover detection
                    canvas._debugFeatures = features;
                    canvas._tileCoords = coords;

                    features.forEach(feature => {
                        const speed = feature.speed || 0;
                        const color = getAdaptiveSpeedColor(speed, speedStats.min, speedStats.max);

                        ctx.strokeStyle = color;
                        ctx.lineWidth = 3;
                        ctx.lineCap = 'round';
                        ctx.lineJoin = 'round';
                        ctx.globalAlpha = 0.9;

                        if (feature.geometry && feature.geometry.length > 0) {
                            feature.geometry.forEach(ring => {
                                if (ring && ring.length > 1) {
                                    ctx.beginPath();
                                    ring.forEach((point, idx) => {
                                        const px = (point.x / 4096) * size.x;
                                        const py = (point.y / 4096) * size.y;

                                        if (idx === 0) {
                                            ctx.moveTo(px, py);
                                        } else {
                                            ctx.lineTo(px, py);
                                        }
                                    });
                                    ctx.stroke();
                                }
                            });
                        }
                    });
                } catch (e) {
                    console.error('Tile render error:', e);
                }

                ctx.globalAlpha = 1.0;
            },

            drawEmptyTile: function (ctx, size) {
                ctx.fillStyle = 'rgba(0, 0, 0, 0)';
                ctx.fillRect(0, 0, size.x, size.y);
            }
        });

        debugTileLayer = new GridLayer({
            maxZoom: 18,
            minZoom: 15,  // Only show at zoom 15+
            tileSize: 256
        });

        debugTileLayer.addTo(APP.map);

        setTimeout(() => {
            const debugPane = debugTileLayer.getPane();
            if (debugPane) {
                debugPane.style.zIndex = '400';
                debugPane.style.pointerEvents = 'none';
            }
        }, 50);

        // Add map-level hover handler
        mapHoverHandler = (e) => handleMapHover(e);
        APP.map.getContainer().addEventListener('mousemove', mapHoverHandler);

        createDebugLegendControl();

    } catch (error) {
        console.error('Debug visualization error:', error);
        debugMode = false;
        document.getElementById('debugToggleBtn').classList.remove('active');
    }
}

function createDebugLegendControl() {
    const LegendControl = L.Control.extend({
        options: {
            position: 'topright'
        },
        onAdd: function (map) {
            const div = L.DomUtil.create('div', 'debug-legend-card');
            div.id = 'debug-legend-card';
            // Prevent clicks from propagating to map
            L.DomEvent.disableClickPropagation(div);
            L.DomEvent.disableScrollPropagation(div);
            return div;
        }
    });

    debugLegendControl = new LegendControl();
    debugLegendControl.addTo(APP.map);

    updateDebugLegend();
}

function updateDebugLegend() {
    const legendDiv = document.getElementById('debug-legend-card');
    if (!legendDiv) return;

    const min = speedStats.min === Infinity ? 0 : speedStats.min;
    const max = speedStats.max;

    const legendHTML = `
        <div style="
            background: var(--color-surface);
            border: 1px solid var(--color-border);
            border-radius: 8px;
            padding: 12px;
            font-size: 12px;
            box-shadow: var(--shadow-md);
            min-width: 180px;
            backdrop-filter: blur(8px);
        ">
            <div style="
                margin-bottom: 8px;
                font-weight: 600;
                color: var(--color-primary);
                font-size: 11px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            ">Speed Range</div>
            
            <div style="margin-bottom: 10px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                    <span style="color: var(--color-text-secondary); font-size: 11px;">Min</span>
                    <span style="font-weight: 600; color: var(--color-text);">${min.toFixed(0)} km/h</span>
                </div>
                <div style="width: 100%; height: 24px; border-radius: 4px; background: linear-gradient(90deg, ${isDarkModeActive ? '#74FFFF, #00FFFF, #00BAFF, #0073FF, #0028FF, #5200D0, #6F116F, #CD32CD, #FF44FF, #FF3366' : '#8B0000, #FF0000, #FF4500, #FF8C00, #FFD700, #ADFF2F, #90EE90, #32CD32, #00BB00, #00CC99'}); border: 1px solid var(--color-border); box-shadow: inset 0 1px 2px rgba(0,0,0,0.1);"></div>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 6px;">
                    <span style="color: var(--color-text-secondary); font-size: 11px;">Max</span>
                    <span style="font-weight: 600; color: var(--color-text);">${max.toFixed(0)} km/h</span>
                </div>
            </div>
            
            <div style="
                border-top: 1px solid var(--color-border);
                padding-top: 8px;
                color: var(--color-text-secondary);
                font-size: 10px;
            ">
                Avg: <strong>${(speedStats.speeds.reduce((a, b) => a + b, 0) / speedStats.speeds.length).toFixed(1)} km/h</strong>
            </div>
        </div>
    `;

    legendDiv.innerHTML = legendHTML;
}

function getAdaptiveSpeedColor(speed, minSpeed, maxSpeed) {
    const range = maxSpeed - minSpeed;

    if (range === 0) {
        return isDarkModeActive ? '#0028FF' : '#ffd3b6';
    }

    const normalized = (speed - minSpeed) / range;

    // Light mode colors: red (slow) → green (fast)
    const lightColorStops = [
        { pos: 0.0, color: '#8B0000' },
        { pos: 0.11, color: '#FF0000' },
        { pos: 0.22, color: '#FF4500' },
        { pos: 0.33, color: '#FF8C00' },
        { pos: 0.44, color: '#FFD700' },
        { pos: 0.55, color: '#ADFF2F' },
        { pos: 0.66, color: '#90EE90' },
        { pos: 0.77, color: '#32CD32' },
        { pos: 0.88, color: '#00BB00' },
        { pos: 1.0, color: '#00CC99' }
    ];

    // Dark mode colors: pre-inverted so they appear correctly after dark mode filter
    const darkColorStops = [
        { pos: 0.0, color: '#74FFFF' },
        { pos: 0.11, color: '#00FFFF' },
        { pos: 0.22, color: '#00BAFF' },
        { pos: 0.33, color: '#0073FF' },
        { pos: 0.44, color: '#0028FF' },
        { pos: 0.55, color: '#5200D0' },
        { pos: 0.66, color: '#6F116F' },
        { pos: 0.77, color: '#CD32CD' },
        { pos: 0.88, color: '#FF44FF' },
        { pos: 1.0, color: '#FF3366' }
    ];

    const colorStops = isDarkModeActive ? darkColorStops : lightColorStops;

    for (let i = 0; i < colorStops.length - 1; i++) {
        if (normalized >= colorStops[i].pos && normalized <= colorStops[i + 1].pos) {
            const range = colorStops[i + 1].pos - colorStops[i].pos;
            const factor = (normalized - colorStops[i].pos) / range;
            return interpolateColor(colorStops[i].color, colorStops[i + 1].color, factor);
        }
    }

    return colorStops[colorStops.length - 1].color;
}

function interpolateColor(color1, color2, factor) {
    const c1 = parseInt(color1.substring(1), 16);
    const c2 = parseInt(color2.substring(1), 16);

    const r1 = (c1 >> 16) & 255;
    const g1 = (c1 >> 8) & 255;
    const b1 = c1 & 255;

    const r2 = (c2 >> 16) & 255;
    const g2 = (c2 >> 8) & 255;
    const b2 = c2 & 255;

    const r = Math.round(r1 + (r2 - r1) * factor);
    const g = Math.round(g1 + (g2 - g1) * factor);
    const b = Math.round(b1 + (b2 - b1) * factor);

    return '#' + [r, g, b].map(x => {
        const hex = x.toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    }).join('');
}

function removeDebugVisualization() {
    if (debugTileLayer) {
        if (APP.map) APP.map.removeLayer(debugTileLayer);
        debugTileLayer = null;
    }
    if (debugLegendControl) {
        if (APP.map) APP.map.removeControl(debugLegendControl);
        debugLegendControl = null;
    }
    if (mapHoverHandler && APP.map) {
        APP.map.getContainer().removeEventListener('mousemove', mapHoverHandler);
        mapHoverHandler = null;
    }
    hideDebugTooltip();
    speedStats = { min: Infinity, max: 0, speeds: [] };
}

function handleMapHover(e) {
    if (!debugTileLayer || APP.map.getZoom() < 15) {
        hideDebugTooltip();
        return;
    }

    const debugPane = debugTileLayer.getPane();
    if (!debugPane) return;

    const canvases = debugPane.querySelectorAll('canvas');
    let closestFeature = null;
    let minDist = 10;

    canvases.forEach(canvas => {
        if (!canvas._debugFeatures) return;

        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (x < 0 || y < 0 || x > canvas.width || y > canvas.height) return;

        canvas._debugFeatures.forEach(feature => {
            if (feature.geometry && feature.geometry.length > 0) {
                feature.geometry.forEach(ring => {
                    for (let i = 0; i < ring.length - 1; i++) {
                        const p1 = ring[i];
                        const p2 = ring[i + 1];
                        const px1 = (p1.x / 4096) * canvas.width;
                        const py1 = (p1.y / 4096) * canvas.height;
                        const px2 = (p2.x / 4096) * canvas.width;
                        const py2 = (p2.y / 4096) * canvas.height;

                        const dist = distanceToSegment(x, y, px1, py1, px2, py2);
                        if (dist < minDist) {
                            minDist = dist;
                            closestFeature = feature;
                        }
                    }
                });
            }
        });
    });

    if (closestFeature) {
        showDebugTooltip(e.clientX, e.clientY, closestFeature.speed);
    } else {
        hideDebugTooltip();
    }
}

function distanceToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);

    let t = ((px - x1) * dx + (py - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));

    const nearX = x1 + t * dx;
    const nearY = y1 + t * dy;

    return Math.sqrt((px - nearX) ** 2 + (py - nearY) ** 2);
}

function showDebugTooltip(x, y, speed) {
    if (!debugTooltip) {
        debugTooltip = document.createElement('div');
        debugTooltip.style.cssText = `
            position: fixed;
            background: var(--color-surface);
            border: 1px solid var(--color-border);
            border-radius: 6px;
            padding: 8px 12px;
            font-size: 12px;
            color: var(--color-text);
            pointer-events: none;
            z-index: 10000;
            box-shadow: var(--shadow-md);
            backdrop-filter: blur(8px);
        `;
        document.body.appendChild(debugTooltip);
    }

    debugTooltip.innerHTML = `<div style="font-weight: 600;">${speed.toFixed(0)} km/h</div>`;
    debugTooltip.style.left = (x + 10) + 'px';
    debugTooltip.style.top = (y - 30) + 'px';
    debugTooltip.style.display = 'block';
}

function hideDebugTooltip() {
    if (debugTooltip) {
        debugTooltip.style.display = 'none';
    }
}
