import {
    IsBoolean,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    IsUUID,
    MaxLength,
    Min,
    MinLength,
    ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
    STOREFRONT_MENU_LINK_TYPES,
    STOREFRONT_PAGE_STATUSES,
} from './storefront-page-constants';

export class UpsertStorefrontPageDto {
    @IsString()
    @MinLength(1)
    @MaxLength(200)
    title!: string;

    @IsString()
    @MaxLength(200_000)
    body_md!: string;

    /** Omitted on create means "derive one from the title". */
    @IsOptional()
    @IsString()
    @MaxLength(120)
    slug?: string;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    seo_title?: string;

    @IsOptional()
    @IsString()
    @MaxLength(400)
    seo_description?: string;
}

export class StorefrontPageStatusDto {
    @IsIn(STOREFRONT_PAGE_STATUSES as unknown as string[])
    status!: string;
}

export class UpsertStorefrontMenuLinkDto {
    @IsString()
    @MinLength(1)
    @MaxLength(60)
    label!: string;

    @IsIn(STOREFRONT_MENU_LINK_TYPES as unknown as string[])
    type!: string;

    /** Required when `type` is PAGE; ignored otherwise. */
    @IsOptional()
    @IsUUID()
    page_id?: string | null;

    /** Required when `type` is INTERNAL or EXTERNAL; ignored otherwise. */
    @IsOptional()
    @IsString()
    @MaxLength(500)
    url?: string | null;

    @IsOptional()
    @IsInt()
    @Min(0)
    sort_order?: number;

    @IsOptional()
    @IsBoolean()
    visible?: boolean;

    @IsOptional()
    @IsBoolean()
    open_in_new_tab?: boolean;
}

/**
 * Visibility on its own, rather than through `UpsertStorefrontMenuLinkDto`.
 *
 * A full upsert re-validates the link's target, so hiding a link whose page has
 * since been deleted would be refused — and hiding it is exactly what an owner
 * reaches for when they see the editor flag it as broken.
 */
export class StorefrontMenuLinkVisibilityDto {
    @IsBoolean()
    visible!: boolean;
}

class MenuLinkOrderEntryDto {
    @IsUUID()
    id!: string;

    @IsInt()
    @Min(0)
    sort_order!: number;
}

/** Whole-menu reorder: the client sends the order it is showing, not a delta. */
export class ReorderStorefrontMenuDto {
    @ValidateNested({ each: true })
    @Type(() => MenuLinkOrderEntryDto)
    links!: MenuLinkOrderEntryDto[];
}
