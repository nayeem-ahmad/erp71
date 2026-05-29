import { IsIn, IsOptional } from 'class-validator';

const SUPPORTED_LOCALES = ['en', 'bn', 'ms'] as const;

export class UpdateLocalizationSettingsDto {
    @IsOptional()
    @IsIn(SUPPORTED_LOCALES)
    default_locale?: (typeof SUPPORTED_LOCALES)[number];
}