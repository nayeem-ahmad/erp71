import { Body, Controller, Get, Put, UseGuards, UseInterceptors } from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireStorePermission } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { DatabaseService } from '../database/database.service';
import { DEFAULT_QUIET } from '../notifications/alert-policy';
import { AlertSettingsService } from './alert-settings.service';
import { ALERT_TYPES } from './alert-types';
import { UpdateAlertPreferencesDto, UpdateAlertThresholdsDto } from './alerts.dto';

const toClock = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const toMinutes = (clock: string) => {
    const [h, m] = clock.split(':').map(Number);
    return h * 60 + m;
};

/**
 * What reaches this person's phone in this workspace, and the shop's alert
 * lines. Preferences are the caller's own; the lines are the shop's and need
 * MANAGE_USERS to change.
 */
@Controller('alerts')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class AlertsController {
    constructor(
        private readonly db: DatabaseService,
        private readonly settings: AlertSettingsService,
    ) {}

    @Get('preferences')
    async preferences(@Tenant() tenant: TenantContext) {
        return this.describe(tenant);
    }

    @Put('preferences')
    async updatePreferences(@Tenant() tenant: TenantContext, @Body() dto: UpdateAlertPreferencesDto) {
        const data = {
            ...(dto.muted_types ? { muted_types: [...new Set(dto.muted_types)] } : {}),
            ...(dto.quiet_enabled !== undefined ? { quiet_enabled: dto.quiet_enabled } : {}),
            ...(dto.quiet_from ? { quiet_from: toMinutes(dto.quiet_from) } : {}),
            ...(dto.quiet_to ? { quiet_to: toMinutes(dto.quiet_to) } : {}),
        };
        await this.db.userAlertPreference.upsert({
            where: { user_id_tenant_id: { user_id: tenant.userId, tenant_id: tenant.tenantId } },
            create: { user_id: tenant.userId, tenant_id: tenant.tenantId, ...data },
            update: data,
        });
        return this.describe(tenant);
    }

    @RequireStorePermission(StorePermission.MANAGE_USERS)
    @Put('thresholds')
    async updateThresholds(@Tenant() tenant: TenantContext, @Body() dto: UpdateAlertThresholdsDto) {
        await this.settings.update(tenant.tenantId, dto);
        return this.describe(tenant);
    }

    private async describe(tenant: TenantContext) {
        const [preference, thresholds] = await Promise.all([
            this.db.userAlertPreference.findUnique({
                where: { user_id_tenant_id: { user_id: tenant.userId, tenant_id: tenant.tenantId } },
            }),
            this.settings.get(tenant.tenantId),
        ]);
        return {
            types: ALERT_TYPES,
            muted_types: preference?.muted_types ?? [],
            quiet: {
                enabled: preference?.quiet_enabled ?? true,
                from: toClock(preference?.quiet_from ?? DEFAULT_QUIET.from),
                to: toClock(preference?.quiet_to ?? DEFAULT_QUIET.to),
            },
            thresholds,
        };
    }
}
