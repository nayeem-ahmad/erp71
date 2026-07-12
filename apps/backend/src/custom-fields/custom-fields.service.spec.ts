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
});
