function getSheetNoteCached_(tableName) {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'sheetnote_' + tableName;
  const cached = readChunkedCache_(cache, cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) {}
  }

  const sheet = sheetApp.getSheetByName(tableName);
  const data = sheet.getDataRange().getNotes();

  writeChunkedCache_(cache, cacheKey, JSON.stringify(data));

  return data; 
}

function getSheetDataCached_(tableName) {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'sheetdata_' + tableName;

  const cached = readChunkedCache_(cache, cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) {}
  }

  const sheet = sheetApp.getSheetByName(tableName);
  const data = sheet.getDataRange().getValues();

  writeChunkedCache_(cache, cacheKey, JSON.stringify(data));

  return data;
}

function invalidateSheetCache(tableName) {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'sheetdata_' + tableName;
  const cacheNoteKey = 'sheetnote_' + tableName;
  removeChunkedCache_(cache, cacheKey);
  removeChunkedCache_(cache, cacheNoteKey);
}

function writeChunkedCache_(cache, key, str) {
  const chunks = [];
  for (let i = 0; i < str.length; i += CONFIG.CACHE_CHUNK_SIZE) {
    chunks.push(str.substring(i, i + CONFIG.CACHE_CHUNK_SIZE));
  }

  const payload = {};
  payload[key + '_meta'] = String(chunks.length);
  chunks.forEach((chunk, idx) => {
    payload[key + '_' + idx] = chunk;
  });

  cache.putAll(payload, CONFIG.CACHE_TTL_SECONDS);
}

function readChunkedCache_(cache, key) {
  const metaCount = cache.get(key + '_meta');
  if (!metaCount) return null;

  const count = parseInt(metaCount, 10);
  const keys = [];
  for (let i = 0; i < count; i++) keys.push(key + '_' + i);

  const chunksMap = cache.getAll(keys);

  let result = '';
  for (let i = 0; i < count; i++) {
    const chunk = chunksMap[key + '_' + i];
    if (chunk === undefined || chunk === null) return null;
    result += chunk;
  }

  return result;
}

function removeChunkedCache_(cache, key) {
  const metaCount = cache.get(key + '_meta');
  if (!metaCount) return;

  const count = parseInt(metaCount, 10);
  const keys = [key + '_meta'];
  for (let i = 0; i < count; i++) keys.push(key + '_' + i);

  cache.removeAll(keys);
}

function prepareRow(data, header) {
  const len = header.length;
  const sorted = new Array(len);

  for (let i = 0; i < len; i++) {
    const key = header[i];
    const value = data[key];

    sorted[i] = value;
  }

  return sorted;
}

function sheetReadOne(tableName, where) {
  const rows = getSheetDataCached_(tableName);
  const header = rows[0];
  const colCount = header.length;

  const headerLower = new Array(colCount);
  for (let j = 0; j < colCount; j++) {
    headerLower[j] = header[j].toString().toLowerCase();
  }

  const len = rows.length;

  for (let i = 1; i < len; i++) {
    const row = rows[i];
    const obj = {
      id: i + 1
    };
    for (let j = 0; j < colCount; j++) {
      obj[headerLower[j]] = row[j];
    }

    if (!where || where(obj)) return obj;
  }

  return null;
}

function sheetRead(tableName, where) {
  const rows = getSheetDataCached_(tableName);
  const colCount = rows[0].length;

  const header = new Array(colCount);
  for (let j = 0; j < colCount; j++) {
    header[j] = rows[0][j].toString().toLowerCase();
  }

  const result = [];
  const len = rows.length;

  for (let i = 1; i < len; i++) {
    const row = rows[i];
    const obj = {
      id: i + 1
    };
    for (let j = 0; j < colCount; j++) {
      obj[header[j]] = row[j];
    }

    if (!where || where(obj)) {
      result.push(obj);
    }
  }

  return result;
}

function sheetInsert(tableName, data) {
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(LOCK_TIMEOUT_MS);
  } catch (e) {
    console.error('LOCK_FAILED: ' + tableName)
    throw 'LOCK_FAILED';
  }

  try {
    const sheet = sheetApp.getSheetByName(tableName);
    if (!sheet) {
      throw 'SHEET_NOT_FOUND';
    }

    const rawHeader = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()
    const colCount = rawHeader[0].length;

    const header = new Array(colCount);
    for (let j = 0; j < colCount; j++) {
      header[j] = rawHeader[0][j].toString().toLowerCase();
    }

    const row = prepareRow(data, header);

    sheet.appendRow(row);

    SpreadsheetApp.flush();

    invalidateSheetCache(tableName);

  } finally {
    lock.releaseLock();
  }
}

function sheetUpdate(tableName, where, data) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(LOCK_TIMEOUT_MS);
  } catch (e) {
    console.error('LOCK_FAILED: ' + tableName)
    throw 'LOCK_FAILED';
  }

  try {
    const sheet = sheetApp.getSheetByName(tableName);
    if (!sheet) {
      throw 'SHEET_NOT_FOUND';
    }

    const rawHeader = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()
    const colCount = rawHeader[0].length;

    const header = new Array(colCount);
    for (let j = 0; j < colCount; j++) {
      header[j] = rawHeader[0][j].toString().toLowerCase();
    }

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      throw 'DATA_EMPTY';
    }

    const allValues = sheet.getRange(2, 1, lastRow - 1, header.length).getValues();
    let targetRowNumber = -1;
    let currentData = null;

    for (let i = 0; i < allValues.length; i++) {
      const row = allValues[i];
      const obj = {};
      for (let j = 0; j < header.length; j++) {
        obj[header[j]] = row[j];
      }
      obj.id = i + 2;

      if (where(obj)) {
        targetRowNumber = obj.id;
        currentData = obj;
        break;
      }
    }

    if (!currentData) {
      throw 'DATA_NOT_FOUND';
    }

    const merged = Object.assign({}, currentData, data);
    const newRow = prepareRow(merged, header);
    sheet.getRange(targetRowNumber, 1, 1, newRow.length).setValues([newRow]);

    SpreadsheetApp.flush();

    invalidateSheetCache(tableName);
     
    return merged;
  } finally {
    lock.releaseLock();
  }
}

function sheetDelete(tableName, where) {
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(LOCK_TIMEOUT_MS);
  } catch (e) {
    console.error('LOCK_FAILED: ' + tableName)
    throw 'LOCK_FAILED';
  }

  try {
    const sheet = sheetApp.getSheetByName(tableName);
    if (!sheet) {
      throw 'SHEET_NOT_FOUND';
    }

    const rawHeader = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()
    const colCount = rawHeader[0].length;

    const header = new Array(colCount);
    for (let j = 0; j < colCount; j++) {
      header[j] = rawHeader[0][j].toString().toLowerCase();
    }

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return undefined;
    }

    const allValues = sheet.getRange(2, 1, lastRow - 1, header.length).getValues();
    let targetRowNumber = -1;
    let deletedData = null;

    for (let i = 0; i < allValues.length; i++) {
      const row = allValues[i];
      const obj = {};
      for (let j = 0; j < header.length; j++) {
        obj[header[j]] = row[j];
      }
      obj.id = i + 2;

      if (where(obj)) {
        targetRowNumber = obj.id;
        deletedData = obj;
        break;
      }
    }

    if (!deletedData) {
      return undefined;
    }

    sheet.deleteRow(targetRowNumber);

    SpreadsheetApp.flush();

    invalidateSheetCache(tableName);

    return deletedData;

  } finally {
    lock.releaseLock();
  }
}

function sheetAddNote(tableName, range, note) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(LOCK_TIMEOUT_MS);
  } catch (e) {
    console.error('LOCK_FAILED: ' + tableName)
    throw 'LOCK_FAILED';
  }
  try {
    const sheet = sheetApp.getSheetByName(tableName);
    if (!sheet) {
      throw 'SHEET_NOT_FOUND';
    }
    sheet.getRange(range).setNote(note)
  } finally {
    lock.releaseLock();
  }
}