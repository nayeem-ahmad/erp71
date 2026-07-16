import { Controller, Get, HttpCode, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { DemoDataService } from './demo-data.service';

@Controller('tenants')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class DemoDataController {
    constructor(private readonly demoDataService: DemoDataService) {}

    /** Kicks off a six-month demo-data load; returns 202 with the batch handle. */
    @Post('demo-data')
    @HttpCode(202)
    async load(@Tenant() tenant: TenantContext) {
        return this.demoDataService.startBatch(tenant.tenantId, tenant.userId, tenant.userRole);
    }

    /** Latest batch for this tenant — the frontend polls this ~every 2s. */
    @Get('demo-data/status')
    async status(@Tenant() tenant: TenantContext) {
        return this.demoDataService.getStatus(tenant.tenantId);
    }
}
