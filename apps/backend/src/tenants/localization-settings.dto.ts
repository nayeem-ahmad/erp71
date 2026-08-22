import { IsIn, IsOptional } from 'class-validator';
import { ENABLED_LOCALE_CODES, type SupportedLocaleCode } from '@erp71/shared-types';

export class UpdateLocalizationSettingsDto {
    @IsOptional()
    @IsIn(ENABLED_LOCALE_CODES)
    default_locale?: SupportedLocaleCode;
}