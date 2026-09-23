# Panduan Deploy Dualyne

Panduan ini membawa Anda dari **server kosong** sampai **website live di `https://domainanda.com`**, lengkap dengan deploy otomatis setiap kali ada perubahan di branch `main`. Tidak perlu bisa coding: cukup ikuti langkahnya satu per satu dan salin perintahnya persis.

Perkiraan waktu: 1–2 jam, sebagian besar menunggu DNS dan build pertama.

> Di panduan ini, `domainanda.com` adalah contoh. Ganti dengan domain Anda sendiri di setiap perintah.

> **Sudah punya server yang menjalankan aplikasi lain dengan PM2?** Pakai [bagian 22](#22-deploy-dengan-pm2-di-server-yang-sudah-ada): lebih singkat, tanpa Docker, dan tidak mengganggu aplikasi yang sudah berjalan.

---

## 0. Yang perlu disiapkan

| Kebutuhan       | Keterangan                                                                                                           |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| Domain          | Dari registrar mana saja (Namecheap, Niagahoster, Cloudflare, dll.)                                                  |
| Akun Cloudflare | Gratis, di [cloudflare.com](https://cloudflare.com)                                                                  |
| VPS             | Ubuntu **22.04 atau 24.04**, minimal **2 vCPU, 4 GB RAM**, 40 GB disk. Contoh: DigitalOcean, Vultr, Hetzner, Contabo |
| Akun OpenRouter | [openrouter.ai](https://openrouter.ai), isi saldo awal (disarankan $300–1.000)                                       |
| Akses GitHub    | Repository `dualyne` dengan akses admin                                                                              |

---

## 1. Pindahkan domain ke Cloudflare

1. Masuk ke Cloudflare, klik **Add a site**, lalu masukkan domain Anda dan pilih paket **Free**.
2. Cloudflare memberi **2 nameserver** (misalnya `ana.ns.cloudflare.com`). Buka panel registrar domain Anda dan ganti nameserver domain dengan dua alamat itu.
3. Tunggu sampai status domain di Cloudflare menjadi **Active**. Biasanya beberapa menit, paling lama 24 jam.

## 2. Buat VPS

Buat server Ubuntu 22.04/24.04 di penyedia pilihan Anda. Catat:

- **Alamat IP** server (contoh `203.0.113.10`)
- **Password root** atau SSH key yang Anda pilih saat membuat server

## 3. Buat DNS record di Cloudflare

Buka **Cloudflare → domain Anda → DNS → Records**, lalu tambahkan:

| Type | Name  | Content (IPv4 address) | Proxy status              |
| ---- | ----- | ---------------------- | ------------------------- |
| A    | `@`   | IP server Anda         | **Proxied** (awan oranye) |
| A    | `www` | IP server Anda         | **Proxied**               |
| A    | `api` | IP server Anda         | **Proxied**               |

Jika server Anda juga punya IPv6, tambahkan tiga record **AAAA** dengan nama yang sama dan alamat IPv6 server.

## 4. Pengaturan Cloudflare (wajib)

Di dashboard domain Anda:

1. **SSL/TLS → Overview**: pilih **Full (strict)**.
2. **SSL/TLS → Edge Certificates**: nyalakan **Always Use HTTPS**.
3. **Speed → Optimization → Content Optimization**: pastikan **Rocket Loader** dalam keadaan **Off**. Rocket Loader merusak website Next.js.
4. **Caching → Cache Rules → Create rule**:
   - Nama: `API no cache`
   - Kondisi: _Hostname_ `equals` `api.domainanda.com`
   - Aksi: **Bypass cache**
   - Klik **Deploy**.

## 5. Buat token Cloudflare untuk sertifikat HTTPS

Server memakai token ini untuk membuat dan memperpanjang sertifikat HTTPS secara otomatis.

1. Klik ikon profil (kanan atas) → **My Profile → API Tokens → Create Token**.
2. Pilih template **Edit zone DNS** → **Use template**.
3. Di bagian _Zone Resources_, pilih **Include → Specific zone → domainanda.com**.
4. Klik **Continue to summary → Create Token**, lalu salin tokennya dan simpan di tempat aman. Token hanya ditampilkan sekali.

## 6. Buat Cloudflare Turnstile (anti-bot untuk Compare)

1. Buka dashboard Cloudflare → **Turnstile → Add widget**.
2. Isi nama `Dualyne`, lalu tambahkan hostname `domainanda.com` dan `www.domainanda.com`.
3. _Widget mode_: **Managed**.
4. Salin **Site Key** dan **Secret Key**.

## 7. Buat API key OpenRouter

1. Buka [openrouter.ai/keys](https://openrouter.ai/keys) → **Create Key**.
2. Opsional tapi disarankan: beri **credit limit**, misalnya $150/hari, sebagai pengaman tambahan.
3. Salin key-nya (diawali `sk-or-`).

---

## 8. Siapkan server (sekali saja)

### 8a. Masuk ke server

Di komputer Anda, buka Terminal (Mac/Linux) atau PowerShell (Windows):

```bash
ssh root@203.0.113.10
```

### 8b. Ambil script setup

**Jika repository GitHub Anda publik:**

```bash
curl -fsSL https://raw.githubusercontent.com/OWNER/refract/main/deploy/scripts/server-setup.sh -o setup.sh
```

**Jika repository privat:**

1. Buka file `deploy/scripts/server-setup.sh` di GitHub, klik tombol **Copy raw file**.
2. Di server, ketik `nano setup.sh`.
3. Tempel isinya (klik kanan atau `Ctrl+Shift+V`), lalu simpan dengan `Ctrl+O`, `Enter`, `Ctrl+X`.

### 8c. Jalankan setup

Ganti keempat nilainya, lalu jalankan:

```bash
DOMAIN=domainanda.com \
EMAIL=email@anda.com \
CF_API_TOKEN=token-dari-langkah-5 \
REPO=git@github.com:OWNER/refract.git \
bash setup.sh
```

**Pada run pertama untuk repo privat**, script akan berhenti dan menampilkan sebuah _public key_ (baris yang diawali `ssh-ed25519 ...`). Lakukan ini:

1. Di GitHub, buka **repository → Settings → Deploy keys → Add deploy key**.
2. Isi Title `server`, tempel key tersebut, dan **jangan** centang _Allow write access_. Lalu **Add key**.
3. Jalankan lagi perintah `bash setup.sh` yang sama.

Script ini akan:

- memasang Docker, Nginx, certbot dan firewall;
- membuat user `deploy`;
- mengunduh kode ke `/opt/dualyne`;
- membuat sertifikat HTTPS dan mengatur Nginx;
- menutup port web kecuali untuk Cloudflare.

Script aman dijalankan ulang.

## 9. Isi file rahasia `.env`

```bash
sudo -u deploy nano /opt/dualyne/.env
```

Isi setiap nilai yang masih `change-me` atau kosong. Untuk membuat kata sandi acak, buka jendela SSH kedua dan jalankan:

```bash
openssl rand -hex 32
```

Yang **wajib** diisi:

| Variabel                         | Isi                                                                          |
| -------------------------------- | ---------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD`              | Kata sandi acak                                                              |
| `DATABASE_URL`                   | Ganti `change-me` dengan kata sandi yang **sama** dengan `POSTGRES_PASSWORD` |
| `REDIS_PASSWORD`                 | Kata sandi acak lain                                                         |
| `REDIS_URL`                      | Ganti `change-me` dengan kata sandi yang **sama** dengan `REDIS_PASSWORD`    |
| `OPENROUTER_API_KEY`             | Key dari langkah 7                                                           |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Site Key dari langkah 6                                                      |
| `TURNSTILE_SECRET_KEY`           | Secret Key dari langkah 6                                                    |
| `IP_HASH_SECRET`                 | Hasil `openssl rand -hex 32`                                                 |
| `SESSION_SECRET`                 | Hasil `openssl rand -hex 32` lagi (harus berbeda)                            |
| `DAILY_BUDGET_USD`               | Batas belanja harian untuk tier gratis, mulai dari `100`                     |

Nilai lain (wallet, token, treasury) boleh dikosongkan dulu dan diisi saat token launch.

Simpan dengan `Ctrl+O`, `Enter`, `Ctrl+X`.

> **File `.env` berisi rahasia.** Jangan kirim ke siapa pun dan jangan upload ke GitHub.

## 10. Deploy pertama

```bash
sudo -u deploy /opt/dualyne/deploy/scripts/deploy.sh
```

Build pertama memakan waktu 5–15 menit. Jika berhasil, baris terakhirnya berbunyi:

```
[deploy] Healthy. <kode commit> is live.
```

Buka `https://domainanda.com`. Website Anda sudah live.

## 11. Cek model OpenRouter (wajib sekali setelah deploy pertama)

Nama model di OpenRouter sering berubah. Cek pemetaannya:

```bash
cd /opt/dualyne
docker compose -f docker-compose.prod.yml exec api node dist/resolve-models.js
```

- Setiap model harus menampilkan **OK**.
- Jika ada yang **MISSING**, atau Anda ingin versi terbaru, pilih salah satu nama dari baris _recent in family_, lalu jalankan:

```bash
docker compose -f docker-compose.prod.yml exec api node dist/resolve-models.js --set gpt=openai/gpt-5.1 --verify
```

## 12. Tes semuanya

1. **Website**: buka `https://domainanda.com`, klik **Run comparison**, dan pastikan kedua jawaban muncul bertahap.

2. **API dengan test key**: buat key untuk wallet Anda sendiri:

   ```bash
   docker compose -f docker-compose.prod.yml exec api node dist/create-key.js --wallet 0xALAMATWALLETANDA --tier holder
   ```

   Lalu coba panggil API, dari server atau dari komputer mana saja:

   ```bash
   curl https://api.domainanda.com/v1/chat/completions \
     -H "Authorization: Bearer dly_live_..." \
     -H "Content-Type: application/json" \
     -d '{"model":"gpt","messages":[{"role":"user","content":"Halo"}],"stream":true}'
   ```

---

## 13. Deploy otomatis dari GitHub

Setelah langkah ini, setiap _push_ atau _merge_ ke branch `main` akan otomatis dites lalu di-deploy.

**Di server**, buat kunci khusus untuk GitHub Actions:

```bash
sudo -u deploy ssh-keygen -t ed25519 -N "" -C github-actions -f /home/deploy/.ssh/github_actions
sudo -u deploy sh -c 'cat ~/.ssh/github_actions.pub >> ~/.ssh/authorized_keys'
sudo cat /home/deploy/.ssh/github_actions
```

Salin **seluruh** output perintah terakhir, termasuk baris `-----BEGIN ...` dan `-----END ...`.

**Di GitHub**, buka **repository → Settings → Secrets and variables → Actions → New repository secret**, lalu buat tiga secret:

| Name             | Value                          |
| ---------------- | ------------------------------ |
| `DEPLOY_HOST`    | IP server Anda                 |
| `DEPLOY_USER`    | `deploy`                       |
| `DEPLOY_SSH_KEY` | Isi kunci yang tadi Anda salin |

Selesai. Anda bisa melihat prosesnya di tab **Actions** di GitHub: workflow **CI** menjalankan tes, lalu **Deploy** mengirim ke server.

## 14. Rollback (kembali ke versi sebelumnya)

- **Otomatis:** jika versi baru gagal _health check_, script langsung kembali ke versi sebelumnya. Anda tidak perlu melakukan apa-apa.
- **Manual, ke versi tepat sebelumnya:**

  ```bash
  sudo -u deploy /opt/dualyne/deploy/scripts/deploy.sh --rollback
  ```

- **Manual, ke commit tertentu** (kodenya bisa dilihat di tab Commits di GitHub):

  ```bash
  sudo -u deploy /opt/dualyne/deploy/scripts/deploy.sh --rollback 37d0b98...
  ```

- **Lewat GitHub:** buka Pull Request yang bermasalah → **Revert**. Setelah di-merge, deploy otomatis mengembalikan versi lama.

> Catatan: rollback mengembalikan **kode**, bukan isi database. Perubahan struktur database selalu dibuat agar tetap cocok dengan versi sebelumnya.

## 15. Backup database

- Backup dibuat otomatis setiap hari pukul **03:00 UTC** di folder `/var/backups/dualyne/`. Hanya **7 hari terakhir** yang disimpan.
- Untuk backup sekarang juga:

  ```bash
  cd /opt/dualyne && docker compose -f docker-compose.prod.yml exec backup sh /backup.sh --now
  ```

- Untuk mengunduh backup ke komputer Anda (dijalankan di komputer Anda, bukan di server):

  ```bash
  scp root@203.0.113.10:/var/backups/dualyne/dualyne-2026-09-23.dump .
  ```

  Sebaiknya lakukan rutin, supaya ada salinan di luar server.

- **Restore** (mengganti isi database dengan backup; script akan meminta konfirmasi):

  ```bash
  cd /opt/dualyne && ./deploy/backup/restore.sh /var/backups/dualyne/dualyne-2026-09-23.dump
  ```

## 16. Perintah harian yang berguna

Jalankan dari folder `/opt/dualyne`:

| Tujuan               | Perintah                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------- |
| Status semua layanan | `docker compose -f docker-compose.prod.yml ps`                                                            |
| Lihat log API (live) | `docker compose -f docker-compose.prod.yml logs -f --tail=100 api`                                        |
| Lihat log website    | `docker compose -f docker-compose.prod.yml logs -f --tail=100 web`                                        |
| Restart API          | `docker compose -f docker-compose.prod.yml restart api`                                                   |
| Buat API key         | `docker compose -f docker-compose.prod.yml exec api node dist/create-key.js --wallet 0x... --tier holder` |
| Cabut API key        | `docker compose -f docker-compose.prod.yml exec api node dist/create-key.js --revoke <keyId>`             |
| Cek kesehatan        | `curl -s http://127.0.0.1:4000/health`                                                                    |

Jika Anda mengubah `.env`, jalankan `deploy.sh` lagi supaya perubahan dipakai.

## 17. Mengatasi masalah umum

| Gejala                                                        | Penyebab dan solusi                                                                                                                        |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Cloudflare **Error 521/522**                                  | Server atau Nginx mati. Jalankan `systemctl status nginx` dan `docker compose -f docker-compose.prod.yml ps`, lalu `deploy.sh` jika perlu. |
| Cloudflare **Error 526**                                      | Mode SSL bukan _Full (strict)_, atau sertifikat belum dibuat. Ulangi langkah 4 dan 8c.                                                     |
| Compare menampilkan _"We couldn't verify this browser"_       | Hostname di Turnstile tidak cocok dengan domain, atau Site/Secret Key tertukar (langkah 6 dan 9).                                          |
| Compare menampilkan _"Free comparisons are paused for today"_ | `DAILY_BUDGET_USD` sudah tercapai hari ini. Naikkan nilainya di `.env` lalu deploy ulang.                                                  |
| API membalas **502** terus-menerus                            | Saldo OpenRouter habis atau nama model berubah. Cek saldo di OpenRouter, lalu jalankan langkah 11.                                         |
| Deploy GitHub gagal di langkah SSH                            | Periksa ketiga secret di langkah 13 dan pastikan kunci publik ada di `authorized_keys`.                                                    |

## 18. Yang TIDAK BOLEH dilakukan

Perintah-perintah berikut **menghapus database secara permanen**. Jangan pernah menjalankannya:

- `docker compose -f docker-compose.prod.yml down -v`
- `docker volume rm ...`
- `docker system prune -a --volumes`

Selain itu:

- **Jangan mengedit file di `/opt/dualyne` langsung di server** (kecuali `.env`). Setiap deploy mengembalikan kode ke versi GitHub.
- **Jangan membagikan `.env`**, dan jangan menaruh key OpenRouter di website atau di GitHub.

## 19. Opsional: notifikasi masalah

Isi `ALERT_WEBHOOK_URL` di `.env` dengan URL webhook **Slack** atau **Discord** (di Discord: _Server Settings → Integrations → Webhooks_). Anda akan menerima pesan ketika:

- batas budget harian tercapai;
- saldo OpenRouter habis;
- ada model yang hilang dari katalog OpenRouter.

## 20. Saat token diluncurkan

Setelah kontrak token dan dompet treasury siap, isi nilai berikut di `.env` (langkah 9), lalu jalankan `deploy.sh`:

| Variabel                     | Isi                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `SIWE_CHAIN_ID`              | ID jaringan token (1 = Ethereum, 8453 = Base, 42161 = Arbitrum)                |
| `RPC_URL`                    | Endpoint RPC untuk jaringan itu (Alchemy, Infura, QuickNode, dll.)             |
| `DLYN_TOKEN_ADDRESS`         | Alamat kontrak token                                                           |
| `HOLDER_MIN_DLYN`            | Jumlah token untuk tier Holder (default `100000`)                              |
| `TREASURY_WALLET_ADDRESS`    | Alamat dompet treasury yang menerima fee                                       |
| `USDG_TOKEN_ADDRESS`         | Alamat kontrak stablecoin (USDG) di jaringan yang sama                         |
| `TREASURY_START_BLOCK`       | Nomor blok saat dompet treasury mulai dipakai, supaya semua pemasukan tercatat |
| `NEXT_PUBLIC_DLYN_BUY_URL`   | Link tombol **Buy** (misalnya halaman swap)                                    |
| `NEXT_PUBLIC_DLYN_CHART_URL` | Link tombol **View chart** (misalnya DexScreener)                              |
| `NEXT_PUBLIC_EXPLORER_URL`   | Explorer jaringan, misalnya `https://basescan.org`                             |
| `NEXT_PUBLIC_X_URL`          | Link akun X, misalnya `https://x.com/dualyne` (boleh diisi sebelum peluncuran) |
| `NEXT_PUBLIC_TELEGRAM_URL`   | Link grup Telegram, misalnya `https://t.me/dualyne`                            |

Selama `DLYN_TOKEN_ADDRESS` kosong, kolom CA menampilkan **"Coming soon"** (tetap bisa disalin). Selama link X dan Telegram kosong, ikonnya tampil sebagai "coming soon" dan tidak bisa diklik. Setelah nilai diisi, jalankan `deploy.sh` lagi, karena nilai `NEXT_PUBLIC_*` dimasukkan ke website saat build.

Untuk **tier Builder** (kredit prabayar), isi juga:

| Variabel               | Isi                                                                             |
| ---------------------- | ------------------------------------------------------------------------------- |
| `DEPOSIT_ADDRESS`      | Alamat yang menerima top-up (boleh sama dengan dompet treasury)                 |
| `ETH_USD_FEED_ADDRESS` | Alamat price feed Chainlink ETH/USD di jaringan itu (kosongkan jika hanya USDG) |
| `BUILDER_MARKUP`       | Markup di atas biaya model (default `1.15` = +15%)                              |
| `CHAIN_CONFIRMATIONS`  | Jumlah konfirmasi sebelum top-up dan pemasukan dihitung (default `3`)           |

Setelah deploy:

- Wallet yang memegang token minimal `HOLDER_MIN_DLYN` otomatis menjadi **Holder**. Saldo dicek ulang tiap 5 menit.
- Bagian **Treasury** di website otomatis berganti dari "Sample data" ke angka asli setelah sinkronisasi pertama, paling lama 1 jam.
- Konversi fee ke stablecoin dan top-up saldo OpenRouter tetap dilakukan manual. Website hanya mencatat apa yang terlihat di blockchain.
- Top-up Builder dicek otomatis lewat hash transaksi dan dikreditkan satu kali saja. Tombol **Top up credits** di dashboard aktif setelah `DEPOSIT_ADDRESS` diisi.

## 21. Jika ada kecurangan voting

Jika leaderboard terlihat dimanipulasi, ubah `COMPARE_BLIND_MODE=always` di `.env` lalu jalankan `deploy.sh`. Semua perbandingan menjadi _blind_ (nama model disembunyikan sampai pengguna memilih), dan hanya vote blind yang dihitung di leaderboard mulai update malam berikutnya.

## 22. Deploy dengan PM2 di server yang sudah ada

Untuk server Ubuntu yang sudah menjalankan aplikasi lain dengan PM2 dan Caddy atau Nginx. Dualyne berjalan di sampingnya sebagai dua aplikasi PM2, `dualyne-api` dan `dualyne-web`:

- Memakai Node 22 sendiri di folder `.runtime/`; Node sistem dan aplikasi lain tidak berubah.
- Mendengarkan di `127.0.0.1` saja (port 3100 dan 4100).
- Jika Caddy sudah melayani port 80, Dualyne menambahkan file Caddy sendiri (`dualyne.caddy`) plus satu baris `import` di Caddyfile, dan Caddy mengurus HTTPS sendiri. Jika tidak, Dualyne memakai Nginx (`dualyne.conf`) dengan certbot.
- Tidak menyentuh situs, database, atau aplikasi PM2 lain.
- DNS boleh tetap di Hostinger.

### 22.1 DNS (di panel domain)

Tiga record berikut harus mengarah ke IP server:

| Jenis | Nama  | Konten           |
| ----- | ----- | ---------------- |
| A     | `@`   | IP server        |
| CNAME | `www` | `domainanda.com` |
| A     | `api` | IP server        |

### 22.2 Ambil kode

Repository public: cukup clone lewat HTTPS, tanpa kunci.

```bash
git clone -b BRANCH https://github.com/OWNER/REPO.git /var/www/dualyne
cd /var/www/dualyne
```

### 22.3 Repository private (lewati jika public)

Beri server kunci baca saja:

```bash
ssh-keygen -t ed25519 -N "" -C "dualyne-server" -f /root/.ssh/dualyne_deploy
cat /root/.ssh/dualyne_deploy.pub
```

Salin baris yang muncul. Di GitHub, buka **repository → Settings → Deploy keys → Add deploy key**, tempel, dan **jangan** centang _Allow write access_. Lalu clone lewat SSH:

```bash
GIT_SSH_COMMAND="ssh -i /root/.ssh/dualyne_deploy -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new" \
  git clone -b BRANCH git@github.com:OWNER/REPO.git /var/www/dualyne
cd /var/www/dualyne
git config core.sshCommand "ssh -i /root/.ssh/dualyne_deploy -o IdentitiesOnly=yes"
```

### 22.4 Siapkan server (sekali, aman diulang)

```bash
cd /var/www/dualyne
EMAIL=emailanda@contoh.com bash deploy/pm2/setup.sh
```

Script ini:

- memasang yang belum ada saja (Postgres, Redis; Nginx dan certbot hanya jika tidak ada Caddy);
- membuat database `dualyne` dan file `.env` berisi rahasia acak;
- menambahkan situs Dualyne ke Caddy atau Nginx, lalu HTTPS: Caddy mengambil sertifikat sendiri (juga untuk nama yang DNS-nya menyusul); dengan Nginx, certbot mengambilnya untuk nama yang DNS-nya sudah benar.

Dengan Caddy, Caddyfile dicek dulu (`caddy validate`) sebelum di-reload. Jika ditolak, Caddyfile dikembalikan seperti semula dan situs lain tetap berjalan.

Jika port 3100/4100 sudah dipakai, script berhenti dan memberi tahu. Pilih port lain: `WEB_PORT=3200 API_PORT=4200 bash deploy/pm2/setup.sh`.

### 22.5 Kunci model di `.env` (boleh menyusul)

Tanpa kunci ini website tetap online dalam mode _preview_: semua halaman tampil, tetapi tombol Compare dan API menjawab "segera dibuka". Kunci bisa diisi kapan saja, lalu jalankan `deploy.sh` lagi.

- `OPENROUTER_API_KEY`: dari openrouter.ai → Keys (langkah 7).
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` dan `TURNSTILE_SECRET_KEY`: dari dash.cloudflare.com → Turnstile → Add widget, domain `domainanda.com` (gratis; DNS **tidak** perlu dipindah ke Cloudflare). Wajib begitu `OPENROUTER_API_KEY` diisi, supaya bot tidak menghabiskan saldo OpenRouter.
- Opsional: `NEXT_PUBLIC_X_URL` dan `NEXT_PUBLIC_TELEGRAM_URL`.

Mengisi tanpa editor (terminal menanyakan kunci satu per satu, dan kunci tidak masuk history):

```bash
cd /var/www/dualyne && read -rp "OpenRouter API key: " K1 && read -rp "Turnstile SITE key: " K2 && read -rp "Turnstile SECRET key: " K3 && sed -i -e "s|^OPENROUTER_API_KEY=.*|OPENROUTER_API_KEY=$K1|" -e "s|^NEXT_PUBLIC_TURNSTILE_SITE_KEY=.*|NEXT_PUBLIC_TURNSTILE_SITE_KEY=$K2|" -e "s|^TURNSTILE_SECRET_KEY=.*|TURNSTILE_SECRET_KEY=$K3|" .env && bash deploy/pm2/deploy.sh
```

### 22.6 Deploy

```bash
cd /var/www/dualyne
bash deploy/pm2/deploy.sh
```

Build pertama makan waktu 2–5 menit dan butuh sekitar 1,5 GB RAM kosong (cek dengan `free -h`). Di akhir, `pm2 list` menampilkan `dualyne-api` dan `dualyne-web` berstatus **online**, di samping aplikasi Anda yang lain.

### 22.7 Update berikutnya

```bash
cd /var/www/dualyne && bash deploy/pm2/deploy.sh
```

### 22.8 Perintah berguna

```bash
pm2 list                                  # semua aplikasi, termasuk dualyne-api dan dualyne-web
pm2 logs dualyne-api --lines 100          # log API
pm2 logs dualyne-web --lines 100          # log website
pm2 restart dualyne-api dualyne-web       # restart Dualyne saja
bash deploy/pm2/setup.sh                  # ulangi jika sertifikat api.* belum terbit karena DNS
```

Cek model OpenRouter (seperti langkah 11):

```bash
cd /var/www/dualyne/apps/api && set -a && . ../../.env && set +a && ../../.runtime/node/bin/node dist/resolve-models.js
```
