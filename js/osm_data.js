// osm_data.js - Fetch OSM data via Overpass API
import { APP } from './modules/state.js';

const OVERPASS_API = '/overpass/api/query';
const RETRY_DELAY = 1000; // 1s delay before retry
const MAX_RETRIES = 2;

// Lookup tables for readable labels
export const HIGHWAY_LABELS = {
    motorway: 'Motorway',
    trunk: 'Trunk Road',
    primary: 'Primary Road',
    secondary: 'Secondary Road',
    tertiary: 'Tertiary Road',
    unclassified: 'Unclassified Road',
    residential: 'Residential',
    service: 'Service Road',
    track: 'Track',
    path: 'Path',
    footway: 'Footway',
    cycleway: 'Cycleway',
    bridleway: 'Bridleway',
    steps: 'Steps',
    pedestrian: 'Pedestrian',
    living_street: 'Living Street',
    road: 'Road',
    raceway: 'Raceway',
    motorway_link: 'Motorway Link',
    trunk_link: 'Trunk Road Link',
    primary_link: 'Primary Road Link',
    secondary_link: 'Secondary Road Link',
    tertiary_link: 'Tertiary Road Link'
};

export const SURFACE_LABELS = {
    paved: 'Paved',
    asphalt: 'Asphalt',
    concrete: 'Concrete',
    paving_stones: 'Paving Stones',
    sett: 'Cobblestone',
    cobblestone: 'Cobblestone',
    metal: 'Metal',
    wood: 'Wood',
    unpaved: 'Unpaved',
    compacted: 'Compacted',
    fine_gravel: 'Fine Gravel',
    gravel: 'Gravel',
    pebblestone: 'Pebblestone',
    ground: 'Ground',
    dirt: 'Dirt',
    earth: 'Earth',
    grass: 'Grass',
    grass_paver: 'Grass Paver',
    mud: 'Mud',
    sand: 'Sand',
    ice: 'Ice',
    salt: 'Salt'
};

export const SMOOTHNESS_LABELS = {
    excellent: 'Excellent',
    good: 'Good',
    intermediate: 'Intermediate',
    bad: 'Bad',
    very_bad: 'Very Bad',
    horrible: 'Horrible',
    very_horrible: 'Very Horrible',
    impassable: 'Impassable'
};

const HIGHWAY_PRIORITY = {
    motorway: 100,
    trunk: 95,
    primary: 90,
    secondary: 85,
    tertiary: 80,
    unclassified: 70,
    residential: 60,
    living_street: 50,
    road: 40,
    service: 30,
    track: 20,
    path: 10,
    footway: 10,
    cycleway: 10,
    bridleway: 10,
    steps: 5,
    pedestrian: 5,
    motorway_link: 98,
    trunk_link: 93,
    primary_link: 88,
    secondary_link: 83,
    tertiary_link: 78
};

// Cache for OSM data
const TILE_SIZE = 0.02; // ~2.2km grid
const fetchedTiles = new Set();
const globalOsmElements = new Map();

function getTileKey(lat, lng) {
    return `${Math.floor(lat / TILE_SIZE)},${Math.floor(lng / TILE_SIZE)}`;
}

function getBBoxForTile(tileKey) {
    const [latIdx, lngIdx] = tileKey.split(',').map(Number);
    return {
        minLat: latIdx * TILE_SIZE,
        maxLat: (latIdx + 1) * TILE_SIZE,
        minLng: lngIdx * TILE_SIZE,
        maxLng: (lngIdx + 1) * TILE_SIZE
    };
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options, retries = MAX_RETRIES) {
    for (let i = 0; i <= retries; i++) {
        try {
            const response = await fetch(url, options);
            if (!response.ok) {
                if (response.status === 429) { // Rate limited
                    console.warn("Overpass rate limited, waiting longer...");
                    await sleep(RETRY_DELAY * 2);
                    continue;
                }
                throw new Error(`HTTP ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            if (i === retries) throw error;
            console.warn(`Overpass-minimal request failed (attempt ${i + 1}/${retries + 1}), retrying...`, error);
            await sleep(RETRY_DELAY);
        }
    }
}

export async function fetchOSMData(coordinates) {
    if (!coordinates || coordinates.length === 0) return { elements: [] };

    // 1. Identify all tiles covering the route
    const requiredTiles = new Set();
    coordinates.forEach(c => {
        requiredTiles.add(getTileKey(c[1], c[0]));
    });

    // 2. Find which tiles are not yet fetched
    const missingTiles = Array.from(requiredTiles).filter(key => !fetchedTiles.has(key));

    if (missingTiles.length > 0) {
        // Fetch missing tiles in batches to avoid overwhelming the server
        const BATCH_SIZE = 4;
        for (let i = 0; i < missingTiles.length; i += BATCH_SIZE) {
            const batch = missingTiles.slice(i, i + BATCH_SIZE);
            const promises = batch.map(key => fetchTileData(key));
            const results = await Promise.all(promises);

            results.forEach((data, index) => {
                const key = batch[index];
                if (data && data.elements) {
                    data.elements.forEach(el => {
                        // Use composite key for deduplication
                        const compKey = `${el.id}_${el.lat1.toFixed(6)}_${el.lon1.toFixed(6)}_${el.lat2.toFixed(6)}_${el.lon2.toFixed(6)}`;
                        globalOsmElements.set(compKey, el);
                    });
                    fetchedTiles.add(key);
                }
            });
        }
    }

    // 3. Filter global pool for relevant elements
    // We return elements that are roughly within the bounding box of the current route plus a small buffer
    const lats = coordinates.map(c => c[1]);
    const lngs = coordinates.map(c => c[0]);
    const minLat = Math.min(...lats) - 0.005;
    const maxLat = Math.max(...lats) + 0.005;
    const minLng = Math.min(...lngs) - 0.005;
    const maxLng = Math.max(...lngs) + 0.005;

    const relevantElements = [];
    for (const el of globalOsmElements.values()) {
        const midLat = (el.lat1 + el.lat2) / 2;
        const midLon = (el.lon1 + el.lon2) / 2;
        if (midLat >= minLat && midLat <= maxLat && midLon >= minLng && midLon <= maxLng) {
            relevantElements.push(el);
        }
    }

    return { elements: relevantElements };
}

async function fetchTileData(tileKey) {
    const bbox = getBBoxForTile(tileKey);
    const centerLat = (bbox.minLat + bbox.maxLat) / 2;
    const centerLng = (bbox.minLng + bbox.maxLng) / 2;

    // Radius should cover the diagonal of the tile plus a small buffer
    const radiusMeters = (TILE_SIZE * 111320) * 0.8; // Approx radius from center to corners

    const url = `${OVERPASS_API}?lat=${centerLat}&lon=${centerLng}&radius=${radiusMeters}`;

    try {
        return await fetchWithRetry(url, { method: 'GET' });
    } catch (error) {
        console.error(`Failed to fetch OSM tile ${tileKey}:`, error);
        return { elements: [] };
    }
}

export async function fetchAmenitiesInBounds(bounds, type) {
    if (!bounds || !type) return { elements: [] };

    // 1. Identify all tiles covering the bounds
    const requiredTiles = new Set();
    const minLat = bounds.getSouth();
    const maxLat = bounds.getNorth();
    const minLng = bounds.getWest();
    const maxLng = bounds.getEast();

    for (let lat = minLat; lat <= maxLat + TILE_SIZE; lat += TILE_SIZE) {
        for (let lng = minLng; lng <= maxLng + TILE_SIZE; lng += TILE_SIZE) {
            requiredTiles.add(getTileKey(lat, lng));
        }
    }

    // 2. Ensure tiles are fetched
    const missingTiles = Array.from(requiredTiles).filter(key => !fetchedTiles.has(key));

    if (missingTiles.length > 0) {
        const BATCH_SIZE = 4;
        for (let i = 0; i < missingTiles.length; i += BATCH_SIZE) {
            const batch = missingTiles.slice(i, i + BATCH_SIZE);
            const promises = batch.map(key => fetchTileData(key));
            const results = await Promise.all(promises);

            results.forEach((data, index) => {
                const key = batch[index];
                if (data && data.elements) {
                    data.elements.forEach(el => {
                        const compKey = `${el.id}_${el.lat1.toFixed(6)}_${el.lon1.toFixed(6)}_${el.lat2.toFixed(6)}_${el.lon2.toFixed(6)}`;
                        globalOsmElements.set(compKey, el);
                    });
                    fetchedTiles.add(key);
                }
            });
        }
    }

    // 3. Filter global pool for amenities of specific type in current view
    const relevantElements = [];

    for (const el of globalOsmElements.values()) {
        const midLat = (el.lat1 + el.lat2) / 2;
        const midLon = (el.lon1 + el.lon2) / 2;

        if (midLat >= minLat && midLat <= maxLat && midLon >= minLng && midLon <= maxLng) {
            // Check if it matches the amenity type
            // The backend returns all tags in el.tags
            if (el.tags && (
                el.tags.amenity === type ||
                el.tags.leisure === type ||
                el.tags.shop === type ||
                el.tags.tourism === type ||
                el.tags.craft === type ||
                el.tags.office === type ||
                el.tags.man_made === type
            )) {
                relevantElements.push(el);
            }
        }
    }

    return { elements: relevantElements };
}

function pointToSegmentDistance(plat, plon, lat1, lon1, lat2, lon2) {
    // Account for longitude compression
    const cosLat = Math.cos(plat * Math.PI / 180);

    const dlat = lat2 - lat1;
    const dlon = (lon2 - lon1) * cosLat;
    const l2 = dlat * dlat + dlon * dlon;

    const dpLat1 = plat - lat1;
    const dpLon1 = (plon - lon1) * cosLat;

    if (l2 === 0) {
        return Math.sqrt(dpLat1 * dpLat1 + dpLon1 * dpLon1);
    }

    let t = (dpLat1 * dlat + dpLon1 * dlon) / l2;
    t = Math.max(0, Math.min(1, t));

    const projLat = lat1 + t * (lat2 - lat1);
    const projLon = lon1 + t * (lon2 - lon1);

    const dFinalLat = plat - projLat;
    const dFinalLon = (plon - projLon) * cosLat;

    return Math.sqrt(dFinalLat * dFinalLat + dFinalLon * dFinalLon);
}

export async function matchOSMDataToRouteAsync(osmData, routePoints, options = {}) {
    const {
        batchSize = 100,
        onProgress = null,
        signal = null
    } = options;

    if (!osmData || !osmData.elements || osmData.elements.length === 0) {
        return routePoints.map(() => ({ highway: 'unknown', surface: 'unknown', smoothness: 'unknown' }));
    }

    const elements = osmData.elements;
    const GRID_SIZE = 0.01;
    const grid = new Map();

    for (const el of elements) {
        const midLat = (el.lat1 + el.lat2) / 2;
        const midLon = (el.lon1 + el.lon2) / 2;
        const gx = Math.floor(midLat / GRID_SIZE);
        const gy = Math.floor(midLon / GRID_SIZE);
        const key = `${gx},${gy}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(el);
    }

    const MAX_DIST_DEG = 0.00045;
    const matchedResults = new Array(routePoints.length);
    let lastWayId = null;
    let lastHighway = null;

    // Helper to process a single batch
    const matchPoint = (point, lastWayId, lastHighway) => {
        let closestElement = null;
        let maxScore = -Infinity;
        let bestDist = Infinity;

        const gx = Math.floor(point.lat / GRID_SIZE);
        const gy = Math.floor(point.lng / GRID_SIZE);

        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const key = `${gx + dx},${gy + dy}`;
                const cell = grid.get(key);
                if (!cell) continue;

                for (const el of cell) {
                    if (el.type === 'node' || (el.lat1 === el.lat2 && el.lon1 === el.lon2)) {
                        continue;
                    }

                    const dist = pointToSegmentDistance(point.lat, point.lng, el.lat1, el.lon1, el.lat2, el.lon2);
                    if (dist > MAX_DIST_DEG) continue;

                    const hw = el.tags?.highway || 'unknown';
                    const priority = HIGHWAY_PRIORITY[hw] || 0;
                    const distMeters = dist * 111320;

                    let score = priority - (distMeters * 35);

                    if (el.tags?.tunnel === 'yes') score -= 60;
                    if (el.tags?.layer && parseInt(el.tags.layer) < 0) score -= 50;

                    if (el.id === lastWayId) {
                        score += 50;
                    } else if (hw === lastHighway) {
                        score += 30;
                    }

                    if (score > maxScore) {
                        maxScore = score;
                        closestElement = el;
                        bestDist = dist;
                    }
                }
            }
        }

        if (!closestElement || bestDist > MAX_DIST_DEG || !closestElement.tags) {
            return {
                result: { highway: 'unknown', surface: 'unknown', smoothness: 'unknown' },
                wayId: null,
                highway: 'unknown'
            };
        }

        return {
            result: {
                highway: closestElement.tags.highway || 'unknown',
                surface: closestElement.tags.surface || 'unknown',
                smoothness: closestElement.tags.smoothness || 'unknown'
            },
            wayId: closestElement.id,
            highway: closestElement.tags.highway || 'unknown'
        };
    };

    return new Promise((resolve, reject) => {
        let currentIndex = 0;

        function processNextBatch() {
            if (signal && signal.aborted) {
                return reject(new Error('Aborted'));
            }

            const end = Math.min(currentIndex + batchSize, routePoints.length);
            for (; currentIndex < end; currentIndex++) {
                const { result, wayId, highway } = matchPoint(routePoints[currentIndex], lastWayId, lastHighway);
                matchedResults[currentIndex] = result;
                lastWayId = wayId;
                lastHighway = highway;
            }

            if (onProgress) {
                onProgress(currentIndex / routePoints.length);
            }

            if (currentIndex < routePoints.length) {
                requestAnimationFrame(processNextBatch);
            } else {
                // Post-process smoothing
                for (let i = 1; i < matchedResults.length - 1; i++) {
                    const prev = matchedResults[i - 1].highway;
                    const curr = matchedResults[i].highway;
                    const next = matchedResults[i + 1].highway;

                    if (curr !== prev && prev === next) {
                        matchedResults[i] = { ...matchedResults[i - 1] };
                    }
                }
                resolve(matchedResults);
            }
        }

        requestAnimationFrame(processNextBatch);
    });
}

export function matchOSMDataToRoute(osmData, routePoints) {
    if (!osmData || !osmData.elements || osmData.elements.length === 0) {
        return routePoints.map(() => ({ highway: 'unknown', surface: 'unknown', smoothness: 'unknown' }));
    }

    const elements = osmData.elements;

    // Build a simple spatial hash for the elements (segments)
    const GRID_SIZE = 0.01;
    const grid = new Map();

    for (const el of elements) {
        // Use midpoint of segment for grid bucket
        const midLat = (el.lat1 + el.lat2) / 2;
        const midLon = (el.lon1 + el.lon2) / 2;
        const gx = Math.floor(midLat / GRID_SIZE);
        const gy = Math.floor(midLon / GRID_SIZE);
        const key = `${gx},${gy}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(el);
    }

    // Match each route point to closest segment
    const MAX_DIST_DEG = 0.00045; // ~50 meters max radius

    let lastWayId = null;
    let lastHighway = null;

    const matchedResults = routePoints.map((point) => {
        let closestElement = null;
        let maxScore = -Infinity;
        let bestDist = Infinity;

        const gx = Math.floor(point.lat / GRID_SIZE);
        const gy = Math.floor(point.lng / GRID_SIZE);

        // Search current and neighboring grid cells
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const key = `${gx + dx},${gy + dy}`;
                const cell = grid.get(key);
                if (!cell) continue;

                for (const el of cell) {
                    // Filter out nodes (bus stops, speed cameras, etc.)
                    // Route points should only match to road segments (ways).
                    if (el.type === 'node' || (el.lat1 === el.lat2 && el.lon1 === el.lon2)) {
                        continue;
                    }

                    const dist = pointToSegmentDistance(point.lat, point.lng, el.lat1, el.lon1, el.lat2, el.lon2);

                    if (dist > MAX_DIST_DEG) continue;

                    const hw = el.tags?.highway || 'unknown';
                    const priority = HIGHWAY_PRIORITY[hw] || 0;

                    // Score combines distance, priority, continuity, and verticality
                    const distMeters = dist * 111320;

                    // Base score: distance penalty is now more aggressive
                    let score = priority - (distMeters * 35);

                    // Verticality Penalty (Avoid snapping into tunnels)
                    if (el.tags?.tunnel === 'yes') {
                        score -= 60; // Significant penalty for tunnels
                    }
                    if (el.tags?.layer && parseInt(el.tags.layer) < 0) {
                        score -= 50; // Penalty for underground segments
                    }

                    // Continuity bonuses (Sticky Matching)
                    if (el.id === lastWayId) {
                        score += 50; // Strong preference for same way
                    } else if (hw === lastHighway) {
                        score += 30; // Medium preference for same road type
                    }

                    if (score > maxScore) {
                        maxScore = score;
                        closestElement = el;
                        bestDist = dist;
                    }
                }
            }
        }

        if (!closestElement || bestDist > MAX_DIST_DEG || !closestElement.tags) {
            lastWayId = null;
            lastHighway = 'unknown';
            return { highway: 'unknown', surface: 'unknown', smoothness: 'unknown' };
        }

        lastWayId = closestElement.id;
        lastHighway = closestElement.tags.highway || 'unknown';

        return {
            highway: closestElement.tags.highway || 'unknown',
            surface: closestElement.tags.surface || 'unknown',
            smoothness: closestElement.tags.smoothness || 'unknown'
        };
    });

    // Post-process smoothing: 3-point mode filter to remove single-point flickers
    for (let i = 1; i < matchedResults.length - 1; i++) {
        const prev = matchedResults[i - 1].highway;
        const curr = matchedResults[i].highway;
        const next = matchedResults[i + 1].highway;

        if (curr !== prev && prev === next) {
            // Flicker detected: [A, B, A] -> [A, A, A]
            matchedResults[i] = { ...matchedResults[i - 1] };
        }
    }

    return matchedResults;
}
