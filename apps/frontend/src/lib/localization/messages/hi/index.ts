import { coreMessages } from './core';
import { salesMessages } from './sales';
import { purchasesMessages } from './purchases';
import { accountingMessages } from './accounting';
import { customersMessages } from './customers';
import { inventoryExtrasMessages } from './inventoryExtras';
import { crmHrMessages } from './crmHr';
import { adminMessages } from './admin';
import { storefrontMessages } from './storefront';
import { marketingMessages } from './marketing';
import { settingsExtrasMessages } from './settingsExtras';
import { reportsMessages } from './reports';
import { componentsMessages } from './components';
import { helpMessages } from './help';
import { projectsMessages } from './projects';
import { chatMessages } from './chat';
import { accountingVouchersUiMessages } from './accountingListUi/vouchers';
import { accountingMastersUiMessages } from './accountingListUi/masters';
import { accountingFinanceUiMessages } from './accountingListUi/finance';
import { accountingBooksUiMessages } from './accountingListUi/books';
import { accountingReportsUiMessages } from './accountingListUi/reports';

export const hiMessages = {
    ...coreMessages,
    ...salesMessages,
    ...purchasesMessages,
    ...accountingMessages,
    ...customersMessages,
    ...inventoryExtrasMessages,
    ...crmHrMessages,
    ...accountingVouchersUiMessages,
    ...accountingMastersUiMessages,
    ...accountingFinanceUiMessages,
    ...accountingBooksUiMessages,
    ...accountingReportsUiMessages,
    admin: adminMessages,
    storefront: storefrontMessages,
    marketing: marketingMessages,
    settingsExtras: settingsExtrasMessages,
    reports: reportsMessages,
    components: componentsMessages,
    help: helpMessages,
    projects: projectsMessages,
    chat: chatMessages,
} as const;