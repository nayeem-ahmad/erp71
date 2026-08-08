import { Type } from 'class-transformer';
import {
    IsArray,
    IsBoolean,
    IsDateString,
    IsEnum,
    IsInt,
    IsNumber,
    IsOptional,
    IsString,
    IsUUID,
    Max,
    MaxLength,
    Min,
    MinLength,
    ValidateIf,
} from 'class-validator';

export enum ProjectStatusDto {
    DRAFT = 'DRAFT',
    ACTIVE = 'ACTIVE',
    ON_HOLD = 'ON_HOLD',
    COMPLETED = 'COMPLETED',
    CANCELLED = 'CANCELLED',
}

export enum ProjectPriorityDto {
    LOW = 'LOW',
    MEDIUM = 'MEDIUM',
    HIGH = 'HIGH',
    URGENT = 'URGENT',
}

export enum ProjectMemberRoleDto {
    MANAGER = 'MANAGER',
    MEMBER = 'MEMBER',
    VIEWER = 'VIEWER',
}

export enum TaskStatusCategoryDto {
    TODO = 'TODO',
    IN_PROGRESS = 'IN_PROGRESS',
    DONE = 'DONE',
}

export enum ProjectLabelColorDto {
    GRAY = 'GRAY',
    BLUE = 'BLUE',
    EMERALD = 'EMERALD',
    AMBER = 'AMBER',
    RED = 'RED',
    PURPLE = 'PURPLE',
}

export enum SprintStatusDto {
    PLANNED = 'PLANNED',
    ACTIVE = 'ACTIVE',
    COMPLETED = 'COMPLETED',
}

export class ListProjectsDto {
    @IsOptional() @Type(() => Number) @IsInt() @Min(1)
    page?: number;

    @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
    limit?: number;

    @IsOptional() @IsString()
    sortBy?: string;

    @IsOptional() @IsString()
    sortDir?: string;

    @IsOptional() @IsString() @MaxLength(200)
    search?: string;

    /** Comma-separated set, so a multi-status filter stays one request. */
    @IsOptional() @IsString()
    status?: string;

    @IsOptional() @IsUUID()
    projectTypeId?: string;

    @IsOptional() @IsUUID()
    managerId?: string;

    @IsOptional() @IsUUID()
    customerId?: string;
}

export class CreateProjectDto {
    @IsString() @MinLength(1) @MaxLength(200)
    name!: string;

    /** Shown wherever the full name will not fit — a board card, a chip. */
    @IsOptional() @IsString() @MaxLength(20)
    shortName?: string;

    @IsOptional() @IsString() @MaxLength(5000)
    description?: string;

    @IsOptional() @IsUUID()
    storeId?: string;

    @IsOptional() @IsUUID()
    customerId?: string;

    @IsOptional() @IsUUID()
    leadId?: string;

    @IsOptional() @IsUUID()
    projectTypeId?: string;

    @IsOptional() @IsEnum(ProjectStatusDto)
    status?: ProjectStatusDto;

    @IsOptional() @IsEnum(ProjectPriorityDto)
    priority?: ProjectPriorityDto;

    @IsOptional() @IsUUID()
    managerId?: string;

    @IsOptional() @IsDateString()
    startDate?: string;

    @IsOptional() @IsDateString()
    targetEndDate?: string;

    @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
    budgetAmount?: number;
}

export class UpdateProjectDto extends CreateProjectDto {
    @IsOptional() @IsString() @MinLength(1) @MaxLength(200)
    declare name: string;

    @IsOptional() @IsDateString()
    actualEndDate?: string;
}

export class UpsertProjectMemberDto {
    /** Exactly one of userId / employeeId. Enforced in ProjectsService.addMember. */
    @IsOptional() @IsUUID()
    userId?: string;

    @IsOptional() @IsUUID()
    employeeId?: string;

    @IsOptional() @IsEnum(ProjectMemberRoleDto)
    role?: ProjectMemberRoleDto;
}

export class CreateMilestoneDto {
    @IsString() @MinLength(1) @MaxLength(200)
    name!: string;

    @IsOptional() @IsDateString()
    targetDate?: string;

    @IsOptional() @Type(() => Number) @IsInt() @Min(0)
    sortOrder?: number;
}

export class UpdateMilestoneDto extends CreateMilestoneDto {
    @IsOptional() @IsString() @MinLength(1) @MaxLength(200)
    declare name: string;

    @IsOptional() @IsBoolean()
    isCompleted?: boolean;
}

export class ListTasksDto {
    @IsOptional() @IsUUID()
    projectId?: string;

    @IsOptional() @IsUUID()
    sprintId?: string;

    @IsOptional() @IsUUID()
    assigneeId?: string;

    @IsOptional() @IsUUID()
    milestoneId?: string;

    @IsOptional() @IsString()
    search?: string;

    /** `true` returns only tasks with no sprint — the backlog. */
    @IsOptional() @IsString()
    backlogOnly?: string;

    @IsOptional() @IsUUID()
    statusId?: string;

    /**
     * TODO | IN_PROGRESS | DONE. Filters on what a column *means* rather than on
     * a column id, so "open tasks" is one parameter instead of the caller
     * enumerating this tenant's board columns.
     */
    @IsOptional() @IsString()
    statusCategory?: string;

    @IsOptional() @IsUUID()
    assigneeEmployeeId?: string;

    @IsOptional() @IsUUID()
    labelId?: string;

    @IsOptional() @Type(() => Number) @IsInt() @Min(1)
    page?: number;

    @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
    limit?: number;

    @IsOptional() @IsString()
    sortBy?: string;

    @IsOptional() @IsString()
    sortDir?: string;
}

export class CreateTaskDto {
    @IsUUID()
    projectId!: string;

    @IsString() @MinLength(1) @MaxLength(300)
    title!: string;

    @IsOptional() @IsString() @MaxLength(5000)
    description?: string;

    @IsOptional() @IsUUID()
    statusId?: string;

    @IsOptional() @IsEnum(ProjectPriorityDto)
    priority?: ProjectPriorityDto;

    @IsOptional() @IsUUID()
    assigneeId?: string;

    /** Alternative to assigneeId for a team member who has no login. */
    @IsOptional() @IsUUID()
    assigneeEmployeeId?: string;

    @IsOptional() @IsUUID()
    milestoneId?: string;

    @IsOptional() @IsUUID()
    sprintId?: string;

    @IsOptional() @IsUUID()
    parentTaskId?: string;

    @IsOptional() @IsDateString()
    startDate?: string;

    @IsOptional() @IsDateString()
    dueDate?: string;

    /** Replaces the whole label set. An empty array clears it. */
    @IsOptional() @IsArray() @IsUUID(undefined, { each: true })
    labelIds?: string[];

    @IsOptional() @IsEnum(ProjectLabelColorDto)
    coverColor?: ProjectLabelColorDto;

    @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(9999)
    estimateHours?: number;

    /**
     * Optional on create — when omitted the estimate is used, which is the only
     * sensible opening position for work nobody has started.
     */
    @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(9999)
    remainingHours?: number;
}

export class UpdateTaskDto {
    @IsOptional() @IsString() @MinLength(1) @MaxLength(300)
    title?: string;

    @IsOptional() @IsString() @MaxLength(5000)
    description?: string;

    @IsOptional() @IsUUID()
    statusId?: string;

    @IsOptional() @IsEnum(ProjectPriorityDto)
    priority?: ProjectPriorityDto;

    @IsOptional() @IsUUID()
    assigneeId?: string;

    /** Alternative to assigneeId for a team member who has no login. */
    @IsOptional() @IsUUID()
    assigneeEmployeeId?: string;

    @IsOptional() @IsUUID()
    milestoneId?: string;

    @IsOptional() @IsUUID()
    sprintId?: string;

    /**
     * `''` clears the date. `@IsOptional()` alone would not allow it — it skips
     * only null and undefined, so an empty string reaches `@IsDateString()` and
     * 400s, and PATCH reads undefined as "leave alone". `@ValidateIf` is what
     * makes "no start date" expressible at all.
     */
    @IsOptional() @ValidateIf((_, value) => value !== '') @IsDateString()
    startDate?: string;

    @IsOptional() @ValidateIf((_, value) => value !== '') @IsDateString()
    dueDate?: string;

    /** Replaces the whole label set. An empty array clears it. */
    @IsOptional() @IsArray() @IsUUID(undefined, { each: true })
    labelIds?: string[];

    /** `''` removes the cover, for the same PATCH reason as the dates above. */
    @IsOptional() @ValidateIf((_, value) => value !== '') @IsEnum(ProjectLabelColorDto)
    coverColor?: ProjectLabelColorDto | '';

    @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(9999)
    estimateHours?: number;

    /** A deliberate re-estimate. Always logged as RE_ESTIMATED. */
    @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(9999)
    remainingHours?: number;

    @IsOptional() @IsString() @MaxLength(500)
    remainingNote?: string;
}

/** Drag-and-drop: the board sends where the card landed, not a whole task. */
export class MoveTaskDto {
    @IsUUID()
    statusId!: string;

    @Type(() => Number) @IsInt() @Min(0)
    sortOrder!: number;

    @IsOptional() @IsUUID()
    sprintId?: string;

    /** Explicitly clear the sprint — dragging a card back to the backlog. */
    @IsOptional() @IsBoolean()
    clearSprint?: boolean;
}

export class CreateLabelDto {
    @IsString() @MinLength(1) @MaxLength(40)
    name!: string;

    @IsOptional() @IsEnum(ProjectLabelColorDto)
    color?: ProjectLabelColorDto;
}

export class UpdateLabelDto {
    @IsOptional() @IsString() @MinLength(1) @MaxLength(40)
    name?: string;

    @IsOptional() @IsEnum(ProjectLabelColorDto)
    color?: ProjectLabelColorDto;

    @IsOptional() @Type(() => Number) @IsInt() @Min(0)
    sortOrder?: number;
}

export class CreateChecklistItemDto {
    @IsString() @MinLength(1) @MaxLength(300)
    text!: string;
}

export class UpdateChecklistItemDto {
    @IsOptional() @IsString() @MinLength(1) @MaxLength(300)
    text?: string;

    @IsOptional() @IsBoolean()
    isDone?: boolean;

    @IsOptional() @Type(() => Number) @IsInt() @Min(0)
    sortOrder?: number;
}

/**
 * The whole order, not a pair to swap. Moving one item by PATCHing two
 * `sortOrder`s races: a half-applied swap leaves two items sharing a position,
 * and `checklistItems` only orders by `sort_order`, so the list would then
 * shuffle on every read.
 */
export class ReorderChecklistDto {
    @IsArray()
    @IsUUID(undefined, { each: true })
    itemIds!: string[];
}

export class CreateTimeEntryDto {
    @IsUUID()
    taskId!: string;

    @IsDateString()
    workDate!: string;

    @Type(() => Number) @IsNumber() @Min(0.01) @Max(24)
    hours!: number;

    @IsOptional() @IsString() @MaxLength(500)
    note?: string;

    /**
     * The re-estimate to store alongside the log. Omitted means "accept the
     * suggestion" (`max(0, remaining - hours)`); it is never forced, because a
     * task can absorb hours without getting any closer to done.
     */
    @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(9999)
    remainingHours?: number;
}

export class UpdateTimeEntryDto {
    @IsOptional() @IsDateString()
    workDate?: string;

    @IsOptional() @Type(() => Number) @IsNumber() @Min(0.01) @Max(24)
    hours?: number;

    @IsOptional() @IsString() @MaxLength(500)
    note?: string;
}

export class ListTimeEntriesDto {
    @IsOptional() @IsUUID()
    projectId?: string;

    @IsOptional() @IsUUID()
    taskId?: string;

    @IsOptional() @IsDateString()
    from?: string;

    @IsOptional() @IsDateString()
    to?: string;

    @IsOptional() @Type(() => Number) @IsInt() @Min(1)
    page?: number;

    @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
    limit?: number;
}

export class CreateSprintDto {
    @IsString() @MinLength(1) @MaxLength(200)
    name!: string;

    @IsOptional() @IsString() @MaxLength(1000)
    goal?: string;

    @IsDateString()
    startDate!: string;

    @IsDateString()
    endDate!: string;
}

export class UpdateSprintDto {
    @IsOptional() @IsString() @MinLength(1) @MaxLength(200)
    name?: string;

    @IsOptional() @IsString() @MaxLength(1000)
    goal?: string;

    @IsOptional() @IsDateString()
    startDate?: string;

    @IsOptional() @IsDateString()
    endDate?: string;

    @IsOptional() @IsEnum(SprintStatusDto)
    status?: SprintStatusDto;
}

export class AssignTasksToSprintDto {
    @IsArray()
    @IsUUID('4', { each: true })
    taskIds!: string[];
}

export class CreateProjectTypeDto {
    @IsString() @MinLength(1) @MaxLength(100)
    name!: string;

    @IsOptional() @Type(() => Number) @IsInt() @Min(0)
    sortOrder?: number;
}

export class UpdateProjectTypeDto {
    @IsOptional() @IsString() @MinLength(1) @MaxLength(100)
    name?: string;

    @IsOptional() @IsBoolean()
    isActive?: boolean;

    @IsOptional() @Type(() => Number) @IsInt() @Min(0)
    sortOrder?: number;
}

export class CreateTaskStatusDto {
    @IsString() @MinLength(1) @MaxLength(100)
    name!: string;

    @IsEnum(TaskStatusCategoryDto)
    category!: TaskStatusCategoryDto;

    @IsOptional() @Type(() => Number) @IsInt() @Min(0)
    sortOrder?: number;

    @IsOptional() @IsBoolean()
    isDefault?: boolean;

    /** Cards allowed at once. Advisory — the board warns, it does not block. */
    @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(999)
    wipLimit?: number;
}

export class UpdateTaskStatusDto {
    @IsOptional() @IsString() @MinLength(1) @MaxLength(100)
    name?: string;

    @IsOptional() @IsEnum(TaskStatusCategoryDto)
    category?: TaskStatusCategoryDto;

    @IsOptional() @Type(() => Number) @IsInt() @Min(0)
    sortOrder?: number;

    @IsOptional() @IsBoolean()
    isActive?: boolean;

    @IsOptional() @IsBoolean()
    isDefault?: boolean;

    /**
     * `null` removes the limit. `@IsOptional()` skips null, so the validators
     * below never see it and "no limit" stays expressible over PATCH.
     */
    @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(999)
    wipLimit?: number | null;
}

/**
 * Base64 over JSON rather than multipart, matching the CRM contact-card path —
 * one upload mechanism in the codebase is worth more than the few bytes
 * multipart would save.
 */
export class CreateAttachmentDto {
    @IsString() @MinLength(1)
    fileBase64!: string;

    @IsOptional() @IsString() @MaxLength(200)
    fileName?: string;

    @IsOptional() @IsString() @MaxLength(100)
    mimeType?: string;
}

export class CreateCommentDto {
    @IsString() @MinLength(1) @MaxLength(5000)
    body!: string;
}

export class UpdateCommentDto {
    @IsString() @MinLength(1) @MaxLength(5000)
    body!: string;
}
