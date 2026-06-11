import { IsString, IsOptional, IsEnum, IsUUID, IsIn } from 'class-validator';

export enum InteractionType {
    CALL = 'CALL',
    SMS = 'SMS',
    WHATSAPP = 'WHATSAPP',
    EMAIL = 'EMAIL',
    VISIT = 'VISIT',
    NOTE = 'NOTE',
}

export enum InteractionDirection {
    INBOUND = 'INBOUND',
    OUTBOUND = 'OUTBOUND',
}

export class CreateInteractionDto {
    @IsUUID()
    customer_id: string;

    @IsEnum(InteractionType)
    type: InteractionType;

    @IsOptional()
    @IsIn(['INBOUND', 'OUTBOUND'])
    direction?: string;

    @IsString()
    summary: string;

    @IsOptional()
    @IsString()
    outcome?: string;

    @IsOptional()
    @IsString()
    store_id?: string;
}

export class UpdateInteractionDto {
    @IsOptional()
    @IsEnum(InteractionType)
    type?: InteractionType;

    @IsOptional()
    @IsString()
    summary?: string;

    @IsOptional()
    @IsString()
    outcome?: string;
}
