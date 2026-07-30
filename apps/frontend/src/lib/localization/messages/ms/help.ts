export const helpMessages = {
    title: 'Pusat Bantuan',
    description: 'Soalan lazim dan panduan',
    quickLinks: {
        emailSupport: {
            title: 'Sokongan E-mel',
            subtitle: 'support@erp71.com',
        },
        contact: {
            title: 'Hubungi Kami',
            subtitle: 'Hantar mesej',
        },
        status: {
            title: 'Status Sistem',
            subtitle: 'Pentadbir platform — papan pemuka kesihatan langsung',
        },
    },
    footerPrefix: 'Tidak jumpa apa yang anda cari?',
    footerLink: 'Hubungi pasukan sokongan kami',
    sections: {
        gettingStarted: {
            title: 'Memulakan',
            icon: '🚀',
            faqs: [
                {
                    q: 'Bagaimana saya menambah produk pertama saya?',
                    a: 'Pergi ke Inventori → Produk dan klik "Tambah Produk". Hanya nama dan harga jualan yang diperlukan; SKU, kategori, jenama, tahap pesanan semula, dan stok pembukaan adalah pilihan. Untuk memuatkan banyak produk sekaligus gunakan "Import CSV" — lajur templat ialah name, sku, barcode, selling_price, cost_price, stock_quantity, reorder_point, unit. Baris yang SKU-nya sudah wujud akan dilangkau, jadi import menambah produk baharu dan bukan mengemas kini produk sedia ada.',
                },
                {
                    q: 'Bagaimana saya mula menjual?',
                    a: 'Buka Jualan → Point of Sale, ketik produk untuk membina troli, lampirkan pelanggan jika mahu, terima pembayaran (Tunai, bKash, atau Kad — anda boleh membahagikan merentasi ketiga-tiganya), dan sahkan. Sediakan kedai dan gudang anda dahulu, di bawah Tetapan dan Inventori, supaya stok dijejak di tempat yang betul.',
                },
                {
                    q: 'Bagaimana saya menjemput kakitangan dan mengawal apa yang mereka boleh lakukan?',
                    a: 'Pergi ke Pasukan (Tetapan → Pasukan) dan jemput seorang ahli melalui e-mel; mereka menyertai melalui pautan jemputan. Tetapkan peranan — OWNER, MANAGER, CASHIER, atau ACCOUNTANT, atau peranan tersuai yang anda takrifkan — untuk mengawal modul dan tindakan yang boleh mereka gunakan. Menjemput ahli memerlukan akaun pemilik atau kebenaran "Manage Users".',
                },
                {
                    q: 'Pelan langganan apakah yang tersedia?',
                    a: 'Pelan berbayar layan-diri ialah BASIC, ACCOUNTING, dan STANDARD; PREMIUM — yang membuka kunci CRM, Pembuatan, dan pembantu AI — dipaparkan sebagai "coming soon". Pelan Free lama tidak lagi ditawarkan untuk pendaftaran baharu. Bandingkan dan tukar pelan pada bila-bila masa di bawah Pengebilan.',
                },
            ],
        },
        pos: {
            title: 'Titik Jualan (POS)',
            icon: '🛒',
            faqs: [
                {
                    q: 'Bagaimana POS luar talian berfungsi?',
                    a: 'Point of Sale terus berfungsi apabila internet terputus. Sepanduk kuning muncul, produk yang telah anda muatkan kekal boleh dilayari, dan setiap jualan disimpan pada peranti anda dan bukan pada pelayan. Apabila anda menyambung semula, tekan "Sync Now" (atau tunggu sahaja) dan jualan yang tertangguh akan dimuat naik secara automatik.',
                },
                {
                    q: 'Bolehkah saya menerima lebih daripada satu kaedah pembayaran dalam satu jualan?',
                    a: 'Ya. Dialog daftar keluar mempunyai medan Tunai, bKash, dan Kad Kredit yang berasingan dan menjumlahkannya, jadi satu jualan boleh dibahagikan merentasi ketiga-tiganya. (Nagad dan pindahan bank dikenali oleh enjin perakaunan tetapi bukan butang bayaran pada skrin POS itu sendiri.)',
                },
                {
                    q: 'Bagaimana diskaun berfungsi di kaunter?',
                    a: 'POS menerapkan diskaun dengan dua cara: masukkan Kod Diskaun yang sah dan tekan Guna, atau tebus mata kesetiaan pelanggan terhadap jumlah keseluruhan. Tiada kotak peratusan atau jumlah tetap bentuk bebas pada POS itu sendiri — sediakan kod di bawah Tetapan → Kod Diskaun.',
                },
                {
                    q: 'Apa yang dicetak pada resit?',
                    a: 'Selepas jualan anda boleh mencetak resit terma 80mm yang memaparkan nama kedai anda, nombor invois, tarikh, baris item, subjumlah, cukai, jumlah keseluruhan, pembayaran yang diterima, sebarang baki atau baki tertunggak, dan kod QR untuk mengesahkan invois. Perhatikan bahawa resit POS buat masa ini tidak mencetak BIN atau pecahan VAT.',
                },
            ],
        },
        sales: {
            title: 'Jualan, Pemulangan & Pelanggan',
            icon: '🧾',
            faqs: [
                {
                    q: 'Di mana saya melihat dan mencari jualan lepas?',
                    a: 'Pergi ke Jualan → Jualan untuk senarai penuh. Ia dipaparkan halaman demi halaman terhadap pelayan, jadi ia kekal pantas walaupun dengan ribuan invois. Cari mengikut nombor siri, pelanggan, atau rujukan, tapis mengikut status (Draf, Selesai, Dibayar Balik, Bayaran balik separa), dan buka mana-mana baris untuk melihat, menyunting, atau memadamnya.',
                },
                {
                    q: 'Bagaimana saya merekodkan pemulangan atau bayaran balik pelanggan?',
                    a: 'Buka Jualan → Pemulangan Jualan → "Process Return", taip nombor siri jualan asal (cth. S-00001) dan tekan Cari, kemudian pilih item dan kuantiti untuk dipulangkan. Bayaran balik diharga daripada jualan asal dan tidak boleh melebihi apa yang dijual, stok yang dipulangkan kembali ke inventori, dan bayaran balik mengikut cara pelanggan membayar — tunai balik untuk jualan yang telah dibayar, atau pengurangan baki tertunggak untuk jualan kredit.',
                },
                {
                    q: 'Bagaimana saya menjual secara kredit dan menjejak apa yang pelanggan berhutang?',
                    a: 'Tambah pelanggan di bawah Jualan → Pelanggan. Untuk menjual secara kredit, pelanggan mesti mempunyai Had Kredit yang ditetapkan — jika tidak jualan akan disekat, dan jualan kredit yang akan melebihi had juga ditolak. Halaman butiran setiap pelanggan menunjukkan baki tertunggak mereka dan lejar kredit di mana anda boleh merekodkan pembayaran.',
                },
                {
                    q: 'Di mana saya menguruskan pembayaran pelanggan dan baki tertunggak?',
                    a: 'Gunakan Jualan → Pembayaran Pelanggan untuk merekodkan wang yang diterima terhadap baki, Jualan → Lejar Pelanggan untuk penyata berjalan bagi setiap pelanggan, dan laporan Penuaan Tunggakan (di bawah Jualan → Pelanggan) untuk melihat siapa berhutang apa dan berapa lama.',
                },
            ],
        },
        inventory: {
            title: 'Pengurusan Inventori',
            icon: '📦',
            faqs: [
                {
                    q: 'Bagaimana saya menjejak stok merentasi pelbagai gudang?',
                    a: 'Cipta gudang dalam persediaan Inventori dan pilih lalai bagi setiap aliran di bawah Inventori → Tetapan Inventori. Stok disimpan mengikut gudang; pindahkannya dengan Inventori → Pindahan, aliran hantar-kemudian-terima dua langkah di mana penghantaran mengurangkan sumber, penerimaan menambah destinasi, dan penerimaan separa dibenarkan.',
                },
                {
                    q: 'Bagaimana amaran stok rendah berfungsi?',
                    a: 'Tetapkan Tahap Pesanan Semula pada setiap produk (atau lalai dalam Tetapan Inventori). Setiap pagi pada 07:00 sistem menyemak kuantiti dalam tangan dan, bagi apa-apa yang berada pada atau di bawah tahap pesanan semulanya, menghantar e-mel kepada pemilik akaun, menaikkan pemberitahuan dalam apl, dan — jika SMS stok rendah didayakan — menghantar teks kepada pemilik. Inventori → Laporan Pesanan Semula menyenaraikan segala yang di bawah tahapnya atas permintaan.',
                },
                {
                    q: 'Bagaimana saya mengimport banyak produk sekaligus?',
                    a: 'Pergi ke Inventori → Produk → "Import CSV" dan muat naik templat (lajur: name, sku, barcode, selling_price, cost_price, stock_quantity, reorder_point, unit). Harga jualan diperlukan pada setiap baris, kuantiti stok pembukaan mencipta pergerakan stok awal, dan baris yang SKU-nya sudah wujud akan dilangkau — jadi gunakan import untuk menambah produk baharu, bukan untuk mengemas kini yang sedia ada.',
                },
                {
                    q: 'Apakah pengiraan stok, dan bila ia memerlukan kelulusan?',
                    a: 'Pengiraan stok (Inventori → Pengiraan Stok) mengira stok fizikal berbanding sistem. Memulakan sesi mengambil syot kilat kuantiti dijangka bagi setiap produk dalam gudang yang dipilih; anda memasukkan kuantiti yang dikira dan setiap varians dihitung. Jika varians terbesar melebihi ambang percanggahan (25 secara lalai, ditetapkan dalam Tetapan Inventori) sesi mesti disemak sebelum ia boleh dipos, dan mengepos akan melaraskan stok dan merekodkan baucar perakaunan.',
                },
            ],
        },
        purchases: {
            title: 'Pembelian & Pembekal',
            icon: '🚚',
            faqs: [
                {
                    q: 'Bagaimana saya merekodkan pembelian daripada pembekal?',
                    a: 'Pergi ke Pembelian → Pembelian dan cipta satu: pilih kedai/gudang dan pembekal (atau tambah satu secara sebaris) dan tambah baris produk dengan kuantiti dan kos seunit, serta cukai, diskaun, dan pengangkutan pilihan. Menyimpan pembelian menerima barang serta-merta (stok naik) dan membukukan jumlah penuh sebagai belum bayar — tiada medan tunai, jadi rekodkan sebarang pembayaran secara berasingan sebagai Pembayaran Pembekal.',
                },
                {
                    q: 'Apakah perbezaan antara Pesanan Belian dan Pembelian?',
                    a: 'Pesanan Belian (Pembelian → Pesanan Belian) ialah komitmen yang tidak menggerakkan stok. Apabila anda menandakannya Diterima ia kemudian menambah stok dan mengepos belum bayar, sama seperti pembelian langsung. Gunakan PO apabila anda memesan lebih awal daripada penghantaran, dan Pembelian langsung apabila barang tiba pada masa yang sama.',
                },
                {
                    q: 'Bagaimana saya memulangkan barang kepada pembekal?',
                    a: 'Gunakan Pembelian → Pemulangan Belian. Pemulangan boleh dipautkan kepada pembelian atau berdiri sendiri; ia mengurangkan stok, menurunkan baki tertunggak pembekal (dihadkan pada apa yang anda kini berhutang), dan mengepos baucar perakaunan yang sepadan.',
                },
                {
                    q: 'Bagaimana saya membayar pembekal dan melihat apa yang saya berhutang?',
                    a: 'Rekodkan pembayaran di bawah Pembelian → Pembayaran Pembekal — anda boleh membayar atau menerima, memperuntukkan pembayaran merentasi bil tertentu, dan meninggalkan sebarang baki sebagai pendahuluan untuk diperuntukkan kemudian. Pembelian → Lejar Pembekal menunjukkan baki berjalan setiap pembekal, dan setiap pembekal juga mempunyai ringkasan pengebilan dan lejar kredit.',
                },
            ],
        },
        accounting: {
            title: 'Perakaunan',
            icon: '📊',
            faqs: [
                {
                    q: 'Adakah saya perlu mengepos catatan jurnal sendiri?',
                    a: 'Tidak — sistem menyimpan buku catatan berganda secara automatik. Peraturan Pengeposan (Perakaunan → Peraturan Pengeposan) memetakan setiap peristiwa operasi (jualan, pembelian, pemulangan, pindahan, gaji, pelarasan) kepada akaun untuk didebit dan dikredit, dan baucar dijana apabila peristiwa itu berlaku. Anda hanya membuat catatan manual untuk perkara yang tidak diliputi oleh peraturan.',
                },
                {
                    q: 'Apakah Carta Akaun?',
                    a: 'Carta Akaun (Perakaunan → Carta Akaun) ialah senarai induk akaun lejar anda — aset, liabiliti, ekuiti, hasil, dan perbelanjaan — disusun ke dalam kumpulan dan subkumpulan. Setiap baris baucar mengepos ke salah satu akaun ini, jadi ia menjadi asas kepada semua laporan anda.',
                },
                {
                    q: 'Bolehkah saya membuat catatan manual, dan laporan apa yang tersedia?',
                    a: 'Ya — Perakaunan → Catatan Baucar merekodkan baucar tunai, bank, pindahan, dan jurnal secara manual, dan skrin Baucar, Jurnal, dan Lejar membolehkan anda menyemaknya. Laporan termasuk Imbangan Duga, Untung & Rugi, Kunci Kira-kira, Buku Tunai, Buku Bank, Penuaan AR/AP, dan laporan VAT/Cukai; Tempoh Fiskal boleh mengunci bulan yang ditutup untuk mengelakkan catatan bertarikh belakang.',
                },
                {
                    q: 'Bagaimana saya mengeksport ke Tally atau QuickBooks?',
                    a: 'Pada halaman gambaran keseluruhan Perakaunan klik "Export", pilih Tally XML atau QuickBooks IIF, pilih julat tarikh, dan muat turun. Fail diimport terus ke dalam pakej perakaunan tersebut.',
                },
            ],
        },
        crm: {
            title: 'CRM & Prospek',
            icon: '🤝',
            faqs: [
                {
                    q: 'Apakah yang termasuk dalam modul CRM, dan siapa yang boleh menggunakannya?',
                    a: 'CRM meliputi Prospek, Perbualan, Susulan, Kempen, dan Pelanggan, serta tetapan untuk Sumber & Kategori Prospek dan Medan Tersuai, semuanya dicapai dari hab gambaran keseluruhan CRM. Kebanyakannya adalah ciri pelan Premium — pada pelan lain anda masih mendapat Pelanggan, tetapi alat saluran paip disembunyikan.',
                },
                {
                    q: 'Bagaimana saya mencipta dan mengendalikan prospek?',
                    a: 'Pergi ke CRM → Prospek → "New Lead" dan masukkan sekurang-kurangnya nama (mudah alih, e-mel, sumber, kategori, keutamaan, pautan sosial, dan langkah seterusnya adalah pilihan). Prospek bergerak melalui peringkat tetap — New, Contacted, Qualified, Lost, Converted — dan anda menetapkannya kepada orang di "Next Step Assigned To"; senarai juga menyokong penetapan pukal dan perubahan status. Apabila anda bersedia, "Convert to Customer" mencipta atau memautkan pelanggan dalam Jualan.',
                },
                {
                    q: 'Dari mana senarai Sumber dan Kategori datang?',
                    a: 'Ia adalah data induk anda sendiri — uruskannya di bawah CRM → Sumber & Kategori. Setiap Sumber juga membawa berat skor (0–25) yang menyumbang kepada skor prospek automatik. Anda boleh menambah, menyunting, menyembunyikan, atau memadam nilai; memadam nilai yang sedang digunakan meminta anda memindahkan prospek tersebut ke gantian, dan nilai terbina dalam disembunyikan dan bukan dibuang.',
                },
                {
                    q: 'Bagaimana Susulan dan Perbualan berfungsi?',
                    a: 'Susulan (CRM → Susulan) ialah satu baris gilir peringatan — Umum, Kutipan, Hari Lahir, atau Pesanan Semula — dicipta dari halaman butiran pelanggan atau prospek, dengan peringatan Hari Lahir dan Pesanan Semula turut dijana secara automatik. Perbualan (CRM → Perbualan) ialah log baca sahaja yang boleh ditapis bagi setiap titik sentuh (panggilan, SMS, WhatsApp, lawatan, dan sebagainya) yang direkodkan terhadap prospek merentasi seluruh pasukan anda; anda log yang baharu dari halaman butiran prospek.',
                },
            ],
        },
        manufacturing: {
            title: 'Pembuatan',
            icon: '🏭',
            faqs: [
                {
                    q: 'Bagaimana saya menyediakan resipi produk (BOM)?',
                    a: 'Pada halaman Pembuatan, buka tab Bil Bahan dan klik "New BOM". Resipi menamakan produk output, berapa banyak unit dihasilkan oleh satu larian, dan produk komponennya dengan kuantiti. Komponen dimasukkan mengikut ID produk, dan produk output resipi tidak boleh ditukar setelah dicipta. Pembuatan ialah ciri Premium/tambahan.',
                },
                {
                    q: 'Bagaimana kerja pengeluaran mempengaruhi stok?',
                    a: 'Dalam tab Kerja Pengeluaran, cipta kerja daripada BOM dan kuantiti larian; ia bermula sebagai draf. Memulakannya menyemak semula bahawa komponen ada dalam stok, dan menyelesaikannya menggunakan stok komponen (serta sebarang pembaziran yang anda masukkan) dan menambah barang siap ke inventori. Pembuatan menggerakkan inventori sahaja — ia tidak mengepos ke lejar am.',
                },
                {
                    q: 'Bagaimana kos kerja dan harga jualan dikira?',
                    a: 'Pada penyelesaian, kos bahan diambil syot kilat daripada kos terkini setiap komponen, dan anda boleh menambah baris kos lanjut (buruh, percetakan, pengangkutan, overhed, dan sebagainya), yang boleh diambil daripada bil pembelian perkhidmatan. Kerja itu kemudian menunjukkan jumlah kos dan kos seunit, dan bagi kerja yang selesai panel Penetapan Harga mencadangkan harga jualan kos-tambah yang boleh anda terapkan pada produk.',
                },
            ],
        },
        hr: {
            title: 'HR & Gaji',
            icon: '👥',
            faqs: [
                {
                    q: 'Bagaimana saya menambah pekerja?',
                    a: 'Pergi ke HR → Pekerja → "New Employee" dan masukkan sekurang-kurangnya nama dan telefon (e-mel, tarikh menyertai, kad pengenalan negara, jabatan, jawatan, dan gaji asas adalah pilihan), atau tambah secara pukal dengan dialog Import. Kod pekerja dijana secara automatik, dan anda boleh memautkan pekerja ke log masuk sistem supaya mereka boleh log masuk.',
                },
                {
                    q: 'Bagaimana kehadiran dan cuti dikendalikan?',
                    a: 'HR → Kehadiran merekodkan satu catatan bagi setiap pekerja setiap hari — Hadir, Tidak Hadir, Separuh Hari, atau Cuti Umum, dengan masa masuk/keluar pilihan — dimasukkan secara manual, kerana tiada peranti jam. HR → Cuti mempunyai dua tab: Permohonan (hantar, kemudian luluskan atau tolak) dan Jenis (takrifkan jenis cuti dan harinya setahun).',
                },
                {
                    q: 'Bagaimana saya membayar gaji?',
                    a: 'Gunakan HR → Pembayaran Gaji → "Pay Salary", pilih pekerja dan tempoh pembayaran, dan rekodkan jumlah (diisi dahulu daripada gaji asas mereka) dan kaedah. Setiap pembayaran mengepos baucar perakaunan (debit Gaji Belum Bayar, kredit akaun pembayaran). Pembayaran adalah jumlah rata tunggal — belum ada slip gaji atau pecahan elaun/potongan lagi.',
                },
            ],
        },
        aiAssistant: {
            title: 'Pembantu AI',
            icon: '🤖',
            faqs: [
                {
                    q: 'Apakah pembantu perniagaan AI dan bagaimana saya membukanya?',
                    a: 'Ia ialah panel sembang — ikon robot "Ask the business assistant" — yang menjawab soalan tentang data anda sendiri: jualan, stok, pelanggan, penghutang, dan banyak lagi. Ia baca sahaja secara ketat: ia boleh mencari perkara dan menerangkannya, tetapi ia tidak boleh mengubah apa-apa. Pembantu ini ialah ciri pelan Premium, jadi ikon hanya muncul apabila pelan anda menyertakannya.',
                },
                {
                    q: 'Apa yang sebenarnya boleh dilihatnya, dan bolehkah saya mempercayai jawapannya?',
                    a: 'Tanya "what can you do?" dan ia melaporkan cawangan anda, sejauh mana rekod anda terkebelakang, dan alat mana yang boleh digunakannya — jadi jawapan kosong bermaksud tempoh kosong, bukan pertanyaan yang rosak. Setiap jawapan menyenaraikan Sumbernya (laporan dan julat tarikh tepat yang digunakannya) supaya anda boleh mengesahkannya. Anda juga boleh memintanya menyemak transaksi luar biasa — jualan di bawah kos, invois pendua, sisihan harga besar — dan ia akan memberitahu anda jika mana-mana semakan tidak dapat diselesaikan dan bukannya menyiratkan semuanya bersih.',
                },
                {
                    q: 'Apakah kredit AI dan bagaimana saya mendapatkan lebih banyak?',
                    a: 'Kredit AI ialah elaun bulanan yang disertakan dengan pelan anda (1 kredit = 1,000 token), digunakan oleh pembantu dan ciri AI lain; lihatnya di bawah Kredit AI. Ia ditetapkan semula setiap tempoh pengebilan dan tidak boleh dibeli secara berasingan — anda mendapat elaun lebih besar dengan menaik taraf (BASIC menyertakan 100/bulan, STANDARD 500). Ini berbeza daripada kredit SMS, yang prabayar dan boleh dibeli.',
                },
            ],
        },
        billing: {
            title: 'Pengebilan & Langganan',
            icon: '💳',
            faqs: [
                {
                    q: 'Bagaimana saya menaik taraf pelan saya?',
                    a: 'Pergi ke Pengebilan, pilih kad pelan dan Bulanan atau Tahunan, dan teruskan ke daftar keluar SSL Wireless (yang menerima kad, bKash, dan Nagad). Membayar secara tahunan berkos nilai sepuluh bulan — secara berkesan dua bulan percuma, kira-kira 17% jimat. Hanya pemilik atau peranan yang didayakan pengebilan boleh menukar langganan.',
                },
                {
                    q: 'Bolehkah saya membatalkan langganan saya?',
                    a: 'Ya — dalam Pengebilan pilih "Cancel at Period End". Akses anda berterusan sehingga akhir tempoh berbayar semasa, dan tiada apa yang dipadam. Lihat Dasar Bayaran Balik di /refund untuk butiran.',
                },
                {
                    q: 'Apa yang berlaku jika pembayaran saya gagal atau pelan tamat tempoh?',
                    a: 'Langganan mula-mula menjadi Tertunggak dan anda menerima e-mel peringatan semasa tempoh tenggang pendek (kira-kira 7 days). Jika ia masih belum dibayar selepas itu, akaun diturun taraf ke pelan Free dan bukannya dipadam — data anda sentiasa disimpan, dan membayar semula memulihkan ciri penuh.',
                },
                {
                    q: 'Apakah perbezaan antara kredit AI dan kredit SMS?',
                    a: 'Kredit AI ialah elaun pelan bulanan untuk ciri AI dan ditetapkan semula setiap tempoh. Kredit SMS ialah baki prabayar yang anda tambah nilai di bawah Kredit SMS: ia dibelanjakan apabila sistem menghantar teks (resit jualan, amaran stok rendah, kempen CRM), satu kredit setiap segmen mesej setiap penerima, dan baki rendah memberi amaran kepada anda sebelum penghantaran mula gagal.',
                },
            ],
        },
        storefront: {
            title: 'Kedai E-dagang',
            icon: '🌐',
            faqs: [
                {
                    q: 'Bagaimana saya mengaktifkan kedai dalam talian saya?',
                    a: 'Pergi ke Kedai → Kedai (tetapan), aktifkannya, dan tetapkan slug URL (huruf kecil, nombor, dan sengkang). Kedai awam anda kemudian berada di /store/your-slug, dan anda boleh menambah sepanduk, tajuk utama hero, dan imej.',
                },
                {
                    q: 'Bagaimana pelanggan membuat pesanan?',
                    a: 'Pelanggan membuka URL kedai anda, melayari produk yang ada stok, dan membuat pesanan dengan butiran hubungan mereka. Pesanan tiba di Kedai → Pesanan Dalam Talian sebagai Belum Selesai, di mana anda boleh menandakannya Disahkan atau Dibatalkan.',
                },
                {
                    q: 'Adakah pesanan kedai mengurangkan stok saya secara automatik?',
                    a: 'Belum lagi. Pesanan kedai menyemak bahawa stok tersedia tetapi tidak menolaknya, dan mengesahkan pesanan hanya menukar statusnya — anda menunaikan dan melaraskan inventori sendiri. Potongan inventori automatik untuk pesanan dalam talian berada dalam peta jalan kami untuk keluaran akan datang.',
                },
            ],
        },
        security: {
            title: 'Keselamatan & Akaun',
            icon: '🔒',
            faqs: [
                {
                    q: 'Bagaimana saya mengaktifkan pengesahan dua faktor (2FA)?',
                    a: 'Buka Profil anda dari menu akaun dan pergi ke tab 2FA. Klik Jana QR, imbasnya dengan apl pengesah (Google Authenticator, Authy, dan sebagainya), masukkan kod 6 digit, dan Dayakan. Selepas itu, log masuk meminta kod dari telefon anda.',
                },
                {
                    q: 'Bagaimana jika saya terlupa kata laluan saya?',
                    a: 'Pada halaman log masuk klik "Forgot Password" dan masukkan e-mel anda untuk menerima pautan tetapan semula. Anda juga boleh menukar kata laluan anda pada bila-bila masa dari Profil → Kata Laluan (kata laluan baharu mesti sekurang-kurangnya 8 characters).',
                },
                {
                    q: 'Bagaimana saya mengeksport atau memadam data saya?',
                    a: 'Pergi ke Profil → Data & Privasi. "Download My Data" menghasilkan eksport JSON akaun anda, dan "Request Data Deletion" memulakan permintaan pemadaman yang diproses dalam masa 30 days.',
                },
                {
                    q: 'Bagaimana peranan dan akses pasukan berfungsi?',
                    a: 'Uruskan orang di bawah Pasukan. Peranan terbina dalam ialah OWNER, MANAGER, CASHIER, dan ACCOUNTANT, dan anda boleh mencipta peranan tersuai; setiap peranan memberikan set kebenaran modul dan tindakan yang tertentu. Hanya pemilik atau pengguna dengan "Manage Users" boleh menjemput ahli atau menukar peranan.',
                },
            ],
        },
    },
} as const;
