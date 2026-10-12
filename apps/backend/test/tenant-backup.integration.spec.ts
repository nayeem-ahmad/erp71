import * as dotenv from 'dotenv';
import * as path from 'node:path';
import { bootstrapDefaultAccountingForTenant } from '@erp71/database';
import { DatabaseService } from '../src/database/database.service';
import { runSimulation } from '../src/demo-data/generator/simulate';
import { clearTenantData } from '../src/tenants/clear-tenant-data';
import { TenantBackupService, type TenantBackupFile } from '../src/tenant-backup/tenant-backup.service';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

jest.setTimeout(300_000);

/**
 * Round-trips a demo-data workspace through backup → wipe → restore and
 * asserts a second backup is identical to the first: every row of every table,
 * and the tenant's settings. Also asserts a restore touches no other tenant,
 * refuses another tenant's backup, and drops what depends on a user deleted
 * since the backup was taken rather than failing.
 *
 * Requires a reachable DATABASE_URL with the schema pushed. Runs in CI, which
 * provisions a clean DB first.
 */
describe('Tenant backup and restore (integration)', () => {
    const db = new DatabaseService();
    const service = new TenantBackupService(
        db,
        { invalidateTenant: () => undefined } as any,
        { invalidate: () => undefined } as any,
    );
    const suffix = Date.now();
    let tenantId: string;
    let ownerId: string;
    let otherTenantId: string;
    let departedUserId: string;
    let storeId: string;

    /** Rows keyed by table and sorted, so two backups compare regardless of read order. */
    const normalize = (file: TenantBackupFile) => {
        const tables: Record<string, string[]> = {};
        for (const [model, rows] of Object.entries(file.tables)) {
            tables[model] = rows.map((r) => JSON.stringify(r)).sort();
        }
        return { settings: JSON.parse(JSON.stringify(file.tenant_settings)), tables };
    };

    beforeAll(async () => {
        await db.$connect();

        const owner = await db.user.create({ data: { email: `backup-int-${suffix}@test.local`, passwordHash: 'x', name: 'Owner' } });
        ownerId = owner.id;
        const tenant = await db.tenant.create({
            data: { name: `Backup Int ${suffix}`, owner_id: owner.id, brand_primary_color: '#2563eb', hidden_apps: ['crm'] },
        });
        tenantId = tenant.id;
        await db.tenantUser.create({ data: { tenant_id: tenantId, user_id: ownerId, role: 'OWNER' } });

        const store = await db.store.create({ data: { tenant_id: tenantId, name: 'Main', address: 'Dhaka' } });
        storeId = store.id;
        await db.tenant.update({ where: { id: tenantId }, data: { online_store_id: store.id } });
        const wh = await db.warehouse.create({
            data: { tenant_id: tenantId, store_id: store.id, name: 'Main WH', code: `WH-${suffix}`, is_default: true, is_active: true },
        });
        await db.inventorySettings.create({
            data: {
                tenant_id: tenantId,
                default_product_warehouse_id: wh.id,
                default_purchase_warehouse_id: wh.id,
                default_sales_warehouse_id: wh.id,
                default_shrinkage_warehouse_id: wh.id,
                default_transfer_source_warehouse_id: wh.id,
                default_transfer_destination_warehouse_id: wh.id,
            },
        });
        for (const [i, code] of ['THEFT', 'DAMAGE', 'EXPIRATION', 'UNKNOWN'].entries()) {
            await db.inventoryReason.create({
                data: { tenant_id: tenantId, type: 'SHRINKAGE', code, label: code, is_active: true, is_system: true, display_order: i },
            });
        }
        await bootstrapDefaultAccountingForTenant(db, tenantId);

        // A self-referencing hierarchy, which the restore has to write in two passes.
        const dhaka = await db.territory.create({ data: { tenant_id: tenantId, name: 'Dhaka' } });
        await db.territory.create({ data: { tenant_id: tenantId, name: 'Gulshan', parent_id: dhaka.id } });

        // A member who will have deleted their account by the time of the restore.
        const departed = await db.user.create({ data: { email: `backup-int-gone-${suffix}@test.local`, passwordHash: 'x' } });
        departedUserId = departed.id;
        await db.tenantUser.create({ data: { tenant_id: tenantId, user_id: departed.id, role: 'CASHIER' } });

        await runSimulation({ db, tenantId, userId: ownerId, batchNumber: 1, now: new Date(), windowDays: 10 });

        const otherOwner = await db.user.create({ data: { email: `backup-int-other-${suffix}@test.local`, passwordHash: 'x' } });
        const other = await db.tenant.create({ data: { name: `Backup Other ${suffix}`, owner_id: otherOwner.id } });
        otherTenantId = other.id;
        const otherStore = await db.store.create({ data: { tenant_id: otherTenantId, name: 'Other Main' } });
        await db.customer.create({ data: { tenant_id: otherTenantId, store_id: otherStore.id, name: 'Untouched', customer_code: 'C-OTHER-1' } });
    });

    afterAll(async () => {
        await db.$disconnect();
    });

    it('restores a wiped workspace to exactly what was backed up', async () => {
        const first = await service.createBackup(tenantId, 'admin@test.local');
        expect(first.rows).toBeGreaterThan(100);
        expect(first.file.tables.Sale?.length).toBeGreaterThan(0);
        expect(first.file.tables.SaleItem?.length).toBeGreaterThan(0);
        // Platform-owned rows are never in a backup.
        expect(first.file.tables.AuditLog).toBeUndefined();

        // Take the departed member out of the comparison: the restore must skip them.
        const parsed = service.parseBackup(first.gzip);
        const expected = normalize(first.file);
        expected.tables.TenantUser = expected.tables.TenantUser.filter((r) => !r.includes(departedUserId));

        // Everything the backup holds goes, something new arrives, settings change.
        await clearTenantData(db, tenantId, 'all');
        await db.customer.create({ data: { tenant_id: tenantId, store_id: storeId, name: 'Entered after the backup', customer_code: 'C-AFTER-1' } });
        await db.tenant.update({ where: { id: tenantId }, data: { brand_primary_color: '#000000', hidden_apps: [] } });
        await db.user.delete({ where: { id: departedUserId } });

        const summary = await service.restoreBackup(tenantId, parsed);
        expect(summary.rows_skipped.TenantUser).toBe(1);
        expect(summary.unknown_tables).toEqual([]);
        expect(summary.unknown_columns).toEqual([]);

        const second = await service.createBackup(tenantId, 'admin@test.local');
        const actual = normalize(second.file);
        expect(Object.keys(actual.tables).sort()).toEqual(Object.keys(expected.tables).sort());
        for (const model of Object.keys(expected.tables)) {
            expect({ model, rows: actual.tables[model] }).toEqual({ model, rows: expected.tables[model] });
        }
        expect(actual.settings).toEqual(expected.settings);

        const gulshan = await db.territory.findFirst({ where: { tenant_id: tenantId, name: 'Gulshan' }, include: { parent: true } });
        expect(gulshan?.parent?.name).toBe('Dhaka');
        expect(await db.customer.count({ where: { tenant_id: otherTenantId } })).toBe(1);
    });

    it('refuses a backup of another workspace', async () => {
        const { file } = await service.createBackup(otherTenantId, null);
        await expect(service.restoreBackup(tenantId, file)).rejects.toThrow(/another workspace/);
    });

    it('rejects a file that is not a backup', () => {
        expect(() => service.parseBackup(Buffer.from('{"hello":"world"}'))).toThrow(/not an ERP71 tenant backup/);
        expect(() => service.parseBackup(Buffer.from('not json'))).toThrow(/invalid JSON/);
    });
});
