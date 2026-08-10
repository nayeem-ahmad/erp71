import { renderCampaignBody } from './campaign-body.util';

describe('renderCampaignBody', () => {
    it('escapes HTML and converts newlines when the format is TEXT', () => {
        expect(renderCampaignBody('Hi <b>you</b>\nBye & thanks', 'TEXT')).toBe(
            'Hi &lt;b&gt;you&lt;/b&gt;<br>Bye &amp; thanks',
        );
    });

    it('escapes quotes so an address cannot break out of an attribute', () => {
        expect(renderCampaignBody(`He said "hi" to O'Brien`, 'TEXT')).toBe(
            'He said &quot;hi&quot; to O&#39;Brien',
        );
    });

    it('normalises CRLF to a single break', () => {
        expect(renderCampaignBody('one\r\ntwo', 'TEXT')).toBe('one<br>two');
    });

    it('passes the message through untouched when the format is HTML', () => {
        expect(renderCampaignBody('<p>Hi <b>you</b></p>', 'HTML')).toBe('<p>Hi <b>you</b></p>');
    });

    it('treats an unknown or missing format as TEXT', () => {
        expect(renderCampaignBody('a & b', null)).toBe('a &amp; b');
        expect(renderCampaignBody('a & b', 'WHATEVER')).toBe('a &amp; b');
    });
});
