import { BadRequestException } from '@nestjs/common';
import { PERSON_SECTIONS } from '@erp71/shared-types';
import { PreferencesController } from './preferences.controller';
import { PreferencesService } from './preferences.service';

describe('PreferencesController', () => {
    const tenant = { tenantId: 't1', userId: 'u1' } as never;
    let service: jest.Mocked<Pick<PreferencesService, 'resolveFor' | 'saveSection' | 'resetSection'>>;
    let controller: PreferencesController;

    beforeEach(() => {
        service = {
            resolveFor: jest.fn(),
            saveSection: jest.fn(),
            resetSection: jest.fn(),
        };
        controller = new PreferencesController(service as unknown as PreferencesService);
    });

    it('GET passes tenant.tenantId and tenant.userId', async () => {
        const response = { sections: {} } as never;
        service.resolveFor.mockResolvedValue(response);
        await expect(controller.get(tenant)).resolves.toBe(response);
        expect(service.resolveFor).toHaveBeenCalledWith('t1', 'u1');
    });

    it('PATCH hands the body to the service intact', async () => {
        const body = { hidden: ['a'], anything: { nested: true } };
        const resolved = { value: {}, source: 'member' } as never;
        service.saveSection.mockResolvedValue(resolved);
        await expect(controller.save(tenant, 'tableView', body)).resolves.toBe(resolved);
        expect(service.saveSection).toHaveBeenCalledWith('t1', 'u1', 'tableView', body);
    });

    it.each(['device', 'nope', '__proto__', ''])('PATCH rejects section %p with 400', async (section) => {
        await expect(controller.save(tenant, section, {})).rejects.toBeInstanceOf(BadRequestException);
        expect(service.saveSection).not.toHaveBeenCalled();
    });

    it.each([...PERSON_SECTIONS])('PATCH accepts %s', async (section) => {
        service.saveSection.mockResolvedValue({} as never);
        await controller.save(tenant, section, {});
        expect(service.saveSection).toHaveBeenCalledWith('t1', 'u1', section, {});
    });

    it('DELETE calls resetSection', async () => {
        const resolved = { value: {}, source: 'built-in' } as never;
        service.resetSection.mockResolvedValue(resolved);
        await expect(controller.reset(tenant, 'sidebar')).resolves.toBe(resolved);
        expect(service.resetSection).toHaveBeenCalledWith('t1', 'u1', 'sidebar');
    });

    it('DELETE rejects a section outside PERSON_SECTIONS with 400', async () => {
        await expect(controller.reset(tenant, 'device')).rejects.toBeInstanceOf(BadRequestException);
        expect(service.resetSection).not.toHaveBeenCalled();
    });
});
