import { BadRequestException, Injectable } from '@nestjs/common';
import { CustomFieldEntity } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import {
  CustomFieldDefinitionDto,
  SaveCustomFieldsDto,
} from './custom-fields.dto';

export const MAX_CUSTOM_FIELDS = 10;
export const CUSTOM_FIELD_SLOTS = Array.from(
  { length: MAX_CUSTOM_FIELDS },
  (_, i) => `cf_${i + 1}`,
);
const MAX_VALUE_LENGTH = 500;

@Injectable()
export class CustomFieldsService {
  constructor(private readonly db: DatabaseService) {}

  async listDefinitions(
    tenantId: string,
    entity: CustomFieldEntity,
  ): Promise<CustomFieldDefinitionDto[]> {
    const rows = await this.db.customFieldDefinition.findMany({
      where: { tenant_id: tenantId, entity, is_active: true },
      orderBy: { order: 'asc' },
    });
    return rows.map((r) => ({ key: r.key, label: r.label, order: r.order }));
  }

  async saveDefinitions(
    tenantId: string,
    entity: CustomFieldEntity,
    dto: SaveCustomFieldsDto,
  ): Promise<CustomFieldDefinitionDto[]> {
    const inputs = dto.fields.map((f) => ({
      key: f.key?.trim() || undefined,
      label: f.label.trim(),
      order: f.order,
    }));

    if (inputs.some((f) => !f.label)) {
      throw new BadRequestException('Custom field label is required.');
    }
    if (inputs.length > MAX_CUSTOM_FIELDS) {
      throw new BadRequestException(
        `A maximum of ${MAX_CUSTOM_FIELDS} custom fields is allowed.`,
      );
    }
    const seen = new Set<string>();
    for (const f of inputs) {
      const norm = f.label.toLowerCase();
      if (seen.has(norm)) {
        throw new BadRequestException(`Duplicate custom field label: ${f.label}`);
      }
      seen.add(norm);
    }
    for (const f of inputs) {
      if (f.key && !CUSTOM_FIELD_SLOTS.includes(f.key)) {
        throw new BadRequestException(`Invalid custom field key: ${f.key}`);
      }
    }

    const existing = await this.db.customFieldDefinition.findMany({
      where: { tenant_id: tenantId, entity },
    });
    const usedKeys = new Set(
      inputs.map((f) => f.key).filter((k): k is string => Boolean(k)),
    );
    const activeExistingKeys = new Set(
      existing.filter((e) => e.is_active).map((e) => e.key),
    );
    const freeSlots = CUSTOM_FIELD_SLOTS.filter(
      (s) => !usedKeys.has(s) && !activeExistingKeys.has(s),
    );

    // Assign a slot to each new (keyless) input.
    const resolved = inputs.map((f, idx) => {
      const key = f.key ?? freeSlots.shift();
      if (!key) {
        throw new BadRequestException(
          `A maximum of ${MAX_CUSTOM_FIELDS} custom fields is allowed.`,
        );
      }
      return { key, label: f.label, order: f.order ?? idx };
    });

    // Upsert active definitions; deactivate everything not in the new set.
    for (const r of resolved) {
      await this.db.customFieldDefinition.upsert({
        where: {
          tenant_id_entity_key: { tenant_id: tenantId, entity, key: r.key },
        },
        create: {
          tenant_id: tenantId,
          entity,
          key: r.key,
          label: r.label,
          order: r.order,
          is_active: true,
        },
        update: { label: r.label, order: r.order, is_active: true },
      });
    }
    const keepKeys = resolved.map((r) => r.key);
    const toDeactivate = existing
      .filter((e) => !keepKeys.includes(e.key) && e.is_active)
      .map((e) => e.key);
    if (toDeactivate.length) {
      await this.db.customFieldDefinition.updateMany({
        where: { tenant_id: tenantId, entity, key: { in: toDeactivate } },
        data: { is_active: false },
      });
    }

    return resolved
      .sort((a, b) => a.order - b.order)
      .map((r) => ({ key: r.key, label: r.label, order: r.order }));
  }

  async sanitizeValues(
    tenantId: string,
    entity: CustomFieldEntity,
    input: Record<string, unknown> | undefined,
  ): Promise<Record<string, string> | undefined> {
    if (!input || typeof input !== 'object') return undefined;
    const defs = await this.listDefinitions(tenantId, entity);
    const activeKeys = new Set(defs.map((d) => d.key));
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(input)) {
      if (!activeKeys.has(key)) continue;
      if (value === null || value === undefined) continue;
      out[key] = String(value).trim().slice(0, MAX_VALUE_LENGTH);
    }
    return Object.keys(out).length ? out : undefined;
  }
}
