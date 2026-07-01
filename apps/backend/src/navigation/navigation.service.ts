import { BadRequestException, Injectable } from '@nestjs/common';
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

const NAVIGATION_GROUP = 'navigation';

@Injectable()
export class NavigationService {
    constructor(private readonly platformSettings: PlatformSettingsService) {}

    getRegistry() {
        return { scopes: NAV_SCOPES };
    }

    async getLayout(scope: NavScope): Promise<{ scope: NavScope; layout: NavLayoutNode[]; isDefault: boolean }> {
        this.assertScope(scope);
        const key = NAV_LAYOUT_SETTING_KEYS[scope];
        const raw = await this.platformSettings.getRawValue(NAVIGATION_GROUP, key);
        const isDefault = !raw?.trim();
        const layout = parseNavLayoutJson(raw, scope);
        return { scope, layout, isDefault };
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

    private assertScope(scope: string): asserts scope is NavScope {
        if (!NAV_SCOPES.includes(scope as NavScope)) {
            throw new BadRequestException(`Invalid scope "${scope}". Valid scopes: ${NAV_SCOPES.join(', ')}`);
        }
    }
}