// Leave Domain Model - Business logic untuk leave request
const LeaveModel = {
  
  // Extract status list dari row
  getStatusList: function(row) {
    return [
      row[COLUMNS.LEAVE.STATUS_1],
      row[COLUMNS.LEAVE.STATUS_2],
      row[COLUMNS.LEAVE.STATUS_3],
      row[COLUMNS.LEAVE.STATUS_4]
    ];
  },

  // Check apakah leave ditolak
  isRejected: function(statusList) {
    return statusList.some(s => s === STATUS.DITOLAK);
  },

  // Check apakah leave sudah approved semua
  isFullyApproved: function(statusList) {
    return statusList[3] === STATUS.ACC;
  },

  // Check apakah row valid (tidak ditolak)
  isValidLeave: function(row) {
    const statusList = this.getStatusList(row);
    return !this.isRejected(statusList);
  },

  // Parse dates dengan safety check
  parseDates: function(row) {
    const startDate = new Date(row[COLUMNS.LEAVE.TGL_MULAI]);
    const endDate = new Date(row[COLUMNS.LEAVE.TGL_SELESAI]);
    
    return {
      startDate: isNaN(startDate.getTime()) ? null : startDate.getTime(),
      endDate: isNaN(endDate.getTime()) ? null : endDate.getTime()
    };
  },

  // Check overlap antara dua leave period
  hasOverlap: function(start1, end1, start2, end2) {
    if (!start1 || !end1 || !start2 || !end2) return false;
    return start1 <= end2 && end1 >= start2;
  },

  // Calculate overlaps untuk satu leave request
  calculateOverlaps: function(targetRow, allRows, excludeSelf = false) {
    const { startDate, endDate } = this.parseDates(targetRow);
    const unit = targetRow[COLUMNS.LEAVE.UNIT];

    return allRows
      .filter(row => {
        if (excludeSelf && row.id === targetRow.id) return false;
        if (row[COLUMNS.LEAVE.UNIT] !== unit) return false;
        if (!this.isValidLeave(row)) return false;

        const { startDate: otherStart, endDate: otherEnd } = this.parseDates(row);
        return this.hasOverlap(startDate, endDate, otherStart, otherEnd);
      })
      .map(row => {
        const { startDate: otherStart, endDate: otherEnd } = this.parseDates(row);
        return {
          id: row.id,
          employee: row[COLUMNS.LEAVE.NAMA],
          leaveType: row[COLUMNS.LEAVE.JENIS_CUTI],
          startDate: otherStart,
          endDate: otherEnd,
          duration: row[COLUMNS.LEAVE.JUMLAH_HARI],
          status: determineOverallStatus(this.getStatusList(row))
        };
      });
  },

  // Map row ke DTO
  toDTO: function(row, notes, unitGroup, unitLimit) {
    const statusList = this.getStatusList(row);
    const { startDate, endDate } = this.parseDates(row);
    const unit = row[COLUMNS.LEAVE.UNIT];
    const note = notes[row.id - 1];

    return {
      id: row.id,
      submittedDate: new Date(row[COLUMNS.LEAVE.TIMESTAMP]).getTime() || null,
      employee: row[COLUMNS.LEAVE.NAMA],
      nip: row[COLUMNS.LEAVE.NIP],
      leaveType: row[COLUMNS.LEAVE.JENIS_CUTI],
      startDate,
      endDate,
      duration: row[COLUMNS.LEAVE.JUMLAH_HARI],
      unit,
      status: determineOverallStatus(statusList),
      attachment: parseLampiran(row[COLUMNS.LEAVE.LAMPIRAN]),
      reason: row[COLUMNS.LEAVE.ALASAN],
      approvals: generateApprovals(statusList, note ? note.slice(-4) : []),
      overlaps: unitGroup[unit]?.filter(leave => 
        this.hasOverlap(startDate, endDate, leave.startDate, leave.endDate) && 
        leave.id !== row.id
      ) ?? [],
      overlapLimit: unitLimit[unit] ?? 0
    };
  }
};
