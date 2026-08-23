import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { GUARDS_METADATA, INTERCEPTORS_METADATA } from '@nestjs/common/constants';
import request from 'supertest';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { STORE_PERMISSIONS_KEY } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { CommonModule } from '../common/common.module';
import { DatabaseService } from '../database/database.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AssetsService } from '../assets/assets.service';
import { ProjectTimeController } from './project-time.controller';
import { ProjectTimeService } from './project-time.service';
import { ProjectTimerService } from './project-timer.service';
import { ProjectsModule } from './projects.module';
import { ProjectsScheduler } from './projects.scheduler';

/**
 * Two things here that nothing else in the project would catch.
 *
 * **Route order.** `/project-time/timer` and `/project-time/tags` are literal
 * segments on a controller that also has `@Patch(':id')` and `@Delete(':id')`.
 * Nest matches in declaration order, so moving the timer handlers below the
 * parameterised ones silently turns `DELETE /project-time/timer` into "delete
 * the entry whose id is the string `timer`" — which, with a tenant filter in
 * front of it, fails as a 404 rather than as anything that looks like a routing
 * bug. `tsc` and every service spec pass either way; only firing a real request
 * through a booted module proves it.
 *
 * **Which permission each route carries.** `LOG_PROJECT_TIME` on the timer
 * mutations and `VIEW_PROJECTS` on the reads *is* the access control for this
 * feature. A new route added with no decorator would pass the whole rest of the
 * suite unnoticed, so the table below is asserted exhaustively.
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

describe('/project-time route order (regression guard for the literal segments)', () => {
    let app: INestApplication;
    let timers: ProjectTimerService;
    let entries: ProjectTimeService;

    beforeAll(async () => {
        const moduleRef = await Test.createTestingModule({
            imports: [CommonModule, ProjectsModule],
        })
            .overrideProvider(DatabaseService)
            .useValue({ onModuleInit: async () => {}, onModuleDestroy: async () => {} })
            .overrideProvider(NotificationsService)
            .useValue({})
            .overrideProvider(AssetsService)
            .useValue({})
            .overrideProvider(ProjectsScheduler)
            .useValue({})
            .overrideGuard(JwtAuthGuard)
            .useValue({ canActivate: () => true })
            .overrideGuard(StorePermissionGuard)
            .useValue({ canActivate: () => true })
            .compile();

        app = moduleRef.createNestApplication();

        timers = moduleRef.get(ProjectTimerService, { strict: false });
        entries = moduleRef.get(ProjectTimeService, { strict: false });
        jest.spyOn(timers, 'current').mockResolvedValue(null as never);
        jest.spyOn(timers, 'start').mockResolvedValue({} as never);
        jest.spyOn(timers, 'stop').mockResolvedValue({} as never);
        jest.spyOn(timers, 'update').mockResolvedValue({} as never);
        jest.spyOn(timers, 'discard').mockResolvedValue({ success: true } as never);
        jest.spyOn(entries, 'update').mockResolvedValue({} as never);
        jest.spyOn(entries, 'remove').mockResolvedValue({ success: true } as never);

        await app.init();
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(() => jest.clearAllMocks());

    it('GET /project-time/timer reads the running clock, not an entry called "timer"', async () => {
        await request(app.getHttpServer()).get('/project-time/timer');
        expect(timers.current).toHaveBeenCalled();
    });

    it('DELETE /project-time/timer discards the clock rather than deleting an entry', async () => {
        await request(app.getHttpServer()).delete('/project-time/timer');

        expect(timers.discard).toHaveBeenCalled();
        expect(entries.remove).not.toHaveBeenCalled();
    });

    it('PATCH /project-time/timer edits the clock rather than an entry', async () => {
        await request(app.getHttpServer()).patch('/project-time/timer').send({ note: 'x' });

        expect(timers.update).toHaveBeenCalled();
        expect(entries.update).not.toHaveBeenCalled();
    });

    it('POST /project-time/timer/stop is not read as starting a timer on a task called "stop"', async () => {
        await request(app.getHttpServer()).post('/project-time/timer/stop').send({});

        expect(timers.stop).toHaveBeenCalled();
        expect(timers.start).not.toHaveBeenCalled();
    });

    it('DELETE /project-time/<id> still reaches the entry handler', async () => {
        const id = '9d1f6d0e-3c1a-4c9e-9e0a-2f6a9c9a0e10';
        await request(app.getHttpServer()).delete(`/project-time/${id}`);

        expect((entries.remove as jest.Mock).mock.calls[0]?.[1]).toBe(id);
        expect(timers.discard).not.toHaveBeenCalled();
    });
});

describe('ProjectTimeController permission-to-route mapping', () => {
    const EXPECTED_PERMISSIONS: Record<string, StorePermission[]> = {
        list: [StorePermission.VIEW_PROJECTS],
        report: [StorePermission.VIEW_PROJECTS],
        people: [StorePermission.VIEW_PROJECTS],
        tags: [StorePermission.VIEW_PROJECTS],

        create: [StorePermission.LOG_PROJECT_TIME],
        update: [StorePermission.LOG_PROJECT_TIME],
        remove: [StorePermission.LOG_PROJECT_TIME],

        // The clock writes hour logs, so it needs the same permission writing
        // one by hand does — never merely the permission to read them.
        currentTimer: [StorePermission.LOG_PROJECT_TIME],
        startTimer: [StorePermission.LOG_PROJECT_TIME],
        updateTimer: [StorePermission.LOG_PROJECT_TIME],
        stopTimer: [StorePermission.LOG_PROJECT_TIME],
        discardTimer: [StorePermission.LOG_PROJECT_TIME],
    };

    it('declares a permission for every handler — nothing unguarded', () => {
        const handlerNames = Object.getOwnPropertyNames(ProjectTimeController.prototype).filter(
            (name) => name !== 'constructor',
        );

        // Failing because you added a route? Add it to EXPECTED_PERMISSIONS with
        // the right permission. That is the test working, not an obstacle.
        expect(handlerNames.sort()).toEqual(Object.keys(EXPECTED_PERMISSIONS).sort());
    });

    it.each(Object.entries(EXPECTED_PERMISSIONS))('%s requires %s', (method, expected) => {
        expect(permissionsOn(ProjectTimeController, method)).toEqual(expected);
    });

    it('is guarded at class level and scoped by TenantInterceptor', () => {
        expect(guardsOn(ProjectTimeController)).toEqual(
            expect.arrayContaining([JwtAuthGuard, StorePermissionGuard]),
        );
        expect(interceptorsOn(ProjectTimeController)).toEqual(
            expect.arrayContaining([TenantInterceptor]),
        );
    });
});
