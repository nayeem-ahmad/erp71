import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class PaginationDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page: number = 1;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    limit: number = 20;
}

export interface PaginatedResult<T> {
    items: T[];
    total: number;
    page: number;
    limit: number;
    pages: number;
}

export function paginate<T>(items: T[], total: number, page: number, limit: number): PaginatedResult<T> {
    return { items, total, page, limit, pages: Math.ceil(total / limit) };
}

// Cursor-based pagination — efficient for large, frequently appended datasets.
// The cursor is the opaque ID of the last item returned by the previous page.
export class CursorPaginationDto {
    @IsOptional()
    @IsString()
    cursor?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    limit: number = 20;
}

export interface CursorPaginatedResult<T> {
    items: T[];
    nextCursor: string | null;
    hasMore: boolean;
}

export function cursorPaginate<T extends { id: string }>(
    items: T[],
    limit: number,
): CursorPaginatedResult<T> {
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    return {
        items: page,
        nextCursor: hasMore ? page[page.length - 1].id : null,
        hasMore,
    };
}
