import { isContentGuardrailBlock } from './feedback-agent-runner.service';

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
