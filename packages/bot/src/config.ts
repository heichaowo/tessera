/**
 * Bot Configuration
 */
export default {
    telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',

    // API endpoint for moenet-core
    apiUrl: process.env.API_URL || 'http://localhost:3000',
    apiToken: process.env.API_TOKEN || '',

    // Admin settings
    adminUsername: process.env.TELEGRAM_ADMIN_USERNAME || '',
    localAsn: Number(process.env.LOCAL_ASN) || 4242420998,

    // Agent default port (used when router doesn't have callbackUrl)
    agentPort: Number(process.env.AGENT_PORT) || 8080,
    agentToken: process.env.AGENT_TOKEN || '',

    // Webhook settings
    webhookEnabled: process.env.WEBHOOK_ENABLED === 'true',
    webhookDomain: process.env.WEBHOOK_DOMAIN || '',
    webhookSecret: process.env.WEBHOOK_SECRET || '',
    webhookPort: Number(process.env.WEBHOOK_PORT) || 8443,

    // Contact info
    telegramContact: process.env.TELEGRAM_CONTACT || '@heicha',
};
