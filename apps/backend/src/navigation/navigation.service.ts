import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
    getDefaultNavLayout,
    NAV_LAYOUT_SETTING_KEYS,
    NavScope,
    NAV_SCOPES,
    navLayoutSchema,
    parseNavLayoutJson,
    validateNavLayout,
    type NavLayoutNode,
} from '@erp71/shared-types';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { DatabaseService } from '../database/database.service';

const NAVIGATION_GROUP = 'navigation';

export type NavLayoutSource = 'tenant_custom' | 'tenant_default_pin' | 'platform' | 'code_default';

export type NavLayoutResponse = {
    scope: NavScope;
    layout: NavLayoutNode[];
    isDefault: boolean;
    source: NavLayoutSource;
    tenantId?: string;
};

export type TenantNavOverrideSummary = {
    tenantId: string;
    tenantName: string;
    kind: 'custom' | 'pinned_default';
    updatedAt: string;
    updatedBy: string | null;
};

@Injectable()
export class NavigationService {
    constructor(
        private readonly platformSettings: PlatformSettingsService,
        private readonly db: DatabaseService,
    ) {}

    getRegistry() {
        return { scopes: NAV_SCOPES };
    }

    async getLayout(scope: NavScope, tenantId?: string): Promise<NavLayoutResponse> {
        this.assertScope(scope);
        if (scope === NavScope.PLATFORM_ADMIN) {
            return this.getPlatformScopedLayout(scope);
        }
        return this.resolveTenantSidebarLayout(tenantId);
    }

    async saveLayout(scope: NavScope, layout: NavLayoutNode[], updatedBy?: string): Promise<NavLayoutNode[]> {
        this.assertScope(scope);
        const parsed = navLayoutSchema.parse(layout) as NavLayoutNode[];
        const validation = validateNavLayout(parsed);
        if (validation.valid === false) {
            throw new BadRequestException({
                message: 'Invalid navigation layout',
                errors: validation.errors,
            });
        }

        const key = NAV_LAYOUT_SETTING_KEYS[scope];
        await this.platformSettings.upsertSettings(
            NAVIGATION_GROUP,
            { [key]: JSON.stringify(parsed) },
            updatedBy,
        );
        return parsed;
    }

    async resetLayout(scope: NavScope, updatedBy?: string): Promise<NavLayoutNode[]> {
        this.assertScope(scope);
        const defaults = getDefaultNavLayout(scope);
        return this.saveLayout(scope, defaults, updatedBy);
    }

    async listTenantNavOverrides(): Promise<TenantNavOverrideSummary[]> {
        const rows = await this.db.tenantNavLayout.findMany({
            include: { tenant: { select: { name: true } } },
            orderBy: { updated_at: 'desc' },
        });

        return rows.map((row) => ({
            tenantId: row.tenant_id,
            tenantName: row.tenant.name,
            kind: row.layout === null ? 'pinned_default' : 'custom',
            updatedAt: row.updated_at.toISOString(),
            updatedBy: row.updated_by,
        }));
    }

    async getTenantNavOverride(tenantId: string): Promise<{
        tenantId: string;
        hasOverride: boolean;
        kind: 'none' | 'custom' | 'pinned_default';
        layout: NavLayoutNode[] | null;
        effective: NavLayoutResponse;
    }> {
        await this.assertTenantExists(tenantId);
        const override = await this.db.tenantNavLayout.findUnique({ where: { tenant_id: tenantId } });
        const effective = await this.resolveTenantSidebarLayout(tenantId);

        if (!override) {
            return {
                tenantId,
                hasOverride: false,
                kind: 'none',
                layout: null,
                effective,
            };
        }

        const layout = override.layout
            ? navLayoutSchema.parse(override.layout) as NavLayoutNode[]
            : null;

        return {
            tenantId,
            hasOverride: true,
            kind: layout ? 'custom' : 'pinned_default',
            layout,
            effective,
        };
    }

    async resetTenantNavLayout(tenantId: string, updatedBy?: string): Promise<NavLayoutResponse> {
        await this.assertTenantExists(tenantId);
        await this.db.tenantNavLayout.upsert({
            where: { tenant_id: tenantId },
            create: {
                tenant_id: tenantId,
                layout: null,
                updated_by: updatedBy ?? null,
            },
            update: {
                layout: null,
                updated_by: updatedBy ?? null,
            },
        });
        return this.resolveTenantSidebarLayout(tenantId);
    }

    async resetAllTenantNavLayouts(updatedBy?: string): Promise<{ resetCount: number }> {
        void updatedBy;
        const result = await this.db.tenantNavLayout.deleteMany();
        return { resetCount: result.count };
    }

    private async getPlatformScopedLayout(scope: NavScope): Promise<NavLayoutResponse> {
        const key = NAV_LAYOUT_SETTING_KEYS[scope];
        const raw = await this.platformSettings.getRawValue(NAVIGATION_GROUP, key);
        const isDefault = !raw?.trim();
        const layout = parseNavLayoutJson(raw, scope);
        return {
            scope,
            layout,
            isDefault,
            source: isDefault ? 'code_default' : 'platform',
        };
    }

    private async resolveTenantSidebarLayout(tenantId?: string): Promise<NavLayoutResponse> {
        const scope = NavScope.TENANT;

        if (tenantId) {
            const override = await this.db.tenantNavLayout.findUnique({
                where: { tenant_id: tenantId },
            });

            if (override) {
                if (override.layout === null) {
                    return {
                        scope,
                        layout: getDefaultNavLayout(scope),
                        isDefault: true,
                        source: 'tenant_default_pin',
                        tenantId,
                    };
                }

                const parsed = navLayoutSchema.parse(override.layout) as NavLayoutNode[];
                const validation = validateNavLayout(parsed);
                if (validation.valid) {
                    return {
                        scope,
                        layout: parsed,
                        isDefault: false,
                        source: 'tenant_custom',
                        tenantId,
                    };
                }
            }
        }

        const platform = await this.getPlatformScopedLayout(scope);
        return {
            ...platform,
            tenantId,
        };
    }

    private async assertTenantExists(tenantId: string) {
        const tenant = await this.db.tenant.findFirst({
            where: { id: tenantId, deleted_at: null },
            select: { id: true },
        });
        if (!tenant) {
            throw new NotFoundException(`Tenant "${tenantId}" not found`);
        }
    }

    private assertScope(scope: string): asserts scope is NavScope {
        if (!NAV_SCOPES.includes(scope as NavScope)) {
            throw new BadRequestException(`Invalid scope "${scope}". Valid scopes: ${NAV_SCOPES.join(', ')}`);
        }
    }
}