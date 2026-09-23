# Logo Dualyne ("Prompt Lines")

Tanda `>` (prompt) dengan dua garis jawaban, cyan di atas pink: satu prompt, dua jawaban. Wordmark `dualyne` memakai Geist Mono Medium, huruf kecil. Semua teks di file SVG sudah diubah menjadi outline, jadi file bisa dibuka tanpa memasang font.

Ringkasan visual ada di `brand-sheet.png`.

## Mana yang dipakai

| Kebutuhan                                          | File                                                                         |
| -------------------------------------------------- | ---------------------------------------------------------------------------- |
| Logo di latar gelap (utama)                        | `png/dualyne-logo-2400x1200.png`, `svg/dualyne-logo.svg`                     |
| Logo di latar terang                               | `png/dualyne-logo-on-light-2400x1200.png`, `svg/dualyne-logo-on-light.svg`   |
| Logo putih di gradien ungu–pink                    | `png/dualyne-logo-white-2400x1200.png`                                       |
| Logo hitam di latar putih                          | `png/dualyne-logo-black-2400x1200.png`                                       |
| Simbol saja (tanpa tulisan)                        | `png/dualyne-mark*-1024.png`, `svg/dualyne-mark*.svg`                        |
| Ikon aplikasi                                      | `png/dualyne-app-icon-{1024,512,192,180,32}.png`, `svg/dualyne-app-icon.svg` |
| Favicon website                                    | `favicon.ico` (16/32/48), dipakai juga di `apps/web/app`                     |
| Koin $DLYN (DEX, CoinGecko, CoinMarketCap, wallet) | `png/dlyn-token-{1024,512,256,200}.png`, `svg/dlyn-token.svg`                |
| Foto profil X / Telegram / Discord                 | `png/dualyne-avatar-800.png`                                                 |
| Header X (Twitter)                                 | `png/dualyne-x-banner-1500x500.png`                                          |

Semua PNG di `png/` punya warna latar, tidak ada bagian transparan:

- Ikon aplikasi berbentuk kotak penuh; HP dan app store membulatkan sudutnya sendiri.
- PNG koin berisi gradien penuh; platform yang memotongnya jadi bulat akan menampilkan koin.
- Versi transparan logo dan simbol ada di `png/transparent/`, untuk desainer yang ingin menaruhnya di latar sendiri.
- File SVG tetap transparan, karena itu format vektor untuk diolah desainer.

## Warna

| Nama                  | Hex                   | Dipakai untuk                      |
| --------------------- | --------------------- | ---------------------------------- |
| Night                 | `#050507`             | Latar                              |
| Paper                 | `#EDEDEF`             | Teks dan tanda `>` di latar gelap  |
| Signal cyan           | `#67E8F9`             | Garis jawaban pertama              |
| Signal pink           | `#F472B6`             | Garis jawaban kedua                |
| Violet                | `#8B5CF6`             | Aksen, token                       |
| Ink                   | `#141418`             | Teks dan tanda `>` di latar terang |
| Deep cyan / Deep pink | `#0891B2` / `#DB2777` | Garis jawaban di latar terang      |

## Aturan singkat

- Beri ruang kosong di sekitar logo minimal setinggi tanda `>`.
- Ukuran terkecil: simbol 16 px, logo lengkap 96 px lebar.
- Di latar putih atau pucat, pakai versi `on-light`.
- Garis selalu cyan di atas pink, atau keduanya satu warna.
- Jangan ditarik, diputar, diberi outline, bayangan, atau efek glow.

## Membuat ulang

Semua file dibuat dari satu definisi di `build.py`. Kalau nama brand, ticker, atau tagline berubah, ubah `NAME`, `TOKEN` atau `TAGLINE` di sana, lalu jalankan:

```bash
pip install fonttools pillow
npm i --prefix brand playwright-core   # atau set PLAYWRIGHT_CORE ke lokasi playwright-core
python3 brand/build.py
```

Font diambil dari paket `geist` di `apps/web/node_modules` (jalankan `pnpm install` dulu). Geist berlisensi SIL Open Font License, jadi boleh dipakai di dalam logo.
