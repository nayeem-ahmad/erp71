import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PATH_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { BlogController } from './blog.controller';
import { BlogAdminController } from './blog-admin.controller';

/**
 * Two facts about this module's auth are load-bearing and neither is visible in
 * the service tests.
 *
 * The public controller has *no* guard, deliberately — it serves anonymous
 * readers and crawlers. That is only safe because every read goes through the
 * status/audience filter, so the absence of a guard and the presence of that
 * filter have to be asserted together; the service spec covers the filter and
 * this covers the absence, with a comment tying them.
 *
 * The admin controller's guards are the entire access control for authoring.
 * A stripped decorator leaves every other test green while opening
 * `POST /admin/blog/posts` to any logged-in user of any tenant.
 */
function guardsOn(target: any, method?: string): any[] {
    const source = method ? target.prototype[method] : target;
    return Reflect.getMetadata(GUARDS_METADATA, source) ?? [];
}

describe('BlogController (public)', () => {
    const service = {
        listPublic: jest.fn(),
        getPublicBySlug: jest.fn(),
        listCategories: jest.fn(),
        recordView: jest.fn(),
        getUnreadState: jest.fn(),
        markSeen: jest.fn(),
    } as any;

    let controller: BlogController;

    beforeEach(() => {
        jest.clearAllMocks();
        controller = new BlogController(service);
    });

    it('leaves the reader routes unguarded on purpose', () => {
        // Anonymous visitors and crawlers must reach these. What keeps drafts
        // off them is BlogService.visibleWhere(), asserted in the service spec.
        expect(guardsOn(BlogController)).toEqual([]);
        expect(guardsOn(BlogController, 'listPublic')).toEqual([]);
        expect(guardsOn(BlogController, 'getBySlug')).toEqual([]);
        expect(guardsOn(BlogController, 'listCategories')).toEqual([]);
        expect(guardsOn(BlogController, 'recordView')).toEqual([]);
    });

    it('requires a login for the in-app feed and its read marker', () => {
        expect(guardsOn(BlogController, 'listUpdates')).toContain(JwtAuthGuard);
        expect(guardsOn(BlogController, 'unread')).toContain(JwtAuthGuard);
        expect(guardsOn(BlogController, 'markSeen')).toContain(JwtAuthGuard);
    });

    it('asks the service for the public surface on the public routes', async () => {
        await controller.listPublic('bn', 'guides', '2', '10');
        expect(service.listPublic).toHaveBeenCalledWith({
            surface: 'public',
            locale: 'bn',
            categorySlug: 'guides',
            page: 2,
            limit: 10,
        });
    });

    it('asks the service for the in-app surface on the updates route', async () => {
        await controller.listUpdates('en', undefined, undefined, undefined);
        expect(service.listPublic).toHaveBeenCalledWith(
            expect.objectContaining({ surface: 'in_app' }),
        );
    });

    it('marks the feed seen for the caller, never for an id in the request', async () => {
        // The only user a request may mark read is its own; there is no path
        // that takes a user id from the client.
        await controller.markSeen({ user: { userId: 'user-7' } });
        expect(service.markSeen).toHaveBeenCalledWith('user-7');
    });

    it('declares the literal updates routes before the :slug route that would shadow them', () => {
        // Nest matches in declaration order, so `posts/:slug` declared first
        // would swallow nothing here — but `updates` declared *after*
        // `posts/:slug` would still be reachable while `updates/unread` would
        // not. Order is guaranteed by nothing except position in the file.
        const order = Object.getOwnPropertyNames(BlogController.prototype).filter((k) => k !== 'constructor');
        expect(order.indexOf('listUpdates')).toBeLessThan(order.indexOf('getBySlug'));
        expect(order.indexOf('unread')).toBeLessThan(order.indexOf('getBySlug'));
    });
});

describe('BlogAdminController', () => {
    it('is platform-admin only, at class level so no route can miss it', () => {
        const guards = guardsOn(BlogAdminController);
        expect(guards).toContain(JwtAuthGuard);
        expect(guards).toContain(PlatformAdminGuard);
    });

    it('sits under admin/ so the audit interceptor records it as a platform action', () => {
        expect(Reflect.getMetadata(PATH_METADATA, BlogAdminController)).toBe('admin/blog');
    });

    it('exposes publishing as its own route rather than a status field', () => {
        // Keeps the transition rules in one place and gives the audit trail a
        // distinguishable action instead of another generic update.
        const methods = Object.getOwnPropertyNames(BlogAdminController.prototype);
        expect(methods).toEqual(expect.arrayContaining(['publish', 'unpublish', 'archive']));
    });

    // The AI endpoint spends platform money on every call. Without the class
    // guards any logged-in user of any tenant could burn it.
    it('keeps the AI draft route behind the platform-admin guards', () => {
        expect(guardsOn(BlogAdminController)).toEqual([JwtAuthGuard, PlatformAdminGuard]);
        expect(typeof BlogAdminController.prototype.draftWithAi).toBe('function');
    });
});
