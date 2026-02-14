// state.js - Central application state
import CONFIG from '../config.js';

export const APP = {
    map: null,
    routeLayer: null,
    markerLayer: null,
    routePoints: [],
    nextPointId: 1,
    currentRoute: null,
    calculateRouteTimer: null,
    previewRouteTimer: null,
    contextMenuOpen: false,
    activeInputPointId: null,
    draggedElement: null,
    isPolylineMouseDown: false,
    waypointBeingDragged: null,
    mapMarkers: {},
    currentPolyline: null,
    routePolylineMouseDown: false,
    routeMouseMoveHandler: null,
    routeMouseUpHandler: null,
    isDraggingMarker: false,
    draggedMarkerStartPos: null,
    lastPreviewTime: 0,
    previewMarker: null,
    routeClickJustHappened: false,
    lastFocusedInputId: null,
    attachedAutocompleteInputs: new Set(),
    elevationData: null,
    activeRouteId: null,
    activeRouteName: null,
    lastActiveTab: null,
    availableProfiles: [],
    selectedProfile: CONFIG.DEFAULT_PROFILE || 'driving'
};

export function resetAppState() {
    // Utility to reset specific transient state if needed
    APP.isDraggingMarker = false;
    APP.waypointBeingDragged = null;
    APP.draggedElement = null;
}
