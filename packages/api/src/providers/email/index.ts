/**
 * Email Service Provider
 * 
 * Supports multiple email backends:
 * - Resend API (recommended)
 * - SMTP (fallback)
 */

interface EmailOptions {
    to: string;
    subject: string;
    text?: string;
    html?: string;
}

interface EmailResult {
    success: boolean;
    messageId?: string;
    error?: string;
}

/**
 * Email Provider using Resend API
 */
export class EmailProvider {
    private apiKey: string;
    private fromAddress: string;
    private enabled: boolean;

    constructor() {
        this.apiKey = process.env.RESEND_API_KEY || '';
        this.fromAddress = process.env.EMAIL_FROM || 'noreply@moenet.work';
        this.enabled = !!this.apiKey;
    }

    isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * Send email via Resend API
     */
    async send(options: EmailOptions): Promise<EmailResult> {
        if (!this.enabled) {
            console.warn('[Email] Service disabled - no RESEND_API_KEY');
            return { success: false, error: 'Email service not configured' };
        }

        try {
            const response = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    from: this.fromAddress,
                    to: options.to,
                    subject: options.subject,
                    text: options.text,
                    html: options.html,
                }),
            });

            if (!response.ok) {
                const error = await response.text();
                console.error('[Email] Resend API error:', error);
                return { success: false, error: `API error: ${response.status}` };
            }

            const data = await response.json() as { id: string };
            console.log(`[Email] Sent to ${options.to}, messageId: ${data.id}`);

            return { success: true, messageId: data.id };
        } catch (error) {
            console.error('[Email] Send failed:', error);
            return { success: false, error: String(error) };
        }
    }

    /**
     * Send verification code email
     */
    async sendVerificationCode(to: string, asn: number, code: string): Promise<EmailResult> {
        const subject = `[MoeNet DN42] Verification Code for AS${asn}`;

        const text = `
MoeNet DN42 Autopeering Verification

ASN: AS${asn}
Verification Code: ${code}

This code will expire in 10 minutes.

If you didn't request this, please ignore this email.

---
MoeNet DN42 - https://dn42.moenet.work
        `.trim();

        const html = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
        .container { max-width: 500px; margin: 0 auto; padding: 20px; }
        .code { font-size: 32px; font-weight: bold; color: #2563eb; letter-spacing: 4px; }
        .footer { color: #6b7280; font-size: 12px; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <h2>🌐 MoeNet DN42 Verification</h2>
        <p>Your verification code for <strong>AS${asn}</strong>:</p>
        <p class="code">${code}</p>
        <p>This code will expire in 10 minutes.</p>
        <p class="footer">If you didn't request this, please ignore this email.</p>
    </div>
</body>
</html>
        `.trim();

        return this.send({ to, subject, text, html });
    }

    /**
     * Send peer creation notification
     */
    async sendPeerNotification(to: string, asn: number, node: string, status: string): Promise<EmailResult> {
        const subject = `[MoeNet DN42] Peer ${status} - AS${asn}`;

        const text = `
Your peering request for AS${asn} on ${node} has been ${status.toLowerCase()}.

Node: ${node}
Status: ${status}

Visit our Telegram bot for more details: https://t.me/moenetdn42bot

---
MoeNet DN42 - https://dn42.moenet.work
        `.trim();

        return this.send({ to, subject, text });
    }
}

// Singleton instance
let emailProvider: EmailProvider | null = null;

export function getEmailProvider(): EmailProvider {
    if (!emailProvider) {
        emailProvider = new EmailProvider();
    }
    return emailProvider;
}
