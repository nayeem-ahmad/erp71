import { isContentGuardrailBlock, rejectDestructiveWrite } from './feedback-agent-runner.service';

describe('isContentGuardrailBlock', () => {
    it('flags the observed prompt-injection block (so it is not retried)', () => {
        expect(isContentGuardrailBlock('Request blocked: prompt injection patterns detected')).toBe(true);
    });

    it.each([
        'Content flagged by moderation',
        'Blocked by content policy',
        'Response blocked by safety filter',
        'Input flagged as unsafe',
        'Rejected by provider guardrail',
    ])('flags guardrail message: %s', (msg) => {
        expect(isContentGuardrailBlock(msg)).toBe(true);
    });

    it.each([
        'Rate limit exceeded',
        'Internal server error',
        'Bad gateway',
        'terminated',
        'model not found',
    ])('does not flag transient/other error: %s', (msg) => {
        expect(isContentGuardrailBlock(msg)).toBe(false);
    });
});

describe('rejectDestructiveWrite', () => {
    it('rejects overwriting an existing non-empty file with empty content', () => {
        // The exact failure mode that corrupted navigation.ts: a whole-file rewrite
        // whose content arrived empty, truncating a 493-line tracked file to nothing.
        expect(rejectDestructiveWrite(true, '')).toMatch(/non-empty file/i);
    });

    it('rejects overwriting an existing non-empty file with whitespace-only content', () => {
        expect(rejectDestructiveWrite(true, '   \n\t  ')).toMatch(/non-empty file/i);
    });

    it('rejects creating a new file with empty content', () => {
        // The junk hello.ts/test.ts/test2.ts files were empty creations.
        expect(rejectDestructiveWrite(false, '')).toMatch(/empty file/i);
    });

    it('allows a normal non-empty write over an existing file', () => {
        expect(rejectDestructiveWrite(true, 'export const x = 1;\n')).toBeNull();
    });

    it('allows a normal non-empty new file', () => {
        expect(rejectDestructiveWrite(false, 'export const x = 1;\n')).toBeNull();
    });
});
