#!/bin/bash
# Deploy moenet-core to production
# Usage: ./deploy.sh [version]

set -e

VERSION=${1:-latest}
COMPOSE_FILE="docker-compose.prod.yml"

echo "🚀 Deploying moenet-core version: $VERSION"

# Check if .env exists
if [ ! -f .env ]; then
    echo "❌ .env file not found. Copy from .env.example and configure."
    exit 1
fi

# Pull latest images
echo "📦 Pulling images..."
VERSION=$VERSION docker compose -f $COMPOSE_FILE pull

# Start services
echo "🔄 Starting services..."
VERSION=$VERSION docker compose -f $COMPOSE_FILE up -d

# Wait for health
echo "⏳ Waiting for services to be healthy..."
sleep 10

# Check health
if curl -sf http://localhost:3000/health > /dev/null; then
    echo "✅ API is healthy"
else
    echo "❌ API health check failed"
    docker compose -f $COMPOSE_FILE logs api
    exit 1
fi

# Clean up
echo "🧹 Cleaning up..."
docker system prune -f

echo "✅ Deployment complete!"
docker compose -f $COMPOSE_FILE ps
