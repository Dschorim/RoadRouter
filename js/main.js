// ==================== APP STATE (exported) ====================
export const APP = {
    map: null,
    routeLayer: null,
    markerLayer: null,
    routePoints: [],
    nextPointId: 1,
    currentRoute: null,
    calculateRouteTimer: null,
    previewRouteTimer: null,
    contextMenuOpen: false,
    activeInputPointId: null,
    draggedElement: null,
    isPolylineMouseDown: false,
    waypointBeingDragged: null,
    mapMarkers: {},
    currentPolyline: null,
    routePolylineMouseDown: false,
    routeMouseMoveHandler: null,
    routeMouseUpHandler: null,
    isDraggingMarker: false,
    draggedMarkerStartPos: null,
    lastPreviewTime: 0,
    routeClickJustHappened: false,
    lastFocusedInputId: null,
    attachedAutocompleteInputs: new Set()
};

import { attachAutocompleteToInput } from './modules/autocomplete.js';
import { reverseGeocodeWithRateLimit } from './geocoding.js';
import { formatDistance, formatDuration } from './utils.js';
import CONFIG from './config.js';


// ==================== DEBUG MODE WITH OSRM TILE SERVICE ====================
let debugMode = false;
let debugTileLayer = null;
let speedStats = { min: Infinity, max: 0, speeds: [] };
let debugLegendControl = null;

function toggleDebugMode() {
    if (!CONFIG.ENABLE_DEBUG_MODE) return;
    
    debugMode = !debugMode;
    const btn = document.getElementById('debugToggleBtn');
    
    if (debugMode) {
        btn.classList.add('active');
        speedStats = { min: Infinity, max: 0, speeds: [] };
        loadDebugVisualization();
        updateRouteStyle();
    } else {
        btn.classList.remove('active');
        removeDebugVisualization();
        updateRouteStyle();
    }
}

function loadDebugVisualization() {
    try {
        const GridLayer = L.GridLayer.extend({
            createTile: function(coords) {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                const size = this.getTileSize();
                canvas.width = size.x;
                canvas.height = size.y;
                
                const z = coords.z;
                const x = coords.x;
                const y = coords.y;
                
                this.fetchAndRenderTile(ctx, x, y, z, size);
                
                return canvas;
            },
            
            fetchAndRenderTile: function(ctx, x, y, z, size) {
                const url = `${CONFIG.OSRMAPI}/tile/v1/driving/tile(${x},${y},${z}).mvt`;
                
                fetch(url)
                    .then(r => {
                        if (!r.ok) {
                            this.drawEmptyTile(ctx, size);
                            return null;
                        }
                        return r.arrayBuffer();
                    })
                    .then(buffer => {
                        if (!buffer) return;
                        
                        try {
                            this.renderTile(ctx, buffer, size, z);
                        } catch (e) {
                            console.error('Tile render error:', e);
                            this.drawEmptyTile(ctx, size);
                        }
                    })
                    .catch(() => {
                        this.drawEmptyTile(ctx, size);
                    });
            },
            
            renderTile: function(ctx, buffer, size, z) {
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
            
            drawEmptyTile: function(ctx, size) {
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
        onAdd: function(map) {
            const div = L.DomUtil.create('div', 'debug-legend-card');
            div.id = 'debug-legend-card';
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
                <div style="width: 100%; height: 24px; border-radius: 4px; background: linear-gradient(90deg, #8B0000, #FF0000, #FF4500, #FF8C00, #FFD700, #ADFF2F, #90EE90, #32CD32, #00BB00, #00CC99); border: 1px solid var(--color-border); box-shadow: inset 0 1px 2px rgba(0,0,0,0.1);"></div>
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
                <div>Total segments: <strong>${speedStats.speeds.length}</strong></div>
                <div style="margin-top: 4px;">
                    Avg: <strong>${(speedStats.speeds.reduce((a,b) => a+b, 0) / speedStats.speeds.length).toFixed(1)} km/h</strong>
                </div>
            </div>
        </div>
    `;
    
    legendDiv.innerHTML = legendHTML;
}

function getAdaptiveSpeedColor(speed, minSpeed, maxSpeed) {
    const range = maxSpeed - minSpeed;
    
    if (range === 0) {
        return '#ffd3b6';
    }
    
    const normalized = (speed - minSpeed) / range;
    
    const colorStops = [
        { pos: 0.0,  color: '#8B0000' },
        { pos: 0.11, color: '#FF0000' },
        { pos: 0.22, color: '#FF4500' },
        { pos: 0.33, color: '#FF8C00' },
        { pos: 0.44, color: '#FFD700' },
        { pos: 0.55, color: '#ADFF2F' },
        { pos: 0.66, color: '#90EE90' },
        { pos: 0.77, color: '#32CD32' },
        { pos: 0.88, color: '#00BB00' },
        { pos: 1.0,  color: '#00CC99' }
    ];
    
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

function getSpeedColor(speed) {
    if (speed >= 120) return '#0099ff';
    if (speed >= 100) return '#32b8c6';
    if (speed >= 60) return '#a8e6cf';
    if (speed >= 40) return '#ffd3b6';
    if (speed >= 20) return '#ff6b7a';
    return '#ff0000';
}

function parseMVTTile(arrayBuffer) {
    const view = new Uint8Array(arrayBuffer);
    const features = [];
    
    try {
        let pos = 0;
        
        while (pos < view.length) {
            const byte = view[pos];
            const fieldNum = byte >> 3;
            const wireType = byte & 0x07;
            pos++;
            
            if (fieldNum === 3 && wireType === 2) {
                const [len, lenSize] = readVarIntInfo(view, pos);
                pos += lenSize;
                
                const layerEnd = pos + len;
                const layer = decodePBFLayer(view, pos, layerEnd);
                
                if (layer.name === 'speeds' && layer.features) {
                    layer.features.forEach((feature, fIdx) => {
                        const props = {};
                        
                        if (feature.tags && layer.keys && layer.values) {
                            for (let i = 0; i < feature.tags.length; i += 2) {
                                const keyIdx = feature.tags[i];
                                const valIdx = feature.tags[i + 1];
                                
                                if (layer.keys[keyIdx] !== undefined && layer.values[valIdx] !== undefined) {
                                    const key = layer.keys[keyIdx];
                                    const val = layer.values[valIdx];
                                    props[key] = val;
                                }
                            }
                        }
                        
                        let speedValue = 0;
                        if (props.speed !== undefined) {
                            speedValue = typeof props.speed === 'number' ? Math.round(props.speed) : parseInt(props.speed) || 0;
                        }
                        
                        features.push({
                            speed: speedValue,
                            geometry: decodeGeometry(feature.geometry || []),
                            properties: props
                        });
                    });
                }
                
                pos = layerEnd;
            } else if (wireType === 0) {
                pos = skipVarInt(view, pos);
            } else if (wireType === 2) {
                const [len, lenSize] = readVarIntInfo(view, pos);
                pos += lenSize + len;
            } else {
                pos++;
            }
        }
    } catch (e) {
        console.error('MVT parse error:', e);
    }
    
    return features;
}

function decodePBFLayer(view, start, end) {
    const layer = {
        name: '',
        keys: [],
        values: [],
        features: []
    };
    
    let pos = start;
    
    try {
        while (pos < end) {
            const byte = view[pos];
            const fieldNum = byte >> 3;
            const wireType = byte & 0x07;
            pos++;
            
            if (fieldNum === 1 && wireType === 2) {
                const [len, lenSize] = readVarIntInfo(view, pos);
                pos += lenSize;
                layer.name = new TextDecoder().decode(view.slice(pos, pos + len));
                pos += len;
            } else if (fieldNum === 2 && wireType === 2) {
                const [len, lenSize] = readVarIntInfo(view, pos);
                pos += lenSize;
                
                const featureEnd = pos + len;
                const feature = decodePBFFeature(view, pos, featureEnd);
                layer.features.push(feature);
                pos = featureEnd;
            } else if (fieldNum === 3 && wireType === 2) {
                const [len, lenSize] = readVarIntInfo(view, pos);
                pos += lenSize;
                const key = new TextDecoder().decode(view.slice(pos, pos + len));
                layer.keys.push(key);
                pos += len;
            } else if (fieldNum === 4 && wireType === 2) {
                const [len, lenSize] = readVarIntInfo(view, pos);
                pos += lenSize;
                const valStart = pos;
                pos += len;
                
                const value = decodeTileValue(view.slice(valStart, pos));
                layer.values.push(value);
            } else if (wireType === 0) {
                pos = skipVarInt(view, pos);
            } else if (wireType === 2) {
                const [len, lenSize] = readVarIntInfo(view, pos);
                pos += lenSize + len;
            } else {
                pos++;
            }
        }
    } catch (e) {
        console.error('Layer decode error:', e);
    }
    
    return layer;
}

function decodeTileValue(view) {
    if (view.length === 0) return '';
    
    let pos = 0;
    const byte = view[pos];
    const fieldNum = byte >> 3;
    const wireType = byte & 0x07;
    pos++;
    
    try {
        if (wireType === 0) {
            const [val] = readVarIntInfo(view, pos);
            return val;
        } else if (wireType === 1) {
            const dv = new DataView(view.buffer, view.byteOffset + pos, 8);
            return dv.getFloat64(0, true);
        } else if (wireType === 2) {
            const [len, lenSize] = readVarIntInfo(view, pos);
            pos += lenSize;
            try {
                return new TextDecoder().decode(view.slice(pos, pos + len));
            } catch (e) {
                return '';
            }
        } else if (wireType === 5) {
            const dv = new DataView(view.buffer, view.byteOffset + pos, 4);
            return dv.getFloat32(0, true);
        }
    } catch (e) {
        console.error('Value decode error:', e);
    }
    
    return '';
}

function decodePBFFeature(view, start, end) {
    const feature = {
        id: 0,
        tags: [],
        geometry: [],
        type: 1
    };
    
    let pos = start;
    
    try {
        while (pos < end) {
            const byte = view[pos];
            const fieldNum = byte >> 3;
            const wireType = byte & 0x07;
            pos++;
            
            if (fieldNum === 1 && wireType === 0) {
                const [val, size] = readVarIntInfo(view, pos);
                feature.id = val;
                pos += size;
            } else if (fieldNum === 2 && wireType === 2) {
                const [len, lenSize] = readVarIntInfo(view, pos);
                pos += lenSize;
                
                const tagEnd = pos + len;
                while (pos < tagEnd) {
                    const [val, size] = readVarIntInfo(view, pos);
                    feature.tags.push(val);
                    pos += size;
                }
            } else if (fieldNum === 3 && wireType === 0) {
                const [val, size] = readVarIntInfo(view, pos);
                feature.type = val;
                pos += size;
            } else if (fieldNum === 4 && wireType === 2) {
                const [len, lenSize] = readVarIntInfo(view, pos);
                pos += lenSize;
                
                const geoEnd = pos + len;
                while (pos < geoEnd) {
                    const [val, size] = readVarIntInfo(view, pos);
                    feature.geometry.push(val);
                    pos += size;
                }
            } else if (wireType === 0) {
                pos = skipVarInt(view, pos);
            } else if (wireType === 2) {
                const [len, lenSize] = readVarIntInfo(view, pos);
                pos += lenSize + len;
            } else {
                pos++;
            }
        }
    } catch (e) {
        console.error('Feature decode error:', e);
    }
    
    return feature;
}

function decodeGeometry(geometry) {
    const rings = [];
    let x = 0, y = 0;
    let ring = [];
    let i = 0;
    
    while (i < geometry.length) {
        const cmd = geometry[i] & 0x07;
        const count = geometry[i] >> 3;
        i++;
        
        if (cmd === 1) {
            for (let j = 0; j < count && i < geometry.length; j++) {
                const dx = zigzagDecode(geometry[i++]);
                const dy = i < geometry.length ? zigzagDecode(geometry[i++]) : 0;
                x += dx;
                y += dy;
                ring.push({ x, y });
            }
        } else if (cmd === 2) {
            for (let j = 0; j < count && i < geometry.length; j++) {
                const dx = zigzagDecode(geometry[i++]);
                const dy = i < geometry.length ? zigzagDecode(geometry[i++]) : 0;
                x += dx;
                y += dy;
                ring.push({ x, y });
            }
        } else if (cmd === 7) {
            if (ring.length > 0) {
                rings.push(ring);
                ring = [];
            }
        }
    }
    
    if (ring.length > 0) {
        rings.push(ring);
    }
    
    return rings;
}

function readVarIntInfo(view, pos) {
    let value = 0;
    let shift = 0;
    let size = 0;
    while (pos < view.length && view[pos] >= 0x80) {
        value |= (view[pos] & 0x7f) << shift;
        shift += 7;
        pos++;
        size++;
    }
    if (pos < view.length) {
        value |= view[pos] << shift;
        size++;
    }
    return [value, size];
}

function skipVarInt(view, pos) {
    while (pos < view.length && view[pos] >= 0x80) pos++;
    return pos + 1;
}

function zigzagDecode(n) {
    return (n >> 1) ^ -(n & 1);
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
    speedStats = { min: Infinity, max: 0, speeds: [] };
}

function updateRouteStyle() {
    if (!APP.routeLayer) return;
    
    APP.routeLayer.eachLayer(layer => {
        if (layer.setStyle) {
            if (debugMode) {
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



// ==================== DEBOUNCE ====================

function debouncedCalculateRoute() {
    clearTimeout(APP.calculateRouteTimer);
    APP.calculateRouteTimer = setTimeout(calculateRoute, 500);
}

debouncedCalculateRoute.cancel = function() {
    clearTimeout(APP.calculateRouteTimer);
};

function throttledPreviewRouteCalculation() {
    const now = Date.now();
    if (now - APP.lastPreviewTime >= 500) {
        APP.lastPreviewTime = now;
        calculateRoute();
    }
}

// ==================== HELPER FUNCTIONS ====================

function updatePointTypes() {
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

function removePoint(id) {
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
    debouncedCalculateRoute();
}

function updatePointAddress(id, newAddress, newLat, newLng) {
    const point = APP.routePoints.find(p => p.id === id);
    if (point) {
        point.address = newAddress;
        if (newLat !== undefined && newLng !== undefined) {
            point.lat = newLat;
            point.lng = newLng;
        }
    }
}

function addPoint(lat, lng, address) {
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
    debouncedCalculateRoute();
}

async function calculateRoute() {
    const validPoints = APP.routePoints.filter(p => p.lat !== null && p.lng !== null);
    
    if (validPoints.length < 2) {
        APP.routeLayer.clearLayers();
        APP.currentPolyline = null;
        document.getElementById('routeInfo').innerHTML = '';
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
        
        routePolyline.on('mousedown', (e) => {
            if (e.originalEvent.button !== 0) return;
            
            APP.routeClickJustHappened = true;
            setTimeout(() => { APP.routeClickJustHappened = false; }, 150);
            
            const latlng = e.latlng;
            const clickPoint = { lat: latlng.lat, lng: latlng.lng };
            let closestSegmentIndex = 0;
            let minDistance = Infinity;
            let polylinePoints = [];
            
            const geoJSONLayers = APP.currentPolyline && APP.currentPolyline._layers ? APP.currentPolyline._layers : {};
            for (let layerId in geoJSONLayers) {
                const layer = geoJSONLayers[layerId];
                if (layer.getLatLngs && typeof layer.getLatLngs === 'function') {
                    polylinePoints = layer.getLatLngs();
                    
                    for (let i = 0; i < polylinePoints.length - 1; i++) {
                        const dist = distanceToLineSegment(clickPoint, polylinePoints[i], polylinePoints[i + 1]);
                        if (dist < minDistance) {
                            minDistance = dist;
                            closestSegmentIndex = i;
                        }
                    }
                }
            }
            
            const validIndices = [];
            APP.routePoints.forEach((p, idx) => {
                if (p.lat !== null && p.lng !== null) {
                    validIndices.push(idx);
                }
            });
            
            let closestWaypointIndex = 0;
            let closestWaypointDist = Infinity;
            
            for (let i = 0; i < validIndices.length; i++) {
                const routeIdx = validIndices[i];
                const routePt = APP.routePoints[routeIdx];
                const dist = Math.sqrt(
                    Math.pow(routePt.lng - clickPoint.lng, 2) + 
                    Math.pow(routePt.lat - clickPoint.lat, 2)
                );
                
                if (dist < closestWaypointDist) {
                    closestWaypointDist = dist;
                    closestWaypointIndex = i;
                }
            }
            
            if (closestWaypointIndex < validIndices.length - 1) {
                const nextRoutePt = APP.routePoints[validIndices[closestWaypointIndex + 1]];
                const nextDist = Math.sqrt(
                    Math.pow(nextRoutePt.lng - clickPoint.lng, 2) + 
                    Math.pow(nextRoutePt.lat - clickPoint.lat, 2)
                );
                
                if (nextDist < closestWaypointDist) {
                    closestWaypointIndex++;
                }
            }
            
            let insertIndex;
            if (closestWaypointIndex === 0) {
                insertIndex = 1;
            } else {
                insertIndex = validIndices[closestWaypointIndex];
            }
            
            const newPoint = {
                id: APP.nextPointId++,
                lat: parseFloat(latlng.lat.toFixed(4)),
                lng: parseFloat(latlng.lng.toFixed(4)),
                address: 'Locating...',
                type: 'waypoint'
            };
            
            APP.routePoints.splice(insertIndex, 0, newPoint);
            updatePointTypes();
            renderRoutePoints();
            updateMapMarkers();
            debouncedCalculateRoute();
            
            APP.waypointBeingDragged = newPoint.id;
            APP.routePolylineMouseDown = true;
            APP.isPolylineMouseDown = true;
            APP.map.dragging.disable();
            APP.map._container.classList.add('dragging-disabled');
            
            e.originalEvent.stopPropagation();
            e.originalEvent.stopImmediatePropagation();
            
            reverseGeocodeWithRateLimit(latlng.lat, latlng.lng).then((address) => {
                newPoint.address = address;
                const input = document.getElementById(`input-${newPoint.id}`);
                if (input) input.value = address;
                renderRoutePoints();
            });
        });
        
        APP.routeMouseMoveHandler = (e) => {
            if (!APP.routePolylineMouseDown) return;
            
            if (APP.waypointBeingDragged !== null) {
                const point = APP.routePoints.find(p => p.id === APP.waypointBeingDragged);
                if (point && APP.mapMarkers[point.id] && e.latlng) {
                    const latlng = e.latlng;
                    if (latlng && latlng.lat && latlng.lng && !isNaN(latlng.lat) && !isNaN(latlng.lng)) {
                        point.lat = parseFloat(latlng.lat.toFixed(4));
                        point.lng = parseFloat(latlng.lng.toFixed(4));
                        
                        APP.mapMarkers[point.id].setLatLng([point.lat, point.lng]);
                        throttledPreviewRouteCalculation();
                        APP.map._container.classList.add('dragging-route');
                    }
                }
            }
        };

        APP.routeMouseUpHandler = (e) => {
            if (!APP.routePolylineMouseDown) return;
            
            APP.routePolylineMouseDown = false;
            APP.isPolylineMouseDown = false;
            APP.map._container.classList.remove('dragging-route');
            APP.map._container.classList.remove('dragging-disabled');
            APP.map.dragging.enable();  // RE-ENABLE MAP DRAGGING HERE!
            
            if (APP.waypointBeingDragged !== null) {
                const point = APP.routePoints.find(p => p.id === APP.waypointBeingDragged);
                if (point) {
                    reverseGeocodeWithRateLimit(point.lat, point.lng).then((address) => {
                        point.address = address;
                        updatePointAddress(APP.waypointBeingDragged, address, point.lat, point.lng);
                        const input = document.getElementById(`input-${APP.waypointBeingDragged}`);
                        if (input) input.value = address;
                        renderRoutePoints();
                        calculateRoute();
                    });
                }
                APP.waypointBeingDragged = null;
            }
        };

        APP.map.on('mousemove', APP.routeMouseMoveHandler || routeMouseMoveHandler);
        APP.map.on('mouseup', APP.routeMouseUpHandler || routeMouseUpHandler);

        const distance = APP.currentRoute.distance;
        const duration = APP.currentRoute.duration;
        document.getElementById('routeInfo').innerHTML = `
            <div class="route-info">
                <h3>Route ${debugMode ? '(Debug Mode)' : 'Ready'}</h3>
                <div class="route-stats">
                    <div class="stat">
                        <span class="stat-label">Distance</span>
                        <span class="stat-value">${formatDistance(distance)}</span>
                    </div>
                    <div class="stat">
                        <span class="stat-label">Duration</span>
                        <span class="stat-value">${formatDuration(duration)}</span>
                    </div>
                </div>
                <div class="route-actions" style="margin-top:12px; display:flex; gap:8px;">
                    <button id="exportGpxBtn" class="btn btn-primary">Export GPX</button>
                </div>
            </div>
        `;

        // wire buttons
        const gpxBtn = document.getElementById('exportGpxBtn');
        if (gpxBtn) gpxBtn.addEventListener('click', () => exportGPX());

        if (debugMode) {
            // Debug mode is handled by the tile layer
        }
    } catch (error) {
        console.error('Route calculation failed:', error);
    }
}

function distanceToLineSegment(point, lineStart, lineEnd) {
    const dx = lineEnd.lng - lineStart.lng;
    const dy = lineEnd.lat - lineStart.lat;
    let t = ((point.lng - lineStart.lng) * dx + (point.lat - lineStart.lat) * dy) / (dx * dx + dy * dy);
    t = Math.max(0, Math.min(1, t));
    
    const closestX = lineStart.lng + t * dx;
    const closestY = lineStart.lat + t * dy;
    
    const ddx = point.lng - closestX;
    const ddy = point.lat - closestY;
    
    return Math.sqrt(ddx * ddx + ddy * ddy);
}

// ==================== GPX EXPORT HELPERS ====================

function escapeXml(unsafe) {
    if (!unsafe) return '';
    return String(unsafe).replace(/[&<>\"']/g, (c) => {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c];
    });
}

function generateGPX(name = 'Route') {
    const date = new Date().toISOString();
    let coords = [];
    if (APP.currentRoute && APP.currentRoute.geometry && Array.isArray(APP.currentRoute.geometry.coordinates)) {
        coords = APP.currentRoute.geometry.coordinates;
    } else {
        coords = APP.routePoints.filter(p => p.lat !== null && p.lng !== null).map(p => [p.lng, p.lat]);
    }

    const trkpts = coords.map(([lon, lat]) => `        <trkpt lat="${lat}" lon="${lon}"/>`).join('\n');
    // Note: Avoid multiple <wpt> entries to prevent some importers from showing multiple import options.
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Route Planner" xmlns="http://www.topografix.com/GPX/1/1">\n  <metadata>\n    <name>${escapeXml(name)}</name>\n    <time>${date}</time>\n  </metadata>\n  <trk>\n    <name>${escapeXml(name)}</name>\n    <trkseg>\n${trkpts}\n    </trkseg>\n  </trk>\n</gpx>`;

    return gpx;
}

function exportGPX(filename = 'route.gpx') {
    // generate coords and ensure there is something to export
    const coordsExist = (APP.currentRoute && APP.currentRoute.geometry && Array.isArray(APP.currentRoute.geometry.coordinates) && APP.currentRoute.geometry.coordinates.length > 0) ||
        (APP.routePoints && APP.routePoints.some(p => p.lat !== null && p.lng !== null));
    if (!coordsExist) {
        alert('No route or coordinates available to export.');
        return;
    }

    const gpx = generateGPX('Route');
    const blob = new Blob([gpx], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}





function updateMapMarkers() {
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
            throttledPreviewRouteCalculation();
        });

        marker.on('dragend', (e) => {
            APP.isDraggingMarker = false;
            APP.map.dragging.enable();  // RE-ENABLE MAP DRAGGING HERE TOO!
            const pos = e.target.getLatLng();
            const lat = parseFloat(pos.lat.toFixed(4));
            const lng = parseFloat(pos.lng.toFixed(4));
            reverseGeocodeWithRateLimit(lat, lng).then((address) => {
                updatePointAddress(point.id, address, lat, lng);
                const input = document.getElementById(`input-${point.id}`);
                if (input) input.value = address;
                renderRoutePoints();
                calculateRoute();
            });
        });
    });
}

function isClickOnRoute(latlng) {
    if (!APP.currentPolyline) {
        return false;
    }
    
    const clickPoint = { lat: latlng.lat, lng: latlng.lng };
    const tolerance = 0.00005;
    
    const geoJSONLayers = APP.currentPolyline._layers;
    
    for (let layerId in geoJSONLayers) {
        const layer = geoJSONLayers[layerId];
        
        if (layer.getLatLngs && typeof layer.getLatLngs === 'function') {
            const latlngs = layer.getLatLngs();
            
            if (latlngs && latlngs.length > 0) {
                for (let i = 0; i < latlngs.length - 1; i++) {
                    const dist = distanceToLineSegment(
                        clickPoint,
                        latlngs[i],
                        latlngs[i + 1]
                    );
                    
                    if (dist < tolerance) {
                        return true;
                    }
                }
            }
        }
    }
    return false;
}

function handleRightClick(e) {
    // Handle both Leaflet events and DOM events
    if (e.originalEvent && e.originalEvent.preventDefault) {
        e.originalEvent.preventDefault();
    } else if (e.preventDefault) {
        e.preventDefault();
    }
    
    const latlng = e.latlng;
    if (!latlng) return;
    
    let clickedOnRoute = false;
    if (APP.currentPolyline) {
        const geoJSONLayers = APP.currentPolyline._layers || {};
        for (let layerId in geoJSONLayers) {
            const layer = geoJSONLayers[layerId];
            if (layer.setStyle) {
                const bounds = layer.getBounds();
                if (bounds.contains(latlng)) {
                    clickedOnRoute = true;
                    break;
                }
            }
        }
    }
    
    if (clickedOnRoute) return;
    
    const contextMenu = document.getElementById('contextMenu');
    contextMenu.innerHTML = `
        <div class="context-menu-item" onclick="addPointAsStart(${latlng.lat}, ${latlng.lng})">Set as Start</div>
        <div class="context-menu-item" onclick="addPointAsDestination(${latlng.lat}, ${latlng.lng})">Set as Destination</div>
        <div class="context-menu-item" onclick="addPointAsWaypoint(${latlng.lat}, ${latlng.lng})">Add as Waypoint</div>
    `;
    
    contextMenu.style.left = e.originalEvent.clientX + 'px';
    contextMenu.style.top = e.originalEvent.clientY + 'px';
    contextMenu.classList.add('active');
    APP.contextMenuOpen = true;
}

function addPointAsStart(lat, lng) {
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
        debouncedCalculateRoute();
        document.getElementById('contextMenu').classList.remove('active');
        APP.contextMenuOpen = false;
        showRouteContent();
    });
}

function addPointAsDestination(lat, lng) {
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
        debouncedCalculateRoute();
        document.getElementById('contextMenu').classList.remove('active');
        APP.contextMenuOpen = false;
    });
}

function addPointAsWaypoint(lat, lng) {
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
        debouncedCalculateRoute();
        document.getElementById('contextMenu').classList.remove('active');
        APP.contextMenuOpen = false;
    });
}

function handleMapClick(latlng) {
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
            debouncedCalculateRoute();
            
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
        debouncedCalculateRoute();
        
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
        debouncedCalculateRoute();
        
        reverseGeocodeWithRateLimit(lat, lng).then((address) => {
            newDest.address = address;
            renderRoutePoints();
        });
    }
}

// ==================== UI FUNCTIONS ====================

function showRouteContent() {
    document.getElementById('initialSearch').style.display = 'none';
    document.getElementById('routeContent').style.display = 'block';
}

function hideRouteContent() {
    document.getElementById('initialSearch').style.display = 'block';
    document.getElementById('routeContent').style.display = 'none';
}

function renderRoutePoints() {
    const container = document.getElementById('routePointsList');
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
                    debouncedCalculateRoute();
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
        });

        div.addEventListener('drop', (e) => {
            e.preventDefault();
            if (!APP.draggedElement || APP.draggedElement === div) return;

            const fromIndex = APP.routePoints.findIndex(p => p.id == APP.draggedElement.dataset.id);
            const toIndex = APP.routePoints.findIndex(p => p.id == div.dataset.id);

            if (fromIndex !== -1 && toIndex !== -1) {
                const [removed] = APP.routePoints.splice(fromIndex, 1);
                APP.routePoints.splice(toIndex, 0, removed);
                updatePointTypes();
                renderRoutePoints();
                updateMapMarkers();
                debouncedCalculateRoute();
            }
        });

        div.addEventListener('dragend', () => {
            APP.draggedElement = null;
        });
    });
}

function addNewWaypoint() {
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

// ==================== INITIALIZATION ====================

function initMap() {
    APP.map = L.map('map').setView(CONFIG.MAPCENTER, CONFIG.MAPZOOM);
    APP.routeLayer = L.featureGroup().addTo(APP.map);
    APP.markerLayer = L.featureGroup().addTo(APP.map);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
    }).addTo(APP.map);

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((pos) => {
            const { latitude, longitude } = pos.coords;
            APP.map.setView([latitude, longitude], 12);
        }, (error) => {
            // Geolocation not available in this browser or permission denied
        });
    }

    const debugBtn = document.getElementById('debugToggleBtn');
    if (debugBtn && CONFIG.ENABLE_DEBUG_MODE) {
        debugBtn.addEventListener('click', toggleDebugMode);
    }

    APP.map.on('click', (e) => {
        if (!APP.routePolylineMouseDown && !APP.isDraggingMarker) {
            handleMapClick(e.latlng);
        }
    });

    APP.map.on('contextmenu', handleRightClick);

    document.addEventListener('click', (e) => {
        if (!e.target.closest('#contextMenu')) {
            document.getElementById('contextMenu').classList.remove('active');
            APP.contextMenuOpen = false;
        }
    });
}

// ========== AUTOCOMPLETE HELPERS ==========








function initializeSearchUI() {
    const searchInput = document.getElementById('initialSearchInput');

    APP.routePoints = [
        { id: APP.nextPointId++, lat: null, lng: null, address: '', type: 'start' },
        { id: APP.nextPointId++, lat: null, lng: null, address: '', type: 'dest' }
    ];

    // Attach autocomplete to initial search input
    attachAutocompleteToInput(searchInput, 'initial', {
        onSelect: ({ display, lat, lon }) => {
            // update first point (start) with selected location
            if (!APP.routePoints || APP.routePoints.length === 0) {
                APP.routePoints = [ { id: APP.nextPointId++, lat: lat, lng: lon, address: display, type: 'start' } ];
            } else {
                APP.routePoints[0].lat = lat;
                APP.routePoints[0].lng = lon;
                APP.routePoints[0].address = display;
            }

            searchInput.value = display;
            renderRoutePoints();
            updateMapMarkers();
            debouncedCalculateRoute();
            showRouteContent();
        }
    });
    searchInput.dataset.autocompleteAttached = '1';

    renderRoutePoints();
}

// expose functions used by inline HTML/onclicks
window.removePoint = removePoint;
window.addNewWaypoint = addNewWaypoint;
window.addPointAsStart = addPointAsStart;
window.addPointAsDestination = addPointAsDestination;
window.addPointAsWaypoint = addPointAsWaypoint;
// Expose export helpers for debugging / quick access
window.exportGPX = exportGPX;


document.addEventListener('DOMContentLoaded', () => {
    initializeSearchUI();
    initMap();
});