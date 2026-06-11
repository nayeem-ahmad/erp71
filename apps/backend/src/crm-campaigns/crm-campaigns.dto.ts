import { IsString, IsOptional, IsEnum, IsUUID, IsDateString, IsIn } from 'class-validator';

export enum CampaignChannel {
    SMS = 'SMS',
    EMAIL = 'EMAIL',
}

export enum CampaignTargetSegment {
    ALL = 'ALL',
    VIP = 'VIP',
    AT_RISK = 'At-Risk',
    REGULAR = 'Regular',
    NEW = 'New',
}

export class CreateCampaignDto {
    @IsString()
    name: string;

    @IsOptional()
    @IsString()
    description?: string;

    @IsEnum(CampaignChannel)
    channel: CampaignChannel;

    @IsString()
    message: string;

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
    message?: string;

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
