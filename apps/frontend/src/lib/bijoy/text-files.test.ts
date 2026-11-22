import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'node:util';
import { bijoyToUnicode, unicodeToBijoy } from './bijoy-unicode';
import { convertedFileName, decodeTextBytes, encodeUtf8WithBom, encodeWindows1252 } from './text-files';

// jsdom leaves these out; Node's are the same API.
Object.assign(globalThis, { TextDecoder: globalThis.TextDecoder ?? NodeTextDecoder, TextEncoder: globalThis.TextEncoder ?? NodeTextEncoder });

describe('Bijoy text files', () => {
    it('reads a Windows-1252 Bijoy file and converts it', () => {
        const bijoy = 'Avgvi ‡mvbvi evsjv';
        const bytes = encodeWindows1252(bijoy);
        // ‡ is 0x87 in Windows-1252: one byte, and not valid UTF-8 on its own.
        expect(bytes).toContain(0x87);
        const read = decodeTextBytes(bytes);
        expect(read.encoding).toBe('windows-1252');
        expect(bijoyToUnicode(read.text)).toBe('আমার সোনার বাংলা');
    });

    it('reads a UTF-8 file as UTF-8, with or without a BOM', () => {
        const bytes = encodeUtf8WithBom('আমার সোনার বাংলা');
        expect(decodeTextBytes(bytes)).toEqual({ text: 'আমার সোনার বাংলা', encoding: 'utf-8' });
        expect(decodeTextBytes(new NodeTextEncoder().encode('price,100')).encoding).toBe('utf-8');
    });

    it('round-trips Unicode through a Bijoy Windows-1252 file', () => {
        const bijoy = unicodeToBijoy('মোট টাকা ১২৫০');
        expect(bijoyToUnicode(decodeTextBytes(encodeWindows1252(bijoy)).text)).toBe('মোট টাকা ১২৫০');
    });

    it('names the converted file after the original', () => {
        expect(convertedFileName('price-list.csv', 'unicode')).toBe('price-list-unicode.csv');
        expect(convertedFileName('notes', 'bijoy')).toBe('notes-bijoy.txt');
    });
});
