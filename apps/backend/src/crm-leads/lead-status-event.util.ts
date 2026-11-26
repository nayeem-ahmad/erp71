export type StageRef = { id: string | null; lifecycle: string };

export type LeadStatusEventDb = {
    leadStatusEvent: { create: (args: { data: Record<string, unknown> }) => Promise<unknown> };
};

/**
 * Insert one `LeadStatusEvent` for a real stage landing. Skip when the stage
 * id did not change — re-saving the same stage must not look like movement.
 * `from === null` is a create landing. Omit `at` so Prisma fills `created_at`.
 */
export async function recordLeadStatusChange(
    db: LeadStatusEventDb,
    args: {
        tenantId: string;
        leadId: string;
        from: StageRef | null;
        to: StageRef;
        actorId?: string | null;
        at?: Date;
    },
): Promise<boolean> {
    if (args.from !== null && args.from.id === args.to.id) {
        return false;
    }

    const data: Record<string, unknown> = {
        tenant_id: args.tenantId,
        lead_id: args.leadId,
        from_status_id: args.from?.id ?? null,
        from_lifecycle: args.from?.lifecycle ?? null,
        to_status_id: args.to.id,
        to_lifecycle: args.to.lifecycle,
        created_by: args.actorId ?? null,
    };
    if (args.at) {
        data.created_at = args.at;
    }

    await db.leadStatusEvent.create({ data });
    return true;
}
