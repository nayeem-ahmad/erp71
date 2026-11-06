import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { PaginationDto } from '../common/pagination.dto';
import { IsStoreIdOrAll } from '../common/store-id-or-all.validator';

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

/**
 * The query behind the loyalty customers list and the stats strip above it.
 * Every key is declared because the global ValidationPipe runs with
 * `forbidNonWhitelisted`.
 */
export class LoyaltyCustomerListQueryDto extends PaginationDto {
    @IsOptional()
    @IsString()
    search?: string;

    /** A branch id or `all`; resolved to the customers the member may see. */
    @IsOptional()
    @IsStoreIdOrAll()
    storeId?: string;

    /** The points balance — `gt:0`, `between:100,500`; see `readNumberConditionQuery`. */
    @IsOptional()
    @IsString()
    points?: string;

    /** Customers with points activity on or after this day, `YYYY-MM-DD`. */
    @IsOptional()
    @IsString()
    activeFrom?: string;

    @IsOptional()
    @IsString()
    activeTo?: string;

    /** Comma-separated EARN / REDEEM / ADJUST: activity of those kinds only. */
    @IsOptional()
    @IsString()
    activityType?: string;

    @IsOptional()
    @IsString()
    sortBy?: string;

    @IsOptional()
    @IsString()
    sortDir?: string;
}
