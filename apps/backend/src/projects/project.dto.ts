import { Type } from 'class-transformer';
import {
    IsArray,
    IsBoolean,
    IsDateString,
    IsEnum,
    IsIn,
    IsInt,
    IsNumber,
    IsOptional,
    IsString,
    IsUUID,
    Matches,
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

export enum ProjectVisibilityDto {
    PUBLIC = 'PUBLIC',
    PRIVATE = 'PRIVATE',
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

    @IsOptional() @IsEnum(ProjectVisibilityDto)
    visibility?: ProjectVisibilityDto;

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

    /**
     * The links and dates below take `''` to mean "clear this", the same
     * spelling `UpdateTaskDto` uses: PATCH reads undefined as "leave alone", so
     * only the empty string can say "no project type" or "no target date".
     * `@IsOptional()` skips null and undefined only, so without `@ValidateIf`
     * the empty string reaches `@IsUUID()`/`@IsDateString()` and 400s — which is
     * what the edit form got the moment it grew a clearable field.
     *
     * `create` and `update` both normalise `'' -> null` before the column.
     */
    @IsOptional() @ValidateIf((_, value) => value !== '') @IsUUID()
    storeId?: string;

    @IsOptional() @ValidateIf((_, value) => value !== '') @IsUUID()
    customerId?: string;

    @IsOptional() @ValidateIf((_, value) => value !== '') @IsUUID()
    leadId?: string;

    @IsOptional() @ValidateIf((_, value) => value !== '') @IsUUID()
    projectTypeId?: string;

    @IsOptional() @IsEnum(ProjectStatusDto)
    status?: ProjectStatusDto;

    @IsOptional() @IsEnum(ProjectPriorityDto)
    priority?: ProjectPriorityDto;

    /**
     * PUBLIC unless asked otherwise. A private project is reachable only by its
     * members, its manager, the OWNER, and holders of VIEW_ALL_PROJECTS.
     */
    @IsOptional() @IsEnum(ProjectVisibilityDto)
    visibility?: ProjectVisibilityDto;

    @IsOptional() @ValidateIf((_, value) => value !== '') @IsUUID()
    managerId?: string;

    @IsOptional() @ValidateIf((_, value) => value !== '') @IsDateString()
    startDate?: string;

    @IsOptional() @ValidateIf((_, value) => value !== '') @IsDateString()
    targetEndDate?: string;

    @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
    budgetAmount?: number;
}

export class UpdateProjectDto extends CreateProjectDto {
    @IsOptional() @IsString() @MinLength(1) @MaxLength(200)
    declare name: string;

    @IsOptional() @ValidateIf((_, value) => value !== '') @IsDateString()
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

    /**
     * `''` unassigns, for the same reason the dates below take one: PATCH reads
     * undefined as "leave alone", so only the empty string can mean "nobody".
     * The service already stores `dto.assigneeId || null` — without the
     * `@ValidateIf` the empty string never gets past `@IsUUID()`.
     */
    @IsOptional() @ValidateIf((_, value) => value !== '') @IsUUID()
    assigneeId?: string;

    /** Alternative to assigneeId for a team member who has no login. */
    @IsOptional() @ValidateIf((_, value) => value !== '') @IsUUID()
    assigneeEmployeeId?: string;

    @IsOptional() @ValidateIf((_, value) => value !== '') @IsUUID()
    milestoneId?: string;

    @IsOptional() @ValidateIf((_, value) => value !== '') @IsUUID()
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

/**
 * `HH:mm`, 24-hour. Deliberately not `IsDateString`: the client is stating a
 * time of day against a work date it has already sent, and letting it post a
 * full timestamp would let the two disagree about which day the hours land on.
 */
const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateTimeEntryDto {
    @IsUUID()
    taskId!: string;

    @IsDateString()
    workDate!: string;

    /**
     * Required even when a span is given, because the client cannot be the one
     * to decide what a span is worth. With both ends present the service
     * overwrites this with the derived figure; on its own it is the entry.
     */
    @Type(() => Number) @IsNumber() @Min(0.01) @Max(24)
    hours!: number;

    /**
     * Optional wall-clock span, as `HH:mm` on `workDate`. Both or neither —
     * `assertSpan` rejects half a span rather than storing something no screen
     * can render. An end before the start is read as crossing midnight.
     */
    @IsOptional() @Matches(TIME_OF_DAY)
    startTime?: string;

    @IsOptional() @Matches(TIME_OF_DAY)
    endTime?: string;

    /**
     * Overlap is refused by default and this is the way past it. Deliberately
     * an explicit flag rather than a silent allowance: two spans over the same
     * minute is nearly always a mistake, but "nearly" is why editing a bad
     * entry must not be able to trap someone.
     */
    @IsOptional() @IsBoolean() @Type(() => Boolean)
    allowOverlap?: boolean;

    /** Replaces the entry's tags wholesale. `[]` clears them. */
    @IsOptional() @IsArray() @IsUUID('4', { each: true })
    tagIds?: string[];

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

    /**
     * `''` clears the span, the way `''` clears an optional relation elsewhere
     * in this file — PATCH reads `undefined` as "leave alone", so only an empty
     * string can mean "there is no span". `@ValidateIf` is what lets it past
     * the pattern, exactly as the assignee fields do.
     */
    @IsOptional() @ValidateIf((_, value) => value !== '') @Matches(TIME_OF_DAY)
    startTime?: string;

    @IsOptional() @ValidateIf((_, value) => value !== '') @Matches(TIME_OF_DAY)
    endTime?: string;

    @IsOptional() @IsBoolean() @Type(() => Boolean)
    allowOverlap?: boolean;

    @IsOptional() @IsArray() @IsUUID('4', { each: true })
    tagIds?: string[];

    @IsOptional() @IsString() @MaxLength(500)
    note?: string;
}

export class ListTimeEntriesDto {
    @IsOptional() @IsUUID()
    projectId?: string;

    @IsOptional() @IsUUID()
    taskId?: string;

    /**
     * Whose hours to show. `me` is resolved against the caller in the
     * controller so the client never has to know its own user id.
     */
    @IsOptional() @IsString()
    userId?: string;

    @IsOptional() @IsDateString()
    from?: string;

    @IsOptional() @IsDateString()
    to?: string;

    /** Matches the task title or the entry's note. */
    @IsOptional() @IsString() @MaxLength(200)
    search?: string;

    @IsOptional() @IsUUID()
    tagId?: string;

    /**
     * A table column id. Unknown ones fall back to the work date rather than
     * 400ing — the client sends whatever header was clicked, and a sort is
     * never worth failing a page load over.
     */
    @IsOptional() @IsString()
    sortBy?: string;

    @IsOptional() @IsString()
    sortDir?: string;

    @IsOptional() @Type(() => Number) @IsInt() @Min(1)
    page?: number;

    @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
    limit?: number;
}

/**
 * The dimension an hour-log report collapses to. `week` and `month` are date
 * buckets rather than columns — they are folded from `work_date` in the
 * service, which keeps every grouping on the same indexed query.
 */
export enum TimeReportGroupByDto {
    TASK = 'task',
    DATE = 'date',
    WEEK = 'week',
    MONTH = 'month',
    USER = 'user',
    PROJECT = 'project',
    TAG = 'tag',
}

export class TimeReportQueryDto {
    @IsOptional() @IsEnum(TimeReportGroupByDto)
    groupBy?: TimeReportGroupByDto;

    @IsOptional() @IsUUID()
    projectId?: string;

    @IsOptional() @IsUUID()
    taskId?: string;

    @IsOptional() @IsString()
    userId?: string;

    /** Same match as the list: the task title or the entry's note. */
    @IsOptional() @IsString() @MaxLength(200)
    search?: string;

    @IsOptional() @IsUUID()
    tagId?: string;

    @IsDateString()
    from!: string;

    @IsDateString()
    to!: string;
}


export class StartTimerDto {
    @IsUUID()
    taskId!: string;

    @IsOptional() @IsString() @MaxLength(500)
    note?: string;

    @IsOptional() @IsArray() @IsUUID('4', { each: true })
    tagIds?: string[];
}

/** Everything a running timer can be edited to while it runs, except its start. */
export class UpdateTimerDto {
    @IsOptional() @IsString() @MaxLength(500)
    note?: string;

    @IsOptional() @IsArray() @IsUUID('4', { each: true })
    tagIds?: string[];
}

export class StopTimerDto {
    /**
     * The re-estimate to carry onto the task, same meaning as on a manual log.
     */
    @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(9999)
    remainingHours?: number;

    @IsOptional() @IsString() @MaxLength(500)
    note?: string;
}

export class TimeTagDto {
    @IsString() @MinLength(1) @MaxLength(40)
    name!: string;

    @IsOptional() @IsEnum(ProjectLabelColorDto)
    color?: ProjectLabelColorDto;

    @IsOptional() @Type(() => Number) @IsInt() @Min(0)
    sortOrder?: number;
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
