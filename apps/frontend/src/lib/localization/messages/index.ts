import { arMessages } from './ar';
import { bnMessages } from './bn';
import { deMessages } from './de';
import { enMessages } from './en';
import { esMessages } from './es';
import { frMessages } from './fr';
import { hiMessages } from './hi';
import { msMessages } from './ms';
import { urMessages } from './ur';

export { type MessageDictionary } from './types';

export const messageCatalog = {
    en: enMessages,
    bn: bnMessages,
    ms: msMessages,
    hi: hiMessages,
    de: deMessages,
    fr: frMessages,
    es: esMessages,
    ur: urMessages,
    ar: arMessages,
} as const;
