import { Type } from 'class-transformer';
import {
    IsString,
    IsOptional,
    IsEnum,
    IsUUID,
    IsDateString,
    IsIn,
    IsEmail,
    IsNotEmpty,
    IsArray,
    ArrayMaxSize,
    ValidateNested,
} from 'class-validator';
import { CAMPAIGN_UPLOAD_MAX_ROWS } from '@erp71/shared-types';

export enum CampaignChannel {
    SMS = 'SMS',
    WHATSAPP = 'WHATSAPP',
    EMAIL = 'EMAIL',
}

export enum CampaignTargetSegment {
    ALL = 'ALL',
    VIP = 'VIP',
    AT_RISK = 'At-Risk',
    REGULAR = 'Regular',
    NEW = 'New',
}

export enum CampaignRecipientSource {
    SEGMENT = 'SEGMENT',
    UPLOAD = 'UPLOAD',
}

export enum CampaignBodyFormat {
    TEXT = 'TEXT',
    HTML = 'HTML',
}

/** One row of an uploaded recipient list. */
export class CampaignUploadRowDto {
    @IsEmail()
    email: string;

    @IsOptional()
    @IsString()
    name?: string;

    @IsString()
    @IsNotEmpty()
    subject: string;

    @IsString()
    @IsNotEmpty()
    message: string;
}

export class CreateCampaignDto {
    @IsString()
    name: string;

    @IsOptional()
    @IsString()
    description?: string;

    @IsEnum(CampaignChannel)
    channel: CampaignChannel;

    @IsOptional()
    @IsEnum(CampaignRecipientSource)
    recipient_source?: CampaignRecipientSource;

    @IsOptional()
    @IsEnum(CampaignBodyFormat)
    body_format?: CampaignBodyFormat;

    @IsOptional()
    @IsString()
    subject?: string;

    /** Required for SEGMENT campaigns; UPLOAD campaigns carry a message per row. */
    @IsOptional()
    @IsString()
    message?: string;

    @IsOptional()
    @IsArray()
    @ArrayMaxSize(CAMPAIGN_UPLOAD_MAX_ROWS)
    @ValidateNested({ each: true })
    @Type(() => CampaignUploadRowDto)
    rows?: CampaignUploadRowDto[];

    @IsOptional()
    @IsIn(['ALL', 'VIP', 'At-Risk', 'Regular', 'New'])
    target_segment?: string;

    @IsOptional()
    @IsUUID()
    target_group_id?: string;

    @IsOptional()
    @IsDateString()
    scheduled_at?: string;
}

export class UpdateCampaignDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    description?: string;

    @IsOptional()
    @IsString()
    subject?: string;

    @IsOptional()
    @IsString()
    message?: string;

    @IsOptional()
    @IsEnum(CampaignBodyFormat)
    body_format?: CampaignBodyFormat;

    @IsOptional()
    @IsIn(['ALL', 'VIP', 'At-Risk', 'Regular', 'New'])
    target_segment?: string;

    @IsOptional()
    @IsUUID()
    target_group_id?: string;

    /**
     * Explicitly null unschedules the campaign and returns it to DRAFT; absent
     * leaves the existing schedule alone. @IsOptional skips null as well as
     * undefined, so the null reaches the service intact.
     */
    @IsOptional()
    @IsDateString()
    scheduled_at?: string | null;
}
