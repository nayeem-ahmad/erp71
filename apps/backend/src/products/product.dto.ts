import { IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

const COMPOUND_UNIT_TYPES = ['none', 'ft_in', 'dozen_pcs', 'kg_g', 'lb_oz', 'm_cm'] as const;

export enum ProductTypeDto {
    GOODS = 'GOODS',
    SERVICE = 'SERVICE',
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
     * What a unit costs to buy. Seeds the weighted-average pool when the
     * product is created with opening stock. Optional — a product entered
     * without one simply has no cost basis until its first purchase receipt,
     * which is more honest than assuming the selling price.
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
}
