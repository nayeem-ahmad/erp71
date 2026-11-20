import { IsBoolean, IsIn, IsOptional, IsString, IsUrl, MaxLength, Matches } from 'class-validator';
import { UI_SIDEBARS, UI_THEMES, type UiSidebar, type UiTheme } from '@erp71/shared-types';

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

    @IsOptional()
    @IsIn(UI_THEMES)
    ui_theme?: UiTheme;

    @IsOptional()
    @IsIn(UI_SIDEBARS)
    ui_sidebar?: UiSidebar;

    /** The sidebar's "Recent" list, for the whole workspace. */
    @IsOptional()
    @IsBoolean()
    nav_recent_enabled?: boolean;
}
