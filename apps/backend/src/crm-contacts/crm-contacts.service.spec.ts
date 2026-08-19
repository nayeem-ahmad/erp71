import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { CrmContactsService } from './crm-contacts.service';
import { DatabaseService } from '../database/database.service';
import { AiService } from '../ai/ai.service';
import { AssetsService } from '../assets/assets.service';
import { CrmPhotosService } from '../crm-photos/crm-photos.service';
import { ContactBulkAction, CrmContactCaptureSource } from './crm-contacts.dto';

describe('CrmContactsService', () => {
    let service: CrmContactsService;
    let db: any;
    let ai: any;
    let assets: any;

    const TENANT = 'tenant-1';
    const USER = 'user-1';

    beforeEach(async () => {
        db = {
            crmContact: {
                findUnique: jest.fn().mockResolvedValue(null),
                findFirst: jest.fn(),
                findMany: jest.fn().mockResolvedValue([]),
                count: jest.fn().mockResolvedValue(0),
                create: jest.fn().mockImplementation(({ data }: any) => ({ id: 'contact-1', ...data })),
                update: jest.fn().mockImplementation(({ data }: any) => ({ id: 'contact-1', ...data })),
                delete: jest.fn().mockResolvedValue({}),
                deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
                updateMany: jest.fn().mockResolvedValue({ count: 2 }),
            },
            crmContactAttachment: {
                findFirst: jest.fn(),
                findMany: jest.fn().mockResolvedValue([]),
                create: jest.fn().mockImplementation(({ data }: any) => ({ id: 'attachment-1', ...data })),
                delete: jest.fn().mockResolvedValue({}),
            },
        };
        ai = { scanBusinessCard: jest.fn() };
        assets = {
            isEnabled: jest.fn().mockReturnValue(true),
            uploadBuffer: jest.fn().mockResolvedValue({
                url: 'https://cdn.example/card.jpg',
                publicId: 'retail/tenant-1/contact-cards/card',
                bytes: 4,
            }),
            deleteFile: jest.fn().mockResolvedValue(undefined),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CrmContactsService,
                { provide: DatabaseService, useValue: db },
                { provide: AiService, useValue: ai },
                { provide: AssetsService, useValue: assets },
                { provide: CrmPhotosService, useValue: new CrmPhotosService(assets as any) },
            ],
        }).compile();

        service = module.get<CrmContactsService>(CrmContactsService);
    });

    describe('create', () => {
        it('trims the name and stores the contact against the tenant and creator', async () => {
            await service.create(TENANT, USER, { name: '  Rafiq Islam  ', company: ' Karim Traders ' });

            expect(db.crmContact.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        tenant_id: TENANT,
                        name: 'Rafiq Islam',
                        company: 'Karim Traders',
                        created_by: USER,
                        capture_source: CrmContactCaptureSource.MANUAL,
                    }),
                }),
            );
        });

        it('stores a blank owner as null — an empty string would break the FK', async () => {
            await service.create(TENANT, USER, { name: 'Unowned', assigned_to: '' });

            expect(db.crmContact.create).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ assigned_to: null }) }),
            );
        });

        it('rejects a name that is only whitespace', async () => {
            await expect(service.create(TENANT, USER, { name: '   ' })).rejects.toBeInstanceOf(
                BadRequestException,
            );
            expect(db.crmContact.create).not.toHaveBeenCalled();
        });

        // Two contacts without a phone number must both be storable; the unique
        // index only tolerates that because the blank arrives as NULL.
        it('stores a blank mobile as null rather than an empty string', async () => {
            await service.create(TENANT, USER, { name: 'No Phone', mobile: '   ' });

            expect(db.crmContact.create).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ mobile: null }) }),
            );
            expect(db.crmContact.findUnique).not.toHaveBeenCalled();
        });

        it('rejects a mobile already used by another contact in the tenant', async () => {
            db.crmContact.findUnique.mockResolvedValue({ id: 'contact-9' });

            await expect(
                service.create(TENANT, USER, { name: 'Duplicate', mobile: '01711223344' }),
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(db.crmContact.create).not.toHaveBeenCalled();
        });

        it('records a scanned card as BUSINESS_CARD when the client says so', async () => {
            await service.create(TENANT, USER, {
                name: 'Scanned Person',
                capture_source: CrmContactCaptureSource.BUSINESS_CARD,
            });

            expect(db.crmContact.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ capture_source: CrmContactCaptureSource.BUSINESS_CARD }),
                }),
            );
        });
    });

    describe('findAll', () => {
        it('searches name, company, designation, and every contact channel', async () => {
            await service.findAll(TENANT, { search: 'karim' });

            const where = db.crmContact.findMany.mock.calls[0][0].where;
            expect(where.tenant_id).toBe(TENANT);
            expect(where.OR.map((clause: Record<string, unknown>) => Object.keys(clause)[0])).toEqual([
                'name',
                'company',
                'designation',
                'mobile',
                'phone',
                'email',
                'notes',
            ]);
        });

        it('caps the page size at 100 however large a limit is asked for', async () => {
            await service.findAll(TENANT, { limit: 5000 });
            expect(db.crmContact.findMany.mock.calls[0][0].take).toBe(100);
        });

        it('falls back to name order for an unknown sort key', async () => {
            await service.findAll(TENANT, { sortBy: 'DROP TABLE', sortDir: 'desc' });
            expect(db.crmContact.findMany.mock.calls[0][0].orderBy).toEqual([{ name: 'asc' }]);
        });

        it('filters created_at to the inclusive Dhaka day range', async () => {
            await service.findAll(TENANT, { createdFrom: '2026-08-19', createdTo: '2026-08-19' });
            expect(db.crmContact.findMany.mock.calls[0][0].where.created_at).toEqual({
                gte: new Date('2026-08-18T18:00:00.000Z'),
                lte: new Date('2026-08-19T17:59:59.999Z'),
            });
        });
    });

    describe('update', () => {
        it('404s for a contact belonging to another tenant', async () => {
            db.crmContact.findFirst.mockResolvedValue(null);

            await expect(service.update(TENANT, 'contact-1', { name: 'X' })).rejects.toBeInstanceOf(
                NotFoundException,
            );
        });

        // The scanner can put a wrong owner or a misread email on a contact, so
        // both have to be removable — not merely replaceable.
        it('clears the owner when the patch sends it empty', async () => {
            db.crmContact.findFirst.mockResolvedValue({ id: 'contact-1' });

            await service.update(TENANT, 'contact-1', { assigned_to: '' });

            expect(db.crmContact.update.mock.calls[0][0].data).toEqual({ assigned_to: null });
        });

        it('clears the email when the patch sends it empty', async () => {
            db.crmContact.findFirst.mockResolvedValue({ id: 'contact-1' });

            await service.update(TENANT, 'contact-1', { email: '' });

            expect(db.crmContact.update.mock.calls[0][0].data).toEqual({ email: null });
        });

        it('leaves untouched fields out of the update payload', async () => {
            db.crmContact.findFirst.mockResolvedValue({ id: 'contact-1' });

            await service.update(TENANT, 'contact-1', { email: 'new@example.com' });

            expect(db.crmContact.update.mock.calls[0][0].data).toEqual({ email: 'new@example.com' });
        });

        it('clears a field when the patch sends it empty', async () => {
            db.crmContact.findFirst.mockResolvedValue({ id: 'contact-1' });

            await service.update(TENANT, 'contact-1', { company: '' });

            expect(db.crmContact.update.mock.calls[0][0].data).toEqual({ company: null });
        });

        // The contact keeping its own number must not collide with itself.
        it('allows a contact to keep its existing mobile', async () => {
            db.crmContact.findFirst.mockResolvedValue({ id: 'contact-1' });
            db.crmContact.findUnique.mockResolvedValue({ id: 'contact-1' });

            await expect(
                service.update(TENANT, 'contact-1', { mobile: '01711223344' }),
            ).resolves.toBeDefined();
        });

        it('rejects a mobile that belongs to a different contact', async () => {
            db.crmContact.findFirst.mockResolvedValue({ id: 'contact-1' });
            db.crmContact.findUnique.mockResolvedValue({ id: 'contact-2' });

            await expect(
                service.update(TENANT, 'contact-1', { mobile: '01711223344' }),
            ).rejects.toBeInstanceOf(BadRequestException);
        });
    });

    describe('remove', () => {
        it('404s rather than deleting across tenants', async () => {
            db.crmContact.findFirst.mockResolvedValue(null);

            await expect(service.remove(TENANT, 'contact-1')).rejects.toBeInstanceOf(NotFoundException);
            expect(db.crmContact.delete).not.toHaveBeenCalled();
        });

        // The rows go with the contact via onDelete: Cascade, but Cloudinary
        // knows nothing about that — without this every deleted contact is
        // billed for its card forever.
        it('drops the stored card files before deleting the contact', async () => {
            db.crmContact.findFirst.mockResolvedValue({ id: 'contact-1' });
            db.crmContactAttachment.findMany.mockResolvedValue([
                { storage_key: 'retail/t/contact-cards/a' },
                { storage_key: null },
                { storage_key: 'retail/t/contact-cards/b' },
            ]);

            await service.remove(TENANT, 'contact-1');

            expect(assets.deleteFile).toHaveBeenCalledWith('retail/t/contact-cards/a');
            expect(assets.deleteFile).toHaveBeenCalledWith('retail/t/contact-cards/b');
            // A row that never got a storage key must not become a `deleteFile(null)`.
            expect(assets.deleteFile).toHaveBeenCalledTimes(2);
            expect(db.crmContact.delete).toHaveBeenCalled();
        });
    });

    describe('attachments', () => {
        const CARD = { imageBase64: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' };

        beforeEach(() => {
            db.crmContact.findFirst.mockResolvedValue({ id: 'contact-1' });
        });

        it('uploads the card and records it against the contact', async () => {
            const created = await service.addAttachment(TENANT, USER, 'contact-1', CARD);

            const [buffer, folder] = assets.uploadBuffer.mock.calls[0];
            expect(Buffer.isBuffer(buffer)).toBe(true);
            expect(folder).toBe(`${TENANT}/contact-cards`);
            expect(created).toMatchObject({
                tenant_id: TENANT,
                contact_id: 'contact-1',
                file_url: 'https://cdn.example/card.jpg',
                storage_key: 'retail/tenant-1/contact-cards/card',
                mime_type: 'image/jpeg',
                kind: 'BUSINESS_CARD',
                created_by: USER,
            });
        });

        it('refuses a contact belonging to another tenant without uploading anything', async () => {
            db.crmContact.findFirst.mockResolvedValue(null);

            await expect(
                service.addAttachment(TENANT, USER, 'contact-1', CARD),
            ).rejects.toBeInstanceOf(NotFoundException);
            expect(assets.uploadBuffer).not.toHaveBeenCalled();
        });

        it('rejects a payload that is not an image we can store', async () => {
            await expect(
                service.addAttachment(TENANT, USER, 'contact-1', {
                    imageBase64: 'data:application/pdf;base64,JVBERi0=',
                }),
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(assets.uploadBuffer).not.toHaveBeenCalled();
        });

        // A configuration problem must not read as a transient upload blip.
        it('reports storage being unconfigured rather than failing opaquely', async () => {
            assets.isEnabled.mockReturnValue(false);

            await expect(
                service.addAttachment(TENANT, USER, 'contact-1', CARD),
            ).rejects.toBeInstanceOf(ServiceUnavailableException);
            expect(db.crmContactAttachment.create).not.toHaveBeenCalled();
        });

        // No row may be written pointing at a file that is not there.
        it('writes no row when the upload itself fails', async () => {
            assets.uploadBuffer.mockRejectedValue(new Error('cloudinary down'));

            await expect(
                service.addAttachment(TENANT, USER, 'contact-1', CARD),
            ).rejects.toBeInstanceOf(ServiceUnavailableException);
            expect(db.crmContactAttachment.create).not.toHaveBeenCalled();
        });

        it('removes the stored file along with the row', async () => {
            db.crmContactAttachment.findFirst.mockResolvedValue({
                id: 'attachment-1',
                storage_key: 'retail/t/contact-cards/a',
            });

            await service.removeAttachment(TENANT, 'contact-1', 'attachment-1');

            expect(db.crmContactAttachment.delete).toHaveBeenCalledWith({ where: { id: 'attachment-1' } });
            expect(assets.deleteFile).toHaveBeenCalledWith('retail/t/contact-cards/a');
        });

        it('404s on an attachment that belongs to another contact', async () => {
            db.crmContactAttachment.findFirst.mockResolvedValue(null);

            await expect(
                service.removeAttachment(TENANT, 'contact-1', 'attachment-1'),
            ).rejects.toBeInstanceOf(NotFoundException);
            expect(db.crmContactAttachment.delete).not.toHaveBeenCalled();
        });
    });

    describe('bulkAction', () => {
        it('scopes a bulk delete to the tenant', async () => {
            const result = await service.bulkAction(TENANT, {
                ids: ['a', 'b'],
                action: ContactBulkAction.DELETE,
            });

            expect(db.crmContact.deleteMany).toHaveBeenCalledWith({
                where: { tenant_id: TENANT, id: { in: ['a', 'b'] } },
            });
            expect(result).toEqual({ count: 2 });
        });

        it('treats a blank assignee as unassign', async () => {
            await service.bulkAction(TENANT, {
                ids: ['a'],
                action: ContactBulkAction.ASSIGN,
                value: '  ',
            });

            expect(db.crmContact.updateMany.mock.calls[0][0].data).toEqual({ assigned_to: null });
        });
    });

    describe('scanBusinessCard', () => {
        it('returns the extracted fields tagged as a card capture, without saving', async () => {
            ai.scanBusinessCard.mockResolvedValue({ name: 'Rafiq Islam', mobile: '01711223344' });

            const result = await service.scanBusinessCard(TENANT, { imageBase64: 'abc' });

            expect(result).toEqual({
                fields: { name: 'Rafiq Islam', mobile: '01711223344' },
                capture_source: CrmContactCaptureSource.BUSINESS_CARD,
            });
            expect(db.crmContact.create).not.toHaveBeenCalled();
        });

        it('reports an unreadable image instead of handing back an empty form', async () => {
            ai.scanBusinessCard.mockResolvedValue({});

            await expect(service.scanBusinessCard(TENANT, { imageBase64: 'abc' })).rejects.toBeInstanceOf(
                BadRequestException,
            );
        });
    });

    describe('importRows', () => {
        it('creates rows and marks their origin as IMPORT', async () => {
            const result = await service.importRows(
                TENANT,
                [{ name: 'Rafiq Islam', company: 'Karim Traders', mobile: '01711223344' }],
                'skip',
            );

            expect(result.created).toBe(1);
            expect(db.crmContact.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    name: 'Rafiq Islam',
                    company: 'Karim Traders',
                    mobile: '01711223344',
                    capture_source: CrmContactCaptureSource.IMPORT,
                }),
            });
        });

        it('skips a duplicate mobile in skip mode', async () => {
            db.crmContact.findUnique.mockResolvedValue({ id: 'contact-1' });

            const result = await service.importRows(TENANT, [{ name: 'Dup', mobile: '01711223344' }], 'skip');

            expect(result).toMatchObject({ created: 0, skipped: 1 });
            expect(db.crmContact.create).not.toHaveBeenCalled();
        });

        it('does not blank out existing columns when an upserted row leaves them empty', async () => {
            db.crmContact.findUnique.mockResolvedValue({ id: 'contact-1' });

            await service.importRows(
                TENANT,
                [{ name: 'Rafiq Islam', mobile: '01711223344', email: 'rafiq@example.com', company: '' }],
                'upsert',
            );

            expect(db.crmContact.update.mock.calls[0][0].data).toEqual({
                name: 'Rafiq Islam',
                mobile: '01711223344',
                email: 'rafiq@example.com',
            });
        });

        it('reports a row with no name instead of creating a nameless contact', async () => {
            const result = await service.importRows(TENANT, [{ company: 'Karim Traders' }], 'skip');

            expect(result.created).toBe(0);
            expect(result.errors[0]).toContain('name');
        });
    });

    describe('photos', () => {
        const KEY = 'retail/tenant-1/crm-photos/rahim';
        const OTHER_KEY = 'retail/tenant-1/crm-photos/newer';

        it('stores the photo url and key on create', async () => {
            const created = await service.create(TENANT, USER, {
                name: 'Rahim',
                photo_url: 'https://cdn.example/rahim.jpg',
                photo_storage_key: KEY,
            } as any);

            expect(created.photo_url).toBe('https://cdn.example/rahim.jpg');
            expect(created.photo_storage_key).toBe(KEY);
        });

        it("refuses a storage key from another tenant's folder", async () => {
            await expect(
                service.create(TENANT, USER, {
                    name: 'Rahim',
                    photo_url: 'https://cdn.example/rahim.jpg',
                    photo_storage_key: 'retail/tenant-2/crm-photos/rahim',
                } as any),
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(db.crmContact.create).not.toHaveBeenCalled();
        });

        it('deletes the previous asset when the photo is replaced', async () => {
            db.crmContact.findFirst.mockResolvedValue({ id: 'contact-1', photo_storage_key: KEY });

            await service.update(TENANT, 'contact-1', {
                photo_url: 'https://cdn.example/newer.jpg',
                photo_storage_key: OTHER_KEY,
            } as any);

            expect(assets.deleteFile).toHaveBeenCalledWith(KEY);
        });

        it('deletes the previous asset when the photo is cleared', async () => {
            db.crmContact.findFirst.mockResolvedValue({ id: 'contact-1', photo_storage_key: KEY });

            const updated = await service.update(TENANT, 'contact-1', {
                photo_url: '',
                photo_storage_key: '',
            } as any);

            expect(updated.photo_url).toBeNull();
            expect(updated.photo_storage_key).toBeNull();
            expect(assets.deleteFile).toHaveBeenCalledWith(KEY);
        });

        it('deletes nothing when an update does not touch the photo', async () => {
            db.crmContact.findFirst.mockResolvedValue({ id: 'contact-1', photo_storage_key: KEY });

            await service.update(TENANT, 'contact-1', { name: 'Rahim Uddin' } as any);

            expect(assets.deleteFile).not.toHaveBeenCalled();
        });

        it('deletes nothing when the same photo is sent back unchanged', async () => {
            db.crmContact.findFirst.mockResolvedValue({ id: 'contact-1', photo_storage_key: KEY });

            await service.update(TENANT, 'contact-1', {
                photo_url: 'https://cdn.example/rahim.jpg',
                photo_storage_key: KEY,
            } as any);

            expect(assets.deleteFile).not.toHaveBeenCalled();
        });

        it('reclaims the photo when the contact is deleted', async () => {
            db.crmContact.findFirst.mockResolvedValue({ id: 'contact-1' });
            db.crmContact.findMany.mockResolvedValue([{ photo_storage_key: KEY }]);

            await service.remove(TENANT, 'contact-1');

            expect(assets.deleteFile).toHaveBeenCalledWith(KEY);
        });

        it('reclaims photos on a bulk delete', async () => {
            db.crmContact.findMany.mockResolvedValue([
                { photo_storage_key: KEY },
                { photo_storage_key: OTHER_KEY },
            ]);

            await service.bulkAction(TENANT, {
                ids: ['contact-1', 'contact-2'],
                action: ContactBulkAction.DELETE,
            } as any);

            expect(assets.deleteFile).toHaveBeenCalledWith(KEY);
            expect(assets.deleteFile).toHaveBeenCalledWith(OTHER_KEY);
        });
    });
});
