function formatDistance(meters) {
    if (meters >= 1000) {
        return (meters / 1000).toFixed(1) + ' km';
    }
    return Math.round(meters) + ' m';
}

function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
}
