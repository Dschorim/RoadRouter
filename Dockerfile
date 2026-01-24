FROM node:22-alpine

WORKDIR /app

COPY index.html ./
COPY css ./css
COPY js ./js

EXPOSE 3000

# Simple HTTP server that serves the app
RUN npm install -g http-server

CMD ["http-server", "-p", "3000", "--cors"]
