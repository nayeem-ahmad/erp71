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
});
