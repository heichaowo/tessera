import { describe, expect, test, beforeAll } from 'bun:test';
import { EmailProvider } from '../src/providers/email';

describe('EmailProvider', () => {
    let provider: EmailProvider;

    beforeAll(() => {
        provider = new EmailProvider();
    });

    describe('isEnabled', () => {
        test('should return false without API key', () => {
            // Without RESEND_API_KEY env var, should be disabled
            const freshProvider = new EmailProvider();
            expect(freshProvider.isEnabled()).toBe(false);
        });
    });

    describe('sendVerificationCode', () => {
        test('should fail gracefully when disabled', async () => {
            const result = await provider.sendVerificationCode(
                'test@example.com',
                4242420998,
                '123456'
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain('not configured');
        });
    });

    describe('send', () => {
        test('should fail gracefully when disabled', async () => {
            const result = await provider.send({
                to: 'test@example.com',
                subject: 'Test',
                text: 'Test message',
            });

            expect(result.success).toBe(false);
        });
    });
});
