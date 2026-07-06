import {
    IsString,
    IsNotEmpty,
    IsOptional,
    IsInt,
    IsPositive,
    IsArray,
    ValidateNested,
    IsNumber,
    MaxLength,
    Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class BomComponentDto {
    @IsString()
    @IsNotEmpty()
    productId: string;

    @IsNumber()
    @IsPositive()
    quantity: number;
}

export class CreateBomDto {
    @IsString()
    @IsNotEmpty()
    productId: string;

    @IsInt()
    @IsPositive()
    outputQty: number;

    @IsOptional()
    @IsString()
    @MaxLength(1000)
    notes?: string;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => BomComponentDto)
    components: BomComponentDto[];
}

export class UpdateBomDto {
    @IsOptional()
    @IsInt()
    @IsPositive()
    outputQty?: number;

    @IsOptional()
    @IsString()
    @MaxLength(1000)
    notes?: string;

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => BomComponentDto)
    components?: BomComponentDto[];
}

export class CreateProductionJobDto {
    @IsString()
    @IsNotEmpty()
    recipeId: string;

    @IsInt()
    @IsPositive()
    quantity: number;

    @IsOptional()
    @IsString()
    @MaxLength(1000)
    notes?: string;
}

export class UpdateProductionJobDto {
    @IsOptional()
    @IsString()
    status?: 'DRAFT' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

    @IsOptional()
    @IsString()
    @MaxLength(1000)
    notes?: string;
}

export class WastageItemDto {
    @IsString()
    @IsNotEmpty()
    productId: string;

    @IsNumber()
    @IsPositive()
    quantity: number;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    note?: string;
}

export class CompleteProductionJobDto {
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => WastageItemDto)
    wastage?: WastageItemDto[];
}

export class CreateJobCostDto {
    @IsString()
    @IsNotEmpty()
    costType: 'PRINTING' | 'BINDING' | 'TRANSPORT' | 'LABOR' | 'OVERHEAD' | 'OTHER';

    @IsNumber()
    @IsPositive()
    amount: number;

    @IsOptional()
    @IsString()
    sourcePurchaseItemId?: string;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    notes?: string;
}

export class ApplySuggestedPriceDto {
    @IsNumber()
    @Min(0)
    marginPct: number;
}
