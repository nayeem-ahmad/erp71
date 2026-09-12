import {
    auditDetails,
    describeAuditRow,
    humanizeAction,
    humanizeKey,
    looksLikeId,
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
});
