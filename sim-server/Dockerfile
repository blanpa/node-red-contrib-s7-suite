FROM node:22-bookworm-slim

# node-snap7 compiles native bindings, so we need a toolchain.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        python3 \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server.js ./

# ISO-on-TCP default port. Each container listens on 102 internally;
# host port mapping happens in docker-compose.sim.yml.
EXPOSE 102

CMD ["node", "server.js"]
