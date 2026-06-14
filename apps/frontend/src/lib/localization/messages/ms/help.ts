export const helpMessages = {
    title: "Pusat Bantuan",
    description: "Soalan lazim dan panduan",
    quickLinks: {
        emailSupport: {
            title: "Sokongan E-mel",
            subtitle: "support@retailsaas.app",
        },
        contact: {
            title: "Hubungi Kami",
            subtitle: "Hantar mesej",
        },
        status: {
            title: "Status Sistem",
            subtitle: "Semak masa operasi",
        },
    },
    footerPrefix: "Tidak jumpa apa yang anda cari?",
    footerLink: "Hubungi pasukan sokongan kami",
    sections: {
        gettingStarted: {
            title: "Memulakan",
            icon: "🚀",
            faqs: [
                {
                    q: "Bagaimana saya menambah produk pertama saya?",
                    a: "Pergi ke Inventori → Produk dan klik \"Tambah Produk\". Isikan nama, SKU, harga, dan kuantiti stok. Anda juga boleh mengimport produk secara pukal menggunakan fail CSV melalui butang \"Import CSV\".",
                },
                {
                    q: "Bagaimana saya membuat kedai dan mula menjual?",
                    a: "Pergi ke Persediaan → Kedai dan cipta kedai anda. Kemudian navigasi ke POS (Point of Sale) untuk mula merekodkan jualan. Pilih produk, masukkan pembayaran, dan selesaikan transaksi.",
                },
                {
                    q: "Bagaimana saya menjemput ahli kakitangan?",
                    a: "Pergi ke Tetapan → Pengguna dan klik \"Jemput\". Masukkan e-mel ahli kakitangan dan tetapkan peranan (Juruwang, Pengurus, dll.). Mereka akan menerima e-mel jemputan untuk menyertai akaun anda.",
                },
                {
                    q: "Apakah pelan langganan yang tersedia?",
                    a: "Kami menawarkan pelan FREE, BASIC, STANDARD, dan PREMIUM. Lawati /pricing untuk membandingkan ciri-ciri. Anda boleh menaik taraf pada bila-bila masa dari bahagian Pengebilan dalam papan pemuka anda.",
                },
            ],
        },
        pos: {
            title: "Titik Jualan (POS)",
            icon: "🛒",
            faqs: [
                {
                    q: "Bagaimana POS luar talian berfungsi?",
                    a: "POS berfungsi secara luar talian secara automatik. Apabila sambungan internet anda terputus, sepanduk kuning muncul dan jualan disimpan secara tempatan. Apabila anda menyambung semula, jualan disegerakkan secara automatik ke pelayan.",
                },
                {
                    q: "Bolehkah saya menerima pelbagai kaedah pembayaran dalam satu jualan?",
                    a: "Ya! Anda boleh membahagikan pembayaran antara Tunai, Kad, bKash, Nagad, dan kaedah lain dalam satu transaksi dengan menambah beberapa baris pembayaran di skrin daftar keluar POS.",
                },
                {
                    q: "Bagaimana saya menerapkan diskaun pada jualan?",
                    a: "Di skrin daftar keluar POS, terdapat medan diskaun di mana anda boleh memasukkan diskaun peratusan atau jumlah tetap sebelum menyelesaikan jualan.",
                },
                {
                    q: "Bagaimana saya mencetak resit?",
                    a: "Selepas menyelesaikan jualan, pratonton resit muncul dengan butang Cetak. Pastikan pencetak anda dikonfigurasi dan disambungkan. Resit merangkumi nama perniagaan anda, BIN (jika ditetapkan), pecahan VAT, dan butiran jualan.",
                },
            ],
        },
        inventory: {
            title: "Pengurusan Inventori",
            icon: "📦",
            faqs: [
                {
                    q: "Bagaimana saya menjejak stok di pelbagai gudang?",
                    a: "Pergi ke Inventori → Gudang untuk menyediakan gudang anda. Stok dijejak mengikut gudang. Gunakan Inventori → Pindahan untuk memindahkan stok antara gudang.",
                },
                {
                    q: "Bagaimana saya menyediakan amaran stok rendah?",
                    a: "Pada setiap produk, tetapkan \"Tahap Pesanan Semula\". Apabila stok jatuh ke atau di bawah tahap ini, sistem menghantar e-mel amaran stok rendah harian ke alamat e-mel berdaftar anda.",
                },
                {
                    q: "Bagaimana saya mengimport produk secara pukal?",
                    a: "Pergi ke Inventori → Produk dan klik \"Import CSV\". Muat turun templat, isikan dengan produk anda (nama, SKU, harga, stok), dan muat naik. Produk dengan SKU yang sepadan dikemas kini; SKU baharu dicipta.",
                },
                {
                    q: "Apakah pengiraan stok?",
                    a: "Pengiraan stok adalah kiraan fizikal inventori anda. Pergi ke Inventori → Pengiraan Stok untuk memulakan sesi. Kira setiap item dan sistem akan menunjukkan perbezaan antara kiraan anda dan stok yang direkodkan.",
                },
            ],
        },
        accounting: {
            title: "Perakaunan",
            icon: "📊",
            faqs: [
                {
                    q: "Bagaimana perakaunan catatan berganda berfungsi dalam sistem ini?",
                    a: "Sistem menggunakan pembukuan catatan berganda secara automatik. Jualan mencipta catatan debit dalam Tunai/Penghutang dan catatan kredit dalam Hasil. Pembelian mencipta catatan debit dalam Inventori/Perbelanjaan dan catatan kredit dalam Pemiutang.",
                },
                {
                    q: "Bagaimana saya mengeksport ke Tally atau QuickBooks?",
                    a: "Pergi ke Perakaunan → Gambaran Keseluruhan dan klik \"Eksport\". Pilih format anda (Tally XML atau QuickBooks IIF) dan julat tarikh. Fail dimuat turun serta-merta dan boleh diimport ke dalam perisian perakaunan anda.",
                },
                {
                    q: "Apakah Carta Akaun?",
                    a: "Carta Akaun (COA) adalah senarai semua akaun yang digunakan dalam perniagaan anda: aset, liabiliti, ekuiti, hasil, dan perbelanjaan. Pergi ke Perakaunan → Carta Akaun untuk melihat dan mengurus akaun.",
                },
            ],
        },
        billing: {
            title: "Pengebilan & Langganan",
            icon: "💳",
            faqs: [
                {
                    q: "Bagaimana saya menaik taraf pelan saya?",
                    a: "Pergi ke Pengebilan di bar sisi dan klik \"Naik Taraf\". Pilih pelan dan kitaran pengebilan anda (bulanan atau tahunan — tahunan menjimatkan 20%). Bayar melalui SSL Wireless menggunakan kaedah pilihan anda (kad, bKash, Nagad).",
                },
                {
                    q: "Bolehkah saya membatalkan langganan saya?",
                    a: "Ya. Pergi ke Pengebilan dan klik \"Batal Langganan\". Akses anda berterusan sehingga akhir tempoh pengebilan semasa. Lihat Dasar Bayaran Balik kami di /refund untuk butiran.",
                },
                {
                    q: "Apa yang berlaku jika langganan saya tamat tempoh?",
                    a: "Anda akan menerima e-mel amaran 7 hari dan 1 hari sebelum tamat tempoh. Selepas tamat tempoh, akaun anda dikunci ke mod baca sahaja sehingga anda memperbaharui. Data anda tidak akan dipadam.",
                },
            ],
        },
        storefront: {
            title: "Kedai Dalam Talian",
            icon: "🌐",
            faqs: [
                {
                    q: "Bagaimana saya mengaktifkan kedai dalam talian saya?",
                    a: "Pergi ke Kedai Dalam Talian → Tetapan, aktifkan togol, tetapkan slug URL (cth. \"kedai-saya\"), dan secara pilihan tambah mesej sepanduk. Kedai awam anda akan berada di /store/slug-anda.",
                },
                {
                    q: "Bagaimana pelanggan membuat pesanan?",
                    a: "Pelanggan melawati URL kedai anda, melayari produk yang ada stok, menambah ke troli, dan mengisi nama, e-mel, dan telefon mereka. Pesanan muncul di Kedai Dalam Talian → Pesanan di mana anda boleh mengesahkan atau membatalkannya.",
                },
                {
                    q: "Adakah pesanan kedai dalam talian ditambah secara automatik ke inventori?",
                    a: "Buat masa ini, pesanan kedai dalam talian perlu disahkan dan ditunaikan secara manual. Potongan inventori untuk pesanan kedai dalam talian ada dalam peta jalan kami untuk keluaran akan datang.",
                },
            ],
        },
        security: {
            title: "Keselamatan & Akaun",
            icon: "🔒",
            faqs: [
                {
                    q: "Bagaimana saya mengaktifkan pengesahan dua faktor (2FA)?",
                    a: "Pergi ke Tetapan → Akaun → tab 2FA. Klik \"Sediakan 2FA\", imbas kod QR dengan Google Authenticator atau Authy, masukkan kod 6 digit untuk mengesahkan, dan simpan. Mulai sekarang, log masuk memerlukan telefon anda.",
                },
                {
                    q: "Apa yang berlaku jika saya terlupa kata laluan saya?",
                    a: "Klik \"Terlupa Kata Laluan\" di halaman log masuk. Masukkan e-mel anda dan anda akan menerima pautan tetapan semula kata laluan yang sah selama 1 jam. Jika anda tidak menerimanya, semak folder spam anda.",
                },
                {
                    q: "Bagaimana saya memuat turun data saya (GDPR/eksport)?",
                    a: "Pergi ke Tetapan → Akaun dan cari \"Eksport Data Saya\". Ini menjana fail JSON dengan semua data akaun anda. Untuk permintaan pemadaman data, gunakan pilihan \"Minta Pemadaman Data\".",
                },
            ],
        },
    },
} as const;
