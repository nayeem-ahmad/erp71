import { IsDateString, IsOptional } from 'class-validator';

/** Date-only (`YYYY-MM-DD`) window, read as whole local days by the service. */
export class PurchaseDashboardQueryDto {
    @IsOptional()
    @IsDateString()
    from?: string;

    @IsOptional()
    @IsDateString()
    to?: string;
}
