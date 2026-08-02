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
    dueDate?: string;

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

    @IsOptional() @IsDateString()
    dueDate?: string;

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
}

export class CreateCommentDto {
    @IsOptional() @IsUUID()
    projectId?: string;

    @IsOptional() @IsUUID()
    taskId?: string;

    @IsString() @MinLength(1) @MaxLength(5000)
    body!: string;
}
