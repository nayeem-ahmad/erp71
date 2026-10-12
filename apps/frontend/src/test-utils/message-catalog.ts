import type { Locale } from '@/lib/localization/config';
import type { MessageDictionary } from '@/lib/localization/messages';
import { arMessages } from '@/lib/localization/messages/ar';
import { bnMessages } from '@/lib/localization/messages/bn';
import { deMessages } from '@/lib/localization/messages/de';
import { enMessages } from '@/lib/localization/messages/en';
import { esMessages } from '@/lib/localization/messages/es';
import { frMessages } from '@/lib/localization/messages/fr';
import { hiMessages } from '@/lib/localization/messages/hi';
import { msMessages } from '@/lib/localization/messages/ms';
import { urMessages } from '@/lib/localization/messages/ur';

/**
 * Every language's dictionary at once — for tests only.
 *
 * The app never holds more than English plus the language on screen: the rest
 * are chunks fetched on demand (`load-messages.ts`). Tests that check all
 * languages together (key parity, nav labels) are not bundled, so they import
 * the files directly from here. Importing this from app code would put every
 * language back into the bundle. Typed against `Locale` so a new language
 * fails to compile until it is listed here.
 */
export const messageCatalog: Record<Locale, MessageDictionary> = {
    en: enMessages,
    bn: bnMessages,
    ms: msMessages,
    hi: hiMessages,
    de: deMessages,
    fr: frMessages,
    es: esMessages,
    ur: urMessages,
    ar: arMessages,
};
