import { IsDateString, IsOptional } from 'class-validator';

/** Date-only (`YYYY-MM-DD`) window, read as whole local days by the service. */
export class SalesDashboardQueryDto {
    @IsOptional()
    @IsDateString()
    from?: string;

    @IsOptional()
    @IsDateString()
    to?: string;
}
