import { ConflictException, NotFoundException } from '@nestjs/common';
import {
    ExpenseClaimApprovals,
    ProductDemandApprovals,
    VoucherApprovals,
    WarehouseTransferApprovals,
} from './approval-providers';

const ctx = { tenantId: 't1', userId: 'u1' };

describe('approval providers', () => {
    describe('expense claims', () => {
        it('lists submitted claims with the claimant and amount', async () => {
            const db = {
                expenseClaim: {
                    findMany: jest.fn().mockResolvedValue([
                        {
                            id: 'c1', title: 'Travel to Ctg', total_amount: '1200.50', notes: null,
                            claim_date: new Date('2026-10-05T00:00:00Z'), updated_at: new Date('2026-10-06T00:00:00Z'),
                            employee: { name: 'Rina' }, _count: { lines: 2 },
                        },
                    ]),
                },
            };
            const [row] = await new ExpenseClaimApprovals(db as any, {} as any).pending('t1');
            expect(db.expenseClaim.findMany.mock.calls[0][0].where).toEqual({ tenant_id: 't1', status: 'SUBMITTED', deleted_at: null });
            expect(row).toEqual(expect.objectContaining({ kind: 'EXPENSE_CLAIM', amount: 1200.5, requested_by: 'Rina' }));
            expect(row.details).toContainEqual({ label: 'Lines', value: '2' });
        });

        it('answers 409 for a claim someone already decided, and 404 for none', async () => {
            const claims = { review: jest.fn() };
            const db = { expenseClaim: { findFirst: jest.fn().mockResolvedValue({ status: 'APPROVED' }) } };
            const approvals = new ExpenseClaimApprovals(db as any, claims as any);

            await expect(approvals.approve(ctx, 'c1')).rejects.toBeInstanceOf(ConflictException);
            db.expenseClaim.findFirst.mockResolvedValue(null);
            await expect(approvals.reject(ctx, 'c1', 'no')).rejects.toBeInstanceOf(NotFoundException);
            expect(claims.review).not.toHaveBeenCalled();
        });

        it('decides through ExpenseClaimsService.review', async () => {
            const claims = { review: jest.fn() };
            const db = { expenseClaim: { findFirst: jest.fn().mockResolvedValue({ status: 'SUBMITTED' }) } };
            await new ExpenseClaimApprovals(db as any, claims as any).reject(ctx, 'c1', 'Receipt missing');
            expect(claims.review).toHaveBeenCalledWith('t1', 'c1', 'u1', { status: 'REJECTED', approver_note: 'Receipt missing' });
        });
    });

    it('narrows product demands to the branches in scope', async () => {
        const db = {
            productDemand: { findMany: jest.fn().mockResolvedValue([]) },
            user: { findMany: jest.fn().mockResolvedValue([]) },
        };
        const demands = new ProductDemandApprovals(db as any, {} as any);
        await demands.pending('t1', ['store-1']);
        expect(db.productDemand.findMany.mock.calls[0][0].where).toEqual({
            tenant_id: 't1', status: 'SUBMITTED', store_id: { in: ['store-1'] },
        });
        await demands.pending('t1', null);
        expect(db.productDemand.findMany.mock.calls[1][0].where).not.toHaveProperty('store_id');
    });

    it('scopes stock transfers by the branch the stock leaves', async () => {
        const db = {
            warehouseTransfer: { findMany: jest.fn().mockResolvedValue([]) },
            warehouse: { findMany: jest.fn().mockResolvedValue([]) },
        };
        await new WarehouseTransferApprovals(db as any, {} as any).pending('t1', ['store-2']);
        expect(db.warehouseTransfer.findMany.mock.calls[0][0].where).toEqual({
            tenant_id: 't1', status: 'PENDING_APPROVAL', source_store_id: { in: ['store-2'] },
        });
    });

    it('sums a voucher’s debits as its amount, and approves only a pending one', async () => {
        const accounting = { approveVoucher: jest.fn() };
        const db = {
            voucher: {
                findMany: jest.fn().mockResolvedValue([
                    {
                        id: 'v1', voucher_number: 'JV-0007', voucher_type: 'JOURNAL', description: 'Rent',
                        reference_number: null, date: new Date('2026-10-01T00:00:00Z'), created_at: new Date(),
                        store: null, details: [{ debit_amount: '5000' }, { debit_amount: '0' }],
                    },
                ]),
                findFirst: jest.fn().mockResolvedValue({ approval_status: 'REJECTED' }),
            },
        };
        const vouchers = new VoucherApprovals(db as any, accounting as any);

        const [row] = await vouchers.pending('t1');
        expect(row.amount).toBe(5000);
        expect(row.title).toBe('JV-0007 · journal');

        await expect(vouchers.approve(ctx, 'v1')).rejects.toBeInstanceOf(ConflictException);
        expect(accounting.approveVoucher).not.toHaveBeenCalled();
    });
});
