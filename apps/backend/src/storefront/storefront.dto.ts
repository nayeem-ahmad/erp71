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

/**
 * A Google ID token from Google Identity Services, exchanged for a storefront
 * session. One DTO for both buttons: an unrecognised Google account is signed
 * *up* rather than turned away, exactly as it is on the ERP login page.
 */
export class CustomerGoogleSignInDto {
    @IsString({ message: 'Google sign-in failed. Please try again.' })
    @IsNotEmpty({ message: 'Google sign-in failed. Please try again.' })
    credential: string;

    /**
     * Optional, and only ever supplied by the sign-up page, which has a phone
     * field on the form. Google never hands over a phone number, so without this
     * a shop ends up with a customer record it cannot ring. Unverified — see
     * `customerGoogleSignIn` for why that stops it linking anything.
     */
    @IsOptional()
    @IsString()
    phone?: string;
}

/**
 * A Firebase phone ID token, minted after the browser has already put an SMS
 * one-time code in front of the shopper.
 */
export class CustomerMobileSignInDto {
    @IsString()
    @IsNotEmpty()
    idToken: string;

    /**
     * Required only when the number belongs to nobody yet: `User.email` is
     * non-null and unique, so an account cannot be created without one. The
     * first call omits it and gets `requires_signup` back; the second sends the
     * same token again with the address the shopper then typed.
     */
    @IsOptional()
    @IsEmail()
    email?: string;

    @IsOptional()
    @IsString()
    name?: string;
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
