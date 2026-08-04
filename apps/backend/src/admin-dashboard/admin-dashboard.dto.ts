import { IsDateString, IsOptional } from 'class-validator';

/** Date-only (`YYYY-MM-DD`) window, read as whole local days by the service. */
export class AdminDashboardQueryDto {
    @IsOptional()
    @IsDateString()
    from?: string;

    @IsOptional()
    @IsDateString()
    to?: string;
}
