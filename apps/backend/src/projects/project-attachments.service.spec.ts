import { Test, TestingModule } from '@nestjs/testing';
import {
    BadRequestException,
    NotFoundException,
    ServiceUnavailableException,
} from '@nestjs/common';
import {
    ProjectAttachmentsService,
    attachmentStorageName,
    parseAttachmentUpload,
    resourceTypeFor,
} from './project-attachments.service';
import { AssetsService } from '../assets/assets.service';
import { ProjectAccessService } from './project-access.service';
import { OWNER, staff } from './project-access.test-support';
import { DatabaseService } from '../database/database.service';

const png = Buffer.from('a real enough png').toString('base64');

describe('parseAttachmentUpload', () => {
    it('accepts a bare base64 string with an explicit type', () => {
        const { mimeType, buffer } = parseAttachmentUpload(png, 'image/png');
        expect(mimeType).toBe('image/png');
        expect(buffer.byteLength).toBeGreaterThan(0);
    });

    // FileReader.readAsDataURL produces this form, and expecting every caller
    // to strip the prefix is how one of them forgets.
    it('accepts a data URL and reads the type out of it', () => {
        const { mimeType } = parseAttachmentUpload(`data:application/pdf;base64,${png}`);
        expect(mimeType).toBe('application/pdf');
    });

    it('refuses a type that is not on the list', () => {
        expect(() => parseAttachmentUpload(png, 'application/x-msdownload')).toThrow(
            BadRequestException,
        );
        expect(() => parseAttachmentUpload(`data:text/html;base64,${png}`)).toThrow(
            BadRequestException,
        );
    });

    it('refuses an empty payload', () => {
        expect(() => parseAttachmentUpload('')).toThrow(BadRequestException);
    });

    it('refuses a file over the size cap', () => {
        expect(() => parseAttachmentUpload('A'.repeat(8 * 1024 * 1024), 'image/png')).toThrow(
            BadRequestException,
        );
    });

    // Buffer.from never throws on junk — it returns fewer bytes — so an empty
    // result is the only signal the payload was not base64 at all.
    it('refuses a payload that decodes to nothing', () => {
        expect(() => parseAttachmentUpload('!!!!', 'image/png')).toThrow(BadRequestException);
    });
});

describe('resourceTypeFor', () => {
    // A PDF through Cloudinary's image pipeline is rejected or mangled.
    it('stores a PDF raw and everything else as an image', () => {
        expect(resourceTypeFor('application/pdf')).toBe('raw');
        expect(resourceTypeFor('image/png')).toBe('image');
        expect(resourceTypeFor('')).toBe('image');
    });
});

describe('attachmentStorageName', () => {
    it('gives two clipboard screenshots different files', () => {
        const a = attachmentStorageName('image.png', 'image/png');
        const b = attachmentStorageName('image.png', 'image/png');

        expect(a.publicId).not.toBe(b.publicId);
        expect(a.publicId).toMatch(/^image-[a-f0-9]{8}$/);
        // The shared name is how a second paste was listed as the first one.
        expect(a.fileName).toBe(`${a.publicId}.png`);
        expect(b.fileName).not.toBe('image.png');
    });

    it('keeps a chosen name and still stores a new id', () => {
        const named = attachmentStorageName('plan.png', 'image/png');

        expect(named.fileName).toBe('plan.png');
        expect(named.publicId).toMatch(/^plan-[a-f0-9]{8}$/);
    });

    it('strips a path out of the name', () => {
        const named = attachmentStorageName('../../etc/passwd.png', 'image/png');

        expect(named.publicId).toMatch(/^etc-passwd-[a-f0-9]{8}$/);
        expect(named.fileName).toBe('etc-passwd.png');
    });
});

describe('ProjectAttachmentsService', () => {
    let service: ProjectAttachmentsService;
    let db: any;
    let assets: { isEnabled: jest.Mock; uploadBuffer: jest.Mock; deleteFile: jest.Mock };

    beforeEach(async () => {
        assets = {
            isEnabled: jest.fn().mockReturnValue(true),
            uploadBuffer: jest.fn().mockResolvedValue({
                url: 'https://cdn/x.png',
                publicId: 'retail/tenant-1/project-tasks/x',
                bytes: 1234,
            }),
            deleteFile: jest.fn().mockResolvedValue(undefined),
        };

        db = {
            userStorePermission: { findFirst: jest.fn().mockResolvedValue(null) },
            projectTask: {
                findFirst: jest.fn().mockResolvedValue({ id: 'task-1', project_id: 'project-1' }),
            },
            projectAttachment: {
                findMany: jest.fn().mockResolvedValue([]),
                findFirst: jest.fn().mockResolvedValue({
                    id: 'att-1',
                    storage_key: 'retail/tenant-1/project-tasks/x',
                    mime_type: 'image/png',
                }),
                create: jest.fn().mockResolvedValue({ id: 'att-new' }),
                delete: jest.fn().mockResolvedValue({}),
            },
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ProjectAttachmentsService,
                ProjectAccessService,
                { provide: DatabaseService, useValue: db },
                { provide: AssetsService, useValue: assets },
            ],
        }).compile();

        service = module.get(ProjectAttachmentsService);
    });

    // The whole point of Phase 3D: uploadFile() returns only a URL, which cannot
    // be turned back into a public_id, so a row deleted that way strands its
    // file forever.
    it('stores the Cloudinary public_id so the file can be deleted later', async () => {
        await service.create(OWNER, 'task-1', {
            fileBase64: png,
            fileName: 'plan.png',
            mimeType: 'image/png',
        } as never);

        expect(db.projectAttachment.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    storage_key: 'retail/tenant-1/project-tasks/x',
                    task_id: 'task-1',
                    project_id: 'project-1',
                    tenant_id: 'tenant-1',
                }),
            }),
        );
    });

    it('uploads a PDF as a raw asset', async () => {
        await service.create(OWNER, 'task-1', {
            fileBase64: png,
            fileName: 'spec.pdf',
            mimeType: 'application/pdf',
        } as never);

        expect(assets.uploadBuffer).toHaveBeenCalledWith(
            expect.anything(),
            'tenant-1/project-tasks',
            expect.stringMatching(/^spec-[a-f0-9]{8}$/),
            'raw',
        );
    });

    it('stores a second image.png as its own file', async () => {
        await service.create(OWNER, 'task-1', {
            fileBase64: png,
            fileName: 'image.png',
            mimeType: 'image/png',
        } as never);
        await service.create(OWNER, 'task-1', {
            fileBase64: png,
            fileName: 'image.png',
            mimeType: 'image/png',
        } as never);

        const ids = assets.uploadBuffer.mock.calls.map((call) => call[2]);
        expect(ids[0]).toMatch(/^image-[a-f0-9]{8}$/);
        expect(ids[1]).toMatch(/^image-[a-f0-9]{8}$/);
        expect(ids[0]).not.toBe(ids[1]);

        const names = db.projectAttachment.create.mock.calls.map(
            (call: [{ data: { file_name: string } }]) => call[0].data.file_name,
        );
        expect(names[0]).not.toBe('image.png');
        expect(names[0]).not.toBe(names[1]);
    });

    it('sanitises the file name rather than trusting it', async () => {
        await service.create(OWNER, 'task-1', {
            fileBase64: png,
            fileName: '../../etc/passwd.png',
            mimeType: 'image/png',
        } as never);

        expect(assets.uploadBuffer).toHaveBeenCalledWith(
            expect.anything(),
            expect.any(String),
            expect.stringMatching(/^etc-passwd-[a-f0-9]{8}$/),
            'image',
        );
    });

    it('says storage is unconfigured rather than failing opaquely', async () => {
        assets.isEnabled.mockReturnValue(false);

        await expect(
            service.create(OWNER, 'task-1', {
                fileBase64: png,
                mimeType: 'image/png',
            } as never),
        ).rejects.toBeInstanceOf(ServiceUnavailableException);
        expect(db.projectAttachment.create).not.toHaveBeenCalled();
    });

    it('does not write a row when the upload fails', async () => {
        assets.uploadBuffer.mockRejectedValue(new Error('cloudinary down'));

        await expect(
            service.create(OWNER, 'task-1', {
                fileBase64: png,
                mimeType: 'image/png',
            } as never),
        ).rejects.toBeInstanceOf(ServiceUnavailableException);
        expect(db.projectAttachment.create).not.toHaveBeenCalled();
    });

    it('refuses a task from another tenant', async () => {
        db.projectTask.findFirst.mockResolvedValue(null);

        await expect(
            service.create(staff('user-9', 'tenant-2'), 'task-1', {
                fileBase64: png,
                mimeType: 'image/png',
            } as never),
        ).rejects.toBeInstanceOf(NotFoundException);
    });

    describe('remove', () => {
        it('purges the stored file, not just the row', async () => {
            await service.remove(OWNER, 'att-1');

            expect(db.projectAttachment.delete).toHaveBeenCalled();
            expect(assets.deleteFile).toHaveBeenCalledWith(
                'retail/tenant-1/project-tasks/x',
                'image',
            );
        });

        it('purges a PDF as raw, or Cloudinary deletes nothing', async () => {
            db.projectAttachment.findFirst.mockResolvedValue({
                id: 'att-1',
                storage_key: 'k',
                mime_type: 'application/pdf',
            });

            await service.remove(OWNER, 'att-1');

            expect(assets.deleteFile).toHaveBeenCalledWith('k', 'raw');
        });

        // A broken link in the UI is worse than a few bytes of orphaned storage,
        // so the row goes first.
        it('deletes the row before the asset', async () => {
            const order: string[] = [];
            db.projectAttachment.delete.mockImplementation(async () => order.push('row'));
            assets.deleteFile.mockImplementation(async () => order.push('asset'));

            await service.remove(OWNER, 'att-1');

            expect(order).toEqual(['row', 'asset']);
        });

        it('copes with a legacy row that has no storage key', async () => {
            db.projectAttachment.findFirst.mockResolvedValue({
                id: 'att-1',
                storage_key: null,
                mime_type: 'image/png',
            });

            await expect(service.remove(OWNER, 'att-1')).resolves.toEqual({ success: true });
            expect(assets.deleteFile).not.toHaveBeenCalled();
        });

        it('scopes the lookup to the tenant', async () => {
            await service.remove(OWNER, 'att-1');

            expect(db.projectAttachment.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ tenant_id: 'tenant-1' }),
                }),
            );
        });

        it('404s on an attachment that does not exist', async () => {
            db.projectAttachment.findFirst.mockResolvedValue(null);

            await expect(service.remove(OWNER, 'missing')).rejects.toBeInstanceOf(
                NotFoundException,
            );
        });
    });
});
