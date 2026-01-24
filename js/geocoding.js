// Simplified reverse geocoding via rate-limited queue
async function reverseGeocodeWithRateLimit(lat, lng) {
    const cacheKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
    
    if (geocodingCache[cacheKey]) {
        return geocodingCache[cacheKey];
    }

    return new Promise((resolve) => {
        geocodingQueue.push({ lat, lng, cacheKey, resolve });
        processGeocodingQueue();
    });
}

function processGeocodingQueue() {
    if (geocodingQueue.length === 0) return;
    
    const { lat, lng, cacheKey, resolve } = geocodingQueue.shift();
    
    fetch(`${CONFIG.NOMINATIMAPI}/reverse?lon=${lng}&lat=${lat}&limit=1`)
        .then(r => r.json())
        .then(result => {
            let address = 'Unknown location';
            
            if (result.features && result.features.length > 0) {
                const feature = result.features[0];
                const props = feature.properties;
                
                const parts = [];
                if (props.housenumber) parts.push(props.housenumber);
                if (props.street) parts.push(props.street);
                if (props.city) parts.push(props.city);
                if (props.country) parts.push(props.country);
                
                address = parts.length > 0 ? parts.join(', ') : (props.name || 'Unknown location');
            }
            
            geocodingCache[cacheKey] = address;
            resolve(address);
            
            setTimeout(processGeocodingQueue, 500);
        })
        .catch(error => {
            console.error('Geocoding failed:', error);
            resolve('Unknown location');
            setTimeout(processGeocodingQueue, 500);
        });
}
