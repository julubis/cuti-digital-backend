// Configuration & Constants
const CONFIG = {
  SPREADSHEET_ID: '10EqKavSoIU_89wtocVDjfxFw4EV8Ap7sCczAyrJluWA',
  JWT_EXPIRY_HOURS: 24,
  DEFAULT_PASSWORD: '12345678',
  CACHE_TTL_SECONDS: 21600,
  CACHE_CHUNK_SIZE: 90000,
  LOCK_TIMEOUT_MS: 30000
};

const SECRETS = {
  get JWT_SECRET() {
    const secret = PropertiesService.getScriptProperties().getProperty('JWT_SECRET');
    if (!secret) throw new Error('JWT_SECRET not configured');
    return secret;
  },
  get PWD_SALT() {
    const salt = PropertiesService.getScriptProperties().getProperty('PWD_SALT');
    if (!salt) throw new Error('PWD_SALT not configured');
    return salt;
  },
  get FONNTE_API_KEY() {
    return PropertiesService.getScriptProperties().getProperty('FONNTE_API_KEY') || '';
  },
  get DEFAULT_PWD_HASH() {
    return '5a221cc1e7d52cef1239a411924e803d6b863e03a3a7af258fc8acaee0f82f21';
  }
};

const TABLES = {
  USERS: 'Sheet1',
  LEAVES: 'Pengajuan',
  UNIT_LIMITS: 'Limit Cuti Unit Kerja'
};

const COLUMNS = {
  LEAVE: {
    STATUS_1: 'status 1 (atasan langsung)',
    STATUS_2: 'status 2 (kepegawaian)',
    STATUS_3: 'status 3 (kasubag tu)',
    STATUS_4: 'status 4 (kepala puskesmas)',
    NAMA: 'nama',
    NIP: 'nip/nrk',
    UNIT: 'unit kerja',
    JENIS_CUTI: 'jenis cuti',
    TGL_MULAI: 'tanggal mulai cuti',
    TGL_SELESAI: 'tanggal selesai cuti',
    JUMLAH_HARI: 'jumlah hari',
    ALASAN: 'alasan cuti',
    LAMPIRAN: 'lampiran',
    TIMESTAMP: 'timestamp'
  },
  USER: {
    NAMA: 'nama',
    PASSWORD: 'password',
    ROLE: 'role',
    NIP: 'nip/nrk',
    JABATAN: 'jabatan',
    PANGKAT: 'pangkat/golongan',
    UNIT: 'unit kerja',
    EMAIL: 'email',
    NO_HP: 'no hp',
    STATUS: 'status'
  }
};

const USER_ROLE = {
  PEGAWAI: 0,
  ATASAN_LANGSUNG: 1,
  TIM_KEPEGAWAIAN: 2,
  KASUBAG_TU: 3,
  KEPALA_PUSKESMAS: 4
};

const ROLE_NAMES = {
  0: "Pegawai",
  1: "Atasan Langsung",
  2: "Tim Kepegawaian",
  3: "Kasubag TU",
  4: "Kepala Puskesmas"
};

const STATUS = {
  EMPTY: '',
  TERVERIFIKASI: 'Terverifikasi',
  ACC: 'ACC',
  DITOLAK: 'Ditolak'
};

const APPROVAL_COLUMNS = [
  { key: COLUMNS.LEAVE.STATUS_1, note: 'P', role: USER_ROLE.ATASAN_LANGSUNG },
  { key: COLUMNS.LEAVE.STATUS_2, note: 'Q', role: USER_ROLE.TIM_KEPEGAWAIAN },
  { key: COLUMNS.LEAVE.STATUS_3, note: 'R', role: USER_ROLE.KASUBAG_TU },
  { key: COLUMNS.LEAVE.STATUS_4, note: 'S', role: USER_ROLE.KEPALA_PUSKESMAS }
];
