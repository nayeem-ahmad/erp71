import { Test, TestingModule } from '@nestjs/testing';
import { SalesService } from './sales.service';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import { SmsService } from '../sms/sms.service';
import { CrmCampaignsService } from '../crm-campaigns/crm-campaigns.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { applyInventoryMovement, resolveWarehouseId } from '../database/inventory.utils';
import { autoPostFromRules, voidAutoPostedVoucher } from '../accounting/posting.utils';

jest.mock('../database/inventory.utils', () => ({
  applyInventoryMovement: jest.fn(),
  resolveWarehouseId: jest.fn(),
}));

jest.mock('../accounting/posting.utils', () => ({
  autoPostFromRules: jest.fn(),
  voidAutoPostedVoucher: jest.fn(),
}));

describe('SalesService', () => {
  let service: SalesService;
  let db: any;
  let tx: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    tx = {
      product: {
        findMany: jest.fn(),
      },
      productPrice: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      paymentMethod: {
        // No custom account by default → posting keeps the rule's mode account.
        findFirst: jest.fn().mockResolvedValue(null),
      },
      sale: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      salesSettings: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      saleItem: {
        create: jest.fn(),
        deleteMany: jest.fn(),
      },
      productStock: {
        updateMany: jest.fn(),
      },
      customer: {
        update: jest.fn(),
        findFirst: jest.fn(),
      },
      customerCreditTransaction: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn(),
      },
      tenant: {
        findUnique: jest.fn(),
      },
      loyaltyTransaction: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn(),
      },
      paymentRecord: {
        deleteMany: jest.fn(),
        create: jest.fn(),
      },
      inventorySettings: {
        findUnique: jest.fn(),
      },
      warehouse: {
        findFirst: jest.fn(),
      },
      productSerial: {
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
      },
    };

    db = {
      $transaction: jest.fn().mockImplementation((cb) => cb(tx)),
      sale: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      voucher: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
      postingEvent: {
        findMany: jest.fn(),
      },
      customer: {
        findUnique: jest.fn().mockResolvedValue({ email: 'cust@example.com', name: 'Customer 1', phone: '123456789' }),
      },
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ name: 'Tenant 1', sms_on_sale: true }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesService,
        { provide: DatabaseService, useValue: db },
        { provide: EmailService, useValue: { sendBillingInvoice: jest.fn() } },
        { provide: SmsService, useValue: { sendSaleReceipt: jest.fn() } },
        { provide: CrmCampaignsService, useValue: { attributeSale: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();

    service = module.get<SalesService>(SalesService);
    (resolveWarehouseId as jest.Mock).mockResolvedValue('wh-1');
    // mockReset (not just clearAllMocks) so any leftover `...Once()` queue from a
    // prior test cannot leak a rejection into the next one.
    (applyInventoryMovement as jest.Mock).mockReset();
    (applyInventoryMovement as jest.Mock).mockResolvedValue(0);
    (autoPostFromRules as jest.Mock).mockResolvedValue({
      postingStatus: 'posted',
      voucherId: 'voucher-1',
      voucherNumber: 'CR-00001',
      voucherType: 'cash_receive',
    });
    tx.product.findMany.mockResolvedValue([{ id: 'prod-1', name: 'Product 1', warranty_enabled: false }]);
    tx.productSerial.findUnique.mockResolvedValue(null);
    tx.productSerial.update.mockResolvedValue({});
    tx.productSerial.create.mockResolvedValue({});
    db.voucher.findMany.mockResolvedValue([]);
    db.voucher.findFirst.mockResolvedValue(null);
    db.postingEvent.findMany.mockResolvedValue([]);
  });

  describe('create() — Story 10.3: Atomic Sale Transaction', () => {
    it('should create a sale and atomically decrement stock', async () => {
      const sale = { id: 'sale-1', total_amount: 30 };
      tx.sale.create.mockResolvedValue(sale);
      tx.saleItem.create.mockResolvedValue({});
      tx.productStock.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.create('tenant-1', 'user-1', {
        storeId: 'store-1',
        totalAmount: 30,
        amountPaid: 30,
        items: [{ productId: 'prod-1', quantity: 2, priceAtSale: 15 }],
      });

      expect(tx.saleItem.create).toHaveBeenCalledWith({
        data: { sale_id: 'sale-1', product_id: 'prod-1', quantity: 2, price_at_sale: 15, unit_cost_at_sale: null },
      });
      expect(applyInventoryMovement).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          tenantId: 'tenant-1',
          productId: 'prod-1',
          warehouseId: 'wh-1',
          quantityDelta: -2,
          movementType: 'SALE',
        }),
      );
      expect(result.id).toBe('sale-1');
    });

    it('should throw BadRequestException when stock is insufficient', async () => {
      tx.product.findMany.mockResolvedValue([
        { id: 'prod-low', name: 'Low Stock Product', warranty_enabled: false },
      ]);
      tx.sale.create.mockResolvedValue({ id: 'sale-2' });
      tx.saleItem.create.mockResolvedValue({});
      (applyInventoryMovement as jest.Mock).mockRejectedValueOnce(new BadRequestException('Insufficient stock'));

      await expect(
        service.create('tenant-1', 'user-1', {
          storeId: 'store-1',
          totalAmount: 15,
          amountPaid: 15,
          items: [{ productId: 'prod-low', quantity: 100, priceAtSale: 15 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should update customer total_spent when customerId is provided', async () => {
      tx.sale.create.mockResolvedValue({ id: 'sale-3', total_amount: 50 });
      tx.saleItem.create.mockResolvedValue({});
      tx.productStock.updateMany.mockResolvedValue({ count: 1 });
      tx.customer.update.mockResolvedValue({});

      await service.create('tenant-1', 'user-1', {
        storeId: 'store-1',
        customerId: 'cust-1',
        totalAmount: 50,
        amountPaid: 50,
        items: [{ productId: 'prod-1', quantity: 1, priceAtSale: 50 }],
      });

      expect(tx.customer.update).toHaveBeenCalledWith({
        where: { id: 'cust-1' },
        data: { total_spent: { increment: 50 } },
      });
    });

    it('should not update customer when no customerId', async () => {
      tx.sale.create.mockResolvedValue({ id: 'sale-4' });
      tx.saleItem.create.mockResolvedValue({});
      tx.productStock.updateMany.mockResolvedValue({ count: 1 });

      await service.create('tenant-1', 'user-1', {
        storeId: 'store-1',
        totalAmount: 20,
        amountPaid: 20,
        items: [{ productId: 'prod-1', quantity: 1, priceAtSale: 20 }],
      });

      expect(tx.customer.update).not.toHaveBeenCalled();
    });
  });

  describe('create() — drafts', () => {
    const draftDto = {
      storeId: 'store-1',
      customerId: 'cust-1',
      // Deliberately inconsistent with the line total: a draft is stored as
      // entered, so no total/credit validation runs.
      totalAmount: 999,
      amountPaid: 0,
      items: [{ productId: 'prod-1', quantity: 2, priceAtSale: 15 }],
      isDraft: true,
    };

    beforeEach(() => {
      tx.product.count = jest.fn().mockResolvedValue(1);
      tx.sale.create.mockResolvedValue({ id: 'draft-1', serial_number: 'SL-1', total_amount: 999 });
      tx.saleItem.create.mockResolvedValue({});
    });

    it('stores the sale as DRAFT with its lines and posts nothing', async () => {
      const result = await service.create('tenant-1', 'user-1', draftDto);

      expect(tx.sale.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'DRAFT', total_amount: 999, amount_paid: 0 }),
        }),
      );
      expect(tx.saleItem.create).toHaveBeenCalledWith({
        data: { sale_id: 'draft-1', product_id: 'prod-1', quantity: 2, price_at_sale: 15 },
      });
      expect(applyInventoryMovement).not.toHaveBeenCalled();
      expect(autoPostFromRules).not.toHaveBeenCalled();
      expect(tx.customer.update).not.toHaveBeenCalled();
      expect(tx.customerCreditTransaction.create).not.toHaveBeenCalled();
      expect(result.posting_status).toBe('skipped');
    });

    it('rejects a draft referencing a product that no longer exists', async () => {
      tx.product.count.mockResolvedValue(0);

      await expect(service.create('tenant-1', 'user-1', draftDto)).rejects.toThrow(BadRequestException);
      expect(tx.sale.create).not.toHaveBeenCalled();
    });
  });

  describe('finalizeDraft()', () => {
    const draftRow = {
      id: 'draft-1',
      tenant_id: 'tenant-1',
      store_id: 'store-1',
      counter_id: null,
      customer_id: 'cust-1',
      serial_number: 'SL-1',
      reference_number: '2607-001',
      status: 'DRAFT',
      total_amount: 30,
      amount_paid: 30,
      note: 'parked',
      items: [{ product_id: 'prod-1', quantity: 2, price_at_sale: 15 }],
      payments: [{ payment_method: 'Cash', amount: 30, account_id: null }],
    };

    beforeEach(() => {
      tx.sale.findFirst.mockResolvedValue(draftRow);
      tx.sale.update.mockResolvedValue({
        ...draftRow,
        status: 'COMPLETED',
        customer_id: 'cust-1',
      });
      tx.saleItem.create.mockResolvedValue({});
      tx.paymentRecord.create.mockResolvedValue({});
    });

    it('posts the parked draft: stock, lines, payments, customer spend and voucher', async () => {
      const result = await service.finalizeDraft('tenant-1', 'user-1', 'draft-1');

      // Parked lines/payments are replaced by what actually posts
      expect(tx.saleItem.deleteMany).toHaveBeenCalledWith({ where: { sale_id: 'draft-1' } });
      expect(tx.paymentRecord.deleteMany).toHaveBeenCalledWith({ where: { sale_id: 'draft-1' } });
      expect(tx.paymentRecord.create).toHaveBeenCalledWith({
        data: { sale_id: 'draft-1', payment_method: 'Cash', amount: 30, account_id: null },
      });

      expect(applyInventoryMovement).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ productId: 'prod-1', quantityDelta: -2, movementType: 'SALE' }),
      );
      expect(tx.sale.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'draft-1' },
          data: expect.objectContaining({ status: 'COMPLETED', total_amount: 30 }),
        }),
      );
      expect(tx.customer.update).toHaveBeenCalledWith({
        where: { id: 'cust-1' },
        data: { total_spent: { increment: 30 } },
      });
      expect(autoPostFromRules).toHaveBeenCalled();
      expect(result.status).toBe('COMPLETED');
    });

    it('accepts edited items and payments on the way out', async () => {
      await service.finalizeDraft('tenant-1', 'user-1', 'draft-1', {
        items: [{ productId: 'prod-1', quantity: 1, priceAtSale: 15 }],
        payments: [{ paymentMethod: 'Cash', amount: 15 }],
        totalAmount: 15,
      });

      expect(applyInventoryMovement).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ quantityDelta: -1 }),
      );
      expect(tx.sale.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ total_amount: 15, amount_paid: 15 }),
        }),
      );
    });

    it('refuses to finalize a sale that is not a draft', async () => {
      tx.sale.findFirst.mockResolvedValue({ ...draftRow, status: 'COMPLETED' });

      await expect(service.finalizeDraft('tenant-1', 'user-1', 'draft-1')).rejects.toThrow(BadRequestException);
      expect(applyInventoryMovement).not.toHaveBeenCalled();
    });

    it('leaves the draft untouched when stock is insufficient', async () => {
      (applyInventoryMovement as jest.Mock).mockRejectedValueOnce(new BadRequestException('Insufficient stock'));

      await expect(service.finalizeDraft('tenant-1', 'user-1', 'draft-1')).rejects.toThrow(BadRequestException);
      // The whole finalize runs in one transaction, so the status flip rolls back
      expect(autoPostFromRules).not.toHaveBeenCalled();
    });
  });

  describe('update() — drafts', () => {
    beforeEach(() => {
      tx.sale.findFirst.mockResolvedValue({
        id: 'draft-1',
        store_id: 'store-1',
        customer_id: 'cust-1',
        status: 'DRAFT',
        total_amount: 30,
        items: [{ product_id: 'prod-1', quantity: 2 }],
        payments: [],
      });
      tx.sale.update.mockResolvedValue({ id: 'draft-1' });
      tx.saleItem.create.mockResolvedValue({});
    });

    it('does not move stock when a draft is edited', async () => {
      await service.update('tenant-1', 'draft-1', {
        items: [{ productId: 'prod-1', quantity: 5, priceAtSale: 15 }],
      });

      expect(applyInventoryMovement).not.toHaveBeenCalled();
      expect(tx.customer.update).not.toHaveBeenCalled();
    });

    it('refuses to complete a draft through the update path', async () => {
      await expect(
        service.update('tenant-1', 'draft-1', { status: 'COMPLETED' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('create() — customer credit / keeping due', () => {
    it('records a credit sale when payment is short and within credit limit', async () => {
      tx.customer.findFirst.mockResolvedValue({
        id: 'cust-1',
        due_balance: 1000,
        credit_limit: 5000,
      });
      tx.sale.create.mockResolvedValue({ id: 'sale-credit', serial_number: 'SL-1', total_amount: 1000 });
      tx.saleItem.create.mockResolvedValue({});
      tx.customer.update.mockResolvedValue({});
      tx.customerCreditTransaction.create.mockResolvedValue({});

      await service.create('tenant-1', 'user-1', {
        storeId: 'store-1',
        customerId: 'cust-1',
        totalAmount: 1000,
        amountPaid: 600,
        items: [{ productId: 'prod-1', quantity: 1, priceAtSale: 1000 }],
        payments: [{ paymentMethod: 'CASH', amount: 600 }],
      });

      expect(tx.customerCreditTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          customer_id: 'cust-1',
          type: 'CREDIT_SALE',
          amount: 400,
          balance_after: 1400,
          reference_type: 'SALE',
          reference_id: 'sale-credit',
        }),
      });
      expect(autoPostFromRules).toHaveBeenCalledWith(
        expect.objectContaining({
          conditionValue: 'credit',
          amount: 400,
        }),
      );
    });

    it('rejects keeping due when credit limit would be exceeded', async () => {
      tx.customer.findFirst.mockResolvedValue({
        id: 'cust-1',
        due_balance: 4800,
        credit_limit: 5000,
      });

      await expect(
        service.create('tenant-1', 'user-1', {
          storeId: 'store-1',
          customerId: 'cust-1',
          totalAmount: 1000,
          amountPaid: 600,
          items: [{ productId: 'prod-1', quantity: 1, priceAtSale: 1000 }],
          payments: [{ paymentMethod: 'CASH', amount: 600 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects keeping due without a customer', async () => {
      await expect(
        service.create('tenant-1', 'user-1', {
          storeId: 'store-1',
          totalAmount: 1000,
          amountPaid: 600,
          items: [{ productId: 'prod-1', quantity: 1, priceAtSale: 1000 }],
          payments: [{ paymentMethod: 'CASH', amount: 600 }],
        }),
      ).rejects.toThrow(/Select a customer/);
    });
  });

  describe('create() — Story 10.4: Advanced Payments (Split/Cards)', () => {
    it('should create a sale with split payment methods', async () => {
      const sale = { id: 'sale-5' };
      tx.sale.create.mockResolvedValue(sale);
      tx.saleItem.create.mockResolvedValue({});
      tx.productStock.updateMany.mockResolvedValue({ count: 1 });

      await service.create('tenant-1', 'user-1', {
        storeId: 'store-1',
        totalAmount: 100,
        amountPaid: 100,
        items: [{ productId: 'prod-1', quantity: 1, priceAtSale: 100 }],
        payments: [
          { paymentMethod: 'CASH', amount: 60 },
          { paymentMethod: 'BKASH', amount: 40 },
        ],
      });

      expect(tx.sale.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          payments: {
            create: [
              { payment_method: 'CASH', amount: 60, account_id: null },
              { payment_method: 'BKASH', amount: 40, account_id: null },
            ],
          },
        }),
      });
    });

    it('should create a sale without explicit payments payload', async () => {
      tx.sale.create.mockResolvedValue({ id: 'sale-6' });
      tx.saleItem.create.mockResolvedValue({});
      tx.productStock.updateMany.mockResolvedValue({ count: 1 });

      await service.create('tenant-1', 'user-1', {
        storeId: 'store-1',
        totalAmount: 20,
        amountPaid: 20,
        items: [{ productId: 'prod-1', quantity: 1, priceAtSale: 20 }],
      });

      expect(tx.sale.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ payments: undefined }),
      });
    });

    it('persists a provided saleDate into sale_date', async () => {
      tx.sale.create.mockResolvedValue({ id: 'sale-9' });
      tx.saleItem.create.mockResolvedValue({});
      tx.productStock.updateMany.mockResolvedValue({ count: 1 });

      await service.create('tenant-1', 'user-1', {
        storeId: 'store-1',
        totalAmount: 20,
        amountPaid: 20,
        items: [{ productId: 'prod-1', quantity: 1, priceAtSale: 20 }],
        saleDate: '2026-01-15T10:00:00.000Z',
      });

      const createArg = tx.sale.create.mock.calls[0][0];
      expect(createArg.data.sale_date).toEqual(new Date('2026-01-15T10:00:00.000Z'));
    });

    it('should process multiple items atomically', async () => {
      tx.sale.create.mockResolvedValue({ id: 'sale-7' });
      tx.saleItem.create.mockResolvedValue({});
      (applyInventoryMovement as jest.Mock).mockResolvedValue(0);
      tx.product.findMany.mockResolvedValue([
        { id: 'prod-A', name: 'Product A', warranty_enabled: false },
        { id: 'prod-B', name: 'Product B', warranty_enabled: false },
      ]);

      await service.create('tenant-1', 'user-1', {
        storeId: 'store-1',
        totalAmount: 50,
        amountPaid: 50,
        items: [
          { productId: 'prod-A', quantity: 2, priceAtSale: 10 },
          { productId: 'prod-B', quantity: 3, priceAtSale: 10 },
        ],
      });

      expect(tx.saleItem.create).toHaveBeenCalledTimes(2);
      expect(applyInventoryMovement).toHaveBeenCalledTimes(2);
    });

    it('should reject sale when a warranty serial is already sold', async () => {
      tx.product.findMany.mockResolvedValue([
        { id: 'prod-w', name: 'Warranty Product', warranty_enabled: true },
      ]);
      tx.sale.create.mockResolvedValue({ id: 'sale-8', total_amount: 100 });
      tx.saleItem.create.mockResolvedValue({});
      tx.productSerial.findUnique.mockResolvedValue({
        id: 'serial-1',
        status: 'SOLD',
        source_id: 'prior-sale-1',
      });

      await expect(
        service.create('tenant-1', 'user-1', {
          storeId: 'store-1',
          totalAmount: 100,
          amountPaid: 100,
          items: [
            {
              productId: 'prod-w',
              quantity: 1,
              priceAtSale: 100,
              serialNumbers: ['SERIAL-001'],
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);

      expect(tx.productSerial.create).not.toHaveBeenCalled();
      expect(tx.productSerial.update).not.toHaveBeenCalled();
    });
  });

  describe('findAll()', () => {
    it('should return cursor-paginated sales for a tenant', async () => {
      db.sale.findMany.mockResolvedValue([{ id: 's1' }, { id: 's2' }]);
      db.voucher.findMany.mockResolvedValue([]);

      const result = await service.findAll('tenant-1');

      expect(db.sale.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenant_id: 'tenant-1' } }),
      );
      expect(result.items).toHaveLength(2);
      expect(result).toHaveProperty('nextCursor');
      expect(result).toHaveProperty('hasMore');
    });

    it('should filter sales to the requesting user when createdBy is set', async () => {
      db.sale.findMany.mockResolvedValue([{ id: 's1' }]);
      db.voucher.findMany.mockResolvedValue([]);

      await service.findAll('tenant-1', { createdBy: 'user-42' });

      expect(db.sale.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenant_id: 'tenant-1', created_by: 'user-42' },
        }),
      );
    });
  });

  describe('findOne()', () => {
    it('should return a sale with items and payments', async () => {
      db.sale.findFirst.mockResolvedValue({ id: 's1', items: [], payments: [] });

      const result = await service.findOne('tenant-1', 's1');

      expect(result.id).toBe('s1');
    });

    it('should throw NotFoundException when sale does not exist', async () => {
      db.sale.findFirst.mockResolvedValue(null);

      await expect(service.findOne('tenant-1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('generateReferenceNumber()', () => {
    it('increments the max sequence for the YYMM prefix across all dates', async () => {
      const now = new Date();
      const yymm = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}`;
      tx.salesSettings.findUnique.mockResolvedValue({ reference_number_format: 'YYMM-#' });
      tx.sale.findMany.mockResolvedValue([
        { reference_number: `${yymm}-001` },
        { reference_number: `${yymm}-005` },
      ]);

      const result = await service.generateReferenceNumber('tenant-1', tx);

      expect(tx.sale.findMany).toHaveBeenCalledWith({
        where: {
          tenant_id: 'tenant-1',
          reference_number: { startsWith: `${yymm}-` },
        },
        select: { reference_number: true },
      });
      expect(result).toBe(`${yymm}-006`);
    });
  });

  describe('update()', () => {
    it('should update a sale note', async () => {
      tx.sale.findFirst.mockResolvedValue({ id: 's1', items: [], payments: [], total_amount: 20, customer_id: null });
      tx.sale.update.mockResolvedValue({ id: 's1', note: 'Updated note' });

      const result = await service.update('tenant-1', 's1', { note: 'Updated note' });

      expect(tx.sale.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: expect.objectContaining({ note: 'Updated note' }),
        include: {
          items: { include: { product: true } },
          payments: true,
        },
      });
      expect(result).toBeDefined();
    });

    it('should throw NotFoundException when sale to update is not found', async () => {
      tx.sale.findFirst.mockResolvedValue(null);

      await expect(service.update('tenant-1', 'bad-id', { note: 'x' })).rejects.toThrow(NotFoundException);
    });

    it('persists a provided saleDate into sale_date on update', async () => {
      tx.sale.findFirst.mockResolvedValue({ id: 's1', items: [], payments: [], total_amount: 20, customer_id: null });
      tx.sale.update.mockResolvedValue({ id: 's1' });

      await service.update('tenant-1', 's1', { saleDate: '2026-01-15T10:00:00.000Z' });

      const updateArg = tx.sale.update.mock.calls[0][0];
      expect(updateArg.data.sale_date).toEqual(new Date('2026-01-15T10:00:00.000Z'));
    });

    it('does not set sale_date on update when saleDate is omitted', async () => {
      tx.sale.findFirst.mockResolvedValue({ id: 's1', items: [], payments: [], total_amount: 20, customer_id: null });
      tx.sale.update.mockResolvedValue({ id: 's1' });

      await service.update('tenant-1', 's1', { note: 'no date' });

      const updateArg = tx.sale.update.mock.calls[0][0];
      expect(updateArg.data).not.toHaveProperty('sale_date');
    });

    it('honours an explicit totalAmount over the sum of the lines', async () => {
      // The entry form's adjustments (VAT, transport, rounding) live only in
      // the total — recomputing from lines alone would silently drop them.
      tx.sale.findFirst.mockResolvedValue({
        id: 's1', store_id: 'store-1', status: 'COMPLETED', items: [], payments: [], total_amount: 100, customer_id: null,
      });
      tx.sale.update.mockResolvedValue({ id: 's1' });

      await service.update('tenant-1', 's1', {
        items: [{ productId: 'prod-1', quantity: 2, priceAtSale: 50 }],
        totalAmount: 115,
      });

      expect(tx.sale.update.mock.calls[0][0].data.total_amount).toBe(115);
    });
  });

  describe('remove()', () => {
    const completedSale = {
      id: 'sale-1',
      store_id: 'store-1',
      status: 'COMPLETED',
      total_amount: 300,
      customer_id: 'cust-1',
      items: [{ product_id: 'prod-1', quantity: 3 }],
      returns: [],
      warrantyClaims: [],
      deliveryOrders: [],
    };

    it('throws NotFoundException for an unknown sale', async () => {
      tx.sale.findFirst.mockResolvedValue(null);
      await expect(service.remove('tenant-1', 'nope')).rejects.toThrow(NotFoundException);
    });

    it.each([
      ['returns', 'returns'],
      ['warranty claims', 'warrantyClaims'],
      ['delivery orders', 'deliveryOrders'],
    ])('refuses to delete a sale that still has %s', async (_label, key) => {
      tx.sale.findFirst.mockResolvedValue({ ...completedSale, [key]: [{ id: 'x' }] });

      await expect(service.remove('tenant-1', 'sale-1')).rejects.toThrow(BadRequestException);
      expect(tx.sale.delete).not.toHaveBeenCalled();
    });

    it('restores stock, reverses loyalty, credit and spend, and voids both posting legs', async () => {
      tx.sale.findFirst.mockResolvedValue(completedSale);
      tx.loyaltyTransaction.findMany.mockResolvedValue([{ points: 30 }, { points: -10 }]);
      tx.customerCreditTransaction.findMany.mockResolvedValue([{ id: 'ct-1', amount: 120 }]);

      const result = await service.remove('tenant-1', 'sale-1');

      expect(applyInventoryMovement).toHaveBeenCalledWith(tx, expect.objectContaining({
        productId: 'prod-1',
        quantityDelta: 3,
        movementType: 'SALE_DELETE_REVERSAL',
        referenceId: 'sale-1',
      }));
      expect(tx.productSerial.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'IN_STOCK', source_id: null }),
      }));
      // Net points earned (30 - 10) come back off the customer's balance.
      expect(tx.customer.update).toHaveBeenCalledWith({
        where: { id: 'cust-1' },
        data: { loyalty_points: { decrement: 20 } },
      });
      expect(tx.customerCreditTransaction.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['ct-1'] } },
      });
      expect(tx.customer.update).toHaveBeenCalledWith({
        where: { id: 'cust-1' },
        data: { total_spent: { decrement: 300 }, due_balance: { decrement: 120 } },
      });
      expect(voidAutoPostedVoucher).toHaveBeenCalledWith(tx, 'tenant-1', 'sale', 'sale-1');
      expect(voidAutoPostedVoucher).toHaveBeenCalledWith(tx, 'tenant-1', 'sale', 'sale-1', 'paid');
      expect(tx.sale.delete).toHaveBeenCalledWith({ where: { id: 'sale-1' } });
      expect(result).toEqual({ deleted: true, id: 'sale-1' });
    });

    it('leaves the due balance alone when the sale was fully paid', async () => {
      tx.sale.findFirst.mockResolvedValue(completedSale);
      tx.customerCreditTransaction.findMany.mockResolvedValue([]);

      await service.remove('tenant-1', 'sale-1');

      expect(tx.customer.update).toHaveBeenCalledWith({
        where: { id: 'cust-1' },
        data: { total_spent: { decrement: 300 } },
      });
    });

    it('deletes a draft without touching stock, loyalty, credit or the ledger', async () => {
      tx.sale.findFirst.mockResolvedValue({ ...completedSale, status: 'DRAFT' });

      await service.remove('tenant-1', 'sale-1');

      expect(applyInventoryMovement).not.toHaveBeenCalled();
      expect(tx.customer.update).not.toHaveBeenCalled();
      expect(voidAutoPostedVoucher).not.toHaveBeenCalled();
      expect(tx.sale.delete).toHaveBeenCalledWith({ where: { id: 'sale-1' } });
    });

    it('skips customer bookkeeping for a walk-in sale', async () => {
      tx.sale.findFirst.mockResolvedValue({ ...completedSale, customer_id: null });

      await service.remove('tenant-1', 'sale-1');

      expect(tx.customer.update).not.toHaveBeenCalled();
      expect(applyInventoryMovement).toHaveBeenCalled();
      expect(tx.sale.delete).toHaveBeenCalled();
    });
  });
});
