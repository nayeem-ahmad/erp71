/**
 * `Lead.last_activity_at` — "somebody worked this lead" — and the one function
 * allowed to write it.
 *
 * The column is deliberately separate from `last_contacted_at`, which means "we
 * reached the person". Contact is the narrower claim and feeds lead scoring's
 * recency weight; activity is anything that moves the lead forward — logging or
 * editing a conversation, creating or editing an activity, scheduling a
 * follow-up — and feeds the dashboard's neglected-leads tile and
 * `GET /crm/leads?staleDays=N`. Folding the two together would let typing a next
 * step score a lead as freshly engaged when nobody has phoned it in months.
 *
 * Every caller that stamps `last_contacted_at` must also call this: contact is a
 * kind of activity, and a lead we spoke to yesterday appearing in a "no activity
 * in 14 days" list is the bug this column exists to fix.
 */

/** Prisma client or transaction handle. Both expose `lead.update`. */
type LeadWriter = { lead: { update: (args: any) => Promise<unknown> } };

/**
 * Stamp a lead as worked. A no-op for a null `leadId`, so the activity and
 * follow-up services — whose rows target either a lead or a customer — can call
 * it unconditionally rather than branching at each of their five call sites.
 */
export async function touchLeadActivity(
    client: LeadWriter,
    leadId: string | null | undefined,
    at: Date = new Date(),
): Promise<void> {
    if (!leadId) return;
    await client.lead.update({ where: { id: leadId }, data: { last_activity_at: at } });
}
