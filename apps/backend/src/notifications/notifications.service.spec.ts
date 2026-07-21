import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import { SmsService } from '../sms/sms.service';
import { JobTrackerService } from '../system-health/jobs/job-tracker.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let db: any;
  let email: any;
  let sms: any;

  beforeEach(async () => {
    jest.clearAllMocks();

    db = {
      notification: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
        count: jest.fn(),
      },
      tenant: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      tenantSubscription: {
        findMany: jest.fn(),
      },
      sale: {
        findMany: jest.fn(),
      },
      customer: {
        count: jest.fn(),
      },
      passwordResetToken: {
        deleteMany: jest.fn(),
      },
      emailVerificationToken: {
        deleteMany: jest.fn(),
      },
      auditLog: {
        deleteMany: jest.fn(),
      },
      aiConversation: {
        deleteMany: jest.fn(),
      },
      $queryRaw: jest.fn(),
      $transaction: jest.fn().mockImplementation(async (cb: any) => cb(db)),
    };

    email = {
      sendSubscriptionExpiryWarning: jest.fn(),
      sendLowStockAlert: jest.fn(),
      send: jest.fn(),
    };

    sms = {
      sendLowStockAlert: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: DatabaseService, useValue: db },
        { provide: EmailService, useValue: email },
        { provide: SmsService, useValue: sms },
        { provide: JobTrackerService, useValue: { track: (_n: string, fn: () => any) => fn(), purgeOlderThan: jest.fn().mockResolvedValue(0) } },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  /* ------------------------------------------------------------------ */
  /*  create                                                              */
  /* ------------------------------------------------------------------ */

  describe('create', () => {
    it('creates an in-app notification', async () => {
      const created = {
        id: 'n-1',
        tenant_id: 't-1',
        user_id: 'u-1',
        type: 'INFO',
        title: 'Hello',
        body: 'World',
        link: '/dashboard',
      };
      db.notification.create.mockResolvedValue(created);

      const result = await service.create('t-1', 'u-1', 'INFO', 'Hello', 'World', '/dashboard');

      expect(result).toEqual(created);
      expect(db.notification.create).toHaveBeenCalledWith({
        data: {
          tenant_id: 't-1',
          user_id: 'u-1',
          type: 'INFO',
          title: 'Hello',
          body: 'World',
          link: '/dashboard',
        },
      });
    });

    it('creates a notification without a link', async () => {
      db.notification.create.mockResolvedValue({ id: 'n-2' });

      await service.create('t-1', 'u-1', 'ALERT', 'Title', 'Body');

      expect(db.notification.create).toHaveBeenCalledWith({
        data: {
          tenant_id: 't-1',
          user_id: 'u-1',
          type: 'ALERT',
          title: 'Title',
          body: 'Body',
          link: undefined,
        },
      });
    });
  });

  /* ------------------------------------------------------------------ */
  /*  listForUser                                                         */
  /* ------------------------------------------------------------------ */

  describe('listForUser', () => {
    it('returns notifications for user ordered correctly', async () => {
      const notifications = [
        { id: 'n-1', title: 'First', read_at: null },
        { id: 'n-2', title: 'Second', read_at: new Date() },
      ];
      db.notification.findMany.mockResolvedValue(notifications);
      db.notification.count.mockResolvedValue(2);

      const result = await service.listForUser('t-1', 'u-1');

      expect(result.items).toEqual(notifications);
      expect(result.total).toBe(2);
      expect(db.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenant_id: 't-1', user_id: 'u-1' },
          orderBy: [{ read_at: 'asc' }, { created_at: 'desc' }],
        }),
      );
    });

    it('returns empty array when no notifications', async () => {
      db.notification.findMany.mockResolvedValue([]);
      db.notification.count.mockResolvedValue(0);

      const result = await service.listForUser('t-1', 'u-1');

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  getUnreadCount                                                      */
  /* ------------------------------------------------------------------ */

  describe('getUnreadCount', () => {
    it('returns the count of unread notifications', async () => {
      db.notification.count.mockResolvedValue(5);

      const result = await service.getUnreadCount('t-1', 'u-1');

      expect(result).toBe(5);
      expect(db.notification.count).toHaveBeenCalledWith({
        where: { tenant_id: 't-1', user_id: 'u-1', read_at: null },
      });
    });

    it('returns 0 when all notifications are read', async () => {
      db.notification.count.mockResolvedValue(0);

      const result = await service.getUnreadCount('t-1', 'u-1');

      expect(result).toBe(0);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  markRead                                                            */
  /* ------------------------------------------------------------------ */

  describe('markRead', () => {
    it('marks a notification as read', async () => {
      const notification = { id: 'n-1', read_at: null };
      const updated = { id: 'n-1', read_at: new Date() };
      db.notification.findFirst.mockResolvedValue(notification);
      db.notification.update.mockResolvedValue(updated);

      const result = await service.markRead('t-1', 'u-1', 'n-1');

      expect(result).toEqual(updated);
      expect(db.notification.findFirst).toHaveBeenCalledWith({
        where: { id: 'n-1', tenant_id: 't-1', user_id: 'u-1' },
      });
      expect(db.notification.update).toHaveBeenCalledWith({
        where: { id: 'n-1' },
        data: { read_at: expect.any(Date) },
      });
    });

    it('throws NotFoundException when notification not found', async () => {
      db.notification.findFirst.mockResolvedValue(null);

      const result = service.markRead('t-1', 'u-1', 'nonexistent');
      await expect(result).rejects.toThrow(NotFoundException);
      await expect(result).rejects.toThrow('Notification not found');
    });

    it('sets read_at to a Date instance', async () => {
      db.notification.findFirst.mockResolvedValue({ id: 'n-1' });
      db.notification.update.mockResolvedValue({ id: 'n-1', read_at: new Date() });

      await service.markRead('t-1', 'u-1', 'n-1');

      const callArg = db.notification.update.mock.calls[0][0];
      expect(callArg.data.read_at).toBeInstanceOf(Date);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  markAllRead                                                         */
  /* ------------------------------------------------------------------ */

  describe('markAllRead', () => {
    it('marks all unread notifications as read for user', async () => {
      db.notification.updateMany.mockResolvedValue({ count: 3 });

      await service.markAllRead('t-1', 'u-1');

      expect(db.notification.updateMany).toHaveBeenCalledWith({
        where: { tenant_id: 't-1', user_id: 'u-1', read_at: null },
        data: { read_at: expect.any(Date) },
      });
    });

    it('completes without error when there are no unread notifications', async () => {
      db.notification.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.markAllRead('t-1', 'u-1')).resolves.not.toThrow();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  sendSubscriptionExpiryWarnings (cron job)                          */
  /* ------------------------------------------------------------------ */

  describe('sendSubscriptionExpiryWarnings', () => {
    it('sends email and creates in-app notification for each expiring subscription', async () => {
      const owner = { id: 'u-owner', email: 'owner@test.com' };
      const sub = {
        tenant_id: 't-1',
        current_period_end: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000), // 1 day from now
        tenant: { id: 't-1', name: 'Test Store', owner },
      };
      db.tenantSubscription.findMany.mockResolvedValue([sub]);
      email.sendSubscriptionExpiryWarning.mockResolvedValue(undefined);
      db.notification.create.mockResolvedValue({ id: 'n-new' });

      await service.sendSubscriptionExpiryWarnings();

      expect(email.sendSubscriptionExpiryWarning).toHaveBeenCalledWith(
        'owner@test.com',
        'Test Store',
        expect.any(Number),
        sub.current_period_end,
      );
      expect(db.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenant_id: 't-1',
            user_id: 'u-owner',
            type: 'SUBSCRIPTION_EXPIRY',
          }),
        }),
      );
    });

    it('skips subscriptions where tenant has no owner', async () => {
      const sub = {
        tenant_id: 't-2',
        current_period_end: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000),
        tenant: { id: 't-2', name: 'No Owner Store', owner: null },
      };
      db.tenantSubscription.findMany.mockResolvedValue([sub]);

      await service.sendSubscriptionExpiryWarnings();

      expect(email.sendSubscriptionExpiryWarning).not.toHaveBeenCalled();
      expect(db.notification.create).not.toHaveBeenCalled();
    });

    it('continues processing other subscriptions when email fails', async () => {
      const owner = { id: 'u-1', email: 'a@test.com' };
      const sub = {
        tenant_id: 't-1',
        current_period_end: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000),
        tenant: { id: 't-1', name: 'Store', owner },
      };
      db.tenantSubscription.findMany.mockResolvedValue([sub]);
      email.sendSubscriptionExpiryWarning.mockRejectedValue(new Error('SMTP failure'));
      db.notification.create.mockResolvedValue({ id: 'n-1' });

      await expect(service.sendSubscriptionExpiryWarnings()).resolves.not.toThrow();
      // In-app notification should still be attempted
      expect(db.notification.create).toHaveBeenCalled();
    });

    it('handles empty subscription list gracefully', async () => {
      db.tenantSubscription.findMany.mockResolvedValue([]);

      await expect(service.sendSubscriptionExpiryWarnings()).resolves.not.toThrow();
      expect(email.sendSubscriptionExpiryWarning).not.toHaveBeenCalled();
    });

    it('uses correct singular form for 1 day remaining', async () => {
      const owner = { id: 'u-1', email: 'owner@test.com' };
      const sub = {
        tenant_id: 't-1',
        current_period_end: new Date(Date.now() + 23 * 60 * 60 * 1000), // less than 1 day
        tenant: { id: 't-1', name: 'Store', owner },
      };
      db.tenantSubscription.findMany.mockResolvedValue([sub]);
      email.sendSubscriptionExpiryWarning.mockResolvedValue(undefined);
      db.notification.create.mockResolvedValue({ id: 'n-1' });

      await service.sendSubscriptionExpiryWarnings();

      const callArg = db.notification.create.mock.calls[0][0];
      expect(callArg.data.title).toContain('day');
      expect(callArg.data.title).not.toContain('days');
    });
  });

  /* ------------------------------------------------------------------ */
  /*  sendLowStockAlerts (cron job)                                       */
  /* ------------------------------------------------------------------ */

  describe('sendLowStockAlerts', () => {
    beforeEach(() => {
      db.notification.findFirst.mockResolvedValue(null);
    });

    const makeRow = (overrides: any = {}) => ({
      tenant_id: 't-1',
      tenant_name: 'Test Store',
      owner_id: 'u-owner',
      owner_email: 'owner@test.com',
      sms_on_low_stock: false,
      product_name: 'Widget',
      sku: 'WGT-001',
      total_qty: BigInt(2),
      reorder_level: 5,
      ...overrides,
    });

    it('sends email alert and creates in-app notification per tenant', async () => {
      db.$queryRaw.mockResolvedValue([makeRow()]);
      email.sendLowStockAlert.mockResolvedValue(undefined);
      db.notification.create.mockResolvedValue({ id: 'n-1' });

      await service.sendLowStockAlerts();

      expect(email.sendLowStockAlert).toHaveBeenCalledWith(
        'owner@test.com',
        'Test Store',
        expect.arrayContaining([
          expect.objectContaining({ name: 'Widget', sku: 'WGT-001', quantity: 2, reorderPoint: 5 }),
        ]),
      );
      expect(db.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenant_id: 't-1',
            user_id: 'u-owner',
            type: 'LOW_STOCK',
          }),
        }),
      );
    });

    it('sends SMS when sms_on_low_stock is true and owner has a phone', async () => {
      db.$queryRaw.mockResolvedValue([makeRow({ sms_on_low_stock: true })]);
      email.sendLowStockAlert.mockResolvedValue(undefined);
      db.notification.create.mockResolvedValue({ id: 'n-1' });
      db.notification.findFirst.mockResolvedValue(null);
      db.tenant.findUnique.mockResolvedValue({ owner: { mobile: '+8801712345678' } });

      await service.sendLowStockAlerts();

      expect(sms.sendLowStockAlert).toHaveBeenCalledWith(
        '+8801712345678',
        'Widget',
        2,
        't-1',
      );
    });

    it('skips low stock alerts when tenant was already notified within 24h', async () => {
      db.$queryRaw.mockResolvedValue([makeRow()]);
      db.notification.findFirst.mockResolvedValue({ id: 'n-recent' });

      await service.sendLowStockAlerts();

      expect(email.sendLowStockAlert).not.toHaveBeenCalled();
      expect(db.notification.create).not.toHaveBeenCalled();
    });

    it('groups items by tenant and processes each tenant once', async () => {
      db.$queryRaw.mockResolvedValue([
        makeRow({ product_name: 'Widget A', sku: 'A-001' }),
        makeRow({ product_name: 'Widget B', sku: 'B-001' }),
      ]);
      email.sendLowStockAlert.mockResolvedValue(undefined);
      db.notification.create.mockResolvedValue({ id: 'n-1' });

      await service.sendLowStockAlerts();

      expect(email.sendLowStockAlert).toHaveBeenCalledTimes(1);
      const callArg = email.sendLowStockAlert.mock.calls[0];
      expect(callArg[2]).toHaveLength(2);
    });

    it('uses singular form for notification title with 1 item', async () => {
      db.$queryRaw.mockResolvedValue([makeRow()]);
      email.sendLowStockAlert.mockResolvedValue(undefined);
      db.notification.create.mockResolvedValue({ id: 'n-1' });

      await service.sendLowStockAlerts();

      const callArg = db.notification.create.mock.calls[0][0];
      expect(callArg.data.title).toBe('1 product running low');
    });

    it('uses plural form for notification title with multiple items', async () => {
      db.$queryRaw.mockResolvedValue([
        makeRow({ product_name: 'Widget A', sku: 'A-001' }),
        makeRow({ product_name: 'Widget B', sku: 'B-001' }),
      ]);
      email.sendLowStockAlert.mockResolvedValue(undefined);
      db.notification.create.mockResolvedValue({ id: 'n-1' });

      await service.sendLowStockAlerts();

      const callArg = db.notification.create.mock.calls[0][0];
      expect(callArg.data.title).toBe('2 products running low');
    });

    it('includes only product name in body for single-item alert', async () => {
      db.$queryRaw.mockResolvedValue([makeRow({ product_name: 'Widget', total_qty: BigInt(1) })]);
      email.sendLowStockAlert.mockResolvedValue(undefined);
      db.notification.create.mockResolvedValue({ id: 'n-1' });

      await service.sendLowStockAlerts();

      const callArg = db.notification.create.mock.calls[0][0];
      expect(callArg.data.body).toContain('Widget');
      expect(callArg.data.body).toContain('1 unit');
    });

    it('handles empty query result gracefully', async () => {
      db.$queryRaw.mockResolvedValue([]);

      await expect(service.sendLowStockAlerts()).resolves.not.toThrow();
      expect(email.sendLowStockAlert).not.toHaveBeenCalled();
    });

    it('continues when email fails for a tenant', async () => {
      db.$queryRaw.mockResolvedValue([makeRow()]);
      email.sendLowStockAlert.mockRejectedValue(new Error('Network error'));
      db.notification.create.mockResolvedValue({ id: 'n-1' });

      await expect(service.sendLowStockAlerts()).resolves.not.toThrow();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  sendWeeklyReports (cron job)                                        */
  /* ------------------------------------------------------------------ */

  describe('sendWeeklyReports', () => {
    const makeSale = (daysAgo: number, amount: number) => ({
      total_amount: { toNumber: () => amount },
      sale_date: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
      customer_id: 'c-1',
      items: [],
    });

    it('sends weekly report for enabled tenants', async () => {
      const owner = { id: 'u-1', email: 'owner@store.com' };
      const tenant = {
        id: 't-1',
        name: 'My Store',
        report_email: 'report@store.com',
        report_weekly_enabled: true,
        owner,
      };
      db.tenant.findMany.mockResolvedValue([tenant]);
      db.sale.findMany.mockResolvedValue([makeSale(3, 500)]);
      db.customer.count.mockResolvedValue(2);
      // Spy on private send via email mock — email['send'] is accessed directly
      email['send'] = jest.fn().mockResolvedValue(undefined);

      await service.sendWeeklyReports();

      expect(db.tenant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { report_weekly_enabled: true },
        }),
      );
      expect(email['send']).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'report@store.com',
          subject: expect.stringContaining('Weekly Sales Report'),
        }),
      );
      const saleArgs = db.sale.findMany.mock.calls[0][0];
      expect(saleArgs.where).toHaveProperty('sale_date');
      expect(saleArgs.where.created_at).toBeUndefined();
      expect(saleArgs.select).toHaveProperty('sale_date', true);
    });

    it('falls back to owner email when report_email is null', async () => {
      const owner = { id: 'u-1', email: 'owner@store.com' };
      const tenant = {
        id: 't-1',
        name: 'My Store',
        report_email: null,
        report_weekly_enabled: true,
        owner,
      };
      db.tenant.findMany.mockResolvedValue([tenant]);
      db.sale.findMany.mockResolvedValue([]);
      db.customer.count.mockResolvedValue(0);
      email['send'] = jest.fn().mockResolvedValue(undefined);

      await service.sendWeeklyReports();

      expect(email['send']).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'owner@store.com' }),
      );
    });

    it('skips tenant when both report_email and owner email are absent', async () => {
      const tenant = {
        id: 't-1',
        name: 'No Email Store',
        report_email: null,
        report_weekly_enabled: true,
        owner: null,
      };
      db.tenant.findMany.mockResolvedValue([tenant]);
      email['send'] = jest.fn().mockResolvedValue(undefined);

      await service.sendWeeklyReports();

      expect(email['send']).not.toHaveBeenCalled();
    });

    it('handles no tenants with weekly reports enabled', async () => {
      db.tenant.findMany.mockResolvedValue([]);

      await expect(service.sendWeeklyReports()).resolves.not.toThrow();
    });

    it('continues processing other tenants when one fails', async () => {
      const tenant1 = {
        id: 't-1',
        name: 'Store 1',
        report_email: 'a@test.com',
        report_weekly_enabled: true,
        owner: { id: 'u-1', email: 'a@test.com' },
      };
      const tenant2 = {
        id: 't-2',
        name: 'Store 2',
        report_email: 'b@test.com',
        report_weekly_enabled: true,
        owner: { id: 'u-2', email: 'b@test.com' },
      };
      db.tenant.findMany.mockResolvedValue([tenant1, tenant2]);
      db.sale.findMany.mockResolvedValue([]);
      db.customer.count.mockResolvedValue(0);
      email['send'] = jest.fn()
        .mockRejectedValueOnce(new Error('Fail for t-1'))
        .mockResolvedValueOnce(undefined);

      await expect(service.sendWeeklyReports()).resolves.not.toThrow();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  sendMonthlyReports (cron job)                                       */
  /* ------------------------------------------------------------------ */

  describe('sendMonthlyReports', () => {
    it('sends monthly report for enabled tenants', async () => {
      const tenant = {
        id: 't-1',
        name: 'Monthly Store',
        report_email: 'report@store.com',
        report_monthly_enabled: true,
        owner: { id: 'u-1', email: 'owner@store.com' },
      };
      db.tenant.findMany.mockResolvedValue([tenant]);
      db.sale.findMany.mockResolvedValue([]);
      db.customer.count.mockResolvedValue(0);
      email['send'] = jest.fn().mockResolvedValue(undefined);

      await service.sendMonthlyReports();

      expect(db.tenant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { report_monthly_enabled: true },
        }),
      );
      expect(email['send']).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: expect.stringContaining('Monthly Sales Report'),
        }),
      );
    });

    it('handles no tenants with monthly reports enabled', async () => {
      db.tenant.findMany.mockResolvedValue([]);

      await expect(service.sendMonthlyReports()).resolves.not.toThrow();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  purgeExpiredData (cron job)                                         */
  /* ------------------------------------------------------------------ */

  describe('purgeExpiredData', () => {
    it('deletes expired tokens, audit logs, and old notifications', async () => {
      db.passwordResetToken.deleteMany.mockResolvedValue({ count: 3 });
      db.emailVerificationToken.deleteMany.mockResolvedValue({ count: 2 });
      db.auditLog.deleteMany.mockResolvedValue({ count: 100 });
      db.notification.deleteMany.mockResolvedValue({ count: 50 });
      db.aiConversation.deleteMany.mockResolvedValue({ count: 5 });

      await service.purgeExpiredData();

      expect(db.passwordResetToken.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({ used_at: { not: null } }),
              expect.objectContaining({ expires_at: expect.any(Object) }),
            ]),
          }),
        }),
      );
      expect(db.emailVerificationToken.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { expires_at: expect.any(Object) },
        }),
      );
      expect(db.auditLog.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { created_at: expect.any(Object) },
        }),
      );
      expect(db.notification.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { created_at: expect.any(Object) },
        }),
      );
      expect(db.aiConversation.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { updated_at: expect.any(Object) },
        }),
      );
    });

    it('completes without error when nothing to purge', async () => {
      db.passwordResetToken.deleteMany.mockResolvedValue({ count: 0 });
      db.emailVerificationToken.deleteMany.mockResolvedValue({ count: 0 });
      db.auditLog.deleteMany.mockResolvedValue({ count: 0 });
      db.notification.deleteMany.mockResolvedValue({ count: 0 });
      db.aiConversation.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.purgeExpiredData()).resolves.not.toThrow();
    });
  });
});
