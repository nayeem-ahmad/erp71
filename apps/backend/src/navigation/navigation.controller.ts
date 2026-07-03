import { Controller, Get, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { NavigationService } from './navigation.service';
import type { NavScope } from '@erp71/shared-types';

type LayoutRequest = {
    tenantId?: string;
};

@Controller('navigation')
@UseGuards(JwtAuthGuard)
export class NavigationController {
    constructor(private readonly navigation: NavigationService) {}

    @Get('layout')
    @UseInterceptors(TenantInterceptor)
    getLayout(
        @Query('scope') scope: NavScope = 'tenant' as NavScope,
        @Req() req: LayoutRequest,
    ) {
        const tenantId = scope === 'tenant' ? req.tenantId : undefined;
        return this.navigation.getLayout(scope, tenantId);
    }
}