import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DatabaseService } from '../database/database.service';
import { AssetsService } from '../assets/assets.service';
import { resolveSlug } from './blog-slug';
import { readingMinutes } from './reading-time';
import { BlogStatus, canTransition, isInAppAudience, isPublicAudience } from './blog-status';
import { UpsertBlogCategoryDto, UpsertBlogPostDto } from './blog.dto';

const DEFAULT_LOCALE = 'en';
const MAX_PAGE_SIZE = 50;

export type PublicSurface = 'public' | 'in_app';

type TranslationRow = {
    locale: string;
    title: string;
    excerpt: string | null;
    body_md: string;
    seo_title: string | null;
    seo_description: string | null;
};

/**
 * Pick the reader's locale, falling back to English.
 *
 * The fallback is unconditional rather than best-effort: `en` is required on
 * every post the service will publish, so this cannot return undefined for a
 * published row, and a missing Bangla translation shows the English article
 * rather than a blank page.
 */
export function pickTranslation<T extends { locale: string }>(
    translations: T[],
    locale: string,
): T | undefined {
    return (
        translations.find((row) => row.locale === locale) ??
        translations.find((row) => row.locale === DEFAULT_LOCALE) ??
        translations[0]
    );
}

@Injectable()
export class BlogService {
    private readonly logger = new Logger(BlogService.name);

    constructor(
        private readonly db: DatabaseService,
        private readonly assets: AssetsService,
    ) {}

    // -----------------------------------------------------------------------
    // Reads
    // -----------------------------------------------------------------------

    /**
     * The single filter every public read goes through.
     *
     * Draft leakage is this module's main risk, and the mitigation is that
     * there is exactly one place that decides what "visible" means. Any new
     * read path must call this rather than assembling its own `where`.
     */
    private visibleWhere(surface: PublicSurface) {
        const audiences = surface === 'public' ? ['PUBLIC', 'BOTH'] : ['IN_APP', 'BOTH'];
        return {
            deleted_at: null,
            status: BlogStatus.PUBLISHED,
            published_at: { not: null, lte: new Date() },
            audience: { in: audiences },
        };
    }

    async listPublic(options: {
        surface: PublicSurface;
        locale?: string;
        categorySlug?: string;
        page?: number;
        limit?: number;
        since?: Date;
    }) {
        const locale = options.locale ?? DEFAULT_LOCALE;
        const limit = Math.min(Math.max(options.limit ?? 12, 1), MAX_PAGE_SIZE);
        const page = Math.max(options.page ?? 1, 1);

        const where: Record<string, unknown> = { ...this.visibleWhere(options.surface) };
        if (options.categorySlug) where.category = { slug: options.categorySlug };
        if (options.since) {
            where.published_at = { not: null, lte: new Date(), gt: options.since };
        }

        const [rows, total] = await Promise.all([
            this.db.blogPost.findMany({
                where: where as any,
                // Featured first, then newest. `published_at` and not `created_at`
                // so a backdated import lands where its date says it should.
                orderBy: [{ featured: 'desc' }, { published_at: 'desc' }],
                skip: (page - 1) * limit,
                take: limit,
                include: {
                    category: true,
                    translations: true,
                },
            }),
            this.db.blogPost.count({ where: where as any }),
        ]);

        return {
            rows: rows.map((row) => this.toListView(row, locale)),
            total,
            page,
            limit,
        };
    }

    /**
     * One post by slug, or a redirect target when the slug is historic.
     *
     * Returning `{ redirect_to }` rather than throwing lets the route issue a
     * 301 — a renamed post that 404s has thrown away the inbound links that
     * were the reason to publish it.
     */
    async getPublicBySlug(slug: string, options: { surface: PublicSurface; locale?: string }) {
        const locale = options.locale ?? DEFAULT_LOCALE;

        const post = await this.db.blogPost.findFirst({
            where: { slug, ...(this.visibleWhere(options.surface) as any) },
            include: { category: true, translations: true },
        });

        if (post) return { post: this.toDetailView(post, locale), redirect_to: null };

        const historic = await this.db.blogPostSlug.findUnique({
            where: { slug },
            include: { post: { select: { slug: true, status: true, deleted_at: true, audience: true } } },
        });

        const target = historic?.post;
        const stillVisible =
            target &&
            !target.deleted_at &&
            target.status === BlogStatus.PUBLISHED &&
            (options.surface === 'public' ? isPublicAudience(target.audience) : isInAppAudience(target.audience));

        if (stillVisible) return { post: null, redirect_to: target!.slug };

        throw new NotFoundException('Post not found');
    }

    async listCategories() {
        return this.db.blogCategory.findMany({ orderBy: [{ sort_order: 'asc' }, { name_en: 'asc' }] });
    }

    /**
     * Counted separately from the article GET so an ISR revalidation or a
     * crawler does not inflate the number — only a real browser calls this.
     */
    async recordView(slug: string): Promise<void> {
        await this.db.blogPost.updateMany({
            where: { slug, ...(this.visibleWhere('public') as any) },
            data: { view_count: { increment: 1 } },
        });
    }

    /** Newest publish time on the in-app feed — drives the unread dot. */
    async latestInAppPublishedAt(): Promise<Date | null> {
        const newest = await this.db.blogPost.findFirst({
            where: this.visibleWhere('in_app') as any,
            orderBy: { published_at: 'desc' },
            select: { published_at: true },
        });
        return newest?.published_at ?? null;
    }

    async getUnreadState(userId: string) {
        const [user, latest] = await Promise.all([
            this.db.user.findUnique({ where: { id: userId }, select: { blog_last_seen_at: true } }),
            this.latestInAppPublishedAt(),
        ]);

        const lastSeen = user?.blog_last_seen_at ?? null;
        return {
            latest_published_at: latest,
            last_seen_at: lastSeen,
            has_unread: !!latest && (!lastSeen || latest > lastSeen),
        };
    }

    async markSeen(userId: string) {
        await this.db.user.update({
            where: { id: userId },
            data: { blog_last_seen_at: new Date() },
        });
        return { success: true };
    }

    // -----------------------------------------------------------------------
    // Admin reads
    // -----------------------------------------------------------------------

    async adminList(options: { status?: string; page?: number; limit?: number; search?: string }) {
        const limit = Math.min(Math.max(options.limit ?? 25, 1), MAX_PAGE_SIZE);
        const page = Math.max(options.page ?? 1, 1);

        const where: Record<string, unknown> = { deleted_at: null };
        if (options.status) where.status = options.status;
        if (options.search) {
            where.translations = {
                some: { title: { contains: options.search, mode: 'insensitive' } },
            };
        }

        const [rows, total] = await Promise.all([
            this.db.blogPost.findMany({
                where: where as any,
                orderBy: [{ updated_at: 'desc' }],
                skip: (page - 1) * limit,
                take: limit,
                include: { category: true, translations: true },
            }),
            this.db.blogPost.count({ where: where as any }),
        ]);

        return { rows: rows.map((row) => this.toAdminListView(row)), total, page, limit };
    }

    async adminGet(id: string) {
        const post = await this.db.blogPost.findFirst({
            where: { id, deleted_at: null },
            include: { category: true, translations: true, slugHistory: true },
        });
        if (!post) throw new NotFoundException('Post not found');
        return post;
    }

    // -----------------------------------------------------------------------
    // Writes
    // -----------------------------------------------------------------------

    async create(dto: UpsertBlogPostDto, actor: { userId?: string; name?: string | null }) {
        const english = this.requireEnglish(dto.translations);
        const slug = await this.nextSlug(dto.slug || english.title);

        const post = await this.db.blogPost.create({
            data: {
                slug,
                status: BlogStatus.DRAFT,
                audience: dto.audience ?? 'BOTH',
                category_id: dto.category_id || null,
                cover_alt: dto.cover_alt ?? null,
                author_user_id: actor.userId ?? null,
                author_name: dto.author_name ?? actor.name ?? null,
                author_title: dto.author_title ?? null,
                scheduled_for: dto.scheduled_for ? new Date(dto.scheduled_for) : null,
                featured: dto.featured ?? false,
                reading_minutes: readingMinutes(english.body_md),
                translations: { create: dto.translations.map((t) => this.translationData(t)) },
            },
            include: { category: true, translations: true },
        });

        await this.db.blogPostSlug.create({ data: { post_id: post.id, slug } });
        return post;
    }

    async update(id: string, dto: UpsertBlogPostDto) {
        const existing = await this.adminGet(id);
        const english = this.requireEnglish(dto.translations);

        let slug = existing.slug;
        if (dto.slug && dto.slug !== existing.slug) {
            slug = await this.nextSlug(dto.slug, existing.id);
            // The old slug stays claimed forever, so nothing else can take it
            // and its redirect keeps pointing here.
            await this.db.blogPostSlug.upsert({
                where: { slug },
                update: { post_id: existing.id },
                create: { post_id: existing.id, slug },
            });
        }

        return this.db.$transaction(async (tx) => {
            // Full replacement: a locale the editor removed must actually go,
            // and a merge would leave no way to delete one.
            await tx.blogPostTranslation.deleteMany({ where: { post_id: id } });

            return tx.blogPost.update({
                where: { id },
                data: {
                    slug,
                    audience: dto.audience ?? existing.audience,
                    category_id: dto.category_id === undefined ? existing.category_id : dto.category_id || null,
                    cover_alt: dto.cover_alt ?? existing.cover_alt,
                    author_name: dto.author_name ?? existing.author_name,
                    author_title: dto.author_title ?? existing.author_title,
                    scheduled_for: dto.scheduled_for ? new Date(dto.scheduled_for) : null,
                    featured: dto.featured ?? existing.featured,
                    reading_minutes: readingMinutes(english.body_md),
                    ...(dto.mark_edited ? { edited_at: new Date() } : {}),
                    translations: { create: dto.translations.map((t) => this.translationData(t)) },
                },
                include: { category: true, translations: true },
            });
        });
    }

    async publish(id: string, publishedAt?: string) {
        const post = await this.adminGet(id);
        this.assertTransition(post.status, BlogStatus.PUBLISHED);

        const english = post.translations.find((t) => t.locale === DEFAULT_LOCALE);
        // Enforced here rather than in the DTO because it is a property of the
        // stored post, not of one request: an edit could have removed the
        // English row long after the post was created.
        if (!english || !english.title.trim() || !english.body_md.trim()) {
            throw new BadRequestException('A post needs an English title and body before it can be published');
        }

        return this.db.blogPost.update({
            where: { id },
            data: {
                status: BlogStatus.PUBLISHED,
                scheduled_for: null,
                // Set once and never moved. Re-publishing after an unpublish
                // keeps the original date, so fixing a typo does not push a
                // year-old article back to the top of the index.
                published_at: post.published_at ?? (publishedAt ? new Date(publishedAt) : new Date()),
            },
            include: { category: true, translations: true },
        });
    }

    async unpublish(id: string) {
        const post = await this.adminGet(id);
        this.assertTransition(post.status, BlogStatus.DRAFT);
        return this.db.blogPost.update({
            where: { id },
            data: { status: BlogStatus.DRAFT },
            include: { category: true, translations: true },
        });
    }

    async archive(id: string) {
        const post = await this.adminGet(id);
        this.assertTransition(post.status, BlogStatus.ARCHIVED);
        return this.db.blogPost.update({
            where: { id },
            data: { status: BlogStatus.ARCHIVED },
            include: { category: true, translations: true },
        });
    }

    /**
     * Soft delete, and the cover asset goes with it.
     *
     * The row is kept so its slugs stay claimed — a deleted post's URL must not
     * become available to a later one, or the old inbound links would resolve
     * to unrelated content.
     */
    async remove(id: string) {
        const post = await this.adminGet(id);
        await this.dropCover(post.cover_storage_key);
        await this.db.blogPost.update({
            where: { id },
            data: { deleted_at: new Date(), cover_image_url: null, cover_storage_key: null },
        });
        return { success: true };
    }

    async setCover(id: string, file: { buffer: Buffer; originalname?: string; mimetype?: string }) {
        const post = await this.adminGet(id);
        if (!this.assets.isEnabled()) {
            throw new BadRequestException('Image uploads are not configured');
        }
        if (!file?.buffer?.length) throw new BadRequestException('No file received');
        if (!file.mimetype?.startsWith('image/')) {
            throw new BadRequestException('Cover must be an image');
        }

        const uploaded = await this.assets.uploadBuffer(
            file.buffer,
            'blog',
            (file.originalname ?? 'cover').replace(/\.[^.]+$/, ''),
            'image',
        );

        // Replace, then drop the old one — losing the new upload to a failed
        // delete would be the worse trade.
        const previous = post.cover_storage_key;
        const updated = await this.db.blogPost.update({
            where: { id },
            data: { cover_image_url: uploaded.url, cover_storage_key: uploaded.publicId },
        });
        await this.dropCover(previous);
        return updated;
    }

    async removeCover(id: string) {
        const post = await this.adminGet(id);
        await this.dropCover(post.cover_storage_key);
        return this.db.blogPost.update({
            where: { id },
            data: { cover_image_url: null, cover_storage_key: null },
        });
    }

    // -----------------------------------------------------------------------
    // Categories
    // -----------------------------------------------------------------------

    async createCategory(dto: UpsertBlogCategoryDto) {
        const existing = await this.db.blogCategory.findMany({ select: { slug: true } });
        return this.db.blogCategory.create({
            data: {
                slug: resolveSlug(dto.slug || dto.name_en, existing.map((row) => row.slug), 'category'),
                name_en: dto.name_en,
                name_bn: dto.name_bn ?? null,
                name_ms: dto.name_ms ?? null,
                sort_order: dto.sort_order ?? 0,
            },
        });
    }

    async updateCategory(id: string, dto: UpsertBlogCategoryDto) {
        const category = await this.db.blogCategory.findUnique({ where: { id } });
        if (!category) throw new NotFoundException('Category not found');

        return this.db.blogCategory.update({
            where: { id },
            data: {
                name_en: dto.name_en,
                name_bn: dto.name_bn ?? null,
                name_ms: dto.name_ms ?? null,
                sort_order: dto.sort_order ?? category.sort_order,
            },
        });
    }

    /** Posts keep their content and lose the category (`onDelete: SetNull`). */
    async removeCategory(id: string) {
        await this.db.blogCategory.delete({ where: { id } });
        return { success: true };
    }

    // -----------------------------------------------------------------------
    // Scheduling
    // -----------------------------------------------------------------------

    /**
     * Flip due SCHEDULED posts to PUBLISHED.
     *
     * Hourly rather than by the minute: a marketing post does not need
     * to-the-second timing, and an hourly job is one the ops team can reason
     * about. Idempotent — a post already PUBLISHED is not in the query.
     */
    @Cron(CronExpression.EVERY_HOUR)
    async publishDueScheduledPosts(): Promise<number> {
        const due = await this.db.blogPost.findMany({
            where: {
                deleted_at: null,
                status: BlogStatus.SCHEDULED,
                scheduled_for: { not: null, lte: new Date() },
            },
            select: { id: true, published_at: true, scheduled_for: true },
        });

        for (const post of due) {
            await this.db.blogPost.update({
                where: { id: post.id },
                data: {
                    status: BlogStatus.PUBLISHED,
                    published_at: post.published_at ?? post.scheduled_for ?? new Date(),
                    scheduled_for: null,
                },
            });
        }

        if (due.length) this.logger.log(`Published ${due.length} scheduled blog post(s)`);
        return due.length;
    }

    // -----------------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------------

    private requireEnglish(translations: { locale: string; title: string; body_md: string }[]) {
        const english = translations.find((t) => t.locale === DEFAULT_LOCALE);
        if (!english) {
            throw new BadRequestException('Every post needs an English translation');
        }
        return english;
    }

    private translationData(t: {
        locale: string;
        title: string;
        excerpt?: string;
        body_md: string;
        seo_title?: string;
        seo_description?: string;
    }) {
        return {
            locale: t.locale,
            title: t.title,
            excerpt: t.excerpt ?? null,
            body_md: t.body_md,
            seo_title: t.seo_title ?? null,
            seo_description: t.seo_description ?? null,
        };
    }

    /**
     * Slugs are checked against history as well as live posts: reusing one a
     * different post used to hold would hijack that post's permanent redirect.
     */
    private async nextSlug(desired: string, exceptPostId?: string): Promise<string> {
        const [live, historic] = await Promise.all([
            this.db.blogPost.findMany({
                where: exceptPostId ? { NOT: { id: exceptPostId } } : {},
                select: { slug: true },
            }),
            this.db.blogPostSlug.findMany({
                where: exceptPostId ? { NOT: { post_id: exceptPostId } } : {},
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
            // A stranded image costs storage; a failed delete must not block the
            // edit that triggered it.
            this.logger.warn(`Failed to delete blog cover ${storageKey}: ${(error as Error).message}`);
        }
    }

    private toListView(post: any, locale: string) {
        const t = pickTranslation<TranslationRow>(post.translations, locale);
        return {
            id: post.id,
            slug: post.slug,
            locale: t?.locale ?? DEFAULT_LOCALE,
            title: t?.title ?? '',
            excerpt: t?.excerpt ?? null,
            cover_image_url: post.cover_image_url,
            cover_alt: post.cover_alt,
            author_name: post.author_name,
            author_title: post.author_title,
            published_at: post.published_at,
            edited_at: post.edited_at,
            reading_minutes: post.reading_minutes,
            featured: post.featured,
            category: post.category
                ? { slug: post.category.slug, name_en: post.category.name_en, name_bn: post.category.name_bn, name_ms: post.category.name_ms }
                : null,
            available_locales: post.translations.map((row: TranslationRow) => row.locale),
        };
    }

    private toDetailView(post: any, locale: string) {
        const t = pickTranslation<TranslationRow>(post.translations, locale);
        return {
            ...this.toListView(post, locale),
            body_md: t?.body_md ?? '',
            seo_title: t?.seo_title ?? null,
            seo_description: t?.seo_description ?? null,
            view_count: post.view_count,
        };
    }

    private toAdminListView(post: any) {
        const english = post.translations.find((t: TranslationRow) => t.locale === DEFAULT_LOCALE);
        return {
            id: post.id,
            slug: post.slug,
            status: post.status,
            audience: post.audience,
            title: english?.title ?? post.translations[0]?.title ?? '(untitled)',
            author_name: post.author_name,
            category: post.category ? { id: post.category.id, name_en: post.category.name_en } : null,
            published_at: post.published_at,
            scheduled_for: post.scheduled_for,
            updated_at: post.updated_at,
            view_count: post.view_count,
            featured: post.featured,
            locales: post.translations.map((t: TranslationRow) => t.locale),
        };
    }
}
