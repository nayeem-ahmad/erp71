import { Prisma } from '@prisma/client';
import { buildBackupPlan, PLATFORM_OWNED_MODELS, TENANT_COLUMNS_NOT_RESTORED } from './backup-plan';
import { reviveValue } from './tenant-backup.service';

describe('buildBackupPlan (against the real schema)', () => {
    const plan = buildBackupPlan();
    const position = new Map(plan.tables.map((t, i) => [t.model, i]));

    it('orders every table after the tables it requires', () => {
        for (const table of plan.tables) {
            for (const fk of table.foreignKeys.filter((f) => f.internal && !f.deferred)) {
                expect({ table: table.model, fk: fk.field, before: position.get(fk.target)! < position.get(table.model)! })
                    .toEqual({ table: table.model, fk: fk.field, before: true });
            }
        }
    });

    it('only ever defers optional references', () => {
        const deferred = plan.tables.flatMap((t) => t.foreignKeys.filter((f) => f.deferred));
        expect(deferred.length).toBeGreaterThan(0);
        expect(deferred.every((f) => !f.required)).toBe(true);
    });

    it('holds tenant tables and the child tables hanging off them', () => {
        for (const model of ['Product', 'Sale', 'SaleItem', 'VoucherDetail', 'PayrollLineItem', 'TenantUser', 'ProductSerial']) {
            expect(position.has(model)).toBe(true);
        }
        expect(plan.tables.find((t) => t.model === 'SaleItem')!.scope('t1')).toEqual({ sale: { tenant_id: 't1' } });
        expect(plan.tables.find((t) => t.model === 'Sale')!.scope('t1')).toEqual({ tenant_id: 't1' });
    });

    it('leaves out the platform-owned and platform-wide tables', () => {
        for (const model of [...PLATFORM_OWNED_MODELS, 'Tenant', 'User', 'SubscriptionPlan', 'FeedbackPlan', 'SupportMessage']) {
            expect(position.has(model)).toBe(false);
        }
    });

    it('has no platform-wide table pointing into a backed-up one, which a restore would cascade into', () => {
        const inbound = Prisma.dmmf.datamodel.models
            .filter((m) => !position.has(m.name))
            .flatMap((m) => m.fields
                .filter((f) => f.kind === 'object' && (f.relationFromFields?.length ?? 0) > 0 && position.has(f.type))
                .map((f) => `${m.name}.${f.name}`));
        expect(inbound).toEqual([]);
    });

    it('restores the tenant settings but not its identity, owner, billing or platform switches', () => {
        expect(plan.tenantColumns).toEqual(expect.arrayContaining(['name', 'timezone', 'brand_primary_color', 'online_store_id']));
        for (const column of TENANT_COLUMNS_NOT_RESTORED) expect(plan.tenantColumns).not.toContain(column);
    });
});

describe('reviveValue', () => {
    it('turns JSON back into what createMany takes', () => {
        expect(reviveValue({ type: 'DateTime', kind: 'scalar', required: true }, '2026-01-02T03:04:05.000Z'))
            .toEqual(new Date('2026-01-02T03:04:05.000Z'));
        expect(reviveValue({ type: 'Json', kind: 'scalar', required: false }, null)).toBe(Prisma.DbNull);
        expect(reviveValue({ type: 'Json', kind: 'scalar', required: true }, null)).toBe(Prisma.JsonNull);
        expect(reviveValue({ type: 'Decimal', kind: 'scalar', required: true }, '12.50')).toBe('12.50');
        expect(reviveValue({ type: 'String', kind: 'scalar', required: false }, null)).toBeNull();
    });
});
