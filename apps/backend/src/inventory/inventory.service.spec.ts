import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { DatabaseService } from '../database/database.service';

// The service delegates assertWarehouseBelongsToTenant and ensureDefaultWarehouse to
// inventory.utils — we mock those at the module level so we never need real DB calls
// for those helpers.
jest.mock('../database/inventory.utils', () => ({
    assertWarehouseBelongsToTenant: jest.fn(),
    ensureDefaultWarehouse: jest.fn(),
}));

import {
    assertWarehouseBelongsToTenant,
    ensureDefaultWarehouse,
} from '../database/inventory.utils';

const mockAssertWarehouse = assertWarehouseBelongsToTenant as jest.MockedFunction<
    typeof assertWarehouseBelongsToTenant
>;
const mockEnsureDefaultWarehouse = ensureDefaultWarehouse as jest.MockedFunction<
    typeof ensureDefaultWarehouse
>;

describe('InventoryService', () => {
    let service: InventoryService;
    let db: any;

    beforeEach(async () => {
        jest.clearAllMocks();

        db = {
            warehouse: {
                findUnique: jest.fn(),
                findFirst: jest.fn(),
                findMany: jest.fn(),
                create: jest.fn(),
                update: jest.fn(),
                updateMany: jest.fn(),
                delete: jest.fn(),
                count: jest.fn(),
            },
            store: {
                findFirst: jest.fn(),
                findMany: jest.fn(),
            },
            inventorySettings: {
                findUnique: jest.fn(),
                create: jest.fn(),
                update: jest.fn(),
            },
            storeInventoryDefaults: {
                findMany: jest.fn().mockResolvedValue([]),
                upsert: jest.fn(),
            },
            inventoryReason: {
                findUnique: jest.fn(),
                findFirst: jest.fn(),
                findMany: jest.fn(),
                create: jest.fn(),
                update: jest.fn(),
            },
            inventoryMovement: {
                findMany: jest.fn(),
                count: jest.fn().mockResolvedValue(0),
            },
            $transaction: jest.fn().mockImplementation(async (cb: any) => cb(db)),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                InventoryService,
                { provide: DatabaseService, useValue: db },
            ],
        }).compile();

        service = module.get<InventoryService>(InventoryService);
    });

    // ─── getWarehouses ────────────────────────────────────────────────────────

    describe('getWarehouses', () => {
        const tenantId = 'tenant-1';

        it('should return warehouses ordered by default then name', async () => {
            const warehouses = [
                { id: 'wh-1', name: 'Main', is_default: true },
                { id: 'wh-2', name: 'Secondary', is_default: false },
            ];
            db.warehouse.findMany.mockResolvedValue(warehouses);

            const result = await service.getWarehouses(tenantId);

            expect(db.warehouse.findMany).toHaveBeenCalledWith({
                where: { tenant_id: tenantId },
                orderBy: [{ is_default: 'desc' }, { name: 'asc' }],
            });
            expect(result).toEqual(warehouses);
        });

        it('should return empty array when no warehouses exist', async () => {
            db.warehouse.findMany.mockResolvedValue([]);

            const result = await service.getWarehouses(tenantId);

            expect(result).toEqual([]);
        });
    });

    // ─── createWarehouse ──────────────────────────────────────────────────────

    describe('createWarehouse', () => {
        const tenantId = 'tenant-1';
        const store = { id: 'store-1', tenant_id: tenantId, name: 'Main Store' };

        it('should create a warehouse with provided code', async () => {
            const dto = { name: 'North Warehouse', storeId: 'store-1', code: 'NORTH', isDefault: false };
            db.store.findFirst.mockResolvedValue(store);
            db.warehouse.findFirst.mockResolvedValue(null); // no duplicate
            const created = { id: 'wh-1', ...dto, tenant_id: tenantId };
            db.warehouse.create.mockResolvedValue(created);

            const result = await service.createWarehouse(tenantId, dto);

            expect(db.store.findFirst).toHaveBeenCalledWith({
                where: { id: dto.storeId, tenant_id: tenantId },
            });
            expect(db.warehouse.findFirst).toHaveBeenCalledWith({
                where: { tenant_id: tenantId, code: 'NORTH' },
            });
            expect(db.warehouse.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        tenant_id: tenantId,
                        store_id: dto.storeId,
                        name: dto.name,
                        code: 'NORTH',
                        is_default: false,
                        is_active: true,
                    }),
                }),
            );
            expect(result).toEqual(created);
        });

        it('should generate a code from name when code is not provided', async () => {
            const dto = { name: 'East Warehouse', storeId: 'store-1', isDefault: false };
            db.store.findFirst.mockResolvedValue(store);
            db.warehouse.findFirst.mockResolvedValue(null);
            db.warehouse.count.mockResolvedValue(0); // no existing with prefix
            db.warehouse.create.mockResolvedValue({ id: 'wh-2' });

            await service.createWarehouse(tenantId, dto as any);

            // Generated code should be based on the name uppercased with non-alphanum replaced
            expect(db.warehouse.count).toHaveBeenCalled();
            // "EAST WAREHOUSE" -> "EAST-WAREHOUSE" -> uppercase -> slice(0,10) -> "EAST-WAREH"
            expect(db.warehouse.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ code: 'EAST-WAREH' }),
                }),
            );
        });

        it('should append count suffix when generated code prefix conflicts', async () => {
            const dto = { name: 'East', storeId: 'store-1', isDefault: false };
            db.store.findFirst.mockResolvedValue(store);
            db.warehouse.findFirst.mockResolvedValue(null);
            db.warehouse.count.mockResolvedValue(2); // 2 already exist with prefix
            db.warehouse.create.mockResolvedValue({ id: 'wh-3' });

            await service.createWarehouse(tenantId, dto as any);

            expect(db.warehouse.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ code: 'EAST-3' }),
                }),
            );
        });

        it('should set other warehouses to non-default when isDefault is true', async () => {
            const dto = { name: 'New Default', storeId: 'store-1', code: 'NEWDEFAULT', isDefault: true };
            db.store.findFirst.mockResolvedValue(store);
            db.warehouse.findFirst.mockResolvedValue(null);
            db.warehouse.updateMany = jest.fn().mockResolvedValue({ count: 1 });
            db.warehouse.create.mockResolvedValue({ id: 'wh-4', is_default: true });

            await service.createWarehouse(tenantId, dto);

            expect(db.warehouse.updateMany).toHaveBeenCalledWith({
                where: { tenant_id: tenantId, store_id: dto.storeId },
                data: { is_default: false },
            });
        });

        it('should NOT call updateMany when isDefault is false', async () => {
            const dto = { name: 'Side WH', storeId: 'store-1', code: 'SIDE', isDefault: false };
            db.store.findFirst.mockResolvedValue(store);
            db.warehouse.findFirst.mockResolvedValue(null);
            db.warehouse.updateMany = jest.fn();
            db.warehouse.create.mockResolvedValue({ id: 'wh-5' });

            await service.createWarehouse(tenantId, dto);

            expect(db.warehouse.updateMany).not.toHaveBeenCalled();
        });

        it('should throw BadRequestException when store not found', async () => {
            db.store.findFirst.mockResolvedValue(null);
            const dto = { name: 'WH', storeId: 'bad-store', code: 'WH', isDefault: false };

            const promise = service.createWarehouse(tenantId, dto);

            await expect(promise).rejects.toThrow(BadRequestException);
            await expect(promise).rejects.toThrow('Store not found for this tenant.');
            expect(db.warehouse.create).not.toHaveBeenCalled();
        });

        it('should throw BadRequestException when code already exists', async () => {
            const dto = { name: 'Dup WH', storeId: 'store-1', code: 'DUP', isDefault: false };
            db.store.findFirst.mockResolvedValue(store);
            db.warehouse.findFirst.mockResolvedValue({ id: 'existing-wh', code: 'DUP' });

            const promise = service.createWarehouse(tenantId, dto);

            await expect(promise).rejects.toThrow(BadRequestException);
            await expect(promise).rejects.toThrow('A warehouse with this code already exists.');
            expect(db.warehouse.create).not.toHaveBeenCalled();
        });
    });

    // ─── updateWarehouse ──────────────────────────────────────────────────────

    describe('updateWarehouse', () => {
        const tenantId = 'tenant-1';
        const warehouseId = 'wh-1';
        const existingWarehouse = {
            id: warehouseId,
            tenant_id: tenantId,
            store_id: 'store-1',
            code: 'OLD-CODE',
            is_active: true,
        };

        beforeEach(() => {
            mockAssertWarehouse.mockResolvedValue(existingWarehouse as any);
        });

        it('should update a warehouse without changing code', async () => {
            const dto = { name: 'Renamed WH' };
            const updated = { ...existingWarehouse, name: 'Renamed WH' };
            db.warehouse.update.mockResolvedValue(updated);

            const result = await service.updateWarehouse(tenantId, warehouseId, dto as any);

            expect(mockAssertWarehouse).toHaveBeenCalledWith(db, tenantId, warehouseId);
            expect(db.warehouse.findFirst).not.toHaveBeenCalled();
            expect(db.warehouse.update).toHaveBeenCalledWith(
                expect.objectContaining({ where: { id: warehouseId } }),
            );
            expect(result).toEqual(updated);
        });

        it('should update code when new code is unique', async () => {
            const dto = { code: 'NEW-CODE' };
            db.warehouse.findFirst.mockResolvedValue(null); // no duplicate
            const updated = { ...existingWarehouse, code: 'NEW-CODE' };
            db.warehouse.update.mockResolvedValue(updated);

            await service.updateWarehouse(tenantId, warehouseId, dto as any);

            expect(db.warehouse.findFirst).toHaveBeenCalledWith({
                where: { tenant_id: tenantId, code: 'NEW-CODE', NOT: { id: warehouseId } },
            });
        });

        it('should throw BadRequestException when new code already exists', async () => {
            const dto = { code: 'TAKEN-CODE' };
            db.warehouse.findFirst.mockResolvedValue({ id: 'other-wh', code: 'TAKEN-CODE' });

            const promise = service.updateWarehouse(tenantId, warehouseId, dto as any);

            await expect(promise).rejects.toThrow(BadRequestException);
            await expect(promise).rejects.toThrow('A warehouse with this code already exists.');
            expect(db.warehouse.update).not.toHaveBeenCalled();
        });

        it('should skip duplicate check when code is unchanged', async () => {
            const dto = { code: 'OLD-CODE', name: 'Updated Name' }; // same as existingWarehouse.code
            db.warehouse.update.mockResolvedValue({ ...existingWarehouse, ...dto });

            await service.updateWarehouse(tenantId, warehouseId, dto as any);

            expect(db.warehouse.findFirst).not.toHaveBeenCalled();
        });

        it('should unset other defaults when isDefault is true', async () => {
            const dto = { isDefault: true };
            db.warehouse.updateMany = jest.fn().mockResolvedValue({ count: 1 });
            db.warehouse.update.mockResolvedValue({ ...existingWarehouse, is_default: true });

            await service.updateWarehouse(tenantId, warehouseId, dto as any);

            expect(db.warehouse.updateMany).toHaveBeenCalledWith({
                where: { tenant_id: tenantId, store_id: existingWarehouse.store_id },
                data: { is_default: false },
            });
        });

        it('should throw when assertWarehouseBelongsToTenant throws', async () => {
            mockAssertWarehouse.mockRejectedValue(new BadRequestException('Warehouse not found for this tenant.'));

            const promise = service.updateWarehouse(tenantId, 'bad-wh', {} as any);

            await expect(promise).rejects.toThrow(BadRequestException);
        });
    });

    // ─── getSettings / ensureSettings ─────────────────────────────────────────

    describe('getSettings', () => {
        const tenantId = 'tenant-1';

        it('should return existing settings', async () => {
            const settings = { tenant_id: tenantId, default_product_warehouse_id: 'wh-1' };
            db.inventorySettings.findUnique.mockResolvedValue(settings);

            const result = await service.getSettings(tenantId);

            expect(db.inventorySettings.findUnique).toHaveBeenCalledWith(
                expect.objectContaining({ where: { tenant_id: tenantId } }),
            );
            expect(result).toEqual(settings);
        });

        it('should create settings when none exist', async () => {
            const defaultWarehouse = { id: 'wh-default', tenant_id: tenantId };
            db.inventorySettings.findUnique.mockResolvedValue(null);
            mockEnsureDefaultWarehouse.mockResolvedValue(defaultWarehouse as any);
            const createdSettings = { tenant_id: tenantId, default_product_warehouse_id: 'wh-default' };
            db.inventorySettings.create.mockResolvedValue(createdSettings);

            const result = await service.getSettings(tenantId);

            expect(mockEnsureDefaultWarehouse).toHaveBeenCalledWith(db, tenantId);
            expect(db.inventorySettings.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        tenant_id: tenantId,
                        default_product_warehouse_id: 'wh-default',
                    }),
                }),
            );
            expect(result).toEqual(createdSettings);
        });
    });

    // ─── updateSettings ───────────────────────────────────────────────────────

    describe('updateSettings', () => {
        const tenantId = 'tenant-1';
        const existingSettings = { tenant_id: tenantId };

        beforeEach(() => {
            db.inventorySettings.findUnique.mockResolvedValue(existingSettings);
        });

        it('should update settings when all warehouse IDs are valid', async () => {
            const dto = {
                defaultProductWarehouseId: 'wh-1',
                defaultPurchaseWarehouseId: 'wh-1',
                defaultSalesWarehouseId: 'wh-1',
                defaultShrinkageWarehouseId: 'wh-1',
                defaultTransferSourceWarehouseId: 'wh-1',
                defaultTransferDestinationWarehouseId: 'wh-1',
            };
            // All warehouse ownership checks pass
            db.warehouse.findFirst.mockResolvedValue({ id: 'wh-1', tenant_id: tenantId });
            const updated = { ...existingSettings, ...dto };
            db.inventorySettings.update.mockResolvedValue(updated);

            const result = await service.updateSettings(tenantId, dto as any);

            expect(db.inventorySettings.update).toHaveBeenCalledWith(
                expect.objectContaining({ where: { tenant_id: tenantId } }),
            );
            expect(result).toEqual(updated);
        });

        it('should throw BadRequestException when a warehouse does not belong to the tenant', async () => {
            const dto = { defaultProductWarehouseId: 'foreign-wh' };
            db.warehouse.findFirst.mockResolvedValue(null); // ownership check fails

            const promise = service.updateSettings(tenantId, dto as any);

            await expect(promise).rejects.toThrow(BadRequestException);
            await expect(promise).rejects.toThrow('Selected warehouse does not belong to this tenant.');
        });

        it('should skip warehouse check when id is undefined', async () => {
            const dto = { defaultReorderLevel: 10, defaultSafetyStock: 5 };
            db.inventorySettings.update.mockResolvedValue({ ...existingSettings, ...dto });

            await service.updateSettings(tenantId, dto as any);

            expect(db.warehouse.findFirst).not.toHaveBeenCalled();
            expect(db.inventorySettings.update).toHaveBeenCalled();
        });

        it('should update scalar settings fields', async () => {
            const dto = {
                defaultReorderLevel: 10,
                defaultSafetyStock: 5,
                defaultLeadTimeDays: 7,
                discrepancyApprovalThreshold: 100,
            };
            db.inventorySettings.update.mockResolvedValue({ ...existingSettings });

            await service.updateSettings(tenantId, dto as any);

            expect(db.inventorySettings.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        default_reorder_level: 10,
                        default_safety_stock: 5,
                        default_lead_time_days: 7,
                        discrepancy_approval_threshold: 100,
                    }),
                }),
            );
        });

        it('should set warehouse id to null when empty string is provided', async () => {
            const dto = { defaultProductWarehouseId: '' };
            db.inventorySettings.update.mockResolvedValue(existingSettings);

            // Empty string should skip the ownership check (assertWarehouseOwnership guards with if (!warehouseId))
            await service.updateSettings(tenantId, dto as any);

            expect(db.warehouse.findFirst).not.toHaveBeenCalled();
            expect(db.inventorySettings.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ default_product_warehouse_id: null }),
                }),
            );
        });
    });

    // ─── store warehouse defaults ─────────────────────────────────────────────

    describe('getStoreWarehouseDefaults', () => {
        const tenantId = 'tenant-1';

        it('merges per-store rows onto the store list, nulls where unconfigured', async () => {
            db.store.findMany.mockResolvedValue([
                { id: 'store-1', name: 'Main' },
                { id: 'store-2', name: 'Branch' },
            ]);
            db.storeInventoryDefaults.findMany.mockResolvedValue([
                { store_id: 'store-1', default_sales_warehouse_id: 'wh-a', default_purchase_warehouse_id: 'wh-b' },
            ]);

            const result = await service.getStoreWarehouseDefaults(tenantId);

            expect(result).toEqual([
                expect.objectContaining({
                    storeId: 'store-1',
                    storeName: 'Main',
                    defaultSalesWarehouseId: 'wh-a',
                    defaultPurchaseWarehouseId: 'wh-b',
                    defaultProductWarehouseId: null,
                }),
                expect.objectContaining({
                    storeId: 'store-2',
                    storeName: 'Branch',
                    defaultSalesWarehouseId: null,
                    defaultPurchaseWarehouseId: null,
                }),
            ]);
        });
    });

    describe('updateStoreWarehouseDefaults', () => {
        const tenantId = 'tenant-1';
        const storeId = 'store-1';

        beforeEach(() => {
            db.store.findFirst.mockResolvedValue({ id: storeId, tenant_id: tenantId });
            db.store.findMany.mockResolvedValue([{ id: storeId, name: 'Main' }]);
            db.storeInventoryDefaults.findMany.mockResolvedValue([]);
        });

        it('upserts the per-store row when the warehouse belongs to the store', async () => {
            db.warehouse.findFirst.mockResolvedValue({ id: 'wh-a', tenant_id: tenantId, store_id: storeId });

            await service.updateStoreWarehouseDefaults(tenantId, storeId, {
                defaultSalesWarehouseId: 'wh-a',
            } as any);

            expect(db.storeInventoryDefaults.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { tenant_id_store_id: { tenant_id: tenantId, store_id: storeId } },
                    create: expect.objectContaining({ default_sales_warehouse_id: 'wh-a' }),
                    update: expect.objectContaining({ default_sales_warehouse_id: 'wh-a' }),
                }),
            );
        });

        it('rejects a warehouse that belongs to a different store', async () => {
            db.warehouse.findFirst.mockResolvedValue(null);

            const promise = service.updateStoreWarehouseDefaults(tenantId, storeId, {
                defaultSalesWarehouseId: 'wh-other',
            } as any);

            await expect(promise).rejects.toThrow('Selected warehouse does not belong to this store.');
            expect(db.storeInventoryDefaults.upsert).not.toHaveBeenCalled();
        });

        it('clears an override when an empty string is provided', async () => {
            await service.updateStoreWarehouseDefaults(tenantId, storeId, {
                defaultSalesWarehouseId: '',
            } as any);

            expect(db.warehouse.findFirst).not.toHaveBeenCalled();
            expect(db.storeInventoryDefaults.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    update: expect.objectContaining({ default_sales_warehouse_id: null }),
                }),
            );
        });

        it('throws when the store does not belong to the tenant', async () => {
            db.store.findFirst.mockResolvedValue(null);

            await expect(
                service.updateStoreWarehouseDefaults(tenantId, 'ghost', {} as any),
            ).rejects.toThrow('Store not found for this tenant.');
        });
    });

    // ─── listReasons ─────────────────────────────────────────────────────────

    describe('listReasons', () => {
        const tenantId = 'tenant-1';

        it('should return all reasons for tenant without type filter', async () => {
            const reasons = [
                { id: 'r-1', type: 'SHRINKAGE', label: 'Damaged' },
                { id: 'r-2', type: 'ADJUSTMENT', label: 'Correction' },
            ];
            db.inventoryReason.findMany.mockResolvedValue(reasons);

            const result = await service.listReasons(tenantId, {} as any);

            expect(db.inventoryReason.findMany).toHaveBeenCalledWith({
                where: { tenant_id: tenantId },
                orderBy: [{ type: 'asc' }, { display_order: 'asc' }, { label: 'asc' }],
            });
            expect(result).toEqual(reasons);
        });

        it('should filter by type when provided', async () => {
            const reasons = [{ id: 'r-1', type: 'SHRINKAGE', label: 'Theft' }];
            db.inventoryReason.findMany.mockResolvedValue(reasons);

            await service.listReasons(tenantId, { type: 'SHRINKAGE' } as any);

            expect(db.inventoryReason.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ type: 'SHRINKAGE' }),
                }),
            );
        });

        it('should return empty array when no reasons exist', async () => {
            db.inventoryReason.findMany.mockResolvedValue([]);

            const result = await service.listReasons(tenantId, {} as any);

            expect(result).toEqual([]);
        });
    });

    // ─── createReason ─────────────────────────────────────────────────────────

    describe('createReason', () => {
        const tenantId = 'tenant-1';
        const dto = { type: 'SHRINKAGE', code: 'DAMAGE', label: 'Damaged goods', displayOrder: 1 };

        it('should create an inventory reason when code is unique for type', async () => {
            db.inventoryReason.findUnique.mockResolvedValue(null);
            const created = { id: 'r-1', tenant_id: tenantId, ...dto, display_order: 1 };
            db.inventoryReason.create.mockResolvedValue(created);

            const result = await service.createReason(tenantId, dto as any);

            expect(db.inventoryReason.findUnique).toHaveBeenCalledWith({
                where: {
                    tenant_id_type_code: {
                        tenant_id: tenantId,
                        type: dto.type,
                        code: dto.code,
                    },
                },
            });
            expect(db.inventoryReason.create).toHaveBeenCalledWith({
                data: {
                    tenant_id: tenantId,
                    type: dto.type,
                    code: dto.code,
                    label: dto.label,
                    display_order: dto.displayOrder,
                },
            });
            expect(result).toEqual(created);
        });

        it('should default display_order to 0 when not provided', async () => {
            const dtoNoOrder = { type: 'ADJUSTMENT', code: 'CORR', label: 'Correction' };
            db.inventoryReason.findUnique.mockResolvedValue(null);
            db.inventoryReason.create.mockResolvedValue({ id: 'r-2' });

            await service.createReason(tenantId, dtoNoOrder as any);

            expect(db.inventoryReason.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ display_order: 0 }),
                }),
            );
        });

        it('should throw BadRequestException when code already exists for that type', async () => {
            db.inventoryReason.findUnique.mockResolvedValue({ id: 'existing-reason' });

            const promise = service.createReason(tenantId, dto as any);

            await expect(promise).rejects.toThrow(BadRequestException);
            await expect(promise).rejects.toThrow(
                'An inventory reason with this code already exists for the selected type.',
            );
            expect(db.inventoryReason.create).not.toHaveBeenCalled();
        });
    });

    // ─── updateReason ─────────────────────────────────────────────────────────

    describe('updateReason', () => {
        const tenantId = 'tenant-1';
        const reasonId = 'r-1';
        const existingReason = {
            id: reasonId,
            tenant_id: tenantId,
            type: 'SHRINKAGE',
            code: 'DAMAGE',
            label: 'Damaged',
            is_system: false,
        };

        it('should update label and display_order', async () => {
            const dto = { label: 'Severely Damaged', displayOrder: 5 };
            db.inventoryReason.findFirst.mockResolvedValue(existingReason);
            const updated = { ...existingReason, label: dto.label, display_order: 5 };
            db.inventoryReason.update.mockResolvedValue(updated);

            const result = await service.updateReason(tenantId, reasonId, dto as any);

            expect(db.inventoryReason.findFirst).toHaveBeenCalledWith({
                where: { id: reasonId, tenant_id: tenantId },
            });
            expect(db.inventoryReason.update).toHaveBeenCalledWith({
                where: { id: reasonId },
                data: { label: dto.label, display_order: 5 },
            });
            expect(result).toEqual(updated);
        });

        it('should deactivate a non-system reason', async () => {
            const dto = { isActive: false };
            db.inventoryReason.findFirst.mockResolvedValue(existingReason);
            db.inventoryReason.update.mockResolvedValue({ ...existingReason, is_active: false });

            await service.updateReason(tenantId, reasonId, dto as any);

            expect(db.inventoryReason.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ is_active: false }),
                }),
            );
        });

        it('should throw BadRequestException when reason not found', async () => {
            db.inventoryReason.findFirst.mockResolvedValue(null);

            const promise = service.updateReason(tenantId, 'nonexistent', { label: 'X' } as any);

            await expect(promise).rejects.toThrow(BadRequestException);
            await expect(promise).rejects.toThrow('Inventory reason not found.');
            expect(db.inventoryReason.update).not.toHaveBeenCalled();
        });

        it('should throw BadRequestException when trying to deactivate a system reason', async () => {
            const systemReason = { ...existingReason, is_system: true };
            db.inventoryReason.findFirst.mockResolvedValue(systemReason);

            const promise = service.updateReason(tenantId, reasonId, { isActive: false } as any);

            await expect(promise).rejects.toThrow(BadRequestException);
            await expect(promise).rejects.toThrow('System inventory reasons cannot be deactivated.');
            expect(db.inventoryReason.update).not.toHaveBeenCalled();
        });

        it('should allow activating a system reason', async () => {
            const systemReason = { ...existingReason, is_system: true };
            db.inventoryReason.findFirst.mockResolvedValue(systemReason);
            db.inventoryReason.update.mockResolvedValue({ ...systemReason, is_active: true });

            // isActive: true on a system reason should not throw
            await expect(
                service.updateReason(tenantId, reasonId, { isActive: true } as any),
            ).resolves.toBeDefined();
        });

        it('should not include undefined fields in update data', async () => {
            const dto = {}; // no fields
            db.inventoryReason.findFirst.mockResolvedValue(existingReason);
            db.inventoryReason.update.mockResolvedValue(existingReason);

            await service.updateReason(tenantId, reasonId, dto as any);

            expect(db.inventoryReason.update).toHaveBeenCalledWith({
                where: { id: reasonId },
                data: {},
            });
        });
    });

    // ─── importWarehouses ─────────────────────────────────────────────────

    describe('importWarehouses', () => {
        const tenantId = 'tenant-1';
        const store = { id: 'store-1', tenant_id: tenantId, is_active: true };

        it('creates a new warehouse when no duplicate exists', async () => {
            db.store.findFirst.mockResolvedValueOnce(store);
            db.warehouse.findFirst.mockResolvedValueOnce(null); // findDuplicate: no existing by name
            db.warehouse.count.mockResolvedValueOnce(0); // generateWarehouseCode: no prefix conflicts
            db.warehouse.create.mockResolvedValue({ id: 'wh-new' });

            const result = await service.importWarehouses(tenantId, [{ name: 'North WH' }], 'skip');

            expect(result.created).toBe(1);
            expect(result.skipped).toBe(0);
            expect(result.updated).toBe(0);
            expect(result.errors).toHaveLength(0);
            expect(db.warehouse.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        tenant_id: tenantId,
                        store_id: store.id,
                        name: 'North WH',
                    }),
                }),
            );
        });

        it('skips a duplicate warehouse in skip mode', async () => {
            db.store.findFirst.mockResolvedValueOnce(store);
            db.warehouse.findFirst.mockResolvedValueOnce({ id: 'wh-existing' }); // findDuplicate: found

            const result = await service.importWarehouses(tenantId, [{ name: 'North WH' }], 'skip');

            expect(result.skipped).toBe(1);
            expect(result.created).toBe(0);
            expect(db.warehouse.create).not.toHaveBeenCalled();
        });

        it('updates a duplicate warehouse in upsert mode', async () => {
            db.store.findFirst.mockResolvedValueOnce(store);
            db.warehouse.findFirst.mockResolvedValueOnce({ id: 'wh-existing' }); // findDuplicate: found
            db.warehouse.update.mockResolvedValue({ id: 'wh-existing' });

            const result = await service.importWarehouses(
                tenantId,
                [{ name: 'North WH Updated' }],
                'upsert',
            );

            expect(result.updated).toBe(1);
            expect(result.created).toBe(0);
            expect(db.warehouse.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 'wh-existing' },
                    data: expect.objectContaining({ name: 'North WH Updated' }),
                }),
            );
        });

        it('records an error when required field name is missing', async () => {
            db.store.findFirst.mockResolvedValueOnce(store);

            const result = await service.importWarehouses(tenantId, [{ address: '123 Main St' }], 'skip');

            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]).toContain('name');
            expect(result.created).toBe(0);
        });

        it('continues processing remaining rows when a DB error occurs on one row', async () => {
            db.store.findFirst.mockResolvedValueOnce(store);
            db.warehouse.findFirst
                .mockResolvedValueOnce(null) // findDuplicate row 1: no duplicate
                .mockRejectedValueOnce(new Error('DB connection lost')); // findDuplicate row 2: DB error
            db.warehouse.count.mockResolvedValueOnce(0); // generateWarehouseCode for row 1
            db.warehouse.create.mockResolvedValue({ id: 'wh-new' });

            const result = await service.importWarehouses(
                tenantId,
                [
                    { name: 'Alpha WH' },
                    { name: 'Beta WH' },
                ],
                'skip',
            );

            expect(result.created).toBe(1);
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]).toContain('DB connection lost');
        });
    });

    // ─── getLedger ────────────────────────────────────────────────────────────

    describe('getLedger', () => {
        const tenantId = 'tenant-1';

        it('should return a paginated page carrying the server total', async () => {
            const movements = [{ id: 'mv-1', movement_type: 'PURCHASE' }];
            db.inventoryMovement.findMany.mockResolvedValue(movements);
            db.inventoryMovement.count.mockResolvedValue(4213);

            const result = await service.getLedger(tenantId, {} as any);

            expect(db.inventoryMovement.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { tenant_id: tenantId },
                    skip: 0,
                    take: 50,
                    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
                }),
            );
            // The total is the row count in the database, not the length of this page —
            // that is what the list footer reports.
            expect(result).toEqual({ items: movements, total: 4213, page: 1, limit: 50, pages: 85 });
        });

        it('should apply custom limit', async () => {
            db.inventoryMovement.findMany.mockResolvedValue([]);

            await service.getLedger(tenantId, { limit: 20 } as any);

            expect(db.inventoryMovement.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ take: 20 }),
            );
        });

        it('should skip earlier pages when page > 1', async () => {
            db.inventoryMovement.findMany.mockResolvedValue([]);

            await service.getLedger(tenantId, { page: 3, limit: 20 } as any);

            expect(db.inventoryMovement.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ skip: 40, take: 20 }),
            );
        });

        it('should only honour allowlisted sort keys', async () => {
            db.inventoryMovement.findMany.mockResolvedValue([]);

            await service.getLedger(tenantId, { sortBy: 'quantity', sortDir: 'asc' } as any);
            expect(db.inventoryMovement.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ orderBy: { quantity: 'asc' } }),
            );

            await service.getLedger(tenantId, { sortBy: 'id); DROP TABLE', sortDir: 'asc' } as any);
            expect(db.inventoryMovement.findMany).toHaveBeenLastCalledWith(
                expect.objectContaining({ orderBy: [{ created_at: 'desc' }, { id: 'desc' }] }),
            );
        });

        it('should filter by productId when provided', async () => {
            db.inventoryMovement.findMany.mockResolvedValue([]);

            await service.getLedger(tenantId, { productId: 'prod-1' } as any);

            expect(db.inventoryMovement.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ product_id: 'prod-1' }),
                }),
            );
        });

        it('should filter by warehouseId when provided', async () => {
            db.inventoryMovement.findMany.mockResolvedValue([]);

            await service.getLedger(tenantId, { warehouseId: 'wh-1' } as any);

            expect(db.inventoryMovement.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ warehouse_id: 'wh-1' }),
                }),
            );
        });

        it('should filter by movementType when provided', async () => {
            db.inventoryMovement.findMany.mockResolvedValue([]);

            await service.getLedger(tenantId, { movementType: 'SALE' } as any);

            expect(db.inventoryMovement.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ movement_type: 'SALE' }),
                }),
            );
        });

        it('should include a date window when from and to are valid ISO strings', async () => {
            db.inventoryMovement.findMany.mockResolvedValue([]);

            await service.getLedger(tenantId, {
                from: '2025-01-01',
                to: '2025-01-31',
            } as any);

            expect(db.inventoryMovement.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        created_at: expect.objectContaining({
                            gte: expect.any(Date),
                            lte: expect.any(Date),
                        }),
                    }),
                }),
            );
        });

        it('should not add date window when from and to are absent', async () => {
            db.inventoryMovement.findMany.mockResolvedValue([]);

            await service.getLedger(tenantId, {} as any);

            const call = db.inventoryMovement.findMany.mock.calls[0][0];
            expect(call.where.created_at).toBeUndefined();
        });

        it('should ignore invalid date strings in date window', async () => {
            db.inventoryMovement.findMany.mockResolvedValue([]);

            await service.getLedger(tenantId, { from: 'not-a-date', to: 'also-bad' } as any);

            const call = db.inventoryMovement.findMany.mock.calls[0][0];
            // created_at object exists but should not have gte/lte for invalid dates
            expect(call.where.created_at).toBeDefined();
            expect(call.where.created_at.gte).toBeUndefined();
            expect(call.where.created_at.lte).toBeUndefined();
        });

        it('should include product and warehouse relations', async () => {
            db.inventoryMovement.findMany.mockResolvedValue([]);

            await service.getLedger(tenantId, {} as any);

            expect(db.inventoryMovement.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    include: expect.objectContaining({
                        product: expect.objectContaining({ include: { group: true, subgroup: true } }),
                        warehouse: true,
                    }),
                }),
            );
        });
    });
});
