import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import {
    STOREFRONT_INTERNAL_PATHS,
    StorefrontMenuLinkType,
    StorefrontPageStatus,
} from './storefront-page-constants';
import { resolvePageSlug } from './storefront-page-slug';
import { slugify } from '../blog/blog-slug';
import {
    ReorderStorefrontMenuDto,
    UpsertStorefrontMenuLinkDto,
    UpsertStorefrontPageDto,
} from './storefront-pages.dto';

/** One entry of a storefront menu as the public site renders it. */
export type PublicMenuLink = {
    id: string;
    label: string;
    /** Absolute for EXTERNAL, storefront-relative for the other two. */
    href: string;
    external: boolean;
    open_in_new_tab: boolean;
};

/**
 * A shop's standing pages ("About us", "Delivery & returns") and the header
 * menu that reaches them.
 *
 * Every method takes `tenantId` as its first argument and threads it into the
 * `where` — never optional, never defaulted, same rule as the tenant blog next
 * door. The public reads resolve a tenant from its storefront slug first and
 * then use that id, so a shopper on one storefront can never read another's
 * drafts.
 */
@Injectable()
export class StorefrontPagesService {
    constructor(private readonly db: DatabaseService) {}

    // -----------------------------------------------------------------------
    // Pages — management
    // -----------------------------------------------------------------------

    listPages(tenantId: string) {
        return this.db.storefrontPage.findMany({
            where: { tenant_id: tenantId, deleted_at: null },
            orderBy: [{ title: 'asc' }],
            select: {
                id: true,
                slug: true,
                title: true,
                status: true,
                published_at: true,
                updated_at: true,
            },
        });
    }

    async getPage(tenantId: string, id: string) {
        const page = await this.db.storefrontPage.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
        });
        if (!page) throw new NotFoundException('Page not found');
        return page;
    }

    async createPage(tenantId: string, dto: UpsertStorefrontPageDto) {
        const slug = await this.resolveSlugFor(tenantId, dto.slug || dto.title, null);

        return this.db.storefrontPage.create({
            data: {
                tenant_id: tenantId,
                slug,
                title: dto.title.trim(),
                body_md: dto.body_md ?? '',
                status: StorefrontPageStatus.DRAFT,
                seo_title: dto.seo_title?.trim() || null,
                seo_description: dto.seo_description?.trim() || null,
            },
        });
    }

    async updatePage(tenantId: string, id: string, dto: UpsertStorefrontPageDto) {
        const existing = await this.getPage(tenantId, id);

        // An unchanged slug must not be run through collision numbering, or
        // every save of a published page would walk it to `about-2`, `about-3`.
        const desired = dto.slug?.trim() ? slugify(dto.slug) : existing.slug;
        const slug =
            desired === existing.slug ? existing.slug : await this.resolveSlugFor(tenantId, desired, id);

        return this.db.storefrontPage.update({
            where: { id: existing.id },
            data: {
                slug,
                title: dto.title.trim(),
                body_md: dto.body_md ?? '',
                seo_title: dto.seo_title?.trim() || null,
                seo_description: dto.seo_description?.trim() || null,
            },
        });
    }

    /**
     * Publish or unpublish. `published_at` is stamped the first time a page goes
     * live and kept afterwards, so unpublishing and republishing does not
     * present an old page as new.
     */
    async setPageStatus(tenantId: string, id: string, status: string) {
        const existing = await this.getPage(tenantId, id);
        const publishing = status === StorefrontPageStatus.PUBLISHED;

        if (publishing && !existing.body_md.trim()) {
            throw new BadRequestException('Add some content before publishing this page');
        }

        return this.db.storefrontPage.update({
            where: { id: existing.id },
            data: {
                status,
                published_at: publishing ? (existing.published_at ?? new Date()) : existing.published_at,
            },
        });
    }

    /**
     * Soft delete. Menu links pointing at the page keep their `page_id` and
     * simply stop resolving — the owner sees a broken row in the menu editor to
     * fix, rather than an entry vanishing from their menu without explanation.
     */
    async removePage(tenantId: string, id: string) {
        const existing = await this.getPage(tenantId, id);
        await this.db.storefrontPage.update({
            where: { id: existing.id },
            data: { deleted_at: new Date() },
        });
        return { success: true };
    }

    private async resolveSlugFor(tenantId: string, desired: string, excludePageId: string | null) {
        // Soft-deleted pages are included: their slug is still occupying the
        // unique index, so reusing it would fail at the database.
        const rows = await this.db.storefrontPage.findMany({
            where: { tenant_id: tenantId, ...(excludePageId ? { id: { not: excludePageId } } : {}) },
            select: { slug: true },
        });
        return resolvePageSlug(desired, rows.map((row) => row.slug));
    }

    // -----------------------------------------------------------------------
    // Menu — management
    // -----------------------------------------------------------------------

    listMenuLinks(tenantId: string) {
        return this.db.storefrontMenuLink.findMany({
            where: { tenant_id: tenantId },
            orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
            include: {
                page: { select: { id: true, slug: true, title: true, status: true, deleted_at: true } },
            },
        });
    }

    async createMenuLink(tenantId: string, dto: UpsertStorefrontMenuLinkDto) {
        const target = await this.resolveTarget(tenantId, dto);

        // Appended, not prepended: a new entry landing in front of the menu an
        // owner already arranged is the kind of surprise that gets reported as
        // a bug.
        const last = await this.db.storefrontMenuLink.findFirst({
            where: { tenant_id: tenantId },
            orderBy: { sort_order: 'desc' },
            select: { sort_order: true },
        });

        return this.db.storefrontMenuLink.create({
            data: {
                tenant_id: tenantId,
                label: dto.label.trim(),
                type: dto.type,
                page_id: target.page_id,
                url: target.url,
                sort_order: dto.sort_order ?? (last ? last.sort_order + 1 : 0),
                visible: dto.visible ?? true,
                open_in_new_tab: dto.open_in_new_tab ?? false,
            },
        });
    }

    async updateMenuLink(tenantId: string, id: string, dto: UpsertStorefrontMenuLinkDto) {
        const existing = await this.findMenuLink(tenantId, id);
        const target = await this.resolveTarget(tenantId, dto);

        return this.db.storefrontMenuLink.update({
            where: { id: existing.id },
            data: {
                label: dto.label.trim(),
                type: dto.type,
                page_id: target.page_id,
                url: target.url,
                ...(dto.sort_order === undefined ? {} : { sort_order: dto.sort_order }),
                ...(dto.visible === undefined ? {} : { visible: dto.visible }),
                ...(dto.open_in_new_tab === undefined ? {} : { open_in_new_tab: dto.open_in_new_tab }),
            },
        });
    }

    /**
     * Show or hide one link, without re-validating what it points at: a link
     * the editor has flagged as broken is precisely the one an owner wants to
     * hide, and a full upsert would refuse it.
     */
    async setMenuLinkVisibility(tenantId: string, id: string, visible: boolean) {
        const existing = await this.findMenuLink(tenantId, id);
        return this.db.storefrontMenuLink.update({
            where: { id: existing.id },
            data: { visible },
        });
    }

    async removeMenuLink(tenantId: string, id: string) {
        const existing = await this.findMenuLink(tenantId, id);
        await this.db.storefrontMenuLink.delete({ where: { id: existing.id } });
        return { success: true };
    }

    /**
     * Whole-menu reorder. The ids are filtered through this tenant's own rows
     * before anything is written, so a payload naming another shop's link
     * updates nothing rather than reordering their menu.
     */
    async reorderMenu(tenantId: string, dto: ReorderStorefrontMenuDto) {
        const owned = await this.db.storefrontMenuLink.findMany({
            where: { tenant_id: tenantId },
            select: { id: true },
        });
        const ownedIds = new Set(owned.map((row) => row.id));
        const updates = (dto.links ?? []).filter((entry) => ownedIds.has(entry.id));

        if (updates.length) {
            await this.db.$transaction(
                updates.map((entry) =>
                    this.db.storefrontMenuLink.update({
                        where: { id: entry.id },
                        data: { sort_order: entry.sort_order },
                    }),
                ),
            );
        }

        return this.listMenuLinks(tenantId);
    }

    private async findMenuLink(tenantId: string, id: string) {
        const link = await this.db.storefrontMenuLink.findFirst({
            where: { id, tenant_id: tenantId },
        });
        if (!link) throw new NotFoundException('Menu link not found');
        return link;
    }

    /**
     * Turn the three link shapes into the two columns that store them, and
     * refuse the combinations that would render as a dead entry.
     */
    private async resolveTarget(
        tenantId: string,
        dto: UpsertStorefrontMenuLinkDto,
    ): Promise<{ page_id: string | null; url: string | null }> {
        if (dto.type === StorefrontMenuLinkType.PAGE) {
            if (!dto.page_id) throw new BadRequestException('Choose a page for this menu link');
            const page = await this.db.storefrontPage.findFirst({
                where: { id: dto.page_id, tenant_id: tenantId, deleted_at: null },
                select: { id: true },
            });
            if (!page) throw new NotFoundException('Page not found');
            return { page_id: page.id, url: null };
        }

        const url = (dto.url ?? '').trim();
        if (!url) throw new BadRequestException('Enter a link address');

        if (dto.type === StorefrontMenuLinkType.INTERNAL) {
            if (!(STOREFRONT_INTERNAL_PATHS as readonly string[]).includes(url)) {
                throw new BadRequestException('That is not a storefront destination');
            }
            return { page_id: null, url };
        }

        // EXTERNAL. Parsed rather than pattern-matched, and the protocol is an
        // allowlist: a `javascript:` or `data:` menu entry would otherwise be a
        // stored XSS on the shop's own header.
        let parsed: URL;
        try {
            parsed = new URL(url);
        } catch {
            throw new BadRequestException('Enter a full web address, starting with https://');
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            throw new BadRequestException('Only http:// and https:// links are allowed');
        }
        return { page_id: null, url: parsed.toString() };
    }

    // -----------------------------------------------------------------------
    // Public storefront reads
    // -----------------------------------------------------------------------

    private async findEnabledTenant(storefrontSlug: string) {
        const tenant = await this.db.tenant.findFirst({
            where: { storefront_slug: storefrontSlug, storefront_enabled: true, deleted_at: null },
            select: { id: true, name: true, blogSettings: { select: { enabled: true } } },
        });
        if (!tenant) throw new NotFoundException('Storefront not found or not available');
        return tenant;
    }

    /** The menu for a storefront, by slug. */
    async getPublicMenu(storefrontSlug: string) {
        const tenant = await this.findEnabledTenant(storefrontSlug);
        return {
            links: await this.resolveMenu(tenant.id, storefrontSlug, tenant.blogSettings?.enabled ?? false),
        };
    }

    /**
     * The menu for a tenant whose storefront has already been resolved — the
     * shape `StorefrontService.getStorefront` folds into its own response so the
     * header renders on first paint instead of after a second round trip.
     */
    async resolveMenu(
        tenantId: string,
        storefrontSlug: string,
        blogEnabled: boolean,
    ): Promise<PublicMenuLink[]> {
        const links = await this.db.storefrontMenuLink.findMany({
            where: { tenant_id: tenantId, visible: true },
            orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
            include: { page: { select: { slug: true, status: true, deleted_at: true } } },
        });

        const base = `/store/${storefrontSlug}`;

        return links.flatMap((link): PublicMenuLink[] => {
            if (link.type === StorefrontMenuLinkType.PAGE) {
                // A draft or deleted page drops out of the public menu rather
                // than rendering an entry that 404s.
                if (!link.page || link.page.deleted_at || link.page.status !== StorefrontPageStatus.PUBLISHED) {
                    return [];
                }
                return [
                    {
                        id: link.id,
                        label: link.label,
                        href: `${base}/pages/${link.page.slug}`,
                        external: false,
                        open_in_new_tab: false,
                    },
                ];
            }

            if (link.type === StorefrontMenuLinkType.INTERNAL) {
                if (!link.url) return [];
                // A blog link on a shop with the blog switched off would land on
                // the "not available" page, so it is dropped for as long as the
                // switch is off and comes back when it is on.
                if (link.url === '/blog' && !blogEnabled) return [];
                return [
                    {
                        id: link.id,
                        label: link.label,
                        href: link.url === '/' ? base : `${base}${link.url}`,
                        external: false,
                        open_in_new_tab: false,
                    },
                ];
            }

            if (!link.url) return [];
            return [
                {
                    id: link.id,
                    label: link.label,
                    href: link.url,
                    external: true,
                    open_in_new_tab: link.open_in_new_tab,
                },
            ];
        });
    }

    /** One published page, plus the menu, for the public page route. */
    async getPublicPage(storefrontSlug: string, pageSlug: string) {
        const tenant = await this.findEnabledTenant(storefrontSlug);

        const page = await this.db.storefrontPage.findFirst({
            where: {
                tenant_id: tenant.id,
                slug: pageSlug,
                deleted_at: null,
                status: StorefrontPageStatus.PUBLISHED,
            },
            select: {
                slug: true,
                title: true,
                body_md: true,
                seo_title: true,
                seo_description: true,
                published_at: true,
                updated_at: true,
            },
        });
        if (!page) throw new NotFoundException('Page not found');

        return {
            shop: { name: tenant.name, slug: storefrontSlug },
            page,
            menu: await this.resolveMenu(tenant.id, storefrontSlug, tenant.blogSettings?.enabled ?? false),
        };
    }

    /** Published page slugs, for the storefront's sitemap. */
    async listPublishedPageSlugs(storefrontSlug: string) {
        const tenant = await this.findEnabledTenant(storefrontSlug);
        const rows = await this.db.storefrontPage.findMany({
            where: { tenant_id: tenant.id, deleted_at: null, status: StorefrontPageStatus.PUBLISHED },
            select: { slug: true, updated_at: true },
            orderBy: { updated_at: 'desc' },
        });
        return { rows };
    }
}
