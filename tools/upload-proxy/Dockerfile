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
RUN npm cache verify || npm cache clean --force && \
    for i in 1 2 3; do \
        npm ci --omit=dev --no-audit --no-fund && break || (echo "npm ci failed, retrying ($i)" && npm cache clean --force && sleep 1); \
    done && npm cache clean --force

# copy app sources
COPY . .

# ensure uploads directory exists and is writable
RUN mkdir -p /usr/src/app/uploads && chown -R node:node /usr/src/app/uploads

# run as non-root
USER node

EXPOSE 3001
CMD ["node", "server.js"]
