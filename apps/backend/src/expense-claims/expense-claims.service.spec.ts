import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ExpenseClaimsService } from './expense-claims.service';
import { AssetsService } from '../assets/assets.service';
import { DatabaseService } from '../database/database.service';

const CLAIM = (over: Record<string, any> = {}) => ({
    id: 'claim-1',
    tenant_id: 't1',
    employee_id: 'emp-1',
    title: 'Client visit',
    status: 'DRAFT',
    total_amount: 1500,
    lines: [{ id: 'l1', amount: 1500 }],
    attachments: [],
    ...over,
});

const LINES = [
    { description: 'Taxi', amount: 500, spent_on: '2026-08-01' },
    { description: 'Lunch', amount: 1000, spent_on: '2026-08-01' },
];

describe('ExpenseClaimsService', () => {
    let service: ExpenseClaimsService;
    let db: any;
    let assets: any;

    beforeEach(async () => {
        db = {
            expenseClaim: {
                findFirst: jest.fn().mockResolvedValue(CLAIM()),
                findMany: jest.fn().mockResolvedValue([]),
                create: jest.fn().mockResolvedValue(CLAIM()),
                update: jest.fn().mockResolvedValue(CLAIM()),
            },
            expenseClaimLine: {
                deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
                createMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
            expenseClaimAttachment: {
                findFirst: jest.fn().mockResolvedValue(null),
                create: jest.fn().mockResolvedValue({}),
                delete: jest.fn().mockResolvedValue({}),
            },
            payrollAdjustment: { create: jest.fn().mockResolvedValue({}) },
        };
        db.$transaction = jest.fn(async (cb: any) => cb(db));

        assets = {
            uploadBuffer: jest.fn().mockResolvedValue({ url: 'https://x/y.jpg', publicId: 'pid', bytes: 100 }),
            deleteFile: jest.fn().mockResolvedValue(undefined),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ExpenseClaimsService,
                { provide: DatabaseService, useValue: db },
                { provide: AssetsService, useValue: assets },
            ],
        }).compile();
        service = module.get(ExpenseClaimsService);
    });

    describe('create', () => {
        it('sums the lines into the claim total', async () => {
            await service.create('t1', 'emp-1', {
                title: 'Client visit', claim_date: '2026-08-02', lines: LINES,
            });
            expect(db.expenseClaim.create.mock.calls[0][0].data.total_amount).toBe(1500);
        });

        it('starts as a draft', async () => {
            await service.create('t1', 'emp-1', {
                title: 'X', claim_date: '2026-08-02', lines: LINES,
            });
            expect(db.expenseClaim.create.mock.calls[0][0].data.status).toBe('DRAFT');
        });

        it('refuses a claim with no lines', async () => {
            await expect(service.create('t1', 'emp-1', {
                title: 'X', claim_date: '2026-08-02', lines: [],
            })).rejects.toThrow(BadRequestException);
        });

        it('refuses a zero or negative line', async () => {
            await expect(service.create('t1', 'emp-1', {
                title: 'X', claim_date: '2026-08-02',
                lines: [{ description: 'Free', amount: 0, spent_on: '2026-08-01' }],
            })).rejects.toThrow(BadRequestException);
        });
    });

    describe('ownership', () => {
        it('narrows the lookup by employee rather than checking afterwards', async () => {
            // A 404 rather than a 403 means an employee asking for somebody
            // else's claim learns nothing about whether it exists.
            await service.get('t1', 'claim-1', 'emp-1');
            expect(db.expenseClaim.findFirst.mock.calls[0][0].where).toMatchObject({
                id: 'claim-1', tenant_id: 't1', employee_id: 'emp-1',
            });
        });

        it('does not scope by employee for a staff read', async () => {
            await service.get('t1', 'claim-1');
            expect(db.expenseClaim.findFirst.mock.calls[0][0].where).not.toHaveProperty('employee_id');
        });

        it('404s a claim that is not the employee’s', async () => {
            db.expenseClaim.findFirst.mockResolvedValue(null);
            await expect(service.get('t1', 'claim-1', 'emp-2')).rejects.toThrow(NotFoundException);
        });
    });

    describe('lifecycle', () => {
        it('submits a draft', async () => {
            await service.submit('t1', 'claim-1', 'emp-1');
            expect(db.expenseClaim.update.mock.calls[0][0].data.status).toBe('SUBMITTED');
        });

        it('refuses to submit a claim with no lines', async () => {
            db.expenseClaim.findFirst.mockResolvedValue(CLAIM({ lines: [] }));
            await expect(service.submit('t1', 'claim-1', 'emp-1')).rejects.toThrow(BadRequestException);
        });

        it('refuses to submit twice', async () => {
            db.expenseClaim.findFirst.mockResolvedValue(CLAIM({ status: 'SUBMITTED' }));
            await expect(service.submit('t1', 'claim-1', 'emp-1')).rejects.toThrow(BadRequestException);
        });

        it('refuses to edit a submitted claim', async () => {
            db.expenseClaim.findFirst.mockResolvedValue(CLAIM({ status: 'SUBMITTED' }));
            await expect(service.update('t1', 'claim-1', 'emp-1', { title: 'New' }))
                .rejects.toThrow(BadRequestException);
        });

        it('recomputes the total when lines are replaced', async () => {
            await service.update('t1', 'claim-1', 'emp-1', {
                lines: [{ description: 'Taxi', amount: 250, spent_on: '2026-08-01' }],
            });
            expect(db.expenseClaim.update.mock.calls[0][0].data.total_amount).toBe(250);
        });

        it('lets an employee withdraw a submitted claim', async () => {
            db.expenseClaim.findFirst.mockResolvedValue(CLAIM({ status: 'SUBMITTED' }));
            await service.cancel('t1', 'claim-1', 'emp-1');
            expect(db.expenseClaim.update.mock.calls[0][0].data.status).toBe('CANCELLED');
        });

        it('refuses to withdraw an approved claim', async () => {
            db.expenseClaim.findFirst.mockResolvedValue(CLAIM({ status: 'APPROVED' }));
            await expect(service.cancel('t1', 'claim-1', 'emp-1')).rejects.toThrow(BadRequestException);
        });
    });

    describe('review', () => {
        it('approves a submitted claim and records who', async () => {
            db.expenseClaim.findFirst.mockResolvedValue(CLAIM({ status: 'SUBMITTED' }));
            await service.review('t1', 'claim-1', 'user-1', { status: 'APPROVED' });

            const data = db.expenseClaim.update.mock.calls[0][0].data;
            expect(data.status).toBe('APPROVED');
            expect(data.approved_by).toBe('user-1');
            expect(data.approved_at).toBeInstanceOf(Date);
        });

        it('refuses to review a draft', async () => {
            await expect(service.review('t1', 'claim-1', 'user-1', { status: 'APPROVED' }))
                .rejects.toThrow(BadRequestException);
        });
    });

    describe('reimburse', () => {
        beforeEach(() => db.expenseClaim.findFirst.mockResolvedValue(CLAIM({ status: 'APPROVED' })));

        it('creates a payroll earning adjustment when settled via payroll', async () => {
            // The whole integration: PayrollAdjustment already exists and is
            // already consumed by run approval.
            await service.reimburse('t1', 'claim-1', { via: 'PAYROLL', year: 2026, month: 8 });

            const data = db.payrollAdjustment.create.mock.calls[0][0].data;
            expect(data.kind).toBe('EARNING');
            expect(data.amount).toBe(1500);
            expect(data.year).toBe(2026);
        });

        it('refuses a payroll reimbursement with no period', async () => {
            await expect(service.reimburse('t1', 'claim-1', { via: 'PAYROLL' }))
                .rejects.toThrow(BadRequestException);
        });

        it('creates no adjustment for a direct settlement', async () => {
            await service.reimburse('t1', 'claim-1', { via: 'DIRECT' });
            expect(db.payrollAdjustment.create).not.toHaveBeenCalled();
            expect(db.expenseClaim.update.mock.calls[0][0].data.reimbursed_via).toBe('DIRECT');
        });

        it('refuses to reimburse a claim that was never approved', async () => {
            db.expenseClaim.findFirst.mockResolvedValue(CLAIM({ status: 'SUBMITTED' }));
            await expect(service.reimburse('t1', 'claim-1', { via: 'DIRECT' }))
                .rejects.toThrow(BadRequestException);
        });
    });

    describe('attachments', () => {
        const file = (over: Record<string, any> = {}) => ({
            buffer: Buffer.from('x'), originalname: 'receipt.jpg',
            mimetype: 'image/jpeg', size: 1000, ...over,
        });

        it('uploads through uploadBuffer and stores the storage key', async () => {
            // The older uploadFile() path returns only a URL, which cannot be
            // turned back into a Cloudinary handle — a row deleted without a
            // key strands the file and bills forever.
            await service.addAttachment('t1', 'claim-1', 'emp-1', file(), 'user-1');

            expect(assets.uploadBuffer).toHaveBeenCalled();
            expect(db.expenseClaimAttachment.create.mock.calls[0][0].data.storage_key).toBe('pid');
        });

        it('sends a PDF through the raw pipeline', async () => {
            // The image pipeline rejects or mangles a PDF.
            await service.addAttachment('t1', 'claim-1', 'emp-1', file({
                mimetype: 'application/pdf', originalname: 'receipt.pdf',
            }));
            expect(assets.uploadBuffer.mock.calls[0][3]).toBe('raw');
        });

        it('refuses a type that is not a receipt', async () => {
            await expect(service.addAttachment('t1', 'claim-1', 'emp-1', file({
                mimetype: 'application/x-msdownload',
            }))).rejects.toThrow(BadRequestException);
        });

        it('refuses a file over the cap', async () => {
            await expect(service.addAttachment('t1', 'claim-1', 'emp-1', file({
                size: 6 * 1024 * 1024,
            }))).rejects.toThrow(BadRequestException);
        });

        it('refuses to attach to a decided claim', async () => {
            db.expenseClaim.findFirst.mockResolvedValue(CLAIM({ status: 'APPROVED' }));
            await expect(service.addAttachment('t1', 'claim-1', 'emp-1', file()))
                .rejects.toThrow(BadRequestException);
        });

        it('purges the stored file before the row', async () => {
            // A failure must leave a row pointing at a live file, not a live
            // file nobody can find.
            db.expenseClaimAttachment.findFirst.mockResolvedValue({
                id: 'att-1', storage_key: 'pid',
                claim: { id: 'claim-1', status: 'DRAFT', employee_id: 'emp-1' },
            });

            await service.removeAttachment('t1', 'att-1', 'emp-1');

            expect(assets.deleteFile).toHaveBeenCalledWith('pid');
            expect(db.expenseClaimAttachment.delete).toHaveBeenCalled();
        });

        it('refuses to remove another employee’s receipt', async () => {
            db.expenseClaimAttachment.findFirst.mockResolvedValue({
                id: 'att-1', storage_key: 'pid',
                claim: { id: 'claim-1', status: 'DRAFT', employee_id: 'emp-OTHER' },
            });
            await expect(service.removeAttachment('t1', 'att-1', 'emp-1'))
                .rejects.toThrow(ForbiddenException);
        });

        it('still deletes the row when the purge fails', async () => {
            // A Cloudinary outage must not make a receipt undeletable.
            db.expenseClaimAttachment.findFirst.mockResolvedValue({
                id: 'att-1', storage_key: 'pid',
                claim: { id: 'claim-1', status: 'DRAFT', employee_id: 'emp-1' },
            });
            assets.deleteFile.mockRejectedValue(new Error('cloudinary down'));

            await expect(service.removeAttachment('t1', 'att-1', 'emp-1')).resolves.toBeDefined();
            expect(db.expenseClaimAttachment.delete).toHaveBeenCalled();
        });
    });
});
