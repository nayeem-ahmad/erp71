import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PurchaseQuotationsService } from './purchase-quotations.service';
import { DatabaseService } from '../database/database.service';
import { CreatePurchaseQuotationDto, UpdatePurchaseQuotationStatusDto } from './purchase-quotation.dto';

describe('PurchaseQuotationsService', () => {
    let service: PurchaseQuotationsService;
    let db: any;

    const tenantId = 'tenant-1';
    const rfqId = 'rfq-id-1';
    const storeId = 'store-1';
    const supplierId = 'supplier-1';
    const productId = 'product-1';

    const baseCreateDto: CreatePurchaseQuotationDto = {
        storeId,
        items: [{ productId, quantity: 4, unitCost: 50 }],
    };

    const baseRFQ = {
        id: rfqId,
        tenant_id: tenantId,
        store_id: storeId,
        rfq_number: 'RFQ-00001',
        status: 'DRAFT',
        total_amount: 200,
        supplier_id: null,
        notes: null,
        items: [
            { product_id: productId, quantity: 4, unit_cost: 50, line_total: 200 },
        ],
    };

    beforeEach(async () => {
        db = {
            store: {
                findFirst: jest.fn(),
            },
            supplier: {
                findFirst: jest.fn(),
            },
            purchaseQuotation: {
                findFirst: jest.fn(),
                findMany: jest.fn(),
                create: jest.fn(),
                update: jest.fn(),
                delete: jest.fn(),
                count: jest.fn(),
            },
            purchaseQuotationItem: {
                deleteMany: jest.fn(),
            },
            purchaseOrder: {
                create: jest.fn(),
                count: jest.fn(),
            },
            $transaction: jest.fn().mockImplementation(async (cb: any) => cb(db)),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PurchaseQuotationsService,
                { provide: DatabaseService, useValue: db },
            ],
        }).compile();

        service = module.get<PurchaseQuotationsService>(PurchaseQuotationsService);
        jest.clearAllMocks();
    });

    // ─── create ───────────────────────────────────────────────────────────────

    describe('create', () => {
        it('creates a quotation with minimal fields', async () => {
            db.store.findFirst.mockResolvedValue({ id: storeId, name: 'Main Store' });
            db.purchaseQuotation.count.mockResolvedValue(0);
            db.purchaseQuotation.create.mockResolvedValue({ ...baseRFQ });

            const result = await service.create(tenantId, baseCreateDto);

            expect(db.store.findFirst).toHaveBeenCalledWith({
                where: { id: storeId, tenant_id: tenantId },
            });
            expect(db.purchaseQuotation.count).toHaveBeenCalledWith({ where: { tenant_id: tenantId } });
            expect(db.purchaseQuotation.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        tenant_id: tenantId,
                        store_id: storeId,
                        rfq_number: 'RFQ-00001',
                        total_amount: 200,
                        supplier_id: null,
                    }),
                }),
            );
            expect(result).toEqual(baseRFQ);
        });

        it('generates sequential RFQ numbers', async () => {
            db.store.findFirst.mockResolvedValue({ id: storeId });
            db.purchaseQuotation.count.mockResolvedValue(9);
            db.purchaseQuotation.create.mockResolvedValue({ rfq_number: 'RFQ-00010' });

            await service.create(tenantId, baseCreateDto);

            expect(db.purchaseQuotation.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ rfq_number: 'RFQ-00010' }),
                }),
            );
        });

        it('calculates total from items', async () => {
            db.store.findFirst.mockResolvedValue({ id: storeId });
            db.purchaseQuotation.count.mockResolvedValue(0);
            db.purchaseQuotation.create.mockResolvedValue({});

            const dto: CreatePurchaseQuotationDto = {
                storeId,
                items: [
                    { productId: 'prod-1', quantity: 2, unitCost: 100 },
                    { productId: 'prod-2', quantity: 3, unitCost: 50 },
                ],
            };
            await service.create(tenantId, dto);

            expect(db.purchaseQuotation.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ total_amount: 350 }),
                }),
            );
        });

        it('creates items with correct line totals', async () => {
            db.store.findFirst.mockResolvedValue({ id: storeId });
            db.purchaseQuotation.count.mockResolvedValue(0);
            db.purchaseQuotation.create.mockResolvedValue({});

            const dto: CreatePurchaseQuotationDto = {
                storeId,
                items: [
                    { productId: 'prod-1', quantity: 5, unitCost: 40 },
                    { productId: 'prod-2', quantity: 1, unitCost: 200 },
                ],
            };
            await service.create(tenantId, dto);

            expect(db.purchaseQuotation.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        items: {
                            create: [
                                { product_id: 'prod-1', quantity: 5, unit_cost: 40, line_total: 200 },
                                { product_id: 'prod-2', quantity: 1, unit_cost: 200, line_total: 200 },
                            ],
                        },
                    }),
                }),
            );
        });

        it('validates supplier when supplierId is provided', async () => {
            db.store.findFirst.mockResolvedValue({ id: storeId });
            db.supplier.findFirst.mockResolvedValue({ id: supplierId });
            db.purchaseQuotation.count.mockResolvedValue(0);
            db.purchaseQuotation.create.mockResolvedValue({});

            await service.create(tenantId, { ...baseCreateDto, supplierId });

            expect(db.supplier.findFirst).toHaveBeenCalledWith({
                where: { id: supplierId, tenant_id: tenantId, deleted_at: null },
            });
        });

        it('skips supplier check when supplierId is not provided', async () => {
            db.store.findFirst.mockResolvedValue({ id: storeId });
            db.purchaseQuotation.count.mockResolvedValue(0);
            db.purchaseQuotation.create.mockResolvedValue({});

            await service.create(tenantId, baseCreateDto);

            expect(db.supplier.findFirst).not.toHaveBeenCalled();
        });

        it('sets supplier_id to null when not provided', async () => {
            db.store.findFirst.mockResolvedValue({ id: storeId });
            db.purchaseQuotation.count.mockResolvedValue(0);
            db.purchaseQuotation.create.mockResolvedValue({});

            await service.create(tenantId, baseCreateDto);

            expect(db.purchaseQuotation.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ supplier_id: null }),
                }),
            );
        });

        it('converts validUntil string to Date when provided', async () => {
            db.store.findFirst.mockResolvedValue({ id: storeId });
            db.purchaseQuotation.count.mockResolvedValue(0);
            db.purchaseQuotation.create.mockResolvedValue({});

            await service.create(tenantId, { ...baseCreateDto, validUntil: '2027-01-01' });

            expect(db.purchaseQuotation.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        valid_until: new Date('2027-01-01'),
                    }),
                }),
            );
        });

        it('sets valid_until to null when not provided', async () => {
            db.store.findFirst.mockResolvedValue({ id: storeId });
            db.purchaseQuotation.count.mockResolvedValue(0);
            db.purchaseQuotation.create.mockResolvedValue({});

            await service.create(tenantId, baseCreateDto);

            expect(db.purchaseQuotation.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ valid_until: null }),
                }),
            );
        });

        it('includes notes when provided', async () => {
            db.store.findFirst.mockResolvedValue({ id: storeId });
            db.purchaseQuotation.count.mockResolvedValue(0);
            db.purchaseQuotation.create.mockResolvedValue({});

            await service.create(tenantId, { ...baseCreateDto, notes: 'Please send ASAP' });

            expect(db.purchaseQuotation.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ notes: 'Please send ASAP' }),
                }),
            );
        });

        it('throws NotFoundException when store is not found', async () => {
            db.store.findFirst.mockResolvedValue(null);

            await expect(service.create(tenantId, baseCreateDto)).rejects.toThrow(
                new NotFoundException('Store not found'),
            );
            expect(db.purchaseQuotation.create).not.toHaveBeenCalled();
        });

        it('throws BadRequestException when supplier is not found', async () => {
            db.store.findFirst.mockResolvedValue({ id: storeId });
            db.supplier.findFirst.mockResolvedValue(null);

            await expect(service.create(tenantId, { ...baseCreateDto, supplierId })).rejects.toThrow(
                new BadRequestException('Supplier not found.'),
            );
            expect(db.purchaseQuotation.create).not.toHaveBeenCalled();
        });
    });

    // ─── findAll ──────────────────────────────────────────────────────────────

    describe('findAll', () => {
        it('returns all quotations for the tenant ordered by created_at desc', async () => {
            const quotations = [baseRFQ, { ...baseRFQ, id: 'rfq-2', rfq_number: 'RFQ-00002' }];
            db.purchaseQuotation.findMany.mockResolvedValue(quotations);

            const result = await service.findAll(tenantId);

            expect(db.purchaseQuotation.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { tenant_id: tenantId },
                    orderBy: { created_at: 'desc' },
                }),
            );
            expect(result).toEqual(quotations);
        });

        it('returns empty array when no quotations exist', async () => {
            db.purchaseQuotation.findMany.mockResolvedValue([]);

            const result = await service.findAll(tenantId);

            expect(result).toEqual([]);
        });
    });

    // ─── findOne ──────────────────────────────────────────────────────────────

    describe('findOne', () => {
        it('returns a quotation by id', async () => {
            db.purchaseQuotation.findFirst.mockResolvedValue(baseRFQ);

            const result = await service.findOne(tenantId, rfqId);

            expect(db.purchaseQuotation.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: rfqId, tenant_id: tenantId },
                }),
            );
            expect(result).toEqual(baseRFQ);
        });

        it('throws NotFoundException when quotation does not exist', async () => {
            db.purchaseQuotation.findFirst.mockResolvedValue(null);

            await expect(service.findOne(tenantId, 'nonexistent')).rejects.toThrow(
                new NotFoundException('Purchase quotation not found'),
            );
        });
    });

    // ─── updateStatus ─────────────────────────────────────────────────────────

    describe('updateStatus', () => {
        const sentDto: UpdatePurchaseQuotationStatusDto = { status: 'SENT' };
        const cancelDto: UpdatePurchaseQuotationStatusDto = { status: 'CANCELLED' };
        const acceptedDto: UpdatePurchaseQuotationStatusDto = { status: 'ACCEPTED' };

        it('updates status from DRAFT to SENT', async () => {
            db.purchaseQuotation.findFirst.mockResolvedValue({ ...baseRFQ, status: 'DRAFT' });
            db.purchaseQuotation.update.mockResolvedValue({ ...baseRFQ, status: 'SENT' });

            const result = await service.updateStatus(tenantId, rfqId, sentDto);

            expect(db.purchaseQuotation.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: rfqId },
                    data: { status: 'SENT' },
                }),
            );
            expect(result.status).toBe('SENT');
        });

        it('updates status from SENT to ACCEPTED', async () => {
            db.purchaseQuotation.findFirst.mockResolvedValue({ ...baseRFQ, status: 'SENT' });
            db.purchaseQuotation.update.mockResolvedValue({ ...baseRFQ, status: 'ACCEPTED' });

            await service.updateStatus(tenantId, rfqId, acceptedDto);

            expect(db.purchaseQuotation.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: { status: 'ACCEPTED' } }),
            );
        });

        it('updates status to CANCELLED', async () => {
            db.purchaseQuotation.findFirst.mockResolvedValue({ ...baseRFQ, status: 'DRAFT' });
            db.purchaseQuotation.update.mockResolvedValue({ ...baseRFQ, status: 'CANCELLED' });

            await service.updateStatus(tenantId, rfqId, cancelDto);

            expect(db.purchaseQuotation.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: { status: 'CANCELLED' } }),
            );
        });

        it('throws NotFoundException when quotation does not exist', async () => {
            db.purchaseQuotation.findFirst.mockResolvedValue(null);

            await expect(service.updateStatus(tenantId, rfqId, sentDto)).rejects.toThrow(
                new NotFoundException('Purchase quotation not found'),
            );
            expect(db.purchaseQuotation.update).not.toHaveBeenCalled();
        });

        it('throws BadRequestException when quotation is already CONVERTED', async () => {
            db.purchaseQuotation.findFirst.mockResolvedValue({ ...baseRFQ, status: 'CONVERTED' });

            await expect(service.updateStatus(tenantId, rfqId, sentDto)).rejects.toThrow(
                new BadRequestException('Already converted to a purchase order.'),
            );
            expect(db.purchaseQuotation.update).not.toHaveBeenCalled();
        });

        it('throws BadRequestException when quotation is CANCELLED', async () => {
            db.purchaseQuotation.findFirst.mockResolvedValue({ ...baseRFQ, status: 'CANCELLED' });

            await expect(service.updateStatus(tenantId, rfqId, acceptedDto)).rejects.toThrow(
                new BadRequestException('Cancelled quotations cannot be updated.'),
            );
            expect(db.purchaseQuotation.update).not.toHaveBeenCalled();
        });
    });

    // ─── convertToPurchaseOrder ───────────────────────────────────────────────

    describe('convertToPurchaseOrder', () => {
        const rfqWithItems = {
            ...baseRFQ,
            status: 'ACCEPTED',
            supplier_id: supplierId,
            notes: 'Urgent',
            items: [
                { product_id: productId, quantity: 4, unit_cost: 50, line_total: 200 },
            ],
        };

        it('converts a quotation to a purchase order within a transaction', async () => {
            db.purchaseQuotation.findFirst.mockResolvedValue(rfqWithItems);
            db.purchaseOrder.count.mockResolvedValue(0);
            const createdPO = {
                id: 'po-1',
                po_number: 'PO-00001',
                supplier_id: supplierId,
                total_amount: 200,
            };
            db.purchaseOrder.create.mockResolvedValue(createdPO);
            db.purchaseQuotation.update.mockResolvedValue({ ...rfqWithItems, status: 'CONVERTED' });

            const result = await service.convertToPurchaseOrder(tenantId, rfqId);

            expect(db.$transaction).toHaveBeenCalled();
            expect(db.purchaseOrder.count).toHaveBeenCalledWith({ where: { tenant_id: tenantId } });
            expect(db.purchaseOrder.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        tenant_id: tenantId,
                        store_id: rfqWithItems.store_id,
                        supplier_id: rfqWithItems.supplier_id,
                        po_number: 'PO-00001',
                        subtotal_amount: rfqWithItems.total_amount,
                        total_amount: rfqWithItems.total_amount,
                        notes: rfqWithItems.notes,
                        items: {
                            create: [
                                {
                                    product_id: productId,
                                    quantity: 4,
                                    unit_cost: 50,
                                    line_total: 200,
                                },
                            ],
                        },
                    }),
                }),
            );
            expect(db.purchaseQuotation.update).toHaveBeenCalledWith({
                where: { id: rfqId },
                data: { status: 'CONVERTED' },
            });
            expect(result).toEqual(createdPO);
        });

        it('generates correct sequential PO number during conversion', async () => {
            db.purchaseQuotation.findFirst.mockResolvedValue(rfqWithItems);
            db.purchaseOrder.count.mockResolvedValue(5);
            db.purchaseOrder.create.mockResolvedValue({ po_number: 'PO-00006' });
            db.purchaseQuotation.update.mockResolvedValue({});

            await service.convertToPurchaseOrder(tenantId, rfqId);

            expect(db.purchaseOrder.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ po_number: 'PO-00006' }),
                }),
            );
        });

        it('maps multiple items correctly to PO items', async () => {
            const multiItemRfq = {
                ...rfqWithItems,
                items: [
                    { product_id: 'prod-1', quantity: 2, unit_cost: 100, line_total: 200 },
                    { product_id: 'prod-2', quantity: 5, unit_cost: 30, line_total: 150 },
                ],
            };
            db.purchaseQuotation.findFirst.mockResolvedValue(multiItemRfq);
            db.purchaseOrder.count.mockResolvedValue(0);
            db.purchaseOrder.create.mockResolvedValue({});
            db.purchaseQuotation.update.mockResolvedValue({});

            await service.convertToPurchaseOrder(tenantId, rfqId);

            expect(db.purchaseOrder.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        items: {
                            create: [
                                { product_id: 'prod-1', quantity: 2, unit_cost: 100, line_total: 200 },
                                { product_id: 'prod-2', quantity: 5, unit_cost: 30, line_total: 150 },
                            ],
                        },
                    }),
                }),
            );
        });

        it('throws NotFoundException when quotation does not exist', async () => {
            db.purchaseQuotation.findFirst.mockResolvedValue(null);

            await expect(service.convertToPurchaseOrder(tenantId, rfqId)).rejects.toThrow(
                new NotFoundException('Purchase quotation not found'),
            );
            expect(db.$transaction).not.toHaveBeenCalled();
        });

        it('throws BadRequestException when quotation is already CONVERTED', async () => {
            db.purchaseQuotation.findFirst.mockResolvedValue({ ...rfqWithItems, status: 'CONVERTED' });

            await expect(service.convertToPurchaseOrder(tenantId, rfqId)).rejects.toThrow(
                new BadRequestException('Already converted to a purchase order.'),
            );
            expect(db.$transaction).not.toHaveBeenCalled();
        });

        it('throws BadRequestException when quotation is CANCELLED', async () => {
            db.purchaseQuotation.findFirst.mockResolvedValue({ ...rfqWithItems, status: 'CANCELLED' });

            await expect(service.convertToPurchaseOrder(tenantId, rfqId)).rejects.toThrow(
                new BadRequestException('Cancelled quotations cannot be converted.'),
            );
            expect(db.$transaction).not.toHaveBeenCalled();
        });
    });

    // ─── remove ───────────────────────────────────────────────────────────────

    describe('remove', () => {
        it('deletes items then the quotation and returns { deleted: true }', async () => {
            db.purchaseQuotation.findFirst.mockResolvedValue({ ...baseRFQ, status: 'DRAFT' });
            db.purchaseQuotationItem.deleteMany.mockResolvedValue({ count: 1 });
            db.purchaseQuotation.delete.mockResolvedValue(baseRFQ);

            const result = await service.remove(tenantId, rfqId);

            expect(db.purchaseQuotationItem.deleteMany).toHaveBeenCalledWith({
                where: { rfq_id: rfqId },
            });
            expect(db.purchaseQuotation.delete).toHaveBeenCalledWith({
                where: { id: rfqId },
            });
            expect(result).toEqual({ deleted: true });
        });

        it('deletes items before the quotation (order matters)', async () => {
            const callOrder: string[] = [];
            db.purchaseQuotation.findFirst.mockResolvedValue({ ...baseRFQ, status: 'DRAFT' });
            db.purchaseQuotationItem.deleteMany.mockImplementation(async () => {
                callOrder.push('items');
                return { count: 1 };
            });
            db.purchaseQuotation.delete.mockImplementation(async () => {
                callOrder.push('quotation');
                return baseRFQ;
            });

            await service.remove(tenantId, rfqId);

            expect(callOrder).toEqual(['items', 'quotation']);
        });

        it('throws NotFoundException when quotation does not exist', async () => {
            db.purchaseQuotation.findFirst.mockResolvedValue(null);

            await expect(service.remove(tenantId, rfqId)).rejects.toThrow(
                new NotFoundException('Purchase quotation not found'),
            );
            expect(db.purchaseQuotationItem.deleteMany).not.toHaveBeenCalled();
            expect(db.purchaseQuotation.delete).not.toHaveBeenCalled();
        });

        it('throws BadRequestException when trying to delete a CONVERTED quotation', async () => {
            db.purchaseQuotation.findFirst.mockResolvedValue({ ...baseRFQ, status: 'CONVERTED' });

            await expect(service.remove(tenantId, rfqId)).rejects.toThrow(
                new BadRequestException('Cannot delete a converted quotation.'),
            );
            expect(db.purchaseQuotationItem.deleteMany).not.toHaveBeenCalled();
            expect(db.purchaseQuotation.delete).not.toHaveBeenCalled();
        });

        it('allows deletion of a CANCELLED quotation', async () => {
            db.purchaseQuotation.findFirst.mockResolvedValue({ ...baseRFQ, status: 'CANCELLED' });
            db.purchaseQuotationItem.deleteMany.mockResolvedValue({ count: 0 });
            db.purchaseQuotation.delete.mockResolvedValue(baseRFQ);

            const result = await service.remove(tenantId, rfqId);

            expect(result).toEqual({ deleted: true });
        });

        it('allows deletion of a SENT quotation', async () => {
            db.purchaseQuotation.findFirst.mockResolvedValue({ ...baseRFQ, status: 'SENT' });
            db.purchaseQuotationItem.deleteMany.mockResolvedValue({ count: 0 });
            db.purchaseQuotation.delete.mockResolvedValue(baseRFQ);

            const result = await service.remove(tenantId, rfqId);

            expect(result).toEqual({ deleted: true });
        });
    });
});
