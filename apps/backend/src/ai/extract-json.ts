import { InternalServerErrorException } from '@nestjs/common';

const INVALID = 'AI returned an invalid response. Please try again.';

/**
 * Pull a JSON payload out of a model reply.
 *
 * Kept out of `AiService` so pure modules — the blog draft normalizer is the
 * first — can parse a reply without instantiating a Nest provider. The fence
 * stripping is not defensive tidying: models fence their JSON often enough
 * that dropping it would surface as an "invalid response" on half the calls.
 *
 * They also preface the object with a sentence, leave a trailing comma, or
 * get cut off at max_tokens (an unclosed fence, a half-written string). Those
 * replies used to fail the same way; recovering a parseable value is cheaper
 * than making the caller spend the credits again.
 */
export function extractJson<T>(raw: string): T {
    if (typeof raw !== 'string' || !raw.trim()) {
        throw new InternalServerErrorException(INVALID);
    }

    const normalized = stripFences(stripThinking(raw.replace(/^\uFEFF/, ''))).trim();
    const start = indexOfJsonStart(normalized);
    const body = start >= 0 ? normalized.slice(start) : normalized;

    const attempts: string[] = [body, stripTrailingCommas(body)];
    if (start >= 0) {
        const end = endOfJsonValue(normalized, start);
        if (end > start) {
            const slice = normalized.slice(start, end);
            attempts.push(slice, stripTrailingCommas(slice));
        }
    }
    const repaired = repairTruncatedJson(body);
    if (repaired) {
        attempts.push(repaired, stripTrailingCommas(repaired));
    }

    for (const candidate of attempts) {
        try {
            return JSON.parse(candidate) as T;
        } catch {
            // try the next recovery
        }
    }
    throw new InternalServerErrorException(INVALID);
}

function stripThinking(raw: string): string {
    return raw.replace(/<think(?:ing)?\b[^>]*>[\s\S]*?<\/think(?:ing)?>/gi, '');
}

function stripFences(raw: string): string {
    const trimmed = raw.trim();
    const closed = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (closed?.[1] != null) return closed[1].trim();
    const unclosed = trimmed.match(/^```(?:json)?\s*([\s\S]*)$/i);
    if (unclosed?.[1] != null) return unclosed[1].trim();
    return trimmed;
}

function indexOfJsonStart(raw: string): number {
    const obj = raw.indexOf('{');
    const arr = raw.indexOf('[');
    if (obj < 0) return arr;
    if (arr < 0) return obj;
    return Math.min(obj, arr);
}

function endOfJsonValue(raw: string, start: number): number {
    const stack: string[] = [];
    let inString = false;
    let escape = false;
    for (let i = start; i < raw.length; i++) {
        const ch = raw[i];
        if (inString) {
            if (escape) {
                escape = false;
                continue;
            }
            if (ch === '\\') {
                escape = true;
                continue;
            }
            if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') {
            inString = true;
            continue;
        }
        if (ch === '{') stack.push('}');
        else if (ch === '[') stack.push(']');
        else if (ch === '}' || ch === ']') {
            if (stack[stack.length - 1] !== ch) return -1;
            stack.pop();
            if (stack.length === 0) return i + 1;
        }
    }
    return -1;
}

function stripTrailingCommas(raw: string): string {
    let result = '';
    let inString = false;
    let escape = false;
    for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (inString) {
            result += ch;
            if (escape) {
                escape = false;
                continue;
            }
            if (ch === '\\') {
                escape = true;
                continue;
            }
            if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') {
            inString = true;
            result += ch;
            continue;
        }
        if (ch === ',') {
            let j = i + 1;
            while (j < raw.length && /\s/.test(raw[j])) j++;
            if (raw[j] === '}' || raw[j] === ']') continue;
        }
        result += ch;
    }
    return result;
}

function repairTruncatedJson(raw: string): string | null {
    const stack: string[] = [];
    let inString = false;
    let escape = false;
    for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (inString) {
            if (escape) {
                escape = false;
                continue;
            }
            if (ch === '\\') {
                escape = true;
                continue;
            }
            if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') {
            inString = true;
            continue;
        }
        if (ch === '{') stack.push('}');
        else if (ch === '[') stack.push(']');
        else if (ch === '}' || ch === ']') {
            if (stack[stack.length - 1] !== ch) return null;
            stack.pop();
        }
    }
    if (!inString && stack.length === 0) return null;

    let result = raw;
    if (inString) result += '"';
    result = result.replace(/,\s*$/, '');
    while (stack.length) result += stack.pop();
    return result;
}
