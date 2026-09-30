import { BadRequestException } from '@nestjs/common';

export function resolveSyncWindow(
    connection: { window_days: number; history_start_date: Date | null },
    dto: { dateFrom?: string; dateTo?: string; fullResync?: boolean },
): { from: Date; to: Date } {
    const today = new Date();
    const to = dto.dateTo ? new Date(dto.dateTo) : today;

    let from: Date;
    if (dto.dateFrom) {
        from = new Date(dto.dateFrom);
    } else if (dto.fullResync) {
        from = connection.history_start_date ?? new Date(to.getTime() - 5 * 365 * 24 * 60 * 60 * 1000);
    } else {
        from = new Date(to.getTime() - connection.window_days * 24 * 60 * 60 * 1000);
    }

    if (connection.history_start_date && from < connection.history_start_date) {
        from = connection.history_start_date;
    }
    if (from > to) {
        throw new BadRequestException('dateFrom must not be after dateTo');
    }
    return { from, to };
}
