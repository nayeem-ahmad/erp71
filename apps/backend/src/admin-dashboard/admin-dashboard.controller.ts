import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { AdminDashboardService } from './admin-dashboard.service';
import { AdminDashboardQueryDto } from './admin-dashboard.dto';

/**
 * Platform-scoped, so `PlatformAdminGuard` and deliberately **no**
 * `TenantInterceptor`: every figure here spans all tenants, and a tenant scope
 * would silently reduce the platform to whichever workspace the admin happens
 * to have selected.
 */
@Controller('admin/dashboard')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class AdminDashboardController {
    constructor(private readonly service: AdminDashboardService) {}

    @Get('overview')
    getOverview(@Query() query: AdminDashboardQueryDto) {
        return this.service.getOverview(query);
    }

    @Get('trends')
    getTrends(@Query() query: AdminDashboardQueryDto) {
        return this.service.getTrends(query);
    }
}
