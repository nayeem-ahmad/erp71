/**
 * Covers the two pure functions `sync-crm-activities.ts` exports, so the
 * mapping and the next_step de-duplication rule are tested without a live
 * database. The `main()` driver around them is exercised by running the script.
 */
/* eslint-disable @typescript-eslint/no-var-requires */
const backfill = require('../../../../packages/database/prisma/sync-crm-activities.ts');
/* eslint-enable @typescript-eslint/no-var-requires */

const { mapLegacyRow, shouldMaterialiseNextStep } = backfill as {
    mapLegacyRow: (
        source: string,
        row: any,
        purposes: Record<string, string>,
        channels?: Record<string, string>,
    ) => any;
    shouldMaterialiseNextStep: (
        lead: { status: string; next_step: string | null; next_step_date: Date | null },
        plannedActivities: { due_at: Date | null }[],
    ) => boolean;
};

describe('mapLegacyRow()', () => {
    const purposes = {
        GENERAL: 'p-gen',
        COLLECTION: 'p-col',
        BIRTHDAY: 'p-bday',
        REORDER_REMINDER: 'p-reorder',
    };

    it('maps a lead conversation to a DONE activity', () => {
        const row = mapLegacyRow(
            'LEAD_CONVERSATION',
            {
                id: 'lc1',
                tenant_id: 't1',
                lead_id: 'l1',
                channel_id: 'ch1',
                type: 'CALL',
                summary: 'Spoke to Karim',
                outcome: 'ok',
                direction: 'OUTBOUND',
                created_by: 'u1',
                created_at: new Date('2026-01-02'),
            },
            purposes,
        );

        expect(row).toMatchObject({
            legacy_source: 'LEAD_CONVERSATION',
            legacy_id: 'lc1',
            status: 'DONE',
            subject: null,
            summary: 'Spoke to Karim',
            completed_at: new Date('2026-01-02'),
            due_at: null,
            channel_id: 'ch1',
            channel_code: 'CALL',
            purpose_id: null,
        });
    });

    it('maps a pending follow-up to a PLANNED activity with its purpose', () => {
        const row = mapLegacyRow(
            'CRM_FOLLOW_UP',
            {
                id: 'f1',
                tenant_id: 't1',
                customer_id: 'c1',
                type: 'COLLECTION',
                title: 'Chase invoice',
                due_at: new Date('2026-03-01'),
                status: 'PENDING',
                completed_at: null,
                notes: 'ring twice',
                assigned_to: 'u2',
                created_by: 'u1',
            },
            purposes,
        );

        expect(row).toMatchObject({
            status: 'PLANNED',
            subject: 'Chase invoice',
            purpose_id: 'p-col',
            due_at: new Date('2026-03-01'),
            completed_at: null,
            notes: 'ring twice',
        });
    });

    it('maps a completed follow-up to DONE', () => {
        const row = mapLegacyRow(
            'CRM_FOLLOW_UP',
            {
                id: 'f2',
                tenant_id: 't1',
                customer_id: 'c1',
                type: 'GENERAL',
                title: 'Done thing',
                due_at: new Date('2026-03-01'),
                status: 'DONE',
                completed_at: new Date('2026-03-02'),
                assigned_to: null,
                created_by: 'u1',
            },
            purposes,
        );

        expect(row.status).toBe('DONE');
        expect(row.completed_at).toEqual(new Date('2026-03-02'));
    });

    it('falls back to GENERAL for a follow-up type with no matching purpose', () => {
        const row = mapLegacyRow(
            'CRM_FOLLOW_UP',
            {
                id: 'f3', tenant_id: 't1', customer_id: 'c1', type: 'INVENTED_BY_A_PAST_CLIENT',
                title: 'x', due_at: new Date('2026-03-01'), status: 'PENDING', created_by: 'u1',
            },
            purposes,
        );

        expect(row.purpose_id).toBe('p-gen');
    });

    it('maps a customer interaction by channel code', () => {
        const row = mapLegacyRow(
            'CUSTOMER_INTERACTION',
            {
                id: 'ci1',
                tenant_id: 't1',
                customer_id: 'c1',
                type: 'WHATSAPP',
                summary: 'Sent catalogue',
                direction: 'OUTBOUND',
                created_by: 'u1',
                created_at: new Date('2026-02-02'),
            },
            purposes,
            { WHATSAPP: 'ch-wa' },
        );

        expect(row).toMatchObject({ channel_id: 'ch-wa', channel_code: 'WHATSAPP', status: 'DONE' });
    });

    it('leaves channel_id null when a legacy type matches no channel', () => {
        const row = mapLegacyRow(
            'CUSTOMER_INTERACTION',
            {
                id: 'ci2',
                tenant_id: 't1',
                customer_id: 'c1',
                type: 'CARRIER_PIGEON',
                summary: 'x',
                created_by: 'u1',
                created_at: new Date(),
            },
            purposes,
            {},
        );

        expect(row.channel_id).toBeNull();
        expect(row.channel_code).toBe('CARRIER_PIGEON');
    });

    it('maps a lead next_step onto the lead it came from', () => {
        const row = mapLegacyRow(
            'LEAD_NEXT_STEP',
            {
                id: 'l1',
                tenant_id: 't1',
                next_step: 'Call back',
                next_step_date: new Date('2026-04-01'),
                next_step_assigned_to: 'u2',
            },
            purposes,
        );

        expect(row).toMatchObject({
            lead_id: 'l1',
            customer_id: null,
            legacy_source: 'LEAD_NEXT_STEP',
            legacy_id: 'l1',
            subject: 'Call back',
            status: 'PLANNED',
            due_at: new Date('2026-04-01'),
            assigned_to: 'u2',
            purpose_id: 'p-gen',
        });
    });
});

describe('scoring is unchanged by the backfill', () => {
    // The spec's promise that no lead is rescored on migration day rests on one
    // arithmetic fact: every LeadConversation becomes exactly one DONE activity,
    // so the count feeding computeLeadScore is identical. Assert the mapping
    // preserves that 1:1 rather than trusting it.
    it('maps N conversations to exactly N DONE activities', () => {
        const purposes = { GENERAL: 'p-gen', COLLECTION: 'p-col', BIRTHDAY: 'p-b', REORDER_REMINDER: 'p-r' };
        const conversations = [
            { id: 'lc1', tenant_id: 't1', lead_id: 'l1', type: 'CALL', summary: 'a', created_at: new Date() },
            { id: 'lc2', tenant_id: 't1', lead_id: 'l1', type: 'CALL', summary: 'b', created_at: new Date() },
            { id: 'lc3', tenant_id: 't1', lead_id: 'l1', type: 'SMS', summary: 'c', created_at: new Date() },
        ];

        const mapped = conversations.map((c) => mapLegacyRow('LEAD_CONVERSATION', c, purposes));

        expect(mapped).toHaveLength(3);
        expect(mapped.every((m) => m.status === 'DONE')).toBe(true);
        expect(new Set(mapped.map((m) => m.legacy_id)).size).toBe(3);
    });
});

describe('shouldMaterialiseNextStep()', () => {
    it('skips a lead with a planned activity already due that day', () => {
        expect(
            shouldMaterialiseNextStep(
                { status: 'NEW', next_step: 'Call', next_step_date: new Date('2026-04-01T09:00:00Z') },
                [{ due_at: new Date('2026-04-01T15:00:00Z') }],
            ),
        ).toBe(false);
    });

    it('materialises when the existing planned activity is a different day', () => {
        expect(
            shouldMaterialiseNextStep(
                { status: 'NEW', next_step: 'Call', next_step_date: new Date('2026-04-01T09:00:00Z') },
                [{ due_at: new Date('2026-04-05T09:00:00Z') }],
            ),
        ).toBe(true);
    });

    it('never materialises for a converted or lost lead', () => {
        expect(
            shouldMaterialiseNextStep(
                { status: 'CONVERTED', next_step: 'Call', next_step_date: new Date('2026-04-01') },
                [],
            ),
        ).toBe(false);
        expect(
            shouldMaterialiseNextStep(
                { status: 'LOST', next_step: 'Call', next_step_date: new Date('2026-04-01') },
                [],
            ),
        ).toBe(false);
    });

    it('skips a lead with no next_step text', () => {
        expect(
            shouldMaterialiseNextStep({ status: 'NEW', next_step: null, next_step_date: null }, []),
        ).toBe(false);
    });

    // An undated next step has no day to compare against, so any open activity
    // is treated as covering it rather than manufacturing a second copy.
    it('materialises an undated next step only when nothing is planned', () => {
        expect(
            shouldMaterialiseNextStep({ status: 'NEW', next_step: 'Call', next_step_date: null }, []),
        ).toBe(true);
        expect(
            shouldMaterialiseNextStep({ status: 'NEW', next_step: 'Call', next_step_date: null }, [
                { due_at: new Date('2026-04-01') },
            ]),
        ).toBe(false);
    });
});
