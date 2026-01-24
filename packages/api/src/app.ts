import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { registerRoutes } from './routes';
import { initDatabase } from './db/dbContext';
import { initRedis } from './db/redisContext';
import config from './config';

const app = new Hono();

// Middleware
app.use('*', logger());
app.use('*', cors({
    origin: config.cors.origins,
    credentials: true,
}));

// Health check
app.get('/health', (c) => c.json({ status: 'ok', version: '1.0.0' }));

// Register all routes
registerRoutes(app);

// Initialize connections and start server
async function main() {
    const standalone = process.env.STANDALONE === 'true';

    try {
        if (!standalone) {
            await initDatabase();
            console.log('✅ Database connected');

            await initRedis();
            console.log('✅ Redis connected');
        } else {
            console.log('⚠️  Running in STANDALONE mode (no DB/Redis)');
        }

        console.log(`🚀 Server running on http://localhost:${config.server.port}`);
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

main();

export default {
    port: config.server.port,
    fetch: app.fetch,
};

