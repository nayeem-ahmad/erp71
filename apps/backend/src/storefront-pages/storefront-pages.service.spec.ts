import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '../database/database.service';
import { StorefrontPagesService } from './storefront-pages.service';

const TENANT = 'tenant-1';
const SLUG = 'demo-shop';

function publishedPage(overrides: Record<string, unknown> = {}) {
    return {
        id: 'page-1',
        tenant_id: TENANT,
        slug: 'about',
        title: 'About us',
        body_md: '# Hello',
        status: 'PUBLISHED',
        seo_title: null,
        seo_description: null,
        published_at: new Date('2026-01-01'),
        deleted_at: null,
        ...overrides,
    };
}

describe('StorefrontPagesService', () => {
    let service: StorefrontPagesService;
    let db: any;

    beforeEach(async () => {
        db = {
            tenant: { findFirst: jest.fn() },
            storefrontPage: {
                findFirst: jest.fn(),
                findMany: jest.fn().mockResolvedValue([]),
                create: jest.fn(),
                update: jest.fn(),
            },
            storefrontMenuLink: {
                findFirst: jest.fn(),
                findMany: jest.fn().mockResolvedValue([]),
                create: jest.fn(),
                update: jest.fn(),
                delete: jest.fn(),
            },
            $transaction: jest.fn().mockImplementation((ops: any[]) => Promise.all(ops)),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [StorefrontPagesService, { provide: DatabaseService, useValue: db }],
        }).compile();

        service = module.get(StorefrontPagesService);
    });

    // ── pages ────────────────────────────────────────────────────────────────

    describe('createPage', () => {
        it('derives a slug from the title and starts the page as a draft', async () => {
            db.storefrontPage.findMany.mockResolvedValue([]);
            db.storefrontPage.create.mockImplementation(({ data }: any) => Promise.resolve(data));

            const page = await service.createPage(TENANT, {
                title: 'Delivery & Returns',
                body_md: 'How we ship.',
            });

            expect(page.slug).toBe('delivery-returns');
            expect(page.status).toBe('DRAFT');
            expect(page.tenant_id).toBe(TENANT);
        });

        it('numbers a slug that another page in the same shop already holds', async () => {
            db.storefrontPage.findMany.mockResolvedValue([{ slug: 'about-us' }]);
            db.storefrontPage.create.mockImplementation(({ data }: any) => Promise.resolve(data));

            const page = await service.createPage(TENANT, { title: 'About us', body_md: 'x' });

            expect(page.slug).toBe('about-us-2');
        });
    });

    describe('updatePage', () => {
        it('leaves an unchanged slug alone rather than walking it to -2', async () => {
            db.storefrontPage.findFirst.mockResolvedValue(publishedPage());
            db.storefrontPage.update.mockImplementation(({ data }: any) => Promise.resolve(data));

            const page = await service.updatePage(TENANT, 'page-1', {
                title: 'About us',
                body_md: 'edited',
                slug: 'about',
            });

            expect(page.slug).toBe('about');
            // No collision lookup at all: the slug never entered the resolver.
            expect(db.storefrontPage.findMany).not.toHaveBeenCalled();
        });

        it('refuses a page belonging to another shop', async () => {
            db.storefrontPage.findFirst.mockResolvedValue(null);

            await expect(
                service.updatePage(TENANT, 'someone-elses-page', { title: 'x', body_md: 'y' }),
            ).rejects.toBeInstanceOf(NotFoundException);
        });
    });

    describe('setPageStatus', () => {
        it('refuses to publish an empty page', async () => {
            db.storefrontPage.findFirst.mockResolvedValue(publishedPage({ status: 'DRAFT', body_md: '   ' }));

            await expect(service.setPageStatus(TENANT, 'page-1', 'PUBLISHED')).rejects.toBeInstanceOf(
                BadRequestException,
            );
        });

        it('keeps the original published_at when a page goes back up', async () => {
            const first = new Date('2026-01-01');
            db.storefrontPage.findFirst.mockResolvedValue(
                publishedPage({ status: 'DRAFT', published_at: first }),
            );
            db.storefrontPage.update.mockImplementation(({ data }: any) => Promise.resolve(data));

            const page = await service.setPageStatus(TENANT, 'page-1', 'PUBLISHED');

            expect(page.published_at).toBe(first);
        });
    });

    describe('removePage', () => {
        it('soft deletes so the slug stays reserved', async () => {
            db.storefrontPage.findFirst.mockResolvedValue(publishedPage());
            db.storefrontPage.update.mockResolvedValue({});

            await service.removePage(TENANT, 'page-1');

            expect(db.storefrontPage.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: { deleted_at: expect.any(Date) } }),
            );
        });
    });

    // ── menu links ───────────────────────────────────────────────────────────

    describe('createMenuLink', () => {
        it('refuses a PAGE link pointing at another shop’s page', async () => {
            db.storefrontPage.findFirst.mockResolvedValue(null);

            await expect(
                service.createMenuLink(TENANT, {
                    label: 'About',
                    type: 'PAGE',
                    page_id: '11111111-1111-1111-1111-111111111111',
                }),
            ).rejects.toBeInstanceOf(NotFoundException);
        });

        it('refuses a javascript: URL on an external link', async () => {
            await expect(
                service.createMenuLink(TENANT, {
                    label: 'Nasty',
                    type: 'EXTERNAL',
                    // eslint-disable-next-line no-script-url
                    url: 'javascript:alert(1)',
                }),
            ).rejects.toBeInstanceOf(BadRequestException);
        });

        it('refuses an internal path that is not a storefront destination', async () => {
            await expect(
                service.createMenuLink(TENANT, { label: 'Admin', type: 'INTERNAL', url: '/settings' }),
            ).rejects.toBeInstanceOf(BadRequestException);
        });

        it('appends a new link after the ones already there', async () => {
            db.storefrontMenuLink.findFirst.mockResolvedValue({ sort_order: 4 });
            db.storefrontMenuLink.create.mockImplementation(({ data }: any) => Promise.resolve(data));

            const link = await service.createMenuLink(TENANT, {
                label: 'Our shop',
                type: 'INTERNAL',
                url: '/shop',
            });

            expect(link.sort_order).toBe(5);
            expect(link.page_id).toBeNull();
        });
    });

    describe('setMenuLinkVisibility', () => {
        it('hides a link without re-validating what it points at', async () => {
            // The broken-page case: a full upsert would refuse this, and hiding
            // it is exactly what the editor tells the owner they can do.
            db.storefrontMenuLink.findFirst.mockResolvedValue({ id: 'link-1', tenant_id: TENANT });
            db.storefrontMenuLink.update.mockResolvedValue({ id: 'link-1', visible: false });

            await service.setMenuLinkVisibility(TENANT, 'link-1', false);

            expect(db.storefrontPage.findFirst).not.toHaveBeenCalled();
            expect(db.storefrontMenuLink.update).toHaveBeenCalledWith({
                where: { id: 'link-1' },
                data: { visible: false },
            });
        });

        it('refuses a link belonging to another shop', async () => {
            db.storefrontMenuLink.findFirst.mockResolvedValue(null);

            await expect(service.setMenuLinkVisibility(TENANT, 'theirs', false)).rejects.toBeInstanceOf(
                NotFoundException,
            );
        });
    });

    describe('reorderMenu', () => {
        it('ignores ids that do not belong to this shop', async () => {
            db.storefrontMenuLink.findMany.mockResolvedValue([{ id: 'mine' }]);

            await service.reorderMenu(TENANT, {
                links: [
                    { id: 'mine', sort_order: 0 },
                    { id: 'theirs', sort_order: 1 },
                ],
            });

            expect(db.storefrontMenuLink.update).toHaveBeenCalledTimes(1);
            expect(db.storefrontMenuLink.update).toHaveBeenCalledWith({
                where: { id: 'mine' },
                data: { sort_order: 0 },
            });
        });
    });

    // ── public reads ─────────────────────────────────────────────────────────

    describe('resolveMenu', () => {
        function menuRow(overrides: Record<string, unknown> = {}) {
            return {
                id: 'link-1',
                label: 'About',
                type: 'PAGE',
                url: null,
                open_in_new_tab: false,
                page: { slug: 'about', status: 'PUBLISHED', deleted_at: null },
                ...overrides,
            };
        }

        it('renders a page link against the shop’s own storefront slug', async () => {
            db.storefrontMenuLink.findMany.mockResolvedValue([menuRow()]);

            const links = await service.resolveMenu(TENANT, SLUG, false);

            expect(links).toEqual([
                {
                    id: 'link-1',
                    label: 'About',
                    href: `/store/${SLUG}/pages/about`,
                    external: false,
                    open_in_new_tab: false,
                },
            ]);
        });

        it('drops a link whose page is still a draft or has been deleted', async () => {
            db.storefrontMenuLink.findMany.mockResolvedValue([
                menuRow({ id: 'draft', page: { slug: 'a', status: 'DRAFT', deleted_at: null } }),
                menuRow({ id: 'gone', page: { slug: 'b', status: 'PUBLISHED', deleted_at: new Date() } }),
                menuRow({ id: 'orphan', page: null }),
            ]);

            await expect(service.resolveMenu(TENANT, SLUG, false)).resolves.toEqual([]);
        });

        it('drops a blog link while the shop’s blog is switched off', async () => {
            const blogLink = menuRow({ id: 'blog', type: 'INTERNAL', url: '/blog', page: null });
            db.storefrontMenuLink.findMany.mockResolvedValue([blogLink]);

            await expect(service.resolveMenu(TENANT, SLUG, false)).resolves.toEqual([]);

            db.storefrontMenuLink.findMany.mockResolvedValue([blogLink]);
            const withBlog = await service.resolveMenu(TENANT, SLUG, true);
            expect(withBlog[0]?.href).toBe(`/store/${SLUG}/blog`);
        });

        it('points an internal home link at the storefront root, without a trailing slash', async () => {
            db.storefrontMenuLink.findMany.mockResolvedValue([
                menuRow({ type: 'INTERNAL', url: '/', page: null }),
            ]);

            const links = await service.resolveMenu(TENANT, SLUG, false);

            expect(links[0]?.href).toBe(`/store/${SLUG}`);
        });

        it('marks an external link as external and keeps its URL verbatim', async () => {
            db.storefrontMenuLink.findMany.mockResolvedValue([
                menuRow({
                    type: 'EXTERNAL',
                    url: 'https://example.com/help',
                    page: null,
                    open_in_new_tab: true,
                }),
            ]);

            const links = await service.resolveMenu(TENANT, SLUG, false);

            expect(links[0]).toMatchObject({
                href: 'https://example.com/help',
                external: true,
                open_in_new_tab: true,
            });
        });

        it('asks only for visible links', async () => {
            await service.resolveMenu(TENANT, SLUG, false);

            expect(db.storefrontMenuLink.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: { tenant_id: TENANT, visible: true } }),
            );
        });
    });

    describe('getPublicPage', () => {
        it('refuses a storefront that is switched off', async () => {
            db.tenant.findFirst.mockResolvedValue(null);

            await expect(service.getPublicPage(SLUG, 'about')).rejects.toBeInstanceOf(NotFoundException);
        });

        it('reads only published, undeleted pages of that shop', async () => {
            db.tenant.findFirst.mockResolvedValue({ id: TENANT, name: 'Demo', blogSettings: null });
            db.storefrontPage.findFirst.mockResolvedValue(publishedPage());

            const result = await service.getPublicPage(SLUG, 'about');

            expect(db.storefrontPage.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        tenant_id: TENANT,
                        slug: 'about',
                        deleted_at: null,
                        status: 'PUBLISHED',
                    }),
                }),
            );
            expect(result.shop).toEqual({ name: 'Demo', slug: SLUG });
        });

        it('404s a draft rather than serving it to a shopper', async () => {
            db.tenant.findFirst.mockResolvedValue({ id: TENANT, name: 'Demo', blogSettings: null });
            db.storefrontPage.findFirst.mockResolvedValue(null);

            await expect(service.getPublicPage(SLUG, 'about')).rejects.toBeInstanceOf(NotFoundException);
        });
    });
});
