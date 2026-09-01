/**
 * Backfills `SupportThread.createdById` — the shop user who opened a support or
 * feedback thread, shown and filtered on in Admin › Inbox.
 *
 * Why this exists
 * ---------------
 * Production does not run `prisma migrate deploy`. The container boots with
 * `prisma db push` (see apps/backend/Dockerfile), which syncs the *shape* of the
 * schema and nothing else. So migration `20260901120000_add_support_thread_creator`
 * — which adds the column and backfills it — only ever runs on a developer's
 * machine. Without this script the column lands in production as NULL on every
 * existing thread: the inbox attributes each of them to "Unknown user" and the
 * per-user filter can only ever find threads opened after the deploy.
 *
 * Where the value comes from
 * --------------------------
 * A thread is always created together with its first message, and that message
 * is always the owner's (`SupportService.createKnock`). So the opener is the
 * sender of the thread's earliest message. A thread with no messages at all has
 * nobody to attribute it to and is left NULL — the UI already handles that.
 *
 * It runs on every container start, so it must be idempotent. It is: only rows
 * where `createdById` is still NULL are considered, so a second run is a no-op,
 * and a value later corrected by hand is never overwritten.
 *
 * Usage:
 *   npx tsx prisma/sync-support-thread-creators.ts --dry-run
 *   npx tsx prisma/sync-support-thread-creators.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Threads are read in pages so a large backlog does not land in memory at once. */
const PAGE_SIZE = 1000;

export interface SyncResult {
    scanned: number;
    filled: number;
    /** Threads left NULL because they hold no message to attribute them to. */
    orphaned: number;
}

async function main() {
    const dryRun = process.argv.slice(2).includes('--dry-run');
    const result: SyncResult = { scanned: 0, filled: 0, orphaned: 0 };
    // Paged with a plain `id > lastId` rather than Prisma's `cursor`/`skip`: a
    // real run updates rows out of the `createdById: null` filter as it goes, and
    // a cursor whose own row no longer matches the filter makes `skip: 1` drop a
    // thread that should have been read.
    let lastId: string | undefined;

    for (;;) {
        const page = await prisma.supportThread.findMany({
            where: {
                createdById: null,
                ...(lastId ? { id: { gt: lastId } } : {}),
            },
            select: {
                id: true,
                messages: {
                    // The opener is whoever wrote first; `id` breaks ties so two
                    // messages sharing a timestamp resolve the same way every run.
                    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                    take: 1,
                    select: { senderId: true },
                },
            },
            orderBy: { id: 'asc' },
            take: PAGE_SIZE,
        });
        if (page.length === 0) break;

        result.scanned += page.length;

        for (const thread of page) {
            const senderId = thread.messages[0]?.senderId;
            if (!senderId) {
                result.orphaned += 1;
                continue;
            }
            if (!dryRun) {
                // Sequential, not one transaction over every thread: a partial
                // backfill is safe — the next boot picks up whatever is left.
                await prisma.supportThread.update({
                    where: { id: thread.id },
                    data: { createdById: senderId },
                });
            }
            result.filled += 1;
        }

        lastId = page[page.length - 1].id;
        if (page.length < PAGE_SIZE) break;
    }

    const prefix = dryRun ? '[dry run] ' : '';
    console.log(
        `${prefix}sync-support-thread-creators: scanned ${result.scanned} unattributed thread(s), ` +
            `filled ${result.filled}, left ${result.orphaned} with no message to attribute.`,
    );
}

if (require.main === module) {
    main()
        .catch((error) => {
            // Warn, never exit non-zero. This runs in an && chain ahead of
            // `node main.js` in the container CMD, where a non-zero exit is a
            // full outage rather than a failed script.
            console.error('sync-support-thread-creators failed:', error);
            process.exitCode = 0;
        })
        .finally(() => prisma.$disconnect());
}
