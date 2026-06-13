import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { SystemHealthService } from './system-health.service';

/**
 * Platform-admin system health API. Unlike the public `GET /health` liveness
 * probe (used by Render), these endpoints return deep dependency status and
 * are restricted to platform admins.
 */
@Controller('admin/system-health')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class SystemHealthController {
    constructor(private readonly systemHealth: SystemHealthService) {}

    @Get()
    getReport() {
        return this.systemHealth.getReport();
    }

    @Get('dependencies')
    getDependencies() {
        return this.systemHealth.getDependencies();
    }

    @Get('jobs')
    getJobs() {
        return this.systemHealth.getJobStatuses();
    }
}
