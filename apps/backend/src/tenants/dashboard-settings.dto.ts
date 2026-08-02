import { IsIn, IsOptional } from 'class-validator';
import { DASHBOARD_PREFERENCES, type DashboardPreference } from '@erp71/shared-types';

export class UpdateDashboardSettingsDto {
    @IsOptional()
    @IsIn(DASHBOARD_PREFERENCES)
    dashboard_preference?: DashboardPreference;
}
