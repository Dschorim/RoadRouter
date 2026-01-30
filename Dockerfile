FROM node:22-alpine

WORKDIR /app

COPY frontend/index.html ./
COPY frontend/css ./css
COPY frontend/js ./js

EXPOSE 3000

# Simple HTTP server that serves the app
RUN npm install -g http-server

CMD ["http-server", "-p", "3000", "--cors"]
