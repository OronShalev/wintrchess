FROM node:22-bookworm-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    tar \
    && rm -rf /var/lib/apt/lists/*

# Download and install official Stockfish 19 binary
ARG TARGETARCH
RUN set -eu; \
    ARCH="${TARGETARCH:-amd64}"; \
    if [ "$ARCH" = "arm64" ]; then \
        SF_ARCH="arm64-universal"; \
    else \
        SF_ARCH="x86-64-universal"; \
    fi; \
    echo "Downloading Stockfish 19 binary for ${SF_ARCH}..."; \
    curl -fSL "https://github.com/official-stockfish/Stockfish/releases/download/sf_19/stockfish-linux-${SF_ARCH}.tar.gz" -o /tmp/stockfish.tar.gz; \
    tar -xzf /tmp/stockfish.tar.gz; \
    mv stockfish/stockfish-linux-* /usr/local/bin/stockfish; \
    chmod +x /usr/local/bin/stockfish; \
    rm -rf stockfish /tmp/stockfish.tar.gz; \
    /usr/local/bin/stockfish uci | grep "Stockfish 19"

WORKDIR /app

# Copy dependency specifications
COPY package*.json ./
COPY shared/package*.json ./shared/
COPY server/package*.json ./server/
COPY client/package*.json ./client/

# Install dependencies
RUN npm ci || npm i

# Copy application source code
COPY . .

# Build all workspaces
RUN npm run build -w shared
RUN npm run build -w server
RUN npm run build -w client

ENV STOCKFISH_PATH=/usr/local/bin/stockfish
ENV PORT=8080
ENV NODE_ENV=production

EXPOSE 8080

CMD ["npm", "start"]