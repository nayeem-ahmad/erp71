import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { GUARDS_METADATA, INTERCEPTORS_METADATA } from '@nestjs/common/constants';
import request from 'supertest';
import { StorePermission, TENANT_ROLE_TEMPLATE_BY_KEY } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { STORE_PERMISSIONS_KEY } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { CommonModule } from '../common/common.module';
import { DatabaseService } from '../database/database.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AssetsService } from '../assets/assets.service';
import { BoardsController } from './boards.controller';
import { BoardsService } from './boards.service';
import { ProjectsModule } from './projects.module';
import { ProjectsService } from './projects.service';

/**
 * Two invariants this suite protects that nothing else in the project would
 * catch if they broke:
 *
 * 1. Registration order. `BoardsController` is `@Controller('projects/boards')`
 *    and `ProjectsController` is `@Controller('projects')` with a `@Get(':id')`
 *    route. Nest maps routes in the order controllers appear in a module's
 *    `controllers` array, so `BoardsController` must be listed *before*
 *    `ProjectsController` in `ProjectsModule` — otherwise `GET /projects/boards`
 *    resolves as "fetch the project with id 'boards'". `tsc` and every other
 *    spec in this project are blind to that: the code compiles and the
 *    service-level tests pass either way. Only booting the module and firing a
 *    real request proves it, so that's what the first `describe` block below
 *    does.
 *
 * 2. Permission-to-route mapping. Every handler here carries a
 *    `@RequireStorePermission(...)` decorator, and which permission it carries
 *    *is* the access control for this feature — see the class-level comment on
 *    `BoardsController`. Weakening `MANAGE_PROJECT_SETTINGS` to `VIEW_PROJECTS`
 *    on a column-mutation route, or adding a new route with no decorator at
 *    all, would pass `tsc` and the rest of the suite undetected. The second
 *    `describe` block reads the metadata straight off the controller with
 *    `Reflect.getMetadata` — the same mechanism Nest itself uses at request
 *    time — and asserts the full 16-route table exhaustively, so an
 *    undecorated or re-permissioned route fails loudly here instead of
 *    shipping.
 */

function guardsOn(target: any, method?: string): any[] {
    const source = method ? target.prototype[method] : target;
    return Reflect.getMetadata(GUARDS_METADATA, source) ?? [];
}

function interceptorsOn(target: any, method?: string): any[] {
    const source = method ? target.prototype[method] : target;
    return Reflect.getMetadata(INTERCEPTORS_METADATA, source) ?? [];
}

function permissionsOn(target: any, method: string): any[] {
    return Reflect.getMetadata(STORE_PERMISSIONS_KEY, target.prototype[method]) ?? [];
}

describe('route registration order (regression guard for /projects/boards)', () => {
    let app: INestApplication;
    let boardsListSpy: jest.SpyInstance;
    let projectsFindOneSpy: jest.SpyInstance;

    beforeAll(async () => {
        // Boots the real ProjectsModule — not a hand-rolled stand-in — so this
        // fails the moment someone reorders its `controllers` array. Guards are
        // stubbed to allow-all and leaf infrastructure (DB, notifications,
        // assets, the cron scheduler) is stubbed out; only the routing behavior
        // of BoardsController and ProjectsController is under test here.
        const moduleRef = await Test.createTestingModule({
            imports: [CommonModule, ProjectsModule],
        })
            .overrideProvider(DatabaseService)
            .useValue({ onModuleInit: async () => {}, onModuleDestroy: async () => {} })
            .overrideProvider(NotificationsService)
            .useValue({})
            .overrideProvider(AssetsService)
            .useValue({})
            .overrideGuard(JwtAuthGuard)
            .useValue({ canActivate: () => true })
            .overrideGuard(StorePermissionGuard)
            .useValue({ canActivate: () => true })
            .compile();

        app = moduleRef.createNestApplication();

        const boardsService = moduleRef.get(BoardsService, { strict: false });
        const projectsService = moduleRef.get(ProjectsService, { strict: false });
        boardsListSpy = jest.spyOn(boardsService, 'list').mockResolvedValue([] as any);
        projectsFindOneSpy = jest.spyOn(projectsService, 'findOne').mockResolvedValue({} as any);

        await app.init();
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(() => {
        boardsListSpy.mockClear();
        projectsFindOneSpy.mockClear();
    });

    it('GET /projects/boards reaches BoardsController.list, not ProjectsController.findOne', async () => {
        await request(app.getHttpServer()).get('/projects/boards');

        expect(boardsListSpy).toHaveBeenCalled();
        expect(projectsFindOneSpy).not.toHaveBeenCalled();
    });

    it('GET /projects/<id> still reaches ProjectsController.findOne (boards did not swallow real project lookups)', async () => {
        await request(app.getHttpServer()).get('/projects/9d1f6d0e-3c1a-4c9e-9e0a-2f6a9c9a0e10');

        // Guards are stubbed to allow-all for this test, so no JWT is ever
        // decoded and `tenant.tenantId` resolves to `undefined` — that's fine,
        // the only thing under test is which controller/handler the router
        // dispatched to, identified here by the id it forwarded.
        expect(projectsFindOneSpy.mock.calls[0]?.[1]).toBe('9d1f6d0e-3c1a-4c9e-9e0a-2f6a9c9a0e10');
        expect(boardsListSpy).not.toHaveBeenCalled();
    });
});

describe('BoardsController permission-to-route mapping (access control surface)', () => {
    const EXPECTED_PERMISSIONS: Record<string, StorePermission[]> = {
        list: [StorePermission.VIEW_PROJECTS],
        findOne: [StorePermission.VIEW_PROJECTS],
        // Reads the same board findOne does, by slug rather than id.
        resolveBoard: [StorePermission.VIEW_PROJECTS],
        listColumns: [StorePermission.VIEW_PROJECTS],

        // The board itself: shared furniture, so the project-management
        // permission.
        create: [StorePermission.MANAGE_PROJECTS],
        update: [StorePermission.MANAGE_PROJECTS],
        remove: [StorePermission.MANAGE_PROJECTS],

        // The cards on it are task work: a Project User (MANAGE_PROJECT_TASKS,
        // no MANAGE_PROJECTS) must be able to work a board without being made
        // a project manager. Putting MANAGE_PROJECTS back on any of these locks
        // them out of their own board again.
        addTasks: [StorePermission.MANAGE_PROJECT_TASKS],
        removeTask: [StorePermission.MANAGE_PROJECT_TASKS],
        moveCard: [StorePermission.MANAGE_PROJECT_TASKS],

        // Doing a thing to many cards is the same permission as doing it to
        // one; ordering a column's cards is moving cards, not changing the
        // column's shape, so none of these three take the settings permission.
        moveCards: [StorePermission.MANAGE_PROJECT_TASKS],
        removeCards: [StorePermission.MANAGE_PROJECT_TASKS],
        orderColumnCards: [StorePermission.MANAGE_PROJECT_TASKS],

        // The board's background, not the reader's: everyone who opens the
        // board sees it, so setting it takes the same permission as renaming
        // the board rather than the none that a view preference takes.
        setBackgroundImage: [StorePermission.MANAGE_PROJECTS],
        clearBackground: [StorePermission.MANAGE_PROJECTS],

        // Creates a task, so the task-creation permission — never less, or this
        // route becomes a way to create tasks without it.
        createCard: [StorePermission.MANAGE_PROJECT_TASKS],

        createColumn: [StorePermission.MANAGE_PROJECT_SETTINGS],
        updateColumn: [StorePermission.MANAGE_PROJECT_SETTINGS],
        deleteColumn: [StorePermission.MANAGE_PROJECT_SETTINGS],
        setColumnStatuses: [StorePermission.MANAGE_PROJECT_SETTINGS],
        reorderColumns: [StorePermission.MANAGE_PROJECT_SETTINGS],
    };

    it('declares a permission for every handler on the controller — nothing unguarded', () => {
        const handlerNames = Object.getOwnPropertyNames(BoardsController.prototype).filter(
            (name) => name !== 'constructor',
        );

        // If this fails because you added a route, add it to EXPECTED_PERMISSIONS
        // below with the correct permission before making it pass — that's the
        // point of the test, not an obstacle to silence.
        expect(handlerNames.sort()).toEqual(Object.keys(EXPECTED_PERMISSIONS).sort());
    });

    it.each(Object.entries(EXPECTED_PERMISSIONS))('%s requires %s', (method, expected) => {
        expect(permissionsOn(BoardsController, method)).toEqual(expected);
    });

    it('is guarded at class level by JwtAuthGuard + StorePermissionGuard, scoped by TenantInterceptor', () => {
        expect(guardsOn(BoardsController)).toEqual(
            expect.arrayContaining([JwtAuthGuard, StorePermissionGuard]),
        );
        expect(interceptorsOn(BoardsController)).toEqual(
            expect.arrayContaining([TenantInterceptor]),
        );
    });
});

describe('BoardsController and the built-in Projects roles', () => {
    const CARD_ROUTES = [
        'createCard',
        'addTasks',
        'moveCard',
        'moveCards',
        'orderColumnCards',
        'removeTask',
        'removeCards',
    ];
    const BOARD_ROUTES = ['create', 'update', 'remove', 'setBackgroundImage', 'clearBackground'];

    const projectUser = new Set<string>(TENANT_ROLE_TEMPLATE_BY_KEY['project_user'].permissions);
    const holds = (method: string) =>
        permissionsOn(BoardsController, method).every((p) => projectUser.has(p));

    // The reported bug: a Project User composing a card was refused for want of
    // MANAGE_PROJECTS. Checked against the role itself, not a copy of its
    // permissions, so narrowing the role breaks this as surely as widening a
    // route does.
    it.each(CARD_ROUTES)('a Project User may %s', (method) => {
        expect(holds(method)).toBe(true);
    });

    it.each(BOARD_ROUTES)('a Project User may not %s the board itself', (method) => {
        expect(holds(method)).toBe(false);
    });
});
