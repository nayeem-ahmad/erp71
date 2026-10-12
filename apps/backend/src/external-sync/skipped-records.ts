import type { SyncWarning } from './external-sync.mapper';

/**
 * Bookkeeping for the records a run could not import. Ordinary warnings are
 * notes and can be trimmed; a skipped record is missing data, so every one is
 * kept and described well enough to act on.
 */

/** Warnings are stored on the run row; cap them so one bad import cannot bloat it. */
export const MAX_STORED_WARNINGS = 500;

/** Skipped records are never trimmed to make room for notes; this only stops a runaway run. */
const MAX_STORED_SKIPPED = 5000;

/** Every skipped record first, then as many notes as still fit, each group in the order raised. */
export function capWarnings(warnings: SyncWarning[]): SyncWarning[] {
    const skipped = warnings.filter((w) => w.skipped).slice(0, MAX_STORED_SKIPPED);
    const room = Math.max(0, MAX_STORED_WARNINGS - skipped.length);
    return [...skipped, ...warnings.filter((w) => !w.skipped).slice(0, room)];
}

/** How many of each warning the run raised, stored ones or not. */
export function countWarningCodes(warnings: SyncWarning[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const warning of warnings) counts[warning.code] = (counts[warning.code] ?? 0) + 1;
    return counts;
}

/**
 * The part of a write error a person can act on. Prisma's messages carry the
 * whole failed invocation; the reason is a unique clash's fields or the last
 * line.
 */
export function describeWriteError(error: unknown): string {
    const e = error as { code?: string; meta?: { target?: unknown; field_name?: unknown }; message?: unknown };
    if (e?.code === 'P2002') {
        const target = e.meta?.target;
        const fields = (Array.isArray(target) ? target : [target])
            .map(String)
            .filter((field) => field && field !== 'undefined' && field !== 'tenant_id');
        return `another record already has the same ${fields.join(', ') || 'unique value'}`;
    }
    if (e?.code === 'P2003') {
        return `it refers to a ${String(e.meta?.field_name ?? 'related record')} that does not exist`;
    }
    const message = String(e?.message ?? error ?? 'unknown error');
    const lines = message.split('\n').map((line) => line.trim()).filter(Boolean);
    return (lines.at(-1) ?? message).slice(0, 300);
}

/**
 * `base` if no record holds it, else the first free `base-2`, `base-3`, … —
 * how a number the provider handed out twice still imports.
 */
export async function freeDocumentNumber(base: string, isTaken: (candidate: string) => Promise<boolean>): Promise<string> {
    if (!(await isTaken(base))) return base;
    for (let n = 2; n < 1000; n++) {
        const candidate = `${base}-${n}`;
        if (!(await isTaken(candidate))) return candidate;
    }
    throw new Error(`No free number left for ${base}`);
}

/** A customer or supplier as a person would recognise it: code and name when the document carries them. */
export function partyLabel(externalId: string | null, embedded: unknown): string | null {
    const party = (embedded && typeof embedded === 'object' ? embedded : {}) as { code?: unknown; name?: unknown };
    const label = [party.code, party.name].filter((part) => typeof part === 'string' && part.trim()).join(' ');
    if (label) return label;
    return externalId ? `#${externalId}` : null;
}
