import { Body, Controller, Get, Param, Post, Put, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { NAV_REGISTRY, type NavLayoutNode, type NavScope } from '@erp71/shared-types';
import { NavigationService } from './navigation.service';
import { SaveNavLayoutDto } from './navigation.dto';

@Controller('admin/navigation')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class NavigationAdminController {
    constructor(private readonly navigation: NavigationService) {}

    @Get('registry')
    getRegistry() {
        return {
            entries: Object.values(NAV_REGISTRY).map((entry) => ({
                id: entry.id,
                kind: entry.kind,
                icon: entry.icon,
                labelKey: entry.labelKey,
                href: entry.href ?? null,
                moduleKey: entry.moduleKey ?? null,
                advancedOnly: entry.advancedOnly ?? false,
                premiumOnly: entry.premiumOnly ?? false,
                platformFeature: entry.platformFeature ?? null,
            })),
        };
    }

    @Get('layout/:scope')
    getLayout(@Param('scope') scope: NavScope) {
        return this.navigation.getLayout(scope);
    }

    @Put('layout/:scope')
    saveLayout(
        @Param('scope') scope: NavScope,
        @Body() dto: SaveNavLayoutDto,
        @Request() req: { user: { userId: string } },
    ) {
        return this.navigation.saveLayout(scope, dto.layout as NavLayoutNode[], req.user.userId);
    }

    @Post('layout/:scope/reset')
    resetLayout(
        @Param('scope') scope: NavScope,
        @Request() req: { user: { userId: string } },
    ) {
        return this.navigation.resetLayout(scope, req.user.userId);
    }

    @Get('tenant-overrides')
    listTenantOverrides() {
        return this.navigation.listTenantNavOverrides();
    }

    @Post('tenant-overrides/reset-all')
    resetAllTenantOverrides(@Request() req: { user: { userId: string } }) {
        return this.navigation.resetAllTenantNavLayouts(req.user.userId);
    }

    @Get('tenant-overrides/:tenantId')
    getTenantOverride(@Param('tenantId') tenantId: string) {
        return this.navigation.getTenantNavOverride(tenantId);
    }

    @Post('tenant-overrides/:tenantId/reset')
    resetTenantOverride(
        @Param('tenantId') tenantId: string,
        @Request() req: { user: { userId: string } },
    ) {
        return this.navigation.resetTenantNavLayout(tenantId, req.user.userId);
    }
}