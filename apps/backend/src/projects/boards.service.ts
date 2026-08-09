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
            // Scoped to non-deleted tasks: an unscoped count would advertise
            // cards that findOne() then hides, e.g. "8 cards" rendering as 6.
            include: { _count: { select: { cards: { where: { task: { deleted_at: null } } } } } },
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
            // card back to the board it was on. `task_id` is a non-nullable
            // FK, so `row.task` itself is never missing.
            if (row.task.deleted_at) continue;

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

        // Deduped before the existence check: a repeated id in the request is
        // not a missing task, and without this an unlucky duplicate would also
        // reach `createMany` twice in the same batch, which `skipDuplicates`
        // does not protect against (it only guards against rows that already
        // exist in the table, not two identical rows in one call).
        const uniqueTaskIds = [...new Set(taskIds)];

        const found = await this.db.projectTask.findMany({
            where: { id: { in: uniqueTaskIds }, tenant_id: tenantId, deleted_at: null },
            select: { id: true, project_id: true },
        });
        if (found.length !== uniqueTaskIds.length) {
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
            select: { id: true, project_id: true, status_id: true },
        });
        if (!task) throw new NotFoundException('Task not found');

        // The bound statuses of the *target* column: the set that defines
        // which BoardTask rows render in it on the next findOne(). This is
        // what the sibling renumber below is scoped to — the direct analogue
        // of the (project_id, status_id) sibling scope in
        // ProjectTasksService.move (project-tasks.service.ts:344-375). It also
        // decides whether this drop is a reorder within the same column: if
        // the task's *current* status is already among these, the card never
        // left its column.
        const boardColumns = await this.columns.listColumns(tenantId, boardId);
        const targetColumn = (boardColumns as any[]).find((column) => column.id === dto.columnId);
        const boundStatusIds = (targetColumn?.bindings ?? []).map((b: any) => b.status_id);

        const reorderInPlace = boundStatusIds.includes(task.status_id);

        // A same-column reorder must not touch the task's status. Resolving
        // one anyway would use resolveStatusId's tie-break (the bound status
        // with the lowest sort_order for this project), which can differ from
        // the task's own current status whenever a project binds two
        // statuses to the same column — e.g. "Doing" and "Reviewing" both
        // IN_PROGRESS, auto-bound to the board's single IN_PROGRESS column.
        // Dragging a "Reviewing" card up one slot would otherwise silently
        // flip it to "Doing": a STATUS_CHANGED activity row, a watcher
        // notification, and a task-list reshuffle for what the user
        // experiences as a no-op.
        if (!reorderInPlace) {
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
        }

        // `BoardTask.sort_order` is a board-global counter on write (see
        // addTasks) but `dto.sortOrder` from the client — and findOne()'s
        // per-column read — is a within-column index. Without renumbering
        // here, writing dto.sortOrder straight to the moved row collides with
        // whatever unrelated card already held that number board-wide.
        await this.db.$transaction(async (tx: any) => {
            const siblings = await tx.boardTask.findMany({
                where: {
                    board_id: boardId,
                    tenant_id: tenantId,
                    id: { not: membership.id },
                    // Scoped to visible cards only: the client computes
                    // dto.sortOrder over the same set, and a soft-deleted
                    // task's card — never shown, never cleaned up — would
                    // otherwise push every drop one slot further than the
                    // client intended.
                    task: { status_id: { in: boundStatusIds }, deleted_at: null },
                },
                orderBy: [{ sort_order: 'asc' }, { added_at: 'asc' }],
                select: { id: true },
            });

            const index = Math.min(Math.max(dto.sortOrder, 0), siblings.length);
            const ordered = [
                ...siblings.slice(0, index),
                { id: membership.id },
                ...siblings.slice(index),
            ];

            for (let i = 0; i < ordered.length; i += 1) {
                await tx.boardTask.update({ where: { id: ordered[i].id }, data: { sort_order: i } });
            }
        });

        return this.findOne(tenantId, boardId);
    }
}
