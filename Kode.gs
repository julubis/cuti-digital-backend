const sheetApp = SpreadsheetApp.getActiveSpreadsheet();

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
      return Response.validation('Username dan password harus diisi');
    }

    const user = UserModel.findByCredentials(username, password);
    if (!user) {
      return Response.error('Nama atau password tidak valid');
    }

    const jwt = UserModel.createToken(user);
    return Response.success(jwt, 'Login berhasil');

  } catch (error) {
    Logger.log('Error in login: ' + error.toString());
    return Response.error('Terjadi kesalahan saat login: ' + error.toString());
  }
}

function editProfile(token, data) {
  const payload = verifyJWT(token);
  if (!payload) return Response.unauthorized();

  const { nip, position, pangkat, email, phone } = data;
  try {
    const newData = sheetUpdate(TABLES.USERS, (row) => row[COLUMNS.USER.NAMA] === payload.name, { 
      [COLUMNS.USER.NIP]: nip, 
      [COLUMNS.USER.JABATAN]: position, 
      [COLUMNS.USER.PANGKAT]: pangkat,
      [COLUMNS.USER.EMAIL]: email,
      [COLUMNS.USER.NO_HP]: phone
    });
    
    const newToken = UserModel.createToken(newData);
    return Response.success(newToken);

  } catch(e) {
    return Response.error(e);
  }
}

function changePassword(token, data) {
  const payload = verifyJWT(token);
  if (!payload) return Response.unauthorized();

  const { oldPassword, newPassword, confirmPassword } = data;
  
  try {
    if (!newPassword || !confirmPassword || !oldPassword) {
      return Response.validation('Semua field harus diisi');
    }

    if (newPassword.length < 8) {
      return Response.validation('Password baru minimal 8 karakter');
    }

    if (newPassword === CONFIG.DEFAULT_PASSWORD) {
      return Response.validation('Password baru tidak boleh "12345678"');
    }

    if (confirmPassword !== newPassword) {
      return Response.validation('Password baru dan konfirmasi tidak sama');
    }

    const newData = sheetUpdate(TABLES.USERS, 
      (row) => row[COLUMNS.USER.NAMA] === payload.name && row[COLUMNS.USER.PASSWORD] === hashPassword(oldPassword), 
      { [COLUMNS.USER.PASSWORD]: hashPassword(newPassword) }
    );

    const newToken = UserModel.createToken(newData);
    return Response.success(newToken);

  } catch(e) {
    if (e === 'DATA_NOT_FOUND') {
      return Response.error('Password lama Anda salah.');
    }
    return Response.error(JSON.stringify(e));
  }
}

function getUsers() {
  try {
    const users = sheetRead(TABLES.USERS);
    const employees = users
      .filter(row => row[COLUMNS.USER.NAMA])
      .map(row => UserModel.toSimpleDTO(row));

    return Response.success(employees);

  } catch (error) {
    Logger.log('Error in getUsers: ' + error.toString());
    return Response.error('Gagal mengambil data pegawai: ' + error.toString());
  }
}

function getDashboardData(token, period='today') {
  try {
    const payload = verifyJWT(token);
    if (!payload) return Response.unauthorized();

    const allRows = sheetRead(TABLES.LEAVES, (row) => row[COLUMNS.LEAVE.NAMA]);
    const filteredRows = LeaveService.filterByRole(allRows, payload);
    
    const notes = getSheetNoteCached_(TABLES.LEAVES);
    const unitLimit = LeaveService.getUnitLimits();
    const unitGroup = LeaveService.buildUnitGroup(filteredRows);
    const stats = groupForChart(filteredRows, period);

    const leaveList = filteredRows
      .map(row => LeaveModel.toDTO(row, notes, unitGroup, unitLimit))
      .reverse();

    const pendingApprovals = leaveList.filter(row => {
      if (payload.role <= USER_ROLE.ATASAN_LANGSUNG && row.unit !== payload.unit) return false;
      if (payload.role === USER_ROLE.ATASAN_LANGSUNG && row.status === 'pending') return true;
      if (payload.role === USER_ROLE.TIM_KEPEGAWAIAN && row.status === 'pending-1') return true;
      if (payload.role === USER_ROLE.KASUBAG_TU && row.status === 'pending-2') return true;
      if (payload.role === USER_ROLE.KEPALA_PUSKESMAS && row.status === 'pending-3') return true;
      return false;
    }).slice(0, 4);

    return Response.success({
      ...stats,
      pendingApprovals,
      recentRequests: leaveList.slice(0, 15)
    });

  } catch (error) {
    Logger.log('Error in getDashboardData: ' + error.toString());
    return Response.error('Gagal mengambil statistik dashboard: ' + error.toString());
  }
}

function getLeaves(token, filter={}) {
  try {
    const payload = verifyJWT(token);
    if (!payload) return Response.unauthorized();

    const search = (filter?.search || '').toString().trim().toLowerCase();
    const leaveTypeFilter = (filter?.leaveType || '').toString().trim();
    const unitFilter = (filter?.unit || '').toString().trim();
    const yearFilter = (filter?.year || '').toString().trim();
    const statusFilter = (filter?.status || '').toString().trim();

    const rows = sheetRead(TABLES.LEAVES, (row) => {
      if (!row[COLUMNS.LEAVE.NAMA]) return false;

      // Role filter
      if (payload.role <= USER_ROLE.ATASAN_LANGSUNG && row[COLUMNS.LEAVE.UNIT] !== payload.unit) return false;
      if (unitFilter && row[COLUMNS.LEAVE.UNIT] !== unitFilter) return false;
      if (search && !row[COLUMNS.LEAVE.NAMA].toString().toLowerCase().includes(search)) return false;
      if (leaveTypeFilter && row[COLUMNS.LEAVE.JENIS_CUTI] !== leaveTypeFilter) return false;

      if (yearFilter) {
        const ts = row[COLUMNS.LEAVE.TIMESTAMP] ? new Date(row[COLUMNS.LEAVE.TIMESTAMP]) : null;
        if (!ts || String(ts.getFullYear()) !== yearFilter) return false;
      }

      return true;
    });

    const notes = getSheetNoteCached_(TABLES.LEAVES);
    const unitLimit = LeaveService.getUnitLimits();
    const unitGroup = LeaveService.buildUnitGroup(rows);

    const leaveList = rows
      .map(row => {
        const dto = LeaveModel.toDTO(row, notes, unitGroup, unitLimit);
        // Filter by final status
        if (statusFilter && dto.status !== statusFilter) return null;
        return dto;
      })
      .filter(item => item !== null)
      .reverse();

    return Response.success(leaveList);

  } catch (e) {
    Logger.log('Error in getLeaves: ' + e.toString());
    return Response.error('Gagal mengambil data cuti: ' + e.toString());
  }
}

function getLeaveApprovals(token, filter={}) {
  try {
    const payload = verifyJWT(token);
    if (!payload) return Response.unauthorized();
    if (payload.role === USER_ROLE.PEGAWAI) return Response.notFound('Tidak ditemukan');

    const search = (filter?.search || '').toString().trim().toLowerCase();
    const leaveTypeFilter = (filter?.leaveType || '').toString().trim();
    const unitFilter = (filter?.unit || '').toString().trim();
    const yearFilter = (filter?.year || '').toString().trim();

    const rows = sheetRead(TABLES.LEAVES, (row) => {
      if (!row[COLUMNS.LEAVE.NAMA]) return false;

      // Role filter
      if (payload.role <= USER_ROLE.ATASAN_LANGSUNG && row[COLUMNS.LEAVE.UNIT] !== payload.unit) return false;
      if (unitFilter && row[COLUMNS.LEAVE.UNIT] !== unitFilter) return false;
      if (search && !row[COLUMNS.LEAVE.NAMA].toString().toLowerCase().includes(search)) return false;
      if (leaveTypeFilter && row[COLUMNS.LEAVE.JENIS_CUTI] !== leaveTypeFilter) return false;

      if (yearFilter) {
        const ts = row[COLUMNS.LEAVE.TIMESTAMP] ? new Date(row[COLUMNS.LEAVE.TIMESTAMP]) : null;
        if (!ts || String(ts.getFullYear()) !== yearFilter) return false;
      }

      // Filter by approval stage
      return LeaveService.isAtApprovalStage(LeaveModel.getStatusList(row), payload.role);
    });

    const notes = getSheetNoteCached_(TABLES.LEAVES);
    const unitLimit = LeaveService.getUnitLimits();
    const unitGroup = LeaveService.buildUnitGroup(rows);

    const leaveList = rows
      .map(row => LeaveModel.toDTO(row, notes, unitGroup, unitLimit))
      .reverse();

    return Response.success(leaveList);

  } catch (e) {
    Logger.log('Error in getLeaveApprovals: ' + e.toString());
    return Response.error('Gagal mengambil data approval: ' + e.toString());
  }
}

function approveLeave(token, data) {
  const payload = verifyJWT(token);
  if (!payload) return Response.unauthorized();

  const { employee, id, unit, status } = data;

  try {
    // Get fresh data to prevent race condition
    const freshData = LeaveService.getFreshLeaveForApproval(id, unit);
    if (!freshData) return Response.notFound('Data pengajuan tidak ditemukan');

    const { targetLeave, allLeaves } = freshData;

    // Validate overlap limit
    const validation = LeaveService.validateOverlapLimit(targetLeave, allLeaves);
    if (!validation.valid) return Response.error(validation.message);

    // Get approval stage config
    const stage = LeaveService.getApprovalStage(payload.role, status);
    if (!stage) return Response.error('Data tidak valid');

    // Unit validation for role 1
    if (stage.requireUnit && payload.unit !== unit) {
      return Response.error('Anda tidak memiliki akses untuk unit ini');
    }

    // Update status
    sheetUpdate(TABLES.LEAVES, 
      (row) => row.id === id && 
               row[COLUMNS.LEAVE.NAMA] === employee && 
               row[COLUMNS.LEAVE.UNIT] === unit && 
               row[stage.column] === STATUS.EMPTY,
      { [stage.column]: stage.value }
    );

    // Add approval note
    sheetAddNote(TABLES.LEAVES, `${stage.noteCol}${id}`, `|${payload.name}|${Date.now()}`);

    return Response.success(null, 'Berhasil approve');

  } catch (e) {
    Logger.log('Error in approveLeave: ' + e.toString());
    return Response.error(e.toString());
  }
}

function rejectLeave(token, data, reason) {
  const payload = verifyJWT(token);
  if (!payload) return Response.unauthorized();

  const { employee, id, unit, status } = data;

  try {
    if (!reason || reason.trim() === '') {
      return Response.validation('Alasan penolakan harus diisi');
    }

    // Get approval stage config
    const stage = LeaveService.getApprovalStage(payload.role, status);
    if (!stage) return Response.error('Data tidak valid');

    // Unit validation for role 1
    if (stage.requireUnit && payload.unit !== unit) {
      return Response.error('Anda tidak memiliki akses untuk unit ini');
    }

    // Update status to rejected
    sheetUpdate(TABLES.LEAVES, 
      (row) => row.id === id && 
               row[COLUMNS.LEAVE.NAMA] === employee && 
               row[COLUMNS.LEAVE.UNIT] === unit && 
               row[stage.column] === STATUS.EMPTY,
      { [stage.column]: STATUS.DITOLAK }
    );

    // Add rejection note with reason
    sheetAddNote(TABLES.LEAVES, `${stage.noteCol}${id}`, `${reason}|${payload.name}|${Date.now()}`);

    return Response.success(null, 'Berhasil reject');

  } catch (e) {
    Logger.log('Error in rejectLeave: ' + e.toString());
    return Response.error(e.toString());
  }
}