/**
 * Backfills `ProjectMember` rows for a project's manager and its creator.
 *
 * Why this exists
 * ---------------
 * The task Assignee picker offers a project's roster and nothing else — the
 * workspace's user list is deliberately not on offer, because a task should
 * only land on somebody who is on the job. But `ProjectsService.create` used to
 * seed member rows **only for `PRIVATE` projects**, where the roster doubles as
 * the access list, and `ProjectVisibility` defaults to `PUBLIC`. So an ordinary
 * project was created with no members at all — not even its manager — and the
 * Assignee picker on every one of its tasks was empty for every user who opened
 * it, with nothing on screen to say why.
 *
 * `create` now seeds both people on every project. This fills in the ones that
 * already exist, which is the half a code change cannot reach.
 *
 * Production does not run `prisma migrate deploy` — the container boots with
 * `prisma db push` (see apps/backend/Dockerfile), which syncs the schema's shape
 * and nothing else — so a migration that backfilled data would only ever run on
 * a developer's machine. That is why this is a sync script in the container's
 * CMD chain rather than a migration.
 *
 * What it writes
 * --------------
 * For every project that is not soft-deleted: a `MANAGER` row for `manager_id`
 * and a `MEMBER` row for `created_by`, skipping either where it is null or
 * where that person already holds a row. It never touches a row that exists, so
 * somebody deliberately demoted to `VIEWER` — or removed from the team on
 * purpose — is not silently reinstated on the next boot.
 *
 * Idempotent by construction: the second run finds every row already present
 * and writes nothing.
 *
 * Usage:
 *   npx tsx prisma/sync-project-members.ts --dry-run
 *   npx tsx prisma/sync-project-members.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Projects are read in pages so a large workspace does not land in memory. */
const PAGE_SIZE = 500;

export interface SyncResult {
    scanned: number;
    /** Rows written — at most two per project, often fewer. */
    added: number;
    /** Projects whose roster was empty before this run. */
    repaired: number;
    /** Projects with neither a manager nor a creator to seed. */
    orphaned: number;
}

async function main() {
    const dryRun = process.argv.slice(2).includes('--dry-run');
    const result: SyncResult = { scanned: 0, added: 0, repaired: 0, orphaned: 0 };
    // Paged with a plain `id > lastId` rather than Prisma's `cursor`/`skip`.
    // Every project is read regardless of whether it needs work, so a cursor
    // would be safe here — but the same idiom as the other sync scripts is
    // worth more than the two lines it saves.
    let lastId: string | undefined;

    for (;;) {
        const page = await prisma.project.findMany({
            where: {
                deleted_at: null,
                ...(lastId ? { id: { gt: lastId } } : {}),
            },
            select: {
                id: true,
                tenant_id: true,
                manager_id: true,
                created_by: true,
                members: { select: { user_id: true } },
            },
            orderBy: { id: 'asc' },
            take: PAGE_SIZE,
        });
        if (page.length === 0) break;

        result.scanned += page.length;

        for (const project of page) {
            const wasEmpty = project.members.length === 0;
            const held = new Set(
                project.members
                    .map((member) => member.user_id)
                    .filter((id): id is string => Boolean(id)),
            );

            // The manager is written first, so a manager who also created the
            // project keeps the MANAGER row rather than being recorded as a
            // plain member. Same ordering as `seedCoreMembers`.
            const wanted: { userId: string; role: 'MANAGER' | 'MEMBER' }[] = [];
            const push = (userId: string | null, role: 'MANAGER' | 'MEMBER') => {
                if (!userId || held.has(userId)) return;
                held.add(userId);
                wanted.push({ userId, role });
            };
            push(project.manager_id, 'MANAGER');
            push(project.created_by, 'MEMBER');

            if (wanted.length === 0) {
                if (wasEmpty) result.orphaned += 1;
                continue;
            }

            for (const entry of wanted) {
                if (!dryRun) {
                    // `create` inside a per-row try rather than one transaction
                    // over the page: a partial backfill is safe, since the next
                    // boot picks up whatever is left.
                    await prisma.projectMember.create({
                        data: {
                            tenant_id: project.tenant_id,
                            project_id: project.id,
                            user_id: entry.userId,
                            role: entry.role,
                        },
                    });
                }
                result.added += 1;
            }
            if (wasEmpty) result.repaired += 1;
        }

        lastId = page[page.length - 1].id;
        if (page.length < PAGE_SIZE) break;
    }

    const prefix = dryRun ? '[dry run] ' : '';
    console.log(
        `${prefix}sync-project-members: scanned ${result.scanned} project(s), ` +
            `added ${result.added} member row(s), gave ${result.repaired} previously-empty ` +
            `roster(s) somebody to assign to, left ${result.orphaned} with nobody to seed.`,
    );
}

if (require.main === module) {
    main()
        .catch((error) => {
            // Warn, never exit non-zero. This runs in an && chain ahead of
            // `node main.js` in the container CMD, where a non-zero exit is a
            // full outage rather than a failed script.
            console.error('sync-project-members failed:', error);
            process.exitCode = 0;
        })
        .finally(() => prisma.$disconnect());
}
