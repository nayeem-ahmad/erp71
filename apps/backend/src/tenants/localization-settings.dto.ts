import { IsIn, IsOptional, IsString } from 'class-validator';
import { ENABLED_LOCALE_CODES, type SupportedLocaleCode } from '@erp71/shared-types';

export class UpdateLocalizationSettingsDto {
    @IsOptional()
    @IsIn(ENABLED_LOCALE_CODES)
    default_locale?: SupportedLocaleCode;

    /**
     * IANA zone name, e.g. `Asia/Dhaka`. Validated in the service against the
     * runtime's own zone database rather than a hardcoded list here, so the
     * allowed set never drifts from what the date arithmetic can actually use.
     */
    @IsOptional()
    @IsString()
    timezone?: string;
}
