import { LeadCategory, LeadSource } from '@prisma/client';

/**
 * Helpers for the expand phase, where `Lead.source_id` is authoritative but the
 * legacy `Lead.source` enum column is still dual-written so a rollback to the
 * previous release finds sane data.
 *
 * Tenant-created codes (and the seeded WHATSAPP / INSTAGRAM / MARKETPLACE rows)
 * have no enum counterpart, so they collapse to OTHER in the legacy column. That
 * loses fidelity in a column nothing reads any more — the FK carries the truth.
 */

const LEGACY_SOURCES = new Set<string>(Object.values(LeadSource));
const LEGACY_CATEGORIES = new Set<string>(Object.values(LeadCategory));

/** Legacy enum value for a taxonomy code, or OTHER when it has no counterpart. */
export function coerceLegacySource(code: string | null | undefined): LeadSource {
    if (code && LEGACY_SOURCES.has(code)) return code as LeadSource;
    return LeadSource.OTHER;
}

/**
 * Legacy enum value for a category code. Unlike source, `Lead.category` is
 * nullable, so "no category" stays null rather than becoming OTHER.
 */
export function coerceLegacyCategory(code: string | null | undefined): LeadCategory | null {
    if (!code) return null;
    if (LEGACY_CATEGORIES.has(code)) return code as LeadCategory;
    return LeadCategory.OTHER;
}

/**
 * Derive a stable code from a display name: "Trade Fair" -> "TRADE_FAIR".
 *
 * Codes are the immutable join key used by the backfill and the CSV importer, so
 * they are generated once at creation and never follow later renames.
 */
export function slugifyCode(name: string): string {
    // Runs of non-alphanumerics collapse to a single underscore first, so the
    // edge trims only ever face one character — no backtracking, and trimming
    // after the slice also catches an underscore the slice itself exposed.
    const base = name
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .slice(0, 40)
        .replace(/^_/, '')
        .replace(/_$/, '');
    return base || 'CUSTOM';
}

/**
 * Case- and whitespace-insensitive key for duplicate detection.
 * "meta ads" and "Meta  Ads" collide; the DB's @@unique([tenant_id, name]) is
 * exact-match only and cannot catch that on its own.
 */
export function normalizeName(name: string): string {
    return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export type TaxonomyRow = { id: string; code: string; name: string; score_weight?: number };

/**
 * Index a tenant's taxonomy rows by id, code and name for O(1) CSV lookup.
 *
 * Built once per import rather than per row: the importer accepts up to 5000
 * rows, so a per-row query would be 5000 round trips.
 */
export function buildTaxonomyIndex<T extends TaxonomyRow>(rows: T[]): Map<string, T> {
    const index = new Map<string, T>();
    for (const row of rows) {
        index.set(row.id, row);
        index.set(normalizeName(row.code), row);
        // Codes win over names on collision — a tenant who names one row
        // "Walk-in" and another "WALK_IN" still resolves the code exactly.
        if (!index.has(normalizeName(row.name))) index.set(normalizeName(row.name), row);
    }
    return index;
}

/** Resolve a raw CSV cell against a prebuilt index. */
export function lookupTaxonomy<T extends TaxonomyRow>(
    index: Map<string, T>,
    raw: unknown,
): T | undefined {
    if (typeof raw !== 'string' && typeof raw !== 'number') return undefined;
    const value = String(raw).trim();
    if (!value) return undefined;
    return index.get(value) ?? index.get(normalizeName(value));
}

/**
 * Resolve a CSV cell, or throw so `runImport` reports the row as an error.
 *
 * Returns undefined when the cell is blank ("not specified"), never when the
 * value is merely unrecognised — silently coercing an unknown source to OTHER
 * is what made bad imports invisible before.
 */
export function resolveImportRef<T extends TaxonomyRow>(
    raw: unknown,
    index: Map<string, T>,
    label: 'source' | 'category',
): T | undefined {
    if (typeof raw !== 'string' && typeof raw !== 'number') return undefined;
    const value = String(raw).trim();
    if (!value) return undefined;

    const row = lookupTaxonomy(index, value);
    if (!row) {
        const list = label === 'source' ? 'Lead Sources' : 'Lead Categories';
        throw new Error(
            `unknown ${label} "${value}" — add it under CRM → Settings → ${list}, or correct the spreadsheet`,
        );
    }
    return row;
}
