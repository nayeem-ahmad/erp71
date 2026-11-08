import {
    auditDetails,
    describeAuditRow,
    formatAuditInstant,
    humanizeAction,
    humanizeKey,
    looksLikeId,
    readActivityDetailsAudit,
} from './audit-description';

const taka = (value: number) => `৳${value.toLocaleString('en-US')}`;

describe('looksLikeId', () => {
    it('catches uuids and long opaque keys', () => {
        expect(looksLikeId('8f0e1c2d-3a4b-5c6d-7e8f-9a0b1c2d3e4f')).toBe(true);
        expect(looksLikeId('clx9k2m4n0000abcd1234')).toBe(true);
    });

    it('keeps human text, even when long', () => {
        // The whole point of the space check: a real name must survive.
        expect(looksLikeId('Dhaka wholesale market branch')).toBe(false);
        expect(looksLikeId('Cash')).toBe(false);
    });

    it('does not treat numbers as ids', () => {
        expect(looksLikeId(12)).toBe(false);
    });
});

describe('humanizeAction', () => {
    it('reads screaming constants as a sentence', () => {
        expect(humanizeAction('PASSWORD_RESET_REQUESTED')).toBe('Password reset requested');
        expect(humanizeAction('USER_LOGIN')).toBe('User login');
    });

    it('puts the verb first for dotted route actions', () => {
        expect(humanizeAction('purchase-orders.items.update')).toBe('Updated purchase orders items');
        expect(humanizeAction('products.create')).toBe('Created products');
    });

    it('reads the whole phrase when the last segment is not a known verb', () => {
        expect(humanizeAction('tenant.impersonate')).toBe('Tenant impersonate');
    });

    it('never returns an empty string', () => {
        expect(humanizeAction('')).toBe('Performed an action');
    });
});

describe('humanizeKey', () => {
    it('reads snake_case and camelCase alike', () => {
        expect(humanizeKey('payment_method')).toBe('Payment method');
        expect(humanizeKey('customerName')).toBe('Customer name');
    });
});

describe('describeAuditRow', () => {
    it('uses the written phrase over the mechanical reading', () => {
        expect(describeAuditRow({ action: 'sales.create', entity: 'sales' })).toBe('Recorded a sale');
    });

    it('appends the subject and the amount when the payload has them', () => {
        const text = describeAuditRow(
            {
                action: 'sales.create',
                entity: 'sales',
                payload: { invoice_number: 'INV-1042', amount: 1250 },
            },
            { formatAmount: taka },
        );
        expect(text).toBe('Recorded a sale — INV-1042 (৳1,250)');
    });

    it('never quotes an id as the subject', () => {
        const text = describeAuditRow({
            action: 'sales.create',
            entity: 'sales',
            payload: { name: '8f0e1c2d-3a4b-5c6d-7e8f-9a0b1c2d3e4f' },
        });
        expect(text).toBe('Recorded a sale');
    });

    it('falls back to a readable sentence for an action nobody has phrased', () => {
        // A module added later must still produce a legible row.
        expect(describeAuditRow({ action: 'warranty-claims.create', entity: 'warranty-claims' }))
            .toBe('Created warranty claims');
    });

    it('reads a numeric string amount', () => {
        const text = describeAuditRow(
            { action: 'expenses.create', entity: 'expenses', payload: { amount: '500' } },
            { formatAmount: taka },
        );
        expect(text).toBe('Recorded an expense (৳500)');
    });
});

describe('auditDetails', () => {
    it('drops ids, internal keys and empty values', () => {
        const details = auditDetails({
            action: 'sales.create',
            entity: 'sales',
            payload: {
                customer_id: '8f0e1c2d-3a4b-5c6d-7e8f-9a0b1c2d3e4f',
                tenant_id: 'abc',
                _scope: 'platform',
                notes: null,
                blank: '',
                payment_method: 'Cash',
            },
        });
        expect(details).toEqual([{ label: 'Payment method', value: 'Cash' }]);
    });

    it('formats money-ish numbers and renders booleans as words', () => {
        const details = auditDetails(
            {
                action: 'sales.create',
                entity: 'sales',
                payload: { total: 1250, quantity: 3, is_paid: true },
            },
            { formatAmount: taka },
        );
        expect(details).toEqual([
            { label: 'Total', value: '৳1,250' },
            { label: 'Quantity', value: '3' },
            { label: 'Is paid', value: 'Yes' },
        ]);
    });

    it('summarises a list by its length instead of dumping it', () => {
        const details = auditDetails({
            action: 'sales.create',
            entity: 'sales',
            payload: { items: [{ a: 1 }, { a: 2 }] },
        });
        expect(details).toEqual([{ label: 'Items', value: '2' }]);
    });

    it('returns nothing when there is no payload', () => {
        expect(auditDetails({ action: 'USER_LOGIN', entity: 'User' })).toEqual([]);
    });

    it('still drops the nested before-and-after object', () => {
        const details = auditDetails({
            action: 'crm.activity_details_updated',
            entity: 'CrmActivity',
            payload: { status: 'DONE', changes: { notes: { from: 'old', to: 'new' } } },
        });
        expect(details).toEqual([{ label: 'Status', value: 'DONE' }]);
    });
});

describe('describeAuditRow — completed-log correction', () => {
    it('names the correction and does not copy the note into the exported sentence', () => {
        const text = describeAuditRow({
            action: 'crm.activity_details_updated',
            entity: 'CrmActivity',
            payload: { changes: { notes: { from: '=HYPERLINK("http://evil")\nline', to: 'new' } } },
        });
        expect(text).toBe('Corrected the text of a completed activity');
        expect(text).not.toContain('=HYPERLINK');
        expect(text).not.toContain('line');
    });
});

describe('readActivityDetailsAudit', () => {
    const notes = 'line one\n  indented  ';

    it('keeps multiline text, and tells null, empty and missing apart', () => {
        const view = readActivityDetailsAudit({
            id: 'audit-1',
            action: 'crm.activity_details_updated',
            entity: 'CrmActivity',
            entity_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            created_at: '2026-11-08T13:20:15.000Z',
            payload: {
                status: 'DONE',
                changes: {
                    notes: { from: notes, to: '=HYPERLINK("http://evil")' },
                    summary: { from: null, to: '' },
                },
            },
        });

        expect(view?.mode).toBe('changes');
        expect(view?.auditId).toBe('audit-1');
        expect(view?.entityId).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
        expect(view?.fields.find((field) => field.field === 'notes')).toEqual({
            field: 'notes',
            recorded: true,
            from: { kind: 'text', text: notes },
            to: { kind: 'text', text: '=HYPERLINK("http://evil")' },
        });
        expect(view?.fields.find((field) => field.field === 'summary')).toEqual({
            field: 'summary',
            recorded: true,
            from: { kind: 'null' },
            to: { kind: 'empty' },
        });
        expect(view?.fields.find((field) => field.field === 'outcome')).toEqual({
            field: 'outcome',
            recorded: false,
            from: { kind: 'missing' },
            to: { kind: 'missing' },
        });
    });

    it('does not treat a truncated payload as the original, even if changes are also present', () => {
        const view = readActivityDetailsAudit({
            action: 'crm.activity_details_updated',
            entity: 'CrmActivity',
            payload: {
                _truncated: true,
                _bytes: 9000,
                changes: { notes: { from: 'SECRET ORIGINAL', to: 'x' } },
            },
        });
        expect(view?.mode).toBe('truncated');
        expect(JSON.stringify(view)).not.toContain('SECRET ORIGINAL');
        expect(view?.fields.every((field) => !field.recorded)).toBe(true);
    });

    it('reports a matching row with no changes object as having no text', () => {
        const view = readActivityDetailsAudit({
            action: 'crm.activity_details_updated',
            entity: 'CrmActivity',
            payload: { status: 'DONE' },
        });
        expect(view?.mode).toBe('absent');
        expect(view?.fields.every((field) => field.from.kind === 'missing' && field.to.kind === 'missing')).toBe(true);
    });

    it('ignores the request-body audit, which has only the new text', () => {
        expect(readActivityDetailsAudit({
            action: 'crm.activities.update',
            entity: 'crm',
            payload: { notes: 'new only', summary: '<img src=x onerror=alert(1)>' },
        })).toBeNull();
    });

    it('does not present a non-string side as wording', () => {
        const view = readActivityDetailsAudit({
            action: 'crm.activity_details_updated',
            entity: 'CrmActivity',
            payload: { changes: { notes: { from: 12, to: { nested: 'no' } } } },
        });
        const notes = view?.fields.find((field) => field.field === 'notes');
        expect(notes?.from).toEqual({ kind: 'nontext' });
        expect(notes?.to).toEqual({ kind: 'nontext' });
        expect(notes?.from).not.toHaveProperty('text');
    });
});

describe('formatAuditInstant', () => {
    it('names the zone and the UTC instant', () => {
        expect(formatAuditInstant('2026-11-08T13:20:15.000Z', 'Asia/Dhaka')).toContain('2026-11-08T13:20:15.000Z');
        expect(formatAuditInstant('2026-11-08T13:20:15.000Z', 'Asia/Dhaka')).toContain('Asia/Dhaka');
        expect(formatAuditInstant('2026-11-08T13:20:15.000Z', 'Asia/Dhaka')).toContain('19:20:15');
    });

    it('returns null for a missing or unreadable time', () => {
        expect(formatAuditInstant(null, 'UTC')).toBeNull();
        expect(formatAuditInstant('not-a-time', 'UTC')).toBeNull();
    });
});
