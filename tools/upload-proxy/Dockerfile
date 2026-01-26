# Minimal Dockerfile for upload-proxy (magpx-js)
FROM node:18-bullseye

# create app directory
WORKDIR /usr/src/app

# install build deps for any native modules (Debian)
RUN apt-get update && apt-get install -y python3 make g++ build-essential --no-install-recommends && rm -rf /var/lib/apt/lists/*

# copy package files and install production dependencies
COPY package*.json ./
# Use `npm ci` with the generated lockfile to ensure reproducible installs
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# copy app sources
COPY . .

# ensure uploads directory exists and is writable
RUN mkdir -p /usr/src/app/uploads && chown -R node:node /usr/src/app/uploads

# run as non-root
USER node

EXPOSE 3001
CMD ["node", "server.js"]
