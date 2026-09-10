import { Controller, Get, Param } from '@nestjs/common';
import { StorefrontPagesService } from './storefront-pages.service';

/**
 * A shop's pages and menu as the public sees them, under its storefront slug.
 *
 * Unguarded, like the rest of `/storefront/:slug` — these are the shop's own
 * marketing pages and owners want them found. What limits the surface is the
 * service: the storefront switch has to be on, and a page has to be published.
 *
 * Covered by the global ThrottlerGuard.
 */
@Controller('storefront/:slug')
export class PublicStorefrontPagesController {
    constructor(private readonly service: StorefrontPagesService) {}

    @Get('menu')
    getMenu(@Param('slug') slug: string) {
        return this.service.getPublicMenu(slug);
    }

    /** Declared before `pages/:pageSlug`, which would otherwise shadow it. */
    @Get('pages/sitemap')
    sitemap(@Param('slug') slug: string) {
        return this.service.listPublishedPageSlugs(slug);
    }

    @Get('pages/:pageSlug')
    getPage(@Param('slug') slug: string, @Param('pageSlug') pageSlug: string) {
        return this.service.getPublicPage(slug, pageSlug);
    }
}
