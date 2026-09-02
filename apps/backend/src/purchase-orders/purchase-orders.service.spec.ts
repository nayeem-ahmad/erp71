import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service';
import { DatabaseService } from '../database/database.service';
import { CreatePurchaseOrderDto, UpdatePurchaseOrderStatusDto } from './purchase-order.dto';

jest.mock('../database/inventory.utils', () => ({
    resolveWarehouseId: jest.fn().mockResolvedValue('warehouse-1'),
    applyInventoryMovement: jest.fn().mockResolvedValue(10),
}));

jest.mock('../accounting/posting.utils', () => ({
    autoPostFromRules: jest.fn().mockResolvedValue({ postingStatus: 'skipped' }),
}));

import { resolveWarehouseId, applyInventoryMovement } from '../database/inventory.utils';
import { autoPostFromRules } from '../accounting/posting.utils';

const mockResolveWarehouseId = resolveWarehouseId as jest.MockedFunction<typeof resolveWarehouseId>;
const mockApplyInventoryMovement = applyInventoryMovement as jest.MockedFunction<typeof applyInventoryMovement>;
const mockAutoPostFromRules = autoPostFromRules as jest.MockedFunction<typeof autoPostFromRules>;

describe('PurchaseOrdersService', () => {
    let service: PurchaseOrdersService;
    let db: any;

    const tenantId = 'tenant-1';
    const userId = 'user-1';
    const poId = 'po-id-1';
    const storeId = 'store-1';
    const supplierId = 'supplier-1';
    const productId = 'product-1';

    const baseCreateDto: CreatePurchaseOrderDto = {
        storeId,
        items: [{ productId, quantity: 5, unitCost: 100 }],
    };

    const basePO = {
        id: poId,
        tenant_id: tenantId,
        store_id: storeId,
        po_number: 'PO-00001',
        status: 'DRAFT',
        total_amount: 500,
        items: [
            { product_id: productId, quantity: 5, unit_cost: 100, line_total: 500 },
        ],
    };

    beforeEach(async () => {
        db = {
            store: {
                findFirst: jest.fn(),
            },
            product: {
                findMany: jest.fn(),
            },
            supplier: {
                findFirst: jest.fn(),
            },
            purchaseOrder: {
                findFirst: jest.fn(),
                findMany: jest.fn(),
                create: jest.fn(),
                update: jest.fn(),
                count: jest.fn(),
            },
            tenant: {
                findUnique: jest.fn(),
            },
            $transaction: jest.fn().mockImplementation(async (cb: any) => cb(db)),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PurchaseOrdersService,
                { provide: DatabaseService, useValue: db },
            ],
        }).compile();

        service = module.get<PurchaseOrdersService>(PurchaseOrdersService);
        jest.clearAllMocks();
    });

    // ─── create ───────────────────────────────────────────────────────────────

    describe('create', () => {
        it('creates a purchase order with minimal fields', async () => {
            db.store.findFirst.mockResolvedValue({ id: storeId, name: 'Main Store' });
            db.product.findMany.mockResolvedValue([{ id: productId }]);
            db.purchaseOrder.count.mockResolvedValue(0);
            db.purchaseOrder.create.mockResolvedValue({ ...basePO });

            const result = await service.create(tenantId, userId, baseCreateDto);

            expect(db.store.findFirst).toHaveBeenCalledWith({
                where: { id: storeId, tenant_id: tenantId },
            });
            expect(db.product.findMany).toHaveBeenCalledWith({
                where: { tenant_id: tenantId, id: { in: [productId] } },
            });
            expect(db.purchaseOrder.count).toHaveBeenCalledWith({ where: { tenant_id: tenantId } });
            expect(db.purchaseOrder.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        po_number: 'PO-00001',
                        tenant_id: tenantId,
                        store_id: storeId,
                        subtotal_amount: 500,
                        total_amount: 500,
                        created_by: userId,
                    }),
                }),
            );
            expect(result).toEqual(basePO);
        });

        it('generates sequential PO numbers', async () => {
            db.store.findFirst.mockResolvedValue({ id: storeId });
            db.product.findMany.mockResolvedValue([{ id: productId }]);
            db.purchaseOrder.count.mockResolvedValue(42);
            db.purchaseOrder.create.mockResolvedValue({ po_number: 'PO-00043' });

            await service.create(tenantId, userId, baseCreateDto);

            expect(db.purchaseOrder.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ po_number: 'PO-00043' }),
                }),
            );
        });

        it('calculates totals including tax, discount, and freight', async () => {
            db.store.findFirst.mockResolvedValue({ id: storeId });
            db.product.findMany.mockResolvedValue([{ id: productId }]);
            db.purchaseOrder.count.mockResolvedValue(0);
            db.purchaseOrder.create.mockResolvedValue({});

            const dto: CreatePurchaseOrderDto = {
                ...baseCreateDto,
                taxAmount: 50,
                discountAmount: 20,
                freightAmount: 30,
            };
            await service.create(tenantId, userId, dto);

            // subtotal=500, tax=50, freight=30, discount=20 → total=560
            expect(db.purchaseOrder.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        subtotal_amount: 500,
                        tax_amount: 50,
                        discount_amount: 20,
                        freight_amount: 30,
                        total_amount: 560,
                    }),
                }),
            );
        });

        it('validates supplier when supplierId is provided', async () => {
            db.store.findFirst.mockResolvedValue({ id: storeId });
            db.product.findMany.mockResolvedValue([{ id: productId }]);
            db.supplier.findFirst.mockResolvedValue({ id: supplierId });
            db.purchaseOrder.count.mockResolvedValue(0);
            db.purchaseOrder.create.mockResolvedValue({});

            await service.create(tenantId, userId, { ...baseCreateDto, supplierId });

            expect(db.supplier.findFirst).toHaveBeenCalledWith({
                where: { id: supplierId, tenant_id: tenantId, deleted_at: null },
            });
        });

        it('skips supplier check when supplierId is not provided', async () => {
            db.store.findFirst.mockResolvedValue({ id: storeId });
            db.product.findMany.mockResolvedValue([{ id: productId }]);
            db.purchaseOrder.count.mockResolvedValue(0);
            db.purchaseOrder.create.mockResolvedValue({});

            await service.create(tenantId, userId, baseCreateDto);

            expect(db.supplier.findFirst).not.toHaveBeenCalled();
        });

        it('throws NotFoundException when store is not found', async () => {
            db.store.findFirst.mockResolvedValue(null);

            await expect(service.create(tenantId, userId, baseCreateDto)).rejects.toThrow(
                new NotFoundException('Store not found'),
            );
            expect(db.purchaseOrder.create).not.toHaveBeenCalled();
        });

        it('throws BadRequestException when a product is not found', async () => {
            db.store.findFirst.mockResolvedValue({ id: storeId });
            // Only 0 products returned, but 1 item in dto
            db.product.findMany.mockResolvedValue([]);

            await expect(service.create(tenantId, userId, baseCreateDto)).rejects.toThrow(
                new BadRequestException('One or more products not found.'),
            );
        });

        it('throws BadRequestException when supplier is not found', async () => {
            db.store.findFirst.mockResolvedValue({ id: storeId });
            db.product.findMany.mockResolvedValue([{ id: productId }]);
            db.supplier.findFirst.mockResolvedValue(null);

            await expect(
                service.create(tenantId, userId, { ...baseCreateDto, supplierId }),
            ).rejects.toThrow(new BadRequestException('Supplier not found.'));
        });

        it('creates PO items with correct line totals', async () => {
            db.store.findFirst.mockResolvedValue({ id: storeId });
            db.product.findMany.mockResolvedValue([
                { id: 'prod-1' },
                { id: 'prod-2' },
            ]);
            db.purchaseOrder.count.mockResolvedValue(0);
            db.purchaseOrder.create.mockResolvedValue({});

            const dto: CreatePurchaseOrderDto = {
                storeId,
                items: [
                    { productId: 'prod-1', quantity: 3, unitCost: 50 },
                    { productId: 'prod-2', quantity: 2, unitCost: 75 },
                ],
            };
            await service.create(tenantId, userId, dto);

            expect(db.purchaseOrder.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        items: {
                            create: [
                                { product_id: 'prod-1', quantity: 3, unit_cost: 50, line_total: 150 },
                                { product_id: 'prod-2', quantity: 2, unit_cost: 75, line_total: 150 },
                            ],
                        },
                        subtotal_amount: 300,
                        total_amount: 300,
                    }),
                }),
            );
        });

        it('converts expectedDate string to Date object', async () => {
            db.store.findFirst.mockResolvedValue({ id: storeId });
            db.product.findMany.mockResolvedValue([{ id: productId }]);
            db.purchaseOrder.count.mockResolvedValue(0);
            db.purchaseOrder.create.mockResolvedValue({});

            await service.create(tenantId, userId, { ...baseCreateDto, expectedDate: '2026-12-31' });

            expect(db.purchaseOrder.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        expected_date: new Date('2026-12-31'),
                    }),
                }),
            );
        });
    });

    // ─── findAll ──────────────────────────────────────────────────────────────

    describe('findAll', () => {
        it('returns all purchase orders for the tenant', async () => {
            const orders = [basePO, { ...basePO, id: 'po-2', po_number: 'PO-00002' }];
            db.purchaseOrder.findMany.mockResolvedValue(orders);
            db.purchaseOrder.count.mockResolvedValue(2);

            const result = await service.findAll(tenantId);

            expect(db.purchaseOrder.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { tenant_id: tenantId },
                    orderBy: { created_at: 'desc' },
                }),
            );
            expect(result.items).toEqual(orders);
            expect(result.total).toBe(2);
        });

        it('returns empty array when no orders exist', async () => {
            db.purchaseOrder.findMany.mockResolvedValue([]);
            db.purchaseOrder.count.mockResolvedValue(0);

            const result = await service.findAll(tenantId);

            expect(result.items).toEqual([]);
            expect(result.total).toBe(0);
        });

        it('filters created_at to the inclusive Dhaka day range', async () => {
            db.purchaseOrder.findMany.mockResolvedValue([]);
            db.purchaseOrder.count.mockResolvedValue(0);

            await service.findAll(tenantId, 1, 20, { timezone: 'Asia/Dhaka', createdFrom: '2026-08-19', createdTo: '2026-08-19' });

            expect(db.purchaseOrder.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        created_at: {
                            gte: new Date('2026-08-18T18:00:00.000Z'),
                            lte: new Date('2026-08-19T17:59:59.999Z'),
                        },
                    }),
                }),
            );
        });
    });

    // ─── findOne ──────────────────────────────────────────────────────────────

    describe('findOne', () => {
        it('returns a purchase order by id', async () => {
            db.purchaseOrder.findFirst.mockResolvedValue(basePO);

            const result = await service.findOne(tenantId, poId);

            expect(db.purchaseOrder.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: poId, tenant_id: tenantId },
                }),
            );
            expect(result).toEqual(basePO);
        });

        it('throws NotFoundException when PO does not exist', async () => {
            db.purchaseOrder.findFirst.mockResolvedValue(null);

            await expect(service.findOne(tenantId, 'nonexistent')).rejects.toThrow(
                new NotFoundException('Purchase order not found'),
            );
        });
    });

    // ─── updateStatus ─────────────────────────────────────────────────────────

    describe('updateStatus', () => {
        const sentDto: UpdatePurchaseOrderStatusDto = { status: 'SENT' };
        const cancelDto: UpdatePurchaseOrderStatusDto = { status: 'CANCELLED' };
        const receivedDto: UpdatePurchaseOrderStatusDto = { status: 'RECEIVED' };

        it('updates status to SENT for a DRAFT order', async () => {
            db.purchaseOrder.findFirst.mockResolvedValue({ ...basePO, status: 'DRAFT' });
            db.purchaseOrder.update.mockResolvedValue({ ...basePO, status: 'SENT' });

            const result = await service.updateStatus(tenantId, poId, sentDto);

            expect(db.purchaseOrder.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: poId },
                    data: { status: 'SENT' },
                }),
            );
            expect(result.status).toBe('SENT');
        });

        it('updates status to CANCELLED for a DRAFT order', async () => {
            db.purchaseOrder.findFirst.mockResolvedValue({ ...basePO, status: 'DRAFT' });
            db.purchaseOrder.update.mockResolvedValue({ ...basePO, status: 'CANCELLED' });

            await service.updateStatus(tenantId, poId, cancelDto);

            expect(db.purchaseOrder.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: { status: 'CANCELLED' } }),
            );
        });

        it('throws NotFoundException when PO does not exist', async () => {
            db.purchaseOrder.findFirst.mockResolvedValue(null);

            await expect(service.updateStatus(tenantId, poId, sentDto)).rejects.toThrow(
                new NotFoundException('Purchase order not found'),
            );
        });

        it('throws BadRequestException when PO is already RECEIVED', async () => {
            db.purchaseOrder.findFirst.mockResolvedValue({ ...basePO, status: 'RECEIVED' });

            await expect(service.updateStatus(tenantId, poId, sentDto)).rejects.toThrow(
                new BadRequestException('This purchase order has already been received.'),
            );
        });

        it('throws BadRequestException when PO is CANCELLED', async () => {
            db.purchaseOrder.findFirst.mockResolvedValue({ ...basePO, status: 'CANCELLED' });

            await expect(service.updateStatus(tenantId, poId, receivedDto)).rejects.toThrow(
                new BadRequestException('Cancelled purchase orders cannot be updated.'),
            );
        });

        describe('when status is RECEIVED', () => {
            beforeEach(() => {
                mockResolveWarehouseId.mockResolvedValue('warehouse-1');
                mockApplyInventoryMovement.mockResolvedValue(10);
                mockAutoPostFromRules.mockResolvedValue({ postingStatus: 'skipped' });
            });

            it('runs a transaction and applies inventory movements for each item', async () => {
                const po = {
                    ...basePO,
                    status: 'SENT',
                    items: [
                        { product_id: 'prod-1', quantity: 3, unit_cost: 100 },
                        { product_id: 'prod-2', quantity: 5, unit_cost: 200 },
                    ],
                };
                db.purchaseOrder.findFirst.mockResolvedValue(po);
                db.purchaseOrder.update.mockResolvedValue({ ...po, status: 'RECEIVED' });

                await service.updateStatus(tenantId, poId, receivedDto);

                expect(db.$transaction).toHaveBeenCalled();
                expect(mockResolveWarehouseId).toHaveBeenCalledWith(
                    db,
                    tenantId,
                    po.store_id,
                    undefined,
                    'purchase',
                );
                expect(mockApplyInventoryMovement).toHaveBeenCalledTimes(2);
                expect(mockApplyInventoryMovement).toHaveBeenCalledWith(
                    db,
                    expect.objectContaining({
                        tenantId,
                        productId: 'prod-1',
                        warehouseId: 'warehouse-1',
                        quantityDelta: 3,
                        movementType: 'PURCHASE_RECEIPT',
                        referenceType: 'PURCHASE_ORDER',
                        referenceId: poId,
                        unitCost: 100,
                    }),
                );
                expect(mockAutoPostFromRules).toHaveBeenCalledWith(
                    expect.objectContaining({
                        tenantId,
                        eventType: 'purchase',
                        sourceId: poId,
                        amount: Number(po.total_amount),
                    }),
                );
                expect(db.purchaseOrder.update).toHaveBeenCalledWith(
                    expect.objectContaining({
                        data: expect.objectContaining({
                            status: 'RECEIVED',
                            received_at: expect.any(Date),
                        }),
                    }),
                );
            });

            it('handles PO with a single item', async () => {
                const po = { ...basePO, status: 'DRAFT' };
                db.purchaseOrder.findFirst.mockResolvedValue(po);
                db.purchaseOrder.update.mockResolvedValue({ ...po, status: 'RECEIVED' });

                await service.updateStatus(tenantId, poId, receivedDto);

                expect(mockApplyInventoryMovement).toHaveBeenCalledTimes(1);
            });
        });
    });

    // ─── getInvoiceData ───────────────────────────────────────────────────────

    describe('getInvoiceData', () => {
        const tenantData = {
            name: 'My Business',
            brand_primary_color: '#fff',
            brand_logo_url: null,
            brand_business_name: 'My Business Ltd',
            vat_registration_no: 'VAT123',
            business_tin: 'TIN456',
        };

        it('returns purchase order and tenant data together', async () => {
            db.purchaseOrder.findFirst.mockResolvedValue(basePO);
            db.tenant.findUnique.mockResolvedValue(tenantData);

            const result = await service.getInvoiceData(tenantId, poId);

            expect(db.purchaseOrder.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: poId, tenant_id: tenantId },
                }),
            );
            expect(db.tenant.findUnique).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: tenantId },
                }),
            );
            expect(result).toEqual({ purchaseOrder: basePO, tenant: tenantData });
        });

        it('throws NotFoundException when PO does not exist', async () => {
            db.purchaseOrder.findFirst.mockResolvedValue(null);
            db.tenant.findUnique.mockResolvedValue(tenantData);

            await expect(service.getInvoiceData(tenantId, 'bad-id')).rejects.toThrow(
                new NotFoundException('Purchase order not found'),
            );
        });

        it('calls both queries in parallel via Promise.all', async () => {
            const callOrder: string[] = [];
            db.purchaseOrder.findFirst.mockImplementation(async () => {
                callOrder.push('purchaseOrder');
                return basePO;
            });
            db.tenant.findUnique.mockImplementation(async () => {
                callOrder.push('tenant');
                return tenantData;
            });

            await service.getInvoiceData(tenantId, poId);

            // Both must have been called
            expect(callOrder).toContain('purchaseOrder');
            expect(callOrder).toContain('tenant');
        });

        it('returns null tenant gracefully', async () => {
            db.purchaseOrder.findFirst.mockResolvedValue(basePO);
            db.tenant.findUnique.mockResolvedValue(null);

            const result = await service.getInvoiceData(tenantId, poId);

            expect(result.tenant).toBeNull();
        });
    });
});
