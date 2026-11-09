# Remi Kejujuran

Aplikasi web multiplayer 2–6 pemain dengan Node.js, Express, dan Socket.IO.

## Menjalankan lokal
1. Install Node.js 18 atau lebih baru.
2. Jalankan `npm install`.
3. Jalankan `npm start`.
4. Buka `http://localhost:3000`.

## Deploy online (Render)
1. Buat repository GitHub dan upload seluruh isi folder ini.
2. Di Render, pilih **New > Web Service**, hubungkan repository.
3. Build command: `npm install`
4. Start command: `npm start`
5. Deploy. Render menyediakan URL HTTPS untuk dibagikan ke teman.

Tidak membutuhkan database eksternal untuk versi awal ini; room disimpan di memori server. Jika server restart, room dan permainan yang sedang berjalan akan hilang. Untuk penggunaan publik jangka panjang, tambahkan penyimpanan persisten dan autentikasi.

## Aturan implementasi
- 52 kartu unik: 13 rank × 4 suit, tanpa Joker.
- Shuffle memakai `crypto.randomInt`; pembagian 4 kartu per pemain tanpa duplikasi.
- Set 4 kartu dengan rank sama otomatis ditaruh sebagai seri dan poin dihitung sebagai 4 × nilai rank.
- A/J/Q/K bernilai 11; angka 2–10 bernilai sesuai angka.
- Pemain meminta rank yang sudah ada di tangannya. Jika target tidak punya rank itu, penanya mengambil 1 kartu (jika dek tersedia) dan giliran berpindah.
- Jika target punya rank itu, target menerima prompt pribadi untuk memilih suit kartu rank tersebut secara jujur. Tebakan benar memindahkan kartu dan penanya lanjut; salah mengambil 1 kartu dan giliran berpindah.
- Jika pemain kehabisan kartu di tangan sementara dek masih tersedia, ia mendapat 1 kartu otomatis saat gilirannya tiba agar tetap bisa bermain. Karena kartu yang tidak membentuk seri dapat tersisa setelah dek habis, versi ini mengakhiri permainan setelah dek habis dan satu putaran penuh tanpa perpindahan kartu. Ini mencegah permainan macet selamanya ketika tidak ada lagi tebakan yang dapat berhasil.

## Catatan
Versi awal ini adalah MVP untuk diuji bersama teman. Data room disimpan di memori server; gunakan server yang selalu aktif. Reconnect otomatis dan penyimpanan room permanen belum disertakan.
