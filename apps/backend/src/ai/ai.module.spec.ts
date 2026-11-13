import { MODULE_METADATA } from '@nestjs/common/constants';
import { AiModule } from './ai.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { CrmContactsModule } from '../crm-contacts/crm-contacts.module';
import { HrReportsModule } from '../hr-reports/hr-reports.module';
import { ImportsModule } from '../imports/imports.module';
import { ManufacturingModule } from '../manufacturing/manufacturing.module';
import { PayrollModule } from '../payroll/payroll.module';
import { RecruitmentModule } from '../recruitment/recruitment.module';
import { StorefrontModule } from '../storefront/storefront.module';
import { StorefrontPagesModule } from '../storefront-pages/storefront-pages.module';

function moduleImports(mod: Function): unknown[] {
    return Reflect.getMetadata(MODULE_METADATA.IMPORTS, mod) ?? [];
}

function resolveImport(entry: unknown): unknown {
    if (entry && typeof entry === 'object' && 'forwardRef' in (entry as object)) {
        return (entry as { forwardRef: () => unknown }).forwardRef();
    }
    return entry;
}

function importedConstructors(mod: Function): unknown[] {
    return moduleImports(mod).map(resolveImport);
}

describe('AiModule graph', () => {
    it('imports the Wave 2 leftover and Wave 3 report modules', () => {
        const imported = importedConstructors(AiModule);
        for (const mod of [
            StorefrontPagesModule,
            HrReportsModule,
            PayrollModule,
            RecruitmentModule,
            ApprovalsModule,
            CrmContactsModule,
        ]) {
            expect(imported).toContain(mod);
        }
    });

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

    it('keeps Storefront, Manufacturing, Imports, and CrmContacts imports defined when AuthModule loads Ai first', () => {
        jest.resetModules();
        require('../auth/auth.module');
        const mods = [
            require('../storefront/storefront.module').StorefrontModule,
            require('../manufacturing/manufacturing.module').ManufacturingModule,
            require('../imports/imports.module').ImportsModule,
            require('../crm-contacts/crm-contacts.module').CrmContactsModule,
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
