import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BlogService, pickTranslation } from './blog.service';

/**
 * The expensive mistakes in this module are all reads: serving a draft to the
 * public, serving an in-app release note on the marketing site, or 404ing a
 * post that was merely renamed. Those get the most attention below, followed by
 * the two write rules that are easy to regress — `published_at` set once, and
 * no publish without English copy.
 */
describe('BlogService', () => {
    const db = {
        blogPost: {
            findMany: jest.fn(),
            findFirst: jest.fn(),
            count: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn(),
        },
        blogPostSlug: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), upsert: jest.fn() },
        blogPostTranslation: { deleteMany: jest.fn() },
        blogCategory: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
        user: { findUnique: jest.fn(), update: jest.fn() },
        $transaction: jest.fn(),
    } as any;

    const assets = {
        isEnabled: jest.fn().mockReturnValue(true),
        uploadBuffer: jest.fn(),
        deleteFile: jest.fn().mockResolvedValue(undefined),
    } as any;

    let service: BlogService;

    beforeEach(() => {
        jest.clearAllMocks();
        assets.isEnabled.mockReturnValue(true);
        assets.deleteFile.mockResolvedValue(undefined);
        db.blogPost.findMany.mockResolvedValue([]);
        db.blogPost.count.mockResolvedValue(0);
        db.blogPostSlug.findMany.mockResolvedValue([]);
        db.$transaction.mockImplementation((fn: any) => (typeof fn === 'function' ? fn(db) : Promise.all(fn)));
        service = new BlogService(db, assets);
    });

    const translation = (overrides: Record<string, unknown> = {}) => ({
        locale: 'en',
        title: 'Cutting stock loss',
        excerpt: 'A short intro',
        body_md: 'Body text here',
        seo_title: null,
        seo_description: null,
        ...overrides,
    });

    const post = (overrides: Record<string, unknown> = {}) => ({
        id: 'post-1',
        slug: 'cutting-stock-loss',
        status: 'PUBLISHED',
        audience: 'BOTH',
        cover_image_url: null,
        cover_storage_key: null,
        cover_alt: null,
        author_name: 'Nayeem',
        author_title: 'Founder',
        published_at: new Date('2026-08-01'),
        edited_at: null,
        reading_minutes: 4,
        featured: false,
        view_count: 0,
        category: null,
        category_id: null,
        translations: [translation()],
        ...overrides,
    });

    describe('public visibility', () => {
        it('serves only published, dated, public-audience posts', async () => {
            await service.listPublic({ surface: 'public' });

            const where = db.blogPost.findMany.mock.calls[0][0].where;
            expect(where).toMatchObject({
                deleted_at: null,
                status: 'PUBLISHED',
                audience: { in: ['PUBLIC', 'BOTH'] },
            });
            expect(where.published_at.not).toBeNull();
            expect(where.published_at.lte).toBeInstanceOf(Date);
        });

        it('does not offer in-app-only posts to the public surface', async () => {
            await service.listPublic({ surface: 'public' });
            expect(db.blogPost.findMany.mock.calls[0][0].where.audience.in).not.toContain('IN_APP');
        });

        it('does not offer public-only posts to the in-app feed', async () => {
            await service.listPublic({ surface: 'in_app' });
            expect(db.blogPost.findMany.mock.calls[0][0].where.audience.in).toEqual(['IN_APP', 'BOTH']);
        });

        it('applies the same filter to the detail read as to the list', async () => {
            db.blogPost.findFirst.mockResolvedValue(post());
            await service.getPublicBySlug('cutting-stock-loss', { surface: 'public' });

            expect(db.blogPost.findFirst.mock.calls[0][0].where).toMatchObject({
                slug: 'cutting-stock-loss',
                status: 'PUBLISHED',
                deleted_at: null,
                audience: { in: ['PUBLIC', 'BOTH'] },
            });
        });

        it('caps the page size so a public caller cannot ask for the whole table', async () => {
            await service.listPublic({ surface: 'public', limit: 5000 });
            expect(db.blogPost.findMany.mock.calls[0][0].take).toBe(50);
        });

        it('counts a view only against a visible post', async () => {
            await service.recordView('cutting-stock-loss');
            expect(db.blogPost.updateMany.mock.calls[0][0].where).toMatchObject({
                slug: 'cutting-stock-loss',
                status: 'PUBLISHED',
            });
        });
    });

    describe('renamed slugs', () => {
        it('redirects to the current slug instead of 404ing', async () => {
            db.blogPost.findFirst.mockResolvedValue(null);
            db.blogPostSlug.findUnique.mockResolvedValue({
                slug: 'old-name',
                post: { slug: 'new-name', status: 'PUBLISHED', deleted_at: null, audience: 'BOTH' },
            });

            await expect(service.getPublicBySlug('old-name', { surface: 'public' })).resolves.toEqual({
                post: null,
                redirect_to: 'new-name',
            });
        });

        it('does not redirect to a post that has since been unpublished', async () => {
            db.blogPost.findFirst.mockResolvedValue(null);
            db.blogPostSlug.findUnique.mockResolvedValue({
                slug: 'old-name',
                post: { slug: 'new-name', status: 'DRAFT', deleted_at: null, audience: 'BOTH' },
            });

            await expect(service.getPublicBySlug('old-name', { surface: 'public' })).rejects.toBeInstanceOf(
                NotFoundException,
            );
        });

        it('does not redirect a public reader to an in-app-only post', async () => {
            db.blogPost.findFirst.mockResolvedValue(null);
            db.blogPostSlug.findUnique.mockResolvedValue({
                slug: 'old-name',
                post: { slug: 'new-name', status: 'PUBLISHED', deleted_at: null, audience: 'IN_APP' },
            });

            await expect(service.getPublicBySlug('old-name', { surface: 'public' })).rejects.toBeInstanceOf(
                NotFoundException,
            );
        });

        it('keeps the old slug claimed on rename so nothing else can take it', async () => {
            db.blogPost.findFirst.mockResolvedValue(post({ status: 'DRAFT' }));
            db.blogPost.update.mockResolvedValue(post());

            await service.update('post-1', {
                slug: 'a-better-title',
                translations: [translation()],
            } as any);

            expect(db.blogPostSlug.upsert).toHaveBeenCalledWith(
                expect.objectContaining({ where: { slug: 'a-better-title' } }),
            );
        });
    });

    describe('publishing', () => {
        it('refuses a post with no English copy', async () => {
            db.blogPost.findFirst.mockResolvedValue(
                post({ status: 'DRAFT', translations: [translation({ locale: 'bn' })] }),
            );

            await expect(service.publish('post-1')).rejects.toBeInstanceOf(BadRequestException);
            expect(db.blogPost.update).not.toHaveBeenCalled();
        });

        it('refuses a post whose English body is blank', async () => {
            db.blogPost.findFirst.mockResolvedValue(
                post({ status: 'DRAFT', translations: [translation({ body_md: '   ' })] }),
            );

            await expect(service.publish('post-1')).rejects.toBeInstanceOf(BadRequestException);
        });

        it('sets published_at on first publish', async () => {
            db.blogPost.findFirst.mockResolvedValue(post({ status: 'DRAFT', published_at: null }));
            db.blogPost.update.mockResolvedValue(post());

            await service.publish('post-1');
            expect(db.blogPost.update.mock.calls[0][0].data.published_at).toBeInstanceOf(Date);
        });

        it('keeps the original published_at when a post is re-published', async () => {
            // Otherwise correcting a typo on a year-old article pushes it back
            // to the top of the index as if it were new.
            const original = new Date('2026-01-01');
            db.blogPost.findFirst.mockResolvedValue(post({ status: 'DRAFT', published_at: original }));
            db.blogPost.update.mockResolvedValue(post());

            await service.publish('post-1');
            expect(db.blogPost.update.mock.calls[0][0].data.published_at).toBe(original);
        });

        it('refuses to publish straight out of the archive', async () => {
            db.blogPost.findFirst.mockResolvedValue(post({ status: 'ARCHIVED' }));
            await expect(service.publish('post-1')).rejects.toBeInstanceOf(BadRequestException);
        });
    });

    describe('scheduled publishing', () => {
        it('publishes due posts and dates them from their scheduled time', async () => {
            const scheduledFor = new Date('2026-08-01T09:00:00Z');
            db.blogPost.findMany.mockResolvedValue([{ id: 'post-1', published_at: null, scheduled_for: scheduledFor }]);
            db.blogPost.update.mockResolvedValue({});

            await expect(service.publishDueScheduledPosts()).resolves.toBe(1);
            expect(db.blogPost.update.mock.calls[0][0].data).toMatchObject({
                status: 'PUBLISHED',
                published_at: scheduledFor,
                scheduled_for: null,
            });
        });

        it('only looks at scheduled posts whose time has passed', async () => {
            await service.publishDueScheduledPosts();
            const where = db.blogPost.findMany.mock.calls[0][0].where;
            expect(where.status).toBe('SCHEDULED');
            expect(where.scheduled_for.lte).toBeInstanceOf(Date);
        });
    });

    describe('covers', () => {
        it('stores the storage key alongside the URL so the asset can be deleted later', async () => {
            db.blogPost.findFirst.mockResolvedValue(post());
            assets.uploadBuffer.mockResolvedValue({ url: 'https://cdn/x.png', publicId: 'retail/blog/x', bytes: 10 });
            db.blogPost.update.mockResolvedValue(post());

            await service.setCover('post-1', {
                buffer: Buffer.from('x'),
                originalname: 'x.png',
                mimetype: 'image/png',
            });

            expect(db.blogPost.update.mock.calls[0][0].data).toEqual({
                cover_image_url: 'https://cdn/x.png',
                cover_storage_key: 'retail/blog/x',
            });
        });

        it('drops the previous asset when a cover is replaced', async () => {
            db.blogPost.findFirst.mockResolvedValue(post({ cover_storage_key: 'retail/blog/old' }));
            assets.uploadBuffer.mockResolvedValue({ url: 'https://cdn/new.png', publicId: 'retail/blog/new', bytes: 10 });
            db.blogPost.update.mockResolvedValue(post());

            await service.setCover('post-1', {
                buffer: Buffer.from('x'),
                originalname: 'new.png',
                mimetype: 'image/png',
            });

            expect(assets.deleteFile).toHaveBeenCalledWith('retail/blog/old', 'image');
        });

        it('rejects a non-image before uploading anything', async () => {
            db.blogPost.findFirst.mockResolvedValue(post());
            await expect(
                service.setCover('post-1', {
                    buffer: Buffer.from('x'),
                    originalname: 'x.pdf',
                    mimetype: 'application/pdf',
                }),
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(assets.uploadBuffer).not.toHaveBeenCalled();
        });

        it('does not fail an edit because the old asset could not be deleted', async () => {
            db.blogPost.findFirst.mockResolvedValue(post({ cover_storage_key: 'retail/blog/old' }));
            assets.deleteFile.mockRejectedValue(new Error('cloudinary down'));
            db.blogPost.update.mockResolvedValue(post());

            await expect(service.removeCover('post-1')).resolves.toBeDefined();
        });
    });

    describe('delete', () => {
        it('soft-deletes so the slug stays claimed, and drops the cover asset', async () => {
            db.blogPost.findFirst.mockResolvedValue(post({ cover_storage_key: 'retail/blog/x' }));
            db.blogPost.update.mockResolvedValue({});

            await service.remove('post-1');

            expect(assets.deleteFile).toHaveBeenCalledWith('retail/blog/x', 'image');
            expect(db.blogPost.update.mock.calls[0][0].data.deleted_at).toBeInstanceOf(Date);
        });
    });

    describe('unread state', () => {
        it('reports unread when a post landed after the last visit', async () => {
            db.user.findUnique.mockResolvedValue({ blog_last_seen_at: new Date('2026-07-01') });
            db.blogPost.findFirst.mockResolvedValue({ published_at: new Date('2026-08-01') });

            await expect(service.getUnreadState('user-1')).resolves.toMatchObject({ has_unread: true });
        });

        it('reports read when the last visit is newer than the newest post', async () => {
            db.user.findUnique.mockResolvedValue({ blog_last_seen_at: new Date('2026-08-02') });
            db.blogPost.findFirst.mockResolvedValue({ published_at: new Date('2026-08-01') });

            await expect(service.getUnreadState('user-1')).resolves.toMatchObject({ has_unread: false });
        });

        it('reports unread for someone who has never opened the feed', async () => {
            db.user.findUnique.mockResolvedValue({ blog_last_seen_at: null });
            db.blogPost.findFirst.mockResolvedValue({ published_at: new Date('2026-08-01') });

            await expect(service.getUnreadState('user-1')).resolves.toMatchObject({ has_unread: true });
        });

        it('reports read when nothing has ever been published', async () => {
            db.user.findUnique.mockResolvedValue({ blog_last_seen_at: null });
            db.blogPost.findFirst.mockResolvedValue(null);

            await expect(service.getUnreadState('user-1')).resolves.toMatchObject({ has_unread: false });
        });
    });

    describe('create', () => {
        it('refuses a post with no English translation', async () => {
            await expect(
                service.create({ translations: [translation({ locale: 'bn' })] } as any, { userId: 'u1' }),
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(db.blogPost.create).not.toHaveBeenCalled();
        });

        it('derives the slug from the English title and records it in history', async () => {
            db.blogPost.create.mockResolvedValue(post({ id: 'post-9' }));

            await service.create({ translations: [translation()] } as any, { userId: 'u1', name: 'Nayeem' });

            expect(db.blogPost.create.mock.calls[0][0].data.slug).toBe('cutting-stock-loss');
            expect(db.blogPostSlug.create).toHaveBeenCalledWith({
                data: { post_id: 'post-9', slug: 'cutting-stock-loss' },
            });
        });

        it('starts every post as a draft regardless of what the caller asked for', async () => {
            db.blogPost.create.mockResolvedValue(post());
            await service.create({ status: 'PUBLISHED', translations: [translation()] } as any, { userId: 'u1' });
            expect(db.blogPost.create.mock.calls[0][0].data.status).toBe('DRAFT');
        });
    });

    describe('update', () => {
        it('replaces translations wholesale so a removed locale actually goes', async () => {
            db.blogPost.findFirst.mockResolvedValue(post({ translations: [translation(), translation({ locale: 'bn' })] }));
            db.blogPost.update.mockResolvedValue(post());

            await service.update('post-1', { translations: [translation()] } as any);

            expect(db.blogPostTranslation.deleteMany).toHaveBeenCalledWith({ where: { post_id: 'post-1' } });
            expect(db.blogPost.update.mock.calls[0][0].data.translations.create).toHaveLength(1);
        });

        it('leaves edited_at alone unless the editor marks the revision', async () => {
            db.blogPost.findFirst.mockResolvedValue(post());
            db.blogPost.update.mockResolvedValue(post());

            await service.update('post-1', { translations: [translation()] } as any);
            expect(db.blogPost.update.mock.calls[0][0].data.edited_at).toBeUndefined();

            jest.clearAllMocks();
            db.blogPost.findFirst.mockResolvedValue(post());
            db.blogPost.update.mockResolvedValue(post());
            db.$transaction.mockImplementation((fn: any) => fn(db));

            await service.update('post-1', { mark_edited: true, translations: [translation()] } as any);
            expect(db.blogPost.update.mock.calls[0][0].data.edited_at).toBeInstanceOf(Date);
        });
    });
});

describe('pickTranslation', () => {
    const en = { locale: 'en' };
    const bn = { locale: 'bn' };

    it('returns the reader’s locale when it exists', () => {
        expect(pickTranslation([en, bn], 'bn')).toBe(bn);
    });

    it('falls back to English rather than showing a blank page', () => {
        expect(pickTranslation([en], 'bn')).toBe(en);
    });

    it('falls back to whatever exists if even English is missing', () => {
        expect(pickTranslation([bn], 'ms')).toBe(bn);
    });

    it('returns undefined only when there is nothing at all', () => {
        expect(pickTranslation([], 'en')).toBeUndefined();
    });
});
