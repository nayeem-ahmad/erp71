import { MODULE_METADATA } from '@nestjs/common/constants';
import { AiModule } from './ai.module';
import { ImportsModule } from '../imports/imports.module';
import { ManufacturingModule } from '../manufacturing/manufacturing.module';
import { StorefrontModule } from '../storefront/storefront.module';

function moduleImports(mod: Function): unknown[] {
    return Reflect.getMetadata(MODULE_METADATA.IMPORTS, mod) ?? [];
}

function resolveImport(entry: unknown): unknown {
    if (entry && typeof entry === 'object' && 'forwardRef' in (entry as object)) {
        return (entry as { forwardRef: () => unknown }).forwardRef();
    }
    return entry;
}

describe('AiModule graph', () => {
    it('loads Storefront, Manufacturing, and Imports without undefined Nest imports', () => {
        expect(AiModule).toBeDefined();
        for (const mod of [StorefrontModule, ManufacturingModule, ImportsModule]) {
            const imports = moduleImports(mod);
            expect(imports.length).toBeGreaterThan(0);
            for (const entry of imports) {
                expect(entry).toBeDefined();
                expect(resolveImport(entry)).toBeDefined();
            }
        }
    });

    it('keeps Storefront, Manufacturing, and Imports imports defined when AuthModule loads Ai first', () => {
        jest.resetModules();
        require('../auth/auth.module');
        const mods = [
            require('../storefront/storefront.module').StorefrontModule,
            require('../manufacturing/manufacturing.module').ManufacturingModule,
            require('../imports/imports.module').ImportsModule,
        ];
        const { MODULE_METADATA: meta } = require('@nestjs/common/constants');
        for (const mod of mods) {
            const imports: unknown[] = Reflect.getMetadata(meta.IMPORTS, mod) ?? [];
            expect(imports.length).toBeGreaterThan(0);
            for (const entry of imports) {
                expect(entry).toBeDefined();
                expect(resolveImport(entry)).toBeDefined();
            }
        }
    });
});
