# Cross-project Boards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Boards a first-class entity with its own submenu under Project Management, where one board holds hand-picked tasks drawn from any number of projects.

**Architecture:** A `Board` owns `BoardColumn` rows. Each board column binds to existing per-project `ProjectTaskStatus` rows through a `BoardColumnStatus` mapping table, so a card's column is derived from `ProjectTask.status_id` and a drop writes that same field through the existing `ProjectTasksService.move()` path. Membership is explicit via `BoardTask`. The per-project board concept is deleted.

**Tech Stack:** NestJS + Prisma + PostgreSQL (backend), Next.js 15 App Router + Tailwind + Zustand (frontend), Jest for both.

**Spec:** `docs/superpowers/specs/2026-08-09-cross-project-boards-design.md`

## Global Constraints

- Work on branch `dev`. `.githooks/` blocks commits on `main`.
- Every business query is scoped by `tenant_id`; controllers use `@UseInterceptors(TenantInterceptor)` and read the tenant from `@Tenant() tenant: TenantContext`.
- No new permission keys. Reads use `StorePermission.VIEW_PROJECTS`; board and card mutations use `StorePermission.MANAGE_PROJECTS`; column and binding configuration uses `StorePermission.MANAGE_PROJECT_SETTINGS`.
- `ProjectTask.status_id` stays the only truth about task status. Nothing in this feature writes it except through `ProjectTasksService.move()`.
- Prisma migrations: `npm run db:migrate` fails against the local database (it has no `_prisma_migrations` table). Apply SQL directly with `psql`, then `npx prisma generate`. **The local Postgres is on port 5434, not the 5432 in `.env`.** Commit a migration directory anyway for production.
- Frontend UI rules (`docs/ui-design-guidelines.md`): every `(app)` page uses `PageShell` + `PageHeader`; every modal uses `ModalShell`; primitives come from `@/components/ui`; `blue-600` is the only accent; emerald = success, amber = warning, red = danger; `text-sm`/`text-xs` body, `p-3 md:p-4` padding, `space-y-4` sections; no arbitrary hex classes, no `rounded-2xl`/`rounded-3xl`; toasts go through `@/lib/toast` only; ≥44px touch targets via `min-h-touch`; no horizontal body scroll at 360px.
- Every user-facing string goes through `useI18n()` and is added to `en`, `bn` and `ms` message files.
- After the last task, update `TODO.md` per `CLAUDE.md` — check off the item and move it to `## COMPLETED` with today's date.

## File Structure

**Created — backend**

| File | Responsibility |
|---|---|
| `apps/backend/src/projects/board.dto.ts` | Request DTOs for every board route. |
| `apps/backend/src/projects/board-columns.service.ts` | Column CRUD, seeding a new board's columns from the tenant template, auto-binding a project's statuses, manual binding overrides, resolving a `(column, project)` pair to a status id. |
| `apps/backend/src/projects/board-columns.service.spec.ts` | Tests for the above. |
| `apps/backend/src/projects/boards.service.ts` | Board CRUD, card membership, board read assembly, card moves. |
| `apps/backend/src/projects/boards.service.spec.ts` | Tests for the above. |
| `apps/backend/src/projects/boards.controller.ts` | Routes and permission decorators. |

**Created — frontend**

| File | Responsibility |
|---|---|
| `apps/frontend/src/app/(app)/projects/boards/page.tsx` | Board list + create modal. |
| `apps/frontend/src/app/(app)/projects/boards/page.test.tsx` | Tests for the list page. |
| `apps/frontend/src/app/(app)/projects/boards/[id]/page.tsx` | The board itself. Adapted from the deleted project board page. |
| `apps/frontend/src/app/(app)/projects/boards/[id]/page.test.tsx` | Tests for the board page. |
| `apps/frontend/src/app/(app)/projects/boards/[id]/columns/page.tsx` | Column configuration and per-project bindings. |
| `apps/frontend/src/components/projects/AddBoardTasksModal.tsx` | Cross-project task picker. |
| `apps/frontend/src/components/projects/AddBoardTasksModal.test.tsx` | Tests for the picker. |

**Modified**

| File | Change |
|---|---|
| `packages/database/prisma/schema.prisma` | Four new models + back-relations on `Tenant`, `ProjectTask`, `ProjectTaskStatus`, `User`. |
| `packages/shared-types/navigation.ts` | `projects.boards` registry entry + layout node. |
| `apps/backend/src/projects/projects.module.ts` | Register the new controller and services. |
| `apps/backend/src/projects/project-tasks.service.ts` | Repoint three notification links away from the deleted route; delete the `board()` method and its controller route. |
| `apps/backend/src/projects/project-comments.service.ts` | Repoint one notification link. |
| `apps/backend/src/projects/project-tasks.controller.ts` | Delete the `board/:projectId` route. |
| `apps/frontend/src/lib/api.ts` | Board client methods; remove `getProjectBoard`. |
| `apps/frontend/src/lib/routes.ts` | Add `boards`/`boardDetail`/`boardColumns`; remove `board`. |
| `apps/frontend/src/lib/localization/messages/{en,bn,ms}/*` | `sidebar.items.projectsBoards` + a `boards` message block. |
| `apps/frontend/src/app/(app)/projects/[id]/page.tsx` | Remove the Board link. |

**Deleted**

- `apps/frontend/src/app/(app)/projects/[id]/board/page.tsx`
- `apps/frontend/src/app/(app)/projects/[id]/board/page.test.tsx`

`apps/frontend/src/app/(app)/projects/[id]/columns/page.tsx` **stays** — projects still own the `ProjectTaskStatus` rows that board columns bind to.

`apps/frontend/src/components/projects/board-tasks.ts` and `board-drag.ts` are reused **unmodified**. Note their exported `BoardTask` type is a frontend card shape and is unrelated to the new Prisma `BoardTask` model.

---

### Task 1: Schema and migration

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260809000000_cross_project_boards/migration.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: Prisma models `Board`, `BoardColumn`, `BoardColumnStatus`, `BoardTask`, reachable on `DatabaseService` as `db.board`, `db.boardColumn`, `db.boardColumnStatus`, `db.boardTask`.

- [ ] **Step 1: Add the four models to the schema**

Append after the `ProjectTaskActivity` block in `packages/database/prisma/schema.prisma`:

```prisma
/// A wall of hand-picked cards. Unlike a project, a board has no work of its
/// own — every card on it is a ProjectTask that still belongs to its project.
model Board {
  id          String    @id @default(uuid())
  tenant_id   String
  name        String
  description String?
  created_by  String?
  created_at  DateTime  @default(now())
  updated_at  DateTime  @updatedAt
  deleted_at  DateTime?

  tenant  Tenant @relation(fields: [tenant_id], references: [id], onDelete: Cascade)
  creator User?  @relation("BoardCreator", fields: [created_by], references: [id])

  columns BoardColumn[]
  cards   BoardTask[]

  /// Names are deliberately not unique: a unique (tenant_id, name) would let a
  /// soft-deleted board hold its name hostage against a new one.
  @@index([tenant_id, deleted_at])
  @@map("boards")
}

model BoardColumn {
  id         String                    @id @default(uuid())
  tenant_id  String
  board_id   String
  name       String
  category   ProjectTaskStatusCategory @default(TODO)
  sort_order Int                       @default(0)
  /// Advisory, exactly like ProjectTaskStatus.wip_limit: the board marks a
  /// column over-limit, it does not refuse the drop.
  wip_limit  Int?
  created_at DateTime                  @default(now())
  updated_at DateTime                  @updatedAt

  tenant   Tenant              @relation(fields: [tenant_id], references: [id], onDelete: Cascade)
  board    Board               @relation(fields: [board_id], references: [id], onDelete: Cascade)
  bindings BoardColumnStatus[]

  @@unique([board_id, name])
  @@index([board_id, sort_order])
  @@map("board_columns")
}

/// Binds one project status to one column of one board.
model BoardColumnStatus {
  id              String @id @default(uuid())
  tenant_id       String
  board_id        String
  board_column_id String
  status_id       String

  tenant Tenant            @relation(fields: [tenant_id], references: [id], onDelete: Cascade)
  column BoardColumn       @relation(fields: [board_column_id], references: [id], onDelete: Cascade)
  status ProjectTaskStatus @relation(fields: [status_id], references: [id], onDelete: Cascade)

  /// `board_id` is denormalised for exactly this constraint. It guarantees a
  /// status resolves to at most one column, which is what stops a card
  /// appearing twice on the same board. Deriving it through board_column_id
  /// would lose that.
  @@unique([board_id, status_id])
  @@index([board_column_id])
  @@map("board_column_statuses")
}

/// Explicit membership. Nothing joins a board by rule.
model BoardTask {
  id         String   @id @default(uuid())
  tenant_id  String
  board_id   String
  task_id    String
  sort_order Int      @default(0)
  added_by   String?
  added_at   DateTime @default(now())

  tenant Tenant      @relation(fields: [tenant_id], references: [id], onDelete: Cascade)
  board  Board       @relation(fields: [board_id], references: [id], onDelete: Cascade)
  task   ProjectTask @relation(fields: [task_id], references: [id], onDelete: Cascade)
  adder  User?       @relation("BoardTaskAdder", fields: [added_by], references: [id])

  @@unique([board_id, task_id])
  @@index([board_id, sort_order])
  @@map("board_tasks")
}
```

- [ ] **Step 2: Add the back-relations**

Prisma will not validate without these. Add one line to each existing model:

- `model Tenant` — add:
```prisma
  boards             Board[]
  boardColumns       BoardColumn[]
  boardColumnStatuses BoardColumnStatus[]
  boardTasks         BoardTask[]
```
- `model User` — add:
```prisma
  createdBoards   Board[]     @relation("BoardCreator")
  addedBoardCards BoardTask[] @relation("BoardTaskAdder")
```
- `model ProjectTask` — add:
```prisma
  boardCards BoardTask[]
```
- `model ProjectTaskStatus` — add:
```prisma
  boardBindings BoardColumnStatus[]
```

- [ ] **Step 3: Verify the schema is valid**

Run: `cd packages/database && npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 4: Write the migration SQL**

Create `packages/database/prisma/migrations/20260809000000_cross_project_boards/migration.sql`:

```sql
CREATE TABLE "boards" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "boards_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "board_columns" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "board_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "ProjectTaskStatusCategory" NOT NULL DEFAULT 'TODO',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "wip_limit" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "board_columns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "board_column_statuses" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "board_id" TEXT NOT NULL,
    "board_column_id" TEXT NOT NULL,
    "status_id" TEXT NOT NULL,
    CONSTRAINT "board_column_statuses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "board_tasks" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "board_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "added_by" TEXT,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "board_tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "boards_tenant_id_deleted_at_idx" ON "boards"("tenant_id", "deleted_at");
CREATE UNIQUE INDEX "board_columns_board_id_name_key" ON "board_columns"("board_id", "name");
CREATE INDEX "board_columns_board_id_sort_order_idx" ON "board_columns"("board_id", "sort_order");
CREATE UNIQUE INDEX "board_column_statuses_board_id_status_id_key" ON "board_column_statuses"("board_id", "status_id");
CREATE INDEX "board_column_statuses_board_column_id_idx" ON "board_column_statuses"("board_column_id");
CREATE UNIQUE INDEX "board_tasks_board_id_task_id_key" ON "board_tasks"("board_id", "task_id");
CREATE INDEX "board_tasks_board_id_sort_order_idx" ON "board_tasks"("board_id", "sort_order");

ALTER TABLE "boards" ADD CONSTRAINT "boards_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "boards" ADD CONSTRAINT "boards_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "board_columns" ADD CONSTRAINT "board_columns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "board_columns" ADD CONSTRAINT "board_columns_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "board_column_statuses" ADD CONSTRAINT "board_column_statuses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "board_column_statuses" ADD CONSTRAINT "board_column_statuses_board_column_id_fkey" FOREIGN KEY ("board_column_id") REFERENCES "board_columns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "board_column_statuses" ADD CONSTRAINT "board_column_statuses_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "project_task_statuses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "board_tasks" ADD CONSTRAINT "board_tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "board_tasks" ADD CONSTRAINT "board_tasks_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "board_tasks" ADD CONSTRAINT "board_tasks_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "project_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "board_tasks" ADD CONSTRAINT "board_tasks_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

If `prisma validate` reported different table names for `tenants`, `users`, `project_tasks` or `project_task_statuses`, use the names from the `@@map` directives in the schema instead — do not guess.

- [ ] **Step 5: Apply the SQL to the local database and regenerate the client**

The local DB has no `_prisma_migrations` table, so `prisma migrate dev` fails. Apply directly. **It listens on port 5434, not the 5432 in `.env`:**

```bash
cd packages/database
psql "postgresql://postgres:postgres@localhost:5434/erp71" \
  -f prisma/migrations/20260809000000_cross_project_boards/migration.sql
npx prisma generate
```

Expected: four `CREATE TABLE` acknowledgements, then `Generated Prisma Client`. If the credentials differ, read them from the root `.env` and substitute the port.

- [ ] **Step 6: Verify the client exposes the new models**

Run:
```bash
cd packages/database && node -e "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();console.log(['board','boardColumn','boardColumnStatus','boardTask'].map(k=>k+':'+(typeof p[k])).join(' '))"
```
Expected: `board:object boardColumn:object boardColumnStatus:object boardTask:object`

- [ ] **Step 7: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations
git commit -m "feat(db): add Board, BoardColumn, BoardColumnStatus, BoardTask"
```

---

### Task 2: Column seeding and auto-binding

**Files:**
- Create: `apps/backend/src/projects/board-columns.service.ts`
- Test: `apps/backend/src/projects/board-columns.service.spec.ts`

**Interfaces:**
- Consumes: `DatabaseService` from `../database/database.service`; `ProjectSettingsService.listTaskStatuses(tenantId, includeInactive, projectId?)` from `./project-settings.service` (returns `ProjectTaskStatus[]` ordered by `sort_order`, seeding lazily when empty).
- Produces:
  - `BoardColumnsService.seedColumnsForNewBoard(tenantId: string, boardId: string): Promise<void>`
  - `BoardColumnsService.bindProject(tenantId: string, boardId: string, projectId: string): Promise<void>`
  - `BoardColumnsService.resolveStatusId(tenantId: string, boardId: string, columnId: string, projectId: string): Promise<string | null>`
  - `BoardColumnsService.listColumns(tenantId: string, boardId: string)` → columns ordered by `sort_order`, each with `bindings: { id, status_id, status: { id, name, project_id } }[]`
  - Exported pure helper `pickColumnForStatus(columns: BindableColumn[], status: BindableStatus): string | null`
  - Exported types `BindableColumn = { id: string; name: string; category: string; sort_order: number }` and `BindableStatus = { id: string; name: string; category: string }`

- [ ] **Step 1: Write the failing test for the pure matcher**

Create `apps/backend/src/projects/board-columns.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { BoardColumnsService, pickColumnForStatus } from './board-columns.service';
import { ProjectSettingsService } from './project-settings.service';
import { DatabaseService } from '../database/database.service';

const COLUMNS = [
    { id: 'c1', name: 'To Do', category: 'TODO', sort_order: 0 },
    { id: 'c2', name: 'In Progress', category: 'IN_PROGRESS', sort_order: 1 },
    { id: 'c3', name: 'In Review', category: 'IN_PROGRESS', sort_order: 2 },
    { id: 'c4', name: 'Done', category: 'DONE', sort_order: 3 },
];

describe('pickColumnForStatus', () => {
    it('matches on name', () => {
        expect(pickColumnForStatus(COLUMNS, { id: 's', name: 'In Review', category: 'TODO' })).toBe('c3');
    });

    it('matches on name ignoring case and surrounding whitespace', () => {
        expect(pickColumnForStatus(COLUMNS, { id: 's', name: '  in progress ', category: 'DONE' })).toBe('c2');
    });

    it('falls back to the lowest sort_order column of the same category', () => {
        expect(pickColumnForStatus(COLUMNS, { id: 's', name: 'Doing', category: 'IN_PROGRESS' })).toBe('c2');
    });

    it('returns null when neither name nor category matches', () => {
        expect(pickColumnForStatus([COLUMNS[0]], { id: 's', name: 'Doing', category: 'IN_PROGRESS' })).toBeNull();
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/backend && npx jest src/projects/board-columns.service.spec.ts`
Expected: FAIL — `Cannot find module './board-columns.service'`

- [ ] **Step 3: Write the matcher and service skeleton**

Create `apps/backend/src/projects/board-columns.service.ts`:

```typescript
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
}
```

- [ ] **Step 4: Run to verify the matcher tests pass**

Run: `cd apps/backend && npx jest src/projects/board-columns.service.spec.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Write the failing tests for seeding and binding**

Append to `board-columns.service.spec.ts`:

```typescript
describe('BoardColumnsService', () => {
    let service: BoardColumnsService;
    let db: any;
    let settings: any;

    const tenantId = 't1';

    beforeEach(async () => {
        db = {
            board: { findFirst: jest.fn().mockResolvedValue({ id: 'b1', tenant_id: tenantId }) },
            boardColumn: {
                findMany: jest.fn().mockResolvedValue(COLUMNS.map((c) => ({ ...c, board_id: 'b1' }))),
                createMany: jest.fn().mockResolvedValue({ count: 4 }),
            },
            boardColumnStatus: {
                findMany: jest.fn().mockResolvedValue([]),
                createMany: jest.fn().mockResolvedValue({ count: 0 }),
                findFirst: jest.fn().mockResolvedValue(null),
            },
            projectTaskStatus: { findMany: jest.fn().mockResolvedValue([]) },
        };
        settings = {
            listTaskStatuses: jest.fn().mockResolvedValue([
                { id: 't-todo', name: 'To Do', category: 'TODO', sort_order: 0 },
                { id: 't-prog', name: 'In Progress', category: 'IN_PROGRESS', sort_order: 1 },
                { id: 't-rev', name: 'In Review', category: 'IN_PROGRESS', sort_order: 2 },
                { id: 't-done', name: 'Done', category: 'DONE', sort_order: 3 },
            ]),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                BoardColumnsService,
                { provide: DatabaseService, useValue: db },
                { provide: ProjectSettingsService, useValue: settings },
            ],
        }).compile();
        service = module.get(BoardColumnsService);
    });

    it('seeds a new board from the tenant status template', async () => {
        await service.seedColumnsForNewBoard(tenantId, 'b1');

        expect(settings.listTaskStatuses).toHaveBeenCalledWith(tenantId, false);
        const rows = db.boardColumn.createMany.mock.calls[0][0].data;
        expect(rows.map((r: any) => r.name)).toEqual(['To Do', 'In Progress', 'In Review', 'Done']);
        expect(rows.every((r: any) => r.board_id === 'b1' && r.tenant_id === tenantId)).toBe(true);
    });

    it('binds every status of a project in one pass, not just one', async () => {
        settings.listTaskStatuses.mockResolvedValue([
            { id: 'p-todo', name: 'To Do', category: 'TODO', sort_order: 0 },
            { id: 'p-doing', name: 'Doing', category: 'IN_PROGRESS', sort_order: 1 },
            { id: 'p-done', name: 'Done', category: 'DONE', sort_order: 2 },
        ]);

        await service.bindProject(tenantId, 'b1', 'p1');

        const rows = db.boardColumnStatus.createMany.mock.calls[0][0].data;
        expect(rows).toEqual([
            { tenant_id: tenantId, board_id: 'b1', board_column_id: 'c1', status_id: 'p-todo' },
            { tenant_id: tenantId, board_id: 'b1', board_column_id: 'c2', status_id: 'p-doing' },
            { tenant_id: tenantId, board_id: 'b1', board_column_id: 'c4', status_id: 'p-done' },
        ]);
    });

    it('never overwrites a binding that already exists, so a manual override survives', async () => {
        settings.listTaskStatuses.mockResolvedValue([
            { id: 'p-todo', name: 'To Do', category: 'TODO', sort_order: 0 },
            { id: 'p-doing', name: 'Doing', category: 'IN_PROGRESS', sort_order: 1 },
        ]);
        db.boardColumnStatus.findMany.mockResolvedValue([
            { status_id: 'p-doing', board_column_id: 'c3' },
        ]);

        await service.bindProject(tenantId, 'b1', 'p1');

        const rows = db.boardColumnStatus.createMany.mock.calls[0][0].data;
        expect(rows).toEqual([
            { tenant_id: tenantId, board_id: 'b1', board_column_id: 'c1', status_id: 'p-todo' },
        ]);
    });

    it('writes nothing when no status can be placed', async () => {
        db.boardColumn.findMany.mockResolvedValue([]);
        settings.listTaskStatuses.mockResolvedValue([
            { id: 'p-doing', name: 'Doing', category: 'IN_PROGRESS', sort_order: 0 },
        ]);

        await service.bindProject(tenantId, 'b1', 'p1');

        expect(db.boardColumnStatus.createMany).not.toHaveBeenCalled();
    });

    it('resolves a column to the bound status of the given project', async () => {
        db.boardColumnStatus.findMany.mockResolvedValue([
            { status_id: 'p-doing', board_column_id: 'c2', status: { id: 'p-doing', project_id: 'p1', sort_order: 3 } },
            { status_id: 'q-doing', board_column_id: 'c2', status: { id: 'q-doing', project_id: 'p2', sort_order: 0 } },
        ]);

        await expect(service.resolveStatusId(tenantId, 'b1', 'c2', 'p1')).resolves.toBe('p-doing');
        await expect(service.resolveStatusId(tenantId, 'b1', 'c2', 'p2')).resolves.toBe('q-doing');
    });

    it('picks the lowest sort_order when a column binds several statuses of one project', async () => {
        db.boardColumnStatus.findMany.mockResolvedValue([
            { status_id: 'p-b', board_column_id: 'c2', status: { id: 'p-b', project_id: 'p1', sort_order: 5 } },
            { status_id: 'p-a', board_column_id: 'c2', status: { id: 'p-a', project_id: 'p1', sort_order: 2 } },
        ]);

        await expect(service.resolveStatusId(tenantId, 'b1', 'c2', 'p1')).resolves.toBe('p-a');
    });

    it('resolves to null when the column has no binding for that project', async () => {
        db.boardColumnStatus.findMany.mockResolvedValue([]);
        await expect(service.resolveStatusId(tenantId, 'b1', 'c2', 'p9')).resolves.toBeNull();
    });

    it('refuses a board belonging to another tenant', async () => {
        db.board.findFirst.mockResolvedValue(null);
        await expect(service.listColumns('other', 'b1')).rejects.toBeInstanceOf(NotFoundException);
    });
});
```

- [ ] **Step 6: Run to verify they fail**

Run: `cd apps/backend && npx jest src/projects/board-columns.service.spec.ts`
Expected: FAIL — `service.seedColumnsForNewBoard is not a function`

- [ ] **Step 7: Implement the service methods**

Add to the `BoardColumnsService` class body in `board-columns.service.ts`:

```typescript
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
```

- [ ] **Step 8: Run to verify all tests pass**

Run: `cd apps/backend && npx jest src/projects/board-columns.service.spec.ts`
Expected: PASS — 12 tests.

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/projects/board-columns.service.ts apps/backend/src/projects/board-columns.service.spec.ts
git commit -m "feat(boards): seed board columns and auto-bind project statuses"
```

---

### Task 3: Column CRUD and manual bindings

**Files:**
- Modify: `apps/backend/src/projects/board-columns.service.ts`
- Modify: `apps/backend/src/projects/board-columns.service.spec.ts`
- Create: `apps/backend/src/projects/board.dto.ts`

**Interfaces:**
- Consumes: `BoardColumnsService.assertBoard` (private, Task 2); `pickColumnForStatus` (Task 2).
- Produces:
  - `BoardColumnsService.createColumn(tenantId, boardId, dto: CreateBoardColumnDto)`
  - `BoardColumnsService.updateColumn(tenantId, boardId, columnId, dto: UpdateBoardColumnDto)`
  - `BoardColumnsService.deleteColumn(tenantId, boardId, columnId): Promise<void>`
  - `BoardColumnsService.setBindings(tenantId, boardId, columnId, statusIds: string[]): Promise<void>`
  - DTO classes in `board.dto.ts`: `CreateBoardDto`, `UpdateBoardDto`, `AddBoardTasksDto`, `MoveBoardCardDto`, `CreateBoardColumnDto`, `UpdateBoardColumnDto`, `SetBoardColumnStatusesDto`

- [ ] **Step 1: Write the DTOs**

Create `apps/backend/src/projects/board.dto.ts`:

```typescript
import {
    ArrayNotEmpty,
    IsArray,
    IsEnum,
    IsInt,
    IsOptional,
    IsString,
    IsUUID,
    MaxLength,
    Min,
    MinLength,
} from 'class-validator';

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
}

export class AddBoardTasksDto {
    @IsArray()
    @ArrayNotEmpty()
    @IsUUID('4', { each: true })
    taskIds!: string[];
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
```

- [ ] **Step 2: Write the failing tests for column CRUD and bindings**

Append a new `describe` block to `apps/backend/src/projects/board-columns.service.spec.ts`:

```typescript
describe('BoardColumnsService column CRUD', () => {
    let service: BoardColumnsService;
    let db: any;

    const tenantId = 't1';

    beforeEach(async () => {
        db = {
            board: { findFirst: jest.fn().mockResolvedValue({ id: 'b1', tenant_id: tenantId }) },
            boardColumn: {
                findMany: jest.fn().mockResolvedValue(COLUMNS.map((c) => ({ ...c, board_id: 'b1' }))),
                findFirst: jest.fn().mockResolvedValue({ id: 'c2', board_id: 'b1', tenant_id: tenantId }),
                create: jest.fn().mockResolvedValue({ id: 'c9' }),
                update: jest.fn().mockResolvedValue({ id: 'c2' }),
                delete: jest.fn().mockResolvedValue({ id: 'c2' }),
                aggregate: jest.fn().mockResolvedValue({ _max: { sort_order: 3 } }),
            },
            boardColumnStatus: {
                deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
                createMany: jest.fn().mockResolvedValue({ count: 2 }),
            },
            projectTaskStatus: {
                findMany: jest.fn().mockResolvedValue([{ id: 's1' }, { id: 's2' }]),
            },
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                BoardColumnsService,
                { provide: DatabaseService, useValue: db },
                { provide: ProjectSettingsService, useValue: { listTaskStatuses: jest.fn() } },
            ],
        }).compile();
        service = module.get(BoardColumnsService);
    });

    it('appends a new column after the last one when no sortOrder is given', async () => {
        await service.createColumn(tenantId, 'b1', { name: 'Blocked', category: 'TODO' });

        expect(db.boardColumn.create).toHaveBeenCalledWith({
            data: {
                tenant_id: tenantId,
                board_id: 'b1',
                name: 'Blocked',
                category: 'TODO',
                sort_order: 4,
                wip_limit: null,
            },
        });
    });

    it('replaces a column’s bindings wholesale', async () => {
        await service.setBindings(tenantId, 'b1', 'c2', ['s1', 's2']);

        expect(db.boardColumnStatus.deleteMany).toHaveBeenCalledWith({
            where: { board_id: 'b1', tenant_id: tenantId, board_column_id: 'c2' },
        });
        expect(db.boardColumnStatus.createMany).toHaveBeenCalledWith({
            data: [
                { tenant_id: tenantId, board_id: 'b1', board_column_id: 'c2', status_id: 's1' },
                { tenant_id: tenantId, board_id: 'b1', board_column_id: 'c2', status_id: 's2' },
            ],
            skipDuplicates: true,
        });
    });

    it('steals a status from whichever other column on this board held it', async () => {
        await service.setBindings(tenantId, 'b1', 'c2', ['s1']);

        // A status may sit in only one column per board, so binding it here must
        // clear it elsewhere or the (board_id, status_id) unique rejects the write.
        expect(db.boardColumnStatus.deleteMany).toHaveBeenCalledWith({
            where: { board_id: 'b1', tenant_id: tenantId, status_id: { in: ['s1'] } },
        });
    });

    it('rejects a status id that is not a real status in this tenant', async () => {
        db.projectTaskStatus.findMany.mockResolvedValue([{ id: 's1' }]);
        await expect(service.setBindings(tenantId, 'b1', 'c2', ['s1', 'ghost'])).rejects.toBeInstanceOf(
            NotFoundException,
        );
    });

    it('refuses to touch a column belonging to a different board', async () => {
        db.boardColumn.findFirst.mockResolvedValue(null);
        await expect(service.deleteColumn(tenantId, 'b1', 'c2')).rejects.toBeInstanceOf(NotFoundException);
    });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `cd apps/backend && npx jest src/projects/board-columns.service.spec.ts`
Expected: FAIL — `service.createColumn is not a function`

- [ ] **Step 4: Implement column CRUD and bindings**

Add to `BoardColumnsService` in `board-columns.service.ts`, importing the DTO types at the top:

```typescript
import {
    CreateBoardColumnDto,
    UpdateBoardColumnDto,
} from './board.dto';
```

```typescript
    private async assertColumn(tenantId: string, boardId: string, columnId: string) {
        const column = await this.db.boardColumn.findFirst({
            where: { id: columnId, board_id: boardId, tenant_id: tenantId },
        });
        if (!column) throw new NotFoundException('Board column not found');
        return column;
    }

    async createColumn(tenantId: string, boardId: string, dto: CreateBoardColumnDto) {
        await this.assertBoard(tenantId, boardId);

        let sortOrder = dto.sortOrder;
        if (sortOrder === undefined) {
            const last = await this.db.boardColumn.aggregate({
                where: { board_id: boardId, tenant_id: tenantId },
                _max: { sort_order: true },
            });
            sortOrder = (last._max.sort_order ?? -1) + 1;
        }

        return this.db.boardColumn.create({
            data: {
                tenant_id: tenantId,
                board_id: boardId,
                name: dto.name,
                category: dto.category,
                sort_order: sortOrder,
                wip_limit: dto.wipLimit ?? null,
            },
        });
    }

    async updateColumn(
        tenantId: string,
        boardId: string,
        columnId: string,
        dto: UpdateBoardColumnDto,
    ) {
        await this.assertColumn(tenantId, boardId, columnId);
        return this.db.boardColumn.update({
            where: { id: columnId },
            data: {
                ...(dto.name !== undefined ? { name: dto.name } : {}),
                ...(dto.category !== undefined ? { category: dto.category } : {}),
                ...(dto.sortOrder !== undefined ? { sort_order: dto.sortOrder } : {}),
                ...(dto.wipLimit !== undefined ? { wip_limit: dto.wipLimit } : {}),
            },
        });
    }

    /**
     * Bindings cascade with the column. The cards that were in it fall to
     * Unsorted on the next read rather than disappearing.
     */
    async deleteColumn(tenantId: string, boardId: string, columnId: string) {
        await this.assertColumn(tenantId, boardId, columnId);
        await this.db.boardColumn.delete({ where: { id: columnId } });
    }

    /** Replaces this column's bindings wholesale. An empty list unbinds it. */
    async setBindings(tenantId: string, boardId: string, columnId: string, statusIds: string[]) {
        await this.assertColumn(tenantId, boardId, columnId);

        if (statusIds.length > 0) {
            const found = await this.db.projectTaskStatus.findMany({
                where: { id: { in: statusIds }, tenant_id: tenantId },
                select: { id: true },
            });
            if (found.length !== statusIds.length) {
                throw new NotFoundException('One or more statuses were not found');
            }

            // A status sits in at most one column per board — enforced by the
            // (board_id, status_id) unique — so binding it here has to take it
            // off whichever column currently holds it.
            await this.db.boardColumnStatus.deleteMany({
                where: { board_id: boardId, tenant_id: tenantId, status_id: { in: statusIds } },
            });
        }

        await this.db.boardColumnStatus.deleteMany({
            where: { board_id: boardId, tenant_id: tenantId, board_column_id: columnId },
        });

        if (statusIds.length === 0) return;

        await this.db.boardColumnStatus.createMany({
            data: statusIds.map((statusId) => ({
                tenant_id: tenantId,
                board_id: boardId,
                board_column_id: columnId,
                status_id: statusId,
            })),
            skipDuplicates: true,
        });
    }
```

- [ ] **Step 5: Run to verify all tests pass**

Run: `cd apps/backend && npx jest src/projects/board-columns.service.spec.ts`
Expected: PASS — 17 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/projects/board-columns.service.ts apps/backend/src/projects/board-columns.service.spec.ts apps/backend/src/projects/board.dto.ts
git commit -m "feat(boards): column CRUD and manual status bindings"
```

---

### Task 4: Board CRUD, membership and card moves

**Files:**
- Create: `apps/backend/src/projects/boards.service.ts`
- Test: `apps/backend/src/projects/boards.service.spec.ts`

**Interfaces:**
- Consumes: `BoardColumnsService.seedColumnsForNewBoard`, `.bindProject`, `.resolveStatusId`, `.listColumns` (Tasks 2–3); DTOs from `./board.dto` (Task 3); `ProjectTasksService.move(tenantId, userId, taskId, dto: { statusId: string; sortOrder: number; sprintId?: string; clearSprint?: boolean })` from `./project-tasks.service`.
- Produces:
  - `BoardsService.list(tenantId)` → `{ id, name, description, card_count }[]`
  - `BoardsService.create(tenantId, userId, dto: CreateBoardDto)`
  - `BoardsService.findOne(tenantId, boardId)` → `{ id, name, description, columns: BoardViewColumn[], unsorted: Card[] }`
  - `BoardsService.update(tenantId, boardId, dto: UpdateBoardDto)`
  - `BoardsService.remove(tenantId, boardId): Promise<void>`
  - `BoardsService.addTasks(tenantId, userId, boardId, taskIds: string[])`
  - `BoardsService.removeTask(tenantId, boardId, taskId): Promise<void>`
  - `BoardsService.moveCard(tenantId, userId, boardId, taskId, dto: MoveBoardCardDto)`

- [ ] **Step 1: Write the failing tests**

Create `apps/backend/src/projects/boards.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BoardsService } from './boards.service';
import { BoardColumnsService } from './board-columns.service';
import { ProjectTasksService } from './project-tasks.service';
import { DatabaseService } from '../database/database.service';

describe('BoardsService', () => {
    let service: BoardsService;
    let db: any;
    let columns: any;
    let tasks: any;

    const tenantId = 't1';
    const userId = 'u1';

    const card = (id: string, projectId: string, statusId: string) => ({
        id,
        board_id: 'b1',
        task_id: id,
        sort_order: 0,
        task: {
            id,
            title: `Task ${id}`,
            priority: 'MEDIUM',
            status_id: statusId,
            project_id: projectId,
            deleted_at: null,
            project: { id: projectId, code: projectId.toUpperCase(), name: projectId, short_name: null },
            labels: [],
            checklistItems: [],
            _count: { subtasks: 0, comments: 0 },
        },
    });

    beforeEach(async () => {
        db = {
            board: {
                findFirst: jest.fn().mockResolvedValue({ id: 'b1', tenant_id: tenantId, name: 'Release', description: null }),
                findMany: jest.fn().mockResolvedValue([]),
                create: jest.fn().mockResolvedValue({ id: 'b1', name: 'Release' }),
                update: jest.fn().mockResolvedValue({ id: 'b1' }),
            },
            boardTask: {
                findMany: jest.fn().mockResolvedValue([]),
                createMany: jest.fn().mockResolvedValue({ count: 1 }),
                deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
                aggregate: jest.fn().mockResolvedValue({ _max: { sort_order: 2 } }),
                update: jest.fn().mockResolvedValue({}),
                findFirst: jest.fn().mockResolvedValue({ id: 'bt1', board_id: 'b1', task_id: 'k1' }),
            },
            boardColumnStatus: { findMany: jest.fn().mockResolvedValue([]) },
            projectTask: {
                findMany: jest.fn().mockResolvedValue([{ id: 'k1', project_id: 'p1' }]),
                findFirst: jest.fn().mockResolvedValue({ id: 'k1', project_id: 'p1', tenant_id: tenantId, deleted_at: null }),
            },
        };
        columns = {
            seedColumnsForNewBoard: jest.fn().mockResolvedValue(undefined),
            bindProject: jest.fn().mockResolvedValue(undefined),
            resolveStatusId: jest.fn().mockResolvedValue('s-target'),
            listColumns: jest.fn().mockResolvedValue([
                { id: 'c1', name: 'To Do', category: 'TODO', sort_order: 0, wip_limit: null, bindings: [{ status_id: 's1' }] },
                { id: 'c2', name: 'Done', category: 'DONE', sort_order: 1, wip_limit: null, bindings: [{ status_id: 's2' }] },
            ]),
        };
        tasks = { move: jest.fn().mockResolvedValue({ id: 'k1' }) };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                BoardsService,
                { provide: DatabaseService, useValue: db },
                { provide: BoardColumnsService, useValue: columns },
                { provide: ProjectTasksService, useValue: tasks },
            ],
        }).compile();
        service = module.get(BoardsService);
    });

    it('seeds columns when a board is created', async () => {
        await service.create(tenantId, userId, { name: 'Release' });

        expect(db.board.create).toHaveBeenCalledWith({
            data: { tenant_id: tenantId, name: 'Release', description: null, created_by: userId },
        });
        expect(columns.seedColumnsForNewBoard).toHaveBeenCalledWith(tenantId, 'b1');
    });

    it('groups cards into the column their status is bound to', async () => {
        db.boardTask.findMany.mockResolvedValue([card('k1', 'p1', 's1'), card('k2', 'p2', 's2')]);

        const board = await service.findOne(tenantId, 'b1');

        expect(board.columns.map((c: any) => c.tasks.map((t: any) => t.id))).toEqual([['k1'], ['k2']]);
        expect(board.unsorted).toEqual([]);
    });

    it('puts a card whose status is bound to nothing into unsorted', async () => {
        db.boardTask.findMany.mockResolvedValue([card('k3', 'p3', 's-loose')]);

        const board = await service.findOne(tenantId, 'b1');

        expect(board.unsorted.map((t: any) => t.id)).toEqual(['k3']);
        expect(board.columns.every((c: any) => c.tasks.length === 0)).toBe(true);
    });

    it('omits a soft-deleted task from the board', async () => {
        const deleted = card('k4', 'p1', 's1');
        deleted.task.deleted_at = new Date() as never;
        db.boardTask.findMany.mockResolvedValue([deleted]);

        const board = await service.findOne(tenantId, 'b1');

        expect(board.columns.every((c: any) => c.tasks.length === 0)).toBe(true);
        expect(board.unsorted).toEqual([]);
    });

    it('binds each newly-seen project once when tasks are added', async () => {
        db.projectTask.findMany.mockResolvedValue([
            { id: 'k1', project_id: 'p1' },
            { id: 'k2', project_id: 'p1' },
            { id: 'k3', project_id: 'p2' },
        ]);

        await service.addTasks(tenantId, userId, 'b1', ['k1', 'k2', 'k3']);

        expect(columns.bindProject).toHaveBeenCalledTimes(2);
        expect(columns.bindProject).toHaveBeenCalledWith(tenantId, 'b1', 'p1');
        expect(columns.bindProject).toHaveBeenCalledWith(tenantId, 'b1', 'p2');
    });

    it('rejects a task id that is not in this tenant', async () => {
        db.projectTask.findMany.mockResolvedValue([{ id: 'k1', project_id: 'p1' }]);

        await expect(service.addTasks(tenantId, userId, 'b1', ['k1', 'ghost'])).rejects.toBeInstanceOf(
            NotFoundException,
        );
    });

    it('moves a card by writing the task status the column binds for that project', async () => {
        await service.moveCard(tenantId, userId, 'b1', 'k1', { columnId: 'c2', sortOrder: 1 });

        expect(columns.resolveStatusId).toHaveBeenCalledWith(tenantId, 'b1', 'c2', 'p1');
        expect(tasks.move).toHaveBeenCalledWith(tenantId, userId, 'k1', {
            statusId: 's-target',
            sortOrder: 1,
        });
        expect(db.boardTask.update).toHaveBeenCalledWith({
            where: { id: 'bt1' },
            data: { sort_order: 1 },
        });
    });

    it('refuses a drop onto a column with no binding for that card’s project, leaving the task alone', async () => {
        columns.resolveStatusId.mockResolvedValue(null);

        await expect(
            service.moveCard(tenantId, userId, 'b1', 'k1', { columnId: 'c2', sortOrder: 0 }),
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(tasks.move).not.toHaveBeenCalled();
        expect(db.boardTask.update).not.toHaveBeenCalled();
    });

    it('refuses to read a board from another tenant', async () => {
        db.board.findFirst.mockResolvedValue(null);
        await expect(service.findOne('other', 'b1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('soft-deletes rather than dropping the row', async () => {
        await service.remove(tenantId, 'b1');

        expect(db.board.update).toHaveBeenCalledWith({
            where: { id: 'b1' },
            data: { deleted_at: expect.any(Date) },
        });
    });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/backend && npx jest src/projects/boards.service.spec.ts`
Expected: FAIL — `Cannot find module './boards.service'`

- [ ] **Step 3: Implement the service**

Create `apps/backend/src/projects/boards.service.ts`:

```typescript
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
```

- [ ] **Step 4: Run to verify all tests pass**

Run: `cd apps/backend && npx jest src/projects/boards.service.spec.ts`
Expected: PASS — 11 tests.

The spec also asks that a drop into a `DONE` column set `completed_at` and write a `ProjectTaskActivity` row. Do **not** add that test here — `ProjectTasksService` is mocked in this file, so a test would only assert the mock. That behaviour belongs to `move()` and is already covered in `project-tasks.service.spec.ts`. What this file proves is the part that is new: that `moveCard` hands `move()` the right `statusId`.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/projects/boards.service.ts apps/backend/src/projects/boards.service.spec.ts
git commit -m "feat(boards): board CRUD, card membership and mapped card moves"
```

---

### Task 5: Controller and module wiring

**Files:**
- Create: `apps/backend/src/projects/boards.controller.ts`
- Modify: `apps/backend/src/projects/projects.module.ts`

**Interfaces:**
- Consumes: `BoardsService` (Task 4), `BoardColumnsService` (Tasks 2–3), DTOs from `./board.dto` (Task 3).
- Produces: HTTP routes under `/projects/boards`, consumed by Task 8's API client.

Routes are registered on their own `@Controller('projects/boards')` rather than added to `ProjectsController`, whose `:id` parameter route would otherwise swallow `boards`. Nest matches controllers in registration order, so `BoardsController` must be listed **before** `ProjectsController` in the module.

- [ ] **Step 1: Write the controller**

Create `apps/backend/src/projects/boards.controller.ts`:

```typescript
import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Put,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireStorePermission } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { BoardsService } from './boards.service';
import { BoardColumnsService } from './board-columns.service';
import {
    AddBoardTasksDto,
    CreateBoardColumnDto,
    CreateBoardDto,
    MoveBoardCardDto,
    SetBoardColumnStatusesDto,
    UpdateBoardColumnDto,
    UpdateBoardDto,
} from './board.dto';

@Controller('projects/boards')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class BoardsController {
    constructor(
        private readonly boards: BoardsService,
        private readonly columns: BoardColumnsService,
    ) {}

    @Get()
    @RequireStorePermission(StorePermission.VIEW_PROJECTS)
    list(@Tenant() tenant: TenantContext) {
        return this.boards.list(tenant.tenantId);
    }

    @Post()
    @RequireStorePermission(StorePermission.MANAGE_PROJECTS)
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateBoardDto) {
        return this.boards.create(tenant.tenantId, tenant.userId, dto);
    }

    @Get(':id')
    @RequireStorePermission(StorePermission.VIEW_PROJECTS)
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.boards.findOne(tenant.tenantId, id);
    }

    @Patch(':id')
    @RequireStorePermission(StorePermission.MANAGE_PROJECTS)
    update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateBoardDto) {
        return this.boards.update(tenant.tenantId, id, dto);
    }

    @Delete(':id')
    @RequireStorePermission(StorePermission.MANAGE_PROJECTS)
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.boards.remove(tenant.tenantId, id);
    }

    @Post(':id/tasks')
    @RequireStorePermission(StorePermission.MANAGE_PROJECTS)
    addTasks(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: AddBoardTasksDto,
    ) {
        return this.boards.addTasks(tenant.tenantId, tenant.userId, id, dto.taskIds);
    }

    @Delete(':id/tasks/:taskId')
    @RequireStorePermission(StorePermission.MANAGE_PROJECTS)
    removeTask(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Param('taskId') taskId: string,
    ) {
        return this.boards.removeTask(tenant.tenantId, id, taskId);
    }

    @Patch(':id/tasks/:taskId/move')
    @RequireStorePermission(StorePermission.MANAGE_PROJECTS)
    moveCard(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Param('taskId') taskId: string,
        @Body() dto: MoveBoardCardDto,
    ) {
        return this.boards.moveCard(tenant.tenantId, tenant.userId, id, taskId, dto);
    }

    @Get(':id/columns')
    @RequireStorePermission(StorePermission.VIEW_PROJECTS)
    listColumns(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.columns.listColumns(tenant.tenantId, id);
    }

    @Post(':id/columns')
    @RequireStorePermission(StorePermission.MANAGE_PROJECT_SETTINGS)
    createColumn(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: CreateBoardColumnDto,
    ) {
        return this.columns.createColumn(tenant.tenantId, id, dto);
    }

    @Patch(':id/columns/:columnId')
    @RequireStorePermission(StorePermission.MANAGE_PROJECT_SETTINGS)
    updateColumn(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Param('columnId') columnId: string,
        @Body() dto: UpdateBoardColumnDto,
    ) {
        return this.columns.updateColumn(tenant.tenantId, id, columnId, dto);
    }

    @Delete(':id/columns/:columnId')
    @RequireStorePermission(StorePermission.MANAGE_PROJECT_SETTINGS)
    deleteColumn(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Param('columnId') columnId: string,
    ) {
        return this.columns.deleteColumn(tenant.tenantId, id, columnId);
    }

    @Put(':id/columns/:columnId/statuses')
    @RequireStorePermission(StorePermission.MANAGE_PROJECT_SETTINGS)
    setColumnStatuses(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Param('columnId') columnId: string,
        @Body() dto: SetBoardColumnStatusesDto,
    ) {
        return this.columns.setBindings(tenant.tenantId, id, columnId, dto.statusIds);
    }
}
```

`TenantContext` is `{ tenantId, storeId?, userId, userRole? }` — verified in `apps/backend/src/database/tenant.decorator.ts`.

- [ ] **Step 2: Register in the module**

In `apps/backend/src/projects/projects.module.ts`, add the imports and list `BoardsController` **first** in `controllers`:

```typescript
import { BoardsController } from './boards.controller';
import { BoardsService } from './boards.service';
import { BoardColumnsService } from './board-columns.service';
```

```typescript
    controllers: [
        // First: `/projects/boards` would otherwise be captured by
        // ProjectsController's `:id` route.
        BoardsController,
        ProjectsController,
        ProjectTasksController,
        ProjectTimeController,
        SprintsController,
    ],
    providers: [
        ProjectsService,
        BoardsService,
        BoardColumnsService,
        // ...the rest unchanged
    ],
```

- [ ] **Step 3: Verify the backend compiles**

Run: `cd apps/backend && npx tsc --noEmit -p tsconfig.json`
Expected: no output.

- [ ] **Step 4: Verify the whole projects suite still passes**

Run: `cd apps/backend && npx jest src/projects`
Expected: PASS, no failures.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/projects/boards.controller.ts apps/backend/src/projects/projects.module.ts
git commit -m "feat(boards): expose board routes under /projects/boards"
```

---

### Task 6: Retire the per-project board endpoint and links

**Files:**
- Modify: `apps/backend/src/projects/project-tasks.service.ts` (lines ~85-136 `board()`, ~393, ~528)
- Modify: `apps/backend/src/projects/project-comments.service.ts:57`
- Modify: `apps/backend/src/projects/project-tasks.controller.ts`
- Modify: `apps/backend/src/projects/project-tasks.service.spec.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `GET /project-tasks/board/:projectId` no longer exists; notification links point at `/projects/:projectId`.

Four notification links point at `/projects/${project_id}/board`, a route Task 9 deletes. A notification linking to a 404 is worse than one linking to the project.

- [ ] **Step 1: Repoint the notification links**

In `apps/backend/src/projects/project-tasks.service.ts`, both occurrences of:

```typescript
                link: `/projects/${task.project_id}/board`,
```

become:

```typescript
                link: `/projects/${task.project_id}`,
```

In `apps/backend/src/projects/project-comments.service.ts:57`, make the same substitution.

- [ ] **Step 2: Delete the per-project board endpoint**

In `apps/backend/src/projects/project-tasks.controller.ts`, delete the whole handler whose decorator is `@Get('board/:projectId')`, including its decorators.

In `apps/backend/src/projects/project-tasks.service.ts`, delete the `board(...)` method entirely — the one containing the "Self-heal a board whose tasks are still on the tenant template" comment, lines ~85-136.

- [ ] **Step 3: Check what the deletion orphaned**

Run:
```bash
cd apps/backend && grep -rn "adoptTasksFromTemplate\|attachLoggedHours" src/ | grep -v spec
```

If `adoptTasksFromTemplate` now has no non-spec caller, leave it in `project-settings.service.ts` — it is a data-repair helper worth keeping, and its own tests still cover it. If `attachLoggedHours` has no caller left, delete it and its tests. Report which case applied.

- [ ] **Step 4: Delete the endpoint's tests**

Run: `cd apps/backend && grep -n "board(" src/projects/project-tasks.service.spec.ts`

Delete every `it(...)` block that calls `service.board(...)`. Leave the rest of the file untouched.

- [ ] **Step 5: Verify compile and tests**

Run:
```bash
cd apps/backend && npx tsc --noEmit -p tsconfig.json && npx jest src/projects
```
Expected: no compile output; all project tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/projects/
git commit -m "refactor(projects): retire the per-project board endpoint and repoint notification links"
```

---

### Task 7: Navigation entry

**Files:**
- Modify: `packages/shared-types/navigation.ts:174-178, 381-385`
- Modify: `apps/frontend/src/lib/localization/messages/en/core.ts:263-266`
- Modify: `apps/frontend/src/lib/localization/messages/bn/core.ts`
- Modify: `apps/frontend/src/lib/localization/messages/ms/core.ts`
- Modify: `apps/frontend/src/lib/routes.ts:162-174`

**Interfaces:**
- Consumes: nothing.
- Produces: nav id `projects.boards` → `/projects/boards`; `routes.projects.boards`, `routes.projects.boardDetail(id)`, `routes.projects.boardColumns(id)`.

- [ ] **Step 1: Add the registry entry**

In `packages/shared-types/navigation.ts`, after the `'projects.list'` entry:

```typescript
  'projects.boards': { id: 'projects.boards', kind: 'link', icon: 'KanbanSquare', labelKey: 'sidebar.items.projectsBoards', href: '/projects/boards' },
```

- [ ] **Step 2: Add the layout node and renumber siblings**

Replace the `projects` block in `DEFAULT_TENANT_NAV_LAYOUT`:

```typescript
  layoutNode('projects', null, 7),
  layoutNode('projects.list', 'projects', 0),
  layoutNode('projects.boards', 'projects', 1),
  layoutNode('projects.tasks', 'projects', 2),
  layoutNode('projects.sprints', 'projects', 3),
  layoutNode('projects.setup', 'projects', 4),
```

- [ ] **Step 3: Confirm the icon name resolves**

Run: `grep -n "KanbanSquare" apps/frontend/src/lib/nav-icons.ts`

If it returns nothing, add `KanbanSquare` to that file's import from `lucide-react` and to its icon map, following the shape of the entries already there. `resolveNavIcon` falls back silently, so an unregistered name shows the wrong icon rather than failing.

- [ ] **Step 4: Add the labels**

In `apps/frontend/src/lib/localization/messages/en/core.ts`, in the `sidebar.items` block after `projectsList`:

```typescript
            projectsBoards: 'Boards',
```

Add the same key to the matching block in `bn/core.ts` (`'বোর্ড'`) and `ms/core.ts` (`'Papan'`).

- [ ] **Step 5: Update the route constants**

In `apps/frontend/src/lib/routes.ts`, in the `projects` block, delete the `board:` line and add:

```typescript
        boards: '/projects/boards',
        boardDetail: (id: string) => `/projects/boards/${id}` as const,
        boardColumns: (id: string) => `/projects/boards/${id}/columns` as const,
```

Leave `columns: (id: string) => ...` alone — the per-project status editor stays.

- [ ] **Step 6: Verify the nav tests still pass**

Run:
```bash
cd apps/frontend && npx jest src/lib/nav-resolver.test.ts src/lib/sidebar-nav-filter.test.ts src/components/Sidebar.test.tsx
cd ../backend && npx jest src/navigation
```
Expected: PASS in both. If a test asserts an exact child count or ordering under `projects`, update that assertion to include Boards.

- [ ] **Step 7: Commit**

```bash
git add packages/shared-types/navigation.ts apps/frontend/src/lib/routes.ts apps/frontend/src/lib/localization apps/frontend/src/lib/nav-icons.ts
git commit -m "feat(nav): add Boards under Project Management"
```

---

### Task 8: API client and message strings

**Files:**
- Modify: `apps/frontend/src/lib/api.ts:3503-3504`
- Modify: `apps/frontend/src/lib/localization/messages/{en,bn,ms}/projects.ts`

**Interfaces:**
- Consumes: routes from Task 5.
- Produces, on the `api` object:
  - `getBoards(): Promise<BoardSummary[]>`
  - `getBoard(id: string)`
  - `createBoard(data: { name: string; description?: string })`
  - `updateBoard(id: string, data: { name?: string; description?: string })`
  - `deleteBoard(id: string)`
  - `addBoardTasks(id: string, taskIds: string[])`
  - `removeBoardTask(id: string, taskId: string)`
  - `moveBoardCard(id: string, taskId: string, data: { columnId: string; sortOrder: number })`
  - `getBoardColumns(id: string)`
  - `createBoardColumn(id: string, data: { name: string; category: string; wipLimit?: number })`
  - `updateBoardColumn(id: string, columnId: string, data: Record<string, unknown>)`
  - `deleteBoardColumn(id: string, columnId: string)`
  - `setBoardColumnStatuses(id: string, columnId: string, statusIds: string[])`

- [ ] **Step 1: Replace `getProjectBoard` with the board client**

In `apps/frontend/src/lib/api.ts`, delete these two lines:

```typescript
    /** Kanban passes no sprintId; scrum passes the active sprint's. */
    getProjectBoard: (projectId: string, sprintId?: string) =>
        fetchWithAuth(`/project-tasks/board/${projectId}${sprintId ? `?sprintId=${sprintId}` : ''}`),
```

and add in their place:

```typescript
    getBoards: () => fetchWithAuth('/projects/boards'),
    getBoard: (id: string) => fetchWithAuth(`/projects/boards/${id}`),
    createBoard: (data: { name: string; description?: string }) =>
        fetchWithAuth('/projects/boards', {
            method: 'POST',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    updateBoard: (id: string, data: { name?: string; description?: string }) =>
        fetchWithAuth(`/projects/boards/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    deleteBoard: (id: string) => fetchWithAuth(`/projects/boards/${id}`, { method: 'DELETE' }),
    addBoardTasks: (id: string, taskIds: string[]) =>
        fetchWithAuth(`/projects/boards/${id}/tasks`, {
            method: 'POST',
            body: JSON.stringify({ taskIds }),
            headers: { 'Content-Type': 'application/json' },
        }),
    removeBoardTask: (id: string, taskId: string) =>
        fetchWithAuth(`/projects/boards/${id}/tasks/${taskId}`, { method: 'DELETE' }),
    moveBoardCard: (id: string, taskId: string, data: { columnId: string; sortOrder: number }) =>
        fetchWithAuth(`/projects/boards/${id}/tasks/${taskId}/move`, {
            method: 'PATCH',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    getBoardColumns: (id: string) => fetchWithAuth(`/projects/boards/${id}/columns`),
    createBoardColumn: (id: string, data: { name: string; category: string; wipLimit?: number }) =>
        fetchWithAuth(`/projects/boards/${id}/columns`, {
            method: 'POST',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    updateBoardColumn: (id: string, columnId: string, data: Record<string, unknown>) =>
        fetchWithAuth(`/projects/boards/${id}/columns/${columnId}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    deleteBoardColumn: (id: string, columnId: string) =>
        fetchWithAuth(`/projects/boards/${id}/columns/${columnId}`, { method: 'DELETE' }),
    setBoardColumnStatuses: (id: string, columnId: string, statusIds: string[]) =>
        fetchWithAuth(`/projects/boards/${id}/columns/${columnId}/statuses`, {
            method: 'PUT',
            body: JSON.stringify({ statusIds }),
            headers: { 'Content-Type': 'application/json' },
        }),
```

- [ ] **Step 2: Add the message strings**

In `apps/frontend/src/lib/localization/messages/en/projects.ts`, add a `boards` block at the top level of the exported object:

```typescript
    boards: {
        title: 'Boards',
        subtitle: 'Hand-picked cards from any project',
        newBoard: 'New board',
        name: 'Name',
        description: 'Description',
        empty: 'No boards yet. Create one and add tasks from any project.',
        cardCount: '{count} cards',
        addTasks: 'Add tasks',
        addTasksTitle: 'Add tasks to this board',
        removeCard: 'Remove from board',
        searchTasks: 'Search tasks',
        allProjects: 'All projects',
        selectedCount: '{count} selected',
        noResults: 'No matching tasks',
        added: 'Tasks added',
        removed: 'Card removed',
        created: 'Board created',
        deleted: 'Board deleted',
        deleteConfirm: 'Delete this board? The tasks on it are not affected.',
        boardSettings: 'Board settings',
        unsorted: 'Unsorted',
        unsortedHint: 'These cards sit in a status this board has not mapped to a column.',
        unmappedDrop: 'That column is not mapped for this card’s project. Map it in board settings.',
        columns: 'Columns',
        columnName: 'Column name',
        category: 'Category',
        wipLimit: 'WIP limit',
        addColumn: 'Add column',
        mappedStatuses: 'Mapped statuses',
        noMappings: 'Not mapped for any project on this board',
    },
```

Add the same keys, translated, to `bn/projects.ts` and `ms/projects.ts`. If either file's shape is checked by `apps/frontend/src/lib/localization/catalog.test.ts`, a missing key fails that test — which is the point.

- [ ] **Step 3: Verify the catalog test passes**

Run: `cd apps/frontend && npx jest src/lib/localization`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/lib/api.ts apps/frontend/src/lib/localization
git commit -m "feat(boards): API client and message strings"
```

---

### Task 9: Board list page and the cross-project task picker

**Files:**
- Create: `apps/frontend/src/app/(app)/projects/boards/page.tsx`
- Test: `apps/frontend/src/app/(app)/projects/boards/page.test.tsx`
- Create: `apps/frontend/src/components/projects/AddBoardTasksModal.tsx`
- Test: `apps/frontend/src/components/projects/AddBoardTasksModal.test.tsx`

**Interfaces:**
- Consumes: `api.getBoards`, `api.createBoard`, `api.deleteBoard`, `api.addBoardTasks`, `api.getProjectTasks`, `api.getProjects` (Task 8 and existing); `routes.projects.boards` / `.boardDetail` (Task 7); `PageShell`, `PageHeader`, `Button`, `Input`, `Textarea` from `@/components/ui`; `ModalShell`, `ModalHeader`, `ModalFooter` from `@/components/ModalShell`; `toast` from `@/lib/toast`; `useI18n` from `@/lib/i18n`.
- Produces: `AddBoardTasksModal` with props `{ boardId: string; onClose: () => void; onAdded: () => void }`, default export.

Model both files on `apps/frontend/src/app/(app)/projects/sprints/page.tsx` for the list-page shape and on an existing `ModalShell` consumer for the modal shape. Match their conventions rather than inventing new ones.

- [ ] **Step 1: Write the failing test for the list page**

Create `apps/frontend/src/app/(app)/projects/boards/page.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BoardsPage from './page';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({
    api: { getBoards: jest.fn(), createBoard: jest.fn(), deleteBoard: jest.fn() },
}));

describe('BoardsPage', () => {
    beforeEach(() => {
        (api.getBoards as jest.Mock).mockResolvedValue([
            { id: 'b1', name: 'Release 4', description: 'Cross-team', card_count: 7 },
        ]);
        (api.createBoard as jest.Mock).mockResolvedValue({ id: 'b2' });
    });

    it('lists boards with their card counts', async () => {
        render(<BoardsPage />);
        expect(await screen.findByText('Release 4')).toBeInTheDocument();
        expect(screen.getByText(/7/)).toBeInTheDocument();
    });

    it('shows an empty state when there are no boards', async () => {
        (api.getBoards as jest.Mock).mockResolvedValue([]);
        render(<BoardsPage />);
        expect(await screen.findByText(/no boards yet/i)).toBeInTheDocument();
    });

    it('creates a board from the modal and reloads the list', async () => {
        render(<BoardsPage />);
        await screen.findByText('Release 4');

        await userEvent.click(screen.getByRole('button', { name: /new board/i }));
        await userEvent.type(screen.getByLabelText(/name/i), 'Support queue');
        await userEvent.click(screen.getByRole('button', { name: /^create$/i }));

        await waitFor(() =>
            expect(api.createBoard).toHaveBeenCalledWith({ name: 'Support queue', description: '' }),
        );
        expect(api.getBoards).toHaveBeenCalledTimes(2);
    });
});
```

If the repo's other page tests wrap in an i18n or toast provider, wrap this render the same way — copy the setup from `apps/frontend/src/app/(app)/projects/tasks/page.test.tsx`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/frontend && npx jest "src/app/(app)/projects/boards/page.test.tsx"`
Expected: FAIL — cannot resolve `./page`.

- [ ] **Step 3: Build the list page**

Create `apps/frontend/src/app/(app)/projects/boards/page.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Trash2 } from 'lucide-react';
import { PageShell, PageHeader, Button, Input, Textarea, ConfirmDialog } from '@/components/ui';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';

interface BoardSummary {
    id: string;
    name: string;
    description?: string | null;
    card_count: number;
}

export default function BoardsPage() {
    const { t } = useI18n();
    const [boards, setBoards] = useState<BoardSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [nameError, setNameError] = useState('');
    const [saving, setSaving] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<BoardSummary | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setBoards((await api.getBoards()) as BoardSummary[]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const closeModal = () => {
        setCreating(false);
        setName('');
        setDescription('');
        setNameError('');
    };

    const submit = async () => {
        if (!name.trim()) {
            setNameError(t('boards.name'));
            return;
        }
        setSaving(true);
        try {
            await api.createBoard({ name: name.trim(), description });
            toast.success(t('boards.created'));
            closeModal();
            await load();
        } catch {
            toast.error(t('common.errorGeneric'));
        } finally {
            setSaving(false);
        }
    };

    const confirmDelete = async () => {
        if (!pendingDelete) return;
        try {
            await api.deleteBoard(pendingDelete.id);
            toast.success(t('boards.deleted'));
            await load();
        } catch {
            toast.error(t('common.errorGeneric'));
        } finally {
            setPendingDelete(null);
        }
    };

    return (
        <PageShell>
            <PageHeader
                title={t('boards.title')}
                subtitle={t('boards.subtitle')}
                breadcrumbs={modulePageBreadcrumbs('projects', t('boards.title'))}
                actions={<Button onClick={() => setCreating(true)}>{t('boards.newBoard')}</Button>}
            />

            {loading ? null : boards.length === 0 ? (
                <p className="text-sm text-gray-500">{t('boards.empty')}</p>
            ) : (
                <div className="space-y-4">
                    {boards.map((board) => (
                        <div
                            key={board.id}
                            className="flex items-center gap-3 rounded-lg border border-gray-200 p-3 md:p-4"
                        >
                            <Link href={routes.projects.boardDetail(board.id)} className="min-h-touch flex-1">
                                <span className="block text-sm font-medium text-blue-600">{board.name}</span>
                                {board.description ? (
                                    <span className="block text-xs text-gray-500">{board.description}</span>
                                ) : null}
                                <span className="block text-xs text-gray-500">
                                    {t('boards.cardCount', { count: board.card_count })}
                                </span>
                            </Link>
                            <button
                                type="button"
                                aria-label={t('common.delete')}
                                onClick={() => setPendingDelete(board)}
                                className="min-h-touch min-w-touch rounded-lg text-gray-400 hover:text-red-600"
                            >
                                <Trash2 className="mx-auto h-4 w-4" />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {creating ? (
                <ModalShell onBackdropClick={closeModal}>
                    <ModalHeader title={t('boards.newBoard')} onClose={closeModal} />
                    <div className="space-y-4 p-3 md:p-4">
                        <div>
                            <label htmlFor="board-name" className="mb-1 block text-xs text-gray-600">
                                {t('boards.name')}
                            </label>
                            <Input
                                id="board-name"
                                value={name}
                                onChange={(event) => {
                                    setName(event.target.value);
                                    setNameError('');
                                }}
                            />
                            {nameError ? <p className="mt-1 text-xs text-red-600">{nameError}</p> : null}
                        </div>
                        <div>
                            <label htmlFor="board-description" className="mb-1 block text-xs text-gray-600">
                                {t('boards.description')}
                            </label>
                            <Textarea
                                id="board-description"
                                value={description}
                                onChange={(event) => setDescription(event.target.value)}
                            />
                        </div>
                    </div>
                    <ModalFooter>
                        <Button variant="secondary" onClick={closeModal}>
                            {t('common.cancel')}
                        </Button>
                        <Button onClick={submit} disabled={saving}>
                            {t('common.create')}
                        </Button>
                    </ModalFooter>
                </ModalShell>
            ) : null}

            {pendingDelete ? (
                <ConfirmDialog
                    message={t('boards.deleteConfirm')}
                    onConfirm={confirmDelete}
                    onCancel={() => setPendingDelete(null)}
                />
            ) : null}
        </PageShell>
    );
}
```

Before running the test, reconcile three things against the real code rather than trusting this listing: `ModalHeader`'s prop names (read `apps/frontend/src/components/ModalShell.tsx`), `ConfirmDialog`'s props (read `apps/frontend/src/components/ui/ConfirmDialog.tsx`), and `modulePageBreadcrumbs`'s signature (read `apps/frontend/src/lib/page-breadcrumbs.ts`). Adjust the call sites to match — do not change those components. Likewise confirm `common.errorGeneric`, `common.cancel`, `common.create` and `common.delete` exist in `en/core.ts`; substitute the keys that do exist if not.

- [ ] **Step 4: Run to verify the list page tests pass**

Run: `cd apps/frontend && npx jest "src/app/(app)/projects/boards/page.test.tsx"`
Expected: PASS — 3 tests.

- [ ] **Step 5: Write the failing test for the picker**

Create `apps/frontend/src/components/projects/AddBoardTasksModal.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AddBoardTasksModal from './AddBoardTasksModal';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({
    api: { getProjects: jest.fn(), getProjectTasks: jest.fn(), addBoardTasks: jest.fn() },
}));

describe('AddBoardTasksModal', () => {
    beforeEach(() => {
        (api.getProjects as jest.Mock).mockResolvedValue({
            data: [
                { id: 'p1', name: 'Alpha', code: 'ALP' },
                { id: 'p2', name: 'Beta', code: 'BET' },
            ],
        });
        (api.getProjectTasks as jest.Mock).mockResolvedValue({
            data: [
                { id: 'k1', title: 'Fix login', project: { id: 'p1', code: 'ALP', name: 'Alpha' } },
                { id: 'k2', title: 'Ship docs', project: { id: 'p2', code: 'BET', name: 'Beta' } },
            ],
        });
        (api.addBoardTasks as jest.Mock).mockResolvedValue({});
    });

    it('lists tasks from more than one project together', async () => {
        render(<AddBoardTasksModal boardId="b1" onClose={jest.fn()} onAdded={jest.fn()} />);

        expect(await screen.findByText('Fix login')).toBeInTheDocument();
        expect(screen.getByText('Ship docs')).toBeInTheDocument();
    });

    it('submits every selected task in one request', async () => {
        const onAdded = jest.fn();
        render(<AddBoardTasksModal boardId="b1" onClose={jest.fn()} onAdded={onAdded} />);
        await screen.findByText('Fix login');

        await userEvent.click(screen.getByRole('checkbox', { name: /fix login/i }));
        await userEvent.click(screen.getByRole('checkbox', { name: /ship docs/i }));
        await userEvent.click(screen.getByRole('button', { name: /add/i }));

        await waitFor(() => expect(api.addBoardTasks).toHaveBeenCalledWith('b1', ['k1', 'k2']));
        expect(onAdded).toHaveBeenCalled();
    });

    it('passes the project filter to the task query', async () => {
        render(<AddBoardTasksModal boardId="b1" onClose={jest.fn()} onAdded={jest.fn()} />);
        await screen.findByText('Fix login');

        await userEvent.selectOptions(screen.getByLabelText(/project/i), 'p2');

        await waitFor(() =>
            expect(api.getProjectTasks).toHaveBeenLastCalledWith(
                expect.objectContaining({ projectId: 'p2' }),
            ),
        );
    });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `cd apps/frontend && npx jest src/components/projects/AddBoardTasksModal.test.tsx`
Expected: FAIL — cannot resolve `./AddBoardTasksModal`.

- [ ] **Step 7: Build the picker**

Create `apps/frontend/src/components/projects/AddBoardTasksModal.tsx`. Requirements:

- `'use client'`, default export, props `{ boardId: string; onClose: () => void; onAdded: () => void }`.
- `ModalShell size="lg"` with `onBackdropClick={onClose}`, `ModalHeader` titled `t('boards.addTasksTitle')`, `ModalFooter` with Cancel and an Add button reading `t('boards.selectedCount', { count })`.
- A `Select` labelled Project — first option `t('boards.allProjects')` with value `''`, then one per project from `api.getProjects()`.
- An `Input` labelled `t('boards.searchTasks')`, debounced 300ms.
- Refetches `api.getProjectTasks({ search, projectId, limit: 50 })` whenever search or project changes. Omit `projectId` when the filter is empty — `getProjectTasks` already drops empty values.
- Each row is a `Checkbox` whose accessible name is the task title, plus a project chip showing `project.short_name ?? project.code`. Row ≥44px.
- Selection is a `Set<string>` held across filter changes, so narrowing the filter does not silently drop earlier picks.
- Submit calls `api.addBoardTasks(boardId, [...selected])`, then `toast.success(t('boards.added'))`, `onAdded()`, `onClose()`.
- Empty results show `t('boards.noResults')`.

Confirm the exact response shape of `api.getProjects` and `api.getProjectTasks` before writing the mapping — both go through `fetchPaginated`, so they return `{ data, total, ... }` rather than a bare array. Adjust the test mocks only if the real shape differs from the assumption above.

- [ ] **Step 8: Run to verify the picker tests pass**

Run: `cd apps/frontend && npx jest src/components/projects/AddBoardTasksModal.test.tsx`
Expected: PASS — 3 tests.

- [ ] **Step 9: Commit**

```bash
git add "apps/frontend/src/app/(app)/projects/boards" apps/frontend/src/components/projects/AddBoardTasksModal.tsx apps/frontend/src/components/projects/AddBoardTasksModal.test.tsx
git commit -m "feat(boards): board list page and cross-project task picker"
```

---

### Task 10: The board page

**Files:**
- Create: `apps/frontend/src/app/(app)/projects/boards/[id]/page.tsx`
- Test: `apps/frontend/src/app/(app)/projects/boards/[id]/page.test.tsx`
- Delete: `apps/frontend/src/app/(app)/projects/[id]/board/page.tsx`
- Delete: `apps/frontend/src/app/(app)/projects/[id]/board/page.test.tsx`
- Modify: `apps/frontend/src/app/(app)/projects/[id]/page.tsx`

**Interfaces:**
- Consumes: `api.getBoard`, `api.moveBoardCard`, `api.removeBoardTask` (Task 8); `AddBoardTasksModal` (Task 9); `board-drag.ts` exports `CARD_ATTR`, `COLUMN_ATTR`, `movedFar`, `resolveDropTarget`, `toFullIndex`, `type DropTarget`; `board-tasks.ts` exports `applyFilters`, `assigneeNameOf`, `assigneeOptionsFrom`, `countTasks`, `coverClass`, `dueStateOf`, `hasActiveFilter`, `initialsOf`, `isOverWip`, `labelClass`, `labelsOf`, `NO_FILTERS`, `projectLabelOf`, `type BoardColumn`, `type BoardFilters`, `type BoardTask`; `TaskDetailPanel` from `@/components/projects/TaskDetailPanel`.
- Produces: the route `/projects/boards/[id]`.

Start by copying `apps/frontend/src/app/(app)/projects/[id]/board/page.tsx` to the new path, then apply the changes below. Both helper modules are reused **unmodified** — `board-tasks.ts` already carries `BoardProject`, `projectLabelOf` and a `project` field on its card type.

**Removed from the copy:** the sprint/`Mode` switching (`type Mode = 'kanban' | 'scrum'`, the sprint selector, `BurndownChart` and its `BurndownPoint` import), the project header block, and everything reading `useParams().id` as a project id. A board is not a project and has no sprint of its own.

**Kept:** the pointer-drag machinery, card rendering, filters, WIP marking, and `TaskDetailPanel`.

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/app/(app)/projects/boards/[id]/page.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BoardPage from './page';
import { api } from '@/lib/api';

jest.mock('next/navigation', () => ({
    useParams: () => ({ id: 'b1' }),
    useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}));

jest.mock('@/lib/api', () => ({
    api: { getBoard: jest.fn(), moveBoardCard: jest.fn(), removeBoardTask: jest.fn() },
}));

const task = (id: string, title: string, project: { id: string; code: string; short_name?: string }) => ({
    id,
    title,
    priority: 'MEDIUM',
    status_id: `s-${id}`,
    project: { name: project.code, ...project },
    labels: [],
    checklistItems: [],
    _count: { subtasks: 0, comments: 0 },
});

describe('BoardPage', () => {
    beforeEach(() => {
        (api.getBoard as jest.Mock).mockResolvedValue({
            id: 'b1',
            name: 'Release 4',
            columns: [
                { id: 'c1', name: 'To Do', category: 'TODO', wip_limit: null, tasks: [task('k1', 'Fix login', { id: 'p1', code: 'ALP' })] },
                { id: 'c2', name: 'Done', category: 'DONE', wip_limit: null, tasks: [task('k2', 'Ship docs', { id: 'p2', code: 'BET' })] },
            ],
            unsorted: [],
        });
    });

    it('renders each column with its cards', async () => {
        render(<BoardPage />);
        expect(await screen.findByText('Fix login')).toBeInTheDocument();
        expect(screen.getByText('Ship docs')).toBeInTheDocument();
        expect(screen.getByText('To Do')).toBeInTheDocument();
    });

    it('shows a project chip on every card, because a board spans projects', async () => {
        render(<BoardPage />);
        await screen.findByText('Fix login');
        expect(screen.getByText('ALP')).toBeInTheDocument();
        expect(screen.getByText('BET')).toBeInTheDocument();
    });

    it('does not render the Unsorted column when nothing is unbound', async () => {
        render(<BoardPage />);
        await screen.findByText('Fix login');
        expect(screen.queryByText(/unsorted/i)).not.toBeInTheDocument();
    });

    it('renders the Unsorted column when a card has no bound column', async () => {
        (api.getBoard as jest.Mock).mockResolvedValue({
            id: 'b1',
            name: 'Release 4',
            columns: [{ id: 'c1', name: 'To Do', category: 'TODO', wip_limit: null, tasks: [] }],
            unsorted: [task('k9', 'Orphan card', { id: 'p3', code: 'GAM' })],
        });

        render(<BoardPage />);
        expect(await screen.findByText(/unsorted/i)).toBeInTheDocument();
        expect(screen.getByText('Orphan card')).toBeInTheDocument();
    });

    it('removes a card from the board without touching the task', async () => {
        (api.removeBoardTask as jest.Mock).mockResolvedValue({});
        render(<BoardPage />);
        await screen.findByText('Fix login');

        await userEvent.click(screen.getAllByRole('button', { name: /remove from board/i })[0]);

        await waitFor(() => expect(api.removeBoardTask).toHaveBeenCalledWith('b1', 'k1'));
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/frontend && npx jest "src/app/(app)/projects/boards/\[id\]/page.test.tsx"`
Expected: FAIL — cannot resolve `./page`.

- [ ] **Step 3: Copy the old page and adapt it**

```bash
mkdir -p "apps/frontend/src/app/(app)/projects/boards/[id]"
cp "apps/frontend/src/app/(app)/projects/[id]/board/page.tsx" \
   "apps/frontend/src/app/(app)/projects/boards/[id]/page.tsx"
```

Then edit the copy:

1. **Data source.** Replace the `api.getProjectBoard(projectId, sprintId)` call with `api.getBoard(boardId)` where `boardId` is `useParams().id`. Keep `columns` in state as before, and add `unsorted` state from the same response.
2. **Unsorted column.** Render it first, only when `unsorted.length > 0`, using the same column markup with:
   - heading `t('boards.unsorted')` and a `text-xs text-gray-500` line reading `t('boards.unsortedHint')`
   - `amber` border/heading (warning, not danger — the cards are fine, the mapping is not)
   - **no `COLUMN_ATTR`**, so `resolveDropTarget` never returns it and a card cannot be dropped back into Unsorted
   - cards inside it carry `CARD_ATTR` as normal, so they can be dragged *out*
3. **Move.** Replace the `api.moveProjectTask(taskId, { statusId, sortOrder })` call with `api.moveBoardCard(boardId, taskId, { columnId, sortOrder })` — `resolveDropTarget` already returns `columnId`, which is now a board column id rather than a status id, so the value passes straight through.
4. **Rejected drop.** Wrap the move in try/catch. On failure, reload the board with `api.getBoard(boardId)` so the optimistic move is undone, and `toast.error(t('boards.unmappedDrop'))`.
5. **Header.** `PageHeader` title is the board name from the response; `actions` holds a Button opening `AddBoardTasksModal` (`t('boards.addTasks')`) and a Link to `routes.projects.boardColumns(boardId)` (`t('boards.boardSettings')`). Breadcrumbs via `modulePageBreadcrumbs` for the projects module — **not** `projectChildBreadcrumbs`, which needs a project.
6. **Remove card.** Add a per-card action with accessible name `t('boards.removeCard')` calling `api.removeBoardTask(boardId, task.id)` then reloading. Use an icon button with `aria-label`; keep it ≥44px.
7. **Project chip.** Confirm the card already renders `projectLabelOf(task.project)` — the imported helper exists for this. If the copied markup gates it behind a condition that was false on a single-project board, remove the gate so it always shows.
8. **Delete the removed pieces** listed in the task preamble: `Mode`, the sprint selector, `BurndownChart`, `BurndownPoint`, `projectChildBreadcrumbs`, and the `ProjectSummary`/`Sprint` interfaces if nothing else uses them.

- [ ] **Step 4: Run to verify the board page tests pass**

Run: `cd apps/frontend && npx jest "src/app/(app)/projects/boards/\[id\]/page.test.tsx"`
Expected: PASS — 5 tests.

The spec also asks for a test that dragging calls the move endpoint and that a rejected drop restores the card. Do **not** try to write those here: `resolveDropTarget` calls `document.elementFromPoint` and reads `getBoundingClientRect`, and jsdom has no layout, so every rectangle is zero and the drop target is always null. That is precisely why the geometry lives in `board-drag.ts` — `board-drag.test.ts` already exercises it against hand-supplied rectangles, and it is reused here unchanged. The drag path is verified in a real browser in Task 12 Step 2 instead.

- [ ] **Step 5: Delete the old route and its link**

```bash
rm -rf "apps/frontend/src/app/(app)/projects/[id]/board"
```

In `apps/frontend/src/app/(app)/projects/[id]/page.tsx`, remove the link whose href is `routes.projects.board(...)`. Leave the `routes.projects.columns(...)` link alone.

- [ ] **Step 6: Verify nothing still references the deleted route**

Run:
```bash
grep -rn "projects.board\b\|/board'" apps/frontend/src | grep -v "boards"
```
Expected: no output. Any hit is a dangling reference — fix it before continuing.

- [ ] **Step 7: Typecheck and run the frontend suite**

Run:
```bash
cd apps/frontend && npx tsc --noEmit && npx jest src/
```
Expected: no compile output; all tests pass.

- [ ] **Step 8: Commit**

```bash
git add -A "apps/frontend/src/app/(app)/projects"
git commit -m "feat(boards): board page, and delete the per-project board route"
```

---

### Task 11: Board settings — columns and bindings

**Files:**
- Create: `apps/frontend/src/app/(app)/projects/boards/[id]/columns/page.tsx`

**Interfaces:**
- Consumes: `api.getBoardColumns`, `api.createBoardColumn`, `api.updateBoardColumn`, `api.deleteBoardColumn`, `api.setBoardColumnStatuses` (Task 8); `api.getProjectTaskStatuses` or the equivalent existing client method used by `/projects/[id]/columns` — check that page for the exact name before writing.
- Produces: the route `/projects/boards/[id]/columns`.

Copy `apps/frontend/src/app/(app)/projects/[id]/columns/page.tsx` as the starting shape — it already has the column list, add/edit/delete rows and WIP-limit input in the house style. The new part is the bindings panel.

- [ ] **Step 1: Build the page**

Create `apps/frontend/src/app/(app)/projects/boards/[id]/columns/page.tsx`. Requirements:

- `'use client'`, default export, `boardId` from `useParams().id`.
- `PageShell` + `PageHeader` titled `t('boards.columns')`, breadcrumbs including a link back to `routes.projects.boardDetail(boardId)`.
- Loads `api.getBoardColumns(boardId)`. Each response row carries `bindings: { id, status_id, status: { id, name, project_id } }[]`.
- **Column rows**: name (`Input`), category (`Select` over `TODO` / `IN_PROGRESS` / `DONE`), WIP limit (numeric `Input`, blank = no limit), Save and Delete. Save calls `api.updateBoardColumn`; Delete uses `ConfirmDialog` then `api.deleteBoardColumn`.
- **Add column**: an inline row with name + category calling `api.createBoardColumn`.
- **Bindings panel**, per column: the mapped statuses grouped by project, each shown as `<project short_name ?? code> · <status name>`. When a column has none, show `t('boards.noMappings')` in `text-xs text-gray-500`.
- **Editing a binding**: a `Select` per project listing that project's statuses plus a `—` option, so a user can point the column at a different status of that project or unmap it. Build the full `statusIds` array for the column from the current state and submit it in one `api.setBoardColumnStatuses(boardId, columnId, statusIds)` call — the endpoint replaces wholesale.
- The set of projects offered comes from the statuses already bound anywhere on this board, deduplicated by `project_id`. A project with no card on the board has nothing to configure.
- After any successful write, reload the columns. Toasts via `@/lib/toast`; field errors inline.
- House style throughout: `blue-600` only, `space-y-4`, `p-3 md:p-4`, ≥44px targets.

- [ ] **Step 2: Verify it compiles and renders in a build**

Run:
```bash
cd apps/frontend && npx tsc --noEmit && npx next build --no-lint 2>&1 | tail -20
```
Expected: no type errors; the build lists `/projects/boards/[id]/columns` among the routes.

- [ ] **Step 3: Commit**

```bash
git add "apps/frontend/src/app/(app)/projects/boards/[id]/columns"
git commit -m "feat(boards): board settings page for columns and status bindings"
```

---

### Task 12: Full verification, nav sync and TODO

**Files:**
- Modify: `TODO.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Run every check**

Run each and record the actual output — do not claim success without it:

```bash
cd apps/backend && npx tsc --noEmit -p tsconfig.json && npx jest
cd ../frontend && npx tsc --noEmit && npx jest && npx next lint
cd ../../packages/database && npx prisma validate
```

Expected: all pass. Fix anything that does not before continuing.

- [ ] **Step 2: Check the board renders in a real browser**

Start the app (`npm run dev` from the repo root) and use the `browser-automation` skill to load `/projects/boards`, then a board detail page. Confirm: no console errors, no failed requests, no horizontal body scroll at 360px width. jsdom cannot check the last two.

- [ ] **Step 3: Note the nav sync requirement for deploy**

`NavigationService.resolveTenantSidebarLayout` returns a saved layout **verbatim** — it never merges `NAV_REGISTRY`. Any tenant or platform layout saved through the nav admin will not show Boards until this is run against that environment:

```bash
cd packages/database && npx tsx prisma/sync-nav-layout.ts --nodes=projects.boards --dry-run
cd packages/database && npx tsx prisma/sync-nav-layout.ts --nodes=projects.boards
```

Run the dry run locally and paste its output into the commit message for step 5. Do **not** run it against production — that is part of the deploy, and deploying is the user's call.

- [ ] **Step 4: Update TODO.md**

Per `CLAUDE.md`: add the completed entry to the `## COMPLETED` section:

```markdown
- [x] Cross-project Boards — Boards is its own submenu under Project Management; a Board owns columns that bind to per-project `ProjectTaskStatus` rows, so one board holds hand-picked tasks from any number of projects. Per-project board route removed. Spec: `docs/superpowers/specs/2026-08-09-cross-project-boards-design.md` — done 2026-08-09
```

Also add, under the appropriate priority section, any follow-up the implementation revealed. Two are already known:

```markdown
- [ ] **Run `npx tsx prisma/sync-nav-layout.ts --nodes=projects.boards` on production** after the Boards deploy. `NavigationService` returns saved layouts verbatim, so any environment with a saved nav layout will not show the Boards item until this runs.
- [ ] **Boards have no ordering control.** The list is `created_at desc` and columns are reorderable only by editing `sort_order` one row at a time. Drag-reorder for both is the obvious next step.
```

- [ ] **Step 5: Commit**

```bash
git add TODO.md
git commit -m "docs: record cross-project Boards in TODO"
```

---

## Notes for the implementer

**`skipDuplicates` and Prisma.** `createMany({ skipDuplicates: true })` is not supported on all providers. It works on PostgreSQL, which is what this project uses. If a test mock asserts the argument, keep it in the assertion.

**The two `BoardTask` types.** `apps/frontend/src/components/projects/board-tasks.ts` exports a TypeScript type called `BoardTask` describing a *card as rendered*. The new Prisma model called `BoardTask` is a *membership row*. They never meet — one is frontend, one is backend — but do not "unify" them.

**Why moves go through `ProjectTasksService.move`.** That method renumbers siblings in the target column, sets and clears `completed_at` across a `DONE` boundary, writes a `ProjectTaskActivity` row, notifies watchers, and burns remaining hours. Writing `status_id` directly from `BoardsService` would silently skip all of it.

**`ProjectTasksService.move` reorders within the task's project**, not within the board column. `BoardTask.sort_order` is what orders cards on the board, and `moveCard` writes both. A card's position on a board and its position on its project's own task list are separate facts.
