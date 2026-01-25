FROM oven/bun:1

WORKDIR /app

# Copy package files
COPY package.json bun.lockb* ./
COPY packages/api/package.json ./packages/api/

# Install dependencies
RUN bun install

# Copy source
COPY packages/api ./packages/api

WORKDIR /app/packages/api

EXPOSE 3000

CMD ["bun", "run", "start"]
