import {
    ArrayNotEmpty,
    IsArray,
    IsEnum,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    IsUUID,
    MaxLength,
    Min,
    MinLength,
    ValidateIf,
} from 'class-validator';
import { BOARD_BACKGROUND_COLORS, type BoardBackgroundColor } from '@erp71/shared-types';

const CATEGORIES = ['TODO', 'IN_PROGRESS', 'DONE'] as const;
export type BoardColumnCategory = (typeof CATEGORIES)[number];

export class CreateBoardDto {
    @IsString()
    @MinLength(1)
    @MaxLength(120)
    name!: string;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    description?: string;
}

export class UpdateBoardDto {
    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(120)
    name?: string;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    description?: string;

    /**
     * A palette key, or `null` to go back to the plain board — `@IsOptional`
     * waves both `null` and an absent key past the check, and the service tells
     * the two apart, so "clear the colour" and "leave it alone" stay distinct.
     *
     * Validated against the shared list rather than accepting any colour
     * string: the page renders it as a Tailwind class, so a free-text value
     * would be both unrenderable and a way to leave the board unreadable for
     * everyone else in the workspace.
     */
    @IsOptional()
    @IsIn(BOARD_BACKGROUND_COLORS)
    backgroundColor?: BoardBackgroundColor | null;
}

/** An uploaded board background, as `FileReader.readAsDataURL` produces it. */
export class SetBoardBackgroundImageDto {
    /** A `data:` URL or a bare base64 string. */
    @IsString()
    imageBase64!: string;

    @IsOptional()
    @IsString()
    mimeType?: string;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    fileName?: string;
}

export class AddBoardTasksDto {
    @IsArray()
    @ArrayNotEmpty()
    @IsUUID('4', { each: true })
    taskIds!: string[];
}

/** A card composed in a column, JIRA-style: a title and the project it is for. */
export class CreateBoardCardDto {
    @IsUUID()
    projectId!: string;

    @IsString()
    @MinLength(1)
    @MaxLength(300)
    title!: string;

    /**
     * Who the card lands on. Both columns arrive on every request — a task goes
     * to a user or to an employee without a login, never both — so whichever
     * one the chosen holder does not fill comes through as `''`.
     *
     * `@ValidateIf` for the same reason `UpdateTaskDto` and `CreateTaskDto`
     * carry it: `@IsOptional()` skips only null and undefined, so the empty
     * sibling column would reach `@IsUUID()` and 400. That was the New Task
     * dialog's bug; the composer sends the identical shape.
     */
    @IsOptional() @ValidateIf((_, value) => value !== '') @IsUUID()
    assigneeId?: string;

    @IsOptional() @ValidateIf((_, value) => value !== '') @IsUUID()
    assigneeEmployeeId?: string;
}

export class MoveBoardCardDto {
    @IsUUID()
    columnId!: string;

    @IsInt()
    @Min(0)
    sortOrder!: number;
}

export class CreateBoardColumnDto {
    @IsString()
    @MinLength(1)
    @MaxLength(60)
    name!: string;

    @IsEnum(CATEGORIES)
    category!: BoardColumnCategory;

    @IsOptional()
    @IsInt()
    @Min(0)
    sortOrder?: number;

    @IsOptional()
    @IsInt()
    @Min(1)
    wipLimit?: number;
}

export class UpdateBoardColumnDto {
    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(60)
    name?: string;

    @IsOptional()
    @IsEnum(CATEGORIES)
    category?: BoardColumnCategory;

    @IsOptional()
    @IsInt()
    @Min(0)
    sortOrder?: number;

    @IsOptional()
    @IsInt()
    @Min(1)
    wipLimit?: number | null;
}

export class SetBoardColumnStatusesDto {
    /** Empty is legal: it unbinds the column entirely. */
    @IsArray()
    @IsUUID('4', { each: true })
    statusIds!: string[];
}

/**
 * The board's columns, left to right. The whole set every time rather than one
 * column's new index: a reorder is a rearrangement of a list, and sending the
 * list is what makes two people dragging at once end with one of the two
 * orders rather than an interleaving of both.
 */
export class ReorderBoardColumnsDto {
    @IsArray()
    @ArrayNotEmpty()
    @IsUUID('4', { each: true })
    columnIds!: string[];
}

/** Several cards into one column, in the order given. */
export class MoveBoardCardsDto {
    @IsArray()
    @ArrayNotEmpty()
    @IsUUID('4', { each: true })
    taskIds!: string[];

    @IsUUID()
    columnId!: string;
}

/** Several cards off the board. The tasks themselves are untouched. */
export class RemoveBoardCardsDto {
    @IsArray()
    @ArrayNotEmpty()
    @IsUUID('4', { each: true })
    taskIds!: string[];
}

/**
 * One column's cards, top to bottom. What the column's "sort cards" action
 * sends: the client already holds every card it is sorting, so the comparison
 * (and the tie-breaks a reader can see) stays where the data is, and the server
 * only has to store the result.
 */
export class OrderBoardColumnCardsDto {
    @IsArray()
    @IsUUID('4', { each: true })
    taskIds!: string[];
}
