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
- ✅ **Address search** - Search for locations by name with autocomplete suggestions
- ✅ **User location detection** - Auto-focuses map on user's current location on page load

### User Interface
- ✅ **Dark mode toggle** - Switch between dark and light map modes
- ✅ **Modern design** - Clean, minimalist interface with pastel colors (greens, oranges, blues, purples)
- ✅ **Map markers** - A/B labels for start/destination, numbered labels for waypoints
- ✅ **Responsive design** - Works across different screen sizes
- ✅ **Context menu** - Right-click on map (outside route) to set start, destination, or add waypoint
- ✅ **Route info panel** - Displays total distance and duration
- ✅ **Import/Export GPX** - Import and export routes as GPX files

### Elevation Profile
- ✅ **Elevation chart** - Interactive elevation profile graph for your route
- ✅ **Gradient coloring** - Segments colored by steepness (yellow/orange/red/purple for climbs)
- ✅ **Elevation statistics** - Shows total elevation gain, loss, and average
- ✅ **Interactive hover** - Hover over chart to see location on map

### Debug Mode
- ✅ **Speed visualization** - Overlay showing road speeds from OSRM tiles
- ✅ **Color-coded legend** - Speed range with adaptive coloring
- ✅ **Dark mode compatible** - Colors automatically adjust for dark/light modes

## Project Structure

```
frontend/
├── index.html              # Main HTML page
├── Dockerfile              # Docker configuration for frontend service
├── serve.py                # Development server with elevation data support
├── css/
│   └── styles.css          # All styling (dark mode, pastel theme, responsive)
└── js/
    ├── config.js           # Configuration (API endpoints, map center, etc.)
    ├── utils.js            # Utility functions (distance/duration formatting)
    ├── geocoding.js        # Reverse geocoding with rate limiting and caching
    ├── elevation.js        # Elevation API client
    ├── main.js             # App entry point (initialization, route calculation, GPX)
    └── modules/
        ├── state.js        # Centralized application state (APP object)
        ├── map.js          # Map initialization, tile layers, dark mode toggle
        ├── ui.js           # UI rendering, markers, drag-and-drop, click handling
        ├── autocomplete.js # Location search autocomplete functionality
        ├── debug.js        # Debug visualization (speed overlay, MVT tiles)
        ├── mvt_parser.js   # Mapbox Vector Tile parser for debug mode
        ├── elevation_renderer.js  # Elevation chart rendering with gradients
        └── utils_local.js  # Local utility functions
```

## Getting Started

### Prerequisites
- Docker and Docker Compose
- OSRM backend running on `http://localhost:5000`
- Photon backend running on `http://localhost:2322`
- Elevation API running on `http://localhost:5003` (optional)

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
- `ELEVATIONAPI` - Elevation API URL
- `COUNTRYCODES` - Supported country codes
- `ENABLE_DEBUG_MODE` - Toggle debug visualization

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
- **Search**: Type in text field for autocomplete suggestions

### Dark Mode
- Click the moon icon in the sidebar header to toggle dark/light map

### Debug Mode
- Click the bug icon to visualize road speeds (only visible at zoom 15+)

### Importing/Exporting
- Use import/export icons in sidebar header for GPX files

## Technical Details

### State Management
- All route points stored in `APP.routePoints` (centralized app state in `modules/state.js`)
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
- **Search**: `GET /api?q={query}&limit=5&lang=en`
- **Reverse**: `GET /reverse?lon={lng}&lat={lat}&limit=1`

### Elevation
- **Single**: `GET /api/v1/elevation?lat={lat}&lng={lng}`
- **Batch**: `POST /api/v1/elevation/batch` with `{points: [{lat, lng}, ...]}`

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
