/**
 * MoeNet Core API Configuration
 */

export default {
    server: {
        port: Number(process.env.PORT) || 3000,
        host: process.env.HOST || 'localhost',
    },

    cors: {
        origins: (process.env.CORS_ORIGINS || '*').split(','),
    },

    database: {
        dialect: 'postgres' as const,
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT) || 5432,
        database: process.env.DB_NAME || 'moenet',
        username: process.env.DB_USER || 'moenet',
        password: process.env.DB_PASSWORD || '',
        logging: process.env.NODE_ENV !== 'production',
    },

    redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: Number(process.env.REDIS_PORT) || 6379,
        password: process.env.REDIS_PASSWORD || undefined,
    },

    auth: {
        agentApiKey: process.env.AGENT_API_KEY || '',
        jwtSecret: process.env.JWT_SECRET || 'change-me-in-production',
        jwtExpiresIn: '7d',
    },

    dn42: {
        asn: Number(process.env.DN42_ASN) || 4242420998,
        netName: process.env.DN42_NET_NAME || 'MOENET-DN42',
        ipv4Prefix: process.env.DN42_IPV4_PREFIX || '172.22.188.0/26',
        ipv6Prefix: process.env.DN42_IPV6_PREFIX || 'fd00:4242:7777::/48',
    },

    features: {
        enableTelegramBot: process.env.TELEGRAM_BOT_ENABLED === 'true',
        telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
    },
};
