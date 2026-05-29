import { bnMessages } from './bn';
import { enMessages } from './en';
import { msMessages } from './ms';

export { type MessageDictionary } from './types';

export const messageCatalog = {
    en: enMessages,
    bn: bnMessages,
    ms: msMessages,
} as const;