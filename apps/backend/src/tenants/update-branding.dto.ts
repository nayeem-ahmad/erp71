import { IsOptional, IsString, IsUrl, MaxLength, Matches } from 'class-validator';

export class UpdateBrandingDto {
    @IsOptional()
    @IsString()
    @Matches(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, { message: 'Must be a valid hex color' })
    brand_primary_color?: string;

    @IsOptional()
    @IsUrl()
    @MaxLength(500)
    brand_logo_url?: string;

    @IsOptional()
    @IsUrl()
    @MaxLength(500)
    brand_favicon_url?: string;

    @IsOptional()
    @IsString()
    @MaxLength(100)
    brand_business_name?: string;
}
