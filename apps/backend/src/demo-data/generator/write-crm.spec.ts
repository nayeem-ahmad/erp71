import { CrmWriter } from './write-crm';
import { emptyCounts } from './counts';

type LeadStatusCode = 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'CONVERTED' | 'LOST';

function stubRng(status: LeadStatusCode) {
    return {
        weighted<T>(items: readonly T[]): T {
            if (items.length === 5 && (items as readonly string[])[0] === 'NEW') {
                return status as T;
            }
            return items[0];
        },
        chance: () => false,
        int: (min: number) => min,
        range: (min: number) => min,
        pick: <T>(items: readonly T[]) => items[0],
        noise: () => 1,
    };
}

function worldFor(status: LeadStatusCode) {
    return {
        tenantId: 't-1',
        userId: 'u-1',
        batchNumber: 1,
        rng: stubRng(status),
        customers: [],
        counts: emptyCounts(),
        mainStore: { storeId: 'store-1', warehouseId: 'wh-1', isMain: true },
        clampToWindow: (date: Date) => date,
        start: new Date('2026-01-01T00:00:00Z'),
        end: new Date('2026-06-30T00:00:00Z'),
    };
}

function primedWriter(world: ReturnType<typeof worldFor>) {
    const writer = new CrmWriter(world as never);
    Object.assign(writer, {
        leadStatusIds: new Map([
            ['NEW', 'st-new'],
            ['CONTACTED', 'st-con'],
            ['QUALIFIED', 'st-qual'],
            ['CONVERTED', 'st-conv'],
            ['LOST', 'st-lost'],
        ]),
        leadSourceIds: new Map([['WALK_IN', 'src-1']]),
        leadCategoryIds: new Map([['RETAIL', 'cat-1']]),
        channelIds: new Map([['CALL', 'ch-1']]),
    });
    return writer;
}

function txStub(closedAt: Date | null = null) {
    const events: Array<{ data: Record<string, unknown> }> = [];
    return {
        events,
        tx: {
            lead: {
                create: jest.fn(async () => ({ id: 'lead-1', closed_at: closedAt })),
            },
            leadStatusEvent: {
                create: jest.fn(async (args: { data: Record<string, unknown> }) => {
                    events.push(args);
                    return { id: `evt-${events.length}` };
                }),
            },
            leadConversation: {
                create: jest.fn(async () => ({ id: 'conv-1' })),
            },
        },
    };
}

describe('CrmWriter.writeLead status events', () => {
    const createdAt = new Date('2026-03-01T10:00:00Z');

    it('open lead: one create landing at created_at to its status', async () => {
        const world = worldFor('CONTACTED');
        const { tx, events } = txStub();

        await primedWriter(world).writeLead(tx as never, createdAt, 0, 1);

        expect(events).toHaveLength(1);
        expect(events[0].data).toEqual(expect.objectContaining({
            tenant_id: 't-1',
            lead_id: 'lead-1',
            from_status_id: null,
            from_lifecycle: null,
            to_status_id: 'st-con',
            to_lifecycle: 'CONTACTED',
            created_by: 'u-1',
            created_at: createdAt,
        }));
    });

    it('closed lead: NEW at created_at, terminal stage at closed_at', async () => {
        const world = worldFor('CONVERTED');
        const closedAt = new Date(createdAt.getTime() + 86400000);
        const { tx, events } = txStub(closedAt);

        await primedWriter(world).writeLead(tx as never, createdAt, 0, 1);

        expect(events).toHaveLength(2);
        expect(events[0].data).toEqual(expect.objectContaining({
            from_status_id: null,
            from_lifecycle: null,
            to_status_id: 'st-new',
            to_lifecycle: 'NEW',
            created_by: 'u-1',
            created_at: createdAt,
        }));
        expect(events[1].data).toEqual(expect.objectContaining({
            from_status_id: 'st-new',
            from_lifecycle: 'NEW',
            to_status_id: 'st-conv',
            to_lifecycle: 'CONVERTED',
            created_by: 'u-1',
            created_at: closedAt,
        }));
    });
});
