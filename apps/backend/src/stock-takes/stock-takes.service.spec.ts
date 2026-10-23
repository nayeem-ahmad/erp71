import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { StockTakesService } from './stock-takes.service';
import { applyInventoryMovement, assertWarehouseBelongsToTenant } from '../database/inventory.utils';
import { autoPostFromRules } from '../accounting/posting.utils';
import { issueDocumentNumber } from '../database/document-number.utils';

jest.mock('../database/document-number.utils', () => ({
    ...jest.requireActual('../database/document-number.utils'),
    issueDocumentNumber: jest.fn(async () => 'STK-00001'),
}));

jest.mock('../database/inventory.utils', () => ({
    applyInventoryMovement: jest.fn(),
    assertWarehouseBelongsToTenant: jest.fn(),
}));

jest.mock('../accounting/posting.utils', () => ({
    autoPostFromRules: jest.fn(),
}));

describe('StockTakesService', () => {
    let service: StockTakesService;
    let db: any;
    let tx: any;

    beforeEach(async () => {
        jest.clearAllMocks();
        tx = {
            productStock: { findMany: jest.fn() },
            stockTakeSession: {
                count: jest.fn(),
                create: jest.fn(),
                findFirst: jest.fn(),
                update: jest.fn(),
            },
            stockTakeCountLine: { update: jest.fn() },
            inventoryReason: { findFirst: jest.fn() },
            inventorySettings: { findUnique: jest.fn() },
        };

        db = {
            $transaction: jest.fn().mockImplementation((callback) => callback(tx)),
            stockTakeSession: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
            inventorySettings: { findUnique: jest.fn() },
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [StockTakesService, { provide: DatabaseService, useValue: db }],
        }).compile();

        service = module.get(StockTakesService);
        (assertWarehouseBelongsToTenant as jest.Mock).mockResolvedValue({ id: 'wh-1', store_id: 'store-1' });
        (applyInventoryMovement as jest.Mock).mockResolvedValue(0);
        (autoPostFromRules as jest.Mock).mockResolvedValue({
            postingStatus: 'posted',
            voucherId: 'voucher-1',
            voucherNumber: 'JV-00001',
            voucherType: 'journal',
        });
        tx.inventorySettings.findUnique.mockResolvedValue({ discrepancy_approval_threshold: 2 });
        db.inventorySettings.findUnique.mockResolvedValue({ discrepancy_approval_threshold: 2 });
    });

    it('creates a stock-take session with expected quantity snapshot lines', async () => {
        tx.productStock.findMany.mockResolvedValue([{ product_id: 'prod-1', quantity: 7, product: { name: 'Coffee' } }]);
        tx.stockTakeSession.count.mockResolvedValue(0);
        tx.stockTakeSession.create.mockResolvedValue({ id: 'session-1', lines: [{ expected_quantity: 7, counted_quantity: null, variance_quantity: null }], warehouse: {} });

        const result = await service.create('tenant-1', { warehouseId: 'wh-1', startImmediately: true });

        expect(tx.stockTakeSession.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ session_number: 'STK-00001', status: 'COUNTING' }),
            include: expect.any(Object),
        });
        expect(issueDocumentNumber).toHaveBeenCalledWith(tx, expect.objectContaining({
            tenantId: 'tenant-1',
            docType: 'STOCK_TAKE',
            storeId: 'store-1',
        }));
        expect(result.summary.totalExpectedQuantity).toBe(7);
    });

    it('updates counts and promotes a draft session to counting', async () => {
        const session = {
            id: 'session-1',
            status: 'DRAFT',
            lines: [{ id: 'line-1', product_id: 'prod-1', expected_quantity: 5, counted_quantity: null, variance_quantity: null }],
            warehouse: {},
        };
        tx.stockTakeSession.findFirst
            .mockResolvedValueOnce(session)
            .mockResolvedValueOnce({ ...session, status: 'COUNTING', lines: [{ ...session.lines[0], counted_quantity: 3, variance_quantity: -2 }] });

        const result = await service.updateCounts('tenant-1', 'session-1', {
            lines: [{ productId: 'prod-1', countedQuantity: 3 }],
        });

        expect(tx.stockTakeCountLine.update).toHaveBeenCalledWith({
            where: { id: 'line-1' },
            data: expect.objectContaining({ counted_quantity: 3, variance_quantity: -2 }),
        });
        expect(tx.stockTakeSession.update).toHaveBeenCalledWith({ where: { id: 'session-1' }, data: { status: 'COUNTING' } });
        expect(result.summary.discrepantLines).toBe(1);
    });

    it('posts only non-zero variances as inventory adjustments', async () => {
        const session = {
            id: 'session-1',
            status: 'REVIEW',
            warehouse_id: 'wh-1',
            lines: [
                { product_id: 'prod-1', expected_quantity: 5, counted_quantity: 3, note: 'damage', variance_quantity: -2 },
                { product_id: 'prod-2', expected_quantity: 2, counted_quantity: 2, note: null, variance_quantity: 0 },
            ],
            warehouse: {},
        };
        tx.stockTakeSession.findFirst
            .mockResolvedValueOnce(session)
            .mockResolvedValueOnce({ ...session, status: 'POSTED' });

        await service.post('tenant-1', 'session-1');

        expect(applyInventoryMovement).toHaveBeenCalledTimes(1);
        expect(applyInventoryMovement).toHaveBeenCalledWith(
            tx,
            expect.objectContaining({ productId: 'prod-1', quantityDelta: -2, movementType: 'STOCK_TAKE_ADJUSTMENT' }),
        );
    });

    it('rejects posting cancelled sessions', async () => {
        tx.stockTakeSession.findFirst.mockResolvedValue({ id: 'session-1', status: 'CANCELLED', lines: [], warehouse: {} });
        await expect(service.post('tenant-1', 'session-1')).rejects.toThrow(BadRequestException);
    });

    it('requires review before posting when variance exceeds the configured threshold', async () => {
        tx.stockTakeSession.findFirst.mockResolvedValue({
            id: 'session-1',
            status: 'COUNTING',
            warehouse_id: 'wh-1',
            lines: [
                { product_id: 'prod-1', expected_quantity: 10, counted_quantity: 6, note: null, variance_quantity: -4 },
            ],
            warehouse: {},
        });

        await expect(service.post('tenant-1', 'session-1')).rejects.toThrow(BadRequestException);
        expect(applyInventoryMovement).not.toHaveBeenCalled();
    });
});