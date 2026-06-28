import { IsString, IsOptional, IsEnum, IsUUID, IsDateString } from 'class-validator';

export enum CrmTaskType {
    FOLLOW_UP = 'FOLLOW_UP',
    COLLECTION = 'COLLECTION',
    BIRTHDAY = 'BIRTHDAY',
    REORDER_REMINDER = 'REORDER_REMINDER',
}

export enum CrmTaskStatus {
    PENDING = 'PENDING',
    DONE = 'DONE',
    SNOOZED = 'SNOOZED',
}

export class CreateCrmTaskDto {
    @IsOptional()
    @IsUUID()
    customer_id?: string;

    @IsOptional()
    @IsUUID()
    lead_id?: string;

    @IsEnum(CrmTaskType)
    type: CrmTaskType;

    @IsString()
    title: string;

    @IsDateString()
    due_at: string;

    @IsOptional()
    @IsUUID()
    assigned_to?: string;

    @IsOptional()
    @IsString()
    notes?: string;

    @IsOptional()
    @IsString()
    store_id?: string;
}

export class UpdateCrmTaskDto {
    @IsOptional()
    @IsEnum(CrmTaskType)
    type?: CrmTaskType;

    @IsOptional()
    @IsString()
    title?: string;

    @IsOptional()
    @IsDateString()
    due_at?: string;

    @IsOptional()
    @IsEnum(CrmTaskStatus)
    status?: CrmTaskStatus;

    @IsOptional()
    @IsUUID()
    assigned_to?: string;

    @IsOptional()
    @IsString()
    notes?: string;
}
