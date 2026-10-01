import { NotFoundException, BadRequestException } from '@nestjs/common';
import { planMerge, throwIfBlocked } from './products.merge';

function product(over: Record<string, unknown> = {}) {
    return { id: 'src', tenant_id: 't1', deleted_at: null, type: 'GOODS', name: 'Dup', sku: 'D', price: 16, ...over };
}

function dbWith(source: any, target: any, extra: Record<string, any> = {}) {
    return {
        product: {
            findFirst: jest.fn(async ({ where }: any) => {
                if (where.id === source?.id && where.tenant_id === 't1' && where.deleted_at === null) return source;
                if (where.id === target?.id && where.tenant_id === 't1' && where.deleted_at === null) return target;
                return null;
            }),
        },
        productSerial: { findMany: jest.fn().mockResolvedValue([]) },
        bomRecipe: { findMany: jest.fn().mockResolvedValue([]) },
        ...extra,
    };
}

describe('planMerge guards', () => {
    it('blocks a missing source', async () => {
        const plan = await planMerge(dbWith(null, product({ id: 'tgt' })), 't1', 'src', 'tgt');
        expect(plan.blockers.map((b) => b.code)).toEqual(['SOURCE_NOT_FOUND']);
    });

    it('blocks a target in another tenant', async () => {
        const plan = await planMerge(
            dbWith(product({ id: 'src' }), product({ id: 'tgt', tenant_id: 'other' })),
            't1',
            'src',
            'tgt',
        );
        expect(plan.blockers.map((b) => b.code)).toEqual(['TARGET_NOT_FOUND']);
    });

    it('blocks merge into self', async () => {
        const p = product({ id: 'src' });
        const plan = await planMerge(dbWith(p, p), 't1', 'src', 'src');
        expect(plan.blockers.map((b) => b.code)).toContain('SAME_PRODUCT');
    });

    it('blocks GOODS into SERVICE', async () => {
        const plan = await planMerge(
            dbWith(product({ id: 'src', type: 'GOODS' }), product({ id: 'tgt', type: 'SERVICE' })),
            't1',
            'src',
            'tgt',
        );
        expect(plan.blockers.map((b) => b.code)).toContain('TYPE_MISMATCH');
    });

    it('blocks when both products share a serial_number', async () => {
        const plan = await planMerge(
            dbWith(product({ id: 'src' }), product({ id: 'tgt' }), {
                productSerial: {
                    findMany: jest.fn().mockResolvedValue([
                        { product_id: 'src', serial_number: 'SN-1' },
                        { product_id: 'tgt', serial_number: 'SN-1' },
                    ]),
                },
            }),
            't1',
            'src',
            'tgt',
        );
        expect(plan.blockers.map((b) => b.code)).toContain('SERIAL_COLLISION');
    });

    it('blocks when both products have a BomRecipe', async () => {
        const plan = await planMerge(
            dbWith(product({ id: 'src' }), product({ id: 'tgt' }), {
                bomRecipe: {
                    findMany: jest.fn().mockResolvedValue([
                        { productId: 'src' },
                        { productId: 'tgt' },
                    ]),
                },
            }),
            't1',
            'src',
            'tgt',
        );
        expect(plan.blockers.map((b) => b.code)).toContain('BOM_CONFLICT');
    });
});

describe('throwIfBlocked', () => {
    it('404s SOURCE_NOT_FOUND on preview', () => {
        expect(() => throwIfBlocked({ blockers: [{ code: 'SOURCE_NOT_FOUND', message: 'gone' }] } as any, 'preview'))
            .toThrow(NotFoundException);
    });

    it('400s TARGET_NOT_FOUND on commit and not on preview', () => {
        const plan = { blockers: [{ code: 'TARGET_NOT_FOUND', message: 'gone' }] } as any;
        expect(() => throwIfBlocked(plan, 'preview')).not.toThrow();
        expect(() => throwIfBlocked(plan, 'commit')).toThrow(BadRequestException);
    });
});
