import {
    IsString,
    IsOptional,
    IsBoolean,
    IsEnum,
    IsNumber,
    Min,
    Max,
    IsUUID,
    ValidateIf,
} from 'class-validator';
import { PriceListDiscountType } from '@prisma/client';

export class CreatePriceListDto {
    @IsString()
    name: string;

    @IsOptional()
    @IsString()
    description?: string;

    @IsOptional()
    @IsBoolean()
    is_default?: boolean;

    @IsOptional()
    @IsEnum(PriceListDiscountType)
    overall_discount_type?: PriceListDiscountType;

    @ValidateIf((o) => o.overall_discount_type != null)
    @IsNumber()
    @Min(0)
    overall_discount_value?: number;
}

export class UpdatePriceListDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    description?: string;

    @IsOptional()
    @IsBoolean()
    is_default?: boolean;

    @IsOptional()
    @IsBoolean()
    is_active?: boolean;

    @IsOptional()
    @IsEnum(PriceListDiscountType)
    overall_discount_type?: PriceListDiscountType | null;

    @IsOptional()
    @IsNumber()
    @Min(0)
    overall_discount_value?: number | null;
}

export class UpdatePriceListItemDto {
    @IsOptional()
    @IsNumber()
    @Min(0)
    selling_price?: number | null;

    @IsOptional()
    @IsEnum(PriceListDiscountType)
    discount_type?: PriceListDiscountType | null;

    @IsOptional()
    @IsNumber()
    @Min(0)
    @Max(100)
    discount_value?: number | null;
}

export class BulkUpdatePriceListItemsDto {
    @IsUUID('4', { each: true })
    product_ids: string[];

    @IsOptional()
    @IsNumber()
    @Min(0)
    selling_price?: number | null;

    @IsOptional()
    @IsEnum(PriceListDiscountType)
    discount_type?: PriceListDiscountType | null;

    @IsOptional()
    @IsNumber()
    @Min(0)
    discount_value?: number | null;
}