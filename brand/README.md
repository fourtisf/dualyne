# Logo Refract ("Prompt Lines")

Tanda `>` (prompt) dengan dua garis jawaban, cyan di atas pink: satu prompt, dua jawaban. Wordmark `refract` memakai Geist Mono Medium, huruf kecil. Semua teks di file SVG sudah diubah menjadi outline, jadi file bisa dibuka tanpa memasang font.

Ringkasan visual ada di `brand-sheet.png`.

## Mana yang dipakai

| Kebutuhan                                         | File                                                                         |
| ------------------------------------------------- | ---------------------------------------------------------------------------- |
| Logo di latar gelap (utama)                       | `svg/refract-logo.svg`, `png/refract-logo-2000.png`                          |
| Logo di latar putih/terang                        | `svg/refract-logo-on-light.svg`, `png/refract-logo-on-light-2000.png`        |
| Logo satu warna (putih / hitam)                   | `refract-logo-white`, `refract-logo-black`                                   |
| Simbol saja (tanpa tulisan)                       | `svg/refract-mark*.svg`, `png/refract-mark*-1024.png`                        |
| Ikon aplikasi                                     | `svg/refract-app-icon.svg`, `png/refract-app-icon-{1024,512,192,180,32}.png` |
| Favicon website                                   | `favicon.ico` (16/32/48), dipakai juga di `apps/web/app`                     |
| Koin $RFX (DEX, CoinGecko, CoinMarketCap, wallet) | `svg/rfx-token.svg`, `png/rfx-token-{1024,512,256,200}.png`                  |
| Foto profil X / Telegram / Discord                | `png/refract-avatar-800.png`                                                 |
| Header X (Twitter)                                | `png/refract-x-banner-1500x500.png`                                          |

PNG logo dan simbol berlatar transparan. Avatar dan banner berlatar gelap penuh.

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
