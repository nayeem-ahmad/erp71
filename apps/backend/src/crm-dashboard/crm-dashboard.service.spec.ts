import { Test, TestingModule } from '@nestjs/testing';
import { CrmDashboardService } from './crm-dashboard.service';
import { DatabaseService } from '../database/database.service';
import { LeadStatus } from '../crm-leads/crm-leads.dto';

const TENANT = 'tenant-1';

describe('CrmDashboardService', () => {
    let service: CrmDashboardService;
    let db: any;

    beforeEach(async () => {
        db = {
            lead: {
                groupBy: jest.fn().mockResolvedValue([]),
                count: jest.fn().mockResolvedValue(0),
                findMany: jest.fn().mockResolvedValue([]),
            },
            // Repointed from crmFollowUp + leadConversation onto the merged table
            // in R2. Both dashboard blocks read CrmActivity now.
            crmActivity: {
                count: jest.fn().mockResolvedValue(0),
                groupBy: jest.fn().mockResolvedValue([]),
                findMany: jest.fn().mockResolvedValue([]),
            },
            leadSourceOption: { findMany: jest.fn().mockResolvedValue([]) },
            conversationChannel: { findMany: jest.fn().mockResolvedValue([]) },
            crmCampaign: {
                aggregate: jest.fn().mockResolvedValue({ _count: { _all: 0 }, _sum: {} }),
                findMany: jest.fn().mockResolvedValue([]),
            },
            user: { findMany: jest.fn().mockResolvedValue([]) },
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CrmDashboardService,
                { provide: DatabaseService, useValue: db },
            ],
        }).compile();

        service = module.get<CrmDashboardService>(CrmDashboardService);
    });

    describe('getOverview', () => {
        it('zero-fills every stage a tenant has no leads in', async () => {
            db.lead.groupBy.mockResolvedValue([{ status: LeadStatus.NEW, _count: { _all: 3 } }]);

            const result = await service.getOverview(TENANT, {});

            expect(result.pipeline.counts).toEqual({
                NEW: 3, CONTACTED: 0, QUALIFIED: 0, LOST: 0, CONVERTED: 0,
            });
            expect(result.pipeline.open).toBe(3);
        });

        it('rates conversion against closed deals only, not the open pipeline', async () => {
            // 3 won, 1 lost, whatever else is still open.
            db.lead.findMany.mockResolvedValue([
                { created_at: new Date('2026-07-01T00:00:00Z'), closed_at: new Date('2026-07-11T00:00:00Z') },
                { created_at: new Date('2026-07-01T00:00:00Z'), closed_at: new Date('2026-07-06T00:00:00Z') },
                { created_at: new Date('2026-07-01T00:00:00Z'), closed_at: new Date('2026-07-16T00:00:00Z') },
            ]);
            db.lead.count.mockResolvedValue(1);

            const result = await service.getOverview(TENANT, { from: '2026-07-01', to: '2026-07-31' });

            expect(result.pipeline.converted_in_period).toBe(3);
            expect(result.pipeline.conversion_rate_pct).toBe(75);
            expect(result.pipeline.avg_days_to_convert).toBe(10);
        });

        it('reports no conversion rate rather than a zero when nothing closed', async () => {
            db.lead.findMany.mockResolvedValue([]);
            db.lead.count.mockResolvedValue(0);

            const result = await service.getOverview(TENANT, {});

            expect(result.pipeline.conversion_rate_pct).toBeNull();
            expect(result.pipeline.avg_days_to_convert).toBeNull();
        });

        it('counts a never-worked lead as stale only once it has aged', async () => {
            await service.getOverview(TENANT, {});

            const staleCall = db.lead.count.mock.calls.find(
                ([args]: [any]) => Array.isArray(args?.where?.OR),
            );
            expect(staleCall).toBeDefined();
            const [untouched] = staleCall[0].where.OR.filter((c: any) => c.last_activity_at === null);
            expect(untouched.created_at.lt).toBeInstanceOf(Date);
        });

        // The fourth of the four bugs the design set out to fix: a lead's
        // next_step was a column nothing counted, so an overdue one was invisible
        // here. It is a PLANNED activity now, and this card reads those.
        it('counts planned activities, so materialised next steps reach the card', async () => {
            db.crmActivity.count.mockResolvedValue(3);

            const result = await service.getOverview(TENANT, {});

            const plannedCalls = db.crmActivity.count.mock.calls.filter(
                ([args]: [any]) => args?.where?.status === 'PLANNED',
            );
            // due today, overdue, total pending
            expect(plannedCalls).toHaveLength(3);
            expect(result.follow_ups.overdue).toBe(3);
        });

        // Both dashboard blocks read one table now, so they need filters that keep
        // them measuring different things rather than printing the same number
        // under two labels.
        it('separates planned work from logged touches by subject and channel', async () => {
            await service.getOverview(TENANT, {});

            const completed = db.crmActivity.count.mock.calls.find(
                ([args]: [any]) => args?.where?.status === 'DONE',
            );
            expect(completed[0].where.subject).toEqual({ not: null });

            const logged = db.crmActivity.groupBy.mock.calls.find(
                ([args]: [any]) => args?.by?.includes('channel_code'),
            );
            expect(logged[0].where.channel_id).toEqual({ not: null });
        });

        it('resolves conversation channel codes to the tenant-renamed labels', async () => {
            db.crmActivity.groupBy.mockResolvedValue([
                { channel_code: 'CALL', _count: { _all: 5 } },
                { channel_code: 'WHATSAPP', _count: { _all: 9 } },
            ]);
            db.conversationChannel.findMany.mockResolvedValue([{ code: 'CALL', name: 'Phone call' }]);

            const result = await service.getOverview(TENANT, {});

            // Ordered by volume, and an unmatched code falls back to itself rather
            // than disappearing from the panel.
            expect(result.activity.by_type).toEqual([
                { code: 'WHATSAPP', name: 'WHATSAPP', count: 9 },
                { code: 'CALL', name: 'Phone call', count: 5 },
            ]);
        });

        it('keeps a rep who closed a deal on the leaderboard with an empty pipeline', async () => {
            db.lead.groupBy.mockImplementation(({ by, where }: any) => {
                if (by?.[0] !== 'assigned_to') return Promise.resolve([]);
                return Promise.resolve(
                    where?.status === LeadStatus.CONVERTED
                        ? [{ assigned_to: 'user-2', _count: { _all: 4 } }]
                        : [{ assigned_to: 'user-1', _count: { _all: 7 } }],
                );
            });
            db.user.findMany.mockResolvedValue([
                { id: 'user-1', name: 'Rahim', email: 'rahim@example.com' },
                { id: 'user-2', name: '', email: 'karim@example.com' },
            ]);

            const result = await service.getOverview(TENANT, {});

            expect(result.owners).toEqual([
                { user_id: 'user-1', name: 'Rahim', open_leads: 7, converted_in_period: 0, overdue_follow_ups: 0 },
                // Falls back to the email when the user row has no name.
                { user_id: 'user-2', name: 'karim@example.com', open_leads: 0, converted_in_period: 4, overdue_follow_ups: 0 },
            ]);
        });

        it('labels leads with no source row rather than dropping them from the mix', async () => {
            db.lead.groupBy.mockImplementation(({ by, where }: any) => {
                if (by?.[0] !== 'source_id') return Promise.resolve([]);
                if (where?.status === LeadStatus.CONVERTED) {
                    return Promise.resolve([{ source_id: 'src-1', _count: { _all: 2 } }]);
                }
                return Promise.resolve([
                    { source_id: 'src-1', _count: { _all: 8 } },
                    { source_id: null, _count: { _all: 3 } },
                ]);
            });
            db.leadSourceOption.findMany.mockResolvedValue([{ id: 'src-1', name: 'Referral' }]);

            const result = await service.getOverview(TENANT, {});

            expect(result.sources).toEqual([
                { id: 'src-1', name: 'Referral', leads: 8, converted: 2, conversion_rate_pct: 25 },
                { id: null, name: '—', leads: 3, converted: 0, conversion_rate_pct: 0 },
            ]);
        });

        it('sums campaign attribution over the window and returns it as a number', async () => {
            db.crmCampaign.aggregate.mockResolvedValue({
                _count: { _all: 2 },
                // Prisma hands Decimal columns back as Decimal, not number.
                _sum: {
                    delivered_count: 180,
                    failed_count: 20,
                    attributed_revenue: { toString: () => '4500.5' },
                    attributed_orders: 7,
                },
            });

            const result = await service.getOverview(TENANT, {});

            expect(result.campaigns.sent_in_period).toBe(2);
            expect(result.campaigns.attributed_revenue).toBe(4500.5);
            expect(result.campaigns.attributed_orders).toBe(7);
        });

        it('defaults to the last 30 days and echoes the window back', async () => {
            const result = await service.getOverview(TENANT, {});

            const from = new Date(`${result.filters.from}T00:00:00`);
            const to = new Date(`${result.filters.to}T00:00:00`);
            const days = Math.round((to.getTime() - from.getTime()) / 86_400_000);
            expect(days).toBe(29);
        });
    });

    describe('getTrends', () => {
        it('emits a point for every day in the window, including empty ones', async () => {
            const result = await service.getTrends(TENANT, { from: '2026-07-01', to: '2026-07-05' });

            expect(result.points).toHaveLength(5);
            expect(result.points[0]).toEqual({
                date: '2026-07-01',
                leads_created: 0,
                conversations: 0,
                leads_converted: 0,
                follow_ups_completed: 0,
            });
        });

        it('buckets rows onto their local calendar day', async () => {
            db.lead.findMany.mockImplementation(({ where }: any) =>
                Promise.resolve(
                    where?.status === LeadStatus.CONVERTED
                        ? [{ closed_at: new Date(2026, 6, 3, 9, 0) }]
                        : [{ created_at: new Date(2026, 6, 2, 23, 30) }, { created_at: new Date(2026, 6, 2, 8, 0) }],
                ),
            );

            const result = await service.getTrends(TENANT, { from: '2026-07-01', to: '2026-07-05' });

            const byDate = Object.fromEntries(result.points.map((p) => [p.date, p]));
            // A 23:30 row belongs to that evening, not the next UTC day.
            expect(byDate['2026-07-02'].leads_created).toBe(2);
            expect(byDate['2026-07-03'].leads_converted).toBe(1);
        });

        it('ignores rows that fall outside the requested window', async () => {
            db.lead.findMany.mockResolvedValue([{ created_at: new Date(2026, 7, 20, 12, 0) }]);

            const result = await service.getTrends(TENANT, { from: '2026-07-01', to: '2026-07-05' });

            expect(result.points.every((point) => point.leads_created === 0)).toBe(true);
        });
    });
});
