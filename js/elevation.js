/**
 * Elevation module - uses the elevation API server
 * API endpoints:
 *   - GET /api/v1/elevation?lat={lat}&lng={lng}
 *   - POST /api/v1/elevation/batch with {points: [{lat, lng}, ...]}
 */

import CONFIG from './config.js';

const API_BASE_URL = CONFIG.ELEVATIONAPI;

/**
 * Initialize the elevation module
 */
async function initialize() {
    // Check API health on init
    try {
        const response = await fetch(`${API_BASE_URL}/api/v1/health`);
        if (!response.ok) {
            console.warn('[Elevation] API health check failed');
        }
    } catch (e) {
        console.error('[Elevation] Failed to connect to elevation API:', e);
    }
}

/**
 * Get elevation at a specific lat/lon coordinate
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @returns {number|null} - Elevation in meters, or null if not found
 */
async function getElevation(lat, lon) {
    try {
        const response = await fetch(
            `${API_BASE_URL}/api/v1/elevation?lat=${lat}&lng=${lon}`
        );
        
        if (!response.ok) {
            if (response.status === 404) {
                // No elevation data for this location
                return null;
            }
            throw new Error(`API error: ${response.status}`);
        }
        
        const data = await response.json();
        return data.elevation;
    } catch (e) {
        console.error(`[Elevation] Error fetching elevation at lat=${lat}, lon=${lon}:`, e);
        return null;
    }
}

/**
 * Get elevations for multiple points using batch API
 * @param {Array} points - Array of {lat, lng, d} objects
 * @returns {Array} - Array of {lat, lng, elev, d} objects
 */
async function getElevations(points) {
    // For small batches or single points, use individual requests
    if (points.length <= 5) {
        const results = [];
        for (const point of points) {
            const elev = await getElevation(point.lat, point.lng);
            results.push({
                lat: point.lat,
                lng: point.lng,
                elev: elev !== null ? elev : 0,
                d: point.d
            });
        }
        return results;
    }
    
    // For larger batches, use the batch API
    try {
        const requestPoints = points.map(p => ({ lat: p.lat, lng: p.lng }));
        
        const response = await fetch(`${API_BASE_URL}/api/v1/elevation/batch`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ points: requestPoints })
        });
        
        if (!response.ok) {
            throw new Error(`Batch API error: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Map results back to original points with distance info
        const results = data.results.map((result, index) => ({
            lat: result.lat,
            lng: result.lng,
            elev: result.elevation !== null ? result.elevation : 0,
            d: points[index].d
        }));
        
        return results;
    } catch (e) {
        console.error('[Elevation] Batch request failed, falling back to individual requests:', e);
        
        // Fallback to individual requests
        const results = [];
        for (const point of points) {
            const elev = await getElevation(point.lat, point.lng);
            results.push({
                lat: point.lat,
                lng: point.lng,
                elev: elev !== null ? elev : 0,
                d: point.d
            });
        }
        return results;
    }
}

/**
 * Preload function - no longer needed with API, kept for compatibility
 */
async function preloadAll() {
    // No-op with API backend
}

export { initialize, getElevation, getElevations, preloadAll };
