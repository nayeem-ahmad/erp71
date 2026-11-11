import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { StorePermission } from '@erp71/shared-types';
import { STORE_PERMISSIONS_KEY } from '../auth/store-permission.decorator';
import { ProjectsController } from './projects.controller';

describe('ProjectsController GET staffing', () => {
    it('declares GET staffing as VIEW_PROJECTS before :id', () => {
        expect(Reflect.getMetadata(PATH_METADATA, ProjectsController.prototype.staffing)).toBe('staffing');
        expect(Reflect.getMetadata(STORE_PERMISSIONS_KEY, ProjectsController.prototype.staffing)).toEqual([
            StorePermission.VIEW_PROJECTS,
        ]);

        const routes = Object.getOwnPropertyNames(ProjectsController.prototype)
            .map((name) => (ProjectsController.prototype as any)[name])
            .filter((handler) => typeof handler === 'function' && Reflect.hasMetadata(METHOD_METADATA, handler))
            .map((handler) => ({
                method: Reflect.getMetadata(METHOD_METADATA, handler),
                path: Reflect.getMetadata(PATH_METADATA, handler) as string,
            }));

        const staffing = routes.findIndex(
            (route) => route.method === RequestMethod.GET && route.path === 'staffing',
        );
        const list = routes.findIndex(
            (route) => route.method === RequestMethod.GET && (route.path === '/' || route.path === ''),
        );
        const byId = routes.findIndex(
            (route) => route.method === RequestMethod.GET && route.path === ':id',
        );

        expect(staffing).toBeGreaterThanOrEqual(0);
        expect(staffing).toBeLessThan(list);
        expect(staffing).toBeLessThan(byId);
    });
});
