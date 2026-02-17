import { formatDistance, formatDuration, haversineDistance } from '../utils.js';
import { getElevations } from '../elevation.js';
import { APP } from './state.js';
import { createOrUpdateRoutePreview, removeRoutePreview } from './ui.js';
import { fetchOSMData, matchOSMDataToRoute, HIGHWAY_LABELS, SURFACE_LABELS, SMOOTHNESS_LABELS } from '../osm_data.js';

// Current coloring mode
let coloringMode = 'gradient'; // 'gradient', 'highway', 'surface', 'smoothness'
let osmAttributes = null;
let osmFetchTimeout = null;
let currentRouteId = 0;

// Color Palettes for OSM attributes
const PALETTES = {
    highway: {
        motorway: { fill: 'rgba(230, 100, 100, 0.35)', stroke: '#E64444' },
        trunk: { fill: 'rgba(250, 150, 100, 0.35)', stroke: '#FA9664' },
        primary: { fill: 'rgba(255, 200, 100, 0.35)', stroke: '#FFC864' },
        secondary: { fill: 'rgba(255, 230, 120, 0.35)', stroke: '#FFE678' },
        tertiary: { fill: 'rgba(255, 255, 180, 0.35)', stroke: '#FFFFB4' },
        residential: { fill: 'rgba(200, 200, 200, 0.35)', stroke: '#C8C8C8' },
        service: { fill: 'rgba(180, 180, 180, 0.35)', stroke: '#B4B4B4' },
        track: { fill: 'rgba(200, 150, 100, 0.35)', stroke: '#C89664' },
        path: { fill: 'rgba(150, 200, 150, 0.35)', stroke: '#96C896' },
        cycleway: { fill: 'rgba(100, 150, 255, 0.35)', stroke: '#6496FF' },
        footway: { fill: 'rgba(255, 150, 200, 0.35)', stroke: '#FF96C8' },
        unknown: { fill: 'rgba(150, 150, 150, 0.35)', stroke: '#969696' }
    },
    surface: {
        asphalt: { fill: 'rgba(100, 100, 100, 0.35)', stroke: '#646464' },
        concrete: { fill: 'rgba(180, 180, 180, 0.35)', stroke: '#B4B4B4' },
        paved: { fill: 'rgba(120, 120, 120, 0.35)', stroke: '#787878' },
        paving_stones: { fill: 'rgba(200, 180, 160, 0.35)', stroke: '#C8B4A0' },
        cobblestone: { fill: 'rgba(180, 160, 140, 0.35)', stroke: '#B4A08C' },
        gravel: { fill: 'rgba(200, 180, 140, 0.35)', stroke: '#C8B48C' },
        dirt: { fill: 'rgba(180, 140, 100, 0.35)', stroke: '#B48C64' },
        grass: { fill: 'rgba(120, 200, 120, 0.35)', stroke: '#78C878' },
        sand: { fill: 'rgba(240, 220, 180, 0.35)', stroke: '#F0DCB4' },
        unknown: { fill: 'rgba(150, 150, 150, 0.35)', stroke: '#969696' }
    },
    smoothness: {
        excellent: { fill: 'rgba(100, 255, 100, 0.35)', stroke: '#64FF64' },
        good: { fill: 'rgba(150, 255, 150, 0.35)', stroke: '#96FF96' },
        intermediate: { fill: 'rgba(255, 255, 150, 0.35)', stroke: '#FFFF96' },
        bad: { fill: 'rgba(255, 200, 100, 0.35)', stroke: '#FFC864' },
        very_bad: { fill: 'rgba(255, 150, 100, 0.35)', stroke: '#FF9664' },
        horrible: { fill: 'rgba(255, 100, 100, 0.35)', stroke: '#FF6464' },
        very_horrible: { fill: 'rgba(200, 50, 50, 0.35)', stroke: '#C83232' },
        unknown: { fill: 'rgba(150, 150, 150, 0.35)', stroke: '#969696' }
    }
};

// Sample route coordinates progressively - start coarse, refine over time
function sampleRouteCoordinates(coords, intervalMeters = 10) {
    if (!coords || coords.length === 0) return [];
    const samples = [];

    let acc = 0;
    for (let i = 0; i < coords.length - 1; i++) {
        const [lon1, lat1] = coords[i];
        const [lon2, lat2] = coords[i + 1];
        const segLen = haversineDistance(lat1, lon1, lat2, lon2);
        if (samples.length === 0) samples.push({ lat: lat1, lng: lon1, d: 0 });

        let t = 0;
        while (t < segLen) {
            const nextT = Math.min(intervalMeters - acc, segLen - t);
            t += nextT;
            acc += nextT;
            if (acc >= intervalMeters) {
                const fraction = t / segLen;
                const lat = lat1 + (lat2 - lat1) * fraction;
                const lng = lon1 + (lon2 - lon1) * fraction;
                samples.push({ lat, lng, d: 0 });
                acc = 0;
            }
        }
    }

    const last = coords[coords.length - 1];
    if (last) samples.push({ lat: last[1], lng: last[0], d: 0 });

    // compute cumulative distances
    let cum = 0;
    for (let i = 0; i < samples.length; i++) {
        if (i === 0) samples[i].d = 0;
        else {
            cum += haversineDistance(samples[i - 1].lat, samples[i - 1].lng, samples[i].lat, samples[i].lng);
            samples[i].d = cum;
        }
    }

    return samples;
}

// Progressive elevation fetching
async function fetchElevationsProgressive(points, onProgress) {
    if (!points || points.length === 0) return [];

    // Start with sparse sampling (every 8th point)
    const indices = [0, points.length - 1]; // Always include start and end
    const results = new Array(points.length).fill(null);

    // Fetch initial sparse points
    const initialIndices = [];
    for (let i = 0; i < points.length; i += 8) {
        initialIndices.push(i);
    }
    if (!initialIndices.includes(points.length - 1)) {
        initialIndices.push(points.length - 1);
    }

    const initialPoints = initialIndices.map(i => points[i]);
    const initialElevations = await getElevations(initialPoints);

    initialIndices.forEach((idx, i) => {
        results[idx] = initialElevations[i];
    });

    // Interpolate missing points
    for (let i = 0; i < results.length; i++) {
        if (results[i] === null) {
            // Find surrounding known points
            let prevIdx = i - 1;
            while (prevIdx >= 0 && results[prevIdx] === null) prevIdx--;
            let nextIdx = i + 1;
            while (nextIdx < results.length && results[nextIdx] === null) nextIdx++;

            if (prevIdx >= 0 && nextIdx < results.length) {
                const t = (i - prevIdx) / (nextIdx - prevIdx);
                results[i] = {
                    lat: points[i].lat,
                    lng: points[i].lng,
                    elev: results[prevIdx].elev + (results[nextIdx].elev - results[prevIdx].elev) * t,
                    d: points[i].d
                };
            }
        }
    }

    if (onProgress) onProgress(results);

    // Progressively refine - fetch midpoints
    const refineLevels = [4, 2, 1];
    for (const step of refineLevels) {
        const refineIndices = [];
        for (let i = step; i < points.length; i += step * 2) {
            if (results[i] && results[i].elev !== undefined && !initialIndices.includes(i)) {
                continue; // Already have real data
            }
            refineIndices.push(i);
        }

        if (refineIndices.length > 0) {
            const refinePoints = refineIndices.map(i => points[i]);
            const refineElevations = await getElevations(refinePoints);

            refineIndices.forEach((idx, i) => {
                results[idx] = refineElevations[i];
            });

            // Re-interpolate gaps
            for (let i = 0; i < results.length; i++) {
                if (!results[i] || results[i].elev === undefined) {
                    let prevIdx = i - 1;
                    while (prevIdx >= 0 && (!results[prevIdx] || results[prevIdx].elev === undefined)) prevIdx--;
                    let nextIdx = i + 1;
                    while (nextIdx < results.length && (!results[nextIdx] || results[nextIdx].elev === undefined)) nextIdx++;

                    if (prevIdx >= 0 && nextIdx < results.length) {
                        const t = (i - prevIdx) / (nextIdx - prevIdx);
                        results[i] = {
                            lat: points[i].lat,
                            lng: points[i].lng,
                            elev: results[prevIdx].elev + (results[nextIdx].elev - results[prevIdx].elev) * t,
                            d: points[i].d
                        };
                    }
                }
            }

            if (onProgress) onProgress(results);
        }
    }

    return results;
}

function computeGainLoss(elevArray) {
    if (elevArray.length < 3) return { gain: 0, loss: 0 };

    // Data is already smoothed when saved, no need to smooth again
    // Calculate gain/loss with 3m threshold
    const THRESHOLD = 3;
    let gain = 0, loss = 0;
    let lastElev = elevArray[0].elev;

    for (let i = 1; i < elevArray.length; i++) {
        const diff = elevArray[i].elev - lastElev;

        if (Math.abs(diff) >= THRESHOLD) {
            if (diff > 0) {
                gain += diff;
            } else {
                loss += -diff;
            }
            lastElev = elevArray[i].elev;
        }
    }

    return { gain: Math.round(gain), loss: Math.round(loss) };
}

export async function fetchAndRenderElevation() {
    if (!APP.currentRoute || !APP.currentRoute.geometry || !APP.currentRoute.geometry.coordinates) {
        return;
    }

    const coords = APP.currentRoute.geometry.coordinates;
    currentRouteId++; // Increment to invalidate previous OSM fetches

    // Clear any pending OSM fetch
    if (osmFetchTimeout) {
        clearTimeout(osmFetchTimeout);
        osmFetchTimeout = null;
    }

    // Always sample at 10m for accurate gain/loss calculation
    const samples = sampleRouteCoordinates(coords, 10);
    if (!samples || samples.length === 0) {
        return;
    }

    // Check if we have stored OSM attributes for this route
    if (APP.currentRoute.osmAttributes) {
        osmAttributes = APP.currentRoute.osmAttributes;
    } else {
        osmAttributes = null;
    }

    // Proactively fetch and match OSM data in the background if not already present
    if (!osmAttributes) {
        const routeIdSnapshot = currentRouteId;

        const processOsmData = (data) => {
            if (routeIdSnapshot === currentRouteId) {
                osmAttributes = matchOSMDataToRoute(data, samples);
                if (APP.currentRoute) {
                    APP.currentRoute.osmAttributes = osmAttributes;
                }
                // Only re-render if we are in a mode that needs these attributes
                if (APP.elevationData && coloringMode !== 'gradient') {
                    const displayData = downsampleForDisplay(APP.elevationData);
                    renderElevationProfile(displayData);
                }
            }
        };

        if (APP.currentRoute.osmData) {
            // Use pre-loaded data immediately
            processOsmData(APP.currentRoute.osmData);
        } else {
            // Background fetch fallback
            (async () => {
                if (routeIdSnapshot === currentRouteId) {
                    const osmData = await fetchOSMData(coords);
                    processOsmData(osmData);
                }
            })();
        }
    }

    // Progressive loading with updates
    const elevRes = await fetchElevationsProgressive(samples, (partialResults) => {
        APP.elevationData = partialResults;
        const { gain, loss } = computeGainLoss(partialResults);
        const gainEl = document.getElementById('elev-gain-val');
        const lossEl = document.getElementById('elev-loss-val');
        if (gainEl) gainEl.textContent = `${gain} m`;
        if (lossEl) lossEl.textContent = `${loss} m`;

        // Downsample for display only
        const displayData = downsampleForDisplay(partialResults);
        renderElevationProfile(displayData);
    });

    if (!elevRes) {
        const elevCard = document.getElementById('elevationCard');
        if (elevCard) elevCard.style.display = 'none';
        return;
    }

    APP.elevationData = elevRes;

    const { gain, loss } = computeGainLoss(elevRes);
    const gainEl = document.getElementById('elev-gain-val');
    const lossEl = document.getElementById('elev-loss-val');
    if (gainEl) gainEl.textContent = `${gain} m`;
    if (lossEl) lossEl.textContent = `${loss} m`;

    // Downsample for display only
    const displayData = downsampleForDisplay(elevRes);
    renderElevationProfile(displayData);

    // Setup coloring mode dropdown if not already done
    setupColoringModeDropdown();
}

// Downsample elevation data for display based on total points
function downsampleForDisplay(data) {
    if (!data || data.length === 0) return data;

    // Ensure all data points have their original index for attribute lookup
    if (data[0].originalIndex === undefined) {
        for (let i = 0; i < data.length; i++) {
            data[i].originalIndex = i;
        }
    }

    const targetPoints = 750;
    if (data.length <= targetPoints) return data;

    // Calculate step to achieve target points
    const step = Math.ceil(data.length / targetPoints);
    const downsampled = [];

    for (let i = 0; i < data.length; i += step) {
        downsampled.push(data[i]);
    }

    // Always include last point
    if (downsampled[downsampled.length - 1] !== data[data.length - 1]) {
        downsampled.push(data[data.length - 1]);
    }

    return downsampled;
}

function getGradientColors(grade) {
    if (grade > 0) {
        if (grade < 3) return { fill: null, stroke: '#32b8c6' };
        if (grade < 6) return { fill: 'rgba(255, 255, 150, 0.35)', stroke: '#CCCC00' };
        if (grade < 11) return { fill: 'rgba(255, 200, 150, 0.35)', stroke: '#FF8C00' };
        if (grade < 16) return { fill: 'rgba(255, 150, 150, 0.35)', stroke: '#FF4444' };
        if (grade < 21) return { fill: 'rgba(200, 150, 255, 0.35)', stroke: '#9932CC' };
        return { fill: 'rgba(100, 100, 100, 0.35)', stroke: '#333333' };
    } else {
        const absGrade = Math.abs(grade);
        if (absGrade < 3) return { fill: null, stroke: '#32b8c6' };
        if (absGrade < 6) return { fill: 'rgba(150, 255, 150, 0.35)', stroke: '#44FF44' };
        if (absGrade < 11) return { fill: 'rgba(100, 200, 100, 0.35)', stroke: '#00AA00' };
        if (absGrade < 16) return { fill: 'rgba(50, 150, 50, 0.35)', stroke: '#007700' };
        return { fill: 'rgba(50, 50, 50, 0.35)', stroke: '#111111' };
    }
}

function getSegmentColors(index, grades, data) {
    if (coloringMode === 'gradient') {
        const colors = getGradientColors(grades[index]);
        if (!colors.fill) colors.fill = 'rgba(50,184,198,0.12)';
        return colors;
    }

    const originalIndex = (data && data[index] && data[index].originalIndex !== undefined)
        ? data[index].originalIndex
        : index;

    if (osmAttributes && osmAttributes[originalIndex]) {
        const attr = osmAttributes[originalIndex];
        const val = attr[coloringMode] || 'unknown';
        const palette = PALETTES[coloringMode];
        if (palette) {
            return palette[val] || palette.unknown;
        }
    }

    return { fill: 'rgba(50,184,198,0.12)', stroke: '#32b8c6' };
}

function drawGridLines(ctx, chartParams, visibleGridPoints) {
    const { width, chartHeight, minE, maxE } = chartParams;

    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = 'rgba(150, 150, 150, 0.2)';
    ctx.lineWidth = 1;

    visibleGridPoints.forEach(val => {
        const y = (1 - (val - minE) / (maxE - minE)) * chartHeight;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
    });
    ctx.setLineDash([]); // Reset for curve
}

export function renderElevationProfile(data) {
    const canvas = document.getElementById('elevationCanvas');
    const tooltip = document.getElementById('elevationTooltip');

    if (!canvas || !data || !data.length) return;

    // set internal canvas size for crisp rendering
    const parent = canvas.parentElement || canvas;
    const width = parent.clientWidth;
    const height = 150;
    canvas.width = Math.round(width * devicePixelRatio);
    canvas.height = Math.round(height * devicePixelRatio);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';

    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(devicePixelRatio, devicePixelRatio);

    const elevations = data.map(d => d.elev);
    const rawMinE = Math.min(...elevations);
    const rawMaxE = Math.max(...elevations);

    // Calculate professional y-axis range (divisible by 50)
    let minE = Math.floor(rawMinE / 50) * 50;
    let maxE = Math.ceil(rawMaxE / 50) * 50;

    // Ensure we have at least 50m range
    if (maxE === minE) {
        minE -= 25;
        maxE += 25;
    }

    // Calculate grid lines (divisible by 50)
    const gridPoints = [];
    for (let val = minE; val <= maxE; val += 50) {
        gridPoints.push(val);
    }

    // If we have too many points, show fewer
    let visibleGridPoints = gridPoints;
    if (gridPoints.length > 5) {
        const step = Math.ceil(gridPoints.length / 4);
        visibleGridPoints = gridPoints.filter((_, i) => i % step === 0 || i === gridPoints.length - 1);
    }

    const chartHeight = height;
    const chartWidth = width;

    // Calculate gradients for each 100m segment
    const grades = [];
    const segmentDistance = 100;

    for (let i = 0; i < data.length; i++) {
        let endIdx = i;
        for (let j = i + 1; j < data.length; j++) {
            if (data[j].d - data[i].d >= segmentDistance) {
                endIdx = j;
                break;
            }
        }

        if (endIdx > i) {
            const elevDiff = data[endIdx].elev - data[i].elev;
            const dist = data[endIdx].d - data[i].d;
            grades.push(dist > 0 ? (elevDiff / dist) * 100 : 0);
        } else {
            grades.push(grades[grades.length - 1] || 0);
        }
    }

    // Draw grid lines first
    drawGridLines(ctx, { width, chartHeight, minE, maxE }, visibleGridPoints);

    // BATCHING: Precompute all points for faster drawing
    const points = data.map((p, i) => ({
        x: (i / (data.length - 1)) * chartWidth,
        y: (1 - (p.elev - minE) / (maxE - minE)) * chartHeight
    }));

    // Draw filled areas
    for (let i = 0; i < data.length - 1; i++) {
        const colors = getSegmentColors(i, grades, data);
        const p1 = points[i];
        const p2 = points[i + 1];

        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p2.x, height);
        ctx.lineTo(p1.x, height);
        ctx.closePath();
        ctx.fillStyle = colors.fill;
        ctx.fill();
    }

    // Draw stroke lines
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (let i = 0; i < data.length - 1; i++) {
        const colors = getSegmentColors(i, grades, data);
        const p1 = points[i];
        const p2 = points[i + 1];

        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.strokeStyle = colors.stroke;
        ctx.stroke();
    }

    // draw horizontal markers (start/mid/end)
    const xAxis = document.getElementById('elevationXAxis');
    if (xAxis) {
        const totalKm = (data[data.length - 1].d / 1000);
        xAxis.innerHTML = `<div>0 km</div><div>${totalKm.toFixed(1)} km</div>`;
    }

    // draw side scale (absolute values)
    const sideScale = document.getElementById('elevationSideScale');
    if (sideScale) {
        sideScale.innerHTML = visibleGridPoints.map(val => {
            const topPercent = (1 - (val - minE) / (maxE - minE)) * 100;
            return `<div class="sidescale-label" style="top: ${topPercent}%">${val} m</div>`;
        }).join('');
    }

    // Store chart state to avoid full redraws on hover
    let chartState = { data, width, height, pad: 0, chartWidth, chartHeight, minE, maxE, grades, visibleGridPoints };
    let lastIdx = -1;
    let rafId = null;
    let moveCount = 0;

    // Update stats summary sidebar (desktop)
    updateStatsSummary(data, grades);

    // attach mouse events
    canvas.onmousemove = function (evt) {
        moveCount++;
        const rect = canvas.getBoundingClientRect();
        const mouseX = (evt.clientX - rect.left);
        const rel = Math.max(0, Math.min(1, mouseX / width));
        const idx = Math.round(rel * (data.length - 1));
        const point = data[idx];
        if (!point) return;

        // Cancel any pending animation frame
        if (rafId) cancelAnimationFrame(rafId);

        // Update tooltip position immediately without waiting for index change
        rafId = requestAnimationFrame(() => {
            if (tooltip) {
                tooltip.style.display = 'block';
                const tooltipRect = tooltip.getBoundingClientRect();
                const tooltipWidth = tooltipRect.width || 200;
                const tooltipHeight = tooltipRect.height || 60;

                let left = evt.clientX + 10;
                let top = evt.clientY - tooltipHeight - 10;

                if (left + tooltipWidth > window.innerWidth) {
                    left = evt.clientX - tooltipWidth - 10;
                }
                if (top < 0) {
                    top = evt.clientY + 10;
                }

                tooltip.style.left = left + 'px';
                tooltip.style.top = top + 'px';
            }
        });

        // Only update content and redraw when index changes
        if (idx === lastIdx) return;
        lastIdx = idx;

        // Calculate gradient at this point
        let gradient = 0;
        if (idx > 0 && idx < data.length - 1) {
            const prevPoint = data[idx - 1];
            const nextPoint = data[idx + 1];
            const elevDiff = nextPoint.elev - prevPoint.elev;
            const distDiff = nextPoint.d - prevPoint.d;
            gradient = distDiff > 0 ? (elevDiff / distDiff) * 100 : 0;
        }

        // Update tooltip content
        if (tooltip) {
            const gradientText = gradient > 0 ? `+${gradient.toFixed(1)}%` : `${gradient.toFixed(1)}%`;
            const gradientColor = Math.abs(gradient) > 8 ? (gradient > 0 ? '#ff4444' : '#44ff44') : '#ccc';

            let extraInfo = '';
            // Use originalIndex for attribute lookup
            const originalIdx = point.originalIndex ?? idx;

            if (osmAttributes && osmAttributes[originalIdx]) {
                const attrs = osmAttributes[originalIdx];
                const parts = [];

                const showAll = coloringMode === 'gradient';

                if ((showAll || coloringMode === 'highway') && attrs.highway) {
                    if (!showAll || attrs.highway !== 'unknown') {
                        parts.push(`<div>${HIGHWAY_LABELS[attrs.highway] || attrs.highway}</div>`);
                    }
                }
                if ((showAll || coloringMode === 'surface') && attrs.surface) {
                    if (!showAll || attrs.surface !== 'unknown') {
                        parts.push(`<div>${SURFACE_LABELS[attrs.surface] || attrs.surface}</div>`);
                    }
                }
                if ((showAll || coloringMode === 'smoothness') && attrs.smoothness) {
                    if (!showAll || attrs.smoothness !== 'unknown') {
                        parts.push(`<div>${SMOOTHNESS_LABELS[attrs.smoothness] || attrs.smoothness}</div>`);
                    }
                }

                extraInfo = parts.join('');
            }

            tooltip.innerHTML = `
                <div><strong>${(point.d / 1000).toFixed(2)} km</strong> — <strong>${Math.round(point.elev)} m</strong></div>
                <div style="color: ${gradientColor}; font-weight: 600;">${gradientText} gradient</div>
                ${extraInfo}
            `;
        }

        // Redraw only the cursor line without full chart redraw
        drawCursorLine(ctx, chartState, idx);

        // update map preview at this point
        createOrUpdateRoutePreview(point);
    };

    canvas.onmouseleave = function () {
        lastIdx = -1;
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        const tooltip = document.getElementById('elevationTooltip');
        if (tooltip) tooltip.style.display = 'none';

        // Use imported function
        removeRoutePreview();

        renderElevationProfile(data);
    };

    canvas.onclick = function (evt) {
        const rect = canvas.getBoundingClientRect();
        const mouseX = (evt.clientX - rect.left);
        const rel = Math.max(0, Math.min(1, mouseX / width));
        const idx = Math.round(rel * (data.length - 1));
        const point = data[idx];
        if (point && APP.map) {
            APP.map.setView([point.lat, point.lng], APP.map.getZoom());
        }
    };

    // Hide tooltip on touch/click outside elevation canvas
    document.addEventListener('click', function hideTooltipOnClick(e) {
        if (!canvas.contains(e.target)) {
            const tooltip = document.getElementById('elevationTooltip');
            if (tooltip) tooltip.style.display = 'none';
        }
    });
}

// Helper to draw just the cursor line without full redraw
function drawCursorLine(ctx, state, idx) {
    const { data, width, height, chartWidth, chartHeight, minE, maxE, grades, visibleGridPoints } = state;

    ctx.clearRect(0, 0, width, height);

    // Redraw grid lines
    if (visibleGridPoints) {
        drawGridLines(ctx, state, visibleGridPoints);
    }

    // BATCHING: Precompute points (same as main render)
    const points = data.map((p, i) => ({
        x: (i / (data.length - 1)) * chartWidth,
        y: (1 - (p.elev - minE) / (maxE - minE)) * chartHeight
    }));

    // Redraw filled areas
    for (let i = 0; i < data.length - 1; i++) {
        const colors = getSegmentColors(i, grades, data);
        const p1 = points[i];
        const p2 = points[i + 1];

        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p2.x, height);
        ctx.lineTo(p1.x, height);
        ctx.closePath();
        ctx.fillStyle = colors.fill;
        ctx.fill();
    }

    // Redraw stroke lines
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (let i = 0; i < data.length - 1; i++) {
        const colors = getSegmentColors(i, grades, data);
        const p1 = points[i];
        const p2 = points[i + 1];

        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.strokeStyle = colors.stroke;
        ctx.stroke();
    }

    // Draw vertical cursor line
    ctx.beginPath();
    const vx = (idx / (data.length - 1)) * chartWidth;
    ctx.moveTo(vx, 0);
    ctx.lineTo(vx, height);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1;
    ctx.stroke();
}

export function drawElevationCursor(routePoint) {
    if (!APP.elevationData || APP.elevationData.length === 0) return;
    if (!routePoint || routePoint.lat == null || routePoint.lng == null) return;

    const data = APP.elevationData;

    // Find closest point in elevation data by comparing lat/lng
    let closestIdx = 0;
    let minDist = Infinity;
    for (let i = 0; i < data.length; i++) {
        const dlat = data[i].lat - routePoint.lat;
        const dlng = data[i].lng - routePoint.lng;
        const dist = dlat * dlat + dlng * dlng;
        if (dist < minDist) {
            minDist = dist;
            closestIdx = i;
        }
    }

    APP.elevationHoverIndex = closestIdx;
    renderElevationProfile(data);
}

function setupColoringModeDropdown() {
    const header = document.querySelector('.elevation-header');
    if (!header || document.getElementById('coloringModeSelect')) return;

    const selectWrapper = document.createElement('div');
    selectWrapper.style.cssText = 'margin-left: auto;';

    const select = document.createElement('select');
    select.id = 'coloringModeSelect';
    select.className = 'elevation-mode-select';

    const options = [
        { value: 'gradient', label: 'Gradient %' },
        { value: 'highway', label: 'Road Type' },
        { value: 'surface', label: 'Surface' },
        { value: 'smoothness', label: 'Smoothness' }
    ];

    options.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt.value;
        option.textContent = opt.label;
        select.appendChild(option);
    });

    select.addEventListener('change', async (e) => {
        const previousMode = coloringMode;
        coloringMode = e.target.value;

        // Clear OSM attributes when switching to gradient mode
        if (coloringMode === 'gradient') {
            if (osmFetchTimeout) {
                clearTimeout(osmFetchTimeout);
                osmFetchTimeout = null;
            }
        }

        // Re-render
        if (APP.elevationData) {
            const displayData = downsampleForDisplay(APP.elevationData);
            renderElevationProfile(displayData);
        }

        // Fetch OSM data in background if needed
        if (coloringMode !== 'gradient' && !osmAttributes) {
            const coords = APP.currentRoute?.geometry?.coordinates;
            if (coords) {
                const routeIdSnapshot = currentRouteId;
                // Small delay before fetching
                setTimeout(async () => {
                    if (routeIdSnapshot === currentRouteId && coloringMode !== 'gradient') {
                        const samples = sampleRouteCoordinates(coords, 10);
                        const osmData = await fetchOSMData(coords);
                        if (routeIdSnapshot === currentRouteId && coloringMode !== 'gradient') {
                            osmAttributes = matchOSMDataToRoute(osmData, samples);
                            // Store with route
                            if (APP.currentRoute) {
                                APP.currentRoute.osmAttributes = osmAttributes;
                            }
                            const displayData = downsampleForDisplay(APP.elevationData);
                            renderElevationProfile(displayData);
                        }
                    }
                }, 1000);
            }
        }
    });

    selectWrapper.appendChild(select);
    header.insertBefore(selectWrapper, header.querySelector('.btn-elevation-collapse'));
}

function updateStatsSummary(data, grades) {
    const container = document.getElementById('elevationStatsSummary');
    if (!container) return;

    container.innerHTML = '';
    const stats = new Map();
    const totalPoints = data.length;

    if (coloringMode === 'gradient') {
        const ranges = [
            { min: 16, label: '> 16% Climb', color: getGradientColors(20).stroke },
            { min: 11, max: 16, label: '11-16% Climb', color: getGradientColors(13).stroke },
            { min: 6, max: 11, label: '6-11% Climb', color: getGradientColors(8).stroke },
            { min: 3, max: 6, label: '3-6% Climb', color: getGradientColors(4).stroke },
            { min: -3, max: 3, label: 'Flat (<3%)', color: '#32b8c6' },
            { min: -6, max: -3, label: '3-6% Descent', color: getGradientColors(-4).stroke },
            { min: -11, max: -6, label: '6-11% Descent', color: getGradientColors(-8).stroke },
            { min: -16, max: -11, label: '11-16% Descent', color: getGradientColors(-13).stroke },
            { max: -16, label: '> 16% Descent', color: getGradientColors(-20).stroke }
        ];

        ranges.forEach(r => stats.set(r.label, { count: 0, color: r.color }));

        grades.forEach(g => {
            const range = ranges.find(r => {
                if (r.min !== undefined && r.max !== undefined) return g >= r.min && g < r.max;
                if (r.min !== undefined) return g >= r.min;
                if (r.max !== undefined) return g < r.max;
                return false;
            });
            if (range) stats.get(range.label).count++;
        });
    } else if (osmAttributes) {
        data.forEach((point, i) => {
            const originalIdx = point.originalIndex ?? i;
            const attr = osmAttributes[originalIdx];
            const value = attr?.[coloringMode] || 'unknown';
            const palette = PALETTES[coloringMode];
            const color = palette ? (palette[value]?.stroke || palette.unknown.stroke) : '#969696';

            const labelsMap = coloringMode === 'highway' ? HIGHWAY_LABELS :
                coloringMode === 'surface' ? SURFACE_LABELS :
                    coloringMode === 'smoothness' ? SMOOTHNESS_LABELS : {};
            const label = labelsMap[value] || (value !== 'unknown' ? value : 'Unknown');

            if (!stats.has(label)) stats.set(label, { count: 0, color });
            stats.get(label).count++;
        });
    } else {
        return; // No data to show
    }

    // Sort by count descending
    const sortedStats = Array.from(stats.entries())
        .filter(([_, data]) => data.count > 0)
        .sort((a, b) => b[1].count - a[1].count);

    sortedStats.forEach(([label, info]) => {
        const percent = Math.round((info.count / totalPoints) * 100);
        if (percent === 0) return;

        const item = document.createElement('div');
        item.className = 'stat-summary-item';
        item.innerHTML = `
            <div class="stat-color-dot" style="background: ${info.color}"></div>
            <div class="stat-label">${label}</div>
            <div class="stat-percent">${percent}%</div>
        `;
        container.appendChild(item);
    });
}
