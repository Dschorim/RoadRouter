// elevation_thumbnail.js - Generate small elevation curve SVG for route thumbnails

export function generateElevationThumbnail(elevationData, width = 200, height = 40) {
    if (!elevationData || elevationData.length < 2) return null;

    const elevations = elevationData.map(d => d.elev);
    const minE = Math.min(...elevations);
    const maxE = Math.max(...elevations);
    const range = maxE - minE;
    
    if (range < 1) return null;

    // Add 4px padding to prevent border clipping
    const pad = 4;
    const innerWidth = width - pad * 2;
    const innerHeight = height - pad * 2;

    // Generate path points with padding
    const points = elevationData.map((d, i) => {
        const x = pad + (i / (elevationData.length - 1)) * innerWidth;
        const y = pad + innerHeight - ((d.elev - minE) / range) * innerHeight;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
        <polyline points="${points}" fill="none" stroke="rgba(50,184,198,0.4)" stroke-width="0.5"/>
        <polyline points="0,${height} ${points} ${width},${height}" fill="rgba(50,184,198,0.15)" stroke="none"/>
    </svg>`;

    return `data:image/svg+xml;base64,${btoa(svg)}`;
}
