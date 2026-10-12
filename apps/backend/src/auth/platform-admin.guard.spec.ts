import { Controller, ForbiddenException, Get, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlatformRole } from '@erp71/shared-types';
import { PlatformAdminGuard } from './platform-admin.guard';
import { AllowPlatformRoles } from './platform-roles.decorator';

@Controller('admin/open')
@AllowPlatformRoles(PlatformRole.SUPPORT_ENGINEER)
class OpenController {
    @Get()
    read() {}
}

@Controller('admin/mixed')
class MixedController {
    @Get()
    adminOnly() {}

    @AllowPlatformRoles(PlatformRole.SUPPORT_ENGINEER)
    @Get('lookup')
    lookup() {}
}

function contextFor(user: any, controller: any, handler: string) {
    const request: any = { user };
    const context: any = {
        switchToHttp: () => ({ getRequest: () => request }),
        getHandler: () => controller.prototype[handler],
        getClass: () => controller,
    };
    return { context, request };
}

describe('PlatformAdminGuard', () => {
    const guard = new PlatformAdminGuard(new Reflector());
    const admin = { email: 'ops@erp71.com', isPlatformAdmin: true, platformRole: null };
    const support = { email: 'help@erp71.com', isPlatformAdmin: false, platformRole: 'SUPPORT_ENGINEER' };
    const tenantUser = { email: 'owner@shop.com', isPlatformAdmin: false, platformRole: null };

    it('requires a signed-in user', () => {
        const { context } = contextFor(undefined, MixedController, 'adminOnly');
        expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    });

    it('lets an admin through everywhere and flags the request', () => {
        const { context, request } = contextFor(admin, MixedController, 'adminOnly');
        expect(guard.canActivate(context)).toBe(true);
        expect(request.isPlatformAdmin).toBe(true);
        expect(request.platformRole).toBe(PlatformRole.ADMIN);
    });

    it('keeps a support engineer out of routes that do not name the role', () => {
        const { context } = contextFor(support, MixedController, 'adminOnly');
        expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('lets a support engineer through a handler that names the role', () => {
        const { context, request } = contextFor(support, MixedController, 'lookup');
        expect(guard.canActivate(context)).toBe(true);
        // Never the full-admin flag: other code reads that as "may do anything".
        expect(request.isPlatformAdmin).toBeUndefined();
        expect(request.platformRole).toBe(PlatformRole.SUPPORT_ENGINEER);
    });

    it('lets a support engineer through a controller that names the role', () => {
        const { context } = contextFor(support, OpenController, 'read');
        expect(guard.canActivate(context)).toBe(true);
    });

    it('keeps a tenant user out even where support engineers are allowed', () => {
        const { context } = contextFor(tenantUser, OpenController, 'read');
        expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });
});
