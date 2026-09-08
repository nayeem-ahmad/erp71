import { CrmContactsController } from './crm-contacts.controller';
import { CrmContactsService } from './crm-contacts.service';
import { ListContactsDto } from './crm-contacts.dto';
import type { TenantContext } from '../database/tenant.decorator';

/**
 * The "only mine" scope resolves the caller's own id in the controller — the id
 * never crosses the wire — so what the service is handed is the whole contract
 * and is worth asserting on directly.
 *
 * Instantiated rather than bootstrapped: the controller is a thin mapping over
 * the service, and a full Nest module here would test the guards instead.
 */
describe('CrmContactsController — list scope wiring', () => {
    const service = { findAll: jest.fn().mockResolvedValue({ items: [], total: 0 }) };
    const controller = new CrmContactsController(service as unknown as CrmContactsService);

    const tenant: TenantContext = {
        tenantId: 'tenant-1',
        userId: 'user-1',
        timezone: 'Asia/Dhaka',
    };

    const listWith = (query: Partial<ListContactsDto>) =>
        controller.findAll(tenant, query as ListContactsDto);

    beforeEach(() => service.findAll.mockClear());

    it('resolves mine to the caller own id', async () => {
        await listWith({ mine: true });

        expect(service.findAll).toHaveBeenCalledWith(
            'tenant-1',
            expect.objectContaining({ assignedTo: 'user-1' }),
        );
    });

    it('lets the scope override a stale owner filter', async () => {
        // The scope outlives any one page, so a remembered owner filter must not
        // be able to widen it back out to somebody else's contacts.
        await listWith({ mine: true, assignedTo: 'user-9' });

        expect(service.findAll).toHaveBeenCalledWith(
            'tenant-1',
            expect.objectContaining({ assignedTo: 'user-1' }),
        );
    });

    it('leaves the owner filter alone when the scope is off', async () => {
        await listWith({ assignedTo: 'user-9' });

        expect(service.findAll).toHaveBeenCalledWith(
            'tenant-1',
            expect.objectContaining({ assignedTo: 'user-9' }),
        );
    });

    it('does not filter on owner at all when neither is given', async () => {
        await listWith({});

        expect(service.findAll.mock.calls[0][1].assignedTo).toBeUndefined();
    });
});
