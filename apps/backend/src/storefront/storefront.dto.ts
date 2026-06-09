import {
    IsString,
    IsNotEmpty,
    IsEmail,
    IsOptional,
    IsArray,
    ValidateNested,
    IsInt,
    Min,
    MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

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
}
