import { IsString, IsNotEmpty, IsOptional, IsObject, IsIn, MaxLength } from 'class-validator';
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

const VOICE_ENTRY_TYPES = [
    'sale',
    'purchase',
    'sales_order',
    'sales_quote',
    'purchase_order',
    'purchase_quote',
    'sales_return',
    'purchase_return',
] as const;

export type VoiceEntryType = (typeof VOICE_ENTRY_TYPES)[number];

export class ParseVoiceEntryDto {
    @ApiPropertyOptional({
        description: 'Entry context',
        enum: VOICE_ENTRY_TYPES,
        default: 'sale',
    })
    @IsString()
    @IsIn(VOICE_ENTRY_TYPES)
    @IsOptional()
    entryType?: VoiceEntryType;

    @ApiPropertyOptional({ description: 'Speech-to-text transcript' })
    @IsString()
    @IsOptional()
    transcript?: string;

    @ApiPropertyOptional({ description: 'Base64-encoded audio recording (no data-URI prefix)' })
    @IsString()
    @IsOptional()
    audioBase64?: string;

    @ApiPropertyOptional({ description: 'Audio format: webm, wav, mp3, ogg, etc.' })
    @IsString()
    @IsOptional()
    audioFormat?: string;

    @ApiPropertyOptional({ description: 'Optional locale for parsing (en or bn)' })
    @IsString()
    @IsOptional()
    locale?: string;
}

/** @deprecated Use ParseVoiceEntryDto */
export class ParseVoiceSaleDto extends ParseVoiceEntryDto {}

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

export class ChatDto {
    @ApiPropertyOptional({ description: 'Existing conversation to continue. Omit to start a new thread.' })
    @IsString()
    @IsOptional()
    conversationId?: string;

    @ApiProperty({ description: 'The question to ask about the business data' })
    @IsString()
    @IsNotEmpty()
    @MaxLength(2000)
    message: string;

    @ApiPropertyOptional({ description: 'Preferred reply language (en or bn)' })
    @IsString()
    @IsOptional()
    locale?: string;
}
