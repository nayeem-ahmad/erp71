import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { AdminTenantsService } from './admin-tenants.service';

@Controller('admin/metrics')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class AdminMetricsController {
    constructor(private readonly adminTenantsService: AdminTenantsService) {}

    @Get()
    getMetrics() {
        return this.adminTenantsService.getMetrics();
    }
}
