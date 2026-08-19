import { Test, TestingModule } from '@nestjs/testing';
import { DeliveryService } from './delivery.service';
import { DatabaseService } from '../database/database.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('DeliveryService', () => {
  let service: DeliveryService;
  let db: any;

  beforeEach(async () => {
    jest.clearAllMocks();

    db = {
      deliveryOrder: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      sale: {
        findFirst: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation(async (cb: any) => cb(db)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeliveryService,
        { provide: DatabaseService, useValue: db },
      ],
    }).compile();

    service = module.get<DeliveryService>(DeliveryService);
  });

  /* ------------------------------------------------------------------ */
  /*  listDeliveries                                                      */
  /* ------------------------------------------------------------------ */

  describe('listDeliveries', () => {
    it('returns paginated delivery orders', async () => {
      const fakeOrders = [{ id: 'd-1', status: 'PENDING' }];
      db.deliveryOrder.findMany.mockResolvedValue(fakeOrders);
      db.deliveryOrder.count.mockResolvedValue(1);

      const result = await service.listDeliveries('t-1', 1, 10);

      expect(result.items).toEqual(fakeOrders);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
      expect(result.pages).toBe(1);
    });

    it('applies skip correctly for page 2', async () => {
      db.deliveryOrder.findMany.mockResolvedValue([]);
      db.deliveryOrder.count.mockResolvedValue(0);

      await service.listDeliveries('t-1', 2, 5);

      expect(db.deliveryOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 5, take: 5 }),
      );
    });

    it('filters by status when provided', async () => {
      db.deliveryOrder.findMany.mockResolvedValue([]);
      db.deliveryOrder.count.mockResolvedValue(0);

      await service.listDeliveries('t-1', 1, 10, 'IN_TRANSIT');

      expect(db.deliveryOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 't-1', status: 'IN_TRANSIT' },
        }),
      );
    });

    it('filters created_at to the inclusive Dhaka day range', async () => {
      db.deliveryOrder.findMany.mockResolvedValue([]);
      db.deliveryOrder.count.mockResolvedValue(0);

      await service.listDeliveries('t-1', 1, 10, {
        createdFrom: '2026-08-19',
        createdTo: '2026-08-19',
      });

      expect(db.deliveryOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId: 't-1',
            created_at: {
              gte: new Date('2026-08-18T18:00:00.000Z'),
              lte: new Date('2026-08-19T17:59:59.999Z'),
            },
          },
        }),
      );
    });

    it('does NOT add status filter when status is undefined', async () => {
      db.deliveryOrder.findMany.mockResolvedValue([]);
      db.deliveryOrder.count.mockResolvedValue(0);

      await service.listDeliveries('t-1', 1, 10);

      expect(db.deliveryOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 't-1' },
        }),
      );
    });

    it('returns pages=0 when total is 0', async () => {
      db.deliveryOrder.findMany.mockResolvedValue([]);
      db.deliveryOrder.count.mockResolvedValue(0);

      const result = await service.listDeliveries('t-1', 1, 10);

      expect(result.pages).toBe(0);
    });

    it('computes pages correctly when total is not divisible by limit', async () => {
      db.deliveryOrder.findMany.mockResolvedValue([]);
      db.deliveryOrder.count.mockResolvedValue(11);

      const result = await service.listDeliveries('t-1', 1, 5);

      expect(result.pages).toBe(3);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  getDelivery                                                         */
  /* ------------------------------------------------------------------ */

  describe('getDelivery', () => {
    it('returns a delivery when found', async () => {
      const fakeDelivery = { id: 'd-1', tenantId: 't-1', status: 'PENDING' };
      db.deliveryOrder.findFirst.mockResolvedValue(fakeDelivery);

      const result = await service.getDelivery('t-1', 'd-1');

      expect(result).toEqual(fakeDelivery);
      expect(db.deliveryOrder.findFirst).toHaveBeenCalledWith({
        where: { id: 'd-1', tenantId: 't-1' },
      });
    });

    it('throws NotFoundException when delivery does not exist', async () => {
      db.deliveryOrder.findFirst.mockResolvedValue(null);

      const result = service.getDelivery('t-1', 'nonexistent');
      await expect(result).rejects.toThrow(NotFoundException);
      await expect(result).rejects.toThrow('Delivery order not found');
    });
  });

  /* ------------------------------------------------------------------ */
  /*  createDelivery                                                      */
  /* ------------------------------------------------------------------ */

  describe('createDelivery', () => {
    const baseDto = {
      customerName: 'Nayeem',
      deliveryAddress: '123 Dhaka Street',
    };

    it('creates delivery without saleId', async () => {
      const created = { id: 'd-new', ...baseDto };
      db.deliveryOrder.create.mockResolvedValue(created);

      const result = await service.createDelivery('t-1', baseDto as any);

      expect(result).toEqual(created);
      expect(db.sale.findFirst).not.toHaveBeenCalled();
      expect(db.deliveryOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: 't-1',
            customerName: 'Nayeem',
            deliveryAddress: '123 Dhaka Street',
            saleId: null,
          }),
        }),
      );
    });

    it('creates delivery with a valid saleId', async () => {
      const created = { id: 'd-new', saleId: 's-1' };
      db.sale.findFirst.mockResolvedValue({ id: 's-1' });
      db.deliveryOrder.create.mockResolvedValue(created);

      const result = await service.createDelivery('t-1', {
        ...baseDto,
        saleId: 's-1',
      } as any);

      expect(db.sale.findFirst).toHaveBeenCalledWith({
        where: { id: 's-1', tenant_id: 't-1' },
        select: { id: true },
      });
      expect(result).toEqual(created);
    });

    it('throws BadRequestException when saleId belongs to another tenant', async () => {
      db.sale.findFirst.mockResolvedValue(null);

      const result = service.createDelivery('t-1', {
        ...baseDto,
        saleId: 'foreign-sale',
      } as any);
      await expect(result).rejects.toThrow(BadRequestException);
      await expect(result).rejects.toThrow('Sale not found or does not belong to this tenant');
    });

    it('parses scheduledAt into a Date object', async () => {
      db.deliveryOrder.create.mockResolvedValue({ id: 'd-new' });
      const scheduledAt = '2026-07-01T10:00:00.000Z';

      await service.createDelivery('t-1', { ...baseDto, scheduledAt } as any);

      const callArg = db.deliveryOrder.create.mock.calls[0][0];
      expect(callArg.data.scheduledAt).toBeInstanceOf(Date);
    });

    it('sets scheduledAt to null when not provided', async () => {
      db.deliveryOrder.create.mockResolvedValue({ id: 'd-new' });

      await service.createDelivery('t-1', baseDto as any);

      const callArg = db.deliveryOrder.create.mock.calls[0][0];
      expect(callArg.data.scheduledAt).toBeNull();
    });

    it('sets optional fields to null when absent', async () => {
      db.deliveryOrder.create.mockResolvedValue({ id: 'd-new' });

      await service.createDelivery('t-1', baseDto as any);

      const callArg = db.deliveryOrder.create.mock.calls[0][0];
      expect(callArg.data.customerPhone).toBeNull();
      expect(callArg.data.driverName).toBeNull();
      expect(callArg.data.driverPhone).toBeNull();
      expect(callArg.data.notes).toBeNull();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  updateDelivery                                                      */
  /* ------------------------------------------------------------------ */

  describe('updateDelivery', () => {
    const existingDelivery = { id: 'd-1', tenantId: 't-1', status: 'PENDING' };

    it('updates allowed fields', async () => {
      db.deliveryOrder.findFirst.mockResolvedValue(existingDelivery);
      db.deliveryOrder.update.mockResolvedValue({ ...existingDelivery, driverName: 'Rahim' });

      const result = await service.updateDelivery('t-1', 'd-1', {
        driverName: 'Rahim',
        driverPhone: '01711000000',
      });

      expect(result.driverName).toBe('Rahim');
      expect(db.deliveryOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'd-1' },
          data: expect.objectContaining({ driverName: 'Rahim', driverPhone: '01711000000' }),
        }),
      );
    });

    it('throws NotFoundException when delivery does not exist', async () => {
      db.deliveryOrder.findFirst.mockResolvedValue(null);

      const result = service.updateDelivery('t-1', 'bad-id', { driverName: 'X' });
      await expect(result).rejects.toThrow(NotFoundException);
    });

    it('sets deliveredAt when status is DELIVERED', async () => {
      db.deliveryOrder.findFirst.mockResolvedValue(existingDelivery);
      db.deliveryOrder.update.mockResolvedValue({ ...existingDelivery, status: 'DELIVERED' });

      await service.updateDelivery('t-1', 'd-1', { status: 'DELIVERED' });

      const callArg = db.deliveryOrder.update.mock.calls[0][0];
      expect(callArg.data.deliveredAt).toBeInstanceOf(Date);
    });

    it('does NOT set deliveredAt for statuses other than DELIVERED', async () => {
      db.deliveryOrder.findFirst.mockResolvedValue(existingDelivery);
      db.deliveryOrder.update.mockResolvedValue({ ...existingDelivery, status: 'IN_TRANSIT' });

      await service.updateDelivery('t-1', 'd-1', { status: 'IN_TRANSIT' });

      const callArg = db.deliveryOrder.update.mock.calls[0][0];
      expect(callArg.data.deliveredAt).toBeUndefined();
    });

    it('parses scheduledAt into a Date when provided', async () => {
      db.deliveryOrder.findFirst.mockResolvedValue(existingDelivery);
      db.deliveryOrder.update.mockResolvedValue(existingDelivery);

      await service.updateDelivery('t-1', 'd-1', {
        scheduledAt: '2026-08-15T09:00:00.000Z',
      });

      const callArg = db.deliveryOrder.update.mock.calls[0][0];
      expect(callArg.data.scheduledAt).toBeInstanceOf(Date);
    });

    it('skips undefined fields in update payload', async () => {
      db.deliveryOrder.findFirst.mockResolvedValue(existingDelivery);
      db.deliveryOrder.update.mockResolvedValue(existingDelivery);

      await service.updateDelivery('t-1', 'd-1', {});

      const callArg = db.deliveryOrder.update.mock.calls[0][0];
      expect(Object.keys(callArg.data)).toHaveLength(0);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  cancelDelivery                                                      */
  /* ------------------------------------------------------------------ */

  describe('cancelDelivery', () => {
    it('sets status to CANCELLED', async () => {
      const existing = { id: 'd-1', tenantId: 't-1', status: 'PENDING' };
      db.deliveryOrder.findFirst.mockResolvedValue(existing);
      db.deliveryOrder.update.mockResolvedValue({ ...existing, status: 'CANCELLED' });

      const result = await service.cancelDelivery('t-1', 'd-1');

      expect(result.status).toBe('CANCELLED');
      expect(db.deliveryOrder.update).toHaveBeenCalledWith({
        where: { id: 'd-1' },
        data: { status: 'CANCELLED' },
      });
    });

    it('throws NotFoundException when delivery not found', async () => {
      db.deliveryOrder.findFirst.mockResolvedValue(null);

      const result = service.cancelDelivery('t-1', 'ghost');
      await expect(result).rejects.toThrow(NotFoundException);
      await expect(result).rejects.toThrow('Delivery order not found');
    });
  });
});
