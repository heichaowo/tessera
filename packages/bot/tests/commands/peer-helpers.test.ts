/**
 * Tests for peer/helpers module
 *
 * Validates the helper functions and button utilities.
 */

import { describe, expect, test } from 'bun:test';
import {
    BUTTONS,
    buttonRow,
    backButtonRow,
    buildKeyboard,
    isBackButton,
    isAbortButton,
    isFinishButton,
    formatEndpoint,
    truncatePubkey,
    modifySuccessMessage,
} from '../../src/commands/peer/helpers';

describe('Button Constants', () => {
    test('BUTTONS should have correct values', () => {
        expect(BUTTONS.BACK).toBe('🔙 Back');
        expect(BUTTONS.FINISH).toBe('Finish modification');
        expect(BUTTONS.ABORT).toBe('Abort modification');
    });
});

describe('Button Row Builders', () => {
    test('buttonRow should create button objects', () => {
        const row = buttonRow('Option 1', 'Option 2');
        expect(row).toEqual([
            { text: 'Option 1' },
            { text: 'Option 2' },
        ]);
    });

    test('backButtonRow should return back button', () => {
        const row = backButtonRow();
        expect(row).toEqual([{ text: '🔙 Back' }]);
    });

    test('buildKeyboard should add back button row', () => {
        const keyboard = buildKeyboard([
            [{ text: 'A' }],
            [{ text: 'B' }],
        ]);
        expect(keyboard.keyboard).toHaveLength(3);
        expect(keyboard.keyboard[2]).toEqual([{ text: '🔙 Back' }]);
        expect(keyboard.resize_keyboard).toBe(true);
    });
});

describe('Button Checkers', () => {
    test('isBackButton should detect back button', () => {
        expect(isBackButton('🔙 Back')).toBe(true);
        expect(isBackButton('Other')).toBe(false);
    });

    test('isAbortButton should detect abort button', () => {
        expect(isAbortButton('Abort modification')).toBe(true);
        expect(isAbortButton('Other')).toBe(false);
    });

    test('isFinishButton should detect finish button', () => {
        expect(isFinishButton('Finish modification')).toBe(true);
        expect(isFinishButton('Other')).toBe(false);
    });
});

describe('Formatting Helpers', () => {
    test('formatEndpoint should format correctly', () => {
        expect(formatEndpoint('host.com', 51820)).toBe('host.com:51820');
        expect(formatEndpoint('host.com')).toBe('host.com');
        expect(formatEndpoint()).toBe('Not set');
    });

    test('truncatePubkey should truncate long keys', () => {
        const longKey = 'abcdefghijklmnopqrstuvwxyz1234567890';
        expect(truncatePubkey(longKey)).toBe('abcdefghijklmnopqrst...');
        expect(truncatePubkey()).toBe('Not set');
    });

    test('modifySuccessMessage should format bilingual message', () => {
        const msg = modifySuccessMessage('MTU', '1420');
        expect(msg).toContain('✅');
        expect(msg).toContain('MTU');
        expect(msg).toContain('1420');
        expect(msg).toContain('已更新');
    });
});
