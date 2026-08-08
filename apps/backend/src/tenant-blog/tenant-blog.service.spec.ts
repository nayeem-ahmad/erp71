import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TenantBlogService } from './tenant-blog.service';

/**
 * Everything here turns on one thing: a shop's blog must be reachable by the
 * public without ever exposing another shop's rows, or its own drafts. So the
 * cases below concentrate on the tenant filter appearing in every query, on the
 * two switches that gate the public surface, and on slug history being scoped
 * per shop — a redirect that crossed tenants would send a reader from one
 * shop's old URL into another shop's article.
 */
describe('TenantBlogService', () => {
    const db = {
        tenant: { findFirst: jest.fn(), findUnique: jest.fn() },
        tenantBlogPost: {
            findMany: jest.fn(),
            findFirst: jest.fn(),
            count: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn(),
        },
        tenantBlogPostSlug: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), upsert: jest.fn() },
        tenantBlogCategory: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
        tenantBlogSettings: { findUnique: jest.fn(), upsert: jest.fn() },
        $transaction: jest.fn(),
    } as any;

    const assets = {
        isEnabled: jest.fn().mockReturnValue(true),
        uploadBuffer: jest.fn(),
        deleteFile: jest.fn().mockResolvedValue(undefined),
    } as any;

    let service: TenantBlogService;

    beforeEach(() => {
        jest.clearAllMocks();
        assets.isEnabled.mockReturnValue(true);
        assets.deleteFile.mockResolvedValue(undefined);
        db.tenantBlogPost.findMany.mockResolvedValue([]);
        db.tenantBlogPost.count.mockResolvedValue(0);
        db.tenantBlogCategory.findMany.mockResolvedValue([]);
        db.tenantBlogPostSlug.findMany.mockResolvedValue([]);
        db.$transaction.mockImplementation((arg: any) => (typeof arg === 'function' ? arg(db) : Promise.all(arg)));
        service = new TenantBlogService(db, assets);
    });

    const enabledTenant = (overrides: Record<string, unknown> = {}) => ({
        id: 'tenant-1',
        name: 'Karim Store',
        blogSettings: { enabled: true, title: 'Karim Store Blog', tagline: null },
        ...overrides,
    });

    const post = (overrides: Record<string, unknown> = {}) => ({
        id: 'post-1',
        tenant_id: 'tenant-1',
        slug: 'eid-sale',
        status: 'PUBLISHED',
        title: 'Eid sale',
        body_md: 'Body',
        excerpt: null,
        category_id: null,
        category: null,
        seo_title: null,
        seo_description: null,
        cover_image_url: null,
        cover_storage_key: null,
        cover_alt: null,
        author_name: 'Karim',
        published_at: new Date('2026-08-01'),
        edited_at: null,
        reading_minutes: 2,
        featured: false,
        view_count: 0,
        ...overrides,
    });

    describe('public reads', () => {
        it('refuses a shop whose storefront is off', async () => {
            db.tenant.findFirst.mockResolvedValue(null);
            await expect(service.listPublic('karim', {})).rejects.toBeInstanceOf(NotFoundException);
            expect(db.tenantBlogPost.findMany).not.toHaveBeenCalled();
        });

        it('refuses a shop whose storefront is on but whose blog is off', async () => {
            db.tenant.findFirst.mockResolvedValue(enabledTenant({ blogSettings: { enabled: false } }));
            await expect(service.listPublic('karim', {})).rejects.toBeInstanceOf(NotFoundException);
            expect(db.tenantBlogPost.findMany).not.toHaveBeenCalled();
        });

        it('refuses a shop that has never touched its blog settings', async () => {
            db.tenant.findFirst.mockResolvedValue(enabledTenant({ blogSettings: null }));
            await expect(service.listPublic('karim', {})).rejects.toBeInstanceOf(NotFoundException);
        });

        it('requires both storefront_enabled and a live tenant when resolving the shop', async () => {
            db.tenant.findFirst.mockResolvedValue(enabledTenant());
            await service.listPublic('karim', {});

            expect(db.tenant.findFirst.mock.calls[0][0].where).toEqual({
                storefront_slug: 'karim',
                storefront_enabled: true,
                deleted_at: null,
            });
        });

        it('scopes every public query to the resolved tenant and to published posts', async () => {
            db.tenant.findFirst.mockResolvedValue(enabledTenant());
            await service.listPublic('karim', {});

            expect(db.tenantBlogPost.findMany.mock.calls[0][0].where).toMatchObject({
                tenant_id: 'tenant-1',
                deleted_at: null,
                status: 'PUBLISHED',
            });
        });

        it('caps the public page size', async () => {
            db.tenant.findFirst.mockResolvedValue(enabledTenant());
            await service.listPublic('karim', { limit: 9999 });
            expect(db.tenantBlogPost.findMany.mock.calls[0][0].take).toBe(50);
        });

        it('scopes the detail read to the tenant as well as the slug', async () => {
            db.tenant.findFirst.mockResolvedValue(enabledTenant());
            db.tenantBlogPost.findFirst.mockResolvedValue(post());

            await service.getPublicBySlug('karim', 'eid-sale');
            expect(db.tenantBlogPost.findFirst.mock.calls[0][0].where).toMatchObject({
                slug: 'eid-sale',
                tenant_id: 'tenant-1',
                status: 'PUBLISHED',
            });
        });
    });

    describe('renamed slugs', () => {
        it('looks up history within the shop, never across shops', async () => {
            db.tenant.findFirst.mockResolvedValue(enabledTenant());
            db.tenantBlogPost.findFirst.mockResolvedValue(null);
            db.tenantBlogPostSlug.findFirst.mockResolvedValue({
                post: { slug: 'eid-sale-2026', status: 'PUBLISHED', deleted_at: null },
            });

            await expect(service.getPublicBySlug('karim', 'old-eid-sale')).resolves.toMatchObject({
                redirect_to: 'eid-sale-2026',
            });
            expect(db.tenantBlogPostSlug.findFirst.mock.calls[0][0].where).toMatchObject({
                tenant_id: 'tenant-1',
                slug: 'old-eid-sale',
            });
        });

        it('does not redirect to a post that has been unpublished', async () => {
            db.tenant.findFirst.mockResolvedValue(enabledTenant());
            db.tenantBlogPost.findFirst.mockResolvedValue(null);
            db.tenantBlogPostSlug.findFirst.mockResolvedValue({
                post: { slug: 'eid-sale-2026', status: 'DRAFT', deleted_at: null },
            });

            await expect(service.getPublicBySlug('karim', 'old')).rejects.toBeInstanceOf(NotFoundException);
        });
    });

    describe('publishing', () => {
        it('refuses to publish while the shop’s blog is switched off', async () => {
            db.tenantBlogPost.findFirst.mockResolvedValue(post({ status: 'DRAFT' }));
            db.tenantBlogSettings.findUnique.mockResolvedValue({ enabled: false });

            await expect(service.publish('tenant-1', 'post-1')).rejects.toBeInstanceOf(BadRequestException);
            expect(db.tenantBlogPost.update).not.toHaveBeenCalled();
        });

        it('refuses a post with an empty body', async () => {
            db.tenantBlogPost.findFirst.mockResolvedValue(post({ status: 'DRAFT', body_md: '  ' }));
            db.tenantBlogSettings.findUnique.mockResolvedValue({ enabled: true });

            await expect(service.publish('tenant-1', 'post-1')).rejects.toBeInstanceOf(BadRequestException);
        });

        it('keeps the original published_at when a post goes back up', async () => {
            const original = new Date('2026-01-01');
            db.tenantBlogPost.findFirst.mockResolvedValue(post({ status: 'DRAFT', published_at: original }));
            db.tenantBlogSettings.findUnique.mockResolvedValue({ enabled: true });
            db.tenantBlogPost.update.mockResolvedValue(post());

            await service.publish('tenant-1', 'post-1');
            expect(db.tenantBlogPost.update.mock.calls[0][0].data.published_at).toBe(original);
        });

        it('reads the post through the tenant filter before touching it', async () => {
            db.tenantBlogPost.findFirst.mockResolvedValue(null);
            await expect(service.publish('tenant-1', 'post-1')).rejects.toBeInstanceOf(NotFoundException);
            expect(db.tenantBlogPost.findFirst.mock.calls[0][0].where).toMatchObject({
                id: 'post-1',
                tenant_id: 'tenant-1',
                deleted_at: null,
            });
        });
    });

    describe('scheduled publishing', () => {
        it('skips shops that switched their blog off after scheduling', async () => {
            await service.publishDueScheduledPosts();
            expect(db.tenantBlogPost.findMany.mock.calls[0][0].where.tenant).toEqual({
                blogSettings: { enabled: true },
                deleted_at: null,
            });
        });
    });

    describe('settings', () => {
        it('reports a shop with no settings row as off rather than failing', async () => {
            db.tenantBlogSettings.findUnique.mockResolvedValue(null);
            db.tenant.findUnique.mockResolvedValue({ name: 'Karim Store', storefront_slug: 'karim', storefront_enabled: true });

            await expect(service.getSettings('tenant-1')).resolves.toMatchObject({
                enabled: false,
                storefront_slug: 'karim',
            });
        });

        it('leaves untouched fields alone on a partial update', async () => {
            db.tenantBlogSettings.upsert.mockResolvedValue({});
            db.tenantBlogSettings.findUnique.mockResolvedValue({ enabled: true, title: 'Kept', tagline: null });
            db.tenant.findUnique.mockResolvedValue({ name: 'Karim Store', storefront_slug: 'karim', storefront_enabled: true });

            await service.updateSettings('tenant-1', 'user-1', { enabled: true });

            expect(db.tenantBlogSettings.upsert.mock.calls[0][0].update).toEqual({
                enabled: true,
                updated_by: 'user-1',
            });
        });
    });

    describe('writes', () => {
        it('stamps the tenant on create and records the slug in that tenant’s history', async () => {
            db.tenantBlogPost.create.mockResolvedValue(post({ id: 'post-9', slug: 'eid-sale' }));

            await service.create('tenant-1', { userId: 'user-1', name: 'Karim' }, {
                title: 'Eid sale',
                body_md: 'Body',
            } as any);

            expect(db.tenantBlogPost.create.mock.calls[0][0].data).toMatchObject({
                tenant_id: 'tenant-1',
                slug: 'eid-sale',
                status: 'DRAFT',
            });
            expect(db.tenantBlogPostSlug.create).toHaveBeenCalledWith({
                data: { tenant_id: 'tenant-1', post_id: 'post-9', slug: 'eid-sale' },
            });
        });

        it('checks slug collisions only within the same shop', async () => {
            // Two shops may both publish "eid-sale"; each owns the URL under
            // its own storefront, so a global check would needlessly suffix.
            db.tenantBlogPost.create.mockResolvedValue(post());
            await service.create('tenant-1', { userId: 'u1' }, { title: 'Eid sale', body_md: 'x' } as any);

            expect(db.tenantBlogPost.findMany.mock.calls[0][0].where).toMatchObject({ tenant_id: 'tenant-1' });
            expect(db.tenantBlogPostSlug.findMany.mock.calls[0][0].where).toMatchObject({ tenant_id: 'tenant-1' });
        });

        it('stores the cover storage key so the image can be deleted later', async () => {
            db.tenantBlogPost.findFirst.mockResolvedValue(post());
            assets.uploadBuffer.mockResolvedValue({ url: 'https://cdn/a.png', publicId: 'retail/tenant-1/blog/a', bytes: 5 });
            db.tenantBlogPost.update.mockResolvedValue(post());

            await service.setCover('tenant-1', 'post-1', {
                buffer: Buffer.from('x'),
                originalname: 'a.png',
                mimetype: 'image/png',
            });

            expect(db.tenantBlogPost.update.mock.calls[0][0].data).toEqual({
                cover_image_url: 'https://cdn/a.png',
                cover_storage_key: 'retail/tenant-1/blog/a',
            });
        });

        it('uploads a shop’s covers under that shop’s folder', async () => {
            db.tenantBlogPost.findFirst.mockResolvedValue(post());
            assets.uploadBuffer.mockResolvedValue({ url: 'u', publicId: 'p', bytes: 1 });
            db.tenantBlogPost.update.mockResolvedValue(post());

            await service.setCover('tenant-1', 'post-1', {
                buffer: Buffer.from('x'),
                originalname: 'a.png',
                mimetype: 'image/png',
            });

            expect(assets.uploadBuffer.mock.calls[0][1]).toBe('tenant-1/blog');
        });

        it('detaches posts before soft-deleting a category, so they stay in the index', async () => {
            db.tenantBlogCategory.findFirst.mockResolvedValue({ id: 'cat-1', tenant_id: 'tenant-1' });
            db.tenantBlogPost.updateMany.mockReturnValue('detach');
            db.tenantBlogCategory.update.mockReturnValue('soft-delete');

            await service.removeCategory('tenant-1', 'cat-1');

            expect(db.tenantBlogPost.updateMany).toHaveBeenCalledWith({
                where: { tenant_id: 'tenant-1', category_id: 'cat-1' },
                data: { category_id: null },
            });
        });

        it('refuses to touch a category belonging to another shop', async () => {
            db.tenantBlogCategory.findFirst.mockResolvedValue(null);
            await expect(service.removeCategory('tenant-1', 'cat-other')).rejects.toBeInstanceOf(NotFoundException);
        });
    });
});
