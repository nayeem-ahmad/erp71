import { Test, TestingModule } from '@nestjs/testing';
import { SalesQuotationsService } from './sales-quotations.service';
import { DatabaseService } from '../database/database.service';
import { SalesOrdersService } from '../sales-orders/sales-orders.service';
import { ShortLinksService } from '../short-links/short-links.service';
import { BadRequestException } from '@nestjs/common';

describe('SalesQuotationsService', () => {
  let service: SalesQuotationsService;
  let db: any;
  let ordersService: any;
  let shortLinks: any;

  beforeEach(async () => {
    db = {
      $transaction: jest.fn().mockImplementation(async (cb) => cb(db)),
      quotation: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        deleteMany: jest.fn(),
        updateMany: jest.fn(),
      },
      quotationItem: {
        deleteMany: jest.fn(),
      },
      shortLink: {
        updateMany: jest.fn(),
      },
    };

    ordersService = {
        create: jest.fn()
    };

    shortLinks = {
        createForEntity: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesQuotationsService,
        { provide: DatabaseService, useValue: db },
        { provide: SalesOrdersService, useValue: ordersService },
        { provide: ShortLinksService, useValue: shortLinks }
      ],
    }).compile();

    service = module.get<SalesQuotationsService>(SalesQuotationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('create() should successfully create a quotation', async () => {
    const mockDto = {
        storeId: 'store-1',
        totalAmount: 500,
        items: [{ productId: 'prod-1', quantity: 1, unitPrice: 500 }]
    };
    db.quotation.create.mockResolvedValue({ id: 'quote-1' });

    const result = await service.create('tenant-1', mockDto as any);
    expect(db.quotation.create).toHaveBeenCalled();
    expect(result).toEqual({ id: 'quote-1' });
  });

  it('revise() should duplicate a specific quote keeping status updated', async () => {
    const oldQuote = {
        id: 'quote-1',
        version: 1,
        status: 'DRAFT',
        items: [{ product_id: 'prod-1', quantity: 1, unit_price: 100 }]
    };
    
    db.quotation.findUnique.mockResolvedValue(oldQuote);
    db.quotation.create.mockResolvedValue({ id: 'quote-2', version: 2 });

    const result = await service.revise('tenant-1', 'quote-1');
    expect(db.quotation.update).toHaveBeenCalledWith({
        where: { id: 'quote-1' },
        data: { status: 'REVISED', share_token: null, share_token_at: null }
    });
    expect(db.quotation.create).toHaveBeenCalled();
    expect(result.version).toEqual(2);
  });

  it('revise() should throw if quote is already accepted or converted', async () => {
      db.quotation.findUnique.mockResolvedValue({ status: 'ACCEPTED' });
      await expect(service.revise('t1', 'q1')).rejects.toThrow(BadRequestException);
  });

  describe('revise() share token handling', () => {
    it('moves the share token to the new row', async () => {
      const oldQuote = {
          id: 'quote-1',
          version: 1,
          status: 'SENT',
          share_token: 'tok-abc',
          share_token_at: new Date('2026-08-01'),
          items: [{ product_id: 'prod-1', quantity: 1, unit_price: 100 }]
      };

      db.quotation.findUnique.mockResolvedValue(oldQuote);
      db.quotation.create.mockResolvedValue({ id: 'quote-2', version: 2 });

      await service.revise('tenant-1', 'quote-1');

      expect(db.quotation.create).toHaveBeenCalledWith(
          expect.objectContaining({
              data: expect.objectContaining({
                  share_token: 'tok-abc',
                  share_token_at: oldQuote.share_token_at,
              }),
          }),
      );
    });

    it('clears the share token on the old row', async () => {
      const oldQuote = {
          id: 'quote-1',
          version: 1,
          status: 'SENT',
          share_token: 'tok-abc',
          share_token_at: new Date('2026-08-01'),
          items: [{ product_id: 'prod-1', quantity: 1, unit_price: 100 }]
      };

      db.quotation.findUnique.mockResolvedValue(oldQuote);
      db.quotation.create.mockResolvedValue({ id: 'quote-2', version: 2 });

      await service.revise('tenant-1', 'quote-1');

      expect(db.quotation.update).toHaveBeenCalledWith({
          where: { id: 'quote-1' },
          data: { status: 'REVISED', share_token: null, share_token_at: null }
      });
    });

    it('clears the old token before creating the new row', async () => {
      const oldQuote = {
          id: 'quote-1',
          version: 1,
          status: 'SENT',
          share_token: 'tok-abc',
          share_token_at: new Date('2026-08-01'),
          items: [{ product_id: 'prod-1', quantity: 1, unit_price: 100 }]
      };

      db.quotation.findUnique.mockResolvedValue(oldQuote);
      db.quotation.create.mockResolvedValue({ id: 'quote-2', version: 2 });

      await service.revise('tenant-1', 'quote-1');

      const updateOrder = db.quotation.update.mock.invocationCallOrder[0];
      const createOrder = db.quotation.create.mock.invocationCallOrder[0];
      expect(updateOrder).toBeLessThan(createOrder);
    });

    it('leaves an unshared quotation unaffected', async () => {
      const oldQuote = {
          id: 'quote-1',
          version: 1,
          status: 'DRAFT',
          share_token: null,
          share_token_at: null,
          items: [{ product_id: 'prod-1', quantity: 1, unit_price: 100 }]
      };

      db.quotation.findUnique.mockResolvedValue(oldQuote);
      db.quotation.create.mockResolvedValue({ id: 'quote-2', version: 2 });

      await service.revise('tenant-1', 'quote-1');

      expect(db.quotation.update).toHaveBeenCalledWith({
          where: { id: 'quote-1' },
          data: { status: 'REVISED', share_token: null, share_token_at: null }
      });
      expect(db.quotation.create).toHaveBeenCalledWith(
          expect.objectContaining({
              data: expect.objectContaining({
                  share_token: null,
                  share_token_at: null,
              }),
          }),
      );
    });

    it('re-points the live short link at the new quotation id', async () => {
      const oldQuote = {
          id: 'quote-1',
          version: 1,
          status: 'SENT',
          share_token: 'tok-abc',
          share_token_at: new Date('2026-08-01'),
          items: [{ product_id: 'prod-1', quantity: 1, unit_price: 100 }]
      };

      db.quotation.findUnique.mockResolvedValue(oldQuote);
      db.quotation.create.mockResolvedValue({ id: 'quote-2', version: 2 });

      await service.revise('tenant-1', 'quote-1');

      expect(db.shortLink.updateMany).toHaveBeenCalledWith({
          where: {
              tenant_id: 'tenant-1',
              entity_type: 'QUOTATION',
              entity_id: 'quote-1',
              revoked_at: null,
          },
          data: { entity_id: 'quote-2' },
      });
    });

    it('succeeds when no live short link matches', async () => {
      const oldQuote = {
          id: 'quote-1',
          version: 1,
          status: 'SENT',
          share_token: 'tok-abc',
          share_token_at: new Date('2026-08-01'),
          items: [{ product_id: 'prod-1', quantity: 1, unit_price: 100 }]
      };

      db.quotation.findUnique.mockResolvedValue(oldQuote);
      db.quotation.create.mockResolvedValue({ id: 'quote-2', version: 2 });
      db.shortLink.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.revise('tenant-1', 'quote-1');

      expect(result).toEqual({ id: 'quote-2', version: 2 });
    });
  });

  it('convertToOrder() should pipe items to SalesOrdersService', async () => {
      const confirmedQuote = {
          id: 'quote-2',
          status: 'ACCEPTED',
          total_amount: 100,
          items: [{ product_id: 'prod-1', quantity: 1, unit_price: 100 }]
      };

      db.quotation.findUnique.mockResolvedValue(confirmedQuote);
      ordersService.create.mockResolvedValue({ id: 'order-99' });

      const result = await service.convertToOrder('tenant-1', 'user-1', 'quote-2');
      
      expect(ordersService.create).toHaveBeenCalled();
      expect(db.quotation.update).toHaveBeenCalledWith({
          where: { id: 'quote-2' },
          data: { status: 'CONVERTED' }
      });
      expect(result.id).toEqual('order-99');
  });

  it('convertToOrder() should throw if already converted', async () => {
      db.quotation.findUnique.mockResolvedValue({ status: 'CONVERTED' });
      await expect(service.convertToOrder('tenant-1', 'user-1', 'fake-id')).rejects.toThrow(BadRequestException);
  });

  it('findAll() should return all quotes for a tenant', async () => {
    db.quotation.findMany.mockResolvedValue([{ id: 'q-1' }]);
    db.quotation.count.mockResolvedValue(1);
    const res = await service.findAll('tenant-1');
    expect(db.quotation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenant_id: 'tenant-1' },
        include: { customer: true, items: { include: { product: true } } },
        orderBy: { created_at: 'desc' },
      }),
    );
    expect(res.items).toHaveLength(1);
    expect(res.total).toBe(1);
  });

  it('findOne() should return a single quote with details', async () => {
    db.quotation.findFirst.mockResolvedValue({ id: 'q-1' });
    const res = await service.findOne('tenant-1', 'q-1');
    expect(db.quotation.findFirst).toHaveBeenCalled();
    expect(res.id).toEqual('q-1');
  });

  it('updateStatus() should change status of a quote', async () => {
    db.quotation.update.mockResolvedValue({ id: 'q-1', status: 'SENT' });
    const res = await service.updateStatus('tenant-1', 'q-1', { status: 'SENT' });
    expect(db.quotation.update).toHaveBeenCalled();
    expect(res.status).toEqual('SENT');
  });

  it('update() should replace quote items and persist totals', async () => {
    db.quotation.findFirst.mockResolvedValue({
      id: 'q-1',
      status: 'DRAFT',
      items: [{ id: 'qi-1' }],
    });
    db.quotation.update.mockResolvedValue({ id: 'q-1', total_amount: 220 });

    const res = await service.update('tenant-1', 'q-1', {
      customerId: 'cust-1',
      notes: 'Updated',
      items: [{ productId: 'prod-1', quantity: 2, unitPrice: 110 }],
    });

    expect(db.quotationItem.deleteMany).toHaveBeenCalledWith({ where: { quotation_id: 'q-1' } });
    expect(db.quotation.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'q-1' },
      data: expect.objectContaining({
        customer_id: 'cust-1',
        notes: 'Updated',
        total_amount: 220,
      }),
    }));
    expect(res.id).toEqual('q-1');
  });

  it('remove() should delete draft quotations', async () => {
    db.quotation.findFirst.mockResolvedValue({ id: 'q-1', status: 'DRAFT' });

    const res = await service.remove('tenant-1', 'q-1');

    expect(db.quotationItem.deleteMany).toHaveBeenCalledWith({ where: { quotation_id: 'q-1' } });
    expect(db.quotation.deleteMany).toHaveBeenCalledWith({ where: { id: 'q-1', tenant_id: 'tenant-1' } });
    expect(res).toEqual({ deleted: true });
  });

  it('remove() should reject converted quotations', async () => {
    db.quotation.findFirst.mockResolvedValue({ id: 'q-1', status: 'CONVERTED' });

    await expect(service.remove('tenant-1', 'q-1')).rejects.toThrow(BadRequestException);
  });

  describe('share()', () => {
    it('mints a token and short link when the quotation has none yet', async () => {
      db.quotation.findFirst.mockResolvedValue({ id: 'q-1', share_token: null });
      shortLinks.createForEntity.mockResolvedValue({ code: 'abc123' });

      const result = await service.share('tenant-1', 'user-1', 'q-1');

      expect(db.quotation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'q-1' },
          data: expect.objectContaining({ share_token: expect.any(String) }),
        }),
      );
      expect(shortLinks.createForEntity).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          userId: 'user-1',
          entityType: 'QUOTATION',
          entityId: 'q-1',
        }),
      );
      expect(result).toEqual({ code: 'abc123', path: '/s/abc123' });
    });

    it('reuses an existing token instead of minting a new one (idempotent)', async () => {
      db.quotation.findFirst.mockResolvedValue({ id: 'q-1', share_token: 'existing-token' });
      shortLinks.createForEntity.mockResolvedValue({ code: 'xyz789' });

      const result = await service.share('tenant-1', 'user-1', 'q-1');

      expect(db.quotation.update).not.toHaveBeenCalled();
      expect(shortLinks.createForEntity).toHaveBeenCalledWith(
        expect.objectContaining({ targetUrl: '/q/existing-token' }),
      );
      expect(result).toEqual({ code: 'xyz789', path: '/s/xyz789' });
    });

    it('throws if the quotation does not belong to the tenant', async () => {
      db.quotation.findFirst.mockResolvedValue(null);
      await expect(service.share('tenant-1', 'user-1', 'missing')).rejects.toThrow('Quotation not found');
    });
  });

  describe('revokeShare()', () => {
    it('clears the share token', async () => {
      db.quotation.updateMany.mockResolvedValue({ count: 1 });
      const result = await service.revokeShare('tenant-1', 'q-1');
      expect(db.quotation.updateMany).toHaveBeenCalledWith({
        where: { id: 'q-1', tenant_id: 'tenant-1' },
        data: { share_token: null, share_token_at: null },
      });
      expect(result).toEqual({ success: true });
    });

    it('throws if no row matched (wrong tenant or missing quotation)', async () => {
      db.quotation.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.revokeShare('tenant-1', 'q-1')).rejects.toThrow('Quotation not found');
    });

    // Clearing the token alone left the ShortLink row alive: /s/<code> kept
    // resolving and counting clicks onto a dead /q/<token>, the tenant's own
    // shortener page still offered a Revoke button for a link that was supposedly
    // already revoked, and re-sharing minted a fresh code on top of the orphan.
    it('revokes the matching short links too', async () => {
      db.quotation.updateMany.mockResolvedValue({ count: 1 });

      await service.revokeShare('tenant-1', 'q-1');

      expect(db.shortLink.updateMany).toHaveBeenCalledWith({
        where: {
          tenant_id: 'tenant-1',
          entity_type: 'QUOTATION',
          entity_id: 'q-1',
          revoked_at: null,
        },
        data: { revoked_at: expect.any(Date) },
      });
    });

    it('leaves already-revoked short links alone rather than restamping them', async () => {
      db.quotation.updateMany.mockResolvedValue({ count: 1 });

      await service.revokeShare('tenant-1', 'q-1');

      expect(db.shortLink.updateMany.mock.calls[0][0].where.revoked_at).toBeNull();
    });

    it('does not touch short links when the quotation did not match', async () => {
      db.quotation.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.revokeShare('tenant-1', 'q-1')).rejects.toThrow('Quotation not found');
      expect(db.shortLink.updateMany).not.toHaveBeenCalled();
    });

    it('does both writes inside one transaction', async () => {
      // A half-applied revocation — token gone, short code still live and
      // counting clicks — is the state this method exists to prevent.
      db.quotation.updateMany.mockResolvedValue({ count: 1 });

      await service.revokeShare('tenant-1', 'q-1');

      expect(db.$transaction).toHaveBeenCalledTimes(1);
      const txClient = db.$transaction.mock.calls[0][0];
      expect(typeof txClient).toBe('function');
    });
  });

  describe('findByShareToken()', () => {
    it('returns the sanitized public view for a valid token', async () => {
      db.quotation.findFirst.mockResolvedValue({
        quote_number: 'Q-1',
        version: 1,
        status: 'SENT',
        created_at: new Date('2026-08-01'),
        valid_until: null,
        notes: null,
        total_amount: '100.00',
        customer: { name: 'Rahim Traders' },
        store: { name: 'Main Branch' },
        items: [{ quantity: 2, unit_price: '50.00', product: { name: 'Fan' } }],
      });

      const result = await service.findByShareToken('some-token');

      expect(db.quotation.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { share_token: 'some-token' } }),
      );
      expect(result.customer_name).toBe('Rahim Traders');
      expect(result.items[0]).toMatchObject({ product_name: 'Fan', quantity: 2, unit_price: 50, line_total: 100 });
    });

    it('throws the same not-found error whether the token is missing or revoked', async () => {
      db.quotation.findFirst.mockResolvedValue(null);
      await expect(service.findByShareToken('nonexistent')).rejects.toThrow('This link is no longer available');
    });

    it('orders line items deterministically', async () => {
      // Without an orderBy, Postgres may return rows in any order, so the same
      // customer-facing document can print its lines differently between two
      // loads — and differently from the internal page. QuotationItem has no sort
      // column, so id is the only stable option.
      db.quotation.findFirst.mockResolvedValue({
        quote_number: 'Q-1',
        version: 1,
        status: 'SENT',
        created_at: new Date('2026-08-01'),
        valid_until: null,
        notes: null,
        total_amount: '100.00',
        customer: { name: 'Rahim Traders' },
        store: { name: 'Main Branch' },
        items: [],
      });

      await service.findByShareToken('some-token');

      expect(db.quotation.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            items: expect.objectContaining({ orderBy: { id: 'asc' } }),
          }),
        }),
      );
    });
  });
});
