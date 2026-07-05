import { Type } from 'class-transformer';
import {
    IsBoolean,
    IsNumber,
    IsObject,
    IsOptional,
    IsString,
    Max,
    MaxLength,
    Min,
    ValidateNested,
} from 'class-validator';
import { PlanFeaturesDto } from '../subscription-plans/subscription-plans.dto';

export class CreateAddonModuleDto {
    @IsString()
    @MaxLength(60)
    code!: string;

    @IsString()
    @MaxLength(80)
    name!: string;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    description?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(40)
    category?: string | null;

    @IsNumber()
    @Min(0)
    @Max(1_000_000)
    monthly_price!: number;

    @IsOptional()
    @IsNumber()
    @Min(0)
    @Max(10_000_000)
    yearly_price?: number | null;

    @IsOptional()
    @IsBoolean()
    is_active?: boolean;

    @IsOptional()
    @IsNumber()
    @Min(0)
    @Max(1000)
    sort_order?: number;

    @IsObject()
    @ValidateNested()
    @Type(() => PlanFeaturesDto)
    features!: PlanFeaturesDto;
}

export class UpdateAddonModuleDto {
    @IsString()
    @MaxLength(80)
    name!: string;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    description?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(40)
    category?: string | null;

    @IsNumber()
    @Min(0)
    @Max(1_000_000)
    monthly_price!: number;

    @IsOptional()
    @IsNumber()
    @Min(0)
    @Max(10_000_000)
    yearly_price?: number | null;

    @IsBoolean()
    is_active!: boolean;

    @IsOptional()
    @IsNumber()
    @Min(0)
    @Max(1000)
    sort_order?: number;

    @IsObject()
    @ValidateNested()
    @Type(() => PlanFeaturesDto)
    features!: PlanFeaturesDto;
}
