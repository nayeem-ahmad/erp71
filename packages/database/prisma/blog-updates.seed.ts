import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../.env') });

import { PrismaClient } from '@prisma/client';

/**
 * Release notes for the in-app What's new feed (`/whats-new`).
 *
 * These are `BlogPost` rows with `audience: 'IN_APP'`, so they are served by
 * `GET /blog/updates` and never by the public `/blog` index — a release note is
 * written for someone who already uses the product, and reads as noise to a
 * visitor deciding whether to buy it.
 *
 * Create-once, by slug
 * --------------------
 * A post that already exists is left exactly as it is, including its status,
 * publish date and every word of its translations. Platform staff can edit
 * these in Admin → Blog, and re-running this file must not revert that edit or
 * republish something an admin deliberately unpublished. Adding a post here
 * means appending an entry to `UPDATES`; correcting a shipped one means editing
 * it in the admin UI, which is the source of truth once the row exists.
 *
 * Not part of `seed-platform.ts`, which production runs on every deploy: that
 * file is the catalog the application is *defined* by (an empty one is a broken
 * deployment), whereas these are content. Run this one deliberately:
 *
 *     npm run db:seed:blog --workspace @erp71/database
 */

type Translation = {
    locale: 'en' | 'bn';
    title: string;
    excerpt: string;
    body_md: string;
};

type Update = {
    slug: string;
    /** Dhaka wall-clock time the note went out. */
    published_at: string;
    translations: Translation[];
};

const AUTHOR_NAME = 'ERP71 Product Team';
const AUTHOR_TITLE = 'Product';

/**
 * Words in a markdown body, with the syntax that is not prose removed.
 *
 * Mirrors `readingMinutes` in apps/backend/src/blog/reading-time.ts, which is
 * what recomputes the column the moment an admin saves an edit. It is repeated
 * rather than imported because this package must not depend on the API.
 */
function readingMinutes(markdown: string): number {
    const prose = markdown
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`[^`]*`/g, ' ')
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/^\s{0,3}#{1,6}\s+/gm, '')
        .replace(/^\s{0,3}>\s?/gm, '')
        .replace(/[*_~]/g, '');
    const words = prose.split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.ceil(words / 200));
}

/**
 * Newest last. The feed orders by `published_at`, so the order here is only for
 * whoever is reading the file.
 */
export const UPDATES: Update[] = [
    {
        slug: 'crm-campaigns-from-uploaded-lists',
        published_at: '2026-08-10T11:00:00+06:00',
        translations: [
            {
                locale: 'en',
                title: 'Run a campaign from a spreadsheet',
                excerpt:
                    'CRM → Campaigns now accepts an uploaded recipient list, so you can message people who are not yet in your CRM. Upload the file, review how each row was matched to an existing customer, lead or contact, then schedule or send. Sending drains in restartable batches, a campaign can be cancelled while it is still going out, and you can see what was delivered against the list you started from.',
                body_md: [
                    '## Campaigns from an uploaded list',
                    '',
                    'Until now a campaign could only go to people already in the CRM. It can now go to a list you upload.',
                    '',
                    '### How it works',
                    '',
                    '1. **Upload** a spreadsheet of recipients. Every row is validated as it is read, so a bad phone number or a missing name is reported against its row rather than failing the file.',
                    '2. **Review the matches.** Each row is resolved against your existing customers, leads and contacts. Someone already in the CRM keeps their history instead of becoming a duplicate.',
                    '3. **Schedule or send.** Schedules are entered in your own working hours and stored as exact instants, so a campaign set for 9am goes out at 9am.',
                    '',
                    '### While it is sending',
                    '',
                    'Sending runs in batches that resume where they stopped, so a restart in the middle of a large list does not send anyone a second copy. A campaign can be cancelled while it is in flight — recipients not yet reached are simply never sent to.',
                    '',
                    'Bodies can be written as plain text or as HTML, and you choose which; plain text is escaped, so a `<` in a customer name stays a `<`.',
                ].join('\n'),
            },
            {
                locale: 'bn',
                title: 'স্প্রেডশিট থেকে ক্যাম্পেইন চালান',
                excerpt:
                    'CRM → Campaigns এখন আপলোড করা প্রাপক তালিকা নেয়, ফলে যারা এখনও আপনার CRM-এ নেই তাদেরও বার্তা পাঠানো যায়। ফাইল আপলোড করুন, প্রতিটি সারি কোন কাস্টমার, লিড বা কন্টাক্টের সঙ্গে মিলেছে তা দেখে নিন, তারপর শিডিউল করুন বা পাঠান। পাঠানো চলে ব্যাচে — মাঝপথে থেমে গেলে সেখান থেকেই আবার শুরু হয়, চলাকালীন ক্যাম্পেইন বাতিল করা যায়, এবং কে কী পেল তা তালিকার বিপরীতে দেখা যায়।',
                body_md: [
                    '## আপলোড করা তালিকা থেকে ক্যাম্পেইন',
                    '',
                    'এতদিন ক্যাম্পেইন শুধু CRM-এ থাকা লোকদের কাছেই যেত। এখন আপনার আপলোড করা তালিকাতেও যাবে।',
                    '',
                    '### যেভাবে কাজ করে',
                    '',
                    '১. **আপলোড করুন** প্রাপকদের স্প্রেডশিট। প্রতিটি সারি পড়ার সময়েই যাচাই হয়, তাই ভুল ফোন নম্বর বা নাম না থাকলে পুরো ফাইল বাতিল না হয়ে ওই সারিটিই চিহ্নিত হয়।',
                    '২. **মিল দেখে নিন।** প্রতিটি সারি আপনার বিদ্যমান কাস্টমার, লিড ও কন্টাক্টের সঙ্গে মেলানো হয়। CRM-এ আগে থেকে থাকা কেউ ডুপ্লিকেট না হয়ে নিজের ইতিহাস নিয়েই থাকে।',
                    '৩. **শিডিউল বা পাঠান।** সময় আপনার নিজের কর্মঘণ্টায় লেখা হয় এবং সঠিক মুহূর্ত হিসেবে সংরক্ষিত হয় — সকাল ৯টার ক্যাম্পেইন সকাল ৯টাতেই যায়।',
                    '',
                    '### পাঠানোর সময়',
                    '',
                    'পাঠানো ব্যাচে চলে এবং যেখানে থেমেছিল সেখান থেকেই আবার শুরু হয়, তাই বড় তালিকার মাঝপথে রিস্টার্ট হলেও কেউ দ্বিতীয়বার বার্তা পান না। চলাকালীন ক্যাম্পেইন বাতিল করা যায় — যাদের কাছে তখনও পৌঁছায়নি তাদের কাছে আর যাবে না।',
                    '',
                    'বার্তার বডি সাধারণ টেক্সট বা HTML হিসেবে লেখা যায়, আপনি বেছে নেবেন; সাধারণ টেক্সট escape করা হয়, তাই কাস্টমারের নামে `<` থাকলে সেটি `<` হিসেবেই থাকে।',
                ].join('\n'),
            },
        ],
    },
    {
        slug: 'hr-recruitment-job-posts-and-applicants',
        published_at: '2026-08-11T11:00:00+06:00',
        translations: [
            {
                locale: 'en',
                title: 'Hiring, from job post to first day',
                excerpt:
                    'HR now covers recruitment: the vacancies you are hiring for, the candidates who apply, and the pipeline between them. Someone who applies twice is one applicant with two applications, so the interviewer sees the earlier round instead of rediscovering it. Hiring a candidate creates their employee record in the same step, and a post is only marked filled once its headcount is met.',
                body_md: [
                    '## Recruitment in HR',
                    '',
                    'Job posts, applicants and applications are now part of the HR module.',
                    '',
                    '### Three things, not one list',
                    '',
                    '- A **job post** is a vacancy with a headcount. It outlives everyone who applies to it.',
                    '- An **applicant** is a person. They outlive any one application, so someone who applies again in two years arrives with their earlier round attached rather than as a stranger.',
                    '- An **application** is the thing that moves through stages, and every move is recorded — the stage says where a candidate is now, the history says how they got there.',
                    '',
                    '### Hiring',
                    '',
                    'Marking someone hired creates their employee record in the same action, so you never have a hire on one screen and no employee on the other. A post for three cashiers stays open after the first hire and is marked filled when the third lands.',
                    '',
                    '### Permissions',
                    '',
                    'Recruitment uses your existing **View HR** and **Manage HR** permissions — whoever runs employees runs hiring. Nothing to grant.',
                    '',
                    'Deletes are deliberately restricted: a post with live candidates is closed rather than deleted, and a hired application cannot be removed at all, because it is the record of how that employee joined.',
                ].join('\n'),
            },
            {
                locale: 'bn',
                title: 'নিয়োগ — বিজ্ঞপ্তি থেকে প্রথম কর্মদিবস',
                excerpt:
                    'HR-এ এখন নিয়োগ প্রক্রিয়াও আছে: যে পদগুলোতে লোক নিচ্ছেন, যারা আবেদন করছেন, এবং তাদের মাঝের ধাপগুলো। কেউ দুবার আবেদন করলে তিনি একজন আবেদনকারী, দুটি আবেদন — ফলে সাক্ষাৎকারকারী আগের রাউন্ডটি নতুন করে খুঁজে বের করেন না, সামনেই পান। কাউকে নিয়োগ দিলে একই ধাপে তার কর্মী রেকর্ড তৈরি হয়, আর পদের সংখ্যা পূর্ণ হলে তবেই বিজ্ঞপ্তিটি পূরণ হিসেবে চিহ্নিত হয়।',
                body_md: [
                    '## HR-এ নিয়োগ',
                    '',
                    'চাকরির বিজ্ঞপ্তি, আবেদনকারী ও আবেদন এখন HR মডিউলের অংশ।',
                    '',
                    '### একটি তালিকা নয়, তিনটি জিনিস',
                    '',
                    '- **চাকরির বিজ্ঞপ্তি** হলো নির্দিষ্ট সংখ্যক পদসহ একটি শূন্যপদ। যারা আবেদন করেন তাদের সবার চেয়ে এটি বেশি দিন থাকে।',
                    '- **আবেদনকারী** হলেন একজন ব্যক্তি। কোনো একক আবেদনের চেয়ে তিনি বেশি দিন থাকেন, তাই দুই বছর পর আবার আবেদন করলে তিনি অচেনা কেউ নন — আগের রাউন্ডসহ আসেন।',
                    '- **আবেদন** হলো যেটি ধাপে ধাপে এগোয়, এবং প্রতিটি পরিবর্তন রেকর্ড হয় — ধাপ বলে প্রার্থী এখন কোথায়, ইতিহাস বলে কীভাবে সেখানে পৌঁছালেন।',
                    '',
                    '### নিয়োগ',
                    '',
                    'কাউকে নিয়োগপ্রাপ্ত চিহ্নিত করলে একই কাজে তার কর্মী রেকর্ড তৈরি হয়ে যায়, ফলে এক পর্দায় নিয়োগ আর অন্য পর্দায় কর্মী নেই — এমন অবস্থা হয় না। তিনজন ক্যাশিয়ারের বিজ্ঞপ্তি প্রথম নিয়োগের পরেও খোলা থাকে, তৃতীয়জন যোগ দিলে পূরণ হিসেবে চিহ্নিত হয়।',
                    '',
                    '### অনুমতি',
                    '',
                    'নিয়োগ আপনার বিদ্যমান **View HR** ও **Manage HR** অনুমতিই ব্যবহার করে — যিনি কর্মী দেখেন, তিনিই নিয়োগ দেখেন। নতুন কিছু দিতে হবে না।',
                    '',
                    'মুছে ফেলার ক্ষেত্রে কিছু সীমা ইচ্ছাকৃত: প্রার্থী আছে এমন বিজ্ঞপ্তি মুছে না ফেলে বন্ধ করতে হয়, আর নিয়োগ সম্পন্ন হওয়া আবেদন মোটেই মোছা যায় না — কারণ ওই কর্মী কীভাবে যোগ দিলেন, সেটিই তার রেকর্ড।',
                ].join('\n'),
            },
        ],
    },
    {
        slug: 'hr-reports',
        published_at: '2026-08-20T11:00:00+06:00',
        translations: [
            {
                locale: 'en',
                title: 'Eight HR reports, in one place',
                excerpt:
                    'HR has a new Reports submenu covering attendance, leave, payroll and headcount, so the questions you used to answer by exporting and pivoting are now a page you open. Each report takes the same date range and column choices as the rest of the platform, and exports the page you are looking at or the whole result.',
                body_md: [
                    '## HR → Reports',
                    '',
                    'Eight reports have been grouped into their own submenu under HR, covering attendance and leave, payroll, and headcount.',
                    '',
                    'They behave like every other list in the platform: the same date-range filter, the same column picker, and an export that gives you either the page on screen or the full result set. Nothing new to learn.',
                ].join('\n'),
            },
            {
                locale: 'bn',
                title: 'এক জায়গায় আটটি HR রিপোর্ট',
                excerpt:
                    'HR-এ নতুন Reports সাবমেনু এসেছে — উপস্থিতি, ছুটি, বেতন ও জনবল নিয়ে। যেসব প্রশ্নের উত্তর আগে এক্সপোর্ট করে পিভট করে বের করতে হতো, সেগুলো এখন একটি পৃষ্ঠা খুললেই পাওয়া যায়। প্রতিটি রিপোর্টে প্ল্যাটফর্মের বাকি অংশের মতোই তারিখ পরিসর ও কলাম বাছাই আছে, আর এক্সপোর্টে পাওয়া যায় সামনের পৃষ্ঠা অথবা পুরো ফল।',
                body_md: [
                    '## HR → Reports',
                    '',
                    'উপস্থিতি ও ছুটি, বেতন এবং জনবল নিয়ে আটটি রিপোর্ট HR-এর নিজস্ব সাবমেনুতে একত্র করা হয়েছে।',
                    '',
                    'এগুলো প্ল্যাটফর্মের অন্য যেকোনো তালিকার মতোই আচরণ করে: একই তারিখ পরিসর ফিল্টার, একই কলাম বাছাই, আর এক্সপোর্টে সামনের পৃষ্ঠা বা পুরো ফল — যেটি চান। নতুন করে কিছু শেখার নেই।',
                ].join('\n'),
            },
        ],
    },
    {
        slug: 'proforma-invoices-on-quotations',
        published_at: '2026-08-21T10:00:00+06:00',
        translations: [
            {
                locale: 'en',
                title: 'Proforma invoices, alongside quotations',
                excerpt:
                    'A quotation can now be issued as a proforma invoice — the document a buyer takes to their bank to open an LC. It is a document kind on the quotation you already have, not a separate module, so the same lines, the same customer and the same numbering carry through. A proforma denominated in a foreign currency prints in that currency.',
                body_md: [
                    '## Proforma invoices',
                    '',
                    'Sales → Quotations can now issue a **proforma invoice**: the document an overseas buyer hands to their bank to open a letter of credit.',
                    '',
                    'It is a kind of document on the quotation rather than a module of its own. The lines, the customer and the numbering are the ones you already entered — you are choosing what to print, not re-keying an order.',
                    '',
                    'A proforma for an export sale is genuinely denominated in a foreign currency, so it prints in that currency rather than being converted to taka on the page.',
                ].join('\n'),
            },
            {
                locale: 'bn',
                title: 'কোটেশনের পাশাপাশি প্রোফর্মা ইনভয়েস',
                excerpt:
                    'কোটেশন এখন প্রোফর্মা ইনভয়েস হিসেবেও ইস্যু করা যায় — যে কাগজটি নিয়ে ক্রেতা ব্যাংকে গিয়ে LC খোলেন। এটি আলাদা মডিউল নয়, আপনার বিদ্যমান কোটেশনেরই একটি ডকুমেন্ট ধরন, তাই একই লাইন, একই ক্রেতা ও একই নম্বর বজায় থাকে। বিদেশি মুদ্রায় করা প্রোফর্মা সেই মুদ্রাতেই প্রিন্ট হয়।',
                body_md: [
                    '## প্রোফর্মা ইনভয়েস',
                    '',
                    'Sales → Quotations থেকে এখন **প্রোফর্মা ইনভয়েস** ইস্যু করা যায়: বিদেশি ক্রেতা যে কাগজ নিয়ে ব্যাংকে গিয়ে লেটার অব ক্রেডিট খোলেন।',
                    '',
                    'এটি নিজস্ব কোনো মডিউল নয়, কোটেশনের একটি ডকুমেন্ট ধরন। লাইন, ক্রেতা ও নম্বর আপনার আগেই দেওয়া — আপনি নতুন করে অর্ডার লিখছেন না, শুধু কী প্রিন্ট হবে তা বেছে নিচ্ছেন।',
                    '',
                    'রপ্তানি বিক্রির প্রোফর্মা সত্যিকার অর্থেই বিদেশি মুদ্রায় হয়, তাই পাতায় টাকায় রূপান্তর না করে সেই মুদ্রাতেই প্রিন্ট হয়।',
                ].join('\n'),
            },
        ],
    },
    {
        slug: 'lc-import-shipments-and-landed-cost',
        published_at: '2026-08-21T16:00:00+06:00',
        translations: [
            {
                locale: 'en',
                title: 'LC imports, landed cost and FX settlement',
                excerpt:
                    'Imports are now a file that stays open for the 60–150 days between committing to a foreign supplier and clearing customs, collecting bank charges, freight, customs duty and C&F fees as they are incurred. Receiving the shipment produces an ordinary purchase at landed cost, so inventory valuation, the supplier ledger and every purchase report work on it with no knowledge that the goods were imported.',
                body_md: [
                    '## Import shipments',
                    '',
                    'An import is not a purchase that takes a while — it is a file that stays open for months, accumulating charges from the bank, the shipping line, Customs and the C&F agent as they are incurred.',
                    '',
                    '### What you get',
                    '',
                    '- **A shipment file** with the LC terms, exchange rate, bill of lading and customs details, its items, its costs and its documents.',
                    '- **Costs as they arrive.** Whether a charge is capitalised into the goods or expensed is a property of the cost type, not a judgement call on each entry.',
                    '- **Allocation by weight, not only value.** Suppliers now carry country, currency, SWIFT and beneficiary details; products carry HS code, country of origin, weight and CBM. Without weight, freight can only be spread by value — which puts the freight bill on the expensive line rather than the heavy one.',
                    '- **FX settlement**, so the gain or loss between committing and paying lands where it belongs instead of quietly distorting the cost of the goods.',
                    '',
                    '### The part that matters downstream',
                    '',
                    'Receiving a shipment emits an ordinary **purchase at landed cost** rather than replacing it. Product costing, inventory movements, the supplier ledger and every purchase report then work on it exactly as they do on a local purchase. A months-long, multi-currency, many-charge process stays inside the imports module instead of leaking into the rest of your books.',
                ].join('\n'),
            },
            {
                locale: 'bn',
                title: 'LC আমদানি, ল্যান্ডেড কস্ট ও এফএক্স নিষ্পত্তি',
                excerpt:
                    'বিদেশি সরবরাহকারীকে অর্ডার দেওয়া থেকে শুরু করে পণ্য কাস্টমস ছাড়া পর্যন্ত ৬০–১৫০ দিন আমদানির ফাইলটি এখন খোলা থাকে এবং ব্যাংক চার্জ, ফ্রেইট, শুল্ক ও সিঅ্যান্ডএফ ফি যখন যেটি আসে তখনই যোগ হয়। চালান রিসিভ করলে ল্যান্ডেড কস্টে একটি সাধারণ ক্রয় তৈরি হয়, ফলে ইনভেন্টরি মূল্যায়ন, সরবরাহকারীর খতিয়ান ও ক্রয়ের প্রতিটি রিপোর্ট পণ্যটি আমদানি করা কি না তা না জেনেই স্বাভাবিকভাবে কাজ করে।',
                body_md: [
                    '## আমদানি চালান',
                    '',
                    'আমদানি এমন একটি ক্রয় নয় যেটি একটু সময় নেয় — এটি এমন একটি ফাইল যা মাসের পর মাস খোলা থাকে এবং ব্যাংক, শিপিং লাইন, কাস্টমস ও সিঅ্যান্ডএফ এজেন্টের খরচ যখন যেটি হয় তখনই জমা হয়।',
                    '',
                    '### যা পাচ্ছেন',
                    '',
                    '- **একটি চালান ফাইল** — LC শর্ত, বিনিময় হার, বিল অব লেডিং ও কাস্টমস তথ্যসহ; সঙ্গে এর আইটেম, খরচ ও কাগজপত্র।',
                    '- **খরচ যখন আসে তখনই।** কোনো খরচ পণ্যের মূল্যে যোগ হবে না ব্যয় হিসেবে যাবে — তা খরচের ধরনেই নির্ধারিত, প্রতিটি এন্ট্রিতে আলাদা করে ভাবতে হয় না।',
                    '- **ওজন ধরে বণ্টন, শুধু মূল্য ধরে নয়।** সরবরাহকারীতে এখন দেশ, মুদ্রা, SWIFT ও বেনিফিশিয়ারি তথ্য আছে; পণ্যে আছে HS কোড, উৎপত্তির দেশ, ওজন ও CBM। ওজন না থাকলে ফ্রেইট কেবল মূল্য ধরে ভাগ করা যায় — তাতে ফ্রেইটের বোঝা ভারী পণ্যের বদলে দামি পণ্যের ঘাড়ে পড়ে।',
                    '- **এফএক্স নিষ্পত্তি**, যাতে অর্ডার আর পরিশোধের মধ্যেকার লাভ-ক্ষতি নিজের জায়গায় বসে, পণ্যের খরচকে নীরবে বিকৃত না করে।',
                    '',
                    '### যেটি বাকি হিসাবের জন্য গুরুত্বপূর্ণ',
                    '',
                    'চালান রিসিভ করলে ল্যান্ডেড কস্টে একটি **সাধারণ ক্রয়** তৈরি হয়, ক্রয়ের জায়গা দখল করে না। এরপর পণ্যের কস্টিং, ইনভেন্টরি মুভমেন্ট, সরবরাহকারীর খতিয়ান ও ক্রয়ের প্রতিটি রিপোর্ট স্থানীয় ক্রয়ের মতোই কাজ করে। মাসব্যাপী, বহু-মুদ্রার, বহু-খরচের প্রক্রিয়াটি আমদানি মডিউলের ভেতরেই থাকে, আপনার বাকি হিসাবে ছড়ায় না।',
                ].join('\n'),
            },
        ],
    },
    {
        slug: 'voice-navigation-crm-projects-hr',
        published_at: '2026-08-31T11:00:00+06:00',
        translations: [
            {
                locale: 'en',
                title: 'Get to CRM, Projects and HR by voice',
                excerpt:
                    'Voice navigation now reaches the CRM, Project Management and HR pages, not just the modules it launched with. Say where you want to go and the app takes you there — useful on a phone, on a counter, and with hands that are busy doing something else.',
                body_md: [
                    '## Voice navigation reaches three more modules',
                    '',
                    'Voice navigation now covers **CRM**, **Project Management** and **HR** in addition to the modules it shipped with. Ask for a page and it opens.',
                    '',
                    'It is most useful exactly where a keyboard is not: on a phone, behind a counter, or with your hands full.',
                ].join('\n'),
            },
            {
                locale: 'bn',
                title: 'কণ্ঠস্বরেই CRM, প্রজেক্ট ও HR-এ যান',
                excerpt:
                    'ভয়েস নেভিগেশন এখন শুধু শুরুর মডিউলগুলো নয়, CRM, Project Management ও HR-এর পাতাগুলোতেও পৌঁছায়। কোথায় যেতে চান বলুন, অ্যাপ আপনাকে সেখানে নিয়ে যাবে — ফোনে, দোকানের কাউন্টারে, কিংবা হাত ব্যস্ত থাকলে বিশেষভাবে কাজে লাগে।',
                body_md: [
                    '## ভয়েস নেভিগেশন আরও তিনটি মডিউলে',
                    '',
                    'শুরুর মডিউলগুলোর পাশাপাশি ভয়েস নেভিগেশন এখন **CRM**, **Project Management** ও **HR**-ও চেনে। পাতার নাম বলুন, খুলে যাবে।',
                    '',
                    'ঠিক যেখানে কীবোর্ড নেই সেখানেই এটি সবচেয়ে কাজে লাগে: ফোনে, কাউন্টারের পেছনে, কিংবা হাত ভরা থাকলে।',
                ].join('\n'),
            },
        ],
    },
    {
        slug: 'projects-import-and-export',
        published_at: '2026-09-01T11:00:00+06:00',
        translations: [
            {
                locale: 'en',
                title: 'Import and export tasks and hour logs',
                excerpt:
                    'Tasks and Hour Logs were the two Projects pages with no spreadsheet import, and Hour Logs had no export or column choice at all. Both now use the standard importer: your file names things in words — a project by code or name, a column by name, an assignee by email — and a bad row reads as "Row 7: no project matches ACME-2" instead of a database error.',
                body_md: [
                    '## Import and export in Projects',
                    '',
                    'Tasks and Hour Logs were the last two Projects list pages without a spreadsheet import. Hour Logs had no export or column picker either. Both are fixed.',
                    '',
                    '### Files name things in words',
                    '',
                    'You do not need ids. A project is matched by code, short name or full name; a board column by name; an assignee by email or name; tags by name. When nothing matches, the error names the row and the value — `Row 7: no project matches "ACME-2"` — rather than showing a database dump.',
                    '',
                    '### Imported rows go through the normal path',
                    '',
                    'An imported task opens with the right remaining hours, activity entry and watchers. An imported hour log gets the same span arithmetic, overlap check and remaining-hours update as one you enter by hand. Duplicates are caught both against what is already saved and row-against-row inside the same file.',
                    '',
                    '### One deliberate omission',
                    '',
                    'There is no `user` column on an hour-log import. Every imported entry is recorded under the name of the person importing it, because logging time is the permission to record **your own** hours.',
                    '',
                    'Project lookups are built only from the projects you can already open, so an import cannot reach a project you cannot see.',
                ].join('\n'),
            },
            {
                locale: 'bn',
                title: 'টাস্ক ও আওয়ার লগ ইমপোর্ট-এক্সপোর্ট',
                excerpt:
                    'Projects-এর যে দুটি পাতায় স্প্রেডশিট ইমপোর্ট ছিল না সেগুলো হলো Tasks ও Hour Logs, আর Hour Logs-এ এক্সপোর্ট বা কলাম বাছাই কোনোটিই ছিল না। দুটিই এখন সাধারণ ইমপোর্টার ব্যবহার করে: আপনার ফাইল আইডি নয়, নাম দিয়ে জিনিস চেনায় — প্রজেক্ট কোড বা নামে, কলাম নামে, দায়িত্বপ্রাপ্ত ব্যক্তি ইমেইলে — আর ভুল সারি ডেটাবেস এররের বদলে পড়া যায় এভাবে: "Row 7: no project matches ACME-2"।',
                body_md: [
                    '## Projects-এ ইমপোর্ট ও এক্সপোর্ট',
                    '',
                    'স্প্রেডশিট ইমপোর্ট ছাড়া Projects-এর শেষ দুটি তালিকা ছিল Tasks ও Hour Logs। Hour Logs-এ এক্সপোর্ট বা কলাম বাছাইও ছিল না। দুটিই ঠিক করা হয়েছে।',
                    '',
                    '### ফাইল আইডি নয়, নাম চেনে',
                    '',
                    'আইডি লাগবে না। প্রজেক্ট মেলে কোড, সংক্ষিপ্ত নাম বা পূর্ণ নামে; বোর্ড কলাম নামে; দায়িত্বপ্রাপ্ত ব্যক্তি ইমেইল বা নামে; ট্যাগ নামে। কিছু না মিললে ডেটাবেসের বার্তা নয়, সারি ও মানসহ স্পষ্ট এরর আসে — `Row 7: no project matches "ACME-2"`।',
                    '',
                    '### ইমপোর্ট করা সারিও স্বাভাবিক পথেই যায়',
                    '',
                    'ইমপোর্ট করা টাস্ক সঠিক অবশিষ্ট ঘণ্টা, অ্যাক্টিভিটি এন্ট্রি ও ওয়াচারসহ তৈরি হয়। ইমপোর্ট করা আওয়ার লগ হাতে লেখা এন্ট্রির মতোই একই সময় গণনা, ওভারল্যাপ যাচাই ও অবশিষ্ট ঘণ্টার হিসাব পায়। ডুপ্লিকেট ধরা পড়ে আগে সংরক্ষিত তথ্যের সঙ্গে এবং একই ফাইলের সারিতে সারিতেও।',
                    '',
                    '### একটি ইচ্ছাকৃত বাদ',
                    '',
                    'আওয়ার লগ ইমপোর্টে `user` কলাম নেই। প্রতিটি ইমপোর্ট করা এন্ট্রি যিনি ইমপোর্ট করছেন তাঁর নামেই লেখা হয়, কারণ সময় লেখার অনুমতি মানে **নিজের** ঘণ্টা লেখার অনুমতি।',
                    '',
                    'প্রজেক্টের তালিকা কেবল আপনি যেসব প্রজেক্ট খুলতে পারেন সেগুলো থেকেই তৈরি হয়, তাই ইমপোর্ট করে এমন প্রজেক্টে পৌঁছানো যায় না যেটি আপনি দেখতে পান না।',
                ].join('\n'),
            },
        ],
    },
    {
        slug: 'crm-activity-heatmap',
        published_at: '2026-09-02T11:00:00+06:00',
        translations: [
            {
                locale: 'en',
                title: 'A month of CRM activity, at a glance',
                excerpt:
                    'CRM Overview has a new two-band heatmap showing activity day by day, so a quiet week is visible before it becomes a quiet month. Working a lead now counts as activity too, not only contacting one — the days your team spent qualifying and researching no longer read as empty.',
                body_md: [
                    '## Activity heatmap on CRM Overview',
                    '',
                    'CRM Overview now opens with a two-band heatmap of activity, day by day. A slow patch shows up as a gap you can see rather than a number you have to go looking for.',
                    '',
                    '### What counts as activity changed',
                    '',
                    'Previously only contacting a lead counted. Working one — qualifying, researching, updating — did not, which made genuinely busy days look empty. Both count now, and the heatmap reflects the work your team actually did.',
                ].join('\n'),
            },
            {
                locale: 'bn',
                title: 'এক নজরে পুরো মাসের CRM কার্যক্রম',
                excerpt:
                    'CRM Overview-তে নতুন দুই-স্তরের হিটম্যাপ এসেছে যা দিন ধরে কার্যক্রম দেখায়, ফলে নিস্তেজ সপ্তাহ নিস্তেজ মাস হয়ে ওঠার আগেই চোখে পড়ে। এখন শুধু লিডে যোগাযোগ নয়, লিড নিয়ে কাজ করাও কার্যক্রম হিসেবে গণ্য হয় — তাই কোয়ালিফাই ও অনুসন্ধানে কাটানো দিনগুলো আর ফাঁকা দেখায় না।',
                body_md: [
                    '## CRM Overview-তে অ্যাক্টিভিটি হিটম্যাপ',
                    '',
                    'CRM Overview এখন শুরু হয় দিন-ভিত্তিক দুই-স্তরের অ্যাক্টিভিটি হিটম্যাপ দিয়ে। ধীর সময়টা খুঁজে বের করার মতো সংখ্যা নয়, চোখে পড়ার মতো ফাঁক হিসেবেই দেখা যায়।',
                    '',
                    '### কী কার্যক্রম হিসেবে গণ্য, তা বদলেছে',
                    '',
                    'আগে কেবল লিডে যোগাযোগ করাই গণ্য হতো। লিড নিয়ে কাজ করা — কোয়ালিফাই করা, খোঁজখবর নেওয়া, হালনাগাদ করা — গণ্য হতো না, ফলে সত্যিকারের ব্যস্ত দিনও ফাঁকা দেখাত। এখন দুটিই গণ্য হয়, আর হিটম্যাপে আপনার দল আসলে যে কাজটি করেছে তা-ই দেখা যায়।',
                ].join('\n'),
            },
        ],
    },
    {
        slug: 'tenant-timezone-day-boundaries',
        published_at: '2026-09-02T17:00:00+06:00',
        translations: [
            {
                locale: 'en',
                title: 'Your day now starts at midnight where you are',
                excerpt:
                    'Every "today" window, date filter and report bucket is now measured in your workspace\'s own timezone, set from Settings and defaulting to Asia/Dhaka. Before this, the day ran 6am to 6am for a Dhaka shop: "due today" listed tomorrow\'s early follow-ups and called this morning\'s overdue, and an 8pm follow-up was saved onto the next calendar day. Both are fixed, and nothing changes for a workspace already on Dhaka time.',
                body_md: [
                    '## Days are measured in your timezone',
                    '',
                    'Every window the platform calls "today" — CRM due-today and overdue, the summary tiles beside them, your actions for today, follow-ups, the conversations week count, and all seven module dashboards — was resolved in the server\'s timezone, which is UTC.',
                    '',
                    'For a shop in Dhaka that meant the day ran from 6am to 6am. **Due today** listed tomorrow morning\'s follow-ups and marked this morning\'s as overdue.',
                    '',
                    '### The write side was worse',
                    '',
                    'A follow-up entered as 8pm was stored as 2am the following day — the wrong calendar day before any filter ran. That is fixed too.',
                    '',
                    '### What you need to do',
                    '',
                    'Nothing, unless you are outside Bangladesh. Your workspace has a **timezone** setting that defaults to `Asia/Dhaka`, which is exactly what the code assumed before, so no existing workspace\'s numbers move. Set it if you operate somewhere else.',
                    '',
                    'It is stored as a zone name rather than a fixed offset, so daylight saving is handled properly — a 23- or 25-hour day is still one day.',
                ].join('\n'),
            },
            {
                locale: 'bn',
                title: 'আপনার দিন এখন আপনার মধ্যরাত থেকেই শুরু',
                excerpt:
                    'প্রতিটি "আজ"-এর হিসাব, তারিখ ফিল্টার ও রিপোর্টের ভাগ এখন আপনার ওয়ার্কস্পেসের নিজস্ব টাইমজোনে মাপা হয় — সেটিংস থেকে নির্ধারিত, ডিফল্ট Asia/Dhaka। এর আগে ঢাকার দোকানের দিন চলত ভোর ৬টা থেকে ভোর ৬টা: "আজকের কাজ"-এ আগামীকাল সকালের ফলোআপ দেখাত আর আজ সকালেরটিকে বিলম্বিত বলত, আবার রাত ৮টার ফলোআপ পরদিনের তারিখে সংরক্ষিত হতো। দুটিই ঠিক হয়েছে, আর যারা আগে থেকেই ঢাকার সময়ে আছেন তাদের কিছুই বদলাচ্ছে না।',
                body_md: [
                    '## দিন এখন আপনার টাইমজোনে মাপা হয়',
                    '',
                    'প্ল্যাটফর্ম যেটিকে "আজ" বলে — CRM-এর আজকের ও বিলম্বিত কাজ, পাশের সারাংশ টাইল, আপনার আজকের কাজ, ফলোআপ, কথোপকথনের সাপ্তাহিক গণনা এবং সাতটি মডিউল ড্যাশবোর্ড — তার প্রতিটি হিসাব হতো সার্ভারের টাইমজোনে, অর্থাৎ UTC-তে।',
                    '',
                    'ঢাকার একটি দোকানের জন্য এর মানে দাঁড়াত, দিন চলছে ভোর ৬টা থেকে ভোর ৬টা। **আজকের কাজ**-এ আগামীকাল সকালের ফলোআপ দেখাত, আর আজ সকালেরটি বিলম্বিত হিসেবে চিহ্নিত হতো।',
                    '',
                    '### লেখার দিকটি ছিল আরও গুরুতর',
                    '',
                    'রাত ৮টা লিখে দেওয়া ফলোআপ সংরক্ষিত হতো পরদিন রাত ২টায় — কোনো ফিল্টার চলার আগেই ভুল তারিখে। সেটিও ঠিক হয়েছে।',
                    '',
                    '### আপনাকে যা করতে হবে',
                    '',
                    'বাংলাদেশের বাইরে না থাকলে কিছুই না। আপনার ওয়ার্কস্পেসে একটি **টাইমজোন** সেটিং যুক্ত হয়েছে, যার ডিফল্ট `Asia/Dhaka` — আগে কোডে ঠিক এটিই ধরে নেওয়া হতো, তাই বিদ্যমান কোনো ওয়ার্কস্পেসের হিসাব বদলাবে না। অন্য কোথাও কাজ করলে সেটি বেছে নিন।',
                    '',
                    'এটি নির্দিষ্ট অফসেট নয়, জোনের নাম হিসেবে রাখা হয়, তাই ডেলাইট সেভিং ঠিকভাবে সামলানো হয় — ২৩ বা ২৫ ঘণ্টার দিনও একটি দিনই থাকে।',
                ].join('\n'),
            },
        ],
    },
];

/**
 * Insert any note in `UPDATES` that does not already exist, published.
 *
 * Returns the slugs it created, so the caller can say what happened rather than
 * claiming to have seeded rows that were already there.
 */
export async function seedBlogUpdates(prisma: PrismaClient): Promise<string[]> {
    const existing = await prisma.blogPost.findMany({
        where: { slug: { in: UPDATES.map((u) => u.slug) } },
        select: { slug: true },
    });
    const known = new Set(existing.map((row) => row.slug));

    const created: string[] = [];

    for (const update of UPDATES) {
        if (known.has(update.slug)) continue;

        const english = update.translations.find((t) => t.locale === 'en');
        if (!english) throw new Error(`Update "${update.slug}" has no English translation`);

        const post = await prisma.blogPost.create({
            data: {
                slug: update.slug,
                status: 'PUBLISHED',
                // Release notes are for people already inside the product; the
                // public /blog index is a different audience.
                audience: 'IN_APP',
                author_name: AUTHOR_NAME,
                author_title: AUTHOR_TITLE,
                published_at: new Date(update.published_at),
                reading_minutes: readingMinutes(english.body_md),
                translations: {
                    create: update.translations.map((t) => ({
                        locale: t.locale,
                        title: t.title,
                        excerpt: t.excerpt,
                        body_md: t.body_md,
                    })),
                },
            },
        });

        // The slug history is what makes a later rename redirect instead of
        // 404, and it is only ever written on create.
        await prisma.blogPostSlug.create({ data: { post_id: post.id, slug: update.slug } });
        created.push(update.slug);
    }

    return created;
}

if (require.main === module) {
    const prisma = new PrismaClient();

    seedBlogUpdates(prisma)
        .then((created) => {
            if (created.length === 0) {
                console.log(`✅  What's new: all ${UPDATES.length} notes already present, nothing changed`);
            } else {
                console.log(`✅  What's new: published ${created.length} note(s) — ${created.join(', ')}`);
            }
        })
        .catch((e) => {
            console.error(e);
            process.exit(1);
        })
        .finally(async () => {
            await prisma.$disconnect();
        });
}
