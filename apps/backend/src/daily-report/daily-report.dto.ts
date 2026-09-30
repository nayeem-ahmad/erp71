import { IsOptional, IsString, IsUUID, Matches } from 'class-validator';

export class GetDailyReportDto {
    @IsOptional()
    @IsString()
    @Matches(/^\d{4}-\d{2}-\d{2}$/)
    date?: string;

    @IsOptional()
    @IsUUID()
    storeId?: string;

    @IsOptional()
    @IsString()
    locale?: string;
}
