// Leave Service - Business logic layer
const LeaveService = {

  // Get unit leave limit from cache
  getUnitLimits: function() {
    return Object.fromEntries(
      sheetRead(TABLES.UNIT_LIMITS).map(item => [item['unit kerja'], item.jumlah])
    );
  },

  // Build unit group for overlap calculation
  buildUnitGroup: function(rows) {
    return rows.reduce((acc, row) => {
      const unit = row[COLUMNS.LEAVE.UNIT];
      acc[unit] = acc[unit] || [];
      
      const { startDate, endDate } = LeaveModel.parseDates(row);
      acc[unit].push({
        id: row.id,
        employee: row[COLUMNS.LEAVE.NAMA],
        leaveType: row[COLUMNS.LEAVE.JENIS_CUTI],
        startDate,
        endDate,
        duration: row[COLUMNS.LEAVE.JUMLAH_HARI],
        status: determineOverallStatus(LeaveModel.getStatusList(row))
      });
      
      return acc;
    }, {});
  },

  // Filter rows by role and unit
  filterByRole: function(rows, payload) {
    // Role 0 & 1: unit-specific, Role 2-4: all units
    if (payload.role <= USER_ROLE.ATASAN_LANGSUNG) {
      return rows.filter(row => row[COLUMNS.LEAVE.UNIT] === payload.unit);
    }
    return rows;
  },

  // Check if leave is at current user's approval stage
  isAtApprovalStage: function(statusList, role) {
    return filterRoleStatus(role, statusList);
  },

  // Get fresh leave data for approval (race condition mitigation)
  getFreshLeaveForApproval: function(id, unit) {
    const allLeaves = sheetRead(TABLES.LEAVES, (row) => 
      row.id === id || (row[COLUMNS.LEAVE.UNIT] === unit && row[COLUMNS.LEAVE.NAMA])
    );
    
    const targetLeave = allLeaves.find(row => row.id === id);
    if (!targetLeave) return null;

    return { targetLeave, allLeaves };
  },

  // Validate overlap limit before approval
  validateOverlapLimit: function(targetLeave, allLeaves) {
    const { startDate, endDate } = LeaveModel.parseDates(targetLeave);
    const unit = targetLeave[COLUMNS.LEAVE.UNIT];
    
    const unitLimit = sheetReadOne(TABLES.UNIT_LIMITS, (row) => row['unit kerja'] === unit);
    const limit = unitLimit ? unitLimit.jumlah : 0;

    const overlaps = allLeaves.filter(row => 
      row.id !== targetLeave.id &&
      row[COLUMNS.LEAVE.UNIT] === unit &&
      LeaveModel.isValidLeave(row) &&
      LeaveModel.hasOverlap(
        startDate, endDate,
        LeaveModel.parseDates(row).startDate,
        LeaveModel.parseDates(row).endDate
      )
    );

    if (overlaps.length >= limit) {
      return {
        valid: false,
        message: `Limit cuti unit ${unit} sudah terpenuhi (${overlaps.length}/${limit} orang)`
      };
    }

    return { valid: true };
  },

  // Get approval stage config for role and status
  getApprovalStage: function(role, status) {
    const stages = {
      [`${USER_ROLE.ATASAN_LANGSUNG}_pending`]: {
        column: COLUMNS.LEAVE.STATUS_1,
        value: STATUS.TERVERIFIKASI,
        noteCol: 'P',
        requireUnit: true
      },
      [`${USER_ROLE.TIM_KEPEGAWAIAN}_pending-1`]: {
        column: COLUMNS.LEAVE.STATUS_2,
        value: STATUS.TERVERIFIKASI,
        noteCol: 'Q',
        requireUnit: false
      },
      [`${USER_ROLE.KASUBAG_TU}_pending-2`]: {
        column: COLUMNS.LEAVE.STATUS_3,
        value: STATUS.TERVERIFIKASI,
        noteCol: 'R',
        requireUnit: false
      },
      [`${USER_ROLE.KEPALA_PUSKESMAS}_pending-3`]: {
        column: COLUMNS.LEAVE.STATUS_4,
        value: STATUS.ACC,
        noteCol: 'S',
        requireUnit: false
      }
    };

    return stages[`${role}_${status}`] || null;
  }
};
