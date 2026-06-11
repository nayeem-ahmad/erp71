import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

const COMPOUND_UNIT_TYPES = ['none', 'ft_in', 'dozen_pcs', 'kg_g', 'lb_oz', 'm_cm'] as const;

export class CreateProductDto {
    @IsString()
    name: string;

    @IsOptional()
    @IsString()
    sku?: string;

    @IsNumber()
    @Min(0)
    price: number;

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

    @IsOptional()
    @IsBoolean()
    isFeatured?: boolean;
}

export class UpdateProductDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    sku?: string;

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

    @IsOptional()
    @IsBoolean()
    isFeatured?: boolean;
}
