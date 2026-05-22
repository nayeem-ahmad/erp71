import {
    IsString,
    IsNotEmpty,
    IsEmail,
    IsOptional,
    IsArray,
    ValidateNested,
    IsInt,
    Min,
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
}

export class UpdateOrderStatusDto {
    @IsString()
    @IsNotEmpty()
    status: string;
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
}
