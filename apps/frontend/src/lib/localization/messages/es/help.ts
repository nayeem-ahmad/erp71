export const helpMessages = {
    title: 'Help Center',
    description: 'Frequently asked questions and guides',
    quickLinks: {
        emailSupport: {
            title: 'Email Support',
            subtitle: 'support@erp71.com',
        },
        contact: {
            title: 'Contact Us',
            subtitle: 'Send a message',
        },
        status: {
            title: 'System Status',
            subtitle: 'Platform admin — live health dashboard',
        },
    },
    footerPrefix: 'Can\'t find what you\'re looking for?',
    footerLink: 'Contact our support team',
    sections: {
        gettingStarted: {
            title: 'Getting Started',
            icon: '🚀',
            faqs: [
                {
                    q: 'How do I add my first product?',
                    a: 'Go to Inventory → Products and click "New Product". A name and selling price are all that\'s required; SKU, category, brand, reorder level, and opening stock are optional. To load many at once use "Import CSV" — the template columns are name, sku, barcode, selling_price, cost_price, stock_quantity, reorder_point, unit. Rows whose SKU already exists are skipped, so import adds new products rather than updating existing ones.',
                },
                {
                    q: 'How do I start selling?',
                    a: 'Open Sales → Point of Sale, tap products to build the cart, optionally attach a customer, take payment (Cash, bKash, or Card — you can split across all three), and confirm. Set up your store and warehouses first, under Settings and Inventory, so stock is tracked in the right place.',
                },
                {
                    q: 'How do I invite staff and control what they can do?',
                    a: 'Go to Team (Settings → Team) and invite a member by email; they join through an invitation link. Assign a role — OWNER, MANAGER, CASHIER, or ACCOUNTANT, or a custom role you define — to control which modules and actions they can use. Inviting members requires the owner account or the "Manage Users" permission.',
                },
                {
                    q: 'Which subscription plans are available?',
                    a: 'The self-serve paid plans are BASIC, ACCOUNTING, and STANDARD; PREMIUM — which unlocks CRM, Manufacturing, and the AI assistant — is shown as "coming soon". The old Free plan is no longer offered for new sign-ups. Compare and switch plans anytime under Billing.',
                },
            ],
        },
        pos: {
            title: 'Point of Sale (POS)',
            icon: '🛒',
            faqs: [
                {
                    q: 'How does the offline POS work?',
                    a: 'The Point of Sale keeps working when the internet drops. A yellow banner appears, products you\'ve already loaded stay browsable, and each sale is saved on your device instead of the server. When you reconnect, press "Sync Now" (or just wait) and the pending sales upload automatically.',
                },
                {
                    q: 'Can I take more than one payment method in a single sale?',
                    a: 'Yes. The checkout dialog has separate Cash, bKash, and Credit Card fields and adds them up, so one sale can be split across all three. (Nagad and bank transfer are recognised by the accounting engine but are not tender buttons on the POS screen itself.)',
                },
                {
                    q: 'How do discounts work at the till?',
                    a: 'The POS applies discounts two ways: enter a valid Discount Code and press Apply, or redeem a customer\'s loyalty points toward the total. There is no free-form percentage or fixed-amount box on the POS itself — set up codes under Settings → Discount Codes.',
                },
                {
                    q: 'What is printed on the receipt?',
                    a: 'After a sale you can print an 80mm thermal receipt showing your store name, invoice number, date, item lines, subtotal, tax, total, the payments taken, any change or balance due, and a QR code to verify the invoice. Note that POS receipts do not currently print a BIN or a VAT breakdown.',
                },
            ],
        },
        sales: {
            title: 'Sales, Returns & Customers',
            icon: '🧾',
            faqs: [
                {
                    q: 'Where do I see and search past sales?',
                    a: 'Go to Sales → Sales for the full list. It pages against the server, so it stays fast even with thousands of invoices. Search by serial number, customer, or reference, filter by status (Draft, Completed, Refunded, Partial refund), and open any row to view, edit, or delete it.',
                },
                {
                    q: 'How do I record a customer return or refund?',
                    a: 'Open Sales → Sales Returns → "Process Return", type the original sale\'s serial (e.g. S-00001) and press Find, then choose the items and quantities to return. The refund is priced from the original sale and can\'t exceed what was sold, returned stock goes back into inventory, and the refund follows how the customer paid — cash back for a paid sale, or a reduction of the due balance for a credit sale.',
                },
                {
                    q: 'How do I sell on credit and track what customers owe?',
                    a: 'Add customers under Sales → Customers. To sell on credit, the customer must have a Credit Limit set — otherwise the sale is blocked, and a credit sale that would exceed the limit is also refused. Each customer\'s detail page shows their due balance and a credit ledger where you can record payments.',
                },
                {
                    q: 'Where do I manage customer payments and overdue balances?',
                    a: 'Use Sales → Customer Payments to record money received against balances, Sales → Customer Ledger for a running statement per customer, and the Due Aging report (under Sales → Customers) to see who owes what and for how long.',
                },
            ],
        },
        inventory: {
            title: 'Inventory Management',
            icon: '📦',
            faqs: [
                {
                    q: 'How do I track stock across multiple warehouses?',
                    a: 'Create warehouses in the Inventory setup and pick defaults per flow under Inventory → Inventory Settings. Stock is held per warehouse; move it with Inventory → Transfers, a two-step send-then-receive flow where sending reduces the source, receiving increases the destination, and partial receipts are allowed.',
                },
                {
                    q: 'How do low-stock alerts work?',
                    a: 'Set a Reorder Level on each product (or a default in Inventory Settings). Every morning at 07:00 the system checks on-hand quantities and, for anything at or below its reorder level, emails the account owner, raises an in-app notification, and — if low-stock SMS is enabled — texts the owner. Inventory → Reorder Report lists everything below its level on demand.',
                },
                {
                    q: 'How do I import many products at once?',
                    a: 'Go to Inventory → Products → "Import CSV" and upload the template (columns: name, sku, barcode, selling_price, cost_price, stock_quantity, reorder_point, unit). Selling price is required on each row, an opening stock quantity creates an initial-stock movement, and rows whose SKU already exists are skipped — so use import to add new products, not to update existing ones.',
                },
                {
                    q: 'What is a stock take, and when does it need approval?',
                    a: 'A stock take (Inventory → Stock Takes) counts physical stock against the system. Starting a session snapshots the expected quantity for every product in the chosen warehouse; you enter counted quantities and each variance is calculated. If the largest variance exceeds the discrepancy threshold (25 by default, set in Inventory Settings) the session must be reviewed before it can be posted, and posting adjusts stock and records an accounting voucher.',
                },
            ],
        },
        purchases: {
            title: 'Purchases & Suppliers',
            icon: '🚚',
            faqs: [
                {
                    q: 'How do I record a purchase from a supplier?',
                    a: 'Go to Purchase → Purchases and create one: pick the store/warehouse and supplier (or add one inline) and add product lines with quantity and unit cost, plus optional tax, discount, and freight. Saving the purchase receives the goods immediately (stock goes up) and books the full amount as a payable — there is no cash field, so record any payment separately as a Supplier Payment.',
                },
                {
                    q: 'What is the difference between a Purchase Order and a Purchase?',
                    a: 'A Purchase Order (Purchase → Purchase Orders) is a commitment that does not move stock. When you mark it Received it then increases stock and posts the payable, just like a direct purchase. Use POs when you order ahead of delivery, and a direct Purchase when the goods arrive at the same time.',
                },
                {
                    q: 'How do I return goods to a supplier?',
                    a: 'Use Purchase → Purchase Returns. A return can be linked to a purchase or stand alone; it reduces stock, lowers the supplier\'s due balance (capped at what you currently owe), and posts the matching accounting voucher.',
                },
                {
                    q: 'How do I pay suppliers and see what I owe?',
                    a: 'Record payments under Purchase → Supplier Payment — you can pay or receive, allocate a payment across specific bills, and leave any remainder as an advance to allocate later. Purchase → Supplier Ledger shows each supplier\'s running balance, and every supplier also has a billing summary and credit ledger.',
                },
            ],
        },
        accounting: {
            title: 'Accounting',
            icon: '📊',
            faqs: [
                {
                    q: 'Do I have to post journal entries myself?',
                    a: 'No — the system keeps double-entry books automatically. Posting Rules (Accounting → Posting Rules) map each operational event (sale, purchase, return, transfer, salary, adjustment) to the accounts to debit and credit, and vouchers are generated as those events happen. You only make manual entries for things the rules don\'t cover.',
                },
                {
                    q: 'What is the Chart of Accounts?',
                    a: 'The Chart of Accounts (Accounting → Chart of Accounts) is the master list of your ledger accounts — assets, liabilities, equity, revenue, and expenses — organised into groups and subgroups. Every voucher line posts to one of these accounts, so it underpins all your reports.',
                },
                {
                    q: 'Can I make manual entries, and what reports are available?',
                    a: 'Yes — Accounting → Voucher Entry records cash, bank, transfer, and journal vouchers by hand, and the Vouchers, Journal, and Ledger screens let you review them. Reports include Trial Balance, Profit & Loss, Balance Sheet, Cashbook, Bankbook, AR/AP Aging, and a VAT/Tax report; Fiscal Periods can lock closed months to prevent back-dated entries.',
                },
                {
                    q: 'How do I export to Tally or QuickBooks?',
                    a: 'On the Accounting overview page click "Export", choose Tally XML or QuickBooks IIF, pick a date range, and download. The file imports directly into that accounting package.',
                },
            ],
        },
        crm: {
            title: 'CRM & Leads',
            icon: '🤝',
            faqs: [
                {
                    q: 'What does the CRM module include, and who can use it?',
                    a: 'CRM covers Leads, Conversations, Follow-ups, Campaigns, and Customers, plus settings for Lead Sources & Categories and Custom Fields, all reached from the CRM overview hub. Most of it is a Premium-plan feature — on other plans you still get Customers, but the pipeline tools are hidden.',
                },
                {
                    q: 'How do I create and work a lead?',
                    a: 'Go to CRM → Leads → "New Lead" and enter at least a name (mobile, email, source, category, priority, status, social links, and a next step are optional). A lead moves through fixed stages — New, Contacted, Qualified, Lost, Converted — and you assign it with the "Next Step Assigned To" person; the list also supports bulk assign and status changes. When you\'re ready, "Convert to Customer" creates or links the customer in Sales.',
                },
                {
                    q: 'Where do the Source and Category lists come from?',
                    a: 'They are your own master data — manage them under CRM → Sources & Categories. Each Source also carries a score weight (0–25) that feeds the automatic lead score. You can add, edit, hide, or delete values; deleting one that is in use asks you to move those leads to a replacement, and built-in values are hidden rather than removed.',
                },
                {
                    q: 'How do Follow-ups and Conversations work?',
                    a: 'Follow-ups (CRM → Follow-ups) are a single queue of reminders — General, Collection, Birthday, or Reorder — created from a customer\'s or a lead\'s detail page, with Birthday and Reorder reminders also generated automatically. Conversations (CRM → Conversations) is a read-only, filterable log of every touchpoint (call, SMS, WhatsApp, visit, and so on) recorded against leads across your whole team; you log a new one from the lead\'s detail page.',
                },
            ],
        },
        manufacturing: {
            title: 'Manufacturing',
            icon: '🏭',
            faqs: [
                {
                    q: 'How do I set up a product recipe (BOM)?',
                    a: 'On the Manufacturing page, open the Bill of Materials tab and click "New BOM". A recipe names an output product, how many units one run produces, and its component products with quantities. Components are entered by product ID, and a recipe\'s output product cannot be changed once created. Manufacturing is a Premium/add-on feature.',
                },
                {
                    q: 'How does a production job affect stock?',
                    a: 'In the Production Jobs tab, create a job from a BOM and a run quantity; it starts as a draft. Starting it re-checks that components are in stock, and completing it consumes the component stock (plus any wastage you enter) and adds the finished goods to inventory. Manufacturing moves inventory only — it does not post to the general ledger.',
                },
                {
                    q: 'How is job cost and selling price calculated?',
                    a: 'On completion, material cost is snapshotted from each component\'s latest cost, and you can add further cost lines (labour, printing, transport, overhead, and so on), optionally drawn from a service purchase bill. The job then shows a total cost and cost per unit, and for completed jobs a Pricing panel suggests a cost-plus sale price you can apply to the product.',
                },
            ],
        },
        hr: {
            title: 'HR & Payroll',
            icon: '👥',
            faqs: [
                {
                    q: 'How do I add employees?',
                    a: 'Go to HR → Employees → "New Employee" and enter at least a name and phone (email, joining date, national ID, department, designation, and basic salary are optional), or bulk-add with the Import dialog. An employee code is generated automatically, and you can link an employee to a system login so they can sign in.',
                },
                {
                    q: 'How are attendance and leave handled?',
                    a: 'HR → Attendance records one entry per employee per day — Present, Absent, Half-day, or Holiday, with optional clock-in/out times — entered manually, as there is no clock device. HR → Leaves has two tabs: Requests (submit, then approve or reject) and Types (define a leave type and its days per year).',
                },
                {
                    q: 'How do I pay salaries?',
                    a: 'Use HR → Salary Payments → "Pay Salary", pick the employee and pay period, and record the amount (pre-filled from their basic salary) and method. Each payment posts an accounting voucher (debit Salary Payable, credit the payment account). Payments are single flat amounts — there are no payslips or allowance/deduction breakdowns yet.',
                },
            ],
        },
        aiAssistant: {
            title: 'AI Assistant',
            icon: '🤖',
            faqs: [
                {
                    q: 'What is the AI business assistant and how do I open it?',
                    a: 'It is a chat panel — the "Ask the business assistant" robot icon — that answers questions about your own data: sales, stock, customers, receivables, and more. It is strictly read-only: it can look things up and explain them, but it cannot change anything. The assistant is a Premium-plan feature, so the icon only appears when your plan includes it.',
                },
                {
                    q: 'What can it actually see, and can I trust the answers?',
                    a: 'Ask "what can you do?" and it reports your branches, how far back your records go, and which tools it can use — so an empty answer means an empty period, not a broken query. Every answer lists its Sources (the exact reports and date ranges it used) so you can verify it. You can also ask it to check for unusual transactions — sales below cost, duplicate invoices, big price outliers — and it will tell you if any check could not complete rather than implying all is clean.',
                },
                {
                    q: 'What are AI credits and how do I get more?',
                    a: 'AI credits are a monthly allowance included with your plan (1 credit = 1,000 tokens), used by the assistant and other AI features; view them under AI Credits. They reset each billing period and can\'t be bought separately — you get a larger allowance by upgrading (BASIC includes 100/month, STANDARD 500). These are different from SMS credits, which are prepaid and purchasable.',
                },
                {
                    q: 'Can I speak a question instead of typing?',
                    a: 'Yes — if your browser supports it (Chrome, Edge or Safari on HTTPS), a microphone appears next to Send. Tap it, speak your question, then edit the text if needed and send. The assistant does not read answers aloud yet.',
                },
            ],
        },
        billing: {
            title: 'Billing & Subscription',
            icon: '💳',
            faqs: [
                {
                    q: 'How do I upgrade my plan?',
                    a: 'Go to Billing, choose a plan card and Monthly or Yearly, and continue to the SSL Wireless checkout (which accepts card, bKash, and Nagad). Paying yearly costs ten months\' worth — effectively two months free, about 17% off. Only the owner or a billing-enabled role can change the subscription.',
                },
                {
                    q: 'Can I cancel my subscription?',
                    a: 'Yes — in Billing choose "Cancel at Period End". Your access continues until the end of the current paid period, and nothing is deleted. See the Refund Policy at /refund for details.',
                },
                {
                    q: 'What happens if my payment fails or the plan expires?',
                    a: 'The subscription first goes Past Due and you receive reminder emails during a short grace period (about 7 days). If it is still unpaid after that, the account is downgraded to the Free plan rather than deleted — your data is always kept, and paying again restores full features.',
                },
                {
                    q: 'What is the difference between AI credits and SMS credits?',
                    a: 'AI credits are a monthly plan allowance for AI features and reset each period. SMS credits are a prepaid balance you top up under SMS Credits: they are spent when the system sends texts (sale receipts, low-stock alerts, CRM campaigns), one credit per message segment per recipient, and a low balance warns you before sends start failing.',
                },
            ],
        },
        storefront: {
            title: 'E-commerce Storefront',
            icon: '🌐',
            faqs: [
                {
                    q: 'How do I turn on my online store?',
                    a: 'Go to Storefront → Storefront (settings), switch it on, and set a URL slug (lowercase letters, numbers, and hyphens). Your public shop is then at /store/your-slug, and you can add a banner, hero headline, and image.',
                },
                {
                    q: 'How do customers place orders?',
                    a: 'Customers open your store URL, browse in-stock products, and place an order with their contact details. Orders arrive in Storefront → Online Orders as Pending, where you can mark them Confirmed or Cancelled.',
                },
                {
                    q: 'Do storefront orders reduce my stock automatically?',
                    a: 'Not yet. A storefront order checks that stock is available but does not deduct it, and confirming an order only changes its status — you fulfil and adjust inventory yourself. Automatic inventory deduction for online orders is on our roadmap for a future release.',
                },
            ],
        },
        security: {
            title: 'Security & Account',
            icon: '🔒',
            faqs: [
                {
                    q: 'How do I turn on two-factor authentication (2FA)?',
                    a: 'Open your Profile from the account menu and go to the 2FA tab. Click Generate QR, scan it with an authenticator app (Google Authenticator, Authy, and so on), enter the 6-digit code, and Enable. After that, logins ask for a code from your phone.',
                },
                {
                    q: 'What if I forget my password?',
                    a: 'On the login page click "Forgot Password" and enter your email to receive a reset link. You can also change your password anytime from Profile → Password (the new password must be at least 8 characters).',
                },
                {
                    q: 'How do I export or delete my data?',
                    a: 'Go to Profile → Data & Privacy. "Download My Data" produces a JSON export of your account, and "Request Data Deletion" starts a deletion request that is processed within 30 days.',
                },
                {
                    q: 'How do roles and team access work?',
                    a: 'Manage people under Team. The built-in roles are OWNER, MANAGER, CASHIER, and ACCOUNTANT, and you can create custom roles; each role grants a specific set of module and action permissions. Only the owner or a user with "Manage Users" can invite members or change roles.',
                },
            ],
        },
    },
} as const;
