import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DatabaseService } from '../database/database.service';
import { AssetsService } from '../assets/assets.service';
import { AiService } from '../ai/ai.service';
import { resolveSlug } from '../blog/blog-slug';
import { readingMinutes } from '../blog/reading-time';
import { BlogStatus, canTransition } from '../blog/blog-status';
import {
    BLOG_DRAFT_MAX_TOKENS,
    BlogAiDraft,
    buildBlogDraftPrompt,
    normalizeBlogDraft,
    resolveDraftLocales,
} from '../blog/blog-ai-draft';
import { BlogAiDraftDto } from '../blog/blog.dto';
import {
    UpdateTenantBlogSettingsDto,
    UpsertTenantBlogCategoryDto,
    UpsertTenantBlogPostDto,
} from './tenant-blog.dto';

const MAX_PAGE_SIZE = 50;

/**
 * The storefront blog: posts a shop writes about itself.
 *
 * Every method takes `tenantId` as its first argument and threads it into the
 * `where` — never optional, never defaulted. The platform blog next door is
 * deliberately a separate service over separate tables: they share the slug and
 * reading-time helpers and nothing else, because a query that crossed them
 * would publish one shop's drafts under another shop's name.
 */
@Injectable()
export class TenantBlogService {
    private readonly logger = new Logger(TenantBlogService.name);

    constructor(
        private readonly db: DatabaseService,
        private readonly assets: AssetsService,
        private readonly ai: AiService,
    ) {}

    // -----------------------------------------------------------------------
    // Public storefront reads
    // -----------------------------------------------------------------------

    /**
     * Resolve a shop by its storefront slug, and refuse if its blog is off.
     *
     * Two switches have to be on: the storefront itself, and the blog. A shop
     * that turned its storefront off should not keep serving its articles.
     */
    private async findBlogEnabledTenant(storefrontSlug: string) {
        const tenant = await this.db.tenant.findFirst({
            where: { storefront_slug: storefrontSlug, storefront_enabled: true, deleted_at: null },
            select: { id: true, name: true, blogSettings: true },
        });
        if (!tenant || !tenant.blogSettings?.enabled) {
            throw new NotFoundException('Blog not found or not available');
        }
        return tenant;
    }

    private visibleWhere(tenantId: string) {
        return {
            tenant_id: tenantId,
            deleted_at: null,
            status: BlogStatus.PUBLISHED,
            published_at: { not: null, lte: new Date() },
        };
    }

    async listPublic(storefrontSlug: string, options: { page?: number; limit?: number; categorySlug?: string }) {
        const tenant = await this.findBlogEnabledTenant(storefrontSlug);
        const limit = Math.min(Math.max(options.limit ?? 12, 1), MAX_PAGE_SIZE);
        const page = Math.max(options.page ?? 1, 1);

        const where: Record<string, unknown> = { ...this.visibleWhere(tenant.id) };
        if (options.categorySlug) where.category = { slug: options.categorySlug };

        const [rows, total, categories] = await Promise.all([
            this.db.tenantBlogPost.findMany({
                where: where as any,
                orderBy: [{ featured: 'desc' }, { published_at: 'desc' }],
                skip: (page - 1) * limit,
                take: limit,
                include: { category: true },
            }),
            this.db.tenantBlogPost.count({ where: where as any }),
            this.db.tenantBlogCategory.findMany({
                where: { tenant_id: tenant.id, deleted_at: null },
                orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
            }),
        ]);

        return {
            blog: {
                title: tenant.blogSettings?.title ?? `${tenant.name} Blog`,
                tagline: tenant.blogSettings?.tagline ?? null,
                shop_name: tenant.name,
            },
            rows: rows.map((row) => this.toPublicListView(row)),
            categories: categories.map((c) => ({ slug: c.slug, name: c.name })),
            total,
            page,
            limit,
        };
    }

    async getPublicBySlug(storefrontSlug: string, slug: string) {
        const tenant = await this.findBlogEnabledTenant(storefrontSlug);

        const post = await this.db.tenantBlogPost.findFirst({
            where: { slug, ...(this.visibleWhere(tenant.id) as any) },
            include: { category: true },
        });

        if (post) {
            return {
                blog: {
                    title: tenant.blogSettings?.title ?? `${tenant.name} Blog`,
                    shop_name: tenant.name,
                },
                post: this.toPublicDetailView(post),
                redirect_to: null,
            };
        }

        // Slug history is unique per tenant, so a rename in one shop cannot
        // redirect a reader into another shop's article.
        const historic = await this.db.tenantBlogPostSlug.findFirst({
            where: { tenant_id: tenant.id, slug },
            include: { post: { select: { slug: true, status: true, deleted_at: true } } },
        });

        if (
            historic?.post &&
            !historic.post.deleted_at &&
            historic.post.status === BlogStatus.PUBLISHED
        ) {
            return { blog: null, post: null, redirect_to: historic.post.slug };
        }

        throw new NotFoundException('Post not found');
    }

    async recordView(storefrontSlug: string, slug: string): Promise<void> {
        const tenant = await this.findBlogEnabledTenant(storefrontSlug);
        await this.db.tenantBlogPost.updateMany({
            where: { slug, ...(this.visibleWhere(tenant.id) as any) },
            data: { view_count: { increment: 1 } },
        });
    }

    /** Published slugs for one shop — used by the storefront sitemap. */
    async listPublishedSlugs(storefrontSlug: string) {
        const tenant = await this.findBlogEnabledTenant(storefrontSlug);
        return this.db.tenantBlogPost.findMany({
            where: this.visibleWhere(tenant.id) as any,
            orderBy: { published_at: 'desc' },
            select: { slug: true, published_at: true, updated_at: true },
            take: 500,
        });
    }

    // -----------------------------------------------------------------------
    // Tenant-facing reads
    // -----------------------------------------------------------------------

    async list(tenantId: string, options: { status?: string; search?: string; page?: number; limit?: number }) {
        const limit = Math.min(Math.max(options.limit ?? 25, 1), MAX_PAGE_SIZE);
        const page = Math.max(options.page ?? 1, 1);

        const where: Record<string, unknown> = { tenant_id: tenantId, deleted_at: null };
        if (options.status) where.status = options.status;
        if (options.search) where.title = { contains: options.search, mode: 'insensitive' };

        const [rows, total] = await Promise.all([
            this.db.tenantBlogPost.findMany({
                where: where as any,
                orderBy: { updated_at: 'desc' },
                skip: (page - 1) * limit,
                take: limit,
                include: { category: true },
            }),
            this.db.tenantBlogPost.count({ where: where as any }),
        ]);

        return { rows, total, page, limit };
    }

    async get(tenantId: string, id: string) {
        const post = await this.db.tenantBlogPost.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
            include: { category: true },
        });
        if (!post) throw new NotFoundException('Post not found');
        return post;
    }

    async getSettings(tenantId: string) {
        const settings = await this.db.tenantBlogSettings.findUnique({ where: { tenant_id: tenantId } });
        const tenant = await this.db.tenant.findUnique({
            where: { id: tenantId },
            select: { name: true, storefront_slug: true, storefront_enabled: true },
        });

        // Absent means "off with defaults", so a shop that has never opened the
        // page still gets a coherent answer without a backfill.
        return {
            enabled: settings?.enabled ?? false,
            title: settings?.title ?? null,
            tagline: settings?.tagline ?? null,
            storefront_slug: tenant?.storefront_slug ?? null,
            storefront_enabled: tenant?.storefront_enabled ?? false,
            shop_name: tenant?.name ?? null,
        };
    }

    async updateSettings(tenantId: string, userId: string, dto: UpdateTenantBlogSettingsDto) {
        await this.db.tenantBlogSettings.upsert({
            where: { tenant_id: tenantId },
            create: {
                tenant_id: tenantId,
                enabled: dto.enabled ?? false,
                title: dto.title ?? null,
                tagline: dto.tagline ?? null,
                updated_by: userId,
            },
            update: {
                ...(dto.enabled === undefined ? {} : { enabled: dto.enabled }),
                ...(dto.title === undefined ? {} : { title: dto.title || null }),
                ...(dto.tagline === undefined ? {} : { tagline: dto.tagline || null }),
                updated_by: userId,
            },
        });
        return this.getSettings(tenantId);
    }

    // -----------------------------------------------------------------------
    // Writes
    // -----------------------------------------------------------------------

    async create(tenantId: string, actor: { userId: string; name?: string | null }, dto: UpsertTenantBlogPostDto) {
        const slug = await this.nextSlug(tenantId, dto.slug || dto.title);

        const post = await this.db.tenantBlogPost.create({
            data: {
                tenant_id: tenantId,
                slug,
                status: BlogStatus.DRAFT,
                title: dto.title,
                body_md: dto.body_md,
                excerpt: dto.excerpt ?? null,
                category_id: dto.category_id || null,
                seo_title: dto.seo_title ?? null,
                seo_description: dto.seo_description ?? null,
                cover_alt: dto.cover_alt ?? null,
                author_user_id: actor.userId,
                author_name: dto.author_name ?? actor.name ?? null,
                scheduled_for: dto.scheduled_for ? new Date(dto.scheduled_for) : null,
                featured: dto.featured ?? false,
                reading_minutes: readingMinutes(dto.body_md),
            },
            include: { category: true },
        });

        await this.db.tenantBlogPostSlug.create({
            data: { tenant_id: tenantId, post_id: post.id, slug },
        });
        return post;
    }

    async update(tenantId: string, id: string, dto: UpsertTenantBlogPostDto) {
        const existing = await this.get(tenantId, id);

        let slug = existing.slug;
        if (dto.slug && dto.slug !== existing.slug) {
            slug = await this.nextSlug(tenantId, dto.slug, existing.id);
            await this.db.tenantBlogPostSlug.upsert({
                where: { tenant_id_slug: { tenant_id: tenantId, slug } },
                update: { post_id: existing.id },
                create: { tenant_id: tenantId, post_id: existing.id, slug },
            });
        }

        return this.db.tenantBlogPost.update({
            where: { id },
            data: {
                slug,
                title: dto.title,
                body_md: dto.body_md,
                excerpt: dto.excerpt ?? null,
                category_id: dto.category_id === undefined ? existing.category_id : dto.category_id || null,
                seo_title: dto.seo_title ?? null,
                seo_description: dto.seo_description ?? null,
                cover_alt: dto.cover_alt ?? existing.cover_alt,
                author_name: dto.author_name ?? existing.author_name,
                scheduled_for: dto.scheduled_for ? new Date(dto.scheduled_for) : null,
                featured: dto.featured ?? existing.featured,
                reading_minutes: readingMinutes(dto.body_md),
                ...(dto.mark_edited ? { edited_at: new Date() } : {}),
            },
            include: { category: true },
        });
    }

    async publish(tenantId: string, id: string, publishedAt?: string) {
        const post = await this.get(tenantId, id);
        this.assertTransition(post.status, BlogStatus.PUBLISHED);

        if (!post.title.trim() || !post.body_md.trim()) {
            throw new BadRequestException('A post needs a title and body before it can be published');
        }

        const settings = await this.db.tenantBlogSettings.findUnique({ where: { tenant_id: tenantId } });
        if (!settings?.enabled) {
            // Publishing into a blog nobody can reach looks like a bug from the
            // editor's side, so say what is actually wrong.
            throw new BadRequestException('Turn the storefront blog on before publishing');
        }

        return this.db.tenantBlogPost.update({
            where: { id },
            data: {
                status: BlogStatus.PUBLISHED,
                scheduled_for: null,
                published_at: post.published_at ?? (publishedAt ? new Date(publishedAt) : new Date()),
            },
            include: { category: true },
        });
    }

    async setStatus(tenantId: string, id: string, status: string) {
        const post = await this.get(tenantId, id);
        this.assertTransition(post.status, status);
        return this.db.tenantBlogPost.update({
            where: { id },
            data: { status },
            include: { category: true },
        });
    }

    async remove(tenantId: string, id: string) {
        const post = await this.get(tenantId, id);
        await this.dropCover(post.cover_storage_key);
        await this.db.tenantBlogPost.update({
            where: { id },
            data: { deleted_at: new Date(), cover_image_url: null, cover_storage_key: null },
        });
        return { success: true };
    }

    async setCover(tenantId: string, id: string, file: { buffer: Buffer; originalname?: string; mimetype?: string }) {
        const post = await this.get(tenantId, id);
        if (!this.assets.isEnabled()) throw new BadRequestException('Image uploads are not configured');
        if (!file?.buffer?.length) throw new BadRequestException('No file received');
        if (!file.mimetype?.startsWith('image/')) throw new BadRequestException('Cover must be an image');

        const uploaded = await this.assets.uploadBuffer(
            file.buffer,
            `${tenantId}/blog`,
            (file.originalname ?? 'cover').replace(/\.[^.]+$/, ''),
            'image',
        );

        const previous = post.cover_storage_key;
        const updated = await this.db.tenantBlogPost.update({
            where: { id },
            data: { cover_image_url: uploaded.url, cover_storage_key: uploaded.publicId },
        });
        await this.dropCover(previous);
        return updated;
    }

    async removeCover(tenantId: string, id: string) {
        const post = await this.get(tenantId, id);
        await this.dropCover(post.cover_storage_key);
        return this.db.tenantBlogPost.update({
            where: { id },
            data: { cover_image_url: null, cover_storage_key: null },
        });
    }

    // -----------------------------------------------------------------------
    // Categories
    // -----------------------------------------------------------------------

    async listCategories(tenantId: string) {
        return this.db.tenantBlogCategory.findMany({
            where: { tenant_id: tenantId, deleted_at: null },
            orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
        });
    }

    /**
     * Turn a one-line brief into a filled post for the shop owner to review.
     *
     * Billed, unlike the platform blog's equivalent: this is a tenant spending
     * its own AI credits, so the balance is checked before the call and the
     * tokens are logged after — including when the reply fails to parse, since
     * they were spent either way.
     */
    async draftWithAi(tenantId: string, dto: BlogAiDraftDto): Promise<BlogAiDraft> {
        await this.ai.enforceCredits(tenantId);

        const rows = await this.db.tenantBlogCategory.findMany({
            where: { tenant_id: tenantId, deleted_at: null },
            select: { id: true, name: true },
            orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
        });
        const categories = rows.map((row) => ({ id: row.id, name: row.name }));

        // One language, whatever the request asks for: a shop's post stores a
        // single title and body, so a second language would have nowhere to go
        // and would only spend the tenant's credits.
        const [locale] = resolveDraftLocales(dto);

        const model = await this.ai.getDefaultModel();
        const { systemPrompt, userMessage } = buildBlogDraftPrompt({
            prompt: dto.prompt,
            locale,
            categories,
            includeAudience: false,
        });

        const { text, usage, model: usedModel } = await this.ai.completeUnbilled(
            model,
            systemPrompt,
            userMessage,
            BLOG_DRAFT_MAX_TOKENS,
        );
        await this.ai.logUsage(tenantId, 'blog_post_draft', usedModel, usage);

        return normalizeBlogDraft(text, { categories, includeAudience: false, locale });
    }

    async createCategory(tenantId: string, dto: UpsertTenantBlogCategoryDto) {
        const existing = await this.db.tenantBlogCategory.findMany({
            where: { tenant_id: tenantId },
            select: { slug: true },
        });

        return this.db.tenantBlogCategory.create({
            data: {
                tenant_id: tenantId,
                slug: resolveSlug(dto.slug || dto.name, existing.map((row) => row.slug), 'category'),
                name: dto.name,
                sort_order: dto.sort_order ?? 0,
            },
        });
    }

    async updateCategory(tenantId: string, id: string, dto: UpsertTenantBlogCategoryDto) {
        const category = await this.db.tenantBlogCategory.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
        });
        if (!category) throw new NotFoundException('Category not found');

        return this.db.tenantBlogCategory.update({
            where: { id },
            data: { name: dto.name, sort_order: dto.sort_order ?? category.sort_order },
        });
    }

    async removeCategory(tenantId: string, id: string) {
        const category = await this.db.tenantBlogCategory.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
        });
        if (!category) throw new NotFoundException('Category not found');

        // Soft delete so the slug stays claimed for this shop; posts fall back
        // to uncategorised rather than disappearing from the index.
        await this.db.$transaction([
            this.db.tenantBlogPost.updateMany({
                where: { tenant_id: tenantId, category_id: id },
                data: { category_id: null },
            }),
            this.db.tenantBlogCategory.update({ where: { id }, data: { deleted_at: new Date() } }),
        ]);
        return { success: true };
    }

    // -----------------------------------------------------------------------
    // Scheduling
    // -----------------------------------------------------------------------

    @Cron(CronExpression.EVERY_HOUR)
    async publishDueScheduledPosts(): Promise<number> {
        const due = await this.db.tenantBlogPost.findMany({
            where: {
                deleted_at: null,
                status: BlogStatus.SCHEDULED,
                scheduled_for: { not: null, lte: new Date() },
                // A shop that switched its blog off between scheduling and the
                // due date should not have the post go live behind its back.
                tenant: { blogSettings: { enabled: true }, deleted_at: null },
            },
            select: { id: true, published_at: true, scheduled_for: true },
        });

        for (const post of due) {
            await this.db.tenantBlogPost.update({
                where: { id: post.id },
                data: {
                    status: BlogStatus.PUBLISHED,
                    published_at: post.published_at ?? post.scheduled_for ?? new Date(),
                    scheduled_for: null,
                },
            });
        }

        if (due.length) this.logger.log(`Published ${due.length} scheduled storefront blog post(s)`);
        return due.length;
    }

    // -----------------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------------

    private async nextSlug(tenantId: string, desired: string, exceptPostId?: string): Promise<string> {
        const [live, historic] = await Promise.all([
            this.db.tenantBlogPost.findMany({
                where: { tenant_id: tenantId, ...(exceptPostId ? { NOT: { id: exceptPostId } } : {}) },
                select: { slug: true },
            }),
            this.db.tenantBlogPostSlug.findMany({
                where: { tenant_id: tenantId, ...(exceptPostId ? { NOT: { post_id: exceptPostId } } : {}) },
                select: { slug: true },
            }),
        ]);

        return resolveSlug(desired, [...live.map((r) => r.slug), ...historic.map((r) => r.slug)]);
    }

    private assertTransition(from: string, to: string) {
        if (!canTransition(from, to)) {
            throw new BadRequestException(`Cannot move a post from ${from} to ${to}`);
        }
    }

    private async dropCover(storageKey: string | null | undefined) {
        if (!storageKey) return;
        try {
            await this.assets.deleteFile(storageKey, 'image');
        } catch (error) {
            this.logger.warn(`Failed to delete blog cover ${storageKey}: ${(error as Error).message}`);
        }
    }

    private toPublicListView(post: any) {
        return {
            slug: post.slug,
            title: post.title,
            excerpt: post.excerpt,
            cover_image_url: post.cover_image_url,
            cover_alt: post.cover_alt,
            author_name: post.author_name,
            published_at: post.published_at,
            edited_at: post.edited_at,
            reading_minutes: post.reading_minutes,
            featured: post.featured,
            category: post.category ? { slug: post.category.slug, name: post.category.name } : null,
        };
    }

    private toPublicDetailView(post: any) {
        return {
            ...this.toPublicListView(post),
            body_md: post.body_md,
            seo_title: post.seo_title,
            seo_description: post.seo_description,
            view_count: post.view_count,
        };
    }
}
