/**
 * Security.gs
 * Central authentication, role policy, page authorization, project scoping,
 * and audit logging for the PM Dashboard.
 *
 * The role policy below is a server-side permission ceiling. Role_Permissions
 * may further restrict a role, but cannot grant permissions beyond this policy.
 */

const SYSTEM_MODULES = [
  'Portfolio', 'Projects', 'WBS_Schedule', 'WBS_Structure', 'Schedule_Activities', 'Dependencies', 'Gantt_Chart', 'Progress', 'Milestones',
  'Deliverables', 'Permits', 'Risks', 'Issues', 'Repository',
  'Weekly_Reports', 'Team_Workload', 'Approvals',
  'Procurement_Logistics', 'Financial_Monitoring', 'Excel_Import_Export',
  'Users_Admin', 'Audit_Logs'
];

const REQUIRED_SYSTEM_ROLES = [
  'Administrator', 'Project Director', 'Project Manager',
  'Assistant Project Manager', 'Management', 'Project Team Member'
];

const PERMISSION_ACTIONS_ = ['view', 'create', 'edit', 'delete', 'approve', 'import', 'export'];

function isTruthySheetFlag_(val) {
  if (val === true) return true;
  const normalized = String(val === undefined || val === null ? '' : val).trim().toUpperCase();
  return normalized === 'TRUE' || normalized === 'YES' || normalized === '1';
}

function normalizeRoleName_(roleName) {
  const value = String(roleName || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (value === 'admin' || value === 'administrator') return 'Administrator';
  if (value === 'project director') return 'Project Director';
  if (value === 'project manager') return 'Project Manager';
  if (value === 'assistant project manager' || value === 'apm') return 'Assistant Project Manager';
  if (value === 'management') return 'Management';
  if (value === 'project team member' || value === 'team member') return 'Project Team Member';
  return String(roleName || '').trim();
}

function getTrustedAdminEmails_() {
  const raw = PropertiesService.getScriptProperties().getProperty('PM_ADMIN_EMAILS') || '[]';
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(function (x) { return String(x || '').trim().toLowerCase(); }).filter(Boolean);
  } catch (e) {}
  return String(raw).split(/[;,\n]/).map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean);
}

function setTrustedAdminEmails_(emails) {
  const normalized = (emails || []).map(function (x) { return String(x || '').trim().toLowerCase(); })
    .filter(function (x, i, all) { return x && all.indexOf(x) === i; });
  PropertiesService.getScriptProperties().setProperty('PM_ADMIN_EMAILS', JSON.stringify(normalized));
  return normalized;
}

function addTrustedAdminEmail_(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return getTrustedAdminEmails_();
  return setTrustedAdminEmails_(getTrustedAdminEmails_().concat([normalized]));
}

function removeTrustedAdminEmail_(email) {
  const normalized = String(email || '').trim().toLowerCase();
  return setTrustedAdminEmails_(getTrustedAdminEmails_().filter(function (x) { return x !== normalized; }));
}

function isTrustedAdministratorEmail_(email) {
  return getTrustedAdminEmails_().indexOf(String(email || '').trim().toLowerCase()) !== -1;
}

/** Run from the Apps Script editor as a trusted project maintainer to set the super-admin allowlist. */
function setPMSuperAdminEmails_(emails) {
  const caller = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  const effective = String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
  if (!caller || (effective && caller !== effective)) throw new Error('Run this function from the Apps Script editor as the script owner / trusted maintainer.');
  const list = Array.isArray(emails) ? emails : String(emails || '').split(/[;,\n]/);
  const saved = setTrustedAdminEmails_(list);
  return { success: true, trustedAdministratorEmails: saved };
}

function isPrivilegedProjectRole_(roleName) {
  return ['Administrator', 'Project Director', 'Project Manager', 'Assistant Project Manager']
    .indexOf(normalizeRoleName_(roleName)) !== -1;
}

function getRolePermissionCeiling_(roleName, moduleName) {
  const role = normalizeRoleName_(roleName);
  const mod = String(moduleName || '').trim();
  const no = { view: false, create: false, edit: false, delete: false, approve: false, import: false, export: false };
  const full = { view: true, create: true, edit: true, delete: true, approve: true, import: true, export: true };
  const view = { view: true, create: false, edit: false, delete: false, approve: false, import: false, export: false };

  if (role === 'Administrator') return full;
  if (['Project Director', 'Project Manager', 'Assistant Project Manager'].indexOf(role) !== -1) {
    if (mod === 'Users_Admin' || mod === 'Audit_Logs') return no;
    return full;
  }
  if (role === 'Management') {
    // Management is a read-only portfolio/project stakeholder role. It can
    // view all 15 project workspace pages, including WBS, permits, risks,
    // issues, repository, weekly reports, approvals, procurement and finance.
    // It cannot modify records or access administration/import-export tools.
    const managementViewModules = [
      'Portfolio', 'Projects', 'WBS_Schedule', 'WBS_Structure',
      'Schedule_Activities', 'Dependencies', 'Gantt_Chart', 'Progress',
      'Milestones', 'Deliverables', 'Permits', 'Risks', 'Issues',
      'Repository', 'Weekly_Reports', 'Team_Workload', 'Approvals',
      'Procurement_Logistics', 'Financial_Monitoring'
    ];
    if (managementViewModules.indexOf(mod) !== -1) return view;
    return no;
  }
  if (role === 'Project Team Member') {
    if (['Portfolio', 'Projects', 'WBS_Schedule', 'Gantt_Chart', 'Team_Workload', 'Milestones', 'Deliverables'].indexOf(mod) !== -1) return view;
    if (['Schedule_Activities', 'Dependencies'].indexOf(mod) !== -1) return { view: true, create: true, edit: true, delete: false, approve: false, import: false, export: false };
    if (mod === 'Progress') return { view: true, create: true, edit: true, delete: false, approve: false, import: false, export: true };
    if (['Permits', 'Risks', 'Issues', 'Repository', 'Weekly_Reports', 'Approvals'].indexOf(mod) !== -1) return full;
    return no;
  }
  return no;
}

function getRolePageAccess_(roleName) {
  const role = normalizeRoleName_(roleName);
  const privileged = isPrivilegedProjectRole_(role);
  const management = role === 'Management';
  const member = role === 'Project Team Member';
  const knownRole = REQUIRED_SYSTEM_ROLES.indexOf(role) !== -1;
  const pages = {
    Portfolio: knownRole,
    Project_Register: knownRole && privileged,
    Users_Permissions: role === 'Administrator',
    Project_Overview: knownRole,
    WBS_Schedule: knownRole && (privileged || member || management),
    Gantt_Chart: knownRole,
    Project_Progress: knownRole,
    Milestones: knownRole,
    Deliverables: knownRole,
    Permits: knownRole,
    Risks: knownRole,
    Issues: knownRole,
    Repository: knownRole,
    Weekly_Reports: knownRole,
    Approvals: knownRole,
    Team_Workload: knownRole,
    Procurement_Logistics: knownRole && (privileged || management),
    Financial_Monitoring: knownRole && (privileged || management),
    Excel_Import_Export: knownRole && privileged,
    Audit_Logs: role === 'Administrator'
  };
  return pages;
}

function getEffectiveRolePermissions_(roleName, configuredRows) {
  const role = normalizeRoleName_(roleName);
  const configured = {};
  (configuredRows || []).forEach(function (row) {
    if (!row || !row.Module_Name) return;
    if (normalizeRoleName_(row.Role_Name) !== role) return;
    configured[String(row.Module_Name).trim()] = row;
  });

  const effective = {};
  SYSTEM_MODULES.forEach(function (moduleName) {
    const ceiling = getRolePermissionCeiling_(role, moduleName);
    const row = configured[moduleName];
    const permissions = {};
    PERMISSION_ACTIONS_.forEach(function (action) {
      const field = 'Can_' + action.charAt(0).toUpperCase() + action.slice(1);
      // Missing database rows inherit the conservative server-side role policy.
      // Existing rows can reduce access but cannot grant access above the ceiling.
      const configuredValue = role === 'Administrator' ? true : (row ? isTruthySheetFlag_(row[field]) : true);
      permissions[action] = Boolean(ceiling[action] && configuredValue);
    });
    effective[moduleName] = permissions;
  });
  return effective;
}

/**
 * Safe, additive seed. Existing permission rows and assignments are never
 * overwritten. Missing role/module combinations are appended only.
 */
function seedDefaultPermissions_() {
  const sheet = getMasterSpreadsheet_().getSheetByName(DB_CONFIG.TABS.ROLE_PERMISSIONS);
  if (!sheet) throw new Error('Sheet not found: ' + DB_CONFIG.TABS.ROLE_PERMISSIONS);
  const existingRows = getCachedTableRecords_(DB_CONFIG.TABS.ROLE_PERMISSIONS) || [];
  const existingKeys = {};
  let maxId = 0;
  existingRows.forEach(function (row) {
    const role = normalizeRoleName_(row.Role_Name);
    const moduleName = String(row.Module_Name || '').trim();
    existingKeys[role + '|' + moduleName] = row;
    const match = String(row.Permission_ID || '').match(/^PRM-(\d+)$/i);
    if (match) maxId = Math.max(maxId, Number(match[1]) || 0);
  });

  let updated = 0;
  REQUIRED_SYSTEM_ROLES.forEach(function (role) {
    SYSTEM_MODULES.forEach(function (moduleName) {
      const key = role + '|' + moduleName;
      const p = getRolePermissionCeiling_(role, moduleName);
      const patch = {
        Role_Name: role, Module_Name: moduleName,
        Can_View: p.view, Can_Create: p.create, Can_Edit: p.edit,
        Can_Delete: p.delete, Can_Approve: p.approve,
        Can_Import: p.import, Can_Export: p.export
      };
      const existing = existingKeys[key];
      if (!existing) {
        maxId++;
        patch.Permission_ID = 'PRM-' + String(maxId).padStart(4, '0');
        insertRecord_(DB_CONFIG.TABS.ROLE_PERMISSIONS, patch);
        existingKeys[key] = patch;
        updated++;
      } else if (existing.Permission_ID) {
        // Populate newly introduced / blank permission columns from the role
        // policy, but never overwrite an explicit TRUE or FALSE configured by
        // an Administrator. The server-side ceiling still caps every grant.
        const blankOnlyPatch = {};
        ['Can_View', 'Can_Create', 'Can_Edit', 'Can_Delete', 'Can_Approve', 'Can_Import', 'Can_Export'].forEach(function (field) {
          if (existing[field] === undefined || existing[field] === null || String(existing[field]).trim() === '') {
            blankOnlyPatch[field] = patch[field];
          }
        });
        if (Object.keys(blankOnlyPatch).length) {
          updateRecordById_(DB_CONFIG.TABS.ROLE_PERMISSIONS, 'Permission_ID', existing.Permission_ID, blankOnlyPatch);
          updated++;
        }
      }
    });
  });
  return 'Role permission matrix checked for the six required roles. Added missing role/module combinations and initialized blank permission fields in ' + updated + ' rows; explicit permission settings and other roles were preserved.';
}

/**
 * One-time policy updater: makes Management read-only across all 15 project
 * workspace pages. Run from the Apps Script editor through a temporary wrapper
 * after deploying this Security.gs. Project assignments remain enforced.
 */
function applyManagementViewAllPagesPolicy_() {
  const tabName = DB_CONFIG.TABS.ROLE_PERMISSIONS;
  const sheet = getMasterSpreadsheet_().getSheetByName(tabName);
  if (!sheet) throw new Error('Sheet not found: ' + tabName + '. Run the database migration first.');

  const viewModules = [
    'Portfolio', 'Projects', 'WBS_Schedule', 'WBS_Structure',
    'Schedule_Activities', 'Dependencies', 'Gantt_Chart', 'Progress',
    'Milestones', 'Deliverables', 'Permits', 'Risks', 'Issues',
    'Repository', 'Weekly_Reports', 'Team_Workload', 'Approvals',
    'Procurement_Logistics', 'Financial_Monitoring'
  ];
  const rows = getTableRecords_(tabName) || [];
  const byModule = {};
  rows.forEach(function (row) {
    if (normalizeRoleName_(row.Role_Name) === 'Management') {
      const key = String(row.Module_Name || '').trim();
      if (!byModule[key]) byModule[key] = [];
      byModule[key].push(row);
    }
  });

  let updated = 0;
  let added = 0;
  viewModules.forEach(function (moduleName) {
    const matchingRows = byModule[moduleName] || [];
    const values = {
      Role_Name: 'Management', Module_Name: moduleName,
      Can_View: true, Can_Create: false, Can_Edit: false,
      Can_Delete: false, Can_Approve: false, Can_Import: false,
      Can_Export: false
    };
    if (matchingRows.length) {
      matchingRows.forEach(function (row) {
        if (row.Permission_ID) {
          updateRecordById_(tabName, 'Permission_ID', row.Permission_ID, values);
          updated++;
        }
      });
    } else {
      values.Permission_ID = generateNextId_(tabName, 'Permission_ID', 'PRM', 4);
      insertRecord_(tabName, values);
      added++;
    }
  });

  // Explicitly keep administration and data-transfer modules unavailable.
  ['Users_Admin', 'Audit_Logs', 'Excel_Import_Export'].forEach(function (moduleName) {
    (byModule[moduleName] || []).forEach(function (row) {
      if (row.Permission_ID) {
        updateRecordById_(tabName, 'Permission_ID', row.Permission_ID, {
          Role_Name: 'Management', Module_Name: moduleName,
          Can_View: false, Can_Create: false, Can_Edit: false,
          Can_Delete: false, Can_Approve: false, Can_Import: false,
          Can_Export: false
        });
        updated++;
      }
    });
  });

  return {
    success: true,
    role: 'Management',
    policy: 'Read-only access to all 15 project workspace pages',
    updatedRows: updated,
    addedRows: added,
    note: 'Project assignment restrictions remain in force. Project Register, Users & Permissions, Audit Logs and Excel Import/Export remain unavailable.'
  };
}

/** Identifies the signed-in Google user. Never substitute the script owner identity. */
var AUTH_CONTEXT_CACHE_ = null;
function getCurrentUserContext_() {
  const cacheKey = String(AUTH_CALL_TOKEN_ || '').trim() || ('google:' + String(Session.getActiveUser().getEmail() || '').trim().toLowerCase());
  if (AUTH_CONTEXT_CACHE_ && AUTH_CONTEXT_CACHE_.key === cacheKey) return AUTH_CONTEXT_CACHE_.value;
  const resolved = getCurrentUserContextUncached_();
  AUTH_CONTEXT_CACHE_ = { key: cacheKey, value: resolved };
  return resolved;
}
function getCurrentUserContextUncached_() {
  const token = String(AUTH_CALL_TOKEN_ || '').trim();
  if (token) {
    const session = findValidAuthSession_(token);
    if (!session) return { authenticated: false, email: '', fullName: '', role: '', error: 'Your session has expired. Please sign in again.' };
    const user = (getTableRecords_(DB_CONFIG.TABS.USERS) || []).find(u => String(u.User_ID) === String(session.User_ID));
    if (!user || !isTruthySheetFlag_(user.Is_Active)) return { authenticated: false, email: '', fullName: '', role: '', error: 'Account inactive or unavailable. Contact an Administrator.' };
    const role = normalizeRoleName_(user.Role_Name || user.Role_ID);
    const authMethod = String(session.Auth_Method || '').toUpperCase();
    if (authMethod === 'GOOGLE_OAUTH') {
      const verifiedEmail = String(session.Identity_Email || '').trim().toLowerCase();
      if (!verifiedEmail || verifiedEmail !== String(user.Email || '').trim().toLowerCase()) return { authenticated:false, email:'', fullName:'', role:role, error:'Google identity does not match the registered user.' };
      const trustedAdmin = role === 'Administrator' && isTrustedAdministratorEmail_(verifiedEmail);
      if (role === 'Administrator' && !trustedAdmin) return { authenticated:false, email:verifiedEmail, fullName:user.Full_Name || verifiedEmail, role:role, error:'Administrator privilege is not authorized for this Google account.' };
      return buildAuthenticatedUserContext_(user, verifiedEmail, trustedAdmin);
    }
    if (role === 'Administrator') return { authenticated: false, email: '', fullName: '', role: role, error: 'Administrator accounts must authenticate with a trusted Google account.' };
    return buildAuthenticatedUserContext_(user, String(user.Email || ('username:' + session.Username)).trim().toLowerCase(), false);
  }

  const activeEmail = Session.getActiveUser().getEmail();
  const normalizedEmail = String(activeEmail || '').trim().toLowerCase();
  if (!normalizedEmail) return { authenticated: false, email: '', fullName: '', role: '', error: 'Google account not detected. Sign in with your username and password, or use a registered Google account.' };
  const users = getTableRecords_(DB_CONFIG.TABS.USERS) || [];
  const user = users.find(u => String((u && u.Email) || '').trim().toLowerCase() === normalizedEmail);
  if (!user) return { authenticated: false, email: normalizedEmail, fullName: '', role: '', error: 'Access denied: your Google account is not registered in the Users sheet.' };
  if (!isTruthySheetFlag_(user.Is_Active)) return { authenticated: false, email: normalizedEmail, fullName: String(user.Full_Name || '').trim(), role: String(user.Role_Name || '').trim(), error: 'Account inactive. Contact an Administrator.' };
  const role = normalizeRoleName_(user.Role_Name || user.Role_ID);
  const isAdmin = role === 'Administrator' && isTrustedAdministratorEmail_(normalizedEmail);
  if (role === 'Administrator' && !isAdmin) return { authenticated: false, email: normalizedEmail, fullName: user.Full_Name || normalizedEmail, role: role, error: 'Administrator privilege is not authorized for this Google account.' };
  return buildAuthenticatedUserContext_(user, normalizedEmail, isAdmin);
}

function buildAuthenticatedUserContext_(user, identity, isAdmin) {
  const roleName = normalizeRoleName_(user.Role_Name || user.Role_ID);
  const rolePerms = getEffectiveRolePermissions_(roleName, getCachedTableRecords_(DB_CONFIG.TABS.ROLE_PERMISSIONS) || []);
  let assignedProjectIds = [];
  try {
    const assignments = getTableRecords_(DB_CONFIG.TABS.PROJECT_ASSIGNMENTS) || [];
    assignedProjectIds = assignments.filter(function (a) {
      const sameUser = String(a.User_Email || '').trim().toLowerCase() === String(user.Email || '').trim().toLowerCase() ||
        (user.User_ID && String(a.User_ID || '').trim() === String(user.User_ID).trim());
      const statusActive = a.Assignment_Status !== undefined && a.Assignment_Status !== '' ? !['inactive', 'revoked', 'removed', 'false', '0'].includes(String(a.Assignment_Status).trim().toLowerCase()) : true;
      const flagActive = a.Is_Active === undefined || a.Is_Active === '' ? true : isTruthySheetFlag_(a.Is_Active);
      return sameUser && statusActive && flagActive && a.Project_ID;
    }).map(a => String(a.Project_ID).trim()).filter((id, index, all) => id && all.indexOf(id) === index);
  } catch (e) { Logger.log('Unable to read project assignments: ' + e.message); }
  const profile = { userId: user.User_ID || '', email: String(identity || user.Email || ''), fullName: user.Full_Name || identity || '', position: user.Position || '', department: user.Department || user.Department_Or_Team || '', roleName: roleName };
  return { authenticated: true, email: profile.email, fullName: profile.fullName, role: roleName, user: profile, isAdmin: Boolean(isAdmin), isGlobalViewer: Boolean(isAdmin), assignedProjectIds: assignedProjectIds, permissions: rolePerms, pageAccess: getRolePageAccess_(roleName) };
}

// Password accounts are non-administrator identities. Tokens are random bearer
// secrets; only their SHA-256 digests are stored in the Auth_Sessions sheet.
var AUTH_CALL_TOKEN_ = '';
var AUTH_SESSION_HOURS_ = 8;
var AUTH_PBKDF2_ITERATIONS_ = 120000;
var AUTH_CREDENTIAL_HEADERS_ = ['Credential_ID','User_ID','Username','Password_Salt','Password_Hash','Is_Active','Failed_Attempts','Locked_Until','Created_At','Updated_At'];
var AUTH_SESSION_HEADERS_ = ['Session_ID','Token_Hash','User_ID','Username','Identity_Email','Auth_Method','Created_At','Expires_At','Revoked_At'];

function ensureHybridAuthTables_() {
  const ss = getMasterSpreadsheet_();
  [[DB_CONFIG.TABS.AUTH_CREDENTIALS, AUTH_CREDENTIAL_HEADERS_],[DB_CONFIG.TABS.AUTH_SESSIONS, AUTH_SESSION_HEADERS_]].forEach(function(pair) {
    let sh = ss.getSheetByName(pair[0]);
    if (!sh) { sh = ss.insertSheet(pair[0]); sh.getRange(1,1,1,pair[1].length).setValues([pair[1]]); sh.setFrozenRows(1); }
    else if (sh.getLastRow() === 0) sh.getRange(1,1,1,pair[1].length).setValues([pair[1]]);
    else {
      const lastCol = Math.max(sh.getLastColumn(), 1);
      const existing = sh.getRange(1,1,1,lastCol).getValues()[0].map(v => String(v || '').trim());
      const missing = pair[1].filter(h => existing.indexOf(h) === -1);
      if (missing.length) sh.getRange(1,lastCol+1,1,missing.length).setValues([missing]);
    }
  });
}
function authRandomToken_() { return Utilities.getUuid().replace(/-/g,'') + Utilities.getUuid().replace(/-/g,''); }
function hashToken_(token) { return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(token), Utilities.Charset.UTF_8)); }
function hashPassword_(password, salt) {
  const key = Utilities.newBlob(String(password), 'text/plain').getBytes();
  const saltBytes = Utilities.base64DecodeWebSafe(String(salt));
  const block = saltBytes.concat([0,0,0,1]);
  let u = Utilities.computeHmacSha256Signature(block, key), t = u.slice();
  for (let i=1; i<AUTH_PBKDF2_ITERATIONS_; i++) {
    u = Utilities.computeHmacSha256Signature(u, key);
    for (let j=0; j<t.length; j++) t[j] = ((t[j] ^ u[j]) << 24) >> 24;
  }
  return Utilities.base64EncodeWebSafe(t);
}
function createPasswordCredential_(userId, username, password) {
  ensureHybridAuthTables_();
  const normalized = String(username || '').trim().toLowerCase();
  const all = getTableRecords_(DB_CONFIG.TABS.AUTH_CREDENTIALS) || [];
  if (all.some(r => String(r.Username || '').trim().toLowerCase() === normalized)) throw new Error('Username is already registered.');
  const salt = Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, authRandomToken_(), Utilities.Charset.UTF_8));
  insertRecord_(DB_CONFIG.TABS.AUTH_CREDENTIALS, { Credential_ID: generateNextId_(DB_CONFIG.TABS.AUTH_CREDENTIALS, 'Credential_ID', 'CRD', 5), User_ID: userId, Username: normalized, Password_Salt: salt, Password_Hash: hashPassword_(password, salt), Is_Active: 'TRUE', Failed_Attempts: 0, Locked_Until: '', Created_At: getNowTimestamp_(), Updated_At: getNowTimestamp_() });
}
function findValidAuthSession_(token) {
  const raw = String(token || '').trim();
  if (!raw) return null;
  const sheet = getMasterSpreadsheet_().getSheetByName(DB_CONFIG.TABS.AUTH_SESSIONS);
  if (!sheet) return null;
  const lastRow = sheet.getLastRow(), lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return null;
  const headers = sheet.getRange(1,1,1,lastCol).getValues()[0].map(v => String(v || '').trim());
  const hashCol = headers.indexOf('Token_Hash') + 1;
  if (!hashCol) throw new Error('Token_Hash column is missing from Auth_Sessions.');
  const digest = hashToken_(raw);
  const hashes = sheet.getRange(2,hashCol,lastRow-1,1).getValues();
  let rowNumber = -1;
  for (let i=0; i<hashes.length; i++) if (String(hashes[i][0] || '') === digest) { rowNumber=i+2; break; }
  if (rowNumber < 0) return null;
  const row = sheet.getRange(rowNumber,1,1,lastCol).getValues()[0];
  const record = {};
  headers.forEach((h,i) => record[h] = row[i]);
  const expiry = new Date(record.Expires_At).getTime();
  if (record.Revoked_At || !expiry || expiry <= Date.now()) return null;
  return record;
}

/**
 * Apply a login outcome to the credential's attempt counter under lock.
 * Re-read under lock and ignore stale attempts if the credential hash changed
 * during password verification (for example, a concurrent password reset).
 */
function updateCredentialLoginState_(credentialId, verifiedPasswordHash, successful) {
  const lock = LockService.getScriptLock();
  const ownsLock = !lock.hasLock();
  if (ownsLock) lock.waitLock(10000);
  try {
    const current = findRecordRowById_(DB_CONFIG.TABS.AUTH_CREDENTIALS, 'Credential_ID', credentialId);
    if (!current || String(current.Password_Hash || '') !== String(verifiedPasswordHash || '')) {
      return { updated:false, locked:false, stale:true };
    }
    if (current.Locked_Until && new Date(current.Locked_Until).getTime() > Date.now()) {
      return { updated:false, locked:true, stale:false };
    }
    const attempts = successful ? 0 : Number(current.Failed_Attempts || 0) + 1;
    const lockedUntil = !successful && attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : '';
    updateRecordById_(DB_CONFIG.TABS.AUTH_CREDENTIALS, 'Credential_ID', credentialId, {
      Failed_Attempts: attempts,
      Locked_Until: lockedUntil,
      Updated_At: getNowTimestamp_()
    });
    return { updated:true, locked:!!lockedUntil, stale:false, attempts:attempts };
  } finally {
    if (ownsLock) lock.releaseLock();
  }
}

function apiLoginWithPassword(username, password) {
  ensureHybridAuthTables_();
  const name = String(username || '').trim().toLowerCase();
  const pass = String(password || '');
  if (!name || !pass) return { success:false, error:'Enter your username and password.' };
  const creds = getTableRecords_(DB_CONFIG.TABS.AUTH_CREDENTIALS) || [];
  const cred = creds.find(r => String(r.Username || '').toLowerCase() === name && isTruthySheetFlag_(r.Is_Active));
  if (!cred) { Utilities.sleep(500); return { success:false, error:'Invalid username or password.' }; }
  if (cred.Locked_Until && new Date(cred.Locked_Until).getTime() > Date.now()) return { success:false, error:'Account temporarily locked. Contact an Administrator.' };
  const user = (getTableRecords_(DB_CONFIG.TABS.USERS) || []).find(u => String(u.User_ID) === String(cred.User_ID));
  if (!user || !isTruthySheetFlag_(user.Is_Active) || normalizeRoleName_(user.Role_Name || user.Role_ID) === 'Administrator') return { success:false, error:'This account is inactive or not eligible for password login.' };
  const observedHash = String(cred.Password_Hash || '');
  const candidate = hashPassword_(pass, cred.Password_Salt);
  if (candidate !== observedHash) {
    const state = updateCredentialLoginState_(cred.Credential_ID, observedHash, false);
    if (state.locked) return { success:false, error:'Account temporarily locked. Contact an Administrator.' };
    Utilities.sleep(500); return { success:false, error:'Invalid username or password.' };
  }
  const state = updateCredentialLoginState_(cred.Credential_ID, observedHash, true);
  if (!state.updated) return { success:false, error:state.locked ? 'Account temporarily locked. Contact an Administrator.' : 'Password changed during login. Please try again.' };
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const currentCredential = findRecordRowById_(DB_CONFIG.TABS.AUTH_CREDENTIALS, 'Credential_ID', cred.Credential_ID);
    const currentUser = findRecordRowById_(DB_CONFIG.TABS.USERS, 'User_ID', user.User_ID);
    if (!currentCredential || String(currentCredential.Password_Hash || '') !== observedHash || !isTruthySheetFlag_(currentCredential.Is_Active)) {
      return { success:false, error:'Password changed during login. Please try again.' };
    }
    if (!currentUser || !isTruthySheetFlag_(currentUser.Is_Active) || normalizeRoleName_(currentUser.Role_Name || currentUser.Role_ID) === 'Administrator') {
      return { success:false, error:'This account is inactive or not eligible for password login.' };
    }
    const token = authRandomToken_();
    const expiry = new Date(Date.now() + AUTH_SESSION_HOURS_*60*60*1000);
    insertRecord_(DB_CONFIG.TABS.AUTH_SESSIONS, { Session_ID:generateNextId_(DB_CONFIG.TABS.AUTH_SESSIONS,'Session_ID','SES',6), Token_Hash:hashToken_(token), User_ID:currentUser.User_ID, Username:name, Identity_Email:'', Auth_Method:'PASSWORD', Created_At:getNowTimestamp_(), Expires_At:expiry.toISOString(), Revoked_At:'' });
    return { success:true, token:token, expiresAt:expiry.toISOString(), user:{fullName:currentUser.Full_Name, role:normalizeRoleName_(currentUser.Role_Name || currentUser.Role_ID)} };
  } finally {
    lock.releaseLock();
  }

}
function apiLoginWithGoogleCredential(idToken) {
  ensureHybridAuthTables_();
  const clientId = String(PropertiesService.getScriptProperties().getProperty('GOOGLE_OAUTH_CLIENT_ID') || '').trim();
  if (!clientId) return { success:false, error:'Google sign-in is not configured. Contact the Administrator.' };
  const token = String(idToken || '').trim();
  if (!token || token.length > 10000) return { success:false, error:'Invalid Google sign-in response.' };
  const response = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token), { muteHttpExceptions:true });
  if (response.getResponseCode() !== 200) return { success:false, error:'Google could not verify this sign-in. Please try again.' };
  const claims = JSON.parse(response.getContentText() || '{}');
  const email = String(claims.email || '').trim().toLowerCase();
  const issuer = String(claims.iss || '');
  const expires = Number(claims.exp || 0);
  const verified = String(claims.email_verified || '').toLowerCase() === 'true';
  if (String(claims.aud || '') !== clientId || !['accounts.google.com','https://accounts.google.com'].includes(issuer) || !verified || !email || expires <= Math.floor(Date.now()/1000)) {
    return { success:false, error:'Google identity verification failed.' };
  }

  // Serialize final authorization checks and session creation with status changes,
  // role changes, and trusted-admin allowlist mutations.
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const user = (getTableRecords_(DB_CONFIG.TABS.USERS) || []).find(u => String(u.Email || '').trim().toLowerCase() === email);
    if (!user || !isTruthySheetFlag_(user.Is_Active)) return { success:false, error:'This Google account is not registered or is inactive.' };
    const role = normalizeRoleName_(user.Role_Name || user.Role_ID);
    const isAdmin = role === 'Administrator' && isTrustedAdministratorEmail_(email);
    if (role === 'Administrator' && !isAdmin) return { success:false, error:'Administrator access requires a trusted Google account.' };
    const bearer = authRandomToken_();
    const expiry = new Date(Date.now() + AUTH_SESSION_HOURS_*60*60*1000);
    insertRecord_(DB_CONFIG.TABS.AUTH_SESSIONS, { Session_ID:generateNextId_(DB_CONFIG.TABS.AUTH_SESSIONS,'Session_ID','SES',6), Token_Hash:hashToken_(bearer), User_ID:user.User_ID, Username:'', Identity_Email:email, Auth_Method:'GOOGLE_OAUTH', Created_At:getNowTimestamp_(), Expires_At:expiry.toISOString(), Revoked_At:'' });
    let auditWarning = '';
    try {
      writeAuditLog_({email:email,fullName:user.Full_Name,user:{email:email,fullName:user.Full_Name}}, 'LOGIN', 'Authentication', user.User_ID, null, {Auth_Method:'GOOGLE_OAUTH'}, 'Google OAuth login');
    } catch (auditError) {
      auditWarning = 'Login succeeded, but audit logging failed: ' + auditError.message;
    }
    return { success:true, token:bearer, expiresAt:expiry.toISOString(), user:{fullName:user.Full_Name,role:role,isAdmin:isAdmin}, warning:auditWarning };
  } finally {
    lock.releaseLock();
  }
}

function apiLogout() {
  const token = String(AUTH_CALL_TOKEN_ || '').trim();
  if (token) {
    const row = findValidAuthSession_(token);
    if (row) updateRecordById_(DB_CONFIG.TABS.AUTH_SESSIONS, 'Session_ID', row.Session_ID, { Revoked_At:getNowTimestamp_() });
  }
  return { success:true };
}
function revokeUserAuthSessions_(userId) {
  ensureHybridAuthTables_();
  (getTableRecords_(DB_CONFIG.TABS.AUTH_SESSIONS) || []).filter(r => String(r.User_ID) === String(userId) && !r.Revoked_At).forEach(r => updateRecordById_(DB_CONFIG.TABS.AUTH_SESSIONS, 'Session_ID', r.Session_ID, { Revoked_At:getNowTimestamp_() }));
}
function canonicalRoleIsAdmin_(roleName) { return normalizeRoleName_(roleName) === 'Administrator'; }

// Dispatcher is the only RPC surface used by the dashboard frontend. The
// wrappers below also protect direct google.script.run calls to API functions.
var PMS_API_ALLOWLIST_ = ["apiAdminDeleteUser", "apiAdminResetPassword", "apiArchiveProject", "apiBuildUnifiedPmoDigest", "apiCapturePmoSnapshot", "apiCreateDatabaseBackupCopy", "apiCreateDatabaseTemplateCopy", "apiStartFreshDatabase", "apiCreateProject", "apiCreateProjectBaseline", "apiCreateUser", "apiDeleteFinancialItem", "apiDeleteProcurementItem", "apiDeleteProjectControlRecord", "apiDeleteTeamWorkloadAssignment", "apiDeleteWbsRecord", "apiDeleteWeeklyReport", "apiDispatchPmoDigestEmail", "apiExportScopedDatasetCsv", "apiGenerateClientPresentation", "apiGetAlertThresholdsData", "apiGetBootstrapData", "apiGetCrossModuleWorkData", "apiGetDigestTriggerStatus", "apiGetEscalationsData", "apiGetExecutiveDashboardData", "apiGetGanttAndBaselines", "apiGetPortfolioData", "apiGetPresentationScopeOptions", "apiGetProcurementFinancialData", "apiGetProgressAndWeeklyReports", "apiGetProjectControlRegistry", "apiGetProjectEmployeeDirectory", "apiGetProjectModuleReportData", "apiGetProjectOverviewData", "apiGetProjectReferenceNames", "apiGetProjectRegisterData", "apiGetProjectWbsAndSchedule", "apiGetRoleAccessAdminData", "apiGetScheduleRiskData", "apiGetSessionContext", "apiGetSnapshotsAndTemplatesData", "apiGetSystemReadinessStatus", "apiGetTeamWorkloadData", "apiGetUsersList", "apiImportDatabaseFromGoogleSheet", "apiLoginWithGoogleCredential", "apiQuickUpdateGanttActivity", "apiRecalculateWeightedProgress", "apiReviewProgressLog", "apiSaveActivity", "apiSaveDigestTriggerConfig", "apiSaveFinancialItem", "apiSaveMainWbs", "apiSaveProcurementItem", "apiSaveProgressLog", "apiSaveProjectControlRecord", "apiSaveProjectWbsDepth", "apiSaveSubWbs", "apiSaveTeamWorkloadAssignment", "apiSaveWeeklyReport", "apiSetWbsRecordArchived", "apiToggleUserStatus", "apiUpdateProject", "apiUpdateUser", "apiUpsertEscalationItem"];
function apiDispatch(functionName, args, token) {
  const name = String(functionName || '');
  const allowed = PMS_API_ALLOWLIST_.indexOf(name) !== -1 || name === 'apiLoginWithPassword' || name === 'apiLoginWithGoogleCredential' || name === 'apiLogout';
  if (!allowed || name === 'apiDispatch') throw new Error('API method is not available.');
  AUTH_CALL_TOKEN_ = String(token || '');
  AUTH_CONTEXT_CACHE_ = null;
  try {
    if (name !== 'apiLoginWithPassword' && name !== 'apiLoginWithGoogleCredential' && name !== 'apiLogout') {
      const ctx = getCurrentUserContext_();
      if (!ctx || !ctx.authenticated) throw new Error((ctx && ctx.error) || 'Authentication required.');
    }
    const fn = globalThis[name];
    if (typeof fn !== 'function') throw new Error('API method not found.');
    return fn.apply(null, Array.isArray(args) ? args : []);
  } finally { AUTH_CALL_TOKEN_ = ''; AUTH_CONTEXT_CACHE_ = null; }
}

// Guard every callable API function, including calls made directly from a
// browser console rather than through apiDispatch. Public tokenized deck
// endpoints remain outside this private dashboard API namespace.
function installApiAuthenticationGuards_() {
  PMS_API_ALLOWLIST_.forEach(function(name){
    if (name === 'apiLoginWithGoogleCredential') return;
    const original = globalThis[name];
    if (typeof original !== 'function' || original.__pmoAuthWrapped) return;
    const wrapped = function(){ const ctx=getCurrentUserContext_(); if(!ctx || !ctx.authenticated) throw new Error((ctx && ctx.error)||'Authentication required.'); return original.apply(this, arguments); };
    wrapped.__pmoAuthWrapped = true; globalThis[name] = wrapped;
  });
}
installApiAuthenticationGuards_();

function assertAdministrator_(ctx) {
  const userCtx = ctx || getCurrentUserContext_();
  if (!userCtx || !userCtx.authenticated) throw new Error((userCtx && userCtx.error) || 'Authentication required.');
  if (!userCtx.isAdmin) throw new Error('Permission denied: Administrator access is required.');
  return userCtx;
}

function assertProjectAssignment_(ctx, projectId) {
  const pid = String(projectId || '').trim();
  if (!pid) throw new Error('Project_ID is required for this operation.');
  if (ctx.isAdmin) return ctx;
  if (!Array.isArray(ctx.assignedProjectIds) || ctx.assignedProjectIds.indexOf(pid) === -1) {
    throw new Error('Project access denied: you are not assigned to this project.');
  }
  return ctx;
}

function assertPageAccess_(pageName, projectId) {
  const ctx = getCurrentUserContext_();
  if (!ctx || !ctx.authenticated) throw new Error((ctx && ctx.error) || 'Authentication required.');
  const pageKey = String(pageName || '').trim();
  const access = ctx.pageAccess || getRolePageAccess_(ctx.role);
  if (access[pageKey] !== true) throw new Error('Permission denied: your role cannot access this page.');
  if (projectId) assertProjectAssignment_(ctx, projectId);
  return ctx;
}

/**
 * Central backend authorization.
 * action: view | create | edit | delete | approve | import | export
 */
function assertPermission_(moduleName, action, projectId) {
  const ctx = getCurrentUserContext_();
  if (!ctx || !ctx.authenticated) throw new Error((ctx && ctx.error) || 'Authentication required.');
  const aliases = {
    'Procurement': 'Procurement_Logistics',
    'Procurement & Logistics': 'Procurement_Logistics',
    'Financials': 'Financial_Monitoring',
    'Financial Monitoring': 'Financial_Monitoring'
  };
  const requestedModule = String(moduleName || '').trim();
  const moduleKey = aliases[requestedModule] || requestedModule;
  const actionKey = String(action || '').trim().toLowerCase();
  if (!moduleKey || PERMISSION_ACTIONS_.indexOf(actionKey) === -1) throw new Error('Invalid permission request.');
  if (ctx.isAdmin) return ctx;

  const modPerms = ctx.permissions && (ctx.permissions[moduleKey] || ctx.permissions[requestedModule]);
  if (!modPerms || modPerms[actionKey] !== true) {
    throw new Error('Permission denied: your role is not authorized to ' + actionKey + ' in ' + moduleKey + '.');
  }

  const projectOptional = moduleKey === 'Portfolio' || moduleKey === 'Users_Admin' || moduleKey === 'Audit_Logs' ||
    (moduleKey === 'Projects' && (actionKey === 'view' || actionKey === 'create'));
  const pid = String(projectId || '').trim();
  if (!pid && !projectOptional) throw new Error('Project_ID is required for this operation.');
  if (pid) assertProjectAssignment_(ctx, pid);
  return ctx;
}

/** Writes an audit record. */
function writeAuditLog_(userCtx, action, moduleName, recordId, prevVal, newVal, reason) {
  if (!DB_CONFIG || !DB_CONFIG.TABS || !DB_CONFIG.TABS.AUDIT_LOGS) return;
  const actorEmail = (userCtx && userCtx.user && userCtx.user.email) ||
    (userCtx && userCtx.email) || Session.getActiveUser().getEmail() || 'unknown';
  const actorName = (userCtx && userCtx.user && userCtx.user.fullName) ||
    (userCtx && userCtx.fullName) || actorEmail;
  const auditId = generateNextId_(DB_CONFIG.TABS.AUDIT_LOGS, 'Audit_ID', 'AUD', 5);
  insertRecord_(DB_CONFIG.TABS.AUDIT_LOGS, {
    Audit_ID: auditId, Timestamp: getNowTimestamp_(), User_Email: actorEmail,
    User_Name: actorName, Action: action, Module_Name: moduleName,
    Record_ID: recordId || '',
    Previous_Value: prevVal !== undefined && prevVal !== null ? JSON.stringify(prevVal) : '',
    Updated_Value: newVal !== undefined && newVal !== null ? JSON.stringify(newVal) : '',
    Reason_For_Change: reason || ''
  });
}
