export interface ImportConfig<T extends object> {
  requiredFields: string[];
  castRow: (raw: Record<string, unknown>) => T;
  findDuplicate: (row: T, tenantId: string) => Promise<string | null>;
  create: (row: T, tenantId: string) => Promise<void>;
  update: (id: string, row: T, tenantId: string) => Promise<void>;
  /**
   * Opaque strings identifying the record a row describes — one per identity
   * field it carries, empty when it carries none.
   *
   * `findDuplicate` cannot catch two rows of the *same file* describing one
   * record: it asks the database, and in `skip` mode the earlier row was never
   * written, so there is nothing to find. Supplying these lets the importer
   * compare rows against each other as well.
   *
   * Keys must be namespaced by field, so a value that means one thing in one
   * column cannot collide with the same text in another.
   */
  dedupeKeys?: (row: T) => string[];
  /** Turns one of those keys into the word a user knows it by, for the report. */
  describeDedupeKey?: (key: string) => string;
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
  /**
   * Rows skipped because an earlier row in the same file already described that
   * record. Kept apart from `errors` because it is not a failure to fix — the
   * file simply listed someone twice — and folding it in would inflate the
   * error count the import dialog reports. Present only when non-empty.
   */
  duplicates?: string[];
}

function fieldList(target: unknown): string {
  if (Array.isArray(target)) return target.join(', ');
  return typeof target === 'string' ? target : 'a unique field';
}

/**
 * Turns a row failure into one line a shop owner can act on. Prisma errors arrive
 * as a multi-line dump of the whole query with the actual sentence at the end, so
 * unwrap the known codes and otherwise keep only that trailing sentence.
 */
export function describeRowError(err: any): string {
  if (err?.code === 'P2002') return `duplicate value for ${fieldList(err?.meta?.target)}`;
  if (err?.code === 'P2003') return `references a record that does not exist (${fieldList(err?.meta?.field_name)})`;
  if (err?.code === 'P2025') return 'the record it refers to no longer exists';

  const message = typeof err?.message === 'string' ? err.message : '';
  if (!message) return 'unknown error';

  const lines = message
    .split('\n')
    .map((line: string) => line.trim())
    .filter(Boolean);
  return lines[lines.length - 1] ?? 'unknown error';
}

export async function runImport<T extends object>(
  rawRows: Record<string, unknown>[],
  mode: 'skip' | 'upsert',
  tenantId: string,
  config: ImportConfig<T>,
): Promise<ImportResult> {
  const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };
  const duplicates: string[] = [];
  /** Identity key -> the row number that first claimed it. */
  const seen = new Map<string, number>();

  for (let i = 0; i < rawRows.length; i++) {
    const rowNum = i + 2;
    const raw = rawRows[i];

    const missing = config.requiredFields.filter(
      (f) => raw[f] === undefined || raw[f] === null || String(raw[f]).trim() === '',
    );
    if (missing.length) {
      result.errors.push(`Row ${rowNum}: missing required field(s): ${missing.join(', ')}`);
      continue;
    }

    try {
      const row = config.castRow(raw);

      // Rows earlier in this same file, before the database is consulted. Only
      // `skip` short-circuits: in `upsert` the row is meant to overwrite, and
      // the record the earlier row created is already committed, so the normal
      // path below finds it and applies the update — last one wins, as asked.
      const keys = config.dedupeKeys?.(row) ?? [];
      const clash = keys.map((key) => [key, seen.get(key)] as const).find(([, at]) => at !== undefined);
      if (clash && mode === 'skip') {
        const field = config.describeDedupeKey?.(clash[0]);
        duplicates.push(
          `Row ${rowNum}: same ${field ?? 'record'} as row ${clash[1]} — skipped`,
        );
        result.skipped++;
        continue;
      }
      for (const key of keys) {
        if (!seen.has(key)) seen.set(key, rowNum);
      }

      const existingId = await config.findDuplicate(row, tenantId);

      if (existingId) {
        if (mode === 'skip') {
          result.skipped++;
        } else {
          await config.update(existingId, row, tenantId);
          result.updated++;
        }
      } else {
        await config.create(row, tenantId);
        result.created++;
      }
    } catch (err: any) {
      result.errors.push(`Row ${rowNum}: ${describeRowError(err)}`);
    }
  }

  if (duplicates.length) result.duplicates = duplicates;
  return result;
}
