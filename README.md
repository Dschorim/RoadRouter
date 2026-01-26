# Route Planner

A modern, interactive route planning application. The application uses OSRM (Open Source Routing Machine) for routing and Photon for reverse geocoding. The spatial coverage of the app depends on the PBF used by your OSRM backend — configure the backend to change which area is routable.

## Features

### Core Routing Features
- ✅ **Multi-point routing** - Plan routes with start point, destination, and multiple waypoints
- ✅ **Automatic route calculation** - Routes recalculate automatically when points are added, removed, or modified
- ✅ **Route visualization** - Routes display on the map with distance and duration information
- ✅ **Real-time preview** - Route updates every 0.5s while dragging waypoints (throttled for performance)

### Point Management
- ✅ **Add start point** - Click map to set starting location
- ✅ **Add destination** - Click map to set destination (becomes waypoint if already set)
- ✅ **Add waypoints** - Click on the route line to insert waypoint at that location
- ✅ **Drag waypoints** - Drag pins on map to reposition waypoints with live route preview
- ✅ **Reorder waypoints** - Drag waypoint items in sidebar to reorder (triggers recalculation)
- ✅ **Remove points** - Remove any waypoint or destination via button or context menu
- ✅ **Focused input editing** - Click on waypoint text field, then click on map to update that specific point
- ✅ **Last waypoint handling** - When destination is removed, last waypoint automatically becomes new destination

### Geocoding & Location Display
- ✅ **Reverse geocoding** - Coordinates display as human-readable addresses (street name, house number, city, country)
- ✅ **Rate-limited geocoding** - Geocoding requests queued with 0.5s delay between requests to avoid API limits
- ✅ **Geocoding cache** - Recently geocoded locations cached to reduce API calls
- ✅ **Address search** - Search for locations by name in initial search box, press Enter for best match
- ✅ **User location detection** - Auto-focuses map on user's current location on page load

### User Interface
- ✅ **Dark mode** - Fully styled for dark mode with pastel color scheme
- ✅ **Modern design** - Clean, minimalist interface with pastel colors (greens, oranges, blues, purples)
- ✅ **Map markers** - A/B labels for start/destination, numbered labels for waypoints
- ✅ **Responsive design** - Works across different screen sizes
- ✅ **Context menu** - Right-click on map (outside route) to set start, destination, or add waypoint
- ✅ **Route info panel** - Displays total distance and duration
- ✅ **Export GPX** - Export the current route as a GPX file for import into other services.
- ✅ **Export to Device (Magene)** - Upload the route directly to a Magene device via the optional local upload proxy (uses the open-source magpx tool). See the "Export to Device" section below for setup.

### Advanced Features
- ✅ **Drag-and-drop on route** - Click and drag on route line to create and immediately grab new waypoint
- ✅ **Route preview** - Visual feedback when hovering over route areas
- ✅ **Zoom level persistence** - Map maintains zoom level after dragging waypoints
- ✅ **Debug mode** - Optional visualization of road speeds and network topology

## Project Structure

```
frontend/
├── index.html           # Main HTML page
├── Dockerfile          # Docker configuration for frontend service
├── css/
│   └── styles.css      # All styling (dark mode, pastel theme, responsive)
└── js/
    ├── config.js       # Configuration (API endpoints, map center, etc.)
    ├── utils.js        # Utility functions (distance/duration formatting)
    ├── geocoding.js    # Reverse geocoding with rate limiting and caching
    ├── modules/        # Smaller feature-focused modules
    │   └── autocomplete.js  # Autocomplete helpers and rendering
    └── main.js         # App entry point (initialization, high-level orchestration)
```

Note: The JavaScript has been refactored into smaller ES modules for better organization and testability (autocomplete features live in `js/modules/autocomplete.js`). The app still runs the same and is loaded via `type="module"` in `index.html`.

## Getting Started

### Prerequisites
- Docker and Docker Compose
- OSRM backend running on `http://localhost:5000`
- Photon backend running on `http://localhost:2322`

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd frontend
```

2. Build and run with Docker Compose:
```bash
docker compose up -d --build
```

3. Open your browser and navigate to:
```
http://localhost:3000
```

## Configuration

Edit `js/config.js` to customize:
- `MAPCENTER` - Initial map center coordinates
- `MAPZOOM` - Initial zoom level
- `OSRMAPI` - OSRM backend URL
- `PHOTONAPI` - Photon backend URL
- `COUNTRYCODES` - Supported country codes
- `ENABLE_DEBUG_MODE` - Toggle debug visualization
- `UPLOAD_PROXY_URL` - URL of the optional upload proxy that runs `magpx-js` (default: `http://localhost:3001/api/upload`)
- `UPLOAD_TIMEOUT_MS` - Timeout for proxy uploads in milliseconds

## How to Use

### Setting Start & Destination
1. Click on the map to place start point
2. Click again to place destination
3. Additional clicks will create waypoints

### Adding Waypoints
- **Via map**: Click directly on the route line to insert a waypoint
- **Via sidebar**: Click "Add Point" button

### Editing Points
- **Drag markers**: Grab pins on map to reposition
- **Reorder**: Drag items in sidebar to reorder waypoints
- **Search**: Type in text field or use initial search

### Using Context Menu
- **Right-click** on empty area to set start, destination, or waypoint
- **Right-click on route** opens context menu for that segment

### Export to Device (Magene)
- The app includes an **Export to Device** button that uploads the current route to a Magene device using the OneLapFit workflow implemented by the open-source `magpx` reverse engineering work.
- For privacy and reliability this works via the **local upload proxy** (`tools/upload-proxy`) that runs on your machine and invokes the local JS importer (`magpx-js`) which performs Mapbox map-matching and the OneLapFit upload.

Setup (quick):
1. Copy `tools/upload-proxy/.magpx.json.example` to `tools/upload-proxy/.magpx.json` and fill in your `username`, `password`, and `mapbox_token`.
2. Start the proxy: `cd tools/upload-proxy && npm install && npm start` (default listens on port 3001).
3. Open the app, click **Export to Device**, and choose **Upload via Proxy** or use **Download GPX** to import manually.

Direct Upload (experimental)
- From the **Export to Device** modal you can choose **Direct Upload (experimental)** which attempts the full Mapbox map-matching and OneLapFit upload directly from your browser (no local proxy required).
- Requirements: a valid Mapbox token (set `js/config.js` -> `MAPBOX_TOKEN` or enter it in the modal), and your OneLapFit username/password.
- Caveat: OneLapFit may not allow cross-origin browser requests (CORS). If the server blocks browser requests the direct upload will fail — in that case run the local proxy or use the GPX download/import method.

Credits
- The import format and OneLapFit conversion logic are heavily inspired by Jerome Cornet's original `magpx` project: https://github.com/jeromecornet/magpx. Thanks to Jerome for the reverse-engineering work that made this possible.

If you prefer not to run the proxy, use **Download GPX** from the modal and import the file manually with your preferred workflow.
## Technical Details

### State Management
- All route points stored in `APP.routePoints` (centralized app state)
- Each point has: id, lat, lng, address, type (start/dest/waypoint)
- Automatic type updates maintain start/destination positions

### Route Calculation
- Uses OSRM `route/v1/driving` endpoint
- Supports multiple waypoints in optimal order
- Live preview while dragging (throttled to 0.5s intervals)

### Geocoding
- Uses Photon reverse geocoding
- Requests queued to respect API rate limits (0.5s between requests)
- Results cached to minimize API calls
- Fallback to coordinates if reverse geocoding fails

### Performance Optimizations
- Debounced route calculations (500ms)
- Throttled preview updates (500ms)
- Geocoding queue with rate limiting
- Efficient DOM updates

## API Endpoints

### OSRM
- **Route**: `GET /route/v1/driving/{coordinates}?overview=full&geometries=geojson&steps=true`
- **Tiles**: `GET /tile/v1/driving/tile(x,y,z).mvt` (debug mode only)

### Photon

- **Search**: `GET /api?q={query}&limit=1&lang=en`
- **Reverse**: `GET /reverse?lon={lng}&lat={lat}&limit=1`- **Reverse**: `GET /reverse?lon={lng}&lat={lat}&limit=1`
- **Search**: `GET /search?q={query}&limit=1&countrycodes={codes}`

## Browser Compatibility

- Chrome/Chromium 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## License

See LICENSE file for details.

## Contributing

Contributions welcome! Please ensure:
- No dead code or console.logs in production
- All functionality fully implemented (no TODOs)
- Rate limiting respected for API calls
- Cache properly managed
- Dark mode styling maintained
