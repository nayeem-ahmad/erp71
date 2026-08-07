import {
    AUDITED_METHODS,
    buildAuditPayload,
    extractRequestMeta,
    extractResultId,
    redactPayload,
    REDACTED_PLACEHOLDER,
    resolveAuditTarget,
} from './audit-route.util';

describe('resolveAuditTarget', () => {
    it('ignores read-only verbs', () => {
        expect(AUDITED_METHODS.has('GET')).toBe(false);
        expect(resolveAuditTarget({ method: 'GET', path: '/api/v1/sales' })).toBeNull();
        expect(resolveAuditTarget({ method: 'HEAD', path: '/api/v1/sales' })).toBeNull();
    });

    it('derives entity and action from a collection create', () => {
        expect(resolveAuditTarget({ method: 'POST', path: '/api/v1/sales' })).toEqual({
            entity: 'sales',
            action: 'sales.create',
            entityId: undefined,
        });
    });

    it('maps PUT and PATCH onto the same update verb', () => {
        const patch = resolveAuditTarget({ method: 'PATCH', path: '/api/v1/products/:id', params: { id: 'p1' } });
        const put = resolveAuditTarget({ method: 'PUT', path: '/api/v1/products/:id', params: { id: 'p1' } });
        expect(patch?.action).toBe('products.update');
        expect(put?.action).toBe('products.update');
    });

    it('folds literal sub-resources into the action', () => {
        expect(
            resolveAuditTarget({
                method: 'POST',
                path: '/api/v1/sales/:id/payments',
                params: { id: 'sale-1' },
            }),
        ).toEqual({ entity: 'sales', action: 'sales.payments.create', entityId: 'sale-1' });
    });

    it('strips the api/v1 global prefix', () => {
        expect(resolveAuditTarget({ method: 'DELETE', path: '/api/v2/expenses/:id', params: { id: 'e1' } })).toEqual({
            entity: 'expenses',
            action: 'expenses.delete',
            entityId: 'e1',
        });
    });

    it('reads ids positionally when handed a concrete URL instead of a route template', () => {
        const uuid = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
        expect(resolveAuditTarget({ method: 'PATCH', path: `/api/v1/customers/${uuid}` })).toEqual({
            entity: 'customers',
            action: 'customers.update',
            entityId: uuid,
        });
    });

    it('treats numeric and opaque segments as identifiers, not sub-resources', () => {
        expect(resolveAuditTarget({ method: 'DELETE', path: '/api/v1/invoices/4821' })?.action).toBe(
            'invoices.delete',
        );
        expect(
            resolveAuditTarget({ method: 'POST', path: '/api/v1/orders/ckl2n8vq70000abcdef123456/void' })?.action,
        ).toBe('orders.void.create');
    });

    it('prefers the id route param over other params', () => {
        expect(
            resolveAuditTarget({
                method: 'DELETE',
                path: '/api/v1/stores/:storeId/products/:id',
                params: { storeId: 'store-9', id: 'prod-3' },
            })?.entityId,
        ).toBe('prod-3');
    });

    it('falls back to the last route param when there is no id', () => {
        expect(
            resolveAuditTarget({
                method: 'DELETE',
                path: '/api/v1/team/members/:userId/stores/:storeId',
                params: { userId: 'u1', storeId: 's1' },
            })?.entityId,
        ).toBe('s1');
    });

    it('returns null when there is no resource segment', () => {
        expect(resolveAuditTarget({ method: 'POST', path: '/api/v1' })).toBeNull();
        expect(resolveAuditTarget({ method: 'POST', path: '/' })).toBeNull();
    });

    it('drops the query string before deriving', () => {
        expect(resolveAuditTarget({ method: 'POST', path: '/api/v1/sales?store=1' })?.action).toBe('sales.create');
    });
});

describe('redactPayload', () => {
    it('masks sensitive keys regardless of casing or separators', () => {
        const out = redactPayload({
            email: 'a@b.com',
            password: 'hunter2',
            password_hash: 'x',
            newPassword: 'y',
            'API-KEY': 'z',
        }) as Record<string, unknown>;

        expect(out.email).toBe('a@b.com');
        expect(out.password).toBe(REDACTED_PLACEHOLDER);
        expect(out.password_hash).toBe(REDACTED_PLACEHOLDER);
        expect(out.newPassword).toBe(REDACTED_PLACEHOLDER);
        expect(out['API-KEY']).toBe(REDACTED_PLACEHOLDER);
    });

    it('walks nested objects and arrays', () => {
        const out = redactPayload({ users: [{ name: 'A', token: 't' }] }) as any;
        expect(out.users[0].name).toBe('A');
        expect(out.users[0].token).toBe(REDACTED_PLACEHOLDER);
    });

    it('stops recursing past the depth cap instead of hanging', () => {
        const deep: any = {};
        let cursor = deep;
        for (let i = 0; i < 20; i += 1) {
            cursor.next = {};
            cursor = cursor.next;
        }
        expect(() => redactPayload(deep)).not.toThrow();
        expect(JSON.stringify(redactPayload(deep))).toContain('[truncated]');
    });

    it('leaves primitives and dates serializable', () => {
        expect(redactPayload(null)).toBeNull();
        expect(redactPayload(5)).toBe(5);
        expect(redactPayload(new Date('2026-01-01T00:00:00.000Z'))).toBe('2026-01-01T00:00:00.000Z');
    });
});

describe('buildAuditPayload', () => {
    it('returns undefined for an empty body and no extras', () => {
        expect(buildAuditPayload(undefined)).toBeUndefined();
        expect(buildAuditPayload({})).toBeUndefined();
    });

    it('merges extras alongside the redacted body', () => {
        expect(buildAuditPayload({ name: 'Widget', password: 'p' }, { store_id: 's1' })).toEqual({
            name: 'Widget',
            password: REDACTED_PLACEHOLDER,
            store_id: 's1',
        });
    });

    it('keeps extras when the body is empty', () => {
        expect(buildAuditPayload({}, { store_id: 's1' })).toEqual({ store_id: 's1' });
    });

    it('wraps an array body under items', () => {
        expect(buildAuditPayload([{ sku: 'A' }])).toEqual({ items: [{ sku: 'A' }] });
    });

    it('collapses an oversized body to a marker so bulk imports cannot bloat the table', () => {
        const huge = { rows: Array.from({ length: 5000 }, (_, i) => ({ sku: `SKU-${i}`, qty: i })) };
        const payload = buildAuditPayload(huge, { store_id: 's1' }) as Record<string, unknown>;
        expect(payload._truncated).toBe(true);
        expect(payload.store_id).toBe('s1');
        expect(payload.rows).toBeUndefined();
    });
});

describe('extractResultId', () => {
    it('pulls an id off the controller result', () => {
        expect(extractResultId({ id: 'abc' })).toBe('abc');
        expect(extractResultId({ uuid: 'u1' })).toBe('u1');
    });

    it('returns undefined for non-objects and id-less results', () => {
        expect(extractResultId(undefined)).toBeUndefined();
        expect(extractResultId('ok')).toBeUndefined();
        expect(extractResultId({ message: 'done' })).toBeUndefined();
    });
});

describe('extractRequestMeta', () => {
    it('prefers the left-most x-forwarded-for entry over the socket address', () => {
        expect(
            extractRequestMeta({
                headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1', 'user-agent': 'Firefox' },
                ip: '10.0.0.1',
            }),
        ).toEqual({ ipAddress: '203.0.113.5', userAgent: 'Firefox' });
    });

    it('falls back to the socket address when unproxied', () => {
        expect(extractRequestMeta({ headers: {}, socket: { remoteAddress: '127.0.0.1' } })).toEqual({
            ipAddress: '127.0.0.1',
            userAgent: undefined,
        });
    });

    it('tolerates a bare request object', () => {
        expect(extractRequestMeta({})).toEqual({ ipAddress: undefined, userAgent: undefined });
        expect(extractRequestMeta(undefined)).toEqual({ ipAddress: undefined, userAgent: undefined });
    });
});
