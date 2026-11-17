import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { NotesService, noteImageFolder, notePreview } from './notes.service';

const owner = { tenantId: 'tenant-1', userId: 'user-1' };

function setup() {
    const db = {
        note: {
            findMany: jest.fn().mockResolvedValue([]),
            findFirst: jest.fn(),
            create: jest.fn((args) => Promise.resolve({ id: 'n1', ...args.data })),
            update: jest.fn((args) => Promise.resolve({ id: args.where.id, ...args.data })),
            delete: jest.fn().mockResolvedValue({}),
        },
    };
    const assets = {
        isEnabled: jest.fn().mockReturnValue(true),
        uploadBuffer: jest.fn().mockResolvedValue({ url: 'https://res.cloudinary.com/x/image/upload/a.png', publicId: 'retail/tenant-1/notes/a' }),
    };
    const service = new NotesService(db as never, assets as never);
    return { db, assets, service };
}

describe('NotesService', () => {
    it('lists only the signed-in member’s notes in this workspace, pinned first', async () => {
        const { db, service } = setup();
        db.note.findMany.mockResolvedValue([
            { id: 'n1', title: 'Shop', pinned: true, content: '**Order** rice\n\n![pic](https://res.cloudinary.com/x/a.png)', created_at: new Date(), updated_at: new Date() },
        ]);

        const rows = await service.findAll(owner);

        const args = db.note.findMany.mock.calls[0][0];
        expect(args.where).toEqual({ tenant_id: 'tenant-1', user_id: 'user-1' });
        expect(args.orderBy).toEqual([{ pinned: 'desc' }, { updated_at: 'desc' }]);
        expect(rows[0]).toMatchObject({ id: 'n1', preview: 'Order rice', hasImages: true });
        expect(rows[0]).not.toHaveProperty('content');
    });

    it('searches title and body without widening the owner scope', async () => {
        const { db, service } = setup();
        await service.findAll(owner, { search: ' rice ' });
        const where = db.note.findMany.mock.calls[0][0].where;
        expect(where.user_id).toBe('user-1');
        expect(where.tenant_id).toBe('tenant-1');
        expect(where.OR).toEqual([
            { title: { contains: 'rice', mode: 'insensitive' } },
            { content: { contains: 'rice', mode: 'insensitive' } },
        ]);
    });

    it('reports another member’s note as not found, and never edits or deletes it', async () => {
        const { db, service } = setup();
        db.note.findFirst.mockResolvedValue(null);

        await expect(service.findOne(owner, 'theirs')).rejects.toBeInstanceOf(NotFoundException);
        await expect(service.update(owner, 'theirs', { title: 'x' })).rejects.toBeInstanceOf(NotFoundException);
        await expect(service.remove(owner, 'theirs')).rejects.toBeInstanceOf(NotFoundException);

        expect(db.note.findFirst).toHaveBeenCalledWith({ where: { id: 'theirs', tenant_id: 'tenant-1', user_id: 'user-1' } });
        expect(db.note.update).not.toHaveBeenCalled();
        expect(db.note.delete).not.toHaveBeenCalled();
    });

    it('creates the note for the signed-in member, whatever the body says', async () => {
        const { db, service } = setup();
        await service.create(owner, { title: 'Ideas', content: 'Hello', ...({ user_id: 'someone-else' } as object) });
        expect(db.note.create).toHaveBeenCalledWith({
            data: { tenant_id: 'tenant-1', user_id: 'user-1', title: 'Ideas', content: 'Hello', pinned: false },
        });
    });

    it('changes only the fields it was sent', async () => {
        const { db, service } = setup();
        db.note.findFirst.mockResolvedValue({ id: 'n1' });
        await service.update(owner, 'n1', { pinned: true });
        expect(db.note.update).toHaveBeenCalledWith({ where: { id: 'n1' }, data: { pinned: true } });
    });

    it('keeps a picture in the tenant’s notes folder', async () => {
        const { assets, service } = setup();
        const png = Buffer.from('fake-png').toString('base64');

        const result = await service.uploadImage(owner, { imageBase64: `data:image/png;base64,${png}`, fileName: 'My screenshot.png' });

        expect(assets.uploadBuffer).toHaveBeenCalledWith(expect.any(Buffer), 'tenant-1/notes', 'My-screenshot', 'image');
        expect(result).toEqual({ url: 'https://res.cloudinary.com/x/image/upload/a.png', storageKey: 'retail/tenant-1/notes/a' });
        expect(noteImageFolder('t')).toBe('t/notes');
    });

    it('says so when file storage is not configured', async () => {
        const { assets, service } = setup();
        assets.isEnabled.mockReturnValue(false);
        await expect(
            service.uploadImage(owner, { imageBase64: Buffer.from('x').toString('base64'), mimeType: 'image/png' }),
        ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
});

describe('notePreview', () => {
    it('drops pictures, link targets and markdown syntax', () => {
        expect(notePreview('# Title\n\n- **one**\n- [two](https://a.b)\n\n![x](https://c.d/e.png) `code`')).toBe(
            'Title one two code',
        );
    });
});
