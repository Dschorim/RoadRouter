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

    // Always sample at 10m for accurate gain/loss calculation
    const samples = sampleRouteCoordinates(coords, 10);
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
}

// Downsample elevation data for display based on total points
function downsampleForDisplay(data) {
    if (!data || data.length === 0) return data;
    
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

    // Store chart state to avoid full redraws on hover
    let chartState = { data, width, height, pad, chartWidth, chartHeight, minE, maxE, grades };
    let lastIdx = -1;
    let rafId = null;
    let moveCount = 0;

    // attach mouse events
    canvas.onmousemove = function (evt) {
        moveCount++;
        const rect = canvas.getBoundingClientRect();
        const mouseX = (evt.clientX - rect.left);
        const rel = Math.max(0, Math.min(1, (mouseX - pad) / (width - pad * 2)));
        const idx = Math.round(rel * (data.length - 1));
        const point = data[idx];
        if (!point) return;

        console.log(`[Tooltip] Move #${moveCount}: idx=${idx}, lastIdx=${lastIdx}, clientX=${evt.clientX}, clientY=${evt.clientY}`);

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

                console.log(`[Tooltip] RAF update: left=${left}, top=${top}, width=${tooltipWidth}, height=${tooltipHeight}`);
                tooltip.style.left = left + 'px';
                tooltip.style.top = top + 'px';
            }
        });

        // Only update content and redraw when index changes
        if (idx === lastIdx) return;
        lastIdx = idx;

        console.log(`[Tooltip] Index changed to ${idx}, updating content`);

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

            tooltip.innerHTML = `
                <div><strong>${(point.d / 1000).toFixed(2)} km</strong> — <strong>${Math.round(point.elev)} m</strong></div>
                <div style="color: ${gradientColor}; font-weight: 600;">${gradientText} gradient</div>
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
}

// Helper to draw just the cursor line without full redraw
function drawCursorLine(ctx, state, idx) {
    const { data, width, height, pad, chartWidth, chartHeight, minE, maxE, grades } = state;
    
    ctx.clearRect(0, 0, width, height);

    // Redraw filled areas
    for (let i = 0; i < data.length - 1; i++) {
        const grade = grades[i];
        const color = getGradientColor(grade);

        const x1 = (i / (data.length - 1)) * chartWidth + pad;
        const x2 = ((i + 1) / (data.length - 1)) * chartWidth + pad + 0.1;
        const y1 = pad + (1 - (data[i].elev - minE) / Math.max(1, (maxE - minE))) * chartHeight;
        const y2 = pad + (1 - (data[i + 1].elev - minE) / Math.max(1, (maxE - minE))) * chartHeight;

        if (color) {
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.lineTo(x2, height - pad);
            ctx.lineTo(x1, height - pad);
            ctx.closePath();
            ctx.fillStyle = color;
            ctx.fill();
        } else {
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

    // Redraw stroke lines
    for (let i = 0; i < data.length - 1; i++) {
        const grade = grades[i];
        const color = getGradientStrokeColor(grade);

        const x1 = (i / (data.length - 1)) * chartWidth + pad;
        const x2 = ((i + 1) / (data.length - 1)) * chartWidth + pad + 0.1;
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

    // Draw vertical cursor line
    ctx.beginPath();
    const vx = (idx / (data.length - 1)) * chartWidth + pad;
    ctx.moveTo(vx, pad);
    ctx.lineTo(vx, height - pad);
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

    // Draw cursor logic could be added here if we want to reverse-sync map->chart cursor
}
