import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../src/database/database.service';
import { CrmActivitiesService } from '../src/crm-activities/crm-activities.service';
import { CrmLeadTaxonomyService } from '../src/crm-lead-taxonomy/crm-lead-taxonomy.service';
import { AppLogger } from '../src/common/app-logger.service';
import { JobTrackerService } from '../src/system-health/jobs/job-tracker.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { TenantTimezoneService } from '../src/database/tenant-timezone.service';
import { AuditService } from '../src/audit/audit.service';

jest.setTimeout(60_000);

/**
 * Persistence for editing a completed log, against a real database and only
 * rows this file creates. It does not truncate shared tables and it deletes
 * its own tenants when it finishes, so it can run beside the other integration
 * suites and must not be pointed at a database whose rows matter.
 */
describe('completed CRM activity edit (integration)', () => {
    const db = new DatabaseService();
    const notifications = { create: jest.fn().mockResolvedValue(undefined) };
    let service: CrmActivitiesService;

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const contactedAt = new Date('2026-02-01T08:00:00.000Z');
    const completedAt = new Date('2026-02-02T10:00:00.000Z');
    const approvedAt = new Date('2026-02-02T09:00:00.000Z');

    let ownerId: string;
    let otherOwnerId: string;
    let tenantId: string;
    let otherTenantId: string;
    let leadId: string;
    let doneId: string;
    let plannedId: string;

    beforeAll(async () => {
        await db.$connect();
        const moduleRef = await Test.createTestingModule({
            providers: [
                CrmActivitiesService,
                AuditService,
                { provide: DatabaseService, useValue: db },
                { provide: CrmLeadTaxonomyService, useValue: { resolveByIdOrCode: jest.fn() } },
                { provide: AppLogger, useValue: { debug: jest.fn(), error: jest.fn(), warn: jest.fn(), log: jest.fn() } },
                { provide: JobTrackerService, useValue: { track: (_n: string, fn: () => Promise<unknown>) => fn() } },
                { provide: NotificationsService, useValue: notifications },
                {
                    provide: TenantTimezoneService,
                    useValue: { for: jest.fn(async () => 'Asia/Dhaka'), forMany: jest.fn(), prime: jest.fn(), invalidate: jest.fn() },
                },
            ],
        }).compile();
        service = moduleRef.get(CrmActivitiesService);

        const owner = await db.user.create({
            data: { email: `completed-edit-${suffix}@test.local`, passwordHash: 'x', name: 'Completed Edit' },
        });
        const other = await db.user.create({
            data: { email: `completed-edit-other-${suffix}@test.local`, passwordHash: 'x', name: 'Other Business' },
        });
        ownerId = owner.id;
        otherOwnerId = other.id;
        const tenant = await db.tenant.create({ data: { name: `Completed edit ${suffix}`, owner_id: ownerId } });
        const otherTenant = await db.tenant.create({ data: { name: `Other business ${suffix}`, owner_id: otherOwnerId } });
        tenantId = tenant.id;
        otherTenantId = otherTenant.id;
        await db.tenantUser.create({ data: { tenant_id: tenantId, user_id: ownerId, role: 'OWNER' } });
        await db.tenantUser.create({ data: { tenant_id: otherTenantId, user_id: otherOwnerId, role: 'OWNER' } });

        const lead = await db.lead.create({
            data: {
                tenant_id: tenantId,
                name: `Lead ${suffix}`,
                last_contacted_at: contactedAt,
                last_activity_at: contactedAt,
                next_step: 'Chase the invoice',
            },
        });
        leadId = lead.id;

        const done = await db.crmActivity.create({
            data: {
                tenant_id: tenantId,
                lead_id: leadId,
                status: 'DONE',
                summary: 'Sent the catalogue',
                notes: 'Original note',
                outcome: 'Left a message',
                completed_at: completedAt,
                is_approved: true,
                approved_by: ownerId,
                approved_at: approvedAt,
                created_by: ownerId,
                origin: 'MANUAL',
            },
        });
        doneId = done.id;
        const planned = await db.crmActivity.create({
            data: {
                tenant_id: tenantId,
                lead_id: leadId,
                status: 'PLANNED',
                subject: 'Chase the invoice',
                notes: 'Bring the ledger',
                is_approved: false,
                created_by: ownerId,
                origin: 'MANUAL',
            },
        });
        plannedId = planned.id;
    });

    afterAll(async () => {
        const tenants = [tenantId, otherTenantId].filter(Boolean);
        if (tenants.length) {
            await db.auditLog.deleteMany({ where: { tenant_id: { in: tenants } } }).catch(() => undefined);
            await db.tenant.deleteMany({ where: { id: { in: tenants } } }).catch(() => undefined);
        }
        const users = [ownerId, otherOwnerId].filter(Boolean);
        if (users.length) {
            await db.user.deleteMany({ where: { id: { in: users } } }).catch(() => undefined);
        }
        await db.$disconnect();
    });

    it('saves the corrected details, keeps the activity completed, and reads them back', async () => {
        const beforeCount = await db.crmActivity.count({ where: { tenant_id: tenantId } });
        notifications.create.mockClear();

        const saved = await service.update(tenantId, doneId, {
            summary: 'Sent the updated catalogue',
            notes: 'He will pay Thursday',
            outcome: '',
        }, 'Asia/Dhaka', ownerId);

        expect(saved.status).toBe('DONE');
        expect(saved.summary).toBe('Sent the updated catalogue');
        expect(saved.notes).toBe('He will pay Thursday');
        expect(saved.outcome).toBeNull();
        expect(saved.completed_at).toEqual(completedAt);
        expect(saved.is_approved).toBe(true);
        expect(saved.approved_by).toBe(ownerId);
        expect(saved.approved_at).toEqual(approvedAt);
        expect(saved.lead_id).toBe(leadId);

        const reopened = await service.findOne(tenantId, doneId);
        expect(reopened.summary).toBe('Sent the updated catalogue');
        expect(reopened.notes).toBe('He will pay Thursday');
        expect(reopened.outcome).toBeNull();
        expect(reopened.status).toBe('DONE');
        expect(reopened.completed_at).toEqual(completedAt);
        expect(reopened.is_approved).toBe(true);

        expect(await db.crmActivity.count({ where: { tenant_id: tenantId } })).toBe(beforeCount);
        const lead = await db.lead.findFirst({ where: { id: leadId } });
        expect(lead?.last_contacted_at).toEqual(contactedAt);
        expect(lead?.last_activity_at).toEqual(contactedAt);
        expect(lead?.next_step).toBe('Chase the invoice');
        expect(notifications.create).not.toHaveBeenCalled();

        const audit = await db.auditLog.findFirst({
            where: { tenant_id: tenantId, entity: 'CrmActivity', entity_id: doneId, action: 'crm.activity_details_updated' },
            orderBy: { created_at: 'desc' },
        });
        expect(audit?.user_id).toBe(ownerId);
        expect(audit?.payload).toEqual({
            status: 'DONE',
            changes: {
                summary: { from: 'Sent the catalogue', to: 'Sent the updated catalogue' },
                notes: { from: 'Original note', to: 'He will pay Thursday' },
                outcome: { from: 'Left a message', to: null },
            },
        });
    });

    it('does not let another business edit or read the activity', async () => {
        await expect(
            service.update(otherTenantId, doneId, { notes: 'cross-business' }, 'Asia/Dhaka', otherOwnerId),
        ).rejects.toBeInstanceOf(NotFoundException);
        await expect(service.findOne(otherTenantId, doneId)).rejects.toBeInstanceOf(NotFoundException);

        const row = await db.crmActivity.findFirst({ where: { id: doneId } });
        expect(row?.notes).toBe('He will pay Thursday');
        expect(row?.tenant_id).toBe(tenantId);
        expect(await db.auditLog.count({
            where: { tenant_id: otherTenantId, action: 'crm.activity_details_updated' },
        })).toBe(0);
    });

    it('refuses to clear the summary or to reschedule a completed activity', async () => {
        await expect(
            service.update(tenantId, doneId, { summary: '   ' }, 'Asia/Dhaka', ownerId),
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(
            service.update(tenantId, doneId, { notes: 'nope', subject: 'renamed' } as any, 'Asia/Dhaka', ownerId),
        ).rejects.toBeInstanceOf(BadRequestException);

        const row = await db.crmActivity.findFirst({ where: { id: doneId } });
        expect(row?.summary).toBe('Sent the updated catalogue');
        expect(row?.notes).toBe('He will pay Thursday');
        expect(row?.status).toBe('DONE');
        expect(row?.completed_at).toEqual(completedAt);
    });

    it('still edits a planned activity without writing a completed-details audit', async () => {
        const saved = await service.update(
            tenantId,
            plannedId,
            { subject: 'Chase it again', notes: 'Bring both ledgers' },
            'Asia/Dhaka',
            ownerId,
        );
        expect(saved.status).toBe('PLANNED');
        expect(saved.subject).toBe('Chase it again');
        expect(saved.notes).toBe('Bring both ledgers');
        expect(saved.is_approved).toBe(false);

        const lead = await db.lead.findFirst({ where: { id: leadId } });
        expect(lead?.last_activity_at && lead.last_activity_at > contactedAt).toBe(true);
        expect(lead?.last_contacted_at).toEqual(contactedAt);

        const done = await db.crmActivity.findFirst({ where: { id: doneId } });
        expect(done?.status).toBe('DONE');
        expect(done?.notes).toBe('He will pay Thursday');
        expect(await db.auditLog.count({
            where: { entity_id: plannedId, action: 'crm.activity_details_updated' },
        })).toBe(0);
    });
});
