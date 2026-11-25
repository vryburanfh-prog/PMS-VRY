const DB_CONFIG = {
  TABS: {
    USERS: 'Users',
    AUTH_CREDENTIALS: 'Auth_Credentials',
    AUTH_SESSIONS: 'Auth_Sessions',
    ROLE_PERMISSIONS: 'Role_Permissions',
    PROJECT_ASSIGNMENTS: 'Project_Assignments',
    AUDIT_LOGS: 'Audit_Logs',
    SYSTEM_SETTINGS: 'System_Settings',
    PROJECTS: 'Projects',
    MAIN_WBS: 'Main_WBS',
    SUB_WBS: 'Sub_WBS',
    ACTIVITIES: 'Activities_Schedule',
    DEPENDENCIES: 'Schedule_Dependencies',
    BASELINES: 'Project_Baselines',
    PROGRESS_UPDATES: 'Progress_Updates',
    MILESTONES: 'Milestones',
    DELIVERABLES: 'Deliverables',
    PERMITS: 'Permits',
    RISKS: 'Risks',
    ISSUES: 'Issues',
    REPOSITORY: 'Repository_Links',
    WEEKLY_REPORTS: 'Weekly_Reports',
    TEAM_WORKLOAD: 'Team_Workload',
    APPROVALS: 'Approvals',
    PROCUREMENT: 'Procurement_Logistics',
    FINANCIAL: 'Financial_Monitoring'
  }
};

/**
 * Resolve the database from the spreadsheet containing this bound script.
 * This allows a copied spreadsheet + bound script to use its own database.
 * No Script Property or hardcoded spreadsheet ID is required.
 */
function getMasterSpreadsheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error(
      'Unable to resolve the database spreadsheet. This PMS must run from its ' +
      'container-bound Google Sheet. Open the spreadsheet and launch the Web App ' +
      'deployment associated with its bound Apps Script project.'
    );
  }
  return ss;
}

function getMasterSpreadsheetId_() {
  return getMasterSpreadsheet_().getId();
}

// Short-lived cache for low-volatility reference tables only. Sensitive tables
// (Users, credentials, sessions, assignments) are deliberately never cached here.
const DB_CACHE_TTL_SECONDS_ = 45;
const DB_CACHEABLE_TABS_ = ['Role_Permissions', 'System_Settings'];
function invalidateTableCache_(tabName) {
  if (DB_CACHEABLE_TABS_.indexOf(String(tabName || '')) === -1) return;
  try { CacheService.getScriptCache().remove('table:' + String(tabName)); } catch (e) { Logger.log('Cache invalidation warning: ' + e.message); }
}
function getCachedTableRecords_(tabName) {
  const name = String(tabName || '');
  if (DB_CACHEABLE_TABS_.indexOf(name) === -1) return getTableRecords_(name);
  const cache = CacheService.getScriptCache();
  const key = 'table:' + name;
  try {
    const cached = cache.get(key);
    if (cached) return JSON.parse(cached);
  } catch (e) { Logger.log('Cache read warning for ' + name + ': ' + e.message); }
  const records = getTableRecords_(name);
  try {
    const payload = JSON.stringify(records);
    if (payload.length < 95000) cache.put(key, payload, DB_CACHE_TTL_SECONDS_);
  } catch (e) { Logger.log('Cache write warning for ' + name + ': ' + e.message); }
  return records;
}

function getTableRecords_(tabName) {
  const ss = getMasterSpreadsheet_();
  const sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    throw new Error('Database table not found: ' + tabName);
  }

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) {
    return [];
  }

  const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = values[0].map(h => String(h).trim());
  const records = [];

  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    if (row.every(cell => cell === '' || cell === null)) continue;

    const obj = { _rowIndex: r + 1 };
    for (let c = 0; c < headers.length; c++) {
      let val = row[c];
      if (val instanceof Date) {
        val = Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      }
      obj[headers[c]] = val;
    }
    records.push(obj);
  }
  return records;
}

// Primary-key columns for records created through the database insert helpers.
// Duplicate IDs are rejected while the Script Lock is held, preventing concurrent
// max+1 generators from silently inserting the same key.
const PRIMARY_KEY_COLUMNS_BY_TAB_ = {
  Users: 'User_ID', Auth_Credentials: 'Credential_ID', Auth_Sessions: 'Session_ID', Projects: 'Project_ID', Project_Assignments: 'Assignment_ID', Audit_Logs: 'Audit_ID', Role_Permissions: 'Permission_ID',
  Main_WBS: 'Main_WBS_ID', Sub_WBS: 'Sub_WBS_ID', Activities_Schedule: 'Activity_ID',
  Schedule_Dependencies: 'Dependency_ID', Project_Baselines: 'Baseline_ID',
  Progress_Updates: 'Log_ID', Milestones: 'Milestone_ID', Deliverables: 'Deliverable_ID',
  Permits: 'Permit_ID', Risks: 'Risk_ID', Issues: 'Issue_ID', Repository_Links: 'Repository_ID',
  Weekly_Reports: 'Report_ID', Team_Workload: 'Assignment_ID', Approvals: 'Approval_ID',
  Procurement_Logistics: 'Procurement_ID', Financial_Monitoring: 'Financial_ID'
};

function assertUniquePrimaryKeyForInsert_(sheet, tabName, headers, records) {
  const idColumn = PRIMARY_KEY_COLUMNS_BY_TAB_[tabName];
  if (!idColumn) return;
  const idIndex = headers.indexOf(idColumn);
  if (idIndex < 0) throw new Error('Primary-key column "' + idColumn + '" missing from ' + tabName);
  const candidateIds = records.map(function(record) { return String(record[idColumn] || '').trim(); });
  if (candidateIds.some(function(id) { return !id; })) throw new Error('Primary-key value is required for insert into ' + tabName + ' (' + idColumn + ').');
  if (!candidateIds.length) return;
  const candidateSet = new Set();
  candidateIds.forEach(function(id) {
    if (candidateSet.has(id)) throw new Error('Duplicate ' + idColumn + ' in insert batch: ' + id);
    candidateSet.add(id);
  });
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const existing = sheet.getRange(2, idIndex + 1, lastRow - 1, 1).getValues();
  existing.forEach(function(row) {
    const id = String(row[0] || '').trim();
    if (id && candidateSet.has(id)) throw new Error('Record ID already exists in ' + tabName + ': ' + id + '. Retry the operation.');
  });
}

function insertRecord_(tabName, recordObj) {
  // Serialize row appends so simultaneous requests cannot race on the target row.
  const lock = LockService.getScriptLock();
  const ownsLock = !lock.hasLock();
  if (ownsLock) lock.waitLock(10000);
  try {
    const ss = getMasterSpreadsheet_();
    const sheet = ss.getSheetByName(tabName);
    if (!sheet) throw new Error('Database table not found: ' + tabName);

    const lastCol = sheet.getLastColumn();
    if (lastCol < 1) throw new Error('Database table has no header row: ' + tabName);
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
    if (!headers.some(Boolean)) throw new Error('Database table has an empty header row: ' + tabName);

    assertUniquePrimaryKeyForInsert_(sheet, tabName, headers, [recordObj || {}]);
    const newRow = headers.map(header => recordObj && recordObj[header] !== undefined ? recordObj[header] : '');
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, headers.length).setValues([newRow]);
    invalidateTableCache_(tabName);
    return recordObj;
  } finally {
    if (ownsLock) lock.releaseLock();
  }
}


/** Appends multiple records to one sheet with a single range write. */
function insertRecords_(tabName, records) {
  const list = Array.isArray(records) ? records.filter(Boolean) : [];
  if (!list.length) return 0;
  const lock = LockService.getScriptLock();
  const ownsLock = !lock.hasLock();
  if (ownsLock) lock.waitLock(10000);
  try {
    const sheet = getMasterSpreadsheet_().getSheetByName(tabName);
    if (!sheet) throw new Error('Database table not found: ' + tabName);
    const lastCol = sheet.getLastColumn();
    if (lastCol < 1) throw new Error('Database table has no header row: ' + tabName);
    const headers = sheet.getRange(1,1,1,lastCol).getValues()[0].map(h => String(h).trim());
    assertUniquePrimaryKeyForInsert_(sheet, tabName, headers, list);
    const rows = list.map(record => headers.map(header => record[header] !== undefined ? record[header] : ''));
    sheet.getRange(sheet.getLastRow()+1,1,rows.length,headers.length).setValues(rows);
    return rows.length;
  } finally { if (ownsLock) lock.releaseLock(); }
}

function updateRecordById_(tabName, idColumn, recordId, updatesObj) {
  const lock = LockService.getScriptLock();
  const ownsLock = !lock.hasLock();
  if (ownsLock) lock.waitLock(10000);
  try {
    const sheet = getMasterSpreadsheet_().getSheetByName(tabName);
    if (!sheet) throw new Error('Database table not found: ' + tabName);
    const lastRow = sheet.getLastRow(), lastCol = sheet.getLastColumn();
    if (lastRow < 2 || lastCol < 1) throw new Error('No records found in ' + tabName);
    const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    const headers = values[0].map(h => String(h).trim());
    const idIndex = headers.indexOf(idColumn);
    if (idIndex < 0) throw new Error('Column "' + idColumn + '" not found in ' + tabName);
    for (let r = 1; r < values.length; r++) {
      if (String(values[r][idIndex]).trim() !== String(recordId).trim()) continue;
      const previous = {}, updated = {}, changed = [];
      headers.forEach((header, c) => {
        previous[header] = values[r][c];
        const next = updatesObj && Object.prototype.hasOwnProperty.call(updatesObj, header) ? updatesObj[header] : values[r][c];
        updated[header] = next;
        if (updatesObj && Object.prototype.hasOwnProperty.call(updatesObj, header)) changed.push({ index:c, value:next });
      });
      // Write contiguous changed-column runs only; preserve formulas and avoid one RPC per cell.
      changed.sort((a,b) => a.index-b.index);
      let i = 0;
      while (i < changed.length) {
        let j = i;
        while (j + 1 < changed.length && changed[j + 1].index === changed[j].index + 1) j++;
        sheet.getRange(r + 1, changed[i].index + 1, 1, j - i + 1).setValues([changed.slice(i,j+1).map(x => x.value)]);
        i = j + 1;
      }
      invalidateTableCache_(tabName);
      return { previous:previous, updated:updated };
    }
    throw new Error('Record with ' + idColumn + ' "' + recordId + '" not found in ' + tabName);
  } finally { if (ownsLock) lock.releaseLock(); }
}

/** Deletes a set of records with one table read and contiguous bottom-up row deletions. */
function deleteRecordsByIds_(tabName, idColumn, recordIds) {
  const ids = (recordIds || []).map(v => String(v || '').trim()).filter(Boolean);
  if (!ids.length) return 0;
  const wanted = new Set(ids);
  const lock = LockService.getScriptLock();
  const ownsLock = !lock.hasLock();
  if (ownsLock) lock.waitLock(10000);
  try {
    const sheet = getMasterSpreadsheet_().getSheetByName(tabName);
    if (!sheet) throw new Error('Database table not found: ' + tabName);
    const lastRow = sheet.getLastRow(), lastCol = sheet.getLastColumn();
    if (lastRow < 2 || lastCol < 1) return 0;
    const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    const headers = values[0].map(h => String(h).trim());
    const idIndex = headers.indexOf(idColumn);
    if (idIndex < 0) throw new Error('Column "' + idColumn + '" not found in ' + tabName);
    const rowNums = [];
    for (let r = 1; r < values.length; r++) if (wanted.has(String(values[r][idIndex]).trim())) rowNums.push(r + 1);
    rowNums.sort((a,b) => b-a);
    let deleted = 0, i = 0;
    while (i < rowNums.length) {
      let top = rowNums[i], bottom = top;
      while (i + 1 < rowNums.length && rowNums[i + 1] === top - 1) { i++; top = rowNums[i]; }
      sheet.deleteRows(top, bottom - top + 1);
      deleted += bottom - top + 1;
      i++;
    }
    if (deleted) invalidateTableCache_(tabName);
    return deleted;
  } finally { if (ownsLock) lock.releaseLock(); }
}


/** Physically removes one record by ID under a script lock. */
function deleteRecordById_(tabName, idColumn, recordId) {
  const lock = LockService.getScriptLock();
  const ownsLock = !lock.hasLock();
  if (ownsLock) lock.waitLock(10000);
  try {
    const sheet = getMasterSpreadsheet_().getSheetByName(tabName);
    if (!sheet) throw new Error('Database table not found: ' + tabName);
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow < 2 || lastCol < 1) throw new Error('No records found in ' + tabName);
    const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    const headers = values[0].map(h => String(h).trim());
    const idIndex = headers.indexOf(idColumn);
    if (idIndex < 0) throw new Error('Column "' + idColumn + '" not found in ' + tabName);
    for (let r = 1; r < values.length; r++) {
      if (String(values[r][idIndex]).trim() === String(recordId).trim()) {
        const previous = {};
        headers.forEach((h, c) => previous[h] = values[r][c]);
        sheet.deleteRow(r + 1);
        // Compact fully empty rows below the header after a physical deletion.
        // A row is considered blank only when every cell has neither a value nor a formula.
        const compactLastRow = sheet.getLastRow();
        const compactLastCol = sheet.getLastColumn();
        if (compactLastRow >= 2 && compactLastCol >= 1) {
          const compactRange = sheet.getRange(2, 1, compactLastRow - 1, compactLastCol);
          const compactValues = compactRange.getValues();
          const compactFormulas = compactRange.getFormulas();
          for (let i = compactValues.length - 1; i >= 0; i--) {
            const hasContent = compactValues[i].some(v => v !== '' && v !== null) || compactFormulas[i].some(f => !!f);
            if (!hasContent) sheet.deleteRow(i + 2);
          }
        }
        invalidateTableCache_(tabName);
        return previous;
      }
    }
    throw new Error('Record with ' + idColumn + ' "' + recordId + '" not found in ' + tabName);
  } finally {
    if (ownsLock) lock.releaseLock();
  }
}

function generateNextId_(tabName, idColumn, prefix, padLength) {
  const records = getTableRecords_(tabName);
  let maxNum = 0;
  const regex = new RegExp('^' + prefix + '-(\\d+)$');

  records.forEach(rec => {
    const val = String(rec[idColumn] || '').trim();
    const match = val.match(regex);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  });

  const nextNum = String(maxNum + 1).padStart(padLength || 3, '0');
  return prefix + '-' + nextNum;
}

function getNowTimestamp_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

function findRecordRowById_(tabName, idColumn, recordId) {
  const ss = getMasterSpreadsheet_();
  const sheet = ss.getSheetByName(tabName);
  if (!sheet) throw new Error('Database table not found: ' + tabName);

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2) return null;

  const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = values[0].map(h => String(h).trim());
  const idColIndex = headers.indexOf(idColumn);
  if (idColIndex === -1) throw new Error('Column "' + idColumn + '" not found in ' + tabName);

  for (let r = 1; r < values.length; r++) {
    if (String(values[r][idColIndex]).trim() === String(recordId).trim()) {
      const record = { _rowIndex: r + 1 };
      for (let c = 0; c < headers.length; c++) {
        let val = values[r][c];
        if (val instanceof Date) {
          val = Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
        }
        record[headers[c]] = val;
      }
      return record;
    }
  }
  return null;
}

/**
 * Calculates calendar or working-day duration between two YYYY-MM-DD dates.
 * Returns integer days (minimum 0 if end < start).
 */
function calculateDurationDays_(startDateStr, endDateStr, workingDaysOnly, workweekStr) {
  if (!startDateStr || !endDateStr) return 0;
  const start = new Date(String(startDateStr).slice(0, 10) + 'T00:00:00');
  const end = new Date(String(endDateStr).slice(0, 10) + 'T00:00:00');
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
  if (end < start) return 0;

  if (!workingDaysOnly) {
    const diffMs = end.getTime() - start.getTime();
    return Math.round(diffMs / (1000 * 60 * 60 * 24)) + 1;
  }

  const dayMap = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const allowedDays = String(workweekStr || 'Mon,Tue,Wed,Thu,Fri')
    .split(',')
    .map(d => d.trim());

  let count = 0;
  const cursor = new Date(start.getTime());
  while (cursor <= end) {
    const dayName = dayMap[cursor.getDay()];
    if (allowedDays.includes(dayName)) {
      count++;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

/**
 * Calculates schedule variance in days:
 * Positive means behind baseline (forecast/actual finish is later than baseline finish).
 * Negative means ahead of baseline.
 */
function calculateScheduleVarianceDays_(baselineFinishStr, currentOrActualFinishStr) {
  if (!baselineFinishStr || !currentOrActualFinishStr) return 0;
  const baseDate = new Date(String(baselineFinishStr).slice(0, 10) + 'T00:00:00');
  const compDate = new Date(String(currentOrActualFinishStr).slice(0, 10) + 'T00:00:00');
  if (isNaN(baseDate.getTime()) || isNaN(compDate.getTime())) return 0;
  return Math.round((compDate.getTime() - baseDate.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Batch-updates multiple rows in a table by matching idColumn in a single spreadsheet write.
 * updatesList: Array of { id: '...', updates: { ColA: val, ColB: val } }
 */
function batchUpdateRecordsById_(tabName, idColumn, updatesList) {
  if (!updatesList || !updatesList.length) return 0;

  const lock = LockService.getScriptLock();
  const ownsLock = !lock.hasLock();
  if (ownsLock) lock.waitLock(10000);
  try {
    const ss = getMasterSpreadsheet_();
    const sheet = ss.getSheetByName(tabName);
    if (!sheet) throw new Error('Database table not found: ' + tabName);

    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow < 2 || lastCol < 1) return 0;

    const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    const headers = values[0].map(h => String(h).trim());
    const idColIndex = headers.indexOf(idColumn);
    if (idColIndex === -1) throw new Error('Column "' + idColumn + '" not found in ' + tabName);

    const updateMap = {};
    updatesList.forEach(item => {
      if (!item || item.id === undefined || item.id === null || !item.updates) return;
      updateMap[String(item.id).trim()] = item.updates;
    });

    let updatedCount = 0;
    for (let r = 1; r < values.length; r++) {
      const rowId = String(values[r][idColIndex]).trim();
      const patch = updateMap[rowId];
      if (!patch) continue;

      const changedColumns = [];
      Object.keys(patch).forEach(header => {
        const colIndex = headers.indexOf(header);
        if (colIndex >= 0) changedColumns.push({ index: colIndex, value: patch[header] });
      });
      changedColumns.sort((a, b) => a.index - b.index);
      if (!changedColumns.length) continue;

      // Write only patched columns. Rewriting the entire row/table with getValues()
      // and setValues() would replace any existing formulas with their calculated values.
      let runStart = 0;
      while (runStart < changedColumns.length) {
        let runEnd = runStart;
        while (runEnd + 1 < changedColumns.length &&
          changedColumns[runEnd + 1].index === changedColumns[runEnd].index + 1) {
          runEnd++;
        }
        const run = changedColumns.slice(runStart, runEnd + 1);
        sheet.getRange(r + 1, run[0].index + 1, 1, run.length)
          .setValues([run.map(item => item.value)]);
        runStart = runEnd + 1;
      }
      updatedCount++;
    }
    return updatedCount;
  } finally {
    if (ownsLock) lock.releaseLock();
  }
}

/**
 * Configurable Weighted Progress Roll-Up Engine:
 * Rolls up Planned_Progress and Actual_Progress from Activities -> Sub_WBS -> Main_WBS -> Projects
 * according to the project's Progress_Method.
 */
function recalculateProjectProgressEngine_(projectId) {
  const pid = String(projectId).trim();
  const project = findRecordRowById_(DB_CONFIG.TABS.PROJECTS, 'Project_ID', pid);
  if (!project) throw new Error('Project not found: ' + pid);

  // Preserve the project's existing Progress_Method setting and behavior.
  // The roll-up hierarchy is two-tier: Main WBS -> Sub WBS -> Activities,
  // with direct activities also allowed under Main WBS.
  const method = String(project.Progress_Method || 'Approved Activity Weights').trim();

  const mainWbsList = getTableRecords_(DB_CONFIG.TABS.MAIN_WBS)
    .filter(m => String(m.Project_ID).trim() === pid && String(m.Is_Archived || '').toUpperCase() !== 'TRUE');
  const subWbsList = getTableRecords_(DB_CONFIG.TABS.SUB_WBS)
    .filter(s => String(s.Project_ID).trim() === pid && String(s.Is_Archived || '').toUpperCase() !== 'TRUE');
  const activities = getTableRecords_(DB_CONFIG.TABS.ACTIVITIES)
    .filter(a => String(a.Project_ID).trim() === pid && String(a.Is_Archived || '').toUpperCase() !== 'TRUE');

  // Manual allocation method follows the BSCS workbook: child weights are
  // percentages of their immediate parent and must total exactly 100%.
  if (method === 'Manually Approved WBS Weights') {
    const pct = v => Math.max(0, Math.min(100, Number(v) || 0));
    const weight = (item, field) => Number(item[field] || 0);
    const assert100 = (items, field, label, required) => {
      if (!items.length) return;
      const total = items.reduce((sum, item) => sum + weight(item, field), 0);
      if (items.some(item => item[field] === null || item[field] === undefined || String(item[field]).trim() === '' || !Number.isFinite(Number(item[field])) || Number(item[field]) < 0 || Number(item[field]) > 100)) {
        throw new Error(label + ': weights must be numeric values between 0 and 100%.');
      }
      if (required && Math.abs(total - 100) > 0.01) {
        throw new Error(label + ': manually assigned sibling weights total ' + total.toFixed(2) + '%. They must total exactly 100%. No automatic normalization was applied.');
      }
    };
    assert100(mainWbsList, 'WBS_Weight', 'Main WBS allocation', true);
    mainWbsList.forEach(main => {
      const mid = String(main.Main_WBS_ID || '').trim();
      const childSubs = subWbsList.filter(sub => String(sub.Parent_Main_WBS_ID || '').trim() === mid);
      const directActs = activities.filter(a => String(a.Main_WBS_ID || '').trim() === mid && !String(a.Sub_WBS_ID || '').trim());
      directActs.forEach(a => { if (a.Activity_Weight === null || a.Activity_Weight === undefined || String(a.Activity_Weight).trim() === '' || !Number.isFinite(Number(a.Activity_Weight)) || Number(a.Activity_Weight) < 0 || Number(a.Activity_Weight) > 100) throw new Error('Activity ' + a.Activity_ID + ': weight must be a numeric value between 0 and 100%.'); });
      // Direct activities use Activity_Weight, Sub WBS uses WBS_Weight.
      childSubs.forEach(sub => {
        const sw = Number(sub.WBS_Weight);
        if (sub.WBS_Weight === null || sub.WBS_Weight === undefined || String(sub.WBS_Weight).trim() === '' || !Number.isFinite(sw) || sw < 0 || sw > 100) throw new Error('Sub WBS ' + sub.Sub_WBS_ID + ': weight must be a numeric value between 0 and 100%.');
      });
      const directTotal = directActs.reduce((sum, a) => sum + weight(a, 'Activity_Weight'), 0);
      const subTotal = childSubs.reduce((sum, sub) => sum + weight(sub, 'WBS_Weight'), 0);
      if (directActs.length + childSubs.length && Math.abs(directTotal + subTotal - 100) > 0.01) {
        throw new Error('Children of Main WBS ' + mid + ': direct activity and Sub WBS weights total ' + (directTotal + subTotal).toFixed(2) + '%. They must total exactly 100%.');
      }
      childSubs.forEach(sub => {
        const acts = activities.filter(a => String(a.Sub_WBS_ID || '').trim() === String(sub.Sub_WBS_ID || '').trim());
        assert100(acts, 'Activity_Weight', 'Activities under Sub WBS ' + sub.Sub_WBS_ID, true);
      });
    });

    const weightedChildren = (items, field) => items.reduce((sum, item) => sum + weight(item, 'Activity_Weight') * pct(item[field]) / 100, 0);
    const subUpdates = [];
    subWbsList.forEach(sub => {
      const childActs = activities.filter(a => String(a.Sub_WBS_ID || '').trim() === String(sub.Sub_WBS_ID || '').trim());
      if (!childActs.length) return;
      const actual = weightedChildren(childActs, 'Actual_Progress');
      const planned = weightedChildren(childActs, 'Planned_Progress');
      sub.Actual_Progress = Number(actual.toFixed(2));
      sub.Planned_Progress = Number(planned.toFixed(2));
      subUpdates.push({ id: sub.Sub_WBS_ID, updates: { Actual_Progress: sub.Actual_Progress, Planned_Progress: sub.Planned_Progress } });
    });
    batchUpdateRecordsById_(DB_CONFIG.TABS.SUB_WBS, 'Sub_WBS_ID', subUpdates);

    const mainUpdates = [];
    mainWbsList.forEach(main => {
      const mid = String(main.Main_WBS_ID || '').trim();
      const childSubs = subWbsList.filter(sub => String(sub.Parent_Main_WBS_ID || '').trim() === mid);
      const directActs = activities.filter(a => String(a.Main_WBS_ID || '').trim() === mid && !String(a.Sub_WBS_ID || '').trim());
      const earned = childSubs.reduce((sum, sub) => sum + weight(sub, 'WBS_Weight') * pct(sub.Actual_Progress) / 100, 0)
        + directActs.reduce((sum, a) => sum + weight(a, 'Activity_Weight') * pct(a.Actual_Progress) / 100, 0);
      const planned = childSubs.reduce((sum, sub) => sum + weight(sub, 'WBS_Weight') * pct(sub.Planned_Progress) / 100, 0)
        + directActs.reduce((sum, a) => sum + weight(a, 'Activity_Weight') * pct(a.Planned_Progress) / 100, 0);
      main.Actual_Progress = Number(earned.toFixed(2));
      main.Planned_Progress = Number(planned.toFixed(2));
      mainUpdates.push({ id: main.Main_WBS_ID, updates: { Actual_Progress: main.Actual_Progress, Planned_Progress: main.Planned_Progress } });
    });
    batchUpdateRecordsById_(DB_CONFIG.TABS.MAIN_WBS, 'Main_WBS_ID', mainUpdates);

    const overallEarned = mainWbsList.reduce((sum, main) => sum + weight(main, 'WBS_Weight') * pct(main.Actual_Progress) / 100, 0);
    const overallPlanned = mainWbsList.reduce((sum, main) => sum + weight(main, 'WBS_Weight') * pct(main.Planned_Progress) / 100, 0);
    const overallProgress = overallEarned; // With 100% project-level allocation, this equals the weighted roll-up.
    updateRecordById_(DB_CONFIG.TABS.PROJECTS, 'Project_ID', pid, {
      Overall_Planned_Progress: Number(overallPlanned.toFixed(2)),
      Overall_Actual_Progress: Number(overallProgress.toFixed(2)),
      Updated_At: getNowTimestamp_()
    });
    return { projectId: pid, method: method, overallPlanned: Number(overallPlanned.toFixed(2)),
      overallActual: Number(overallProgress.toFixed(2)), overallEarnedWeight: Number(overallEarned.toFixed(2)),
      mainUpdated: mainUpdates.length, subUpdated: subUpdates.length, subSubUpdated: 0 };
  }

  // Keep the existing Progress_Method weight basis unchanged for all other methods.
  const getItemWeight = (item, isActivity) => {
    if (method === 'Quantity-Based Accomplishment') {
      const tq = parseFloat(item.Target_Quantity);
      if (!isNaN(tq) && tq > 0) return tq;
    }
    if (method === 'Duration-Based Weighting') {
      const dur = parseFloat(item.Baseline_Duration);
      if (!isNaN(dur) && dur > 0) return dur;
    }
    const w = isActivity ? parseFloat(item.Activity_Weight) : parseFloat(item.WBS_Weight);
    return (!isNaN(w) && w > 0) ? w : 1;
  };

  const computeWeightedAvg = (items, isActivity) => {
    if (!items || !items.length) return null;
    let weightSum = 0;
    let plannedWeighted = 0;
    let actualWeighted = 0;

    items.forEach(it => {
      const w = getItemWeight(it, isActivity);
      const pPct = Math.min(100, Math.max(0, parseFloat(it.Planned_Progress) || 0));
      let aPct = Math.min(100, Math.max(0, parseFloat(it.Actual_Progress) || 0));

      // Preserve the configured quantity-based accomplishment calculation.
      if (isActivity && method === 'Quantity-Based Accomplishment') {
        const tq = parseFloat(it.Target_Quantity) || 0;
        const aq = parseFloat(it.Actual_Quantity) || 0;
        if (tq > 0 && aq > 0) {
          aPct = Math.min(100, Number(((aq / tq) * 100).toFixed(2)));
        }
      }

      if (String(it.Status).trim() === 'Completed' && aPct === 0) aPct = 100;
      weightSum += w;
      plannedWeighted += pPct * w;
      actualWeighted += aPct * w;
    });

    if (weightSum <= 0) return { planned: 0, actual: 0 };
    return {
      planned: Number((plannedWeighted / weightSum).toFixed(2)),
      actual: Number((actualWeighted / weightSum).toFixed(2))
    };
  };

  // 1. Activities -> Sub WBS.
  const subUpdates = [];
  subWbsList.forEach(sub => {
    const sid = String(sub.Sub_WBS_ID || '').trim();
    const childActs = activities.filter(a => String(a.Sub_WBS_ID || '').trim() === sid);
    const roll = computeWeightedAvg(childActs, true);
    if (roll) {
      sub.Planned_Progress = roll.planned;
      sub.Actual_Progress = roll.actual;
      subUpdates.push({
        id: sub.Sub_WBS_ID,
        updates: { Planned_Progress: roll.planned, Actual_Progress: roll.actual }
      });
    }
  });
  batchUpdateRecordsById_(DB_CONFIG.TABS.SUB_WBS, 'Sub_WBS_ID', subUpdates);

  // 2. Sub WBS + direct Main WBS activities -> Main WBS.
  const mainUpdates = [];
  mainWbsList.forEach(main => {
    const mid = String(main.Main_WBS_ID || '').trim();
    const childSubs = subWbsList.filter(s => String(s.Parent_Main_WBS_ID || '').trim() === mid);
    const directActs = activities.filter(a => {
      if (String(a.Main_WBS_ID || '').trim() !== mid) return false;
      const subId = String(a.Sub_WBS_ID || '').trim();
      return !subId || !subWbsList.some(s => String(s.Sub_WBS_ID || '').trim() === subId);
    });

    const combined = [
      ...childSubs.map(s => ({
        Planned_Progress: s.Planned_Progress,
        Actual_Progress: s.Actual_Progress,
        WBS_Weight: s.WBS_Weight,
        Baseline_Duration: s.Baseline_Duration,
        Status: s.Status
      })),
      ...directActs.map(a => ({
        Planned_Progress: a.Planned_Progress,
        Actual_Progress: a.Actual_Progress,
        WBS_Weight: a.Activity_Weight,
        Baseline_Duration: a.Baseline_Duration,
        Status: a.Status
      }))
    ];

    const roll = computeWeightedAvg(combined, false);
    if (roll) {
      main.Planned_Progress = roll.planned;
      main.Actual_Progress = roll.actual;
      mainUpdates.push({
        id: main.Main_WBS_ID,
        updates: { Planned_Progress: roll.planned, Actual_Progress: roll.actual }
      });
    }
  });
  batchUpdateRecordsById_(DB_CONFIG.TABS.MAIN_WBS, 'Main_WBS_ID', mainUpdates);

  // 3. Main WBS -> Project, using the same configured Progress_Method.
  let projRoll = computeWeightedAvg(mainWbsList, false);
  if (!projRoll && activities.length > 0) projRoll = computeWeightedAvg(activities, true);

  const finalPlanned = projRoll ? projRoll.planned : (parseFloat(project.Overall_Planned_Progress) || 0);
  const finalActual = projRoll ? projRoll.actual : (parseFloat(project.Overall_Actual_Progress) || 0);

  updateRecordById_(DB_CONFIG.TABS.PROJECTS, 'Project_ID', pid, {
    Overall_Planned_Progress: finalPlanned,
    Overall_Actual_Progress: finalActual,
    Updated_At: getNowTimestamp_()
  });

  return {
    projectId: pid,
    method: method,
    overallPlanned: finalPlanned,
    overallActual: finalActual,
    mainUpdated: mainUpdates.length,
    subUpdated: subUpdates.length,
    subSubUpdated: 0
  };
}

/**
 * Additive, repeatable schema migration for the RBAC and three-level WBS
 * enhancement. Run manually from the Apps Script editor after reviewing the
 * backup copy created by this function. Existing headers and records are kept.
 */
function runPMSecurityMigration_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = getMasterSpreadsheet_();
    const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
    const backupName = ss.getName() + '_PRE_RBAC_MIGRATION_' + stamp;
    const backupFile = DriveApp.getFileById(getMasterSpreadsheetId_()).makeCopy(backupName);
    const report = { backupName: backupName, backupId: backupFile.getId(), createdSheets: [], addedColumns: {}, permissionSeed: '', trustedAdminAllowlistSeeded: false, legacyDependenciesMigrated: 0 };
    const requiredExistingTabs = [DB_CONFIG.TABS.PROJECTS, DB_CONFIG.TABS.USERS, DB_CONFIG.TABS.MAIN_WBS, DB_CONFIG.TABS.SUB_WBS, DB_CONFIG.TABS.ACTIVITIES, DB_CONFIG.TABS.DEPENDENCIES, DB_CONFIG.TABS.PROGRESS_UPDATES, DB_CONFIG.TABS.WEEKLY_REPORTS];
    const missingExistingTabs = requiredExistingTabs.filter(function (name) { return !ss.getSheetByName(name); });
    if (missingExistingTabs.length) throw new Error('Migration preflight failed. Required existing sheets are missing: ' + missingExistingTabs.join(', ') + '. No schema changes were applied.');
    const scriptProps = PropertiesService.getScriptProperties();
    if (!scriptProps.getProperty('PM_ADMIN_EMAILS')) {
      // Never bootstrap trusted administrator identity from editable sheet data.
      // A project maintainer must explicitly establish the allowlist from the
      // Apps Script editor using setPMSuperAdminEmails_([...]).
      report.trustedAdminAllowlistSeeded = false;
      report.trustedAdminWarning = "Trusted administrator allowlist is not configured. Before deployment, run setPMSuperAdminEmails_([\'authorized-admin@yourcompany.com\']) from the Apps Script editor as the trusted project maintainer. Database Role_Name values are not accepted as proof of administrator identity.";
    } else {
      report.trustedAdminAllowlistConfigured = true;
    }

    const ensureSheetAndHeaders = function (sheetName, headers, createIfMissing) {
      let sh = ss.getSheetByName(sheetName);
      if (!sh) {
        if (!createIfMissing) throw new Error('Required existing sheet not found: ' + sheetName);
        sh = ss.insertSheet(sheetName);
        report.createdSheets.push(sheetName);
      }
      const lastCol = Math.max(sh.getLastColumn(), 1);
      let current = sh.getLastRow() > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (v) { return String(v || '').trim(); }) : [];
      if (!current.some(Boolean)) {
        sh.getRange(1, 1, 1, headers.length).setValues([headers]);
        report.addedColumns[sheetName] = headers.slice();
        return;
      }
      const missing = headers.filter(function (h) { return current.indexOf(h) === -1; });
      if (missing.length) {
        sh.getRange(1, current.length + 1, 1, missing.length).setValues([missing]);
        report.addedColumns[sheetName] = missing;
      } else {
        report.addedColumns[sheetName] = [];
      }
    };

    ensureSheetAndHeaders(DB_CONFIG.TABS.PROJECTS, ['WBS_Hierarchy_Depth'], false);
    ensureSheetAndHeaders(DB_CONFIG.TABS.ROLE_PERMISSIONS, [
      'Permission_ID', 'Role_Name', 'Module_Name', 'Can_View', 'Can_Create',
      'Can_Edit', 'Can_Delete', 'Can_Approve', 'Can_Import', 'Can_Export'
    ], true);
    ensureSheetAndHeaders(DB_CONFIG.TABS.USERS, [
      'User_ID', 'Email', 'Full_Name', 'Role_Name', 'Department', 'Position',
      'Assigned_Project_IDs', 'Is_Active', 'Created_At', 'Updated_At'
    ], false);
    ensureSheetAndHeaders(DB_CONFIG.TABS.PROJECT_ASSIGNMENTS, [
      'Assignment_ID', 'User_ID', 'User_Email', 'Project_ID', 'Project_Role',
      'Assigned_Role', 'Assignment_Status', 'Is_Active', 'Assigned_By',
      'Assigned_At', 'Assignment_Date', 'Last_Updated'
    ], true);
    ensureSheetAndHeaders(DB_CONFIG.TABS.ROLE_PERMISSIONS, [
      'Permission_ID', 'Role_Name', 'Module_Name', 'Can_View', 'Can_Create',
      'Can_Edit', 'Can_Delete', 'Can_Approve', 'Can_Import', 'Can_Export'
    ], true);
    ensureSheetAndHeaders(DB_CONFIG.TABS.MAIN_WBS, [
      'WBS_Code', 'WBS_Level', 'WBS_Type', 'Sequence', 'Parent_WBS_ID',
      'Description', 'Created_By', 'Created_Date', 'Updated_By', 'Updated_Date'
    ], false);
    ensureSheetAndHeaders(DB_CONFIG.TABS.SUB_WBS, [
      'WBS_Code', 'WBS_Level', 'WBS_Type', 'Sequence', 'Parent_WBS_ID',
      'Description', 'Created_By', 'Created_Date', 'Updated_By', 'Updated_Date'
    ], false);
    // Fixed two-tier WBS: do not create a third WBS level.
    // Keep existing legacy Activity columns untouched for backward compatibility.
    ensureSheetAndHeaders(DB_CONFIG.TABS.ACTIVITIES, [
      'Predecessor_ID', 'Dependency_Type', 'Lag_Or_Lead_Days', 'Created_By_Email', 'Updated_By_Email'
    ], false);
    ensureSheetAndHeaders(DB_CONFIG.TABS.DEPENDENCIES, [
      'Is_Active', 'Created_By', 'Created_At', 'Updated_By', 'Updated_At'
    ], false);
    ensureSheetAndHeaders(DB_CONFIG.TABS.PROGRESS_UPDATES, [
      'Submitted_By_Email'
    ], false);
    ensureSheetAndHeaders(DB_CONFIG.TABS.WEEKLY_REPORTS, [
      'Project_Status', 'Key_Accomplishments', 'Activities_Completed',
      'Planned_Activities', 'Major_Concerns', 'Risks_and_Issues',
      'Management_Attention_Required', 'Submitted_By', 'Submission_Date'
    ], false);

    // Backfill only blank metadata fields. Existing populated values are preserved.
    const fillBlankFields = function (sheetName, keyField, row, values) {
      const patch = {};
      Object.keys(values || {}).forEach(function (field) {
        const current = row[field];
        if (current === undefined || current === null || current === '') {
          const value = values[field];
          if (value !== undefined && value !== null && value !== '') patch[field] = value;
        }
      });
      if (Object.keys(patch).length && row[keyField] !== undefined && row[keyField] !== '') {
        updateRecordById_(sheetName, keyField, row[keyField], patch);
      }
    };

    const projectRows = getTableRecords_(DB_CONFIG.TABS.PROJECTS) || [];
    projectRows.forEach(function (r) {
      fillBlankFields(DB_CONFIG.TABS.PROJECTS, 'Project_ID', r, { WBS_Hierarchy_Depth: 2 });
    });

    const mainRows = getTableRecords_(DB_CONFIG.TABS.MAIN_WBS) || [];
    mainRows.forEach(function (r) {
      fillBlankFields(DB_CONFIG.TABS.MAIN_WBS, 'Main_WBS_ID', r, {
        WBS_Code: r.Main_WBS_ID, WBS_Level: 1, WBS_Type: 'Main WBS',
        Sequence: Math.max(0, Number(r._rowIndex || 2) - 2), Description: r.Module_Description || r.Remarks || ''
      });
    });

    const subRows = getTableRecords_(DB_CONFIG.TABS.SUB_WBS) || [];
    subRows.forEach(function (r) {
      fillBlankFields(DB_CONFIG.TABS.SUB_WBS, 'Sub_WBS_ID', r, {
        WBS_Code: r.Sub_WBS_ID, WBS_Level: 2, WBS_Type: 'Sub WBS',
        Sequence: Math.max(0, Number(r._rowIndex || 2) - 2),
        Parent_WBS_ID: r.Parent_Main_WBS_ID, Description: r.Task_Description || ''
      });
    });

    const usersByEmail = {};
    const usersForAssignments = getTableRecords_(DB_CONFIG.TABS.USERS) || [];
    usersForAssignments.forEach(function (u) {
      if (u.Email) usersByEmail[String(u.Email).trim().toLowerCase()] = u;
    });

    // Backfill legacy Assigned_Project_IDs only if a user has no active
    // normalized assignments. Re-running migration will not duplicate rows.
    const projectIdsKnown = {};
    projectRows.forEach(function (p) { if (p.Project_ID) projectIdsKnown[String(p.Project_ID).trim()] = true; });
    const currentAssignments = getTableRecords_(DB_CONFIG.TABS.PROJECT_ASSIGNMENTS) || [];
    usersForAssignments.forEach(function (u) {
      const uid = String(u.User_ID || '').trim();
      const email = String(u.Email || '').trim().toLowerCase();
      const hasActiveAssignment = currentAssignments.some(function (a) {
        const matches = (uid && String(a.User_ID || '').trim() === uid) ||
          (email && String(a.User_Email || '').trim().toLowerCase() === email);
        const status = String(a.Assignment_Status || 'Active').trim().toLowerCase();
        const flag = a.Is_Active === undefined || a.Is_Active === '' ? true : isTruthySheetFlag_(a.Is_Active);
        return matches && flag && !['inactive', 'revoked', 'removed', 'false', '0'].includes(status);
      });
      if (hasActiveAssignment) return;
      let legacyIds = u.Assigned_Project_IDs || '';
      let parsed = [];
      if (Array.isArray(legacyIds)) parsed = legacyIds;
      else {
        const raw = String(legacyIds || '').trim();
        if (raw) {
          try {
            const json = JSON.parse(raw);
            parsed = Array.isArray(json) ? json : raw.split(/[;,\n]/);
          } catch (e) { parsed = raw.split(/[;,\n]/); }
        }
      }
      parsed.map(function (x) { return String(x || '').trim(); })
        .filter(function (pid, i, all) { return pid && projectIdsKnown[pid] && all.indexOf(pid) === i; })
        .forEach(function (pid) {
          insertRecord_(DB_CONFIG.TABS.PROJECT_ASSIGNMENTS, {
            Assignment_ID: generateNextId_(DB_CONFIG.TABS.PROJECT_ASSIGNMENTS, 'Assignment_ID', 'ASG', 4),
            User_ID: uid, User_Email: email, Project_ID: pid,
            Project_Role: normalizeRoleName_(u.Role_Name || u.Role_ID),
            Assigned_Role: normalizeRoleName_(u.Role_Name || u.Role_ID),
            Assignment_Status: 'Active', Is_Active: 'TRUE', Assigned_By: 'Migration',
            Assigned_At: getNowTimestamp_(), Assignment_Date: getNowTimestamp_(), Last_Updated: getNowTimestamp_()
          });
          report.legacyAssignmentsMigrated = (report.legacyAssignmentsMigrated || 0) + 1;
        });
    });

    (getTableRecords_(DB_CONFIG.TABS.PROJECT_ASSIGNMENTS) || []).forEach(function (a) {
      const u = usersByEmail[String(a.User_Email || '').trim().toLowerCase()] || {};
      const active = a.Is_Active === undefined || a.Is_Active === '' ? true : isTruthySheetFlag_(a.Is_Active);
      fillBlankFields(DB_CONFIG.TABS.PROJECT_ASSIGNMENTS, 'Assignment_ID', a, {
        User_ID: u.User_ID || '', Assigned_Role: a.Project_Role || u.Role_Name || '',
        Assignment_Status: active ? 'Active' : 'Inactive',
        Assignment_Date: a.Assigned_At || '', Last_Updated: a.Assigned_At || ''
      });
    });

    (getTableRecords_(DB_CONFIG.TABS.PROGRESS_UPDATES) || []).forEach(function (r) {
      const match = String(r.Submitted_By || '').match(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
      fillBlankFields(DB_CONFIG.TABS.PROGRESS_UPDATES, 'Log_ID', r, { Submitted_By_Email: match ? match[1].toLowerCase() : '' });
    });

    // Migrate legacy predecessor fields into the normalized dependency table without duplicating active links.
    const dependencyRows = getTableRecords_(DB_CONFIG.TABS.DEPENDENCIES) || [];
    const activityRows = getTableRecords_(DB_CONFIG.TABS.ACTIVITIES) || [];
    const activityById = {};
    activityRows.forEach(function (a) { activityById[String(a.Activity_ID)] = a; });
    activityRows.forEach(function (a) {
      const predecessorId = String(a.Predecessor_ID || '').trim();
      if (!predecessorId) return;
      const predecessor = activityById[predecessorId];
      if (!predecessor || String(predecessor.Project_ID) !== String(a.Project_ID)) return;
      const hasActive = dependencyRows.some(function (d) {
        const active = d.Is_Active === undefined || d.Is_Active === '' || isTruthySheetFlag_(d.Is_Active);
        return active && String(d.Project_ID) === String(a.Project_ID) && String(d.Predecessor_ID) === predecessorId && String(d.Successor_ID) === String(a.Activity_ID);
      });
      if (hasActive) return;
      insertRecord_(DB_CONFIG.TABS.DEPENDENCIES, {
        Dependency_ID: generateNextId_(DB_CONFIG.TABS.DEPENDENCIES, 'Dependency_ID', 'DEP', 4),
        Project_ID: a.Project_ID, Predecessor_ID: predecessorId, Successor_ID: a.Activity_ID,
        Dependency_Type: a.Dependency_Type || 'FS', Lag_Or_Lead_Days: Number(a.Lag_Or_Lead_Days) || 0,
        Is_Active: 'TRUE', Created_By: a.Created_By_Email || '', Created_At: a.Created_Date || getNowTimestamp_(),
        Updated_By: a.Updated_By_Email || '', Updated_At: a.Updated_Date || getNowTimestamp_(),
        Remarks: 'Migrated from legacy Schedule Activity predecessor field'
      });
      report.legacyDependenciesMigrated++;
    });

    const projectStatusById = {};
    projectRows.forEach(function (r) { projectStatusById[String(r.Project_ID)] = r.Project_Status || ''; });
    (getTableRecords_(DB_CONFIG.TABS.WEEKLY_REPORTS) || []).forEach(function (r) {
      fillBlankFields(DB_CONFIG.TABS.WEEKLY_REPORTS, 'Report_ID', r, {
        Project_Status: projectStatusById[String(r.Project_ID)] || '',
        Key_Accomplishments: r.Accomplishments || '',
        Activities_Completed: r.Ongoing_Activities || '',
        Planned_Activities: r.Next_Steps || r.Pending_Activities || '',
        Major_Concerns: r.Issues_Encountered || '',
        Risks_and_Issues: r.Issues_Encountered || '',
        Management_Attention_Required: r.Management_Support_Needed || '',
        Submitted_By: r.Responsible_Team_Lead || '',
        Submission_Date: r.Created_At || r.Updated_At || ''
      });
    });

    if (typeof seedDefaultPermissions_ === 'function') {
      report.permissionSeed = seedDefaultPermissions_();
    }
    SpreadsheetApp.flush();
    report.success = true;
    report.message = 'Migration completed. No existing rows were deleted or overwritten.';
    Logger.log(JSON.stringify(report));
    return report;
  } catch (err) {
    Logger.log('PM migration failed: ' + err.message);
    throw new Error('PM migration failed. No rollback was automatically attempted; inspect the backup copy and execution log. Details: ' + err.message);
  } finally {
    lock.releaseLock();
  }
}
