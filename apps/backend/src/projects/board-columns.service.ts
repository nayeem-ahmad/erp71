import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ProjectSettingsService } from './project-settings.service';

export type BindableColumn = { id: string; name: string; category: string; sort_order: number };
export type BindableStatus = { id: string; name: string; category: string };

const key = (name: string) => name.trim().toLowerCase();

/**
 * Which board column a project status belongs in. Name first because a tenant
 * whose projects all use the default template gets an exact mapping for free;
 * category second because a project that renamed "In Progress" to "Doing"
 * should still land somewhere sensible rather than in Unsorted.
 */
export function pickColumnForStatus(
    columns: BindableColumn[],
    status: BindableStatus,
): string | null {
    const byName = columns.find((column) => key(column.name) === key(status.name));
    if (byName) return byName.id;

    const sameCategory = columns
        .filter((column) => column.category === status.category)
        .sort((a, b) => a.sort_order - b.sort_order);
    return sameCategory[0]?.id ?? null;
}

@Injectable()
export class BoardColumnsService {
    constructor(
        private readonly db: DatabaseService,
        private readonly settings: ProjectSettingsService,
    ) {}

    /** Throws unless the board exists in this tenant. Every public method starts here. */
    private async assertBoard(tenantId: string, boardId: string) {
        const board = await this.db.board.findFirst({
            where: { id: boardId, tenant_id: tenantId, deleted_at: null },
        });
        if (!board) throw new NotFoundException('Board not found');
        return board;
    }

    /**
     * A new board opens with the columns the tenant already thinks in, so the
     * common case — every project on the default template — needs no setup at
     * all before cards land in the right places.
     */
    async seedColumnsForNewBoard(tenantId: string, boardId: string) {
        const template = await this.settings.listTaskStatuses(tenantId, false);
        if (template.length === 0) return;

        await this.db.boardColumn.createMany({
            data: template.map((status, index) => ({
                tenant_id: tenantId,
                board_id: boardId,
                name: status.name,
                category: status.category,
                sort_order: index,
                wip_limit: null,
            })),
        });
    }

    /**
     * Binds a project's whole status set, not just the status of the task that
     * triggered this. Doing the set up front is what makes a later drag — or a
     * status change made from the task panel — land in the right column instead
     * of dropping the card to Unsorted.
     *
     * Idempotent: an already-bound status is skipped rather than rebound, so a
     * manual override in board settings survives the next task addition.
     */
    async bindProject(tenantId: string, boardId: string, projectId: string) {
        const [columns, statuses, existing] = await Promise.all([
            this.db.boardColumn.findMany({
                where: { board_id: boardId, tenant_id: tenantId },
                orderBy: { sort_order: 'asc' },
            }),
            this.settings.listTaskStatuses(tenantId, false, projectId),
            this.db.boardColumnStatus.findMany({
                where: { board_id: boardId, tenant_id: tenantId },
                select: { status_id: true },
            }),
        ]);

        const bound = new Set(existing.map((row: { status_id: string }) => row.status_id));
        const rows: {
            tenant_id: string;
            board_id: string;
            board_column_id: string;
            status_id: string;
        }[] = [];

        for (const status of statuses) {
            if (bound.has(status.id)) continue;
            const columnId = pickColumnForStatus(columns as BindableColumn[], status as BindableStatus);
            if (!columnId) continue;
            rows.push({
                tenant_id: tenantId,
                board_id: boardId,
                board_column_id: columnId,
                status_id: status.id,
            });
        }

        if (rows.length === 0) return;
        // skipDuplicates so two concurrent adds of tasks from the same project
        // cannot collide on the (board_id, status_id) unique.
        await this.db.boardColumnStatus.createMany({ data: rows, skipDuplicates: true });
    }

    /**
     * The status a drop writes: this column's binding for *this card's own*
     * project. Null means the column is unbound for that project, which the
     * caller must surface as a refused drop rather than a silent no-op.
     */
    async resolveStatusId(tenantId: string, boardId: string, columnId: string, projectId: string) {
        const bindings = await this.db.boardColumnStatus.findMany({
            where: { board_id: boardId, tenant_id: tenantId, board_column_id: columnId },
            include: { status: { select: { id: true, project_id: true, sort_order: true } } },
        });

        const forProject = bindings
            .filter((row: any) => row.status?.project_id === projectId)
            .sort((a: any, b: any) => a.status.sort_order - b.status.sort_order);

        return forProject[0]?.status_id ?? null;
    }

    async listColumns(tenantId: string, boardId: string) {
        await this.assertBoard(tenantId, boardId);
        return this.db.boardColumn.findMany({
            where: { board_id: boardId, tenant_id: tenantId },
            orderBy: { sort_order: 'asc' },
            include: {
                bindings: {
                    include: {
                        status: { select: { id: true, name: true, project_id: true } },
                    },
                },
            },
        });
    }
}
