# Stage 1: Build the package
FROM node:18-alpine AS builder

RUN apk add --no-cache python3 make g++

WORKDIR /build

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# Stage 2: Node-RED runtime
FROM nodered/node-red:3-18-minimal

USER root

RUN apk add --no-cache python3 make g++

WORKDIR /tmp/s7-suite

COPY package.json package-lock.json ./
COPY --from=builder /build/dist/ ./dist/
COPY LICENSE ./

RUN npm ci --omit=dev && \
    cd /usr/src/node-red && \
    npm install /tmp/s7-suite && \
    rm -rf /tmp/s7-suite

RUN apk del python3 make g++ && \
    rm -rf /root/.npm /tmp/*

USER node-red

WORKDIR /usr/src/node-red

COPY examples/test-flows.json /data/flows.json

EXPOSE 1880

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD wget -qO- http://localhost:1880/ || exit 1
