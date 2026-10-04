import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { CustomFieldEntity } from '@prisma/client';
import { CustomFieldsService } from './custom-fields.service';
import { DatabaseService } from '../database/database.service';

describe('CustomFieldsService', () => {
  let service: CustomFieldsService;
  let db: any;
  const tenantId = 'tenant-1';

  beforeEach(async () => {
    jest.clearAllMocks();
    db = {
      customFieldDefinition: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({}),
      },
      $executeRaw: jest.fn().mockResolvedValue(0),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomFieldsService,
        { provide: DatabaseService, useValue: db },
      ],
    }).compile();
    service = module.get(CustomFieldsService);
  });

  it('assigns cf_ slots to new fields and caps at 10', async () => {
    await expect(
      service.saveDefinitions(tenantId, CustomFieldEntity.LEAD, {
        fields: Array.from({ length: 11 }, (_, i) => ({ label: `F${i}` })),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reuses the first inactive slot for a new field', async () => {
    db.customFieldDefinition.findMany.mockResolvedValue([
      { key: 'cf_1', label: 'Old', order: 0, is_active: false },
    ]);
    const result = await service.saveDefinitions(tenantId, CustomFieldEntity.LEAD, {
      fields: [{ label: 'Region' }],
    });
    expect(result[0].key).toBe('cf_1');
    expect(result[0].label).toBe('Region');
  });

  it('clears the old field\'s lead values from a slot reused by a new field', async () => {
    db.customFieldDefinition.findMany.mockResolvedValue([
      { key: 'cf_1', label: 'Old', order: 0, is_active: false },
    ]);
    await service.saveDefinitions(tenantId, CustomFieldEntity.LEAD, {
      fields: [{ label: 'Region' }],
    });

    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
    const [sql, ...values] = db.$executeRaw.mock.calls[0];
    expect(sql.join('?')).toContain('UPDATE "Lead"');
    expect(values).toContainEqual(['cf_1']);
    expect(values).toContain(tenantId);
    // Wiped before the slot goes live, so no read ever sees old values under the new label.
    expect(db.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      db.customFieldDefinition.upsert.mock.invocationCallOrder[0],
    );
  });

  it('keeps lead values when existing fields are only renamed or reordered', async () => {
    db.customFieldDefinition.findMany.mockResolvedValue([
      { key: 'cf_1', label: 'Region', order: 0, is_active: true },
      { key: 'cf_2', label: 'Budget', order: 1, is_active: true },
    ]);
    await service.saveDefinitions(tenantId, CustomFieldEntity.LEAD, {
      fields: [
        { key: 'cf_2', label: 'Budget (BDT)' },
        { key: 'cf_1', label: 'Region' },
      ],
    });

    expect(db.$executeRaw).not.toHaveBeenCalled();
  });

  it('sanitizeValues keeps only active keys and coerces to string', async () => {
    db.customFieldDefinition.findMany.mockResolvedValue([
      { key: 'cf_1', label: 'Region', order: 0, is_active: true },
    ]);
    const out = await service.sanitizeValues(tenantId, CustomFieldEntity.LEAD, {
      cf_1: 42,
      cf_9: 'ignored',
    });
    expect(out).toEqual({ cf_1: '42' });
  });

  it('rejects duplicate active labels', async () => {
    await expect(
      service.saveDefinitions(tenantId, CustomFieldEntity.LEAD, {
        fields: [{ label: 'Region' }, { label: 'region' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not reuse a dropped active slot for a new field and deactivates it', async () => {
    db.customFieldDefinition.findMany.mockResolvedValue([
      { key: 'cf_1', label: 'Region', order: 0, is_active: true },
      { key: 'cf_2', label: 'Old', order: 1, is_active: true },
    ]);
    const result = await service.saveDefinitions(tenantId, CustomFieldEntity.LEAD, {
      fields: [{ key: 'cf_1', label: 'Region' }, { label: 'Budget' }],
    });
    const budget = result.find((r) => r.label === 'Budget');
    expect(budget?.key).toBe('cf_3');

    const updateManyCall = db.customFieldDefinition.updateMany.mock.calls.find(
      (call: any[]) => call[0]?.where?.key?.in?.includes('cf_2'),
    );
    expect(updateManyCall).toBeDefined();
  });

  it('rejects a client-supplied key outside the cf_1..cf_10 slots', async () => {
    await expect(
      service.saveDefinitions(tenantId, CustomFieldEntity.LEAD, {
        fields: [{ key: 'bogus', label: 'X' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
