import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    IsArray,
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
export class PlanFeaturesDto {
    @IsNumber()
    @Min(1)
    @Max(100)
    maxStores!: number;

    @IsNumber()
    @Min(1)
    @Max(500)
    maxUsers!: number;

    @IsNumber()
    @Min(-1)
    @Max(1_000_000)
    maxSkus!: number;

    @IsBoolean()
    premiumAccounting!: boolean;

    @IsBoolean()
    premiumInventoryReports!: boolean;

    @IsBoolean()
    premiumCrm!: boolean;

    @IsBoolean()
    multiStore!: boolean;

    @IsBoolean()
    apiAccess!: boolean;

    @IsBoolean()
    accountingOnly!: boolean;

    @IsNumber()
    @Min(0)
    @Max(3)
    planRank!: number;

    @IsNumber()
    @Min(0)
    @Max(100_000)
    aiCreditsMonthly!: number;
}

export class UpdateSubscriptionPlanDto {
    @IsString()
    @MaxLength(80)
    name!: string;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    description?: string | null;

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

    @IsObject()
    @ValidateNested()
    @Type(() => PlanFeaturesDto)
    features!: PlanFeaturesDto;

    @IsOptional()
    @IsArray()
    @ArrayMaxSize(20)
    @IsString({ each: true })
    @MaxLength(200, { each: true })
    marketing_features?: string[];
}

