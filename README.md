# Cuti Digital API

Backend CRUD sederhana menggunakan Elysia, Bun, dan Google Sheets sebagai penyimpanan data.

## Menjalankan aplikasi

1. Aktifkan **Google Sheets API** di Google Cloud project.
2. Buat service account dan siapkan email serta private key-nya.
3. Bagikan spreadsheet kepada email service account dengan akses **Editor**.
4. Salin `.env.example` menjadi `.env`, lalu isi konfigurasi Google Sheets.
5. Jalankan server:

```bash
bun run dev
```

Server berjalan di `http://localhost:3000` secara default. Atur `PORT` untuk mengganti port.

Tab bernama `Cuti` dan header kolom akan dibuat otomatis saat API pertama kali dipakai. Nama tab bisa diubah dengan `GOOGLE_SHEET_TAB`. Jika tab sudah memiliki header, urutan kolomnya harus sama seperti berikut:

```text
id,nama,nik,tanggalMulai,tanggalSelesai,alasan,status,createdAt,updatedAt
```

`GOOGLE_SHEET_ID` adalah bagian ID dari URL spreadsheet, yaitu teks di antara `/d/` dan `/edit`.

## Konfigurasi

| Variabel | Wajib | Keterangan |
| --- | --- | --- |
| `PORT` | Tidak | Port server, default `3000` |
| `GOOGLE_SHEET_ID` | Ya | ID spreadsheet Google |
| `GOOGLE_SHEET_TAB` | Tidak | Nama tab, default `Cuti` |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Ya | Email service account |
| `GOOGLE_PRIVATE_KEY` | Ya | Private key PEM service account; gunakan `\n` untuk baris baru di file `.env` |

Jangan commit file `.env` atau private key ke repository.

## Endpoint

Semua endpoint mengembalikan JSON. Data pengajuan menggunakan field `nama`, `nik`, `tanggalMulai`, `tanggalSelesai`, `alasan`, dan `status`. Status yang tersedia: `Menunggu`, `Disetujui`, dan `Ditolak`. Jika status tidak dikirim saat membuat data, nilainya menjadi `Menunggu`.

| Method | Endpoint | Fungsi |
| --- | --- | --- |
| `GET` | `/health` | Cek server |
| `GET` | `/api/cuti` | Ambil semua pengajuan |
| `GET` | `/api/cuti/:id` | Ambil satu pengajuan |
| `POST` | `/api/cuti` | Buat pengajuan |
| `PUT` | `/api/cuti/:id` | Perbarui pengajuan |
| `DELETE` | `/api/cuti/:id` | Hapus pengajuan |

Contoh membuat pengajuan:

```bash
curl -X POST http://localhost:3000/api/cuti \
  -H "Content-Type: application/json" \
  -d '{"nama":"Budi","nik":"123456","tanggalMulai":"2026-10-12","tanggalSelesai":"2026-10-13","alasan":"Keperluan keluarga"}'
```

Saat memperbarui data, kirim kembali seluruh field pengajuan seperti pada contoh `POST`. `status` boleh dikosongkan; nilai status saat ini akan dipertahankan.
