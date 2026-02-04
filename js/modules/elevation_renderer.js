// elevation_renderer.js
import CONFIG from '../config.js';
import { getElevations } from '../elevation.js';
import { APP } from './state.js';
import { createOrUpdateRoutePreview, removeRoutePreview } from './ui.js'; // Ensure these are exported from UI

// Haversine distance (meters)
function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // meters
    const toRad = Math.PI / 180;
    const dLat = (lat2 - lat1) * toRad;
    const dLon = (lon2 - lon1) * toRad;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Sample route coordinates progressively - start coarse, refine over time
function sampleRouteCoordinates(coords, intervalMeters = 50) {
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

    // Apply moving average smoothing (window size 5)
    const smoothed = [];
    const windowSize = 5;

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

    // Calculate gain/loss with 3m threshold on smoothed data
    const THRESHOLD = 3;
    let gain = 0, loss = 0;
    let lastElev = smoothed[0].elev;

    for (let i = 1; i < smoothed.length; i++) {
        const diff = smoothed[i].elev - lastElev;

        if (Math.abs(diff) >= THRESHOLD) {
            if (diff > 0) {
                gain += diff;
            } else {
                loss += -diff;
            }
            lastElev = smoothed[i].elev;
        }
    }

    return { gain: Math.round(gain), loss: Math.round(loss) };
}

export async function fetchAndRenderElevation() {
    if (!APP.currentRoute || !APP.currentRoute.geometry || !APP.currentRoute.geometry.coordinates) {
        return;
    }

    const coords = APP.currentRoute.geometry.coordinates;

    const samples = sampleRouteCoordinates(coords, 25); // 25m intervals for smoother curve
    if (!samples || samples.length === 0) {
        return;
    }

    // Progressive loading with updates
    const elevRes = await fetchElevationsProgressive(samples, (partialResults) => {
        APP.elevationData = partialResults;
        const { gain, loss } = computeGainLoss(partialResults);
        const gainEl = document.getElementById('elev-gain-val');
        const lossEl = document.getElementById('elev-loss-val');
        if (gainEl) gainEl.textContent = `${gain} m`;
        if (lossEl) lossEl.textContent = `${loss} m`;
        renderElevationProfile(partialResults);
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

    renderElevationProfile(elevRes);
}

function getGradientColor(grade) {
    // grade is in percent (e.g., 5 for 5%)
    if (grade < 3) return null; // use default color
    if (grade < 6) return 'rgba(255, 255, 150, 0.35)'; // pastel yellow 3-5%
    if (grade < 11) return 'rgba(255, 200, 150, 0.35)'; // pastel orange 6-10%
    if (grade < 16) return 'rgba(255, 150, 150, 0.35)'; // pastel red 10-15%
    if (grade < 21) return 'rgba(200, 150, 255, 0.35)'; // pastel purple 15-20%
    return 'rgba(100, 100, 100, 0.35)'; // pastel black 20%+
}

function getGradientStrokeColor(grade) {
    if (grade < 3) return '#32b8c6'; // default cyan
    if (grade < 6) return '#CCCC00'; // yellow 3-5%
    if (grade < 11) return '#FF8C00'; // orange 6-10%
    if (grade < 16) return '#FF4444'; // red 10-15%
    if (grade < 21) return '#9932CC'; // purple 15-20%
    return '#333333'; // dark gray/black 20%+
}

export function renderElevationProfile(data) {
    const canvas = document.getElementById('elevationCanvas');
    const tooltip = document.getElementById('elevationTooltip');

    if (!canvas || !data || !data.length) return;

    // set internal canvas size for crisp rendering
    const parent = canvas.parentElement || canvas;
    const width = parent.clientWidth;
    const height = 100;
    canvas.width = Math.round(width * devicePixelRatio);
    canvas.height = Math.round(height * devicePixelRatio);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.clearRect(0, 0, width, height);

    const elevations = data.map(d => d.elev);
    const minE = Math.min(...elevations);
    const maxE = Math.max(...elevations);
    const pad = 2; // minimal padding to maximize curve width
    const chartHeight = height - pad * 2;
    const chartWidth = width - pad * 2;

    // Calculate gradients for each 100m segment
    const grades = [];
    const segmentDistance = 100; // meters

    for (let i = 0; i < data.length; i++) {
        // Find the point ~100m ahead
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
            const grade = dist > 0 ? (elevDiff / dist) * 100 : 0;
            grades.push(grade);
        } else {
            grades.push(grades[grades.length - 1] || 0);
        }
    }

    // Draw filled areas segment by segment
    for (let i = 0; i < data.length - 1; i++) {
        const grade = grades[i];
        const color = getGradientColor(grade);

        const x1 = (i / (data.length - 1)) * chartWidth + pad;
        const x2 = ((i + 1) / (data.length - 1)) * chartWidth + pad + 0.1; // Add 0.1px overlap
        const y1 = pad + (1 - (data[i].elev - minE) / Math.max(1, (maxE - minE))) * chartHeight;
        const y2 = pad + (1 - (data[i + 1].elev - minE) / Math.max(1, (maxE - minE))) * chartHeight;

        if (color) {
            // Draw climb fill
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.lineTo(x2, height - pad);
            ctx.lineTo(x1, height - pad);
            ctx.closePath();
            ctx.fillStyle = color;
            ctx.fill();
        } else {
            // Draw default (flat/descent) fill
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.lineTo(x2, height - pad);
            ctx.lineTo(x1, height - pad);
            ctx.closePath();
            ctx.fillStyle = 'rgba(50,184,198,0.12)';
            ctx.fill();
        }
    }

    // Draw stroke line segment by segment with slight overlap
    for (let i = 0; i < data.length - 1; i++) {
        const grade = grades[i];
        const color = getGradientStrokeColor(grade);

        const x1 = (i / (data.length - 1)) * chartWidth + pad;
        const x2 = ((i + 1) / (data.length - 1)) * chartWidth + pad + 0.1; // Add 0.1px overlap
        const y1 = pad + (1 - (data[i].elev - minE) / Math.max(1, (maxE - minE))) * chartHeight;
        const y2 = pad + (1 - (data[i + 1].elev - minE) / Math.max(1, (maxE - minE))) * chartHeight;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineCap = 'square';
        ctx.stroke();
    }

    // draw horizontal markers (start/mid/end)
    const xAxis = document.getElementById('elevationXAxis');
    if (xAxis) {
        const totalKm = (data[data.length - 1].d / 1000);
        xAxis.innerHTML = `<div>0 km</div><div>${totalKm.toFixed(1)} km</div>`;
    }

    // draw side scale (min/max) in the sidebar
    const sideScale = document.getElementById('elevationSideScale');
    if (sideScale) {
        sideScale.innerHTML = `<div>${Math.round(maxE)} m</div><div style="opacity:0.6">${Math.round((maxE + minE) / 2)} m</div><div>${Math.round(minE)} m</div>`;
    }

    // attach mouse events
    canvas.onmousemove = function (evt) {
        const rect = canvas.getBoundingClientRect();
        const mouseX = (evt.clientX - rect.left);
        const rel = Math.max(0, Math.min(1, (mouseX - pad) / (width - pad * 2)));
        const idx = Math.round(rel * (data.length - 1));
        const point = data[idx];
        if (!point) return;

        // Calculate gradient at this point
        let gradient = 0;
        if (idx > 0 && idx < data.length - 1) {
            const prevPoint = data[idx - 1];
            const nextPoint = data[idx + 1];
            const elevDiff = nextPoint.elev - prevPoint.elev;
            const distDiff = nextPoint.d - prevPoint.d;
            gradient = distDiff > 0 ? (elevDiff / distDiff) * 100 : 0;
        }

        // position tooltip - ensure it stays on screen
        if (tooltip) {
            const tooltipWidth = 200;
            const tooltipHeight = 60;
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
            tooltip.style.display = 'block';

            const gradientText = gradient > 0 ? `+${gradient.toFixed(1)}%` : `${gradient.toFixed(1)}%`;
            const gradientColor = Math.abs(gradient) > 8 ? (gradient > 0 ? '#ff4444' : '#44ff44') : '#ccc';

            tooltip.innerHTML = `
                <div><strong>${(point.d / 1000).toFixed(2)} km</strong> — <strong>${Math.round(point.elev)} m</strong></div>
                <div style="color: ${gradientColor}; font-weight: 600;">${gradientText} gradient</div>
            `;
        }

        // draw vertical line overlay on canvas
        ctx.clearRect(0, 0, width, height);

        // redraw with gradient colors (fill only - simplified for performance on hover)
        // ... (Full redraw is safer to keep same visuals)
        renderElevationProfile(data); // Simple re-render with static visual, then draw cursor

        // vertical line at hover position
        ctx.beginPath();
        const vx = (idx / (data.length - 1)) * chartWidth + pad;
        ctx.moveTo(vx, pad);
        ctx.lineTo(vx, height - pad);
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // update map preview at this point
        createOrUpdateRoutePreview(point);
    };

    canvas.onmouseleave = function () {
        const tooltip = document.getElementById('elevationTooltip');
        if (tooltip) tooltip.style.display = 'none';

        // Use imported function
        removeRoutePreview();

        renderElevationProfile(data);
    };
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

    // Draw cursor logic could be added here if we want to reverse-sync map->chart cursor
}
