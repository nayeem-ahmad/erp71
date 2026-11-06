import { InternalServerErrorException } from '@nestjs/common';
import { extractJson } from './extract-json';

/**
 * Models wrap JSON in a fence roughly half the time no matter how firmly the
 * prompt asks them not to, so the fence handling is load-bearing rather than
 * defensive — without it every fenced reply would surface to the user as
 * "invalid response".
 */
describe('extractJson', () => {
    it('parses a bare JSON object', () => {
        expect(extractJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
    });

    it('parses a JSON object wrapped in a ```json fence', () => {
        expect(extractJson<{ a: number }>('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    });

    it('parses a JSON object wrapped in a bare fence', () => {
        expect(extractJson<{ a: number }>('```\n{"a":1}\n```')).toEqual({ a: 1 });
    });

    it('tolerates whitespace around the payload', () => {
        expect(extractJson<{ a: number }>('  \n {"a":1} \n ')).toEqual({ a: 1 });
    });

    it('throws a clean error rather than a SyntaxError on prose', () => {
        expect(() => extractJson('Sure! Here is your post:')).toThrow(InternalServerErrorException);
    });

    it('parses JSON that the model prefaced with a sentence', () => {
        expect(
            extractJson<{ a: number }>('Here are the companies matching the brief:\n{"a":1}'),
        ).toEqual({ a: 1 });
    });

    it('parses JSON that the model followed with extra prose', () => {
        expect(
            extractJson<{ a: number }>('{"a":1}\n\nLet me know if you need more companies.'),
        ).toEqual({ a: 1 });
    });

    it('parses an unclosed markdown fence, which is what a truncated reply looks like', () => {
        expect(extractJson<{ a: number }>('```json\n{"a":1}')).toEqual({ a: 1 });
    });

    it('parses JSON with a trailing comma', () => {
        expect(extractJson<{ a: number; b: number }>('{"a":1,"b":2,}')).toEqual({ a: 1, b: 2 });
    });

    it('recovers a truncated object so a cut-off candidate list is not a hard fail', () => {
        const raw =
            '{"candidates":[{"company_name":"Acme Soft","fit_score":80},{"company_name":"Nexlify","description":"cut off';
        const parsed = extractJson<{ candidates: Array<{ company_name: string }> }>(raw);
        expect(parsed.candidates[0].company_name).toBe('Acme Soft');
        expect(parsed.candidates.map((c) => c.company_name)).toContain('Nexlify');
    });

    it('strips a thinking block that leaked into the visible reply', () => {
        expect(
            extractJson<{ a: number }>('<think>I will list companies.</think>\n{"a":1}'),
        ).toEqual({ a: 1 });
    });
});
