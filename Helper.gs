function hashPassword(password) {
  try {
    if (!password) {
      throw new Error('Password tidak boleh kosong');
    }

    const digest = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      password + SECRETS.PWD_SALT
    );

    const hexString = digest.map(function(byte) {
      return ('0' + (byte & 0xFF).toString(16)).slice(-2);
    }).join('');

    return hexString;
  } catch (error) {
    Logger.log('Error in hashPassword: ' + error.toString());
    throw error;
  }
}

function compareHash(password, hash) {
  try {
    const hashP = hashPassword(password);
    return hashP === hash;
  } catch (error) {
    Logger.log('Error in compareHash: ' + error.toString());
    return false;
  }
}

function verifyJWT(token) {
  try {
    if (!token) {
      return false;
    }

    const parts = token.split('.');
    if (parts.length !== 3) {
      Logger.log('Invalid JWT format');
      return false;
    }

    const encodedHeader = parts[0];
    const encodedPayload = parts[1];
    const providedSignature = parts[2];

    // 1. Verifikasi Signature (timing-safe comparison)
    const toSign = encodedHeader + '.' + encodedPayload;
    const expectedSignatureBytes = Utilities.computeHmacSha256Signature(toSign, SECRETS.JWT_SECRET);
    const expectedSignature = Utilities.base64EncodeWebSafe(expectedSignatureBytes).replace(/=+$/, '');

    // Timing-safe comparison
    if (providedSignature.length !== expectedSignature.length) {
      Logger.log('JWT signature mismatch');
      return false;
    }
    
    let mismatch = 0;
    for (let i = 0; i < providedSignature.length; i++) {
      mismatch |= providedSignature.charCodeAt(i) ^ expectedSignature.charCodeAt(i);
    }
    
    if (mismatch !== 0) {
      Logger.log('JWT signature mismatch');
      return false;
    }

    // 2. Decode dan Verifikasi Payload
    try {
      const decodedBytes = Utilities.base64DecodeWebSafe(encodedPayload);
      const decodedText = Utilities.newBlob(decodedBytes).getDataAsString();
      const payload = JSON.parse(decodedText);

      // 3. Verifikasi Expired
      const currentTime = Math.floor(Date.now() / 1000);

      if (payload.exp && payload.exp <= currentTime) {
        Logger.log('JWT token expired');
        return false;
      }

      return payload;

    } catch (e) {
      Logger.log('Error decoding JWT payload: ' + e.toString());
      return false;
    }

  } catch (error) {
    Logger.log('Error in verifyJWT: ' + error.toString());
    return false;
  }
}

function createJWT(payload) {
  try {
    // 1. Definisikan Header
    const header = {
      alg: 'HS256',
      typ: 'JWT'
    };

    // Fungsi helper untuk Base64Url Encode
    function base64UrlEncode(obj) {
      return Utilities.base64EncodeWebSafe(JSON.stringify(obj)).replace(/=+$/, '');
    }

    // 2. Encode Header dan Payload
    const encodedHeader = base64UrlEncode(header);
    const encodedPayload = base64UrlEncode(payload);

    // 3. Buat Signature
    const toSign = encodedHeader + '.' + encodedPayload;
    const signatureBytes = Utilities.computeHmacSha256Signature(toSign, SECRETS.JWT_SECRET);
    const encodedSignature = Utilities.base64EncodeWebSafe(signatureBytes).replace(/=+$/, '');

    // 4. Gabungkan menjadi format JWT
    return toSign + '.' + encodedSignature;

  } catch (error) {
    Logger.log('Error in createJWT: ' + error.toString());
    throw error;
  }
}

function isEmptyStatus_(value) {
  // Normalisasi nilai "kosong" dari sel Google Sheets.
  // Sel yang belum diisi bisa terbaca sebagai '', null, undefined,
  // atau string berisi spasi saja — semuanya harus dianggap kosong.
  if (value === null || value === undefined) return true;
  return value.toString().trim() === '';
}

function filterRoleStatus(role, statusList) {
  if (!statusList || statusList.length === 0) {
    return role === 1;
  }

  // 'Ditolak' pada tahap manapun bersifat final
  const rejectedIndex = statusList.findIndex((s) => s === 'Ditolak');
  if (rejectedIndex !== -1) {
    return false;
  }

  for (let i = 0; i < statusList.length; i++) {
    if (isEmptyStatus_(statusList[i])) {
      // i tahap sebelumnya sudah terverifikasi (index 0..i-1)
      // 1 -> 2, 2 -> 3, 3 -> 4
      return i > 0 ? role === (i + 1) : role === 1;
    }
  }

  // Semua tahap terisi dan tidak ada yang kosong / ditolak
  // Sudah selesai (ACC), tidak ada role yang perlu handle
  return false;
}

function determineOverallStatus(statusList) {
  if (!statusList || statusList.length === 0) {
    return 'pending';
  }

  // 'Ditolak' pada tahap manapun bersifat final
  const rejectedIndex = statusList.findIndex((s) => s === 'Ditolak');
  if (rejectedIndex !== -1) {
    return 'rejected';
  }

  for (let i = 0; i < statusList.length; i++) {
    if (isEmptyStatus_(statusList[i])) {
      // i tahap sebelumnya sudah terverifikasi (index 0..i-1)
      return i > 0 ? `pending-${i}` : 'pending';
    }
  }

  // Semua tahap terisi dan tidak ada yang kosong / ditolak
  if (statusList[statusList.length - 1] === 'ACC') {
    return 'approved';
  }

  return 'pending';
}

function generateApprovals(statusList, detailStatus = []) {
  const approvals = [
    { level: 1, status: 'current' },
    { level: 2, status: 'pending' },
    { level: 3, status: 'pending' },
    { level: 4, status: 'pending' },
  ];

  if (!statusList || statusList.length === 0) return approvals;

  for (let i = 0; i < statusList.length; i++) {
    const status = statusList[i];
    const approval = approvals[i];

    if (isEmptyStatus_(status)) {
      if (i === 0) break;
      approval.status = 'current';
      break;
    }

    const [ reason, name, date ] = detailStatus[i]?.split('|') ?? ['', '', ''];
    approval.name = name || null;
    approval.date = Number(date) || null;

    if (status === 'Ditolak') {
      approval.status = 'rejected';
      approval.reason = reason;
      break;
    }

    approval.status = 'approved';
  }

  return approvals;
}

function getOverlapLeaves(rows, unit, start, end) {
  return rows.filter(row => row['unit kerja'] === unit && new Date(row['tanggal mulai cuti']).getTime() <= end && new Date(row['tanggal selesai cuti']).getTime() >= start)
}

function formatDate(date) {
  try {
    if (!date) return '';

    const d = new Date(date);
    const formatter = new Intl.DateTimeFormat('id-ID', {
      timeZone: Session.getScriptTimeZone(),
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    })

    return formatter.format(d);

  } catch (error) {
    Logger.log('Error in formatDate: ' + error.toString());
    return '';
  }
}

function formatDateTime(date) {
  try {
    if (!date) return '';

    const d = new Date(date);
    const formatter = new Intl.DateTimeFormat('id-ID', {
      timeZone: Session.getScriptTimeZone(),
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    })

    return formatter.format(d);

  } catch (error) {
    Logger.log('Error in formatDateTime: ' + error.toString());
    return '';
  }
}

function groupForChart(data, period) {
  const now = new Date();

  // Tentukan batas periode
  const start = new Date(now);

  if (period === 'today') {
    start.setHours(0, 0, 0, 0);
  }

  else if (period === 'week') {
    start.setDate(start.getDate() - 6); // 7 hari terakhir termasuk hari ini
    start.setHours(0, 0, 0, 0);
  }

  else if (period === 'month') {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  }

  else if (period === 'year') {
    start.setMonth(0, 1);
    start.setHours(0, 0, 0, 0);
  }

  const dayNames = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
  const groups = {};

  let totalLeaves = 0
  let pending = 0
  let approved = 0
  let rejected = 0

  const requestChart = { label: [], data: [] }
  const typeChart = { label: [], data: [] }
  const statusChart = { label: [], data: [] }
  const unitChart = { label: [], data: [] }

  // Objek penampung untuk hitung per kategori (type, status, unit)
  const typeCounts = {};
  const statusCounts = { 'Menunggu Persetujuan': 0, ACC: 0, Ditolak: 0 };
  const unitCounts = {};

  for (const item of data) {
    const date = new Date(item.timestamp);

    // Hanya data dalam periode yang dipilih
    if (date < start || date > now) {
      continue;
    }

    totalLeaves++;

    const status = determineOverallStatus([
      item['status 1 (atasan langsung)'],
      item['status 2 (kepegawaian)'],
      item['status 3 (kasubag tu)'],
      item['status 4 (kepala puskesmas)']
    ]);

    if (status.startsWith('pending')) {
      pending++;
      statusCounts['Menunggu Persetujuan']++;
    } else if (status === 'approved') {
      approved++;
      statusCounts.ACC++;
    } else if (status === 'rejected') {
      rejected++;
      statusCounts.Ditolak++;
    }
    // Hitung berdasarkan jenis cuti
    const jenis = item['jenis cuti'];
    typeCounts[jenis] = (typeCounts[jenis] || 0) + 1;

    // Hitung berdasarkan unit/bagian
    const unit = item['unit kerja'];
    unitCounts[unit] = (unitCounts[unit] || 0) + 1;

    let key;

    if (period === 'today') {
      key = String(date.getHours()).padStart(2, '0') + ':00';
    }

    else if (period === 'week') {
      key = dayNames[date.getDay()];
    }

    else if (period === 'month') {
      key = date.getDate();
    }

    else if (period === 'year') {
      key = date.getMonth() + 1;
    }

    groups[key] = (groups[key] || 0) + 1;
  }

  // Bangun label & data sesuai urutan yang benar per period
  let labels = [];
  let chartLabels = []; // label yang ditampilkan di chart (bisa berbeda dari key groups)

  if (period === 'today') {
    labels = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0') + ':00');
    chartLabels = labels;
  }

  else if (period === 'week') {
    labels = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
    chartLabels = labels;
  }

  else if (period === 'month') {
    // Jumlah hari dalam bulan berjalan
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const currentMonthName = monthNames[now.getMonth()];
    labels = Array.from({ length: daysInMonth }, (_, i) => i + 1); // key tetap angka untuk lookup ke groups
    chartLabels = labels.map((d) => `${d} ${currentMonthName}`); // label tampilan: "1 Sep", "2 Sep", ...
  }

  else if (period === 'year') {
    labels = Array.from({ length: 12 }, (_, i) => i + 1);
    chartLabels = labels;
  }

  const chartData = labels.map((label) => groups[label] || 0);

  requestChart.label = chartLabels;
  requestChart.data = chartData;

  // typeChart: label = jenis cuti, data = jumlahnya
  delete typeCounts[''];
  typeChart.label = Object.keys(typeCounts);
  typeChart.data = Object.values(typeCounts);

  // statusChart: label tetap Pending/Approved/Rejected, hilangkan yang nilainya 0
  delete statusCounts[''];
  const filteredStatusEntries = Object.entries(statusCounts).filter(([, value]) => value !== 0);
  statusChart.label = filteredStatusEntries.map(([key]) => key);
  statusChart.data = filteredStatusEntries.map(([, value]) => value);

  // unitChart: label = nama unit, data = jumlahnya
  delete unitCounts['']
  unitChart.label = Object.keys(unitCounts);
  unitChart.data = Object.values(unitCounts);

  return {
    totalLeaves,
    pending,
    approved,
    rejected,
    requestChart,
    typeChart,
    statusChart,
    unitChart
  };
}

function sendWhatsApp(phone, message) {
  if (!SECRETS.FONNTE_API_KEY) {
    Logger.log('FONNTE_API_KEY not configured');
    return;
  }
  const response = UrlFetchApp.fetch('https://api.fonnte.com/send', {
    method: 'post',
    payload: {
      target: phone,
      message,
      delay: 2,
    },
    headers: {
      Authorization: SECRETS.FONNTE_API_KEY
    }
  });
  console.log(response.getContentText())
}

function sendEmail(email, subject, body) {
  const send = GmailApp.sendEmail(email, subject, body);
}

function parseGoogleDriveUrl(url) {
  // Pisahkan path dari query string
  var qIndex = url.indexOf("?");
  var pathPart = qIndex === -1 ? url : url.substring(0, qIndex);
  var queryPart = qIndex === -1 ? "" : url.substring(qIndex + 1);

  // Ambil pathname saja (buang https://domain)
  var pathname = pathPart.replace(/^https?:\/\/[^/]+/, "");

  // Folder: /drive/folders/{ID}
  var folderMatch = pathname.match(/^\/drive\/folders\/([^/?]+)/);
  if (folderMatch) {
    return {
      type: "folder",
      id: folderMatch[1]
    };
  }

  // File: /file/d/{ID}/...
  var filePathMatch = pathname.match(/^\/file\/d\/([^/?]+)/);
  if (filePathMatch) {
    return {
      type: "file",
      id: filePathMatch[1]
    };
  }

  // File: ?id={ID}
  var fileId = getQueryParam(queryPart, "id");
  if (fileId) {
    return {
      type: "file",
      id: fileId
    };
  }

  return {};
}

function getQueryParam(queryString, key) {
  if (!queryString) return null;
  var pairs = queryString.split("&");
  for (var i = 0; i < pairs.length; i++) {
    var kv = pairs[i].split("=");
    var k = decodeURIComponent(kv[0] || "");
    var v = decodeURIComponent(kv[1] || "");
    if (k === key) return v;
  }
  return null;
}

function parseLampiran(links) {
  if (!links) return null;
  const output = links.split(',').map(li => {
    return {name: li, link:li}
  })
  return output
}

function dapatkanTanggalPenuhUnit(unitTarget, limit) {
  const rekapTanggal = {};
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  const rows = sheetRead(TABLES.LEAVES, row => 
    row[COLUMNS.LEAVE.NAMA] && 
    row[COLUMNS.LEAVE.UNIT] === unitTarget &&
    LeaveModel.isValidLeave(row)
  );

  rows.forEach(row => {
    // Pastikan objek Date diinisialisasi dengan benar
    let tglSekarang = new Date(row[COLUMNS.LEAVE.TGL_MULAI]);
    const tglAkhir = new Date(row[COLUMNS.LEAVE.TGL_SELESAI]);

    // Normalisasi ke jam 00:00:00 agar perbandingan tanggal presisi
    tglSekarang.setHours(0, 0, 0, 0);
    tglAkhir.setHours(0, 0, 0, 0);

    while (tglSekarang.getTime() <= tglAkhir.getTime()) {
      const strTanggal = formatter.format(tglSekarang);
      rekapTanggal[strTanggal] = (rekapTanggal[strTanggal] || 0) + 1;

      // Tambah 1 hari secara aman
      tglSekarang.setDate(tglSekarang.getDate() + 1);
    }
  });

  return Object.keys(rekapTanggal).filter((tgl) => rekapTanggal[tgl] >= limit);
}
// === Contoh Penggunaan ===

// const dataPengajuan = [
//   { unit: "IT", tglMulai: "2026-10-01", tglSelesai: "2026-10-03" },
//   { unit: "IT", tglMulai: "2026-10-02", tglSelesai: "2026-10-04" },
//   { unit: "IT", tglMulai: "2026-10-02", tglSelesai: "2026-10-02" },
//   { unit: "HRD", tglMulai: "2026-10-01", tglSelesai: "2026-10-02" }
// ];

// Cek tanggal penuh khusus unit "IT" dengan limit maksimal 2 orang bersamaan
// const tglPenuhIT = dapatkanTanggalPenuhUnit(dataPengajuan, "IT", 2);

// console.log(tglPenuhIT);
// Output: [ '2026-10-02', '2026-10-03' ]

// ponytail: Test function removed for production. Re-add for debugging with specific test cases.