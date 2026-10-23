import { Body, Controller, Get, Put, UseGuards, UseInterceptors } from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireStorePermission } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { DatabaseService } from '../database/database.service';
import { PreferencesService } from '../preferences/preferences.service';
import { profileAlertsFor, resolveAlertPrefs } from '../notifications/alert-policy';
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
        private readonly memberPrefs: PreferencesService,
    ) {}

    @Get('preferences')
    async preferences(@Tenant() tenant: TenantContext) {
        return this.describe(tenant);
    }

    @Put('preferences')
    async updatePreferences(@Tenant() tenant: TenantContext, @Body() dto: UpdateAlertPreferencesDto) {
        // Only the fields sent: the rest stay whatever the member sees now, profile or built-in.
        const quiet = {
            ...(dto.quiet_enabled !== undefined ? { enabled: dto.quiet_enabled } : {}),
            ...(dto.quiet_from ? { from: toMinutes(dto.quiet_from) } : {}),
            ...(dto.quiet_to ? { to: toMinutes(dto.quiet_to) } : {}),
        };
        await this.memberPrefs.saveSection(tenant.tenantId, tenant.userId, 'alerts', {
            ...(dto.muted_types ? { mutedTypes: [...new Set(dto.muted_types)] } : {}),
            ...(Object.keys(quiet).length > 0 ? { quiet } : {}),
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
        // A row is the member's whole answer; only without one does the profile speak.
        const alerts = resolveAlertPrefs(
            preference,
            preference ? undefined : await profileAlertsFor(this.memberPrefs, tenant.tenantId, tenant.userId),
        );
        return {
            types: ALERT_TYPES,
            muted_types: alerts.mutedTypes,
            quiet: {
                enabled: alerts.quiet.enabled,
                from: toClock(alerts.quiet.from),
                to: toClock(alerts.quiet.to),
            },
            thresholds,
        };
    }
}
