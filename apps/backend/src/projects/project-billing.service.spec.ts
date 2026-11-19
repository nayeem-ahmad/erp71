import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ProjectBillingService } from './project-billing.service';
import { ProjectUnbilledService, UNBILLED_ENTRY, BILLABLE_ENTRY } from './project-unbilled.service';
import { OWNER } from './project-access.test-support';

const dec = (value: number) => new Prisma.Decimal(value);

describe('ProjectBillingService', () => {
    let db: any;
    let sales: { create: jest.Mock };
    let audit: { log: jest.Mock };
    let service: ProjectBillingService;
    let unbilled: ProjectUnbilledService;
    const canSell = jest.fn().mockResolvedValue(true);
    const ctx = { userId: 'owner' };
    const viewer = { ...OWNER, storeId: 'store-1' };

    const project = (overrides: Record<string, unknown> = {}) => ({
        id: 'p1',
        code: 'BS23',
        store_id: 'store-1',
        customer_id: 'cust-1',
        billing_type: 'FIXED_PRICE',
        contract_value: dec(12000),
        bill_rate: null,
        customer: { id: 'cust-1', name: 'Rahim Traders' },
        ...overrides,
    });

    beforeEach(() => {
        jest.clearAllMocks();
        canSell.mockResolvedValue(true);
        db = {
            project: { findFirst: jest.fn().mockResolvedValue(project()) },
            projectMilestone: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
            projectTimeEntry: { findMany: jest.fn().mockResolvedValue([]) },
            projectMember: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn(), update: jest.fn() },
            projectCostingSettings: { findUnique: jest.fn().mockResolvedValue({ billing_product_id: 'svc-1' }) },
            product: {
                findFirst: jest.fn().mockResolvedValue({ id: 'svc-1', type: 'SERVICE', vat_rate: dec(15), sd_rate: null }),
                findMany: jest.fn().mockResolvedValue([]),
            },
            tenant: { findUnique: jest.fn().mockResolvedValue({ default_vat_rate: dec(15) }) },
            sale: { findMany: jest.fn().mockResolvedValue([]) },
        };
        sales = { create: jest.fn().mockResolvedValue({ id: 'sale-1', serial_number: 'INV-0042' }) };
        audit = { log: jest.fn().mockResolvedValue(undefined) };
        unbilled = new ProjectUnbilledService(db);
        service = new ProjectBillingService(db, { assertProjectVisible: jest.fn().mockResolvedValue({}) } as any, sales as any, audit as any, unbilled);
    });

    describe('invoice — who and where', () => {
        it('refuses an internal project', async () => {
            db.project.findFirst.mockResolvedValue(project({ billing_type: 'INTERNAL' }));
            await expect(service.invoice(viewer, 'p1', { kind: 'AMOUNT', amount: 10, description: 'x' }, ctx, canSell)).rejects.toThrow(BadRequestException);
        });

        it('refuses a project with no customer to raise it to', async () => {
            db.project.findFirst.mockResolvedValue(project({ customer_id: null }));
            await expect(service.invoice(viewer, 'p1', { kind: 'AMOUNT', amount: 10, description: 'x' }, ctx, canSell)).rejects.toThrow(/customer/);
        });

        it('refuses a branch the caller cannot sell in', async () => {
            canSell.mockResolvedValue(false);
            await expect(service.invoice(viewer, 'p1', { kind: 'AMOUNT', amount: 10, description: 'x' }, ctx, canSell)).rejects.toThrow(/cannot create sales/);
            expect(sales.create).not.toHaveBeenCalled();
        });

        it('bills only a service product', async () => {
            db.product.findFirst.mockResolvedValue({ id: 'goods-1', type: 'GOODS', vat_rate: null, sd_rate: null });
            await expect(service.invoice(viewer, 'p1', { kind: 'AMOUNT', amount: 10, description: 'x' }, ctx, canSell)).rejects.toThrow(/service product/);
        });

        it('asks for a billing product when none is set', async () => {
            db.projectCostingSettings.findUnique.mockResolvedValue(null);
            await expect(service.invoice(viewer, 'p1', { kind: 'AMOUNT', amount: 10, description: 'x' }, ctx, canSell)).rejects.toThrow(/Choose the service product/);
        });
    });

    describe('invoice a milestone', () => {
        beforeEach(() => {
            db.projectMilestone.findFirst.mockResolvedValue({ id: 'm1', name: 'Foundation', amount: dec(4600) });
        });

        it('raises a credit sale to the customer for the milestone, tagged with the project', async () => {
            const result = await service.invoice(viewer, 'p1', { kind: 'MILESTONE', milestoneId: 'm1' }, ctx, canSell);

            expect(sales.create).toHaveBeenCalledWith(
                'tenant-1',
                'owner',
                expect.objectContaining({
                    storeId: 'store-1',
                    customerId: 'cust-1',
                    items: [{ productId: 'svc-1', quantity: 1, priceAtSale: 4600 }],
                    totalAmount: 4600,
                    amountPaid: 0,
                    pricesIncludeVat: true,
                    note: 'BS23 · Foundation',
                }),
                expect.objectContaining({ projectId: 'p1', onCreated: expect.any(Function) }),
            );
            expect(result).toEqual({ saleId: 'sale-1', serialNumber: 'INV-0042', totalAmount: 4600 });
        });

        it('marks the milestone inside the sale\'s transaction, and refuses one invoiced a moment ago', async () => {
            await service.invoice(viewer, 'p1', { kind: 'MILESTONE', milestoneId: 'm1' }, ctx, canSell);
            const { onCreated } = sales.create.mock.calls[0][3];

            const tx = { projectMilestone: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
            await onCreated(tx, { id: 'sale-1' });
            expect(tx.projectMilestone.updateMany).toHaveBeenCalledWith({
                where: { id: 'm1', OR: [{ sale_id: null }, { sale: { status: 'CANCELLED' } }] },
                data: { sale_id: 'sale-1' },
            });

            tx.projectMilestone.updateMany.mockResolvedValue({ count: 0 });
            await expect(onCreated(tx, { id: 'sale-2' })).rejects.toThrow(ConflictException);
        });

        it('grosses a pre-VAT amount up by the product\'s VAT', async () => {
            db.projectMilestone.findFirst.mockResolvedValue({ id: 'm1', name: 'Foundation', amount: dec(4000) });

            await service.invoice(viewer, 'p1', { kind: 'MILESTONE', milestoneId: 'm1', amountIncludesVat: false }, ctx, canSell);

            expect(sales.create.mock.calls[0][2].items[0].priceAtSale).toBe(4600);
        });

        it('refuses a milestone with no amount, or one already invoiced', async () => {
            db.projectMilestone.findFirst.mockResolvedValueOnce({ id: 'm1', name: 'Foundation', amount: null });
            await expect(service.invoice(viewer, 'p1', { kind: 'MILESTONE', milestoneId: 'm1' }, ctx, canSell)).rejects.toThrow(/amount/);

            db.projectMilestone.findFirst.mockResolvedValueOnce(null);
            await expect(service.invoice(viewer, 'p1', { kind: 'MILESTONE', milestoneId: 'm1' }, ctx, canSell)).rejects.toThrow(NotFoundException);
        });
    });

    describe('invoice hours', () => {
        const entries = [
            { id: 't1', hours: dec(4), user_id: 'u1', employee_id: 'e1', user: { name: 'Karim', email: 'k@x.com' }, employee: { name: 'Karim Uddin' } },
            { id: 't2', hours: dec(2), user_id: 'u2', employee_id: null, user: { name: 'Abdul', email: 'a@x.com' }, employee: null },
        ];

        beforeEach(() => {
            db.project.findFirst.mockResolvedValue(project({ billing_type: 'TIME_AND_MATERIALS', bill_rate: dec(500) }));
            db.projectTimeEntry.findMany.mockResolvedValue(entries);
            // Karim has his own rate on this project; Abdul falls back to the project's.
            db.projectMember.findMany.mockResolvedValue([{ id: 'mem-1', user_id: 'u1', employee_id: 'e1', bill_rate: dec(800) }]);
        });

        it('prices billable, unbilled hours at the member\'s rate, else the project\'s', async () => {
            const result = await unbilled.unbilledHours('tenant-1', { id: 'p1', bill_rate: dec(500) }, '2026-09-30');

            expect(result.people).toEqual([
                expect.objectContaining({ name: 'Karim Uddin', hours: 4, rate: 800, rateSource: 'MEMBER', amount: 3200, memberId: 'mem-1' }),
                expect.objectContaining({ name: 'Abdul', hours: 2, rate: 500, rateSource: 'PROJECT', amount: 1000, memberId: null }),
            ]);
            expect(result.amount).toBe(4200);
            expect(db.projectTimeEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({
                    work_date: { lte: new Date('2026-09-30') },
                    AND: [UNBILLED_ENTRY, BILLABLE_ENTRY],
                }),
            }));
        });

        it('invoices them and claims exactly those hours inside the sale\'s transaction', async () => {
            await service.invoice(viewer, 'p1', { kind: 'HOURS', upTo: '2026-09-30' }, ctx, canSell);

            expect(sales.create.mock.calls[0][2]).toEqual(expect.objectContaining({ totalAmount: 4200, note: 'BS23 · 6 h to 2026-09-30' }));
            const { onCreated } = sales.create.mock.calls[0][3];
            const tx = { projectTimeEntry: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) } };
            await onCreated(tx, { id: 'sale-1' });
            expect(tx.projectTimeEntry.updateMany).toHaveBeenCalledWith({
                where: { id: { in: ['t1', 't2'] }, ...UNBILLED_ENTRY },
                data: { billed_sale_id: 'sale-1' },
            });

            tx.projectTimeEntry.updateMany.mockResolvedValue({ count: 1 });
            await expect(onCreated(tx, { id: 'sale-2' })).rejects.toThrow(ConflictException);
        });

        it('refuses hours nobody has set a rate for', async () => {
            db.project.findFirst.mockResolvedValue(project({ billing_type: 'TIME_AND_MATERIALS', bill_rate: null }));
            db.projectMember.findMany.mockResolvedValue([]);

            await expect(service.invoice(viewer, 'p1', { kind: 'HOURS' }, ctx, canSell)).rejects.toThrow(/bill rate/);
            expect(sales.create).not.toHaveBeenCalled();
        });

        it('bills hours only on a time-and-materials project', async () => {
            db.project.findFirst.mockResolvedValue(project({ billing_type: 'FIXED_PRICE' }));
            await expect(service.invoice(viewer, 'p1', { kind: 'HOURS' }, ctx, canSell)).rejects.toThrow(/time-and-materials/);
        });
    });

    describe('invoice an amount', () => {
        it('needs a description of what it is for', async () => {
            await expect(service.invoice(viewer, 'p1', { kind: 'AMOUNT', amount: 2000 }, ctx, canSell)).rejects.toThrow(/what the amount is for/);

            await service.invoice(viewer, 'p1', { kind: 'AMOUNT', amount: 2000, description: 'Advance' }, ctx, canSell);
            expect(sales.create.mock.calls[0][2]).toEqual(expect.objectContaining({ totalAmount: 2000, note: 'BS23 · Advance' }));
        });
    });

    describe('setMemberBillRate', () => {
        it('sets a member\'s own rate, and refuses someone not on the project', async () => {
            db.projectMember.findFirst.mockResolvedValueOnce({ id: 'mem-1', bill_rate: null });
            db.projectMember.update.mockResolvedValue({ id: 'mem-1', bill_rate: dec(900) });

            await expect(service.setMemberBillRate(OWNER, 'p1', 'mem-1', 900, ctx)).resolves.toEqual({ id: 'mem-1', billRate: 900 });

            db.projectMember.findFirst.mockResolvedValueOnce(null);
            await expect(service.setMemberBillRate(OWNER, 'p1', 'mem-x', 900, ctx)).rejects.toThrow(NotFoundException);
        });
    });

    describe('billing view', () => {
        it('shows invoices, milestones with what billed them, and nothing unbilled off time and materials', async () => {
            db.sale.findMany.mockResolvedValue([
                { id: 's1', serial_number: 'INV-1', sale_date: new Date('2026-08-20T00:00:00Z'), total_amount: dec(4600), amount_paid: dec(0), status: 'COMPLETED', note: 'BS23 · Foundation' },
            ]);
            db.projectMilestone.findMany.mockResolvedValue([
                { id: 'm1', name: 'Foundation', target_date: null, completed_at: new Date(), amount: dec(4600), sale: { id: 's1', serial_number: 'INV-1', status: 'COMPLETED' } },
                { id: 'm2', name: 'Roof', target_date: null, completed_at: null, amount: dec(3000), sale: { id: 's0', serial_number: 'INV-0', status: 'CANCELLED' } },
            ]);

            const view = await service.billing(OWNER, 'p1');

            expect(view.milestones.map((m) => [m.name, m.invoice?.serialNumber ?? null])).toEqual([['Foundation', 'INV-1'], ['Roof', null]]);
            expect(view.invoices[0]).toEqual(expect.objectContaining({ serialNumber: 'INV-1', totalAmount: 4600 }));
            expect(view.unbilledHours.hours).toBe(0);
            expect(db.projectTimeEntry.findMany).not.toHaveBeenCalled();
        });
    });
});
