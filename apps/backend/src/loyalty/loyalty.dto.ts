import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpdateLoyaltySettingsDto {
    @IsOptional()
    @IsBoolean()
    loyalty_points_enabled?: boolean;

    @IsOptional()
    @IsNumber()
    @Min(0)
    loyalty_earn_rate?: number;

    @IsOptional()
    @IsNumber()
    @Min(0)
    loyalty_redeem_rate?: number;

    @IsOptional()
    @IsInt()
    @Min(0)
    loyalty_min_redeem?: number;
}

export class EarnPointsDto {
    @IsOptional()
    @IsString()
    saleId?: string;

    @IsNumber()
    @Min(0)
    saleTotal: number;
}

export class RedeemPointsDto {
    @IsInt()
    @Min(1)
    points: number;
}

export class AdjustPointsDto {
    @IsInt()
    points: number;

    @IsOptional()
    @IsString()
    description?: string;
}
