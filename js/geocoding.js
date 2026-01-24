import CONFIG from './config.js';

// Simple reverse geocoding with cache (no rate limiting)
const geocodingCache = {};

export async function reverseGeocodeWithRateLimit(lat, lng) {
    const cacheKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;

    if (geocodingCache[cacheKey]) {
        return geocodingCache[cacheKey];
    }

    try {
        const resp = await fetch(`${CONFIG.PHOTONAPI}/reverse?lon=${lng}&lat=${lat}&limit=1`);
        const result = await resp.json();
        let address = 'Unknown location';

        if (result.features && result.features.length > 0) {
            const feature = result.features[0];
            const props = feature.properties || {};

            const parts = [];
            if (props.street) parts.push(props.street + (props.housenumber ? (' ' + props.housenumber) : ''));
            if (props.city) parts.push(props.city);
            if (props.country) parts.push(props.country);

            address = parts.length > 0 ? parts.join(', ') : (props.name || 'Unknown location');
        }

        geocodingCache[cacheKey] = address;
        return address;
    } catch (error) {
        console.error('Geocoding failed:', error);
        return 'Unknown location';
    }
}
