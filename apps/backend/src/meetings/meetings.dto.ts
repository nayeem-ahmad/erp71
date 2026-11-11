import { Transform, Type } from 'class-transformer';
import {
    IsArray,
    IsBoolean,
    IsDateString,
    IsEmail,
    IsIn,
    IsOptional,
    IsString,
    IsUUID,
    MaxLength,
    ValidateNested,
} from 'class-validator';

export const MEETING_TYPES = ['MANAGEMENT', 'STAFF', 'CLIENT', 'SUPPLIER', 'OTHER'] as const;
export const MEETING_STATUSES = ['DRAFT', 'FINALIZED', 'CANCELLED'] as const;
export const MEETING_ATTENDEE_ROLES = ['CHAIR', 'MINUTE_TAKER', 'MEMBER', 'GUEST'] as const;
export const MEETING_ACTION_STATUSES = ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const;
export const MEETING_ACTION_PRIORITIES = ['LOW', 'NORMAL', 'HIGH'] as const;

export class MeetingPersonDto {
    @IsOptional()
    @IsUUID()
    userId?: string;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    name?: string;

    @IsOptional()
    @IsEmail()
    email?: string;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    organization?: string;
}

export class MeetingAttendeeDto extends MeetingPersonDto {
    @IsOptional()
    @IsIn(MEETING_ATTENDEE_ROLES)
    role?: (typeof MEETING_ATTENDEE_ROLES)[number];

    @IsOptional()
    @IsBoolean()
    attended?: boolean;
}

export class MeetingActionPersonDto extends MeetingPersonDto {}

export class MeetingActionItemDto {
    /** Present when rewriting an existing row so notification timestamps and status survive. */
    @IsOptional()
    @IsUUID()
    id?: string;

    @IsString()
    @MaxLength(4000)
    description: string;

    @IsOptional()
    @IsUUID()
    assigneeUserId?: string;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    assigneeName?: string;

    @IsOptional()
    @IsEmail()
    assigneeEmail?: string;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    assigneeOrg?: string;

    @IsDateString()
    dueDate: string;

    @IsOptional()
    @IsIn(MEETING_ACTION_PRIORITIES)
    priority?: (typeof MEETING_ACTION_PRIORITIES)[number];

    @IsOptional()
    @IsIn(MEETING_ACTION_STATUSES)
    status?: (typeof MEETING_ACTION_STATUSES)[number];

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => MeetingActionPersonDto)
    others?: MeetingActionPersonDto[];
}

export class MeetingDiscussionDto {
    @IsOptional()
    @IsUUID()
    id?: string;

    @IsString()
    @MaxLength(300)
    title: string;

    @IsOptional()
    @IsString()
    @MaxLength(8000)
    description?: string;

    @IsOptional()
    @IsString()
    @MaxLength(4000)
    decision?: string;

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => MeetingActionItemDto)
    actionItems?: MeetingActionItemDto[];
}

export class CreateMeetingDto {
    @IsString()
    @MaxLength(300)
    title: string;

    @IsOptional()
    @IsIn(MEETING_TYPES)
    type?: (typeof MEETING_TYPES)[number];

    @IsDateString()
    startsAt: string;

    @IsOptional()
    @IsDateString()
    endsAt?: string;

    @IsOptional()
    @IsString()
    @MaxLength(400)
    venue?: string;

    @IsOptional()
    @IsString()
    @MaxLength(8000)
    summary?: string;

    @IsOptional()
    @IsUUID()
    storeId?: string;

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => MeetingAttendeeDto)
    attendees?: MeetingAttendeeDto[];

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => MeetingDiscussionDto)
    discussions?: MeetingDiscussionDto[];
}

export class UpdateMeetingDto extends CreateMeetingDto {}

export class ListMeetingsQueryDto {
    @IsOptional()
    @IsIn(MEETING_TYPES)
    type?: (typeof MEETING_TYPES)[number];

    @IsOptional()
    @IsIn(MEETING_STATUSES)
    status?: (typeof MEETING_STATUSES)[number];

    @IsOptional()
    @IsString()
    search?: string;

    @IsOptional()
    @IsDateString()
    from?: string;

    @IsOptional()
    @IsDateString()
    to?: string;
}

export class EmailMinutesDto {
    /** When omitted, every attendee with an email is sent the minutes. */
    @IsOptional()
    @IsArray()
    @IsUUID('4', { each: true })
    attendeeIds?: string[];
}

export class ListMeetingActionsQueryDto {
    @IsOptional()
    @IsIn(['mine', 'all'])
    scope?: 'mine' | 'all';

    @IsOptional()
    @IsIn(MEETING_ACTION_STATUSES)
    status?: (typeof MEETING_ACTION_STATUSES)[number];

    @IsOptional()
    @Transform(({ value }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : undefined))
    @IsBoolean()
    overdue?: boolean;

    @IsOptional()
    @IsUUID()
    assignee?: string;

    @IsOptional()
    @IsUUID()
    meeting?: string;
}

export class UpdateMeetingActionDto {
    @IsOptional()
    @IsIn(MEETING_ACTION_STATUSES)
    status?: (typeof MEETING_ACTION_STATUSES)[number];

    @IsOptional()
    @IsString()
    @MaxLength(2000)
    completionNote?: string;
}
