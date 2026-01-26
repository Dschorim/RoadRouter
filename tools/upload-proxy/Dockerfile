# Minimal Dockerfile for upload-proxy (magpx-js)
FROM node:18-bullseye

# create app directory
WORKDIR /usr/src/app

# install build deps for any native modules (Debian)
RUN apt-get update && apt-get install -y python3 make g++ build-essential --no-install-recommends && rm -rf /var/lib/apt/lists/*

# copy package files and install production dependencies
COPY package*.json ./
# Use `npm ci` with the generated lockfile to ensure reproducible installs.
# Retry a few times and verify/clean npm cache to mitigate transient registry/tarball integrity errors.
RUN set -e; npm cache verify || npm cache clean --force; \
    success=0; \
    for i in 1 2 3; do \
        if npm ci --omit=dev --no-audit --no-fund; then success=1; break; else echo "npm ci failed, retrying ($i)" && npm cache clean --force && sleep 1; fi; \
    done; \
    if [ "$success" -ne 1 ]; then echo "ERROR: npm ci failed after 3 attempts" >&2; exit 1; fi; \
    npm cache clean --force

# copy app sources
COPY . .

# ensure uploads directory exists and is writable
RUN mkdir -p /usr/src/app/uploads && chown -R node:node /usr/src/app/uploads

# run as non-root
USER node

EXPOSE 3001
CMD ["node", "server.js"]
