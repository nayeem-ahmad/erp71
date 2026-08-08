import { InternalServerErrorException } from '@nestjs/common';

/**
 * Pull a JSON payload out of a model reply.
 *
 * Kept out of `AiService` so pure modules — the blog draft normalizer is the
 * first — can parse a reply without instantiating a Nest provider. The fence
 * stripping is not defensive tidying: models fence their JSON often enough
 * that dropping it would surface as an "invalid response" on half the calls.
 */
export function extractJson<T>(raw: string): T {
    const trimmed = raw.trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = (fenced?.[1] ?? trimmed).trim();
    try {
        return JSON.parse(candidate) as T;
    } catch {
        throw new InternalServerErrorException('AI returned an invalid response. Please try again.');
    }
}
