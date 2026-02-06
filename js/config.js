// config.js
const CONFIG = {
    MAPCENTER: [50.8, 10.0], // Initial map center; set to preferred region
    MAPZOOM: 7,
    OSRMAPI: '/osrm',
    PHOTONAPI: '/photon',
    ELEVATIONAPI: '', // Empty because the code appends /api/v1/..., which matches our proxy root
    COUNTRYCODES: '', // Optional; the available area is determined by the OSRM backend PBF

    UPLOAD_TIMEOUT_MS: 60_000,
    MAPBOX_TOKEN: '', // Optional: set your Mapbox token here for Direct Upload (or enter in UI)

    ENABLE_DEBUG_MODE: true,  // Toggle debug mode feature on/off

    // Elevation data source: 'tiff' uses the elevation.js module (which now calls our API)
    ELEVATION_SOURCE: 'tiff',
};

export default CONFIG;
