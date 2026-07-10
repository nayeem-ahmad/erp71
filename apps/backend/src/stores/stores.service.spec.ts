import { NotFoundException } from '@nestjs/common';
import { StoresService } from './stores.service';

describe('StoresService.rename', () => {
    const db = {
        store: {
            findFirst: jest.fn(),
            update: jest.fn(),
        },
    };
    let service: StoresService;

    beforeEach(() => {
        jest.clearAllMocks();
        service = new StoresService(db as any);
    });

    it('renames a store that belongs to the tenant', async () => {
        db.store.findFirst.mockResolvedValue({ id: 's1', tenant_id: 't1' });
        db.store.update.mockResolvedValue({ id: 's1', name: 'Gulshan Branch' });
        const result = await service.rename('t1', 's1', '  Gulshan Branch  ');
        expect(db.store.findFirst).toHaveBeenCalledWith({ where: { id: 's1', tenant_id: 't1' } });
        expect(db.store.update).toHaveBeenCalledWith({
            where: { id: 's1' },
            data: { name: 'Gulshan Branch' },
            select: { id: true, name: true },
        });
        expect(result).toEqual({ id: 's1', name: 'Gulshan Branch' });
    });

    it('rejects a store from another tenant', async () => {
        db.store.findFirst.mockResolvedValue(null);
        await expect(service.rename('t1', 'sX', 'Anything')).rejects.toBeInstanceOf(NotFoundException);
        expect(db.store.update).not.toHaveBeenCalled();
    });
});
