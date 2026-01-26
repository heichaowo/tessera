/**
 * Localization Module - Bilingual Messages (EN/CN)
 */

export type Locale = 'en' | 'zh';

/**
 * Get user's locale from language_code
 */
export function getLocale(languageCode?: string): Locale {
    if (languageCode?.startsWith('zh')) {
        return 'zh';
    }
    return 'en';
}

/**
 * Bilingual message type
 */
type BilingualMessage = {
    en: string;
    zh: string;
};

/**
 * Format message with locale
 */
export function t(msg: BilingualMessage, locale: Locale = 'en'): string {
    return msg[locale];
}

/**
 * Format bilingual message (shows both)
 */
export function bi(msg: BilingualMessage): string {
    return `${msg.en}\n${msg.zh}`;
}

// Common messages
export const MSG = {
    // Errors
    NOT_LOGGED_IN: {
        en: '❌ Please /login first',
        zh: '❌ 请先登录 /login',
    },
    INVALID_ASN: {
        en: '❌ Invalid ASN. DN42 range: 4242420000-4242429999',
        zh: '❌ 无效 ASN。DN42 范围: 4242420000-4242429999',
    },
    RATE_LIMITED: {
        en: '⏱️ Rate limited. Please wait.',
        zh: '⏱️ 请求过于频繁，请稍候。',
    },
    CANCELLED: {
        en: '🚫 Operation cancelled.',
        zh: '🚫 操作已取消。',
    },
    ERROR: {
        en: '❌ An error occurred.',
        zh: '❌ 发生错误。',
    },

    // Auth
    LOGIN_ASK_ASN: {
        en: '🔐 Please enter your ASN:',
        zh: '🔐 请输入你的 ASN:',
    },
    LOGIN_CHOOSE_METHOD: {
        en: 'Choose authentication method:',
        zh: '选择认证方式:',
    },
    LOGIN_SUCCESS: {
        en: '✅ Login successful!',
        zh: '✅ 登录成功!',
    },
    LOGOUT_SUCCESS: {
        en: '👋 Logged out.',
        zh: '👋 已退出登录。',
    },

    // Peer
    PEER_CREATED: {
        en: '✅ Peer created successfully!',
        zh: '✅ Peer 创建成功!',
    },
    PEER_MODIFIED: {
        en: '✅ Peer modified successfully!',
        zh: '✅ Peer 修改成功!',
    },
    PEER_REMOVED: {
        en: '✅ Peer removed successfully!',
        zh: '✅ Peer 已删除!',
    },
    PEER_RESTARTED: {
        en: '✅ Peer restarted successfully!',
        zh: '✅ Peer 已重启!',
    },
    NO_PEERS: {
        en: 'ℹ️ You have no active peers.',
        zh: 'ℹ️ 你没有活跃的 Peer。',
    },

    // Network
    PING_RUNNING: {
        en: '🏓 Pinging...',
        zh: '🏓 正在 Ping...',
    },
    TRACE_RUNNING: {
        en: '🔀 Tracing route...',
        zh: '🔀 正在追踪路由...',
    },
    WHOIS_RUNNING: {
        en: '🔍 Looking up...',
        zh: '🔍 正在查询...',
    },

    // Help
    WELCOME: {
        en: '🌐 *MoeNet DN42 Bot*\n\nWelcome to MoeNet DN42 Network.',
        zh: '🌐 *MoeNet DN42 Bot*\n\n欢迎来到 MoeNet DN42 网络。',
    },
} as const;

/**
 * Format message with parameters
 */
export function fmt(
    msg: BilingualMessage,
    params: Record<string, string | number>,
    locale: Locale = 'en'
): string {
    let text = msg[locale];
    for (const [key, value] of Object.entries(params)) {
        text = text.replace(`{${key}}`, String(value));
    }
    return text;
}
