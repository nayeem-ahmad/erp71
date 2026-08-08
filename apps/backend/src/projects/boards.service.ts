import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { BoardColumnsService } from './board-columns.service';
import { ProjectTasksService } from './project-tasks.service';
import { CreateBoardDto, MoveBoardCardDto, UpdateBoardDto } from './board.dto';

/**
 * What a card shows. Deliberately the same field set the board page already
 * renders, plus `project`, which is no longer implied by the page.
 */
const CARD_TASK_INCLUDE = {
    project: { select: { id: true, code: true, name: true, short_name: true } },
    assignee: { select: { id: true, name: true, email: true } },
    assigneeEmployee: { select: { id: true, name: true } },
    labels: { include: { label: true } },
    checklistItems: { select: { id: true, is_done: true } },
    _count: { select: { subtasks: true, comments: true } },
} as const;

@Injectable()
export class BoardsService {
    constructor(
        private readonly db: DatabaseService,
        private readonly columns: BoardColumnsService,
        private readonly tasks: ProjectTasksService,
    ) {}

    private async assertBoard(tenantId: string, boardId: string) {
        const board = await this.db.board.findFirst({
            where: { id: boardId, tenant_id: tenantId, deleted_at: null },
        });
        if (!board) throw new NotFoundException('Board not found');
        return board;
    }

    async list(tenantId: string) {
        const boards = await this.db.board.findMany({
            where: { tenant_id: tenantId, deleted_at: null },
            orderBy: { created_at: 'desc' },
            include: { _count: { select: { cards: true } } },
        });
        return boards.map((board: any) => ({
            id: board.id,
            name: board.name,
            description: board.description,
            created_at: board.created_at,
            card_count: board._count.cards,
        }));
    }

    async create(tenantId: string, userId: string, dto: CreateBoardDto) {
        const board = await this.db.board.create({
            data: {
                tenant_id: tenantId,
                name: dto.name,
                description: dto.description ?? null,
                created_by: userId,
            },
        });
        await this.columns.seedColumnsForNewBoard(tenantId, board.id);
        return board;
    }

    async update(tenantId: string, boardId: string, dto: UpdateBoardDto) {
        await this.assertBoard(tenantId, boardId);
        return this.db.board.update({
            where: { id: boardId },
            data: {
                ...(dto.name !== undefined ? { name: dto.name } : {}),
                ...(dto.description !== undefined ? { description: dto.description } : {}),
            },
        });
    }

    async remove(tenantId: string, boardId: string) {
        await this.assertBoard(tenantId, boardId);
        await this.db.board.update({ where: { id: boardId }, data: { deleted_at: new Date() } });
    }

    /**
     * The whole board in one response. A card's column comes from its task's
     * `status_id` and this board's bindings — nothing about the placement is
     * stored on the card itself, so a status changed from the task panel is
     * already in the right column here.
     */
    async findOne(tenantId: string, boardId: string) {
        const board = await this.assertBoard(tenantId, boardId);

        const [boardColumns, cards] = await Promise.all([
            this.columns.listColumns(tenantId, boardId),
            this.db.boardTask.findMany({
                where: { board_id: boardId, tenant_id: tenantId },
                orderBy: [{ sort_order: 'asc' }, { added_at: 'asc' }],
                include: { task: { include: CARD_TASK_INCLUDE } },
            }),
        ]);

        const columnOfStatus = new Map<string, string>();
        for (const column of boardColumns as any[]) {
            for (const binding of column.bindings ?? []) {
                columnOfStatus.set(binding.status_id, column.id);
            }
        }

        const buckets = new Map<string, any[]>(
            (boardColumns as any[]).map((column) => [column.id, [] as any[]]),
        );
        const unsorted: any[] = [];

        for (const row of cards as any[]) {
            // A soft-deleted task is filtered out here rather than having its
            // BoardTask row cleaned up: undeleting the task should bring the
            // card back to the board it was on.
            if (!row.task || row.task.deleted_at) continue;

            const columnId = columnOfStatus.get(row.task.status_id);
            if (columnId && buckets.has(columnId)) buckets.get(columnId)!.push(row.task);
            else unsorted.push(row.task);
        }

        return {
            id: board.id,
            name: board.name,
            description: board.description,
            columns: (boardColumns as any[]).map((column) => ({
                id: column.id,
                name: column.name,
                category: column.category,
                sort_order: column.sort_order,
                wip_limit: column.wip_limit,
                tasks: buckets.get(column.id) ?? [],
            })),
            unsorted,
        };
    }

    async addTasks(tenantId: string, userId: string, boardId: string, taskIds: string[]) {
        await this.assertBoard(tenantId, boardId);

        const found = await this.db.projectTask.findMany({
            where: { id: { in: taskIds }, tenant_id: tenantId, deleted_at: null },
            select: { id: true, project_id: true },
        });
        if (found.length !== taskIds.length) {
            throw new NotFoundException('One or more tasks were not found');
        }

        const last = await this.db.boardTask.aggregate({
            where: { board_id: boardId, tenant_id: tenantId },
            _max: { sort_order: true },
        });
        let next = (last._max.sort_order ?? -1) + 1;

        await this.db.boardTask.createMany({
            data: found.map((task: { id: string }) => ({
                tenant_id: tenantId,
                board_id: boardId,
                task_id: task.id,
                sort_order: next++,
                added_by: userId,
            })),
            // Re-adding a card already on the board is a no-op, not an error:
            // the picker cannot always know what is already here.
            skipDuplicates: true,
        });

        const projectIds = [...new Set(found.map((task: { project_id: string }) => task.project_id))];
        for (const projectId of projectIds) {
            await this.columns.bindProject(tenantId, boardId, projectId);
        }

        return this.findOne(tenantId, boardId);
    }

    async removeTask(tenantId: string, boardId: string, taskId: string) {
        await this.assertBoard(tenantId, boardId);
        await this.db.boardTask.deleteMany({
            where: { board_id: boardId, tenant_id: tenantId, task_id: taskId },
        });
    }

    /**
     * A drop writes the task's real status through the same path a status change
     * takes anywhere else, so activity rows, `completed_at` and remaining-hours
     * behaviour are identical to moving the card from the task panel.
     */
    async moveCard(
        tenantId: string,
        userId: string,
        boardId: string,
        taskId: string,
        dto: MoveBoardCardDto,
    ) {
        await this.assertBoard(tenantId, boardId);

        const membership = await this.db.boardTask.findFirst({
            where: { board_id: boardId, tenant_id: tenantId, task_id: taskId },
        });
        if (!membership) throw new NotFoundException('That card is not on this board');

        const task = await this.db.projectTask.findFirst({
            where: { id: taskId, tenant_id: tenantId, deleted_at: null },
            select: { id: true, project_id: true },
        });
        if (!task) throw new NotFoundException('Task not found');

        const statusId = await this.columns.resolveStatusId(
            tenantId,
            boardId,
            dto.columnId,
            task.project_id,
        );
        if (!statusId) {
            throw new BadRequestException(
                'That column is not mapped to a status in this card’s project. Map it in board settings first.',
            );
        }

        await this.tasks.move(tenantId, userId, taskId, {
            statusId,
            sortOrder: dto.sortOrder,
        });
        await this.db.boardTask.update({
            where: { id: membership.id },
            data: { sort_order: dto.sortOrder },
        });

        return this.findOne(tenantId, boardId);
    }
}
