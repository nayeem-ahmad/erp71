import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BusinessDocumentsService, parseDocumentUpload } from './business-documents.service';
import { BusinessDocumentsScheduler, daysUntil, isDocumentReminderDay } from './business-documents.scheduler';

const PDF = Buffer.from('%PDF-1.4 test').toString('base64');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]).toString('base64');

function setup() {
    const db = {
        businessDocument: {
            findMany: jest.fn().mockResolvedValue([]),
            findFirst: jest.fn(),
            create: jest.fn((args) => Promise.resolve({ id: 'd1', ...args.data })),
            update: jest.fn((args) => Promise.resolve({ id: args.where.id, issue_date: null, expiry_date: null, ...args.data })),
            delete: jest.fn().mockResolvedValue({}),
        },
        notification: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const assets = {
        isEnabled: jest.fn().mockReturnValue(true),
        uploadBuffer: jest.fn().mockResolvedValue({ url: 'https://res.cloudinary.com/x/raw/upload/a.pdf', publicId: 'retail/t/business-documents/a.pdf', bytes: 13 }),
        deleteFile: jest.fn().mockResolvedValue(undefined),
    };
    return { db, assets, service: new BusinessDocumentsService(db as never, assets as never) };
}

describe('parseDocumentUpload', () => {
    it('accepts a PDF and a PNG that are what they say', () => {
        expect(parseDocumentUpload(`data:application/pdf;base64,${PDF}`).mimeType).toBe('application/pdf');
        expect(parseDocumentUpload(PNG, 'image/png').mimeType).toBe('image/png');
    });

    it('refuses a file whose bytes do not match its label', () => {
        expect(() => parseDocumentUpload(PNG, 'application/pdf')).toThrow(BadRequestException);
    });

    it('refuses other types', () => {
        expect(() => parseDocumentUpload(PDF, 'application/zip')).toThrow(BadRequestException);
    });
});

describe('BusinessDocumentsService', () => {
    it('stores dates as calendar days and never returns the storage key', async () => {
        const { db, service } = setup();
        const row = await service.create('tenant-1', 'user-1', {
            docType: 'TRADE_LICENSE', title: 'Trade licence', expiryDate: '2027-06-30',
        });
        expect(db.businessDocument.create.mock.calls[0][0].data).toMatchObject({ tenant_id: 'tenant-1', remind_days_before: 30, created_by: 'user-1' });
        expect(row.expiry_date).toBe('2027-06-30');
        expect(row).not.toHaveProperty('storage_key');
    });

    it('uploads a PDF raw, keeps its key, and destroys the file it replaced', async () => {
        const { db, assets, service } = setup();
        db.businessDocument.findFirst.mockResolvedValue({ id: 'd1', title: 'Trade licence', storage_key: 'old-key', storage_type: 'image' });
        await service.uploadFile('tenant-1', 'd1', { fileBase64: PDF, mimeType: 'application/pdf', fileName: 'licence.pdf' });
        expect(assets.uploadBuffer).toHaveBeenCalledWith(expect.any(Buffer), 'tenant-1/business-documents', 'licence.pdf', 'raw');
        expect(db.businessDocument.update.mock.calls[0][0].data).toMatchObject({ storage_key: 'retail/t/business-documents/a.pdf', storage_type: 'raw' });
        expect(assets.deleteFile).toHaveBeenCalledWith('old-key', 'image');
    });

    it('answers another workspace’s document as not found', async () => {
        const { db, service } = setup();
        db.businessDocument.findFirst.mockResolvedValue(null);
        await expect(service.remove('tenant-1', 'x')).rejects.toBeInstanceOf(NotFoundException);
    });
});

describe('BusinessDocumentsScheduler', () => {
    it('fires on the lead time, a week, a day and the day itself', () => {
        expect([30, 7, 1, 0].every((d) => isDocumentReminderDay(d, 30))).toBe(true);
        expect([29, 8, 2, -1].some((d) => isDocumentReminderDay(d, 30))).toBe(false);
        expect(daysUntil(new Date('2026-11-29T00:00:00Z'), '2026-11-22')).toBe(7);
    });

    it('notifies the owner and the person who added it, once', async () => {
        const { db } = setup();
        db.businessDocument.findMany.mockResolvedValue([
            { id: 'd1', tenant_id: 't', title: 'Fire licence', number: 'F-1', expiry_date: new Date('2026-11-29T00:00:00Z'), remind_days_before: 30, created_by: 'u1', tenant: { owner_id: 'o1' } },
            { id: 'd2', tenant_id: 't', title: 'IRC', number: null, expiry_date: new Date('2026-12-20T00:00:00Z'), remind_days_before: 30, created_by: 'u1', tenant: { owner_id: 'o1' } },
        ]);
        const notifications = { create: jest.fn().mockResolvedValue({}) };
        const scheduler = new BusinessDocumentsScheduler(db as never, notifications as never, { track: jest.fn() } as never);
        const result = await scheduler.run(new Date('2026-11-22T03:00:00Z'));
        expect(result.sent).toBe(2);
        expect(notifications.create.mock.calls[0][3]).toBe('Fire licence expires in 7 days');
    });
});
