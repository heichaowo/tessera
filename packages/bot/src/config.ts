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

    // Network settings
    dn42WhoisServer: process.env.DN42_WHOIS_SERVER || 'whois.dn42',
};
