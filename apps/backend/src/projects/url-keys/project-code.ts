/**
 * A project's short key, which task keys are built from.
 *
 * Upper-case so a code is never mistaken for a board slug, 2–12 characters,
 * starting with a letter. A trailing digit-only segment is allowed, because
 * `PRJ-0002` already exists and forbidding it would make every task in those
 * projects unaddressable — see `parseTaskKey` for why that costs nothing.
 */
export const PROJECT_CODE_PATTERN = /^[A-Z][A-Z0-9-]{1,11}$/;

export function isValidProjectCode(code: string): boolean {
    return PROJECT_CODE_PATTERN.test(code ?? '');
}
