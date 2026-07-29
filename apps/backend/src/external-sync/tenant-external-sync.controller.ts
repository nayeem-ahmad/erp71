import {
    Body,
    Controller,
    Delete,
    ForbiddenException,
    Get,
    Param,
    Post,
    Put,
    Query,
    ServiceUnavailableException,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { ExternalSyncService } from './external-sync.service';
import {
    ListExternalSyncRunsQueryDto,
    RunExternalSyncDto,
    TestExternalSyncConnectionDto,
    UpsertExternalSyncConnectionDto,
} from './external-sync.dto';

/**
 * The tenant-facing half of the external-ERP import, reached from Settings ›
 * Data Management. The platform-admin controller keeps its own route; this one
 * exists so a tenant can migrate its own history without us driving it.
 *
 * Two gates, and they are different in kind. `externalImport` is a per-tenant
 * feature the platform operator turns on, so this is invisible until we decide
 * a tenant should have it. Ownership is about *who inside* that tenant: an
 * import writes documents across the whole business and takes third-party
 * credentials, which is not something a shop-floor role should reach.
 *
 * One capability is deliberately withheld: `post_impacts`. Turning it on
 * replays history into stock, party balances and the ledger, and doing that
 * against a tenant that already has opening balances double-counts its books.
 * That call needs the preconditions checked (see TODO.md), so it stays with
 * platform admins — a tenant admin can see the setting but not change it.
 */
@Controller('tenants/external-sync')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class TenantExternalSyncController {
    constructor(
        private readonly externalSyncService: ExternalSyncService,
        private readonly platformSettings: PlatformSettingsService,
    ) {}

    private async assertAllowed(tenant: TenantContext) {
        const enabled = await this.platformSettings.isFeatureEnabledForTenant('externalImport', tenant.tenantId);
        if (!enabled) {
            throw new ServiceUnavailableException('External ERP import is not enabled for this workspace.');
        }
        if (tenant.userRole !== 'OWNER') {
            throw new ForbiddenException('Only the workspace owner can configure the external ERP import.');
        }
    }

    @Get()
    async getConnection(@Tenant() tenant: TenantContext) {
        await this.assertAllowed(tenant);
        return this.externalSyncService.getConnection(tenant.tenantId);
    }

    @Put()
    async upsertConnection(@Tenant() tenant: TenantContext, @Body() dto: UpsertExternalSyncConnectionDto) {
        await this.assertAllowed(tenant);
        // Whatever the client sent, posting stays a platform-admin decision:
        // drop the field rather than reject, so the tenant form can round-trip
        // the connection it was given without having to strip it first.
        const { postImpacts: _ignored, ...safe } = dto;
        return this.externalSyncService.upsertConnection(tenant.tenantId, safe, tenant.userId);
    }

    @Delete()
    async deleteConnection(@Tenant() tenant: TenantContext) {
        await this.assertAllowed(tenant);
        return this.externalSyncService.deleteConnection(tenant.tenantId);
    }

    @Post('test')
    async testConnection(@Tenant() tenant: TenantContext, @Body() dto: TestExternalSyncConnectionDto) {
        await this.assertAllowed(tenant);
        return this.externalSyncService.testConnection(tenant.tenantId, dto);
    }

    @Post('runs')
    async startRun(@Tenant() tenant: TenantContext, @Body() dto: RunExternalSyncDto) {
        await this.assertAllowed(tenant);
        return this.externalSyncService.startRun(tenant.tenantId, dto, 'MANUAL', tenant.userId);
    }

    @Get('runs')
    async listRuns(@Tenant() tenant: TenantContext, @Query() query: ListExternalSyncRunsQueryDto) {
        await this.assertAllowed(tenant);
        return this.externalSyncService.listRuns(tenant.tenantId, query);
    }

    @Post('runs/:runId/cancel')
    async cancelRun(@Tenant() tenant: TenantContext, @Param('runId') runId: string) {
        await this.assertAllowed(tenant);
        return this.externalSyncService.cancelRun(tenant.tenantId, runId);
    }
}
