// User Domain Model
const UserModel = {
  
  // Create JWT payload from user row
  createPayload: function(user) {
    return {
      name: user[COLUMNS.USER.NAMA],
      role: Number(USER_ROLE[user[COLUMNS.USER.ROLE]]) || USER_ROLE.PEGAWAI,
      pangkat: user[COLUMNS.USER.PANGKAT],
      nip: user[COLUMNS.USER.NIP],
      position: user[COLUMNS.USER.JABATAN],
      status: user[COLUMNS.USER.STATUS],
      unit: user[COLUMNS.USER.UNIT],
      email: user[COLUMNS.USER.EMAIL],
      phone: user[COLUMNS.USER.NO_HP],
      emptyNIP: user[COLUMNS.USER.NIP] == '',
      defaultPassword: user[COLUMNS.USER.PASSWORD] == SECRETS.DEFAULT_PWD_HASH,
      exp: Math.floor(Date.now() / 1000) + (CONFIG.JWT_EXPIRY_HOURS * 60 * 60)
    };
  },

  // Create JWT token from user
  createToken: function(user) {
    return createJWT(this.createPayload(user));
  },

  // Normalize username for case-insensitive comparison
  normalizeUsername: function(username) {
    return username.toString().toLowerCase().trim();
  },

  // Find user by username and password
  findByCredentials: function(username, password) {
    const hash = hashPassword(password);
    const usernameLower = this.normalizeUsername(username);
    
    return sheetReadOne(TABLES.USERS, (row) => 
      row[COLUMNS.USER.NAMA] && 
      this.normalizeUsername(row[COLUMNS.USER.NAMA]) === usernameLower && 
      row[COLUMNS.USER.PASSWORD] == hash
    );
  },

  // Map to simple DTO for list
  toSimpleDTO: function(row) {
    return {
      id: row.id,
      name: row[COLUMNS.USER.NAMA],
      unit: row[COLUMNS.USER.UNIT]
    };
  }
};
