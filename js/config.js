// config.js
const CONFIG = {
    MAPCENTER: [50.8, 10.0], // Initial map center; set to preferred region
    MAPZOOM: 7,
    OSRMAPI: 'http://localhost:5000',
    PHOTONAPI: 'http://localhost:2322',
    COUNTRYCODES: '', // Optional; the available area is determined by the OSRM backend PBF

    // Upload proxy (optional): URL of a small local server that runs magpx and performs OneLapFit uploads.
    // If not running, the frontend will fall back to direct GPX download.
    UPLOAD_PROXY_URL: 'http://localhost:3001/api/upload',
    UPLOAD_TIMEOUT_MS: 60_000,
    MAPBOX_TOKEN: '', // Optional: set your Mapbox token here for Direct Upload (or enter in UI)

    ENABLE_DEBUG_MODE: true  // Toggle debug mode feature on/off
};

export default CONFIG;
