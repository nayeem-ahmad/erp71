import {
    IsString,
    IsNotEmpty,
    IsEmail,
    IsIn,
    IsOptional,
    IsArray,
    IsBoolean,
    ValidateNested,
    IsInt,
    Min,
    MaxLength,
    MinLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

const emptyToUndefined = ({ value }: { value: unknown }) =>
    value === '' || value === null ? undefined : value;

export class PlaceOrderItemDto {
    @IsString()
    @IsNotEmpty()
    productId: string;

    @IsInt()
    @Min(1)
    quantity: number;
}

export class PlaceOrderDto {
    @IsString()
    @IsNotEmpty()
    customerName: string;

    @IsEmail()
    customerEmail: string;

    @IsOptional()
    @IsString()
    customerPhone?: string;

    @IsOptional()
    @IsString()
    notes?: string;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => PlaceOrderItemDto)
    items: PlaceOrderItemDto[];

    @IsOptional()
    @IsInt()
    @Min(0)
    pointsToRedeem?: number;
}

export class UpdateOrderStatusDto {
    @IsString()
    @IsNotEmpty()
    status: string;
}

export class CustomerSignupDto {
    @IsString()
    @IsNotEmpty()
    name: string;

    @IsEmail()
    email: string;

    @IsString()
    @MinLength(8)
    password: string;

    @IsString()
    @IsNotEmpty()
    phone: string;
}

export class CustomerLoginDto {
    @IsEmail()
    email: string;

    @IsString()
    @IsNotEmpty()
    password: string;
}

export class CustomerTwoFactorLoginDto {
    @IsString()
    @IsNotEmpty()
    userId: string;

    @IsString()
    @IsNotEmpty()
    code: string;
}

export class StorefrontSettingsDto {
    @IsOptional()
    @IsString()
    storefront_slug?: string;

    @IsOptional()
    storefront_enabled?: boolean;

    @IsOptional()
    @IsString()
    storefront_banner?: string;

    @IsOptional()
    @IsString()
    storefront_hero_image?: string;

    @IsOptional()
    @IsString()
    storefront_hero_headline?: string;

    @IsOptional()
    @IsString()
    storefront_logo?: string;

    @IsOptional()
    @IsBoolean()
    storefront_logo_show_name?: boolean;
}

/** What the storefront settings page can hang an uploaded image on. */
export const STOREFRONT_IMAGE_KINDS = ['hero', 'logo'] as const;

export type StorefrontImageKind = (typeof STOREFRONT_IMAGE_KINDS)[number];

export class UploadStorefrontImageDto {
    /** A `data:` URL or a bare base64 string, as `FileReader` produces. */
    @IsString()
    imageBase64: string;

    /**
     * Which slot the image is for. It picks the storage folder and the filename
     * stem only — the column it eventually lands in is decided by the settings
     * PATCH that follows, not by this.
     */
    @IsIn(STOREFRONT_IMAGE_KINDS)
    kind: StorefrontImageKind;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsString()
    mimeType?: string;

    /** Used as the stored filename stem only; never shown to a shopper. */
    @IsOptional()
    @Transform(emptyToUndefined)
    @IsString()
    @MaxLength(200)
    fileName?: string;
}
