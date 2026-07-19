export interface ImportConfig<T extends object> {
  requiredFields: string[];
  castRow: (raw: Record<string, unknown>) => T;
  findDuplicate: (row: T, tenantId: string) => Promise<string | null>;
  create: (row: T, tenantId: string) => Promise<void>;
  update: (id: string, row: T, tenantId: string) => Promise<void>;
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
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

  return result;
}
