import { IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { IsStoreIdOrAll } from '../common/store-id-or-all.validator';
import { TAKE_FIELDS, type TakeField } from './products.merge';

const COMPOUND_UNIT_TYPES = ['none', 'ft_in', 'dozen_pcs', 'kg_g', 'lb_oz', 'm_cm'] as const;

export enum ProductTypeDto {
    GOODS = 'GOODS',
    SERVICE = 'SERVICE',
}

/**
 * Shows the product on the storefront as a size/colour of others: join the
 * variant group `familyId`, or start one named `newFamilyName` on
 * `optionNames`. `optionValues` is this product's own: `{ Size: 'M' }`.
 */
export class ProductVariantAssignmentDto {
    @IsOptional()
    @IsUUID()
    familyId?: string;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    newFamilyName?: string;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    optionNames?: string[];

    @IsObject()
    optionValues: Record<string, string>;
}

export class CreateProductDto {
    @IsString()
    name: string;

    @IsOptional()
    @IsString()
    sku?: string;

    @IsOptional()
    @IsEnum(ProductTypeDto)
    type?: ProductTypeDto;

    @IsNumber()
    @Min(0)
    price: number;

    /**
     * What a unit costs to buy. Seeds the weighted-average pool: through the
     * opening-stock movement when there is opening stock, otherwise as an
     * opening cost held until the first receipt replaces it. Optional — a
     * product entered without one simply has no cost basis until its first
     * purchase receipt, which is more honest than assuming the selling price.
     */
    @IsOptional()
    @IsNumber()
    @Min(0)
    cost?: number;

    @IsOptional()
    @IsNumber()
    @Min(0)
    initialStock?: number;

    @IsOptional()
    @IsString()
    image_url?: string;

    @IsOptional()
    @IsUUID()
    brandId?: string;

    @IsOptional()
    @IsUUID()
    groupId?: string;

    @IsOptional()
    @IsUUID()
    subgroupId?: string;

    @IsOptional()
    @IsInt()
    @Min(0)
    reorderLevel?: number;

    @IsOptional()
    @IsInt()
    @Min(0)
    safetyStock?: number;

    @IsOptional()
    @IsInt()
    @Min(0)
    leadTimeDays?: number;

    @IsOptional()
    @IsBoolean()
    warrantyEnabled?: boolean;

    @IsOptional()
    @IsInt()
    @Min(0)
    warrantyDurationDays?: number;

    @IsOptional()
    @IsString()
    @IsIn(COMPOUND_UNIT_TYPES)
    unitType?: string;

    /**
     * মূসকের হার — the VAT rate this commodity is supplied at, when it differs
     * from the workspace default. An explicit `0` means zero-rated or exempt
     * and is NOT the same as leaving it unset, which inherits the default.
     */
    @IsOptional()
    @IsNumber()
    @Min(0)
    @Max(100)
    vatRate?: number | null;

    /**
     * সম্পূরক শুল্কের হার — supplementary duty, charged on Third Schedule goods
     * only and levied on the value of the supply *before* VAT. There is no
     * workspace default to inherit: SD attaches to a commodity, never to a
     * business.
     */
    @IsOptional()
    @IsNumber()
    @Min(0)
    @Max(100)
    sdRate?: number | null;

    @IsOptional()
    @IsBoolean()
    isFeatured?: boolean;

    @IsOptional()
    @IsString()
    description?: string;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    images_gallery?: string[];

    /** Group the product as a storefront variant, in the same save. */
    @IsOptional()
    @ValidateNested()
    @Type(() => ProductVariantAssignmentDto)
    variant?: ProductVariantAssignmentDto;
}

export class UpdateProductDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    sku?: string;

    @IsOptional()
    @IsEnum(ProductTypeDto)
    type?: ProductTypeDto;

    @IsOptional()
    @IsNumber()
    @Min(0)
    price?: number;

    @IsOptional()
    @IsString()
    image_url?: string;

    @IsOptional()
    @IsUUID()
    brandId?: string;

    @IsOptional()
    @IsUUID()
    groupId?: string;

    @IsOptional()
    @IsUUID()
    subgroupId?: string;

    @IsOptional()
    @IsInt()
    @Min(0)
    reorderLevel?: number;

    @IsOptional()
    @IsInt()
    @Min(0)
    safetyStock?: number;

    @IsOptional()
    @IsInt()
    @Min(0)
    leadTimeDays?: number;

    @IsOptional()
    @IsBoolean()
    warrantyEnabled?: boolean;

    @IsOptional()
    @IsInt()
    @Min(0)
    warrantyDurationDays?: number;

    @IsOptional()
    @IsString()
    @IsIn(COMPOUND_UNIT_TYPES)
    unitType?: string;

    /**
     * মূসকের হার — the VAT rate this commodity is supplied at, when it differs
     * from the workspace default. An explicit `0` means zero-rated or exempt
     * and is NOT the same as leaving it unset, which inherits the default.
     */
    @IsOptional()
    @IsNumber()
    @Min(0)
    @Max(100)
    vatRate?: number | null;

    /**
     * সম্পূরক শুল্কের হার — supplementary duty, charged on Third Schedule goods
     * only and levied on the value of the supply *before* VAT. There is no
     * workspace default to inherit: SD attaches to a commodity, never to a
     * business.
     */
    @IsOptional()
    @IsNumber()
    @Min(0)
    @Max(100)
    sdRate?: number | null;

    @IsOptional()
    @IsBoolean()
    isFeatured?: boolean;

    @IsOptional()
    @IsString()
    description?: string;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    images_gallery?: string[];

    /** Group the product as a storefront variant, in the same save. */
    @IsOptional()
    @ValidateNested()
    @Type(() => ProductVariantAssignmentDto)
    variant?: ProductVariantAssignmentDto;

    /** Take the product out of its storefront variant group. Ignored when `variant` is sent. */
    @IsOptional()
    @IsBoolean()
    leaveVariantGroup?: boolean;
}

export class MergeProductDto {
    @IsUUID()
    targetId: string;

    @IsOptional()
    @IsArray()
    @IsIn([...TAKE_FIELDS], { each: true })
    takeFields?: TakeField[];
}

/** The dashboard low-stock tile: one branch, `all`, or (omitted) the caller's default. */
export class LowStockCountQueryDto {
    @IsOptional()
    @IsStoreIdOrAll()
    storeId?: string;
}
