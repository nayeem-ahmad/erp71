import { codeForNewRecord, isCodeConflict, nextSeriesCode } from './code-series.util';

describe('code-series.util', () => {
    describe('nextSeriesCode()', () => {
        const dbReturning = (last: string | null) => ({
            $queryRaw: jest.fn().mockResolvedValue(last === null ? [] : [{ last }]),
        });

        it('pads the number after the highest in the series to five digits', async () => {
            await expect(nextSeriesCode(dbReturning('11'), 'Customer', 't1')).resolves.toBe('CUST-00012');
            await expect(nextSeriesCode(dbReturning('0'), 'Product', 't1')).resolves.toBe('PRD-00001');
            await expect(nextSeriesCode(dbReturning('41'), 'Supplier', 't1')).resolves.toBe('SUP-00042');
        });

        it('lets the series grow past five digits rather than truncating', async () => {
            await expect(nextSeriesCode(dbReturning('123455'), 'Product', 't1')).resolves.toBe('PRD-123456');
        });

        it('starts at 00001 when nothing came back', async () => {
            await expect(nextSeriesCode(dbReturning(null), 'Supplier', 't1')).resolves.toBe('SUP-00001');
        });

        it("reads the table's code column numerically, anchored, scoped to the tenant", async () => {
            const db = dbReturning('1');
            await nextSeriesCode(db, 'Product', 'tenant-9');

            const query = db.$queryRaw.mock.calls[0][0];
            expect(query.sql).toContain('FROM "Product"');
            expect(query.sql).toContain('"sku"');
            expect(query.sql).toContain('::numeric');
            // Anchored, so `PRD-12a` and `XPRD-99` cannot move the series.
            expect(query.values).toEqual(['^PRD\\-([0-9]+)$', 'tenant-9', 'PRD-%']);
        });
    });

    describe('isCodeConflict()', () => {
        it("is a unique-index clash on the table's code column", () => {
            expect(isCodeConflict({ code: 'P2002', meta: { target: ['tenant_id', 'customer_code'] } }, 'Customer')).toBe(true);
            expect(isCodeConflict({ code: 'P2002', meta: { target: 'Supplier_tenant_id_supplier_code_key' } }, 'Supplier')).toBe(true);
        });

        it('is not a clash on another column, nor another error', () => {
            expect(isCodeConflict({ code: 'P2002', meta: { target: ['tenant_id', 'name'] } }, 'Supplier')).toBe(false);
            expect(isCodeConflict({ code: 'P2025' }, 'Product')).toBe(false);
            expect(isCodeConflict(new Error('boom'), 'Product')).toBe(false);
        });
    });

    describe('codeForNewRecord()', () => {
        const clash = { code: 'P2002', meta: { target: ['tenant_id', 'customer_code'] } };

        function db(opts: { taken?: string[]; last?: string } = {}) {
            const taken = new Set(opts.taken ?? []);
            let last = Number(opts.last ?? '0');
            return {
                customer: {
                    findFirst: jest.fn(async ({ where }: any) => (taken.has(where.customer_code) ? { id: 'other' } : null)),
                },
                $queryRaw: jest.fn(async () => [{ last: String(last) }]),
                /** A code someone else saved between our read and our write. */
                bump: () => { last += 1; },
            };
        }

        it("creates with the source's code when no one holds it", async () => {
            const d = db();
            const create = jest.fn(async (code: string) => ({ id: 'new', code }));

            await expect(codeForNewRecord(d, 'Customer', 't1', 'C00564', create)).resolves.toEqual({ id: 'new', code: 'C00564' });
            expect(d.$queryRaw).not.toHaveBeenCalled();
        });

        it('takes the next in the series when the source has no usable code', async () => {
            const d = db({ last: '7' });
            const create = jest.fn(async (code: string) => code);

            await expect(codeForNewRecord(d, 'Customer', 't1', null, create)).resolves.toBe('CUST-00008');
        });

        it("takes the next in the series when another record already holds the source's code", async () => {
            const d = db({ taken: ['C00564'], last: '2' });
            const create = jest.fn(async (code: string) => code);

            await expect(codeForNewRecord(d, 'Customer', 't1', 'C00564', create)).resolves.toBe('CUST-00003');
            // Deleted rows hold their codes too: the unique index spans them.
            expect(d.customer.findFirst).toHaveBeenCalledWith({
                where: { tenant_id: 't1', customer_code: 'C00564' },
                select: { id: true },
            });
        });

        it('moves on to a fresh number when someone else took the one it read', async () => {
            const d = db({ last: '4' });
            const create = jest.fn(async (code: string) => {
                if (code === 'CUST-00005') {
                    d.bump();
                    throw clash;
                }
                return code;
            });

            await expect(codeForNewRecord(d, 'Customer', 't1', null, create)).resolves.toBe('CUST-00006');
        });

        it('passes any other failure straight through', async () => {
            const d = db();
            const create = jest.fn(async () => { throw new Error('store is gone'); });

            await expect(codeForNewRecord(d, 'Customer', 't1', 'C1', create)).rejects.toThrow('store is gone');
            expect(create).toHaveBeenCalledTimes(1);
        });
    });
});
