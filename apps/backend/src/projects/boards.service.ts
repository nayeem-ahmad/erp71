import {
    BadRequestException,
    Injectable,
    NotFoundException,
    ServiceUnavailableException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AssetsService } from '../assets/assets.service';
import { parseImageUpload } from '../common/image-upload.util';
import { ProjectAccessService, ProjectViewer } from './project-access.service';
import { BoardColumnsService } from './board-columns.service';
import { ProjectTasksService } from './project-tasks.service';
import {
    CreateBoardCardDto,
    CreateBoardDto,
    MoveBoardCardDto,
    MoveBoardCardsDto,
    SetBoardBackgroundImageDto,
    UpdateBoardDto,
} from './board.dto';

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

/**
 * Where an uploaded background lands. Per tenant, so one workspace's picture can
 * never be served as another's board.
 */
export function boardBackgroundFolder(tenantId: string): string {
    return `${tenantId}/project-boards`;
}

/**
 * A board on its way to the browser.
 *
 * `background_image_key` is the Cloudinary `public_id` and is the server's
 * business only — it is how this service deletes a replaced picture, and the
 * browser has no use for it. Stripped here rather than by a `select` so the
 * mutation responses keep the rest of the row exactly as they always returned
 * it, and so one function is the single place that decides this.
 */
function withoutStorageKey<T extends { background_image_key?: string | null }>(board: T) {
    const { background_image_key: _key, ...rest } = board;
    return rest;
}

@Injectable()
export class BoardsService {
    constructor(
        private readonly db: DatabaseService,
        private readonly columns: BoardColumnsService,
        private readonly tasks: ProjectTasksService,
        private readonly access: ProjectAccessService,
        private readonly assets: AssetsService,
    ) {}

    private async assertBoard(tenantId: string, boardId: string) {
        const board = await this.db.board.findFirst({
            where: { id: boardId, tenant_id: tenantId, deleted_at: null },
        });
        if (!board) throw new NotFoundException('Board not found');
        return board;
    }

    async list(viewer: ProjectViewer) {
        const tenantId = viewer.tenantId;
        const visible = await this.access.taskFilter(viewer);
        const boards = await this.db.board.findMany({
            where: { tenant_id: tenantId, deleted_at: null },
            orderBy: { created_at: 'desc' },
            // Scoped to non-deleted tasks: an unscoped count would advertise
            // cards that findOne() then hides, e.g. "8 cards" rendering as 6.
            // Private projects are filtered on the same principle — a count is
            // a disclosure too, and boards are shared across projects. A viewer
            // who only reads their own records counts only their own cards, so
            // the number still matches the board they then open.
            include: {
                _count: {
                    select: { cards: { where: { task: { deleted_at: null, ...visible } } } },
                },
            } as never,
        });
        return boards.map((board: any) => ({
            id: board.id,
            name: board.name,
            description: board.description,
            created_at: board.created_at,
            background_color: board.background_color,
            background_image_url: board.background_image_url,
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
        const board = await this.assertBoard(tenantId, boardId);

        // A board wears one background. Picking a colour therefore retires the
        // image rather than sitting behind it — and the file goes with it, or
        // the tenant is billed for a picture nothing can ever show again.
        const replacingImage =
            dto.backgroundColor !== undefined && Boolean((board as any).background_image_key);

        const updated = await this.db.board.update({
            where: { id: boardId },
            data: {
                ...(dto.name !== undefined ? { name: dto.name } : {}),
                ...(dto.description !== undefined ? { description: dto.description } : {}),
                ...(dto.backgroundColor !== undefined
                    ? {
                          background_color: dto.backgroundColor,
                          background_image_url: null,
                          background_image_key: null,
                      }
                    : {}),
            },
        });

        // After the row, for the same reason an attachment is deleted in this
        // order: a failed delete here leaves a stray file, while the reverse
        // leaves a board pointing at an image that is already gone.
        if (replacingImage) {
            await this.assets.deleteFile((board as any).background_image_key, 'image');
        }
        return withoutStorageKey(updated);
    }

    /**
     * Upload an image and hang it behind the board.
     *
     * The upload and the row move together here rather than the storefront's
     * two-step (upload returns a URL, a later PATCH stores it): a board
     * background has no form to save, so an upload that did not land anywhere
     * would be a file nobody asked for. Keeping the `public_id` is what lets
     * the next background replace this one without stranding it.
     */
    async setBackgroundImage(tenantId: string, boardId: string, dto: SetBoardBackgroundImageDto) {
        const board = await this.assertBoard(tenantId, boardId);
        const { buffer } = parseImageUpload(dto.imageBase64, dto.mimeType);

        if (!this.assets.isEnabled()) {
            // Distinguishable from a transient failure: this will not fix
            // itself on retry, and the operator needs to know why.
            throw new ServiceUnavailableException(
                'File storage is not configured, so the background could not be saved.',
            );
        }

        const stem = (dto.fileName ?? 'background').replace(/\.[^.]+$/, '').slice(0, 100);
        const safeStem =
            stem.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'background';

        let stored: { url: string; publicId: string };
        try {
            stored = await this.assets.uploadBuffer(
                buffer,
                boardBackgroundFolder(tenantId),
                safeStem,
                'image',
            );
        } catch {
            throw new ServiceUnavailableException('The background could not be uploaded.');
        }

        const updated = await this.db.board.update({
            where: { id: boardId },
            data: {
                background_image_url: stored.url,
                background_image_key: stored.publicId,
                // The colour goes: one background, and leaving it set would
                // decide the board's look again the moment the image is cleared.
                background_color: null,
            },
        });

        const previousKey = (board as any).background_image_key;
        if (previousKey && previousKey !== stored.publicId) {
            await this.assets.deleteFile(previousKey, 'image');
        }
        return withoutStorageKey(updated);
    }

    /** Back to the plain board: both columns cleared, and the file with them. */
    async clearBackground(tenantId: string, boardId: string) {
        const board = await this.assertBoard(tenantId, boardId);
        const updated = await this.db.board.update({
            where: { id: boardId },
            data: {
                background_color: null,
                background_image_url: null,
                background_image_key: null,
            },
        });
        if ((board as any).background_image_key) {
            await this.assets.deleteFile((board as any).background_image_key, 'image');
        }
        return withoutStorageKey(updated);
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
    async findOne(viewer: ProjectViewer, boardId: string) {
        const tenantId = viewer.tenantId;
        const board = await this.assertBoard(tenantId, boardId);

        // A board is tenant-level and its cards come from any project, so the
        // filter belongs on the cards rather than on the board: a shared board
        // stays open to everyone, and the cards drawn from a private project
        // simply are not on it for anyone outside that project. The same holds
        // one level in for a narrow viewer — the board opens, and holds their
        // cards only.
        const visible = await this.access.taskFilter(viewer);

        const [boardColumns, cards] = await Promise.all([
            this.columns.listColumns(tenantId, boardId),
            this.db.boardTask.findMany({
                where: {
                    board_id: boardId,
                    tenant_id: tenantId,
                    ...(Object.keys(visible).length ? { task: visible } : {}),
                } as never,
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
            background_color: (board as any).background_color ?? null,
            background_image_url: (board as any).background_image_url ?? null,
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

    async addTasks(viewer: ProjectViewer, boardId: string, taskIds: string[]) {
        const tenantId = viewer.tenantId;
        const userId = viewer.userId;
        await this.assertBoard(tenantId, boardId);

        // Deduped before the existence check: a repeated id in the request is
        // not a missing task, and without this an unlucky duplicate would also
        // reach `createMany` twice in the same batch, which `skipDuplicates`
        // does not protect against (it only guards against rows that already
        // exist in the table, not two identical rows in one call).
        const uniqueTaskIds = [...new Set(taskIds)];

        const found = await this.db.projectTask.findMany({
            where: {
                id: { in: uniqueTaskIds },
                tenant_id: tenantId,
                deleted_at: null,
                ...(await this.access.taskFilter(viewer)),
            } as never,
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

        return this.findOne(viewer, boardId);
    }

    /**
     * Compose a card straight into a column, the way JIRA lets you add an issue
     * at the bottom of a lane. The board is cross-project, so the project comes
     * with the request — nothing else can say which status set the new task
     * belongs to.
     *
     * The column decides the status rather than the project's default: a card
     * typed into "In Progress" that opened in "To Do" would jump lanes the
     * moment it was saved.
     */
    async createCard(
        viewer: ProjectViewer,
        boardId: string,
        columnId: string,
        dto: CreateBoardCardDto,
    ) {
        const tenantId = viewer.tenantId;
        await this.assertBoard(tenantId, boardId);

        const column = (await this.columns.listColumns(tenantId, boardId)).find(
            (c: { id: string }) => c.id === columnId,
        );
        if (!column) throw new NotFoundException('Board column not found');

        // Visibility is checked before anything is bound: a project the viewer
        // cannot see must not leave its status set mapped onto a shared board.
        await this.access.assertProjectVisible(viewer, dto.projectId);

        // The first card from a project usually arrives through addTasks, which
        // binds the whole status set. Composing is the other way in, so it has
        // to bind too or the card it just made would land in Unsorted.
        await this.columns.bindProject(tenantId, boardId, dto.projectId);

        const statusId = await this.columns.resolveStatusId(
            tenantId,
            boardId,
            columnId,
            dto.projectId,
        );
        if (!statusId) {
            throw new BadRequestException(
                'That column is not mapped to a status in this project. Map it in board settings first.',
            );
        }

        const task = await this.tasks.create(viewer, {
            projectId: dto.projectId,
            title: dto.title,
            statusId,
        });

        // addTasks returns the reloaded board, which is exactly what the page
        // needs to render the new card.
        return this.addTasks(viewer, boardId, [task.id]);
    }

    async removeTask(viewer: ProjectViewer, boardId: string, taskId: string) {
        const tenantId = viewer.tenantId;
        await this.assertBoard(tenantId, boardId);
        // Not a soft check: a card the viewer cannot see is a card they must
        // not be able to pull off a board everyone else is using.
        await this.tasks.assertTask(viewer, taskId);
        await this.db.boardTask.deleteMany({
            where: { board_id: boardId, tenant_id: tenantId, task_id: taskId },
        });
    }

    /**
     * Every card that renders in one column, in the order it renders: the
     * board's membership rows whose task sits in one of the column's bound
     * statuses. The same set `moveCard` renumbers against, lifted out because
     * the bulk operations below all need it too.
     *
     * Deliberately not narrowed to what the *viewer* can see. `sort_order` is
     * the board's, not one reader's, so a narrow viewer reordering the cards
     * they hold must not renumber a colleague's card out from under them —
     * `orderCards` keeps every row it was not sent in the slot it already
     * occupies for exactly that reason.
     */
    private columnCardRows(
        tx: any,
        tenantId: string,
        boardId: string,
        boundStatusIds: string[],
    ): Promise<{ id: string; task_id: string }[]> {
        return tx.boardTask.findMany({
            where: {
                board_id: boardId,
                tenant_id: tenantId,
                task: { status_id: { in: boundStatusIds }, deleted_at: null },
            },
            orderBy: [{ sort_order: 'asc' }, { added_at: 'asc' }],
            select: { id: true, task_id: true },
        });
    }

    /** Writes `sort_order` = position, in one pass over an already-ordered list. */
    private async writeCardOrder(tx: any, ordered: { id: string }[]) {
        for (let i = 0; i < ordered.length; i += 1) {
            await tx.boardTask.update({ where: { id: ordered[i].id }, data: { sort_order: i } });
        }
    }

    /** A column of this board with its bindings, or a 404. */
    private async assertColumn(tenantId: string, boardId: string, columnId: string) {
        const columns = await this.columns.listColumns(tenantId, boardId);
        const column = (columns as any[]).find((row) => row.id === columnId);
        if (!column) throw new NotFoundException('Board column not found');
        return column;
    }

    /**
     * Several cards into one column at once — what the column menu's "move all
     * cards to" and the selection bar send.
     *
     * Every status is resolved before anything is written, and an unmapped
     * project refuses the whole call. A per-card best effort would leave the
     * user looking at a column that took eleven of their thirteen cards with
     * nothing on screen saying which two stayed behind.
     */
    async moveCards(viewer: ProjectViewer, boardId: string, dto: MoveBoardCardsDto) {
        const tenantId = viewer.tenantId;
        await this.assertBoard(tenantId, boardId);

        // Deduped for the same reason addTasks dedupes: a repeated id is not a
        // missing card, and it must not be appended to the column twice.
        const taskIds = [...new Set(dto.taskIds)];

        const column = await this.assertColumn(tenantId, boardId, dto.columnId);
        const boundStatusIds = (column.bindings ?? []).map((binding: any) => binding.status_id);

        const memberships = await this.db.boardTask.findMany({
            where: { board_id: boardId, tenant_id: tenantId, task_id: { in: taskIds } },
            select: { id: true, task_id: true },
        });
        if (memberships.length !== taskIds.length) {
            throw new NotFoundException('One or more cards are not on this board');
        }

        const tasks = await this.db.projectTask.findMany({
            where: {
                id: { in: taskIds },
                tenant_id: tenantId,
                deleted_at: null,
                ...(await this.access.taskFilter(viewer)),
            } as never,
            select: { id: true, project_id: true, status_id: true },
        });
        if (tasks.length !== taskIds.length) {
            throw new NotFoundException('One or more tasks were not found');
        }

        // Resolved once per project rather than once per card: a board that
        // mixes three projects asks three questions, not thirty.
        const statusOfProject = new Map<string, string | null>();
        for (const task of tasks as { project_id: string }[]) {
            if (statusOfProject.has(task.project_id)) continue;
            statusOfProject.set(
                task.project_id,
                await this.columns.resolveStatusId(tenantId, boardId, dto.columnId, task.project_id),
            );
        }

        // A card whose status is already bound here is staying in its own
        // column, so it needs no mapping — only the ones actually crossing a
        // lane do. Checked before the first write; see the note above.
        const moving = (tasks as { id: string; project_id: string; status_id: string }[]).filter(
            (task) => !boundStatusIds.includes(task.status_id),
        );
        if (moving.some((task) => !statusOfProject.get(task.project_id))) {
            throw new BadRequestException(
                'That column is not mapped to a status in one of these cards’ projects. Map it in board settings first.',
            );
        }

        for (const task of moving) {
            // Through the same path a single drop takes, so the activity row,
            // `completed_at` and the watcher notification are identical.
            // MAX_SAFE_INTEGER is clamped to "last" by `move` itself: a bulk
            // move has no one place in the project's own status list, and the
            // end is the one that disturbs nobody else's order.
            await this.tasks.move(viewer, task.id, {
                statusId: statusOfProject.get(task.project_id)!,
                sortOrder: Number.MAX_SAFE_INTEGER,
            });
        }

        const membershipOfTask = new Map(
            memberships.map((row: { id: string; task_id: string }) => [row.task_id, row]),
        );
        await this.db.$transaction(async (tx: any) => {
            const rows = await this.columnCardRows(tx, tenantId, boardId, boundStatusIds);
            const moved = new Set(taskIds);
            // Appended in the order they were sent, which for the column menu
            // is the order they were read in the column they came from.
            await this.writeCardOrder(tx, [
                ...rows.filter((row) => !moved.has(row.task_id)),
                ...taskIds.map((taskId) => membershipOfTask.get(taskId)!),
            ]);
        });

        return this.findOne(viewer, boardId);
    }

    /** Several cards off the board at once. The tasks themselves are untouched. */
    async removeCards(viewer: ProjectViewer, boardId: string, taskIds: string[]) {
        const tenantId = viewer.tenantId;
        await this.assertBoard(tenantId, boardId);

        const unique = [...new Set(taskIds)];
        // The same check `removeTask` makes, in one query: a card the viewer
        // cannot see is a card they must not be able to pull off a board
        // everyone else is using.
        const visible = await this.db.projectTask.findMany({
            where: {
                id: { in: unique },
                tenant_id: tenantId,
                deleted_at: null,
                ...(await this.access.taskFilter(viewer)),
            } as never,
            select: { id: true },
        });
        if (visible.length !== unique.length) {
            throw new NotFoundException('One or more tasks were not found');
        }

        await this.db.boardTask.deleteMany({
            where: { board_id: boardId, tenant_id: tenantId, task_id: { in: unique } },
        });

        return this.findOne(viewer, boardId);
    }

    /**
     * One column's cards, top to bottom — what "sort cards" sends after
     * comparing them in the browser.
     *
     * Cards the caller did not name keep the slots they already hold, and the
     * named ones are dealt back into the slots they occupied between them. So
     * sorting a filtered column rearranges the cards on screen and leaves the
     * hidden ones exactly where they were, rather than sweeping them to the
     * bottom of a column the user cannot see.
     */
    async orderCards(viewer: ProjectViewer, boardId: string, columnId: string, taskIds: string[]) {
        const tenantId = viewer.tenantId;
        await this.assertBoard(tenantId, boardId);

        const column = await this.assertColumn(tenantId, boardId, columnId);
        const boundStatusIds = (column.bindings ?? []).map((binding: any) => binding.status_id);

        await this.db.$transaction(async (tx: any) => {
            const rows = await this.columnCardRows(tx, tenantId, boardId, boundStatusIds);
            const rowOfTask = new Map(rows.map((row) => [row.task_id, row]));

            // Only ids that are actually in this column; a stale id is ignored
            // rather than refused, because the list was built from a view that
            // may be a moment behind the board.
            const named = taskIds.filter((taskId) => rowOfTask.has(taskId));
            const slots = rows
                .map((row, index) => index)
                .filter((index) => named.includes(rows[index].task_id));

            const ordered = [...rows];
            slots.forEach((slot, position) => {
                ordered[slot] = rowOfTask.get(named[position])!;
            });

            await this.writeCardOrder(tx, ordered);
        });

        return this.findOne(viewer, boardId);
    }

    /**
     * A drop writes the task's real status through the same path a status change
     * takes anywhere else, so activity rows, `completed_at` and remaining-hours
     * behaviour are identical to moving the card from the task panel.
     */
    async moveCard(
        viewer: ProjectViewer,
        boardId: string,
        taskId: string,
        dto: MoveBoardCardDto,
    ) {
        const tenantId = viewer.tenantId;
        await this.assertBoard(tenantId, boardId);

        const membership = await this.db.boardTask.findFirst({
            where: { board_id: boardId, tenant_id: tenantId, task_id: taskId },
        });
        if (!membership) throw new NotFoundException('That card is not on this board');

        const task = await this.db.projectTask.findFirst({
            where: {
                id: taskId,
                tenant_id: tenantId,
                deleted_at: null,
                ...(await this.access.taskFilter(viewer)),
            } as never,
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

            await this.tasks.move(viewer, taskId, {
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

        return this.findOne(viewer, boardId);
    }
}
