import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EmployeeRecordsService } from './employee-records.service';
import { AssetsService } from '../assets/assets.service';
import { DatabaseService } from '../database/database.service';

describe('EmployeeRecordsService', () => {
    let service: EmployeeRecordsService;
    let db: any;
    let assets: any;

    beforeEach(async () => {
        db = {
            assetAssignment: {
                findMany: jest.fn().mockResolvedValue([]),
                findFirst: jest.fn().mockResolvedValue(null),
                create: jest.fn().mockResolvedValue({}),
                update: jest.fn().mockResolvedValue({}),
            },
            fixedAsset: { findFirst: jest.fn().mockResolvedValue({ id: 'fa-1', name: 'Dell Laptop' }) },
            employee: {
                findFirst: jest.fn().mockResolvedValue({ id: 'emp-1' }),
                findMany: jest.fn().mockResolvedValue([]),
            },
            policy: {
                findMany: jest.fn().mockResolvedValue([]),
                findFirst: jest.fn().mockResolvedValue({ id: 'pol-1', title: 'Handbook', published_at: new Date() }),
                create: jest.fn().mockResolvedValue({}),
                update: jest.fn().mockResolvedValue({}),
            },
            policyAcknowledgement: {
                findMany: jest.fn().mockResolvedValue([]),
                upsert: jest.fn().mockResolvedValue({}),
            },
            employeeDocument: {
                findMany: jest.fn().mockResolvedValue([]),
                findFirst: jest.fn().mockResolvedValue(null),
                create: jest.fn().mockResolvedValue({}),
                update: jest.fn().mockResolvedValue({}),
                updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
        };
        assets = {
            uploadBuffer: jest.fn().mockResolvedValue({ url: 'https://x/y', publicId: 'pid', bytes: 10 }),
            deleteFile: jest.fn().mockResolvedValue(undefined),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                EmployeeRecordsService,
                { provide: DatabaseService, useValue: db },
                { provide: AssetsService, useValue: assets },
            ],
        }).compile();
        service = module.get(EmployeeRecordsService);
    });

    describe('asset assignment', () => {
        it('assigns a non-capitalised item with no fixed asset', async () => {
            // Most assigned things — a SIM, a uniform — will never be a
            // FixedAsset, which is why item_name is the required field.
            await service.assign('t1', {
                employee_id: 'emp-1', item_name: 'SIM card', assigned_on: '2026-08-01',
            });
            expect(db.assetAssignment.create.mock.calls[0][0].data.item_name).toBe('SIM card');
            expect(db.assetAssignment.create.mock.calls[0][0].data.fixed_asset_id).toBeNull();
        });

        it('copies the asset name rather than referencing it', async () => {
            // The record must still read sensibly if the asset is renamed or
            // disposed of.
            await service.assign('t1', {
                employee_id: 'emp-1', fixed_asset_id: 'fa-1', assigned_on: '2026-08-01',
            });
            expect(db.assetAssignment.create.mock.calls[0][0].data.item_name).toBe('Dell Laptop');
        });

        it('refuses to hand out an asset that is already out', async () => {
            // A laptop in two places is the confusion this model exists to end.
            db.assetAssignment.findFirst.mockResolvedValue({ id: 'existing' });
            await expect(service.assign('t1', {
                employee_id: 'emp-1', fixed_asset_id: 'fa-1', assigned_on: '2026-08-01',
            })).rejects.toThrow(BadRequestException);
        });

        it('refuses an assignment with neither a name nor an asset', async () => {
            await expect(service.assign('t1', {
                employee_id: 'emp-1', assigned_on: '2026-08-01',
            })).rejects.toThrow(BadRequestException);
        });

        it('refuses an employee from another tenant', async () => {
            db.employee.findFirst.mockResolvedValue(null);
            await expect(service.assign('t1', {
                employee_id: 'emp-x', item_name: 'SIM', assigned_on: '2026-08-01',
            })).rejects.toThrow(NotFoundException);
        });

        it('records a return', async () => {
            db.assetAssignment.findFirst.mockResolvedValue({
                id: 'a-1', assigned_on: new Date(Date.UTC(2026, 7, 1)), returned_on: null,
            });
            await service.recordReturn('t1', 'a-1', { returned_on: '2026-09-01', condition_in: 'Scratched' });
            expect(db.assetAssignment.update.mock.calls[0][0].data.condition_in).toBe('Scratched');
        });

        it('refuses a return before the handover', async () => {
            db.assetAssignment.findFirst.mockResolvedValue({
                id: 'a-1', assigned_on: new Date(Date.UTC(2026, 7, 10)), returned_on: null,
            });
            await expect(service.recordReturn('t1', 'a-1', { returned_on: '2026-08-01' }))
                .rejects.toThrow(BadRequestException);
        });

        it('refuses to return something already returned', async () => {
            db.assetAssignment.findFirst.mockResolvedValue({
                id: 'a-1', assigned_on: new Date(), returned_on: new Date(),
            });
            await expect(service.recordReturn('t1', 'a-1', { returned_on: '2026-09-01' }))
                .rejects.toThrow(BadRequestException);
        });

        it('scopes acknowledgement to the token employee', async () => {
            // Acknowledging on somebody else's behalf defeats the entire point.
            db.assetAssignment.findFirst.mockResolvedValue({ id: 'a-1', acknowledged_at: null });
            await service.acknowledgeAssignment('t1', 'emp-1', 'a-1');
            expect(db.assetAssignment.findFirst.mock.calls[0][0].where).toMatchObject({
                id: 'a-1', tenant_id: 't1', employee_id: 'emp-1',
            });
        });

        it('is idempotent on a second acknowledgement', async () => {
            const already = { id: 'a-1', acknowledged_at: new Date() };
            db.assetAssignment.findFirst.mockResolvedValue(already);
            const result = await service.acknowledgeAssignment('t1', 'emp-1', 'a-1');
            expect(result).toBe(already);
            expect(db.assetAssignment.update).not.toHaveBeenCalled();
        });
    });

    describe('policies', () => {
        it('creates an unpublished policy by default', async () => {
            await service.createPolicy('t1', { title: 'Handbook', body: '...' });
            expect(db.policy.create.mock.calls[0][0].data.published_at).toBeNull();
        });

        it('publishes on request', async () => {
            await service.createPolicy('t1', { title: 'Handbook', body: '...', publish: true });
            expect(db.policy.create.mock.calls[0][0].data.published_at).toBeInstanceOf(Date);
        });

        it('keeps the original publish date when re-publishing', async () => {
            // Republishing after a revision must not reset everyone's
            // acknowledgements by looking like a new document.
            const originally = new Date('2026-01-01');
            db.policy.findFirst.mockResolvedValue({ id: 'pol-1', published_at: originally });
            await service.updatePolicy('t1', 'pol-1', { publish: true });
            expect(db.policy.update.mock.calls[0][0].data.published_at).toBe(originally);
        });

        it('unpublishes by nulling rather than deleting', async () => {
            await service.updatePolicy('t1', 'pol-1', { publish: false });
            expect(db.policy.update.mock.calls[0][0].data.published_at).toBeNull();
        });

        it('splits the roster into acknowledged and pending', async () => {
            // Who has NOT read it is the reason this feature exists.
            db.employee.findMany.mockResolvedValue([
                { id: 'e1', name: 'Alice', employee_code: 'E1' },
                { id: 'e2', name: 'Bob', employee_code: 'E2' },
            ]);
            db.policyAcknowledgement.findMany.mockResolvedValue([
                { employee_id: 'e1', acknowledged_at: new Date() },
            ]);

            const status = await service.policyAcknowledgementStatus('t1', 'pol-1');

            expect(status.acknowledged.map((e: any) => e.id)).toEqual(['e1']);
            expect(status.pending.map((e: any) => e.id)).toEqual(['e2']);
        });

        it('only shows published policies to an employee', async () => {
            await service.policiesForEmployee('t1', 'emp-1');
            expect(db.policy.findMany.mock.calls[0][0].where.published_at).toEqual({ not: null });
        });

        it('refuses to acknowledge an unpublished policy', async () => {
            db.policy.findFirst.mockResolvedValue(null);
            await expect(service.acknowledgePolicy('t1', 'emp-1', 'pol-1'))
                .rejects.toThrow(NotFoundException);
        });

        it('treats a double acknowledgement as a double tap, not an error', async () => {
            await service.acknowledgePolicy('t1', 'emp-1', 'pol-1');
            expect(db.policyAcknowledgement.upsert).toHaveBeenCalled();
        });
    });

    describe('documents', () => {
        const file = (over: Record<string, any> = {}) => ({
            buffer: Buffer.from('x'), originalname: 'contract.pdf',
            mimetype: 'application/pdf', size: 1000, ...over,
        });

        it('stores the storage key so the file can be purged later', async () => {
            await service.addDocument('t1', 'emp-1', { title: 'Contract' }, file());
            expect(db.employeeDocument.create.mock.calls[0][0].data.storage_key).toBe('pid');
        });

        it('sends a PDF through the raw pipeline', async () => {
            await service.addDocument('t1', 'emp-1', { title: 'Contract' }, file());
            expect(assets.uploadBuffer.mock.calls[0][3]).toBe('raw');
        });

        it('refuses a disallowed type', async () => {
            await expect(service.addDocument('t1', 'emp-1', { title: 'X' }, file({
                mimetype: 'text/html',
            }))).rejects.toThrow(BadRequestException);
        });

        it('refuses a file over the cap', async () => {
            await expect(service.addDocument('t1', 'emp-1', { title: 'X' }, file({
                size: 11 * 1024 * 1024,
            }))).rejects.toThrow(BadRequestException);
        });

        it('purges the file before soft-deleting the row', async () => {
            db.employeeDocument.findFirst.mockResolvedValue({ id: 'd-1', storage_key: 'pid' });
            await service.deleteDocument('t1', 'd-1');
            expect(assets.deleteFile).toHaveBeenCalledWith('pid');
            expect(db.employeeDocument.update.mock.calls[0][0].data.deleted_at).toBeInstanceOf(Date);
        });

        it('excludes documents already notified from the expiry sweep', async () => {
            // Otherwise a daily cron sends the same reminder every morning
            // until the document expires.
            await service.expiringDocuments('t1', 30);
            expect(db.employeeDocument.findMany.mock.calls[0][0].where.expiry_notified_at).toBeNull();
        });

        it('only sweeps documents that have an expiry at all', async () => {
            await service.expiringDocuments('t1');
            expect(db.employeeDocument.findMany.mock.calls[0][0].where.expires_on).toMatchObject({ not: null });
        });

        it('marks nothing when the notified list is empty', async () => {
            const result = await service.markExpiryNotified('t1', []);
            expect(result.count).toBe(0);
            expect(db.employeeDocument.updateMany).not.toHaveBeenCalled();
        });
    });
});
