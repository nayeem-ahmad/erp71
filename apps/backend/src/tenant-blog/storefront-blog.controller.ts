import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { TenantBlogService } from './tenant-blog.service';

/**
 * A shop's blog as the public sees it, under that shop's storefront slug.
 *
 * Unguarded, like the rest of `/storefront/:slug` — these pages are marketing
 * and shop owners want them found. What limits the surface is the service's
 * `visibleWhere()` plus the two switches it checks: the storefront must be on
 * and the blog must be on.
 *
 * Covered by the global ThrottlerGuard.
 */
@Controller('storefront/:slug/blog')
export class StorefrontBlogController {
    constructor(private readonly service: TenantBlogService) {}

    @Get('posts')
    list(
        @Param('slug') slug: string,
        @Query('category') category?: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        return this.service.listPublic(slug, {
            categorySlug: category,
            page: page ? parseInt(page, 10) : undefined,
            limit: limit ? parseInt(limit, 10) : undefined,
        });
    }

    /** Declared before `posts/:postSlug`, which would otherwise shadow it. */
    @Get('sitemap')
    sitemap(@Param('slug') slug: string) {
        return this.service.listPublishedSlugs(slug);
    }

    @Get('posts/:postSlug')
    get(@Param('slug') slug: string, @Param('postSlug') postSlug: string) {
        return this.service.getPublicBySlug(slug, postSlug);
    }

    @Post('posts/:postSlug/view')
    async recordView(@Param('slug') slug: string, @Param('postSlug') postSlug: string) {
        await this.service.recordView(slug, postSlug);
        return { success: true };
    }
}
