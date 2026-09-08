import { Body, Controller, Get, HttpCode, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { DemoDataService } from './demo-data.service';
import { LoadDemoDataDto } from './demo-data.dto';
import { DEMO_MODULE_GROUPS, DEFAULT_DEMO_MONTHS, MAX_DEMO_MONTHS, MIN_DEMO_MONTHS } from './generator/options';
import { ANOMALY_KINDS } from './generator/anomalies';

@Controller('tenants')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class DemoDataController {
    constructor(private readonly demoDataService: DemoDataService) {}

    /**
     * Kicks off a demo-data load; returns 202 with the batch handle. An empty
     * body loads everything — the options exist for topping a store up with a
     * second, differently-shaped batch.
     */
    @Post('demo-data')
    @HttpCode(202)
    async load(@Tenant() tenant: TenantContext, @Body() dto: LoadDemoDataDto) {
        return this.demoDataService.startBatch(tenant.tenantId, tenant.userId, tenant.userRole, dto);
    }

    /** Latest batch for this tenant — the frontend polls this ~every 2s. */
    @Get('demo-data/status')
    async status(@Tenant() tenant: TenantContext) {
        return this.demoDataService.getStatus(tenant.tenantId);
    }

    /** Every batch this store has loaded, newest first. */
    @Get('demo-data/batches')
    async batches(@Tenant() tenant: TenantContext) {
        return this.demoDataService.listBatches(tenant.tenantId);
    }

    /**
     * What the load can be asked for, so the frontend does not hardcode the
     * module list or the anomaly catalogue.
     */
    @Get('demo-data/options')
    options() {
        return {
            modules: DEMO_MODULE_GROUPS,
            months: { min: MIN_DEMO_MONTHS, max: MAX_DEMO_MONTHS, default: DEFAULT_DEMO_MONTHS },
            anomalyKinds: ANOMALY_KINDS.map((spec) => ({
                kind: spec.kind, label: spec.label, module: spec.module, severity: spec.severity, hint: spec.hint,
            })),
        };
    }
}
