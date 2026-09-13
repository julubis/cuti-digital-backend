const SPREADSHEET_ID = '10EqKavSoIU_89wtocVDjfxFw4EV8Ap7sCczAyrJluWA';
const JWT_SECRET = PropertiesService.getScriptProperties().getProperty('JWT_SECRET') || (() => { throw new Error('JWT_SECRET not configured'); })();
const DEFAULT_PWD_HASH = '5a221cc1e7d52cef1239a411924e803d6b863e03a3a7af258fc8acaee0f82f21';
const PWD_SALT = PropertiesService.getScriptProperties().getProperty('PWD_SALT') || (() => { throw new Error('PWD_SALT not configured'); })();
const FONNTE_API_KEY = PropertiesService.getScriptProperties().getProperty('FONNTE_API_KEY') || '';

const SHEET_CACHE_TTL_SECONDS = 21600;
const SHEET_CACHE_CHUNK_SIZE = 90000;
const LOCK_TIMEOUT_MS = 30000;

// const sheetApp = SpreadsheetApp.openById(SPREADSHEET_ID);
const sheetApp = SpreadsheetApp.getActiveSpreadsheet();
const userTable = 'Sheet1';
const leaveTable = 'Pengajuan';
const limitTable = 'Limit Cuti Unit Kerja';

const USER_ROLE = {
  "Pegawai": 0,
  "Atasan Langsung": 1,
  "Tim Kepegawaian": 2,
  "Kasubag TU": 3,
  "Kepala Puskesmas": 4
}

// Logic Application
// delete cache when edit spreadsheet
function onEdit(e) {
  invalidateSheetCache(sheetApp.getActiveSheet().getName());
}

function doGet(e) {
  try {
    var CDN_BASE_URL = PropertiesService
    .getScriptProperties()
    .getProperty('CDN_BASE_URL');
  
  var VERSION = PropertiesService
    .getScriptProperties()
    .getProperty('VERSION');
  
  var html = HtmlService.createTemplateFromFile('index');
  html.cdnBaseUrl = CDN_BASE_URL;
  html.version = VERSION;
  
  return html
    .evaluate()
    .setTitle('Sistem Cuti Digital - Puskesmas Kramat Jati');
  } catch (error) {
    Logger.log('Error in doGet: ' + error.toString());
    return HtmlService.createHtmlOutput('<h1>Error loading application</h1><p>' + error.toString() + '</p>');
  }

}

function login(username, password) {
  try {
    if (!username || !password) {
      return {
        status: false,
        data: null,
        message: 'Username dan password harus diisi'
      };
    }

    const hash = hashPassword(password);
    const usernameLower = username.toString().toLowerCase().trim();
    const user = sheetReadOne(userTable, (row) => row.nama && row.nama.toString().toLowerCase().trim() === usernameLower && row.password == hash)

    if (!user) {
      return {
        status: false,
        data: null,
        message: 'Nama atau password tidak valid'
      };
    }

    const jwt = createJWT({
      name: user.nama,
      role: Number(USER_ROLE[user.role]) || 0,
      pangkat: user['pangkat/golongan'],
      nip: user['nip/nrk'],
      position: user.jabatan,
      status: user.status,
      unit: user['unit kerja'],
      email: user.email,
      phone: user['no hp'],
      emptyNIP: user['nip/nrk'] == '',
      defaultPassword: user.password == DEFAULT_PWD_HASH,
      exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // Expire 24 jam
    });

    return {
      status: true,
      data: jwt,
      message: 'Login berhasil'
    };

  } catch (error) {
    Logger.log('Error in login: ' + error.toString());
    return {
      status: false,
      data: null,
      message: 'Terjadi kesalahan saat login: ' + error.toString()
    };
  }
}

function editProfile(token, data) {
  const payload = verifyJWT(token);
  if (!payload) {
    return {
      status: false,
      message: 'Token tidak valid atau sudah kadaluarsa'
    };
  }

  const { nip, position, pangkat, email, phone } = data;
  try {
    const newData = sheetUpdate(userTable, (row) => row.nama === payload.name, { 
      'nip/nrk': nip, 
      jabatan: position, 
      'pangkat/golongan': pangkat,
      email,
      'no hp': phone
    })
    const token = createJWT({
      name: newData.nama,
      role: Number(USER_ROLE[newData.role]) || 0,
      pangkat: newData['pangkat/golongan'],
      nip: newData['nip/nrk'],
      position: newData.jabatan,
      status: newData.status,
      unit: newData['unit kerja'],
      email: newData.email,
      phone: newData['no hp'],
      emptyNIP: newData['nip/nrk'] == '',
      defaultPassword: newData.password == DEFAULT_PWD_HASH,
      exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60)
    })

    return {
      status: true,
      data: token
    };
  } catch(e) {
    return {
      status: false,
      message: e
    };
  }
}

function changePassword(token, data) {
  const payload = verifyJWT(token);
  if (!payload) {
    return {
      status: false,
      message: 'Token tidak valid atau sudah kadaluarsa'
    };
  }

  const { oldPassword, newPassword, confirmPassword } = data;
  try {
    if (!newPassword || !confirmPassword || !oldPassword) {
      return {
        status: false,
        data: null,
        message: 'Semua field harus diisi'
      }
    }

    if (newPassword.length < 8) {
      return {
        status: false,
        data: null,
        message: 'Password baru minimal 8 karakter'
      }
    }

    if (newPassword === '12345678') {
      return {
        status: false,
        data: null,
        message: 'Password baru tidak boleh "12345678"'
      }
    }

    if (confirmPassword !== newPassword) {
      return {
        status: false,
        data: null,
        message: 'Password baru dan konfirmasi tidak sama'
      }
    }
    const newData = sheetUpdate(userTable, (row) => row.nama === payload.name && row.password === hashPassword(oldPassword), { 
      password: hashPassword(newPassword)
    })

    const newToken = createJWT({
      name: newData.nama,
      role: Number(USER_ROLE[newData.role]) || 0,
      pangkat: newData['pangkat/golongan'],
      nip: newData['nip/nrk'],
      position: newData.jabatan,
      status: newData.status,
      unit: newData['unit kerja'],
      email: newData.email,
      phone: newData['no hp'],
      emptyNIP: newData['nip/nrk'] == '',
      defaultPassword: false,
      exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60)
    })

    return {
      status: true,
      data: newToken
    };
  } catch(e) {
    if (e === 'DATA_NOT_FOUND') {
      return {
        status: false,
        message: 'Password lama Anda salah.'
      };
    }
    return {
      status: false,
      message: JSON.stringify(e)
    };
  }
}

function getUsers() {
  try {
    const users = sheetRead(userTable);

    const employees = users
      .filter(row => row.nama)
      .map(row => ({
        id: row.id,
        name: row.nama,
        unit: row['unit kerja']
      }));

    return {
      status: true,
      data: employees,
      message: null
    };

  } catch (error) {
    Logger.log('Error in getUsers: ' + error.toString());
    return {
      status: false,
      data: null,
      message: 'Gagal mengambil data pegawai: ' + error.toString()
    };
  }
}

function getDashboardData(token, period='today') {
  try {
    // Validasi token
    const payload = verifyJWT(token);
    if (!payload) {
      return {
        status: false,
        data: null,
        message: 'Token tidak valid atau sudah kadaluarsa'
      };
    }
    // const payload = {role: 0, unit: 'Admen'}

    const rows = sheetRead(leaveTable, (row) => row.nama && (payload.role > 1 ? true : row['unit kerja'] === payload.unit))
    const notes = getSheetNoteCached_(leaveTable);
    const unitLimit = Object.fromEntries(
      sheetRead(limitTable).map(item => [item['unit kerja'], item.jumlah])
    ); 
    const unitGroup = rows.reduce((acc, { ...rest }) => {
      acc[rest['unit kerja']] = acc[rest['unit kerja']] || [];
      acc[rest['unit kerja']].push({
        id: rest.id,
        employee: rest.nama,
        leaveType: rest['jenis cuti'],
        startDate: new Date(rest['tanggal mulai cuti']).getTime() || null,
        endDate: new Date(rest['tanggal selesai cuti']).getTime() || null,
        duration: rest['jumlah hari'],
        status: determineOverallStatus([
          rest['status 1 (atasan langsung)'],
          rest['status 2 (kepegawaian)'],
          rest['status 3 (kasubag tu)'],
          rest['status 4 (kepala puskesmas)']
        ])
      });
      return acc;
    }, {})

    const stats = groupForChart(rows, period)
    const lenRows = rows.length
    const leaveList = new Array(lenRows);
    for (let i = 0; i < lenRows; i++) {
      const status = determineOverallStatus([
        rows[i]['status 1 (atasan langsung)'],
        rows[i]['status 2 (kepegawaian)'],
        rows[i]['status 3 (kasubag tu)'],
        rows[i]['status 4 (kepala puskesmas)']
      ]);
      const note = notes[rows[i].id - 1]
      const startDate = new Date(rows[i]['tanggal mulai cuti']).getTime() || null
      const endDate = new Date(rows[i]['tanggal selesai cuti']).getTime() || null
      const unit = rows[i]['unit kerja']
      leaveList[lenRows - (i+1)] = {
        id: rows[i].id,
        employee: rows[i].nama,
        nip: rows[i]['nip/nrk'],
        leaveType: rows[i]['jenis cuti'],
        startDate,
        endDate,
        duration: rows[i]['jumlah hari'],
        unit,
        status,
        reason: rows[i]['alasan cuti'],
        approvals: generateApprovals([
          rows[i]['status 1 (atasan langsung)'],
          rows[i]['status 2 (kepegawaian)'],
          rows[i]['status 3 (kasubag tu)'],
          rows[i]['status 4 (kepala puskesmas)']
        ], note.slice(-4)),
        overlaps: unitGroup[unit]?.filter(leave => (leave.startDate <= endDate && leave.endDate >= startDate) && leave.id !== rows[i].id) ?? [],
        overlapLimit: unitLimit[unit],
      }
    }

    return {
      status: true,
      data: {
        ...stats,
        pendingApprovals: leaveList.filter(row => {
          if (payload.role <= 1 && row.unit !== payload.unit) return false;
          if (payload.role === 1 && row.status === 'pending') return true; 
          if (payload.role === 2 && row.status === 'pending-1') return true; 
          if (payload.role === 3 && row.status === 'pending-2') return true; 
          if (payload.role === 4 && row.status === 'pending-3') return true; 
          return false
        }).slice(0, 4), // Limit 5
        recentRequests: leaveList.splice(0, 15)
      },
      message: null
    };

  } catch (error) {
    Logger.log('Error in getDashboardStats: ' + error.toString());
    return {
      status: false,
      data: null,
      message: 'Gagal mengambil statistik dashboard: ' + error.toString()
    };
  }
}

function getLeaves(token, filter={}) {
  try {
    const payload = verifyJWT(token);
    if (!payload) {
      return {
        status: false,
        data: null,
        message: 'Token tidak valid atau sudah kadaluarsa'
      };
    }

    const search = (filter?.search || '').toString().trim().toLowerCase();
    const leaveTypeFilter = (filter?.leaveType || '').toString().trim();
    const unitFilter = (filter?.unit || '').toString().trim();
    const yearFilter = (filter?.year || '').toString().trim();
    const statusFilter = (filter?.status || '').toString().trim();

    const rows = sheetRead('Pengajuan', (row) => {
      if (!row.nama) return false;

      // Role 0 & 1 dibatasi unit sendiri; role 2, 3, 4 melihat semua unit
      if (payload.role <= 1 && row['unit kerja'] !== payload.unit) return false;

      // Filter unit kerja tambahan dari user (khusus role yang bisa lihat semua unit)
      if (unitFilter && row['unit kerja'] !== unitFilter) return false;

      if (search && !row.nama.toString().toLowerCase().includes(search)) return false;

      if (leaveTypeFilter && row['jenis cuti'] !== leaveTypeFilter) return false;

      if (yearFilter) {
        const ts = row.timestamp ? new Date(row.timestamp) : null;
        if (!ts || String(ts.getFullYear()) !== yearFilter) return false;
      }

      return true;
    });
    const notes = getSheetNoteCached_(leaveTable);
    const unitLimit = Object.fromEntries(
      sheetRead(limitTable).map(item => [item['unit kerja'], item.jumlah])
    ); 
    const unitGroup = rows.reduce((acc, { ...rest }) => {
      acc[rest['unit kerja']] = acc[rest['unit kerja']] || [];
      acc[rest['unit kerja']].push({
        employee: rest.nama,
        leaveType: rest['jenis cuti'],
        startDate: new Date(rest['tanggal mulai cuti']).getTime() || null,
        endDate: new Date(rest['tanggal selesai cuti']).getTime() || null,
        duration: rest['jumlah hari'],
        status: determineOverallStatus([
          rest['status 1 (atasan langsung)'],
          rest['status 2 (kepegawaian)'],
          rest['status 3 (kasubag tu)'],
          rest['status 4 (kepala puskesmas)']
        ])
      });
      return acc;
    }, {})

    const lenRows = rows.length;
    const leaveList = [];
    for (let i = 0; i < lenRows; i++) {
      const statusList = [
        rows[i]['status 1 (atasan langsung)'],
        rows[i]['status 2 (kepegawaian)'],
        rows[i]['status 3 (kasubag tu)'],
        rows[i]['status 4 (kepala puskesmas)']
      ];
      const status = determineOverallStatus(statusList);

      // Filter status akhir (pending/pending-1/.../approved/rejected) dari sisi user
      if (statusFilter && status !== statusFilter) continue;
      const note = notes[rows[i].id - 1]

      leaveList.push({
        id: rows[i].id,
        submittedDate: new Date(rows[i].timestamp).getTime() || null,
        employee: rows[i].nama,
        nip: rows[i]['nip/nrk'],
        leaveType: rows[i]['jenis cuti'],
        startDate: new Date(rows[i]['tanggal mulai cuti']).getTime() || null,
        endDate: new Date(rows[i]['tanggal selesai cuti']).getTime() || null,
        duration: rows[i]['jumlah hari'],
        unit: rows[i]['unit kerja'],
        status,
        attachment: parseLampiran(rows[i].lampiran),
        reason: rows[i]['alasan cuti'],
        approvals: generateApprovals(statusList, note.slice(-4))
      });
    }

    // Data terbaru di paling atas
    leaveList.reverse();

    return {
      status: true,
      data: leaveList
    };

  } catch (e) {
    console.log(e)
  }
}

function getLeaveApprovals(token, filter={}) {
  try {
    const payload = verifyJWT(token);
    if (!payload) {
      return {
        status: false,
        data: null,
        message: 'Token tidak valid atau sudah kadaluarsa'
      };
    }

    if (payload.role === 0) {
      return {
        status: false,
        data: null,
        message: 'Tidak ditemukan'
      };
    }

    const search = (filter?.search || '').toString().trim().toLowerCase();
    const leaveTypeFilter = (filter?.leaveType || '').toString().trim();
    const unitFilter = (filter?.unit || '').toString().trim();
    const yearFilter = (filter?.year || '').toString().trim();

    const rows = sheetRead(leaveTable, (row) => {
      if (!row.nama) return false;

      // Role 0 & 1 dibatasi unit sendiri; role 2, 3, 4 melihat semua unit
      if (payload.role <= 1 && row['unit kerja'] !== payload.unit) return false;

      // Filter unit kerja tambahan dari user (khusus role yang bisa lihat semua unit)
      if (unitFilter && row['unit kerja'] !== unitFilter) return false;

      if (search && !row.nama.toString().toLowerCase().includes(search)) return false;

      if (leaveTypeFilter && row['jenis cuti'] !== leaveTypeFilter) return false;

      if (yearFilter) {
        const ts = row.timestamp ? new Date(row.timestamp) : null;
        if (!ts || String(ts.getFullYear()) !== yearFilter) return false;
      }

      // Hanya tampilkan pengajuan yang memang berada di tahap approval milik role ini
      const isCurrentStage = filterRoleStatus(payload.role, [
        row['status 1 (atasan langsung)'],
        row['status 2 (kepegawaian)'],
        row['status 3 (kasubag tu)'],
        row['status 4 (kepala puskesmas)']
      ]);

      return isCurrentStage;
    });
    const notes = getSheetNoteCached_(leaveTable);
    const unitLimit = Object.fromEntries(
      sheetRead(limitTable).map(item => [item['unit kerja'], item.jumlah])
    ); 
    const unitGroup = rows.reduce((acc, { ...rest }) => {
      acc[rest['unit kerja']] = acc[rest['unit kerja']] || [];
      acc[rest['unit kerja']].push({
        id: rest.id,
        employee: rest.nama,
        leaveType: rest['jenis cuti'],
        startDate: new Date(rest['tanggal mulai cuti']).getTime() || null,
        endDate: new Date(rest['tanggal selesai cuti']).getTime() || null,
        duration: rest['jumlah hari'],
        status: determineOverallStatus([
          rest['status 1 (atasan langsung)'],
          rest['status 2 (kepegawaian)'],
          rest['status 3 (kasubag tu)'],
          rest['status 4 (kepala puskesmas)']
        ])
      });
      return acc;
    }, {})

    const lenRows = rows.length;
    const leaveList = new Array(lenRows);
    for (let i = 0; i < lenRows; i++) {
      const statusList = [
        rows[i]['status 1 (atasan langsung)'],
        rows[i]['status 2 (kepegawaian)'],
        rows[i]['status 3 (kasubag tu)'],
        rows[i]['status 4 (kepala puskesmas)']
      ];
      const status = determineOverallStatus(statusList);
      const note = notes[rows[i].id - 1]
      const startDate = new Date(rows[i]['tanggal mulai cuti']).getTime() || null
      const endDate = new Date(rows[i]['tanggal selesai cuti']).getTime() || null
      const unit = rows[i]['unit kerja']

      leaveList[lenRows - (i+1)] = {
        id: rows[i].id,
        submittedDate: new Date(rows[i].timestamp).getTime() || null,
        employee: rows[i].nama,
        nip: rows[i]['nip/nrk'],
        leaveType: rows[i]['jenis cuti'],
        startDate,
        endDate,
        duration: rows[i]['jumlah hari'],
        unit,
        status,
        attachment: parseLampiran(rows[i].lampiran),
        reason: rows[i]['alasan cuti'],
        approvals: generateApprovals(statusList, note.slice(-4)),
        overlaps: unitGroup[unit]?.filter(leave => leave.startDate <= startDate && leave.endDate >= endDate && leave.id !== rows[i].id) ?? [],
        overlapLimit: unitLimit[unit] ?? 0,
      }
    }

    return {
      status: true,
      data: leaveList
    };

  } catch (e) {
    console.log(e)
  }
}

function approveLeave(token, data) {
  const payload = verifyJWT(token);
  if (!payload) {
    return {
      status: false,
      data: null,
      message: 'Token tidak valid atau sudah kadaluarsa'
    };
  }

  const { employee, id, unit, status } = data;

  try {
    // Fresh read untuk overlap check
    const allLeaves = sheetRead(leaveTable, (row) => row.id === id || (row['unit kerja'] === unit && row.nama));
    const targetLeave = allLeaves.find(row => row.id === id);
    
    if (!targetLeave) {
      return { status: false, message: 'Data pengajuan tidak ditemukan' };
    }

    const startDate = new Date(targetLeave['tanggal mulai cuti']).getTime();
    const endDate = new Date(targetLeave['tanggal selesai cuti']).getTime();
    
    const unitLimit = sheetReadOne(limitTable, (row) => row['unit kerja'] === unit);
    const limit = unitLimit ? unitLimit.jumlah : 0;

    const overlaps = allLeaves.filter(row => 
      row.id !== id &&
      row['unit kerja'] === unit &&
      row['status 1 (atasan langsung)'] !== 'Ditolak' &&
      row['status 2 (kepegawaian)'] !== 'Ditolak' &&
      row['status 3 (kasubag tu)'] !== 'Ditolak' &&
      row['status 4 (kepala puskesmas)'] !== 'Ditolak' &&
      new Date(row['tanggal mulai cuti']).getTime() <= endDate &&
      new Date(row['tanggal selesai cuti']).getTime() >= startDate
    );

    if (overlaps.length >= limit) {
      return { 
        status: false, 
        message: `Limit cuti unit ${unit} sudah terpenuhi (${overlaps.length}/${limit} orang)`
      };
    }

    if (payload.role === 1 && payload.unit === unit && status === 'pending') {
      sheetUpdate(leaveTable, (row) => row.id === id && row.nama === employee && row['unit kerja'] === unit && row['status 1 (atasan langsung)'] === '', { 
        'status 1 (atasan langsung)': 'Terverifikasi'
      });
      sheetAddNote(leaveTable, `P${id}`, `|${payload.name}|${Date.now()}`)
      return { status: true};
    }

    if (payload.role === 2 && status === 'pending-1') {
      sheetUpdate(leaveTable, (row) => row.id === id && row.nama === employee && row['unit kerja'] === unit && row['status 2 (kepegawaian)'] === '', { 
        'status 2 (kepegawaian)': 'Terverifikasi'
      });
      sheetAddNote(leaveTable, `Q${id}`, `|${payload.name}|${Date.now()}`)
      return { status: true};
    }

    if (payload.role === 3 && status === 'pending-2') {
      sheetUpdate(leaveTable, (row) => row.id === id && row.nama === employee && row['unit kerja'] === unit && row['status 3 (kasubag tu)'] === '', { 
        'status 3 (kasubag tu)': 'Terverifikasi'
      });
      sheetAddNote(leaveTable, `R${id}`, `|${payload.name}|${Date.now()}`)
      return { status: true};
    }

    if (payload.role === 4 && status === 'pending-3') {
      sheetUpdate(leaveTable, (row) => row.id === id && row.nama === employee && row['unit kerja'] === unit && row['status 4 (kepala puskesmas)'] === '', { 
        'status 4 (kepala puskesmas)': 'ACC'
      });
      sheetAddNote(leaveTable, `S${id}`, `|${payload.name}|${Date.now()}`)
      return { status: true};
    }

    return { status: false, message: 'Data tidak valid'};
    
  } catch (e) {
    Logger.log('Error in approveLeave: ' + e.toString());
    return {
      status: false,
      data: null,
      message: e.toString()
    };
  }
}

function rejectLeave(token, data, reason) {
  const payload = verifyJWT(token);
  if (!payload) {
    return {
      status: false,
      data: null,
      message: 'Token tidak valid atau sudah kadaluarsa'
    };
  }

  const { employee, id, unit, status } = data;

  try {
    if (payload.role === 1 && payload.unit === unit && status === 'pending') {
      sheetUpdate(leaveTable, (row) => row.id === id && row.nama === employee && row['unit kerja'] === unit && row['status 1 (atasan langsung)'] === '', { 
        'status 1 (atasan langsung)': 'Ditolak'
      });
      sheetAddNote(leaveTable, `P${id}`, `${reason}|${payload.name}|${Date.now()}`)
      return { status: true};
    }

    if (payload.role === 2 && status === 'pending-1') {
      sheetUpdate(leaveTable, (row) => row.id === id && row.nama === employee && row['unit kerja'] === unit && row['status 2 (kepegawaian)'] === '', { 
        'status 2 (kepegawaian)': 'Ditolak'
      });
      sheetAddNote(leaveTable, `Q${id}`, `${reason}|${payload.name}|${Date.now()}`)
      return { status: true};
    }

    if (payload.role === 3 && status === 'pending-2') {
      sheetUpdate(leaveTable, (row) => row.id === id && row.nama === employee && row['unit kerja'] === unit && row['status 3 (kasubag tu)'] === '', { 
        'status 3 (kasubag tu)': 'Ditolak'
      });
      sheetAddNote(leaveTable, `R${id}`, `${reason}|${payload.name}|${Date.now()}`)
      return { status: true};
    }

    if (payload.role === 4 && status === 'pending-3') {
      sheetUpdate(leaveTable, (row) => row.id === id && row.nama === employee && row['unit kerja'] === unit && row['status 4 (kepala puskesmas)'] === '', { 
        'status 4 (kepala puskesmas)': 'Ditolak'
      });
      sheetAddNote(leaveTable, `S${id}`, `${reason}|${payload.name}|${Date.now()}`)
      return { status: true};
    }

    return { status: false, message: 'Data tidak valid'};
    
  } catch (e) {
    Logger.log('Error in approveLeave: ' + e.toString());
    return {
      status: false,
      data: null,
      message: e.toString()
    };
  }
}