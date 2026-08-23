/**
 * Tag resolution shared by the hour-log service and the timer service.
 *
 * Both take a list of tag ids from a client and both have to answer the same
 * question before writing: which of these still exist, in this tenant? The
 * running timer keeps its tags in a scalar list with no foreign key, so for it
 * this is the only thing standing between a tag deleted mid-afternoon and a
 * constraint violation on stop. For the entry service it is the tenant check —
 * a tag id from another workspace must not become writable by being posted.
 */

/** The narrow slice of the Prisma client this needs, so it can be faked in a test. */
export interface TimeTagReader {
    projectTimeTag: {
        findMany(args: {
            where: { tenant_id: string; id: { in: string[] } };
            select: { id: true };
        }): Promise<{ id: string }[]>;
    };
}

/**
 * The subset of `ids` that resolve to live tags in this tenant, in no
 * particular order. Unknown and foreign ids are dropped silently rather than
 * refused: the caller is usually replaying a selection made minutes ago, and
 * failing the whole save because one tag was retired in the meantime would
 * lose the hours along with the tag.
 */
export async function liveTagIds(
    db: TimeTagReader,
    tenantId: string,
    ids: string[] | undefined | null,
): Promise<string[]> {
    if (!ids?.length) return [];
    const unique = [...new Set(ids)];
    const rows = await db.projectTimeTag.findMany({
        where: { tenant_id: tenantId, id: { in: unique } },
        select: { id: true },
    });
    return rows.map((row) => row.id);
}
