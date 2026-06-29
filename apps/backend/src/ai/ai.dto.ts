import { IsString, IsNotEmpty, IsOptional, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class NarrateReportDto {
    @ApiProperty({ description: 'Report type (e.g. sales_summary, inventory_valuation)' })
    @IsString()
    @IsNotEmpty()
    reportType: string;

    @ApiProperty({ description: 'Structured report data to narrate' })
    @IsObject()
    reportData: Record<string, unknown>;

    @ApiPropertyOptional({ description: 'Optional locale for the response (en or bn)' })
    @IsString()
    @IsOptional()
    locale?: string;
}

export class ParseVoiceSaleDto {
    @ApiProperty({ description: 'Speech-to-text transcript of the sale order' })
    @IsString()
    @IsNotEmpty()
    transcript: string;

    @ApiPropertyOptional({ description: 'Optional locale for parsing (en or bn)' })
    @IsString()
    @IsOptional()
    locale?: string;
}

export class DraftMessageDto {
    @ApiProperty({ description: 'Channel: whatsapp | sms | email' })
    @IsString()
    @IsNotEmpty()
    channel: string;

    @ApiProperty({ description: 'Purpose: follow_up | payment_reminder | promotion | birthday' })
    @IsString()
    @IsNotEmpty()
    purpose: string;

    @ApiProperty({ description: 'Customer context (name, total_spent, etc.)' })
    @IsObject()
    customerContext: Record<string, unknown>;

    @ApiPropertyOptional({ description: 'Optional locale for the response (en or bn)' })
    @IsString()
    @IsOptional()
    locale?: string;
}
