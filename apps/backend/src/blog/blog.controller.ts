import { Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BlogService } from './blog.service';

/**
 * The reader-facing half of the platform blog.
 *
 * The list and detail routes carry no auth guard on purpose: they serve
 * erp71.com/blog to anonymous visitors and search crawlers, and requiring a
 * token would defeat the point of publishing. What keeps drafts off them is
 * `BlogService.visibleWhere()`, which every read here goes through — the
 * absence of a guard and the presence of that filter are one decision, and the
 * specs assert them together.
 *
 * The global ThrottlerGuard still applies.
 */
@Controller('blog')
export class BlogController {
    constructor(private readonly service: BlogService) {}

    @Get('posts')
    listPublic(
        @Query('locale') locale?: string,
        @Query('category') category?: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        return this.service.listPublic({
            surface: 'public',
            locale,
            categorySlug: category,
            page: page ? parseInt(page, 10) : undefined,
            limit: limit ? parseInt(limit, 10) : undefined,
        });
    }

    @Get('categories')
    listCategories() {
        return this.service.listCategories();
    }

    /**
     * Declared before `posts/:slug` — Nest matches in declaration order, and a
     * literal route added after a parameterised one is shadowed by it.
     */
    @Get('updates')
    @UseGuards(JwtAuthGuard)
    listUpdates(
        @Query('locale') locale?: string,
        @Query('since') since?: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        return this.service.listPublic({
            surface: 'in_app',
            locale,
            since: since ? new Date(since) : undefined,
            page: page ? parseInt(page, 10) : undefined,
            limit: limit ? parseInt(limit, 10) : undefined,
        });
    }

    @Get('updates/unread')
    @UseGuards(JwtAuthGuard)
    unread(@Req() req: any) {
        return this.service.getUnreadState(req.user.userId);
    }

    @Post('updates/seen')
    @UseGuards(JwtAuthGuard)
    markSeen(@Req() req: any) {
        return this.service.markSeen(req.user.userId);
    }

    @Get('posts/:slug')
    getBySlug(@Param('slug') slug: string, @Query('locale') locale?: string) {
        return this.service.getPublicBySlug(slug, { surface: 'public', locale });
    }

    /** Separate from the GET so ISR revalidation and crawlers do not count. */
    @Post('posts/:slug/view')
    async recordView(@Param('slug') slug: string) {
        await this.service.recordView(slug);
        return { success: true };
    }
}
