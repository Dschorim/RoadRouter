#!/usr/bin/env python3
"""
Simple HTTP server to serve the frontend and elevation data.
Run this from the frontend directory.
"""

import http.server
import socketserver
import os
import sys
import mimetypes
from pathlib import Path

PORT = 3000
FRONTEND_DIR = Path(__file__).parent
ELEVATION_DIR = FRONTEND_DIR / "elevation-data"

class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        # Handle elevation-data paths
        if path.startswith('/elevation-data/'):
            filename = path[len('/elevation-data/'):]
            full_path = str(ELEVATION_DIR / filename)
            return full_path
        
        # Default: serve from frontend directory
        return super().translate_path(path)
    
    def guess_type(self, path):
        # Ensure TIF files are served with correct MIME type
        if path.endswith('.tif') or path.endswith('.tiff'):
            return 'image/tiff'
        return super().guess_type(path)
    
    def end_headers(self):
        # Add CORS headers for TIFF files
        if self.path.startswith('/elevation-data/'):
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
            self.send_header('Cache-Control', 'public, max-age=3600')
        super().end_headers()
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

if __name__ == "__main__":
    os.chdir(FRONTEND_DIR)
    
    print(f"[DEBUG] FRONTEND_DIR: {FRONTEND_DIR}")
    print(f"[DEBUG] ELEVATION_DIR: {ELEVATION_DIR}")
    print(f"[DEBUG] Elevation dir exists: {ELEVATION_DIR.exists()}")
    if ELEVATION_DIR.exists():
        print(f"[DEBUG] Elevation files: {[f.name for f in ELEVATION_DIR.iterdir()]}")
    
    with socketserver.TCPServer(("", PORT), CustomHandler) as httpd:
        print(f"Server running at http://localhost:{PORT}/")
        print(f"Serving frontend from: {FRONTEND_DIR}")
        print(f"Serving elevation data from: {ELEVATION_DIR}")
        print("Press Ctrl+C to stop")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")
            sys.exit(0)
