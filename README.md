# Refract — paket untuk Claude Code

Isi folder:
- `CLAUDE_CODE_PROMPT.md` — prompt yang dikirim ke Claude Code
- `docs/refract.html` — website yang sudah jadi (desain final)
- `docs/HANDOFF.md` — spesifikasi backend

## Cara pakai
1. Ekstrak zip ini, lalu buka foldernya di terminal.
2. Jalankan `git init` supaya Claude Code bisa commit.
3. Jalankan `claude` di folder ini.
4. Salin isi `CLAUDE_CODE_PROMPT.md` (di bawah garis) dan kirim ke Claude Code.
5. Claude Code akan menulis `PLAN.md` dulu lalu berhenti. Cek, lalu balas "lanjut".
6. Ulangi "lanjut" setelah setiap fase selesai dan dicek.

## Yang perlu disiapkan sebelum Phase 2 (deploy)
- Domain (misalnya dari Namecheap atau Cloudflare)
- VPS Ubuntu 22.04+, minimal 2 vCPU dan 4 GB RAM
- Akun Cloudflare (gratis) dan akun GitHub
- Akun OpenRouter dengan saldo awal ($300–1,000 disarankan)
- Nama brand, simbol token, dan link sosial final
