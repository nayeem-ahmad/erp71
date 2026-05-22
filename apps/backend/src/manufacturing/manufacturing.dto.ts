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
