import { Prisma } from '@prisma/client';
import { LEGACY_BROWSER_SECTIONS, normalizeInvoicePrintPrefs } from '@erp71/shared-types';

/** `platform_settings` row that records the one successful live run. */
export const MARKER_GROUP = 'sync';
export const MARKER_KEY = 'member_prefs_legacy';

/** Blobs read and rewritten per query, so a large database is never loaded whole. */
const BATCH_SIZE = 500;

export type SyncOptions = { dryRun: boolean };

export type SyncResult = { skipped: true } | { skipped: false; members: number; blobs: number };

/**
 * One-shot per database, and the marker is written in the same transaction as
 * the work, last, so a run either did everything and is recorded or did nothing.
 *
 * 1. Every existing member keeps reading their old browser values for the three
 *    browser-held sections until they answer them themselves.
 * 2. Every stored `invoice_print_prefs` is rewritten in its filled-out form.
 *    A blob saved before 2026-10-15 lacks `signature_space_mm`, `table_borders`
 *    and `warranty_column`; left that way, a profile that sets them would change
 *    a layout the member never touched. Filled out, the blob answers every key.
 *
 * A dry run reads and counts but writes nothing, not even the marker.
 */
export async function runMemberPrefsLegacySync(client: any, options: SyncOptions): Promise<SyncResult> {
    const { dryRun } = options;

    const marker = await client.platformSetting.findFirst({
        where: { group: MARKER_GROUP, key: MARKER_KEY },
        select: { value: true },
    });
    if (marker) return { skipped: true };

    if (dryRun) {
        const members: number = await client.tenantUser.count();
        let blobs = 0;
        await forEachBlobBatch(client, async (batch) => {
            blobs += batch.length;
        });
        return { skipped: false, members, blobs };
    }

    let members = 0;
    let blobs = 0;
    await client.$transaction(
        async (tx: any) => {
            const updated = await tx.tenantUser.updateMany({
                data: { legacy_browser_sections: [...LEGACY_BROWSER_SECTIONS] },
            });
            members = updated.count;

            await forEachBlobBatch(tx, async (batch) => {
                for (const row of batch) {
                    await tx.tenantUser.update({
                        where: { id: row.id },
                        data: { invoice_print_prefs: normalizeInvoicePrintPrefs(row.invoice_print_prefs) },
                    });
                    blobs += 1;
                }
            });

            const value = new Date().toISOString();
            await tx.platformSetting.upsert({
                where: { group_key: { group: MARKER_GROUP, key: MARKER_KEY } },
                create: { group: MARKER_GROUP, key: MARKER_KEY, value },
                update: { value },
            });
        },
        { timeout: 300_000, maxWait: 30_000 },
    );

    return { skipped: false, members, blobs };
}

/** Walks the members with a non-null invoice blob in id order, one batch at a time. */
async function forEachBlobBatch(
    db: any,
    handle: (batch: { id: string; invoice_print_prefs: unknown }[]) => Promise<void>,
): Promise<void> {
    let after: string | undefined;
    for (;;) {
        const batch: { id: string; invoice_print_prefs: unknown }[] = await db.tenantUser.findMany({
            where: {
                invoice_print_prefs: { not: Prisma.DbNull },
                ...(after ? { id: { gt: after } } : {}),
            },
            select: { id: true, invoice_print_prefs: true },
            orderBy: { id: 'asc' },
            take: BATCH_SIZE,
        });
        if (batch.length === 0) return;
        await handle(batch);
        if (batch.length < BATCH_SIZE) return;
        after = batch[batch.length - 1].id;
    }
}
