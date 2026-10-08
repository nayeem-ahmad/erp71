import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsNumber, IsOptional, Matches, Max, Min } from 'class-validator';
import { ALERT_TYPE_CODES } from './alert-types';

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class UpdateAlertPreferencesDto {
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(50)
    @IsIn(ALERT_TYPE_CODES as string[], { each: true })
    muted_types?: string[];

    @IsOptional()
    @IsBoolean()
    quiet_enabled?: boolean;

    @IsOptional()
    @Matches(HH_MM, { message: 'quiet_from must be HH:mm' })
    quiet_from?: string;

    @IsOptional()
    @Matches(HH_MM, { message: 'quiet_to must be HH:mm' })
    quiet_to?: string;
}

export class UpdateAlertThresholdsDto {
    @IsOptional()
    @IsNumber()
    @Min(1)
    @Max(100_000_000)
    large_sale_amount?: number;

    @IsOptional()
    @IsNumber()
    @Min(1)
    @Max(100_000_000)
    large_refund_amount?: number;

    @IsOptional()
    @IsNumber()
    @Min(1)
    @Max(10_000_000)
    till_shortfall_amount?: number;
}
