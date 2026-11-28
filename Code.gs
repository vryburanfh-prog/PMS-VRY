function doGet(e) {
  const params = (e && e.parameter) || {};

  if (params.action === 'getDeck' && params.token) {
    const result = apiGetPublishedClientDeckByToken(params.token);
    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (params.page === 'deck') {
    const tpl = HtmlService.createTemplateFromFile('Presentation');
    tpl.deckToken = String(params.token || '');
    return tpl.evaluate()
      .setTitle('Client Project Presentation');
  }

  const tpl = HtmlService.createTemplateFromFile('index');
  tpl.googleClientId = PropertiesService.getScriptProperties().getProperty('GOOGLE_OAUTH_CLIENT_ID') || '';
  return tpl.evaluate().setTitle('Project Portfolio & Controls System');
}

function apiGetSessionContext() {
  const ctx = getCurrentUserContext_();
  if (!ctx || !ctx.authenticated) return { success: false, error: (ctx && ctx.error) || 'Not authenticated' };
  return { success: true, context: ctx };
}

function apiGetBootstrapData() {
  const ctx = getCurrentUserContext_();
  if (!ctx || !ctx.authenticated) {
    return {
      success: false,
      error: (ctx && ctx.error) || 'Not authenticated',
      email: (ctx && ctx.email) || ''
    };
  }

  const settings = getCachedTableRecords_(DB_CONFIG.TABS.SYSTEM_SETTINGS) || [];
  const settingsMap = {};
  // Only expose explicitly approved, non-sensitive UI preferences to the browser.
  // Never serialize the entire System_Settings sheet into a client response.
  const clientVisibleSettingKeys = ['enable_financial_module'];
  settings.forEach(function (s) {
    const key = String((s && s.Setting_Key) || '').trim();
    if (key && clientVisibleSettingKeys.indexOf(key) !== -1) {
      settingsMap[key] = s.Setting_Value;
    }
  });

  // Normalize workscope visibility independently of Administrator privilege
  const roleUpper = String(ctx.role || '').toUpperCase();
  const isAdmin = roleUpper === 'ADMIN' || roleUpper === 'ADMINISTRATOR' || Boolean(ctx.isAdmin);
  const isGlobalViewer = Boolean(ctx.isGlobalViewer) || isAdmin;
  const assignedProjectIds = Array.isArray(ctx.assignedProjectIds)
    ? ctx.assignedProjectIds.map(function (id) { return String(id).trim(); }).filter(Boolean)
    : [];

  const scopedContext = Object.assign({}, ctx, {
    isAdmin: isAdmin,
    isGlobalViewer: isGlobalViewer,
    assignedProjectIds: assignedProjectIds
  });

  let usersList = [];
  if (ctx.permissions && ctx.permissions['Users_Admin'] && ctx.permissions['Users_Admin'].view) {
    const rawUsers = getTableRecords_(DB_CONFIG.TABS.USERS) || [];
    const assignmentRows = getTableRecords_(DB_CONFIG.TABS.PROJECT_ASSIGNMENTS) || [];
    const assignedByUser = {};
    assignmentRows.forEach(function (a) {
      const activeStatus = a.Assignment_Status !== undefined && a.Assignment_Status !== '' ? !['inactive','revoked','removed','false','0'].includes(String(a.Assignment_Status).trim().toLowerCase()) : true;
      const activeFlag = a.Is_Active === undefined || a.Is_Active === '' ? true : isTruthySheetFlag_(a.Is_Active);
      if (!activeStatus || !activeFlag || !a.Project_ID) return;
      const key = String(a.User_ID || '').trim();
      if (!key) return;
      if (!assignedByUser[key]) assignedByUser[key] = [];
      const pid = String(a.Project_ID).trim();
      if (assignedByUser[key].indexOf(pid) === -1) assignedByUser[key].push(pid);
    });
    // Redact sensitive columns and reuse one assignment read for the entire list.
    usersList = rawUsers.map(function (u) {
      return {
        User_ID: u.User_ID || '', Email: u.Email || '', Full_Name: u.Full_Name || '',
        Position: u.Position || '', Department: u.Department || '',
        Department_Or_Team: u.Department_Or_Team || '', Role_Name: u.Role_Name || '',
        Role_ID: u.Role_ID || '', Assigned_Project_IDs: assignedByUser[String(u.User_ID || '').trim()] || [], Is_Active: u.Is_Active,
        Created_At: u.Created_At || '', Updated_At: u.Updated_At || ''
      };
    });
  }

  return {
    success: true,
    context: scopedContext,
    scope: {
      isGlobalViewer: isGlobalViewer,
      assignedProjectIds: assignedProjectIds
    },
    settings: settingsMap,
    users: usersList
  };
}

function getUserAssignedProjectIds_(userId, email) {
  const uid = String(userId || '').trim();
  const mail = String(email || '').trim().toLowerCase();
  return (getTableRecords_(DB_CONFIG.TABS.PROJECT_ASSIGNMENTS) || []).filter(function (a) {
    const matches = (uid && String(a.User_ID || '').trim() === uid) ||
      (mail && String(a.User_Email || '').trim().toLowerCase() === mail);
    const statusActive = a.Assignment_Status !== undefined && a.Assignment_Status !== ''
      ? !['inactive', 'revoked', 'removed', 'false', '0'].includes(String(a.Assignment_Status).trim().toLowerCase())
      : true;
    const flagActive = a.Is_Active === undefined || a.Is_Active === '' ? true : isTruthySheetFlag_(a.Is_Active);
    const active = statusActive && flagActive;
    return matches && active && a.Project_ID;
  }).map(function (a) { return String(a.Project_ID).trim(); })
    .filter(function (id, index, all) { return id && all.indexOf(id) === index; });
}

function syncUserProjectAssignments_(userRecord, requestedProjectIds, actorCtx) {
  const user = userRecord || {};
  const userId = String(user.User_ID || '').trim();
  const email = String(user.Email || '').trim().toLowerCase();
  const role = normalizeRoleName_(user.Role_Name || user.Role_ID);
  const desired = Array.isArray(requestedProjectIds)
    ? requestedProjectIds.map(function (id) { return String(id || '').trim(); }).filter(function (id, i, all) { return id && all.indexOf(id) === i; })
    : [];
  const projects = getTableRecords_(DB_CONFIG.TABS.PROJECTS) || [];
  const known = {};
  projects.forEach(function (p) { if (p.Project_ID) known[String(p.Project_ID).trim()] = true; });
  desired.forEach(function (pid) { if (!known[pid]) throw new Error('Cannot assign user to unknown Project_ID: ' + pid); });

  const sheetRows = getTableRecords_(DB_CONFIG.TABS.PROJECT_ASSIGNMENTS) || [];
  const activeRows = sheetRows.filter(function (a) {
    const matches = (userId && String(a.User_ID || '').trim() === userId) ||
      (email && String(a.User_Email || '').trim().toLowerCase() === email);
    const statusActive = a.Assignment_Status !== undefined && a.Assignment_Status !== ''
      ? !['inactive', 'revoked', 'removed', 'false', '0'].includes(String(a.Assignment_Status).trim().toLowerCase())
      : true;
    const flagActive = a.Is_Active === undefined || a.Is_Active === '' ? true : isTruthySheetFlag_(a.Is_Active);
    const active = statusActive && flagActive;
    return matches && active;
  });
  const activeByProject = {};
  activeRows.forEach(function (a) { activeByProject[String(a.Project_ID || '').trim()] = a; });
  const now = getNowTimestamp_();
  const assignmentUpdates = [];
  activeRows.forEach(function (a) {
    const pid = String(a.Project_ID || '').trim();
    if (desired.indexOf(pid) === -1) assignmentUpdates.push({ id:a.Assignment_ID, updates:{ Assignment_Status:'Inactive', Is_Active:'FALSE', Last_Updated:now } });
  });
  const newAssignments = [];
  let maxAssignmentNumber = 0;
  sheetRows.forEach(function (a) {
    const match = String(a.Assignment_ID || '').match(/^ASG-(\d+)$/);
    if (match) maxAssignmentNumber = Math.max(maxAssignmentNumber, Number(match[1]));
  });
  desired.forEach(function (pid) {
    if (activeByProject[pid]) {
      assignmentUpdates.push({ id:activeByProject[pid].Assignment_ID, updates:{
        User_ID:userId, User_Email:email, Assigned_Role:role, Project_Role:role,
        Assignment_Status:'Active', Is_Active:'TRUE', Last_Updated:now
      }});
    } else {
      maxAssignmentNumber++;
      newAssignments.push({
        Assignment_ID:'ASG-' + String(maxAssignmentNumber).padStart(4,'0'),
        User_ID:userId, User_Email:email, Project_ID:pid,
        Project_Role:role, Assigned_Role:role, Assignment_Status:'Active',
        Is_Active:'TRUE', Assigned_By:actorCtx && actorCtx.user ? actorCtx.user.email : '',
        Assigned_At:now, Assignment_Date:now, Last_Updated:now
      });
    }
  });
  if (assignmentUpdates.length) batchUpdateRecordsById_(DB_CONFIG.TABS.PROJECT_ASSIGNMENTS, 'Assignment_ID', assignmentUpdates);
  if (newAssignments.length) insertRecords_(DB_CONFIG.TABS.PROJECT_ASSIGNMENTS, newAssignments);
  return desired;
}

function apiCreateUser(userPayload) {
  const ctx = assertPermission_('Users_Admin', 'create', null);
  userPayload = userPayload || {};

  const email = String(userPayload.email || '').trim().toLowerCase();
  const fullName = String(userPayload.fullName || '').trim();
  const roleName = String(userPayload.roleName || '').trim();
  const deptVal = String(userPayload.department || '').trim();
  const posVal = String(userPayload.position || '').trim();

  const username = String(userPayload.username || '').trim().toLowerCase();
  const initialPassword = String(userPayload.initialPassword || '');
  const wantsPasswordLogin = Boolean(username || initialPassword);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid Google email address.');
  if (!email && !wantsPasswordLogin) throw new Error('Provide a Google email or create a username/password login.');
  if (wantsPasswordLogin && (!username || !initialPassword)) throw new Error('Both username and temporary password are required for password login.');
  if (wantsPasswordLogin && canonicalRoleIsAdmin_(roleName)) throw new Error('Administrators must use trusted Google account authentication only.');
  if (wantsPasswordLogin && (username.length < 3 || username.length > 64 || !/^[a-z0-9._-]+$/.test(username))) throw new Error('Username must be 3–64 characters and use only letters, numbers, dots, underscores, or hyphens.');
  if (wantsPasswordLogin && initialPassword.length < 12) throw new Error('Temporary password must be at least 12 characters.');
  if (email.length > 254 || fullName.length > 150 || roleName.length > 80) throw new Error('One or more user fields exceed the allowed length.');
  if (!ctx.isAdmin && /^(admin|administrator)$/i.test(roleName)) throw new Error('Only an Administrator can create an Administrator account.');
  const canonicalRole = normalizeRoleName_(roleName);
  if (REQUIRED_SYSTEM_ROLES.indexOf(canonicalRole) === -1) throw new Error('The selected role is not one of the supported system roles.');

  if ((!email && !wantsPasswordLogin) || !fullName || !roleName) {
    throw new Error('Google email or password-login credentials, Full Name, and Role are required.');
  }

  if (wantsPasswordLogin) {
    ensureHybridAuthTables_();
    const existingCredentials = getTableRecords_(DB_CONFIG.TABS.AUTH_CREDENTIALS) || [];
    if (existingCredentials.some(r => String(r.Username || '').trim().toLowerCase() === username)) throw new Error('Username is already registered.');
  }
  const existingUsers = getTableRecords_(DB_CONFIG.TABS.USERS);
  if (email && existingUsers.some(u => String(u.Email || '').trim().toLowerCase() === email)) {
    throw new Error('A user with email "' + email + '" already exists.');
  }
  // Validate project references before creating the user row so an invalid
  // assignment cannot leave a partially-created account behind.
  const requestedAssignments = Array.isArray(userPayload.assignedProjectIds) ? userPayload.assignedProjectIds : [];
  const knownProjectIds = {};
  (getTableRecords_(DB_CONFIG.TABS.PROJECTS) || []).forEach(function (p) { knownProjectIds[String(p.Project_ID || '').trim()] = true; });
  requestedAssignments.forEach(function (id) {
    const pid = String(id || '').trim();
    if (pid && !knownProjectIds[pid]) throw new Error('Cannot assign user to unknown Project_ID: ' + pid);
  });

  const newUser = {
    User_ID: '',
    Email: email,
    Full_Name: fullName,
    Position: posVal,
    Department: deptVal,
    Department_Or_Team: deptVal,
    Role_Name: canonicalRole,
    Role_ID: canonicalRole,
    Is_Active: 'TRUE',
    Created_At: getNowTimestamp_(),
    Updated_At: getNowTimestamp_()
  };

  const userCreationLock = LockService.getScriptLock();
  userCreationLock.waitLock(10000);
  try {
    const latestUsers = getTableRecords_(DB_CONFIG.TABS.USERS) || [];
    if (email && latestUsers.some(u => String(u.Email || '').trim().toLowerCase() === email)) {
      throw new Error('A user with email "' + email + '" already exists.');
    }
    if (wantsPasswordLogin) {
      ensureHybridAuthTables_();
      const latestCredentials = getTableRecords_(DB_CONFIG.TABS.AUTH_CREDENTIALS) || [];
      if (latestCredentials.some(r => String(r.Username || '').trim().toLowerCase() === username)) throw new Error('Username is already registered.');
    }
    insertRecordWithGeneratedId_(DB_CONFIG.TABS.USERS, 'User_ID', 'USR', 3, newUser);
    if (wantsPasswordLogin) {
      try {
        createPasswordCredential_(newUser.User_ID, username, initialPassword);
      } catch (credentialError) {
        deleteRecordById_(DB_CONFIG.TABS.USERS, 'User_ID', newUser.User_ID);
        newUser.User_ID = '';
        throw credentialError;
      }
    }
  } finally {
    userCreationLock.releaseLock();
  }
  if (canonicalRole === 'Administrator') addTrustedAdminEmail_(email);
  const assignedProjectIds = syncUserProjectAssignments_(newUser, userPayload.assignedProjectIds || [], ctx);
  writeAuditLog_(ctx, 'CREATE_USER', 'Users_Admin', newUser.User_ID, null, newUser, 'Registered new system user');

  return { success: true, user: newUser, assignedProjectIds: assignedProjectIds };
}

function apiUpdateUser(userId, payload) {
  const ctx = assertAdministrator_();
  ensureHybridAuthTables_();
  if (!userId) throw new Error('User_ID is required.');
  payload = payload || {};
  const existing = findRecordRowById_(DB_CONFIG.TABS.USERS, 'User_ID', userId);
  if (!existing) throw new Error('User not found.');
  const email = String(payload.email !== undefined ? payload.email : existing.Email).trim().toLowerCase();
  const fullName = String(payload.fullName !== undefined ? payload.fullName : existing.Full_Name).trim();
  if (payload.assignedProjectIds !== undefined) {
    const requested = Array.isArray(payload.assignedProjectIds) ? payload.assignedProjectIds : [];
    const known = {};
    (getTableRecords_(DB_CONFIG.TABS.PROJECTS) || []).forEach(function (p) { known[String(p.Project_ID || '').trim()] = true; });
    requested.forEach(function (id) { const pid = String(id || '').trim(); if (pid && !known[pid]) throw new Error('Cannot assign user to unknown Project_ID: ' + pid); });
  }
  const roleName = normalizeRoleName_(payload.roleName !== undefined ? payload.roleName : existing.Role_Name);
  const department = String(payload.department !== undefined ? payload.department : existing.Department || existing.Department_Or_Team || '').trim();
  const position = String(payload.position !== undefined ? payload.position : existing.Position || '').trim();
  const existingCredential = (getTableRecords_(DB_CONFIG.TABS.AUTH_CREDENTIALS) || []).find(r => String(r.User_ID) === String(userId));
  const hasPasswordCredential = Boolean(existingCredential && isTruthySheetFlag_(existingCredential.Is_Active));
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid Google email address.');
  if (!email && (!hasPasswordCredential || roleName === 'Administrator')) throw new Error('A valid Google email is required unless this non-administrator has an active password login.');
  if (!fullName) throw new Error('Full Name is required.');
  if (REQUIRED_SYSTEM_ROLES.indexOf(roleName) === -1) throw new Error('Unsupported role.');
  const isEditingSelf = String(existing.Email || '').trim().toLowerCase() === String(ctx.email || '').trim().toLowerCase();
  if (isEditingSelf && (roleName !== 'Administrator' || email !== String(ctx.email || '').trim().toLowerCase())) {
    throw new Error('For security, an Administrator cannot change their own role or sign-in email. Ask another trusted Administrator to make that change.');
  }
  const duplicate = email && (getTableRecords_(DB_CONFIG.TABS.USERS) || []).some(function (u) {
    return String(u.User_ID) !== String(userId) && String(u.Email || '').trim().toLowerCase() === email;
  });
  if (duplicate) throw new Error('Another user already uses this email address.');
  const patch = { Email: email, Full_Name: fullName, Role_Name: roleName, Role_ID: roleName, Department: department, Department_Or_Team: department, Position: position, Updated_At: getNowTimestamp_() };
  const result = updateRecordById_(DB_CONFIG.TABS.USERS, 'User_ID', userId, patch);
  if (roleName === 'Administrator' && existingCredential && isTruthySheetFlag_(existingCredential.Is_Active)) {
    updateRecordById_(DB_CONFIG.TABS.AUTH_CREDENTIALS, 'Credential_ID', existingCredential.Credential_ID, { Is_Active:'FALSE', Updated_At:getNowTimestamp_() });
  }
  if (roleName !== normalizeRoleName_(existing.Role_Name || existing.Role_ID) || email !== String(existing.Email || '').trim().toLowerCase()) revokeUserAuthSessions_(userId);
  if (normalizeRoleName_(existing.Role_Name || existing.Role_ID) === 'Administrator' && (roleName !== 'Administrator' || email !== String(existing.Email || '').trim().toLowerCase())) removeTrustedAdminEmail_(existing.Email);
  if (roleName === 'Administrator') addTrustedAdminEmail_(email);
  // Keep legacy assignment rows in sync when an email address changes.
  (getTableRecords_(DB_CONFIG.TABS.PROJECT_ASSIGNMENTS) || []).forEach(function (a) {
    if ((a.User_ID && String(a.User_ID).trim() === String(userId)) || String(a.User_Email || '').trim().toLowerCase() === String(existing.Email || '').trim().toLowerCase()) {
      updateRecordById_(DB_CONFIG.TABS.PROJECT_ASSIGNMENTS, 'Assignment_ID', a.Assignment_ID, { User_ID: userId, User_Email: email, Assigned_Role: roleName, Project_Role: roleName, Last_Updated: getNowTimestamp_() });
    }
  });
  const assigned = syncUserProjectAssignments_(result.updated, payload.assignedProjectIds !== undefined ? payload.assignedProjectIds : getUserAssignedProjectIds_(userId, email), ctx);
  writeAuditLog_(ctx, 'UPDATE_USER', 'Users_Admin', userId, result.previous, result.updated, 'Updated user profile and project assignments');
  return { success: true, user: result.updated, assignedProjectIds: assigned };
}

function apiAdminResetPassword(userId, newPassword) {
  const ctx = assertAdministrator_();
  const user = findRecordRowById_(DB_CONFIG.TABS.USERS, 'User_ID', userId);
  if (!user) throw new Error('User not found.');
  if (normalizeRoleName_(user.Role_Name || user.Role_ID) === 'Administrator') throw new Error('Administrator accounts must use Google authentication.');
  if (String(newPassword || '').length < 12) throw new Error('Password must be at least 12 characters.');
  const creds = getTableRecords_(DB_CONFIG.TABS.AUTH_CREDENTIALS) || [];
  const credential = creds.find(r => String(r.User_ID) === String(userId));
  if (!credential) throw new Error('This user does not have a password login.');
  const salt = authRandomToken_();
  updateRecordById_(DB_CONFIG.TABS.AUTH_CREDENTIALS, 'Credential_ID', credential.Credential_ID, {
    Password_Salt: salt, Password_Hash: hashPassword_(newPassword, salt), Failed_Attempts: 0, Locked_Until: '', Updated_At: getNowTimestamp_()
  });
  revokeUserAuthSessions_(userId);
  writeAuditLog_(ctx, 'RESET_PASSWORD', 'Users_Admin', userId, null, { Password_Reset: true }, 'Administrator reset password');
  return { success: true };
}

/**
 * Permanently deletes a user account and its authentication/access records.
 * Historical audit-log entries and project records are intentionally retained.
 * Only a trusted Administrator may perform this operation.
 */
function apiAdminDeleteUser(userId, confirmationText) {
  const ctx = assertAdministrator_();
  ensureHybridAuthTables_();
  const id = String(userId || '').trim();
  if (!id) throw new Error('User_ID is required.');
  if (String(confirmationText || '').trim() !== id) throw new Error('Deletion was not confirmed. Enter the exact User ID.');

  const target = findRecordRowById_(DB_CONFIG.TABS.USERS, 'User_ID', id);
  if (!target) throw new Error('User not found. Refresh the user list and try again.');
  const actorId = String(ctx.user && ctx.user.userId || '').trim();
  if (actorId && actorId === id) throw new Error('You cannot delete your own Administrator account.');

  const targetRole = normalizeRoleName_(target.Role_Name || target.Role_ID);
  if (targetRole === 'Administrator') {
    const activeAdmins = (getTableRecords_(DB_CONFIG.TABS.USERS) || []).filter(function (u) {
      return normalizeRoleName_(u.Role_Name || u.Role_ID) === 'Administrator' && isTruthySheetFlag_(u.Is_Active) && isTrustedAdministratorEmail_(u.Email);
    });
    if (activeAdmins.length <= 1) throw new Error('The last active Administrator cannot be deleted. Add and verify another trusted Administrator first.');
  }

  const oldProfile = Object.assign({}, target);
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    // Audit before removing the profile; the audit history is retained.
    writeAuditLog_(ctx, 'DELETE_USER', 'Users_Admin', id, oldProfile, null,
      'Administrator permanently deleted user account and related access records');

    // Revoke active sessions first, then remove credential records.
    const sessions = getTableRecords_(DB_CONFIG.TABS.AUTH_SESSIONS) || [];
    deleteRecordsByIds_(DB_CONFIG.TABS.AUTH_SESSIONS, 'Session_ID', sessions.filter(r => String(r.User_ID) === id).map(r => r.Session_ID));

    const credentials = getTableRecords_(DB_CONFIG.TABS.AUTH_CREDENTIALS) || [];
    deleteRecordsByIds_(DB_CONFIG.TABS.AUTH_CREDENTIALS, 'Credential_ID', credentials.filter(r => String(r.User_ID) === id).map(r => r.Credential_ID));

    const assignments = getTableRecords_(DB_CONFIG.TABS.PROJECT_ASSIGNMENTS) || [];
    const targetEmail = String(target.Email || '').trim().toLowerCase();
    deleteRecordsByIds_(DB_CONFIG.TABS.PROJECT_ASSIGNMENTS, 'Assignment_ID', assignments.filter(function (r) {
      return String(r.User_ID || '').trim() === id || (targetEmail && String(r.User_Email || '').trim().toLowerCase() === targetEmail);
    }).map(r => r.Assignment_ID));

    deleteRecordsByIds_(DB_CONFIG.TABS.USERS, 'User_ID', [id]);
    if (targetRole === 'Administrator') removeTrustedAdminEmail_(target.Email);
  } finally {
    lock.releaseLock();
  }

  return { success: true, deletedUserId: id, retainedAuditHistory: true };
}

function apiToggleUserStatus(userId, setActive, reason) {
  const ctx = assertPermission_('Users_Admin', 'edit', null);

  if (!userId) {
    throw new Error('User ID is required.');
  }

  if (String(userId).trim() === String(ctx.user.userId).trim() && !setActive) {
    throw new Error('You cannot deactivate your own active Administrator account.');
  }

  const targetUser = findRecordRowById_(DB_CONFIG.TABS.USERS, 'User_ID', userId);
  if (!targetUser) throw new Error('User not found.');
  if (setActive && normalizeRoleName_(targetUser.Role_Name || targetUser.Role_ID) === 'Administrator') addTrustedAdminEmail_(targetUser.Email);
  const activeFlagStr = setActive ? 'TRUE' : 'FALSE';
  const result = updateRecordById_(DB_CONFIG.TABS.USERS, 'User_ID', userId, {
    Is_Active: activeFlagStr,
    Updated_At: getNowTimestamp_()
  });

  if (!setActive) revokeUserAuthSessions_(userId);
  writeAuditLog_(
    ctx,
    setActive ? 'ACTIVATE_USER' : 'DEACTIVATE_USER',
    'Users_Admin',
    userId,
    result.previous,
    result.updated,
    reason || (setActive ? 'Reactivated user account' : 'Deactivated/removed user access')
  );

  return { success: true, user: result.updated };
}

/**
 * Returns accessible projects, portfolio KPIs, and summary counts
 * from the master Google Sheet.
 */
function assertPrivilegedManagementRole_(projectId) {
  const ctx = getCurrentUserContext_();
  if (!ctx || !ctx.authenticated) throw new Error((ctx && ctx.error) || 'Authentication required.');
  if (projectId) assertProjectAssignment_(ctx, projectId);
  if (!isPrivilegedProjectRole_(ctx.role)) throw new Error('Permission denied: this PMO management function is restricted to Administrator, Project Director, Project Manager, and Assistant Project Manager.');
  return ctx;
}

function apiGetProjectOverviewData(projectId) {
  const ctx = assertPermission_('Projects', 'view', projectId);
  const pid = String(projectId || '').trim();
  const project = findRecordRowById_(DB_CONFIG.TABS.PROJECTS, 'Project_ID', pid);
  if (!project || (isTruthySheetFlag_(project.Is_Archived) && !isPrivilegedProjectRole_(ctx.role))) throw new Error('Project not found or archived.');
  const mainWbs = getTableRecords_(DB_CONFIG.TABS.MAIN_WBS).filter(function (r) { return String(r.Project_ID || '').trim() === pid && !isTruthySheetFlag_(r.Is_Archived); });
  const deliverables = getTableRecords_(DB_CONFIG.TABS.DELIVERABLES).filter(function (r) { return String(r.Project_ID || '').trim() === pid && !isTruthySheetFlag_(r.Is_Archived); });
  const risks = getTableRecords_(DB_CONFIG.TABS.RISKS).filter(function (r) { return String(r.Project_ID || '').trim() === pid && !isTruthySheetFlag_(r.Is_Archived); });
  const issues = getTableRecords_(DB_CONFIG.TABS.ISSUES).filter(function (r) { return String(r.Project_ID || '').trim() === pid && !isTruthySheetFlag_(r.Is_Archived); });
  const milestoneRecords = getTableRecords_(DB_CONFIG.TABS.MILESTONES).filter(function (r) { return String(r.Project_ID || '').trim() === pid && !isTruthySheetFlag_(r.Is_Archived); });
  const milestoneSummary = { total: milestoneRecords.length, achieved: milestoneRecords.filter(function (m) { return ['completed','achieved'].includes(String(m.Milestone_Status || '').trim().toLowerCase()); }).length, delayed: milestoneRecords.filter(function (m) { return ['delayed','overdue'].includes(String(m.Milestone_Status || '').trim().toLowerCase()); }).length, ongoing: milestoneRecords.filter(function (m) { return ['in progress','ongoing'].includes(String(m.Milestone_Status || '').trim().toLowerCase()); }).length };
  const weekly = getTableRecords_(DB_CONFIG.TABS.WEEKLY_REPORTS).filter(function (r) { return String(r.Project_ID || '').trim() === pid; });
  // Current reporting week is based on the ISO-8601 calendar week in Philippine time,
  // not on whichever reporting week happens to have the latest submitted report.
  const currentLocalDate = Utilities.formatDate(new Date(), 'Asia/Manila', 'yyyy-MM-dd');
  const getIsoWeekInfo_ = function (dateText) {
    const m = String(dateText || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    if (isNaN(d.getTime())) return null;
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const isoYear = d.getUTCFullYear();
    const yearStart = new Date(Date.UTC(isoYear, 0, 1));
    const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return { year: isoYear, week: week, key: isoYear + '-W' + String(week).padStart(2, '0') };
  };
  const currentIsoWeek = getIsoWeekInfo_(currentLocalDate);
  const currentReportingWeek = currentIsoWeek ? currentIsoWeek.key : '';
  const getReportIsoWeek_ = function (r) {
    const period = String(r.Reporting_Period || '').trim();
    const periodDates = period.match(/\d{4}-\d{2}-\d{2}/g);
    if (periodDates && periodDates.length) return getIsoWeekInfo_(periodDates[0]);
    const label = String(r.Reporting_Week || '').trim();
    let m = label.match(/(?:^|\D)(\d{4})\s*[-/]?\s*W(?:EEK)?\s*0?(\d{1,2})(?:\D|$)/i);
    if (m) return { year: Number(m[1]), week: Number(m[2]) };
    m = label.match(/\bW(?:EEK)?\s*0?(\d{1,2})\D+(\d{4})\b/i);
    if (m) return { week: Number(m[1]), year: Number(m[2]) };
    m = label.match(/\bW(?:EEK)?\s*0?(\d{1,2})\b/i);
    if (m) return { week: Number(m[1]), year: null };
    return null;
  };
  const currentWeekReports = currentIsoWeek ? weekly.filter(function (r) {
    const reportWeek = getReportIsoWeek_(r);
    return Boolean(reportWeek && reportWeek.week === currentIsoWeek.week &&
      (reportWeek.year === null || reportWeek.year === currentIsoWeek.year));
  }) : [];
  const getSubmissionSortValue_ = function (r) {
    const value = r.Submission_Date || r.Created_At || '';
    const parsed = value instanceof Date ? value.getTime() : Date.parse(String(value));
    return isNaN(parsed) ? 0 : parsed;
  };
  const latestReportByMainWbs = {};
  currentWeekReports.forEach(function (r) {
    const mainId = String(r.Main_WBS_ID || '').trim();
    if (!mainId) return; // Project-wide reports are not duplicated under every module.
    const previous = latestReportByMainWbs[mainId];
    if (!previous || getSubmissionSortValue_(r) >= getSubmissionSortValue_(previous)) latestReportByMainWbs[mainId] = r;
  });
  // Completed Main WBS modules are omitted from the narrative panel. Their records
  // remain in the WBS hierarchy and all project progress calculations.
  const activeNarrativeMainWbs = mainWbs.filter(function (w) {
    return (Number(w.Actual_Progress) || 0) < 100;
  });
  const progressMethod = String(project.Progress_Method || 'Approved Activity Weights').trim();
  const mainBasis = function (w) {
    if (progressMethod === 'Quantity-Based Accomplishment') return Math.max(0, Number(w.Target_Quantity) || 0);
    if (progressMethod === 'Duration-Based Weighting') return Math.max(0, Number(w.Baseline_Duration) || 0);
    return Math.max(0, Number(w.WBS_Weight) || 0);
  };
  const mainBasisTotal = mainWbs.reduce(function (sum, w) { return sum + mainBasis(w); }, 0);
  const mainAssignedShare = function (w) { return mainBasisTotal > 0 ? mainBasis(w) / mainBasisTotal * 100 : 0; };
  const openDeliverables = deliverables.filter(function (d) { return !['approved', 'closed', 'completed'].includes(String(d.General_Status || d.Status || '').trim().toLowerCase()); });
  const openRisks = risks.filter(function (r) { return !['closed', 'resolved', 'accepted'].includes(String(r.Current_Status || r.Status || '').trim().toLowerCase()); });
  const openIssues = issues.filter(function (r) { return !['closed', 'resolved'].includes(String(r.Issue_Status || r.Status || '').trim().toLowerCase()); });
  return {
    success: true,
    project: { Project_ID: project.Project_ID, Project_Name: project.Project_Name, Project_Status: project.Project_Status, Project_Health: project.Project_Health, Progress_Method: project.Progress_Method || 'Approved Activity Weights', Overall_Planned_Progress: Number(project.Overall_Planned_Progress) || 0, Overall_Actual_Progress: Number(project.Overall_Actual_Progress) || 0, Contract_Start_Date: project.Contract_Start_Date || '', Contract_Completion_Date: project.Contract_Completion_Date || '', Forecast_Completion_Date: project.Forecast_Completion_Date || '', Project_Description: project.Project_Description || '', Remarks: project.Remarks || '' },
    mainWbs: mainWbs.map(function (w) { return { id: w.Main_WBS_ID, name: w.Module_Name, weight: Number(w.WBS_Weight) || 0, targetQuantity: Number(w.Target_Quantity) || 0, baselineDuration: Number(w.Baseline_Duration) || 0, progress: Number(w.Actual_Progress) || 0, planned: Number(w.Planned_Progress) || 0, status: w.Status || '' }; }),
    subWbs: getTableRecords_(DB_CONFIG.TABS.SUB_WBS).filter(function (w) { return String(w.Project_ID || '').trim() === pid && !isTruthySheetFlag_(w.Is_Archived); }).map(function (w) { return { id: w.Sub_WBS_ID, parentId: w.Parent_Main_WBS_ID, name: w.Task_Name, weight: Number(w.WBS_Weight) || 0, targetQuantity: Number(w.Target_Quantity) || 0, baselineDuration: Number(w.Baseline_Duration) || 0, progress: Number(w.Actual_Progress) || 0, planned: Number(w.Planned_Progress) || 0, status: w.Status || '' }; }),
    activities: getTableRecords_(DB_CONFIG.TABS.ACTIVITIES).filter(function (a) { return String(a.Project_ID || '').trim() === pid && !isTruthySheetFlag_(a.Is_Archived); }).map(function (a) { return { id: a.Activity_ID, mainWbsId: a.Main_WBS_ID || '', subWbsId: a.Sub_WBS_ID || '', name: a.Activity_Name || '', weight: Number(a.Activity_Weight) || 0, targetQuantity: Number(a.Target_Quantity) || 0, baselineDuration: Number(a.Baseline_Duration) || 0, progress: Number(a.Actual_Progress) || 0, status: a.Status || '' }; }),
    deliverables: { total: deliverables.length, pending: openDeliverables.length, statuses: openDeliverables.reduce(function (acc, d) { const k = String(d.General_Status || d.Status || 'Pending'); acc[k] = (acc[k] || 0) + 1; return acc; }, {}) },
    milestoneSummary: milestoneSummary,
    risks: { open: openRisks.length, statuses: openRisks.reduce(function (acc, r) { const k = String(r.Current_Status || r.Status || 'Open'); acc[k] = (acc[k] || 0) + 1; return acc; }, {}) },
    issues: { open: openIssues.length, statuses: openIssues.reduce(function (acc, r) { const k = String(r.Issue_Status || r.Status || 'Open'); acc[k] = (acc[k] || 0) + 1; return acc; }, {}) },
    deliverableRecords: deliverables,
    riskRecords: risks,
    issueRecords: issues,
    currentReportingWeek: currentReportingWeek,
    weeklyNarratives: activeNarrativeMainWbs.map(function (w) {
      const r = latestReportByMainWbs[String(w.Main_WBS_ID || '').trim()];
      return {
        Main_WBS_ID: w.Main_WBS_ID || '',
        Project_Module: w.Module_Name || '',
        Actual_Progress: Number(w.Actual_Progress) || 0,
        Assigned_Weight: mainAssignedShare(w),
        Earned_Weight: mainAssignedShare(w) * (Number(w.Actual_Progress) || 0) / 100,
        Project_Module_Lead: r ? (r.Responsible_Team_Lead || '') : '',
        Reporting_Week: currentReportingWeek,
        Submitted: Boolean(r),
        Key_Accomplishments: r ? (r.Key_Accomplishments || r.Accomplishments || '') : '',
        Ongoing_Activities: r ? (r.Ongoing_Activities || r.Activities_Completed || '') : '',
        Major_Concerns_Risks: r ? ([r.Major_Concerns, r.Risks_and_Issues].filter(Boolean).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(' · ') || '') : '',
        Management_Attention_Required: r ? (r.Management_Attention_Required || r.Management_Support_Needed || '') : '',
        Next_Steps: r ? (r.Next_Steps || r.Planned_Activities || r.Pending_Activities || '') : '',
        Submission_Date: r ? (r.Submission_Date || r.Created_At || '') : ''
      };
    })
  };
}

function apiGetPortfolioData(filters) {
  const ctx = assertPermission_('Portfolio', 'view', null);
  filters = filters || {};
  if (filters.includeArchived && !isPrivilegedProjectRole_(ctx.role)) throw new Error('Permission denied: archived Project Register records are restricted to Administrator, Project Director, Project Manager, and Assistant Project Manager.');

  const allProjects = getTableRecords_(DB_CONFIG.TABS.PROJECTS);
  const assignments = ctx.isAdmin ? getTableRecords_(DB_CONFIG.TABS.PROJECT_ASSIGNMENTS) : [];
  const milestones = getTableRecords_(DB_CONFIG.TABS.MILESTONES);
  const risks = getTableRecords_(DB_CONFIG.TABS.RISKS);
  const issues = getTableRecords_(DB_CONFIG.TABS.ISSUES);
  const deliverables = getTableRecords_(DB_CONFIG.TABS.DELIVERABLES);
  const permits = getTableRecords_(DB_CONFIG.TABS.PERMITS);
  const approvals = getTableRecords_(DB_CONFIG.TABS.APPROVALS);
  const workload = getTableRecords_(DB_CONFIG.TABS.TEAM_WORKLOAD);
  const canViewProcurement = Boolean(ctx.permissions['Procurement_Logistics'] && ctx.permissions['Procurement_Logistics'].view);
  const canViewFinancial = Boolean(ctx.permissions['Financial_Monitoring'] && ctx.permissions['Financial_Monitoring'].view);
  const procurement = canViewProcurement ? getTableRecords_(DB_CONFIG.TABS.PROCUREMENT) : [];
  const financials = canViewFinancial ? getTableRecords_(DB_CONFIG.TABS.FINANCIAL) : [];

  // Filter projects by user access scope first
  let visibleProjects = allProjects.filter(p => {
    const pid = String(p.Project_ID || '').trim();
    if (!pid) return false;
    if (ctx.isGlobalViewer) return true;
    return ctx.assignedProjectIds.includes(pid);
  });

  // Optional archive filter (by default hide archived unless includeArchived = true)
  if (!filters.includeArchived) {
    visibleProjects = visibleProjects.filter(p => String(p.Is_Archived || '').toUpperCase() !== 'TRUE');
  }

  // Apply user-selected filters
  if (filters.projectId && filters.projectId !== 'ALL') {
    visibleProjects = visibleProjects.filter(p => String(p.Project_ID) === String(filters.projectId));
  }
  if (filters.manager && filters.manager !== 'ALL') {
    visibleProjects = visibleProjects.filter(p => String(p.Project_Manager || '') === String(filters.manager));
  }
  if (filters.client && filters.client !== 'ALL') {
    visibleProjects = visibleProjects.filter(p => String(p.Client || '') === String(filters.client));
  }
  if (filters.status && filters.status !== 'ALL') {
    visibleProjects = visibleProjects.filter(p => String(p.Project_Status || '') === String(filters.status));
  }
  if (filters.health && filters.health !== 'ALL') {
    visibleProjects = visibleProjects.filter(p => String(p.Project_Health || '') === String(filters.health));
  }
  if (filters.priority && filters.priority !== 'ALL') {
    visibleProjects = visibleProjects.filter(p => String(p.Priority || '') === String(filters.priority));
  }
  if (filters.search) {
    const q = String(filters.search).toLowerCase().trim();
    visibleProjects = visibleProjects.filter(p =>
      String(p.Project_ID || '').toLowerCase().includes(q) ||
      String(p.Project_Name || '').toLowerCase().includes(q) ||
      String(p.Client || '').toLowerCase().includes(q) ||
      String(p.Project_Location || '').toLowerCase().includes(q)
    );
  }

  const visibleIds = new Set(visibleProjects.map(p => String(p.Project_ID).trim()));
  const todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  const totalProjects = visibleProjects.length;
  const activeProjects = visibleProjects.filter(p => String(p.Project_Status) === 'Active').length;
  const completedProjects = visibleProjects.filter(p => String(p.Project_Status) === 'Completed').length;
  const onHoldProjects = visibleProjects.filter(p => String(p.Project_Status) === 'On Hold').length;
  const delayedProjects = visibleProjects.filter(p => String(p.Project_Status) === 'Delayed').length;

  let aheadCount = 0;
  let behindCount = 0;
  let progressSum = 0;

  visibleProjects.forEach(p => {
    const planned = parseFloat(p.Overall_Planned_Progress) || 0;
    const actual = parseFloat(p.Overall_Actual_Progress) || 0;
    progressSum += actual;
    if (actual > planned + 0.01) aheadCount++;
    else if (actual < planned - 0.01) behindCount++;
  });

  const avgPortfolioProgress = totalProjects > 0 ? Number((progressSum / totalProjects).toFixed(2)) : 0;

  const delayedMilestones = milestones.filter(m =>
    visibleIds.has(String(m.Project_ID).trim()) &&
    String(m.Milestone_Status) !== 'Completed' &&
    m.Forecast_Date && String(m.Forecast_Date) < todayStr
  ).length;

  const criticalRisks = risks.filter(r =>
    visibleIds.has(String(r.Project_ID).trim()) &&
    String(r.Current_Status) !== 'Closed' &&
    (String(r.Risk_Rating).toUpperCase().includes('CRITICAL') || String(r.Risk_Rating).toUpperCase().includes('HIGH') || Number(r.Risk_Rating) >= 15)
  ).length;

  const openIssues = issues.filter(i =>
    visibleIds.has(String(i.Project_ID).trim()) &&
    !['Closed', 'Resolved'].includes(String(i.Issue_Status))
  ).length;

  const pendingDeliverables = deliverables.filter(d =>
    visibleIds.has(String(d.Project_ID).trim()) &&
    !['Approved', 'Closed'].includes(String(d.General_Status))
  ).length;

  const canViewPermits = Boolean(ctx.permissions['Permits'] && ctx.permissions['Permits'].view);
  const canViewApprovals = Boolean(ctx.permissions['Approvals'] && ctx.permissions['Approvals'].view);
  const pendingPermitsAndApprovals =
    (canViewPermits ? permits.filter(pm => visibleIds.has(String(pm.Project_ID).trim()) && !['Approved', 'Issued', 'Closed'].includes(String(pm.Permit_Status))).length : 0) +
    (canViewApprovals ? approvals.filter(ap => visibleIds.has(String(ap.Project_ID).trim()) && !['Approved', 'Closed'].includes(String(ap.Approval_Status))).length : 0);

  // Consolidate resource utilization without double-counting unique employees
  const empAllocMap = {};
  workload.filter(w => visibleIds.has(String(w.Assigned_Project_ID).trim()) && String(w.Assignment_Status) !== 'Completed').forEach(w => {
    const empKey = String(w.Employee_ID || w.Employee_Name || '').trim().toLowerCase();
    const pct = parseFloat(w.Workload_Allocation_Pct) || 0;
    if (!empKey) return;
    empAllocMap[empKey] = (empAllocMap[empKey] || 0) + pct;
  });
  const empKeys = Object.keys(empAllocMap);
  const avgResourceUtilization = empKeys.length > 0
    ? Number((empKeys.reduce((acc, k) => acc + empAllocMap[k], 0) / empKeys.length).toFixed(1))
    : 0;

  const totalProcurementItems = procurement.filter(pr => visibleIds.has(String(pr.Project_ID).trim())).length;
  const delayedProcurementItems = procurement.filter(pr =>
    visibleIds.has(String(pr.Project_ID).trim()) &&
    String(pr.Logistics_Status || '').toLowerCase().includes('delay')
  ).length;

  let totalBudget = 0;
  let totalActualSpend = 0;
  financials.filter(f => visibleIds.has(String(f.Project_ID).trim())).forEach(f => {
    totalBudget += parseFloat(f.Approved_Budget) || 0;
    totalActualSpend += parseFloat(f.Actual_Expenditure) || 0;
  });

  // Unique filter option lists from accessible projects
  const managers = [...new Set(visibleProjects.map(p => String(p.Project_Manager || '').trim()).filter(Boolean))];
  const clients = [...new Set(visibleProjects.map(p => String(p.Client || '').trim()).filter(Boolean))];

  return {
    success: true,
    context: { email: ctx.email, role: ctx.role, user: ctx.user, isAdmin: ctx.isAdmin, isGlobalViewer: ctx.isGlobalViewer, assignedProjectIds: ctx.assignedProjectIds, permissions: ctx.permissions, pageAccess: ctx.pageAccess },
    projects: visibleProjects,
    assignments: ctx.isAdmin ? assignments.filter(a => visibleIds.has(String(a.Project_ID).trim())) : [],
    filterOptions: { managers: managers, clients: clients },
    kpis: {
      totalProjects: totalProjects,
      activeProjects: activeProjects,
      completedProjects: completedProjects,
      onHoldProjects: onHoldProjects,
      delayedProjects: delayedProjects,
      projectsAhead: aheadCount,
      projectsBehind: behindCount,
      avgPortfolioProgress: avgPortfolioProgress,
      delayedMilestones: delayedMilestones,
      criticalRisks: criticalRisks,
      openIssues: openIssues,
      pendingDeliverables: pendingDeliverables,
      pendingPermitsAndApprovals: pendingPermitsAndApprovals,
      avgResourceUtilization: avgResourceUtilization,
      totalProcurementItems: totalProcurementItems,
      delayedProcurementItems: delayedProcurementItems,
      totalBudget: totalBudget,
      totalActualSpend: totalActualSpend
    },
    moduleVisibility: { procurement: canViewProcurement, financials: canViewFinancial }
  };
}

/**
 * Creates a new project in Projects, assigns the creator/PM in Project_Assignments,
 * and writes an Audit_Logs entry.
 */

/**
 * Project Register data is intentionally separated from the portfolio feed.
 * The portfolio API is available to assigned workspace viewers; this endpoint
 * enforces the stricter Project_Register page policy on the server.
 */
function apiGetProjectRegisterData(filters) {
  const ctx = assertPageAccess_('Project_Register');
  const options = filters || {};
  const includeArchived = isTruthySheetFlag_(options.includeArchived);
  const projects = (getTableRecords_(DB_CONFIG.TABS.PROJECTS) || []).filter(function (p) {
    const pid = String(p.Project_ID || '').trim();
    if (!pid) return false;
    if (!ctx.isAdmin && (!Array.isArray(ctx.assignedProjectIds) || ctx.assignedProjectIds.indexOf(pid) === -1)) return false;
    if (!includeArchived && isTruthySheetFlag_(p.Is_Archived)) return false;
    return true;
  });
  return { success: true, projects: projects, includeArchived: includeArchived };
}

/** Enforces immutable project ownership before a record can be updated. */
function assertRecordProjectOwnership_(existing, requestedProjectId, recordLabel) {
  if (!existing) throw new Error((recordLabel || 'Record') + ' was not found.');
  if (isTruthySheetFlag_(existing.Is_Archived)) throw new Error((recordLabel || 'Record') + ' is archived and cannot be referenced or modified.');
  const requested = String(requestedProjectId || '').trim();
  const stored = String(existing.Project_ID || existing.Assigned_Project_ID || '').trim();
  if (!requested || !stored || stored !== requested) {
    throw new Error((recordLabel || 'Record') + ' does not belong to the active project.');
  }
}

function apiCreateProject(payload) {
  const ctx = assertPermission_('Projects', 'create', null);
  payload = payload || {};

  const projectName = String(payload.Project_Name || '').trim();
  const client = String(payload.Client || '').trim();
  if (!projectName) {
    throw new Error('Project Name is required.');
  }

  let newId = payload.Project_ID && String(payload.Project_ID).trim()
    ? String(payload.Project_ID).trim()
    : '';

  if (newId) {
    const existing = findRecordRowById_(DB_CONFIG.TABS.PROJECTS, 'Project_ID', newId);
    if (existing) {
      throw new Error('A project with Project_ID "' + newId + '" already exists.');
    }
  }

  const nowDate = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const nowTs = getNowTimestamp_();

  const record = {
    Project_ID: newId,
    Project_Name: projectName,
    Client: client,
    Project_Description: String(payload.Project_Description || '').trim(),
    Project_Category: String(payload.Project_Category || 'General').trim(),
    Project_Manager: String(payload.Project_Manager || ctx.user.email).trim(),
    Project_Team: String(payload.Project_Team || '').trim(),
    Project_Location: String(payload.Project_Location || '').trim(),
    Contract_Value: payload.Contract_Value !== '' && payload.Contract_Value !== undefined ? Number(payload.Contract_Value) : 0,
    Approved_Budget: payload.Approved_Budget !== '' && payload.Approved_Budget !== undefined ? Number(payload.Approved_Budget) : 0,
    Currency: String(payload.Currency || 'USD').trim(),
    Contract_Start_Date: String(payload.Contract_Start_Date || '').trim(),
    Contract_Completion_Date: String(payload.Contract_Completion_Date || '').trim(),
    Actual_Start_Date: String(payload.Actual_Start_Date || '').trim(),
    Forecast_Completion_Date: String(payload.Forecast_Completion_Date || payload.Contract_Completion_Date || '').trim(),
    Actual_Completion_Date: String(payload.Actual_Completion_Date || '').trim(),
    Progress_Method: String(payload.Progress_Method || 'Approved Activity Weights').trim(),
    WBS_Hierarchy_Depth: Math.max(1, Math.min(3, Number(payload.WBS_Hierarchy_Depth) || 2)),
    Overall_Planned_Progress: Number(payload.Overall_Planned_Progress) || 0,
    Overall_Actual_Progress: Number(payload.Overall_Actual_Progress) || 0,
    Project_Status: String(payload.Project_Status || 'Planning').trim(),
    Project_Health: String(payload.Project_Health || 'On Track').trim(),
    Priority: String(payload.Priority || 'Medium').trim(),
    Is_Archived: 'FALSE',
    Remarks: String(payload.Remarks || '').trim(),
    Created_At: nowDate,
    Updated_At: nowTs
  };

  // Serialize project ID validation/insertion and the creator assignment together.
  const projectCreateLock = LockService.getScriptLock();
  projectCreateLock.waitLock(10000);
  try {
    if (newId) {
      invalidateTableCache_(DB_CONFIG.TABS.PROJECTS);
      const existingUnderLock = findRecordRowById_(DB_CONFIG.TABS.PROJECTS, 'Project_ID', newId);
      if (existingUnderLock) throw new Error('A project with Project_ID "' + newId + '" already exists.');
      insertRecord_(DB_CONFIG.TABS.PROJECTS, record);
    } else {
      insertRecordWithGeneratedId_(DB_CONFIG.TABS.PROJECTS, 'Project_ID', 'PRJ', 3, record);
      newId = record.Project_ID;
    }

    // Assign creator automatically if not global admin/management
    const assignment = {
      Assignment_ID: '',
      Project_ID: newId,
      User_ID: ctx.user.userId || '',
      User_Email: ctx.user.email,
      Project_Role: ctx.role || 'Project Lead',
      Assigned_Role: ctx.role || 'Project Lead',
      Assignment_Status: 'Active',
      Assigned_By: ctx.user.email,
      Assigned_At: nowDate,
      Assignment_Date: nowDate,
      Last_Updated: nowTs,
      Is_Active: 'TRUE'
    };
    try {
      insertRecordWithGeneratedId_(DB_CONFIG.TABS.PROJECT_ASSIGNMENTS, 'Assignment_ID', 'ASG', 4, assignment);
    } catch (assignmentError) {
      deleteRecordById_(DB_CONFIG.TABS.PROJECTS, 'Project_ID', newId);
      record.Project_ID = '';
      throw assignmentError;
    }
  } finally {
    projectCreateLock.releaseLock();
  }

  writeAuditLog_(ctx, 'CREATE_PROJECT', 'Projects', newId, null, record, 'Created project record');
  return { success: true, project: record };
}

/**
 * Updates an existing project and logs previous/updated values in Audit_Logs.
 */
function apiUpdateProject(projectId, updates, reason) {
  const ctx = assertPermission_('Projects', 'edit', projectId);
  updates = updates || {};
  if (!projectId) throw new Error('Project_ID is required.');

  const allowedFields = [
    'Project_Name', 'Client', 'Project_Description', 'Project_Category', 'Project_Manager',
    'Project_Team', 'Project_Location', 'Contract_Value', 'Approved_Budget', 'Currency',
    'Contract_Start_Date', 'Contract_Completion_Date', 'Actual_Start_Date',
    'Forecast_Completion_Date', 'Actual_Completion_Date', 'Progress_Method',
    'Overall_Planned_Progress', 'Overall_Actual_Progress', 'Project_Status',
    'Project_Health', 'Priority', 'Remarks'
  ];
  const cleanUpdates = {};
  Object.keys(updates || {}).forEach(function (key) {
    if (allowedFields.indexOf(key) !== -1) cleanUpdates[key] = updates[key];
  });
  cleanUpdates.Updated_At = getNowTimestamp_();

  const result = updateRecordById_(DB_CONFIG.TABS.PROJECTS, 'Project_ID', projectId, cleanUpdates);
  writeAuditLog_(ctx, 'UPDATE_PROJECT', 'Projects', projectId, result.previous, result.updated, reason || 'Updated project details');

  return { success: true, project: result.updated };
}

/**
 * Archives or restores a project (soft-delete protection).
 */
function apiArchiveProject(projectId, archiveFlag, reason) {
  const ctx = assertPermission_('Projects', 'edit', projectId);
  if (!projectId) throw new Error('Project_ID is required.');

  const result = updateRecordById_(DB_CONFIG.TABS.PROJECTS, 'Project_ID', projectId, {
    Is_Archived: archiveFlag ? 'TRUE' : 'FALSE',
    Project_Status: archiveFlag ? 'Archived' : 'Active',
    Updated_At: getNowTimestamp_()
  });

  writeAuditLog_(
    ctx,
    archiveFlag ? 'ARCHIVE_PROJECT' : 'RESTORE_PROJECT',
    'Projects',
    projectId,
    result.previous,
    result.updated,
    reason || (archiveFlag ? 'Archived project' : 'Restored project')
  );

  return { success: true, project: result.updated };
}

/**
 * Fetches Main WBS, Sub WBS, Activities, and Schedule Dependencies for a project.
 */
function apiGetProjectWbsAndSchedule(projectId) {
  const ctx = assertPermission_('WBS_Schedule', 'view', projectId);
  if (!projectId) throw new Error('Project_ID is required.');

  const pid = String(projectId).trim();
  const mainWbs = getTableRecords_(DB_CONFIG.TABS.MAIN_WBS)
    .filter(r => String(r.Project_ID).trim() === pid && String(r.Is_Archived || '').toUpperCase() !== 'TRUE');

  const subWbs = getTableRecords_(DB_CONFIG.TABS.SUB_WBS)
    .filter(r => String(r.Project_ID).trim() === pid && String(r.Is_Archived || '').toUpperCase() !== 'TRUE');

  const activities = getTableRecords_(DB_CONFIG.TABS.ACTIVITIES)
    .filter(r => String(r.Project_ID).trim() === pid && !isTruthySheetFlag_(r.Is_Archived));

  const dependencies = getTableRecords_(DB_CONFIG.TABS.DEPENDENCIES)
    .filter(r => String(r.Project_ID).trim() === pid && isActiveDependencyRecord_(r));

  return {
    success: true,
    mainWbs: mainWbs,
    subWbs: subWbs,
    activities: activities,
    dependencies: dependencies,
    wbsHierarchyDepth: 2, // Fixed two-tier hierarchy; legacy Level 3 columns remain for backward compatibility.
    canManageWbs: isPrivilegedProjectRole_(ctx.role),
    canCreateActivities: Boolean(ctx.permissions['Schedule_Activities'] && ctx.permissions['Schedule_Activities'].create),
    canEditActivities: Boolean(ctx.permissions['Schedule_Activities'] && ctx.permissions['Schedule_Activities'].edit),
    canCreate: Boolean(ctx.permissions['WBS_Schedule'] && ctx.permissions['WBS_Schedule'].create),
    canEdit: isPrivilegedProjectRole_(ctx.role)
  };
}

/**
 * Creates or updates a Main WBS module.
 */
function assertPrivilegedWbsRole_(projectId, action) {
  const ctx = getCurrentUserContext_();
  if (!ctx || !ctx.authenticated) throw new Error((ctx && ctx.error) || 'Authentication required.');
  assertProjectAssignment_(ctx, projectId);
  if (!isPrivilegedProjectRole_(ctx.role)) throw new Error('Permission denied: only Administrator, Project Director, Project Manager, or Assistant Project Manager may manage WBS structures.');
  return assertPermission_('WBS_Structure', action || 'edit', projectId);
}

/** Archive or restore a Main WBS, Sub WBS, or Activity. */
function apiSetWbsRecordArchived(recordType, recordId, projectId, archiveFlag, reason) {
  const ctx = assertPrivilegedWbsRole_(projectId, 'edit');
  const types = { main: [DB_CONFIG.TABS.MAIN_WBS, 'Main_WBS_ID'], sub: [DB_CONFIG.TABS.SUB_WBS, 'Sub_WBS_ID'], activity: [DB_CONFIG.TABS.ACTIVITIES, 'Activity_ID'] };
  const type = String(recordType || '').toLowerCase();
  if (!types[type]) throw new Error('Invalid WBS record type.');
  const cfg = types[type];
  const existing = findRecordRowById_(cfg[0], cfg[1], recordId);
  assertRecordProjectOwnership_(existing, projectId, type + ' record');
  const flag = archiveFlag ? 'TRUE' : 'FALSE';
  const result = updateRecordById_(cfg[0], cfg[1], recordId, { Is_Archived: flag });
  writeAuditLog_(ctx, archiveFlag ? 'ARCHIVE_WBS_RECORD' : 'RESTORE_WBS_RECORD', 'WBS_Structure', recordId, result.previous, result.updated, reason || (archiveFlag ? 'Archived WBS record' : 'Restored WBS record'));
  return { success: true, recordType: type, recordId: String(recordId), isArchived: Boolean(archiveFlag) };
}

/** Permanently delete a WBS record only when no dependent records remain. */
function apiDeleteWbsRecord(recordType, recordId, projectId, reason) {
  const ctx = assertPrivilegedWbsRole_(projectId, 'delete');
  const types = { main: [DB_CONFIG.TABS.MAIN_WBS, 'Main_WBS_ID'], sub: [DB_CONFIG.TABS.SUB_WBS, 'Sub_WBS_ID'], activity: [DB_CONFIG.TABS.ACTIVITIES, 'Activity_ID'] };
  const type = String(recordType || '').toLowerCase();
  if (!types[type]) throw new Error('Invalid WBS record type.');
  const cfg = types[type];
  const existing = findRecordRowById_(cfg[0], cfg[1], recordId);
  assertRecordProjectOwnership_(existing, projectId, type + ' record');
  const pid = String(projectId).trim();
  if (type === 'main') {
    const hasSubs = getTableRecords_(DB_CONFIG.TABS.SUB_WBS).some(r => String(r.Project_ID) === pid && String(r.Parent_Main_WBS_ID) === String(recordId));
    const hasActs = getTableRecords_(DB_CONFIG.TABS.ACTIVITIES).some(r => String(r.Project_ID) === pid && String(r.Main_WBS_ID) === String(recordId));
    if (hasSubs || hasActs) throw new Error('Cannot delete this Main WBS because it still has Sub WBS or Activities. Archive it instead, or remove its child records first.');
  } else if (type === 'sub') {
    const hasActs = getTableRecords_(DB_CONFIG.TABS.ACTIVITIES).some(r => String(r.Project_ID) === pid && String(r.Sub_WBS_ID) === String(recordId));
    if (hasActs) throw new Error('Cannot delete this Sub WBS because it still has Activities. Archive it instead, or remove its child activities first.');
  } else {
    const deps = getTableRecords_(DB_CONFIG.TABS.DEPENDENCIES).filter(d => String(d.Project_ID) === pid && isActiveDependencyRecord_(d));
    if (deps.some(d => String(d.Predecessor_ID) === String(recordId) || String(d.Successor_ID) === String(recordId))) throw new Error('Cannot delete this Activity because it is referenced by a schedule dependency. Remove or update the dependency first.');
  }
  const previous = deleteRecordById_(cfg[0], cfg[1], recordId);
  writeAuditLog_(ctx, 'DELETE_WBS_RECORD', 'WBS_Structure', recordId, previous, null, reason || 'Deleted WBS record');
  return { success: true, recordType: type, recordId: String(recordId) };
}

function assertScheduleActivityPermission_(projectId, action, existingActivity) {
  const ctx = getCurrentUserContext_();
  if (!ctx || !ctx.authenticated) throw new Error((ctx && ctx.error) || 'Authentication required.');
  assertProjectAssignment_(ctx, projectId);
  if (['create', 'edit'].indexOf(action) === -1) throw new Error('Permission denied for schedule activity operation.');
  if (!isPrivilegedProjectRole_(ctx.role) && normalizeRoleName_(ctx.role) !== 'Project Team Member') throw new Error('Permission denied for schedule activity operation.');
  if (normalizeRoleName_(ctx.role) === 'Project Team Member' && action === 'edit') {
    const owner = String((existingActivity && (existingActivity.Created_By_Email || existingActivity.Owner_Email || existingActivity.Assigned_To_Email || existingActivity.Created_By)) || '').trim().toLowerCase();
    if (!owner || owner !== String(ctx.email || '').trim().toLowerCase()) {
      throw new Error('Project Team Members may edit only activities assigned to or created by their own account.');
    }
  }
  return assertPermission_('Schedule_Activities', action, projectId);
}

function apiSaveMainWbs(payload) {
  const existing = payload.Main_WBS_ID ? findRecordRowById_(DB_CONFIG.TABS.MAIN_WBS, 'Main_WBS_ID', payload.Main_WBS_ID) : null;
  const isUpdate = Boolean(existing);
  if (isUpdate) assertRecordProjectOwnership_(existing, payload.Project_ID, 'Main WBS record');
  const ctx = assertPrivilegedWbsRole_(payload.Project_ID, isUpdate ? 'edit' : 'create');
  // Preserve fields not exposed by the current edit form.
  if (isUpdate) payload = Object.assign({}, existing, payload);

  const depthProject = findRecordRowById_(DB_CONFIG.TABS.PROJECTS, 'Project_ID', payload.Project_ID);
  if (Number(depthProject && depthProject.WBS_Hierarchy_Depth || 2) < 1) throw new Error('Invalid WBS hierarchy configuration.');
  if (!payload.Project_ID || !String(payload.Module_Name || '').trim()) {
    throw new Error('Project ID and Module Name are required for Main WBS.');
  }

  const baseDur = payload.Baseline_Duration !== '' && payload.Baseline_Duration !== undefined
    ? Number(payload.Baseline_Duration)
    : calculateDurationDays_(payload.Baseline_Start_Date, payload.Baseline_Finish_Date, false);

  const actDur = payload.Actual_Duration !== '' && payload.Actual_Duration !== undefined
    ? Number(payload.Actual_Duration)
    : calculateDurationDays_(payload.Actual_Start_Date, payload.Actual_Finish_Date, false);

  let mainWbsId = isUpdate ? String(payload.Main_WBS_ID).trim() : '';
  let mainWbsCode = String(payload.WBS_Code || mainWbsId).trim();
  const checkDuplicateMainWbsCode = function(code, id) {
    if (!code) throw new Error('Main WBS Code is required.');
    if ((getTableRecords_(DB_CONFIG.TABS.MAIN_WBS) || []).some(function (x) {
      return String(x.Project_ID) === String(payload.Project_ID) &&
        String(x.WBS_Code || x.Main_WBS_ID || '').trim().toLowerCase() === code.toLowerCase() &&
        String(x.Main_WBS_ID) !== id && !isTruthySheetFlag_(x.Is_Archived);
    })) throw new Error('Duplicate Main WBS Code in this project.');
  };
  if (isUpdate) checkDuplicateMainWbsCode(mainWbsCode, mainWbsId);
  const now = getNowTimestamp_();
  const record = {
    Main_WBS_ID: mainWbsId,
    WBS_Code: mainWbsCode, WBS_Level: 1, WBS_Type: 'Main WBS',
    Sequence: Number(payload.Sequence) || 0, Parent_WBS_ID: '',
    Description: String(payload.Description || payload.Module_Description || '').trim(),
    Created_By: isUpdate ? existing.Created_By : ctx.email, Created_Date: isUpdate ? existing.Created_Date : now,
    Updated_By: ctx.email, Updated_Date: now,
    Project_ID: String(payload.Project_ID).trim(),
    Module_Name: String(payload.Module_Name).trim(),
    Module_Description: String(payload.Module_Description || '').trim(),
    Responsible_Team_Lead: String(payload.Responsible_Team_Lead || '').trim(),
    WBS_Weight: Number(payload.WBS_Weight) || 0,
    Baseline_Start_Date: String(payload.Baseline_Start_Date || '').trim(),
    Baseline_Finish_Date: String(payload.Baseline_Finish_Date || '').trim(),
    Baseline_Duration: baseDur,
    Actual_Start_Date: String(payload.Actual_Start_Date || '').trim(),
    Actual_Finish_Date: String(payload.Actual_Finish_Date || '').trim(),
    Actual_Duration: actDur,
    Planned_Progress: Number(payload.Planned_Progress) || 0,
    Actual_Progress: Number(payload.Actual_Progress) || 0,
    Status: String(payload.Status || 'Not Started').trim(),
    Is_Archived: 'FALSE',
    Remarks: String(payload.Remarks || '').trim()
  };

  if (isUpdate) {
    const wbsUpdateLock = LockService.getScriptLock();
    wbsUpdateLock.waitLock(10000);
    let res;
    try {
      invalidateTableCache_(DB_CONFIG.TABS.MAIN_WBS);
      checkDuplicateMainWbsCode(mainWbsCode, record.Main_WBS_ID);
      res = updateRecordById_(DB_CONFIG.TABS.MAIN_WBS, 'Main_WBS_ID', record.Main_WBS_ID, record);
    } finally {
      wbsUpdateLock.releaseLock();
    }
    writeAuditLog_(ctx, 'UPDATE_MAIN_WBS', 'WBS_Schedule', record.Main_WBS_ID, res.previous, res.updated, 'Updated Main WBS');
  } else {
    insertRecordWithGeneratedId_(DB_CONFIG.TABS.MAIN_WBS, 'Main_WBS_ID', 'MWBS', 3, record, function(id, assignedRecord) {
      assignedRecord.WBS_Code = mainWbsCode || id;
      mainWbsCode = assignedRecord.WBS_Code;
      checkDuplicateMainWbsCode(mainWbsCode, id);
    });
    mainWbsId = record.Main_WBS_ID;
    writeAuditLog_(ctx, 'CREATE_MAIN_WBS', 'WBS_Schedule', record.Main_WBS_ID, null, record, 'Created Main WBS');
  }

  return { success: true, mainWbs: record };
}

/**
 * Creates or updates a Sub WBS task under a parent Main WBS.
 */
function apiSaveSubWbs(payload) {
  const existing = payload.Sub_WBS_ID ? findRecordRowById_(DB_CONFIG.TABS.SUB_WBS, 'Sub_WBS_ID', payload.Sub_WBS_ID) : null;
  const isUpdate = Boolean(existing);
  if (isUpdate) assertRecordProjectOwnership_(existing, payload.Project_ID, 'Sub WBS record');
  const ctx = assertPrivilegedWbsRole_(payload.Project_ID, isUpdate ? 'edit' : 'create');
  // Preserve fields not exposed by the current edit form.
  if (isUpdate) payload = Object.assign({}, existing, payload);

  const depthProject = findRecordRowById_(DB_CONFIG.TABS.PROJECTS, 'Project_ID', payload.Project_ID);
  if (Number(depthProject && depthProject.WBS_Hierarchy_Depth || 2) < 2) throw new Error('This project is configured for Level 1 WBS only.');
  if (!payload.Project_ID || !payload.Parent_Main_WBS_ID || !String(payload.Task_Name || '').trim()) {
    throw new Error('Project ID, Parent Main WBS ID, and Task Name are required for Sub WBS.');
  }
  const parentMain = findRecordRowById_(DB_CONFIG.TABS.MAIN_WBS, 'Main_WBS_ID', payload.Parent_Main_WBS_ID);
  assertRecordProjectOwnership_(parentMain, payload.Project_ID, 'Parent Main WBS');

  const baseDur = payload.Baseline_Duration !== '' && payload.Baseline_Duration !== undefined
    ? Number(payload.Baseline_Duration)
    : calculateDurationDays_(payload.Baseline_Start_Date, payload.Baseline_Finish_Date, false);

  const actDur = payload.Actual_Duration !== '' && payload.Actual_Duration !== undefined
    ? Number(payload.Actual_Duration)
    : calculateDurationDays_(payload.Actual_Start_Date, payload.Actual_Finish_Date, false);

  let subWbsId = isUpdate ? String(payload.Sub_WBS_ID).trim() : '';
  let subWbsCode = String(payload.WBS_Code || subWbsId).trim();
  const checkDuplicateSubWbsCode = function(code, id) {
    if (!code) throw new Error('Sub WBS Code is required.');
    if ((getTableRecords_(DB_CONFIG.TABS.SUB_WBS) || []).some(function (x) {
      return String(x.Project_ID) === String(payload.Project_ID) &&
        String(x.Parent_Main_WBS_ID) === String(payload.Parent_Main_WBS_ID) &&
        String(x.WBS_Code || x.Sub_WBS_ID || '').trim().toLowerCase() === code.toLowerCase() &&
        String(x.Sub_WBS_ID) !== id && !isTruthySheetFlag_(x.Is_Archived);
    })) throw new Error('Duplicate Sub WBS Code under this Main WBS.');
  };
  if (isUpdate) checkDuplicateSubWbsCode(subWbsCode, subWbsId);
  const now = getNowTimestamp_();
  const record = {
    Sub_WBS_ID: subWbsId,
    WBS_Code: subWbsCode, WBS_Level: 2, WBS_Type: 'Sub WBS',
    Sequence: Number(payload.Sequence) || 0, Parent_WBS_ID: String(payload.Parent_Main_WBS_ID).trim(),
    Description: String(payload.Description || payload.Task_Description || '').trim(),
    Created_By: isUpdate ? existing.Created_By : ctx.email, Created_Date: isUpdate ? existing.Created_Date : now,
    Updated_By: ctx.email, Updated_Date: now,
    Project_ID: String(payload.Project_ID).trim(),
    Parent_Main_WBS_ID: String(payload.Parent_Main_WBS_ID).trim(),
    Task_Name: String(payload.Task_Name).trim(),
    Task_Description: String(payload.Task_Description || '').trim(),
    Responsible_Person: String(payload.Responsible_Person || '').trim(),
    WBS_Weight: Number(payload.WBS_Weight) || 0,
    Baseline_Start_Date: String(payload.Baseline_Start_Date || '').trim(),
    Baseline_Finish_Date: String(payload.Baseline_Finish_Date || '').trim(),
    Baseline_Duration: baseDur,
    Actual_Start_Date: String(payload.Actual_Start_Date || '').trim(),
    Actual_Finish_Date: String(payload.Actual_Finish_Date || '').trim(),
    Actual_Duration: actDur,
    Predecessor_Activity: String(payload.Predecessor_Activity || '').trim(),
    Dependency_Type: String(payload.Dependency_Type || 'FS').trim(),
    Lag_Or_Lead: Number(payload.Lag_Or_Lead) || 0,
    Planned_Progress: Number(payload.Planned_Progress) || 0,
    Actual_Progress: Number(payload.Actual_Progress) || 0,
    Status: String(payload.Status || 'Not Started').trim(),
    Is_Archived: 'FALSE',
    Remarks: String(payload.Remarks || '').trim()
  };

  if (isUpdate) {
    const wbsUpdateLock = LockService.getScriptLock();
    wbsUpdateLock.waitLock(10000);
    let res;
    try {
      invalidateTableCache_(DB_CONFIG.TABS.SUB_WBS);
      checkDuplicateSubWbsCode(subWbsCode, record.Sub_WBS_ID);
      res = updateRecordById_(DB_CONFIG.TABS.SUB_WBS, 'Sub_WBS_ID', record.Sub_WBS_ID, record);
    } finally {
      wbsUpdateLock.releaseLock();
    }
    writeAuditLog_(ctx, 'UPDATE_SUB_WBS', 'WBS_Schedule', record.Sub_WBS_ID, res.previous, res.updated, 'Updated Sub WBS');
  } else {
    insertRecordWithGeneratedId_(DB_CONFIG.TABS.SUB_WBS, 'Sub_WBS_ID', 'SWBS', 3, record, function(id, assignedRecord) {
      assignedRecord.WBS_Code = subWbsCode || id;
      subWbsCode = assignedRecord.WBS_Code;
      checkDuplicateSubWbsCode(subWbsCode, id);
    });
    subWbsId = record.Sub_WBS_ID;
    writeAuditLog_(ctx, 'CREATE_SUB_WBS', 'WBS_Schedule', record.Sub_WBS_ID, null, record, 'Created Sub WBS');
  }

  return { success: true, subWbs: record };
}

function apiSaveProjectWbsDepth(projectId, depth) {
  // Backward-compatible endpoint retained; the active dashboard uses a fixed two-tier hierarchy.
  assertPrivilegedWbsRole_(projectId, 'edit');
  const project = findRecordRowById_(DB_CONFIG.TABS.PROJECTS, 'Project_ID', projectId);
  if (!project) throw new Error('Project not found.');
  return { success: true, depth: 2, fixed: true };
}

function isActiveDependencyRecord_(dependency) {
  if (!dependency) return false;
  if (dependency.Is_Active === undefined || dependency.Is_Active === '') return true;
  return isTruthySheetFlag_(dependency.Is_Active);
}

function wouldCreateDependencyCycle_(projectId, predecessorId, successorId) {
  const pred = String(predecessorId || '').trim();
  const succ = String(successorId || '').trim();
  if (!pred || !succ) return false;
  if (pred === succ) return true;
  const deps = (getTableRecords_(DB_CONFIG.TABS.DEPENDENCIES) || []).filter(function (d) {
    return String(d.Project_ID || '').trim() === String(projectId).trim() && isActiveDependencyRecord_(d);
  });
  const next = {};
  deps.forEach(function (d) {
    const from = String(d.Predecessor_ID || '').trim();
    const to = String(d.Successor_ID || '').trim();
    if (!from || !to) return;
    (next[from] = next[from] || []).push(to);
  });
  const stack = [succ];
  const visited = {};
  while (stack.length) {
    const current = stack.pop();
    if (current === pred) return true;
    if (visited[current]) continue;
    visited[current] = true;
    (next[current] || []).forEach(function (n) { stack.push(n); });
  }
  return false;
}

function apiSaveActivity(payload) {
  const activityMutationLock = LockService.getScriptLock();
  activityMutationLock.waitLock(10000);
  try {
  
    const existing = payload.Activity_ID ? findRecordRowById_(DB_CONFIG.TABS.ACTIVITIES, 'Activity_ID', payload.Activity_ID) : null;
    const isUpdate = Boolean(existing);
    if (isUpdate) assertRecordProjectOwnership_(existing, payload.Project_ID, 'Activity record');
    const ctx = assertScheduleActivityPermission_(payload.Project_ID, isUpdate ? 'edit' : 'create', existing);
    // Preserve fields not exposed by the current edit form.
    if (isUpdate) payload = Object.assign({}, existing, payload);
  
    if (!payload.Project_ID || !String(payload.Activity_Name || '').trim()) {
      throw new Error('Project ID and Activity Name are required.');
    }
    let activityMain = null;
    let activitySub = null;
    if (payload.Main_WBS_ID) {
      activityMain = findRecordRowById_(DB_CONFIG.TABS.MAIN_WBS, 'Main_WBS_ID', payload.Main_WBS_ID);
      assertRecordProjectOwnership_(activityMain, payload.Project_ID, 'Activity Main WBS');
    }
    if (payload.Sub_WBS_ID) {
      activitySub = findRecordRowById_(DB_CONFIG.TABS.SUB_WBS, 'Sub_WBS_ID', payload.Sub_WBS_ID);
      assertRecordProjectOwnership_(activitySub, payload.Project_ID, 'Activity Sub WBS');
      if (payload.Main_WBS_ID && String(activitySub.Parent_Main_WBS_ID || '') !== String(payload.Main_WBS_ID)) throw new Error('Selected Sub WBS does not belong to the selected Main WBS.');
      if (!payload.Main_WBS_ID) payload.Main_WBS_ID = String(activitySub.Parent_Main_WBS_ID || '');
    }
    // A schedule activity may be assigned at either of the two WBS tiers.
    // Main WBS is mandatory and Sub WBS is optional, allowing activities to be
    // assigned directly to Main WBS or to its Sub WBS in the two-tier interface.
    if (!payload.Main_WBS_ID) throw new Error('Select a Main WBS for this Schedule Activity.');
    const currentActivityDependencies = (getTableRecords_(DB_CONFIG.TABS.DEPENDENCIES) || []).filter(function (d) {
      return String(d.Project_ID || '').trim() === String(payload.Project_ID).trim() && String(d.Successor_ID || '').trim() === String(isUpdate ? existing.Activity_ID : '').trim() && isActiveDependencyRecord_(d);
    });
    if (payload.Predecessor_ID || currentActivityDependencies.length || (isUpdate && existing.Predecessor_ID)) {
      assertPermission_('Dependencies', isUpdate ? 'edit' : 'create', payload.Project_ID);
    }
    if (payload.Predecessor_ID) {
      const predecessorId = String(payload.Predecessor_ID).trim();
      assertRecordProjectOwnership_(findRecordRowById_(DB_CONFIG.TABS.ACTIVITIES, 'Activity_ID', predecessorId), payload.Project_ID, 'Predecessor activity');
      const successorIdForCycle = isUpdate ? String(existing.Activity_ID) : 'PENDING_NEW_ACTIVITY';
      if (isUpdate && wouldCreateDependencyCycle_(payload.Project_ID, predecessorId, successorIdForCycle)) throw new Error('This dependency would create a circular schedule relationship.');
      if (isUpdate && predecessorId === String(existing.Activity_ID)) throw new Error('An activity cannot be its own predecessor.');
    }
  
    const baseDur = payload.Baseline_Duration !== '' && payload.Baseline_Duration !== undefined
      ? Number(payload.Baseline_Duration)
      : calculateDurationDays_(payload.Baseline_Start_Date, payload.Baseline_Finish_Date, false);
  
    const refFinish = payload.Actual_Finish_Date || payload.Forecast_Finish_Date || '';
    const varianceDays = calculateScheduleVarianceDays_(payload.Baseline_Finish_Date, refFinish);
  
    let actId = isUpdate ? String(payload.Activity_ID).trim() : '';
  
    const record = {
      Activity_ID: actId,
      Project_ID: String(payload.Project_ID).trim(),
      Main_WBS_ID: String(payload.Main_WBS_ID || '').trim(),
      Sub_WBS_ID: String(payload.Sub_WBS_ID || '').trim(),
      Predecessor_ID: String(payload.Predecessor_ID || '').trim(),
      Dependency_Type: String(payload.Dependency_Type || 'FS').trim(),
      Lag_Or_Lead_Days: Number(payload.Lag_Or_Lead_Days) || 0,
      Created_By_Email: isUpdate ? String(existing.Created_By_Email || ctx.email).trim().toLowerCase() : String(ctx.email || '').trim().toLowerCase(),
      Updated_By_Email: String(ctx.email || '').trim().toLowerCase(),
      Activity_Name: String(payload.Activity_Name).trim(),
      Responsible_Person: String(payload.Responsible_Person || '').trim(),
      Activity_Weight: Number(payload.Activity_Weight) || 0,
      Target_Quantity: Number(payload.Target_Quantity) || 0,
      Actual_Quantity: Number(payload.Actual_Quantity) || 0,
      Unit_Of_Measure: String(payload.Unit_Of_Measure || '').trim(),
      Baseline_Start_Date: String(payload.Baseline_Start_Date || '').trim(),
      Baseline_Finish_Date: String(payload.Baseline_Finish_Date || '').trim(),
      Baseline_Duration: baseDur,
      Forecast_Start_Date: String(payload.Forecast_Start_Date || payload.Baseline_Start_Date || '').trim(),
      Forecast_Finish_Date: String(payload.Forecast_Finish_Date || payload.Baseline_Finish_Date || '').trim(),
      Actual_Start_Date: String(payload.Actual_Start_Date || '').trim(),
      Actual_Finish_Date: String(payload.Actual_Finish_Date || '').trim(),
      Planned_Progress: Number(payload.Planned_Progress) || 0,
      Actual_Progress: Number(payload.Actual_Progress) || 0,
      Schedule_Variance_Days: varianceDays,
      Is_Critical: payload.Is_Critical ? 'TRUE' : 'FALSE',
      Status: String(payload.Status || 'Not Started').trim(),
      Remarks: String(payload.Remarks || '').trim()
    };
  
    let activityAuditPrevious = null;
    let activityAuditUpdated = record;
    if (isUpdate) {
      const res = updateRecordById_(DB_CONFIG.TABS.ACTIVITIES, 'Activity_ID', actId, record);
      activityAuditPrevious = res.previous;
      activityAuditUpdated = res.updated;
    } else {
      insertRecordWithGeneratedId_(DB_CONFIG.TABS.ACTIVITIES, 'Activity_ID', 'ACT', 4, record);
      actId = record.Activity_ID;
    }
  
    let dependencyRows = [];
    let createdDependencyId = '';
    try {
      // Synchronize the activity's single predecessor relationship; keep removed links as inactive history.
      dependencyRows = (getTableRecords_(DB_CONFIG.TABS.DEPENDENCIES) || []).filter(function (d) {
        return String(d.Project_ID || '').trim() === record.Project_ID && String(d.Successor_ID || '').trim() === actId && isActiveDependencyRecord_(d);
      });
      const selectedPredecessor = String(payload.Predecessor_ID || '').trim();
      const dependencyType = String(payload.Dependency_Type || 'FS').trim();
      const lagDays = Number(payload.Lag_Or_Lead_Days) || 0;
      const sameDependency = selectedPredecessor ? dependencyRows.find(function (d) { return String(d.Predecessor_ID || '').trim() === selectedPredecessor; }) : null;
      dependencyRows.forEach(function (d) {
        if (!selectedPredecessor || String(d.Predecessor_ID || '').trim() !== selectedPredecessor) {
          updateRecordById_(DB_CONFIG.TABS.DEPENDENCIES, 'Dependency_ID', d.Dependency_ID, { Is_Active: 'FALSE', Updated_By: ctx.email, Updated_At: getNowTimestamp_() });
        }
      });
      if (selectedPredecessor) {
        if (sameDependency) {
          updateRecordById_(DB_CONFIG.TABS.DEPENDENCIES, 'Dependency_ID', sameDependency.Dependency_ID, { Dependency_Type: dependencyType, Lag_Or_Lead_Days: lagDays, Is_Active: 'TRUE', Updated_By: ctx.email, Updated_At: getNowTimestamp_() });
        } else {
          const dependency = {
            Dependency_ID: '', Project_ID: record.Project_ID,
            Predecessor_ID: selectedPredecessor, Successor_ID: actId,
            Dependency_Type: dependencyType, Lag_Or_Lead_Days: lagDays,
            Is_Active: 'TRUE', Created_By: ctx.email, Created_At: getNowTimestamp_(),
            Updated_By: ctx.email, Updated_At: getNowTimestamp_(), Remarks: 'Linked via WBS & Schedule'
          };
          insertRecordWithGeneratedId_(DB_CONFIG.TABS.DEPENDENCIES, 'Dependency_ID', 'DEP', 4, dependency);
          createdDependencyId = dependency.Dependency_ID;
        }
      }
    
    
    } catch (dependencyError) {
      if (createdDependencyId) deleteRecordById_(DB_CONFIG.TABS.DEPENDENCIES, 'Dependency_ID', createdDependencyId);
      if (isUpdate) {
        updateRecordById_(DB_CONFIG.TABS.ACTIVITIES, 'Activity_ID', actId, existing);
        dependencyRows.forEach(function(previousDependency) {
          updateRecordById_(DB_CONFIG.TABS.DEPENDENCIES, 'Dependency_ID', previousDependency.Dependency_ID, previousDependency);
        });
      } else if (actId) {
        deleteRecordById_(DB_CONFIG.TABS.ACTIVITIES, 'Activity_ID', actId);
      }
      throw dependencyError;
    }
    writeAuditLog_(ctx, isUpdate ? 'UPDATE_ACTIVITY' : 'CREATE_ACTIVITY', 'WBS_Schedule', actId, activityAuditPrevious, activityAuditUpdated, (isUpdate ? 'Updated' : 'Created') + ' schedule activity');
    return { success: true, activity: record };
  
  } finally {
    activityMutationLock.releaseLock();
  }
}
function apiGetGanttAndBaselines(projectId) {
  const ctx = assertPermission_('Gantt_Chart', 'view', projectId);
  if (!projectId) throw new Error('Project_ID is required.');

  const pid = String(projectId).trim();
  const project = findRecordRowById_(DB_CONFIG.TABS.PROJECTS, 'Project_ID', pid);
  if (!project) throw new Error('Project not found: ' + pid);

  const mainWbs = getTableRecords_(DB_CONFIG.TABS.MAIN_WBS)
    .filter(r => String(r.Project_ID).trim() === pid && String(r.Is_Archived || '').toUpperCase() !== 'TRUE');

  const subWbs = getTableRecords_(DB_CONFIG.TABS.SUB_WBS)
    .filter(r => String(r.Project_ID).trim() === pid && String(r.Is_Archived || '').toUpperCase() !== 'TRUE');

  const activities = getTableRecords_(DB_CONFIG.TABS.ACTIVITIES)
    .filter(r => String(r.Project_ID).trim() === pid && String(r.Is_Archived || '').toUpperCase() !== 'TRUE');

  const dependencies = getTableRecords_(DB_CONFIG.TABS.DEPENDENCIES)
    .filter(r => String(r.Project_ID).trim() === pid && isActiveDependencyRecord_(r));

  const baselines = getTableRecords_(DB_CONFIG.TABS.BASELINES)
    .filter(r => String(r.Project_ID).trim() === pid)
    .sort((a, b) => Number(b.Revision_Number || 0) - Number(a.Revision_Number || 0));

  return {
    success: true,
    project: project,
    mainWbs: mainWbs,
    subWbs: subWbs,
    activities: activities,
    dependencies: dependencies,
    baselines: baselines,
    canEdit: Boolean(ctx.permissions['WBS_Schedule'] && ctx.permissions['WBS_Schedule'].edit),
    canManageControls: isPrivilegedProjectRole_(ctx.role),
    canApprove: Boolean(ctx.permissions['WBS_Schedule'] && ctx.permissions['WBS_Schedule'].approve)
  };
}

/**
 * Captures an immutable schedule baseline snapshot in Project_Baselines.
 */
function apiCreateProjectBaseline(projectId, baselineName, remarks) {
  const ctx = assertPermission_('WBS_Schedule', 'approve', projectId);
  if (!projectId) throw new Error('Project_ID is required.');

  const pid = String(projectId).trim();
  const baselineId = '';
  const todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  const mainWbs = getTableRecords_(DB_CONFIG.TABS.MAIN_WBS).filter(r => String(r.Project_ID).trim() === pid);
  const subWbs = getTableRecords_(DB_CONFIG.TABS.SUB_WBS).filter(r => String(r.Project_ID).trim() === pid);
  const activities = getTableRecords_(DB_CONFIG.TABS.ACTIVITIES).filter(r => String(r.Project_ID).trim() === pid);
  const dependencies = getTableRecords_(DB_CONFIG.TABS.DEPENDENCIES).filter(r => String(r.Project_ID).trim() === pid && isActiveDependencyRecord_(r));

  const snapshot = {
    capturedAt: getNowTimestamp_(),
    mainWbs: mainWbs,
    subWbs: subWbs,
    activities: activities,
    dependencies: dependencies
  };

  const record = {
    Baseline_ID: baselineId,
    Project_ID: pid,
    Revision_Number: 0,
    Baseline_Name: String(baselineName || '').trim(),
    Approved_By: ctx.user.fullName + ' (' + ctx.user.email + ')',
    Approved_Date: todayStr,
    Snapshot_JSON: JSON.stringify(snapshot),
    Remarks: String(remarks || '').trim()
  };

  insertRecordWithGeneratedId_(DB_CONFIG.TABS.BASELINES, 'Baseline_ID', 'BL', 3, record, function() {
    invalidateTableCache_(DB_CONFIG.TABS.BASELINES);
    const existingBaselines = getTableRecords_(DB_CONFIG.TABS.BASELINES)
      .filter(b => String(b.Project_ID).trim() === pid);
    record.Revision_Number = existingBaselines.reduce((max, b) => Math.max(max, Number(b.Revision_Number) || 0), 0) + 1;
    if (!record.Baseline_Name) record.Baseline_Name = 'Baseline Rev ' + record.Revision_Number;
  });
  writeAuditLog_(ctx, 'CREATE_BASELINE', 'WBS_Schedule', record.Baseline_ID, null, { Baseline_ID: record.Baseline_ID, Project_ID: pid, Revision_Number: record.Revision_Number }, record.Baseline_Name);

  return { success: true, baseline: record };
}

/**
 * Triggers the weighted progress roll-up engine for a project and logs it.
 */
function apiRecalculateWeightedProgress(projectId, newProgressMethod) {
  const ctx = assertPermission_('WBS_Schedule', 'edit', projectId);
  if (!projectId) throw new Error('Project_ID is required.');

  const pid = String(projectId).trim();
  if (newProgressMethod) {
    updateRecordById_(DB_CONFIG.TABS.PROJECTS, 'Project_ID', pid, {
      Progress_Method: String(newProgressMethod).trim(),
      Updated_At: getNowTimestamp_()
    });
  }

  const summary = recalculateProjectProgressEngine_(pid);
  writeAuditLog_(ctx, 'RECALCULATE_PROGRESS', 'WBS_Schedule', pid, null, summary, 'Weighted progress roll-up executed');

  return { success: true, summary: summary };
}

/**
 * Quick-updates an activity's dates, progress, or critical flag directly from the Gantt chart,
 * then automatically rolls up weighted progress.
 */
function apiQuickUpdateGanttActivity(activityId, updates) {
  const existing = findRecordRowById_(DB_CONFIG.TABS.ACTIVITIES, 'Activity_ID', activityId);
  if (!existing) throw new Error('Activity not found: ' + activityId);

  const ctx = assertPermission_('WBS_Schedule', 'edit', existing.Project_ID);

  const bStart = updates.Baseline_Start_Date !== undefined ? updates.Baseline_Start_Date : existing.Baseline_Start_Date;
  const bEnd = updates.Baseline_Finish_Date !== undefined ? updates.Baseline_Finish_Date : existing.Baseline_Finish_Date;
  const fStart = updates.Forecast_Start_Date !== undefined ? updates.Forecast_Start_Date : existing.Forecast_Start_Date;
  const fEnd = updates.Forecast_Finish_Date !== undefined ? updates.Forecast_Finish_Date : existing.Forecast_Finish_Date;
  const aStart = updates.Actual_Start_Date !== undefined ? updates.Actual_Start_Date : existing.Actual_Start_Date;
  const aEnd = updates.Actual_Finish_Date !== undefined ? updates.Actual_Finish_Date : existing.Actual_Finish_Date;

  const baseDur = calculateDurationDays_(bStart, bEnd, false);
  const refFinish = aEnd || fEnd || '';
  const varianceDays = calculateScheduleVarianceDays_(bEnd, refFinish);

  const patch = {
    Baseline_Start_Date: bStart,
    Baseline_Finish_Date: bEnd,
    Baseline_Duration: baseDur,
    Forecast_Start_Date: fStart,
    Forecast_Finish_Date: fEnd,
    Actual_Start_Date: aStart,
    Actual_Finish_Date: aEnd,
    Schedule_Variance_Days: varianceDays
  };

  if (updates.Planned_Progress !== undefined) patch.Planned_Progress = Number(updates.Planned_Progress) || 0;
  if (updates.Actual_Progress !== undefined) patch.Actual_Progress = Number(updates.Actual_Progress) || 0;
  if (updates.Status !== undefined) patch.Status = String(updates.Status).trim();
  if (updates.Is_Critical !== undefined) patch.Is_Critical = updates.Is_Critical ? 'TRUE' : 'FALSE';

  const res = updateRecordById_(DB_CONFIG.TABS.ACTIVITIES, 'Activity_ID', activityId, patch);
  const rollSummary = recalculateProjectProgressEngine_(existing.Project_ID);

  writeAuditLog_(ctx, 'GANTT_UPDATE_ACTIVITY', 'WBS_Schedule', activityId, res.previous, res.updated, 'Updated via Interactive Gantt Chart');
  return { success: true, activity: res.updated, rollSummary: rollSummary };
}

// ============================================================================
// PHASE 7: PROJECT CONTROLS REGISTRIES (MILESTONES, DELIVERABLES, PERMITS,
// RISKS W/ MATRIX, ISSUES, REPOSITORY LINKS & APPROVALS)
// ============================================================================

const CONTROLS_REGISTRY_CONFIG = {
  'Milestones': {
    tab: DB_CONFIG.TABS.MILESTONES,
    module: 'Milestones',
    idCol: 'Milestone_ID',
    prefix: 'MLS',
    pad: 4,
    wbsMainCol: 'Main_WBS_ID',
    wbsSubCol: 'Sub_WBS_ID'
  },
  'Deliverables': {
    tab: DB_CONFIG.TABS.DELIVERABLES,
    module: 'Deliverables',
    idCol: 'Deliverable_ID',
    prefix: 'DEL',
    pad: 4,
    wbsMainCol: 'Main_WBS_ID',
    wbsSubCol: 'Sub_WBS_ID'
  },
  'Permits': {
    tab: DB_CONFIG.TABS.PERMITS,
    module: 'Permits',
    idCol: 'Permit_ID',
    prefix: 'PMT',
    pad: 4,
    wbsMainCol: 'Related_Main_WBS_ID',
    wbsSubCol: 'Related_Sub_WBS_ID'
  },
  'Risks': {
    tab: DB_CONFIG.TABS.RISKS,
    module: 'Risks',
    idCol: 'Risk_ID',
    prefix: 'RSK',
    pad: 4,
    wbsMainCol: 'Related_Main_WBS_ID',
    wbsSubCol: 'Related_Sub_WBS_ID'
  },
  'Issues': {
    tab: DB_CONFIG.TABS.ISSUES,
    module: 'Issues',
    idCol: 'Issue_ID',
    prefix: 'ISS',
    pad: 4,
    wbsMainCol: 'Related_Main_WBS_ID',
    wbsSubCol: 'Related_Sub_WBS_ID'
  },
  'Repository': {
    tab: DB_CONFIG.TABS.REPOSITORY,
    module: 'Repository',
    idCol: 'Repository_ID',
    prefix: 'REP',
    pad: 4,
    wbsMainCol: 'Related_Main_WBS_ID',
    wbsSubCol: ''
  },
  'Approvals': {
    tab: DB_CONFIG.TABS.APPROVALS,
    module: 'Approvals',
    idCol: 'Approval_ID',
    prefix: 'APR',
    pad: 4,
    wbsMainCol: 'Related_Main_WBS_ID',
    wbsSubCol: 'Related_Sub_WBS_ID'
  }
};

/**
 * Fetches all records for a given Project Controls registry tab, scoped to projectId,
 * along with WBS lookup lists and the user's module permissions.
 */
function apiGetProjectControlRegistry(projectId, registryKey) {
  const cfg = CONTROLS_REGISTRY_CONFIG[registryKey];
  if (!cfg) throw new Error('Unknown registry module: ' + registryKey);
  if (!projectId) throw new Error('Project_ID is required.');

  const ctx = assertPermission_(cfg.module, 'view', projectId);
  const pid = String(projectId).trim();

  const records = getTableRecords_(cfg.tab)
    .filter(r => String(r.Project_ID || '').trim() === pid);

  const mainWbs = getTableRecords_(DB_CONFIG.TABS.MAIN_WBS)
    .filter(m => String(m.Project_ID || '').trim() === pid && String(m.Is_Archived || '').toUpperCase() !== 'TRUE')
    .map(m => ({ id: m.Main_WBS_ID, name: m.Module_Name }));

  const subWbs = getTableRecords_(DB_CONFIG.TABS.SUB_WBS)
    .filter(s => String(s.Project_ID || '').trim() === pid && String(s.Is_Archived || '').toUpperCase() !== 'TRUE')
    .map(s => ({ id: s.Sub_WBS_ID, parentId: s.Parent_Main_WBS_ID, name: s.Task_Name }));

  const modPerms = ctx.permissions[cfg.module] || {};

  return {
    success: true,
    registryKey: registryKey,
    idCol: cfg.idCol,
    records: records,
    mainWbs: mainWbs,
    subWbs: subWbs,
    permissions: {
      create: Boolean(modPerms.create),
      edit: Boolean(modPerms.edit),
      delete: Boolean(modPerms.delete),
      approve: Boolean(modPerms.approve)
    }
  };
}

/**
 * Computes numeric & qualitative Risk Rating from Probability (1-5) and Impact (1-5).
 */
function computeRiskRatingLabel_(probVal, impactVal) {
  const mapScore = (v) => {
    const n = parseInt(v, 10);
    if (!isNaN(n) && n >= 1 && n <= 5) return n;
    const s = String(v || '').trim().toLowerCase();
    if (s.startsWith('1') || s === 'very low' || s === 'rare') return 1;
    if (s.startsWith('2') || s === 'low' || s === 'unlikely') return 2;
    if (s.startsWith('3') || s === 'medium' || s === 'moderate' || s === 'possible') return 3;
    if (s.startsWith('4') || s === 'high' || s === 'likely') return 4;
    if (s.startsWith('5') || s === 'very high' || s === 'critical' || s === 'almost certain') return 5;
    return 3;
  };

  const p = mapScore(probVal);
  const i = mapScore(impactVal);
  const score = p * i;

  let band = 'Low';
  if (score >= 15) band = 'Critical';
  else if (score >= 10) band = 'High';
  else if (score >= 5) band = 'Medium';

  return { score: score, label: score + ' - ' + band };
}

/**
 * Creates or updates a record in any Phase 7 Project Controls registry tab.
 */
function apiSaveProjectControlRecord(projectId, registryKey, payload) {
  const cfg = CONTROLS_REGISTRY_CONFIG[registryKey];
  if (!cfg) throw new Error('Unknown registry module: ' + registryKey);
  if (!projectId) throw new Error('Project_ID is required.');

  const pid = String(projectId).trim();
  const rawId = String(payload[cfg.idCol] || '').trim();
  const existing = rawId ? findRecordRowById_(cfg.tab, cfg.idCol, rawId) : null;
  const isUpdate = Boolean(existing);
  if (isUpdate) assertRecordProjectOwnership_(existing, pid, registryKey + ' record');

  const ctx = assertPermission_(cfg.module, isUpdate ? 'edit' : 'create', pid);

  const cleanRecord = Object.assign({}, payload);
  delete cleanRecord._rowIndex;
  cleanRecord[cfg.idCol] = isUpdate ? rawId : '';
  cleanRecord.Project_ID = pid;

  // Automatic Risk Matrix score calculation
  if (registryKey === 'Risks') {
    const ratingInfo = computeRiskRatingLabel_(cleanRecord.Probability, cleanRecord.Impact_Level);
    cleanRecord.Risk_Rating = ratingInfo.label;
  }

  // Basic Repository URL validation
  if (registryKey === 'Repository' && cleanRecord.Repository_URL) {
    const url = String(cleanRecord.Repository_URL).trim();
    if (!/^https?:\/\//i.test(url)) {
      cleanRecord.Repository_URL = 'https://' + url;
    }
  }

  if (isUpdate) {
    const recordId = rawId;
    const res = updateRecordById_(cfg.tab, cfg.idCol, recordId, cleanRecord);
    writeAuditLog_(ctx, 'UPDATE_' + cfg.module.toUpperCase(), cfg.module, recordId, res.previous, res.updated, 'Updated ' + registryKey + ' record');
    return { success: true, record: res.updated };
  } else {
    insertRecordWithGeneratedId_(cfg.tab, cfg.idCol, cfg.prefix, cfg.pad, cleanRecord);
    const recordId = cleanRecord[cfg.idCol];
    writeAuditLog_(ctx, 'CREATE_' + cfg.module.toUpperCase(), cfg.module, recordId, null, cleanRecord, 'Created ' + registryKey + ' record');
    return { success: true, record: cleanRecord };
  }
}

/**
 * Deletes a record from a Phase 7 Project Controls registry (requires Can_Delete permission)
 * and records the deleted snapshot in Audit_Logs.
 */
function apiDeleteProjectControlRecord(projectId, registryKey, recordId) {
  const cfg = CONTROLS_REGISTRY_CONFIG[registryKey];
  if (!cfg) throw new Error('Unknown registry module: ' + registryKey);
  if (!projectId || !recordId) throw new Error('Project_ID and Record ID are required.');

  const pid = String(projectId).trim();
  const ctx = assertPermission_(cfg.module, 'delete', pid);

  const existing = findRecordRowById_(cfg.tab, cfg.idCol, recordId);
  if (!existing) throw new Error('Record not found: ' + recordId);
  if (String(existing.Project_ID || '').trim() !== pid) {
    throw new Error('Record does not belong to the active project.');
  }

  deleteRecordsByIds_(cfg.tab, cfg.idCol, [recordId]);

  writeAuditLog_(ctx, 'DELETE_' + cfg.module.toUpperCase(), cfg.module, recordId, existing, null, 'Deleted ' + registryKey + ' record');
  return { success: true };
}

// ============================================================================
// PHASE 8: DAILY PROGRESS LOGS & WEEKLY PROJECT REPORTS
// ============================================================================

/**
 * Fetches Daily Progress Logs (Progress_Updates), Weekly Reports (Weekly_Reports),
 * and WBS/Activity reference options for a given project.
 */
function apiGetProgressAndWeeklyReports(projectId) {
  if (!projectId) throw new Error('Project_ID is required.');
  const pid = String(projectId).trim();

  const progCtx = assertPermission_('Progress', 'view', pid);
  const canViewWeekly = Boolean(progCtx.permissions['Weekly_Reports'] && progCtx.permissions['Weekly_Reports'].view);

  const isTeamMember = normalizeRoleName_(progCtx.role) === 'Project Team Member';
  const logs = getTableRecords_(DB_CONFIG.TABS.PROGRESS_UPDATES)
    .filter(r => {
      if (String(r.Project_ID || '').trim() !== pid) return false;
      if (!isTeamMember) return true;
      const owner = String(r.Submitted_By_Email || '').trim().toLowerCase();
      const legacyMatch = String(r.Submitted_By || '').toLowerCase().indexOf(String(progCtx.email || '').toLowerCase()) !== -1;
      return owner ? owner === String(progCtx.email || '').trim().toLowerCase() : legacyMatch;
    })
    .map(r => {
      const copy = Object.assign({}, r);
      delete copy._rowIndex;
      return copy;
    })
    .sort((a, b) => String(b.Log_Date || '').localeCompare(String(a.Log_Date || '')) || String(b.Log_ID || '').localeCompare(String(a.Log_ID || '')));

  let weeklyReports = [];
  if (canViewWeekly) {
    weeklyReports = getTableRecords_(DB_CONFIG.TABS.WEEKLY_REPORTS)
      .filter(r => String(r.Project_ID || '').trim() === pid)
      .map(r => {
        const copy = Object.assign({}, r);
        delete copy._rowIndex;
        return copy;
      })
      .sort((a, b) => String(b.Reporting_Week || '').localeCompare(String(a.Reporting_Week || '')) || String(b.Report_ID || '').localeCompare(String(a.Report_ID || '')));
  }

  const mainWbs = getTableRecords_(DB_CONFIG.TABS.MAIN_WBS)
    .filter(m => String(m.Project_ID || '').trim() === pid && String(m.Is_Archived || '').toUpperCase() !== 'TRUE')
    .map(m => ({ id: m.Main_WBS_ID, name: m.Module_Name }));

  const subWbs = getTableRecords_(DB_CONFIG.TABS.SUB_WBS)
    .filter(s => String(s.Project_ID || '').trim() === pid && String(s.Is_Archived || '').toUpperCase() !== 'TRUE')
    .map(s => ({ id: s.Sub_WBS_ID, parentId: s.Parent_Main_WBS_ID, name: s.Task_Name }));

  const activities = getTableRecords_(DB_CONFIG.TABS.ACTIVITIES)
    .filter(a => String(a.Project_ID || '').trim() === pid && String(a.Is_Archived || '').toUpperCase() !== 'TRUE')
    .filter(a => ['Not Started', 'In Progress'].indexOf(String(a.Status || '').trim()) !== -1 && Number(a.Actual_Progress || 0) < 100)
    .map(a => ({
      id: a.Activity_ID,
      name: a.Activity_Name,
      mainWbsId: a.Main_WBS_ID,
      subWbsId: a.Sub_WBS_ID,
      targetQty: Number(a.Target_Quantity) || 0,
      actualQty: Number(a.Actual_Quantity) || 0,
      uom: a.Unit_Of_Measure || '',
      actualPct: Number(a.Actual_Progress) || 0,
      status: a.Status || 'Not Started'
    }));

  const proj = findRecordRowById_(DB_CONFIG.TABS.PROJECTS, 'Project_ID', pid);

  const progPerms = progCtx.permissions['Progress'] || {};
  const wkPerms = progCtx.permissions['Weekly_Reports'] || {};

  return {
    success: true,
    project: proj ? {
      Project_ID: proj.Project_ID,
      Project_Name: proj.Project_Name,
      Client: proj.Client,
      Project_Manager: proj.Project_Manager,
      Overall_Planned_Progress: Number(proj.Overall_Planned_Progress) || 0,
      Overall_Actual_Progress: Number(proj.Overall_Actual_Progress) || 0,
      Project_Status: proj.Project_Status,
      Project_Health: proj.Project_Health
    } : null,
    logs: logs,
    weeklyReports: weeklyReports,
    mainWbs: mainWbs,
    subWbs: subWbs,
    activities: activities,
    wbsHierarchyDepth: 2,
    permissions: {
      progressCreate: Boolean(progPerms.create),
      progressEdit: Boolean(progPerms.edit),
      progressApprove: Boolean(progPerms.approve),
      progressExport: Boolean(progPerms.export),
      weeklyView: canViewWeekly,
      weeklyCreate: Boolean(wkPerms.create),
      weeklyEdit: Boolean(wkPerms.edit),
      weeklyDelete: Boolean(wkPerms.delete),
      weeklyExport: Boolean(wkPerms.export)
    }
  };
}

/**
 * Creates or updates a Daily Progress Log entry in Progress_Updates.
 * If applyToActivityAndRollup is true (or status is Approved), updates the linked Activity
 * and recalculates project weighted progress.
 */
function apiSaveProgressLog(projectId, payload, applyToSchedule) {
  if (!projectId) throw new Error('Project_ID is required.');
  const pid = String(projectId).trim();
  const progressSaveLock = LockService.getScriptLock();
  progressSaveLock.waitLock(10000);
  try {

  const rawId = String(payload.Log_ID || '').trim();
  const existing = rawId ? findRecordRowById_(DB_CONFIG.TABS.PROGRESS_UPDATES, 'Log_ID', rawId) : null;
  const isUpdate = Boolean(existing);
  if (isUpdate) assertRecordProjectOwnership_(existing, pid, 'Progress log');

  const ctx = assertPermission_('Progress', isUpdate ? 'edit' : 'create', pid);
  const isTeamMember = normalizeRoleName_(ctx.role) === 'Project Team Member';
  if (isTeamMember && isUpdate) {
    const submittedByMatch = String(existing.Submitted_By || '').match(/\(([^)]+@[^)]+)\)/);
    const ownerEmail = String(existing.Submitted_By_Email || '').trim().toLowerCase() || (submittedByMatch ? submittedByMatch[1].toLowerCase() : '');
    if (!ownerEmail || ownerEmail.toLowerCase() !== String(ctx.email).toLowerCase()) throw new Error('You may edit only your own Daily Progress Logs.');
    if (['Approved', 'Rejected'].indexOf(String(existing.Approval_Status || 'Submitted')) !== -1) throw new Error('Reviewed Daily Progress Logs cannot be edited by Project Team Members.');
  }

  const logDate = String(payload.Log_Date || '').trim() || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const qtyDone = payload.Quantity_Accomplished !== '' && payload.Quantity_Accomplished !== undefined
    ? Number(payload.Quantity_Accomplished) || 0
    : 0;
  const pctVal = payload.Reported_Progress_Pct !== '' && payload.Reported_Progress_Pct !== undefined
    ? Math.min(100, Math.max(0, Number(payload.Reported_Progress_Pct) || 0))
    : 0;

  let progressActivity = null;
  if (payload.Main_WBS_ID) assertRecordProjectOwnership_(findRecordRowById_(DB_CONFIG.TABS.MAIN_WBS, 'Main_WBS_ID', payload.Main_WBS_ID), pid, 'Progress Main WBS');
  let progressSub = null;
  if (payload.Sub_WBS_ID) {
    if (!payload.Main_WBS_ID) throw new Error('Select a Main WBS before selecting a Sub WBS.');
    progressSub = findRecordRowById_(DB_CONFIG.TABS.SUB_WBS, 'Sub_WBS_ID', payload.Sub_WBS_ID);
    assertRecordProjectOwnership_(progressSub, pid, 'Progress Sub WBS');
    if (payload.Main_WBS_ID && String(progressSub.Parent_Main_WBS_ID || '') !== String(payload.Main_WBS_ID)) throw new Error('Selected Sub WBS does not belong to the selected Main WBS.');
  }
  if (payload.Activity_ID) {
    progressActivity = findRecordRowById_(DB_CONFIG.TABS.ACTIVITIES, 'Activity_ID', payload.Activity_ID);
    assertRecordProjectOwnership_(progressActivity, pid, 'Progress activity');
    // Validate against the activity's actual parent. In a two-tier WBS,
    // activities may be linked directly to Main WBS or nested under Sub WBS.
    const activitySubWbsId = String(progressActivity.Sub_WBS_ID || '').trim();
    const selectedSubWbsId = String(payload.Sub_WBS_ID || '').trim();
    const activityMainWbsId = String(progressActivity.Main_WBS_ID || '').trim();
    const selectedMainWbsId = String(payload.Main_WBS_ID || '').trim();

    if (activitySubWbsId) {
      if (!selectedSubWbsId || activitySubWbsId !== selectedSubWbsId) {
        throw new Error('Selected activity does not belong to the selected Sub WBS.');
      }
      if (!progressSub) throw new Error('Select the Sub WBS linked to the selected activity.');
      if (String(progressSub.Sub_WBS_ID || '').trim() !== activitySubWbsId) {
        throw new Error('Selected activity does not belong to the selected Sub WBS.');
      }
    } else {
      if (selectedSubWbsId) {
        throw new Error('This is a direct Main WBS activity. Clear the Sub WBS selection and try again.');
      }
      if (!selectedMainWbsId || activityMainWbsId !== selectedMainWbsId) {
        throw new Error('Selected activity does not belong to the selected Main WBS.');
      }
    }
    if (selectedMainWbsId && activityMainWbsId && activityMainWbsId !== selectedMainWbsId) {
      throw new Error('Selected activity does not belong to the selected Main WBS.');
    }
    if (['Completed', 'Closed'].indexOf(String(progressActivity.Status || '').trim()) !== -1 || Number(progressActivity.Actual_Progress || 0) >= 100) throw new Error('Completed activities cannot be selected for a new Daily Progress Log.');
    if (!['Not Started', 'In Progress'].includes(String(progressActivity.Status || '').trim())) throw new Error('Only Not Started or In Progress activities can be selected.');
  }
  const statusVal = isTeamMember ? (existing ? String(existing.Approval_Status || 'Submitted') : 'Submitted') : String(payload.Approval_Status || (existing ? existing.Approval_Status : 'Submitted')).trim();
  if (statusVal === 'Approved' || statusVal === 'Rejected') {
    assertPermission_('Progress', 'approve', pid);
  }

  let logId = isUpdate ? rawId : '';

  const record = {
    Log_ID: logId,
    Project_ID: pid,
    Main_WBS_ID: String(payload.Main_WBS_ID || '').trim(),
    Sub_WBS_ID: String(payload.Sub_WBS_ID || '').trim(),
    Activity_ID: String(payload.Activity_ID || '').trim(),
    Log_Date: logDate,
    Quantity_Accomplished: qtyDone,
    Reported_Progress_Pct: pctVal,
    Submitted_By: isTeamMember ? (ctx.user.fullName + ' (' + ctx.user.email + ')') : String(payload.Submitted_By || (existing ? existing.Submitted_By : (ctx.user.fullName + ' (' + ctx.user.email + ')'))).trim(),
    Submitted_By_Email: isTeamMember ? ctx.email : String((existing && existing.Submitted_By_Email) || payload.Submitted_By_Email || '').trim().toLowerCase(),
    Approval_Status: statusVal,
    Approved_By: statusVal === 'Approved' ? (ctx.user.fullName + ' (' + ctx.user.email + ')') : String(payload.Approved_By || '').trim(),
    Notes: String(payload.Notes || '').trim()
  };

  let prevClean = null;
  if (existing) {
    prevClean = Object.assign({}, existing);
    delete prevClean._rowIndex;
  }

  if (isUpdate) {
    updateRecordById_(DB_CONFIG.TABS.PROGRESS_UPDATES, 'Log_ID', logId, record);
    writeAuditLog_(ctx, 'UPDATE_PROGRESS_LOG', 'Progress', logId, prevClean, record, 'Updated daily progress log');
  } else {
    insertRecordWithGeneratedId_(DB_CONFIG.TABS.PROGRESS_UPDATES, 'Log_ID', 'LOG', 4, record);
    logId = record.Log_ID;
    writeAuditLog_(ctx, 'CREATE_PROGRESS_LOG', 'Progress', logId, null, record, 'Submitted daily progress log');
  }

  let rollupSummary = null;
  // Team Members may submit/edit their own logs, but must never apply them
  // directly to the live schedule before an authorized reviewer approves.
  const mayApplyToSchedule = isPrivilegedProjectRole_(ctx.role) && (applyToSchedule || statusVal === 'Approved');
  if (mayApplyToSchedule && record.Activity_ID) {
    const act = findRecordRowById_(DB_CONFIG.TABS.ACTIVITIES, 'Activity_ID', record.Activity_ID);
    if (act && String(act.Project_ID || '').trim() === pid) {
      const actPatch = {
        Actual_Progress: pctVal,
        Actual_Quantity: qtyDone > 0 ? qtyDone : (Number(act.Actual_Quantity) || 0),
        Status: pctVal >= 100 ? 'Completed' : (pctVal > 0 ? 'In Progress' : act.Status)
      };
      if (!act.Actual_Start_Date && pctVal > 0) {
        actPatch.Actual_Start_Date = logDate;
      }
      if (pctVal >= 100 && !act.Actual_Finish_Date) {
        actPatch.Actual_Finish_Date = logDate;
      }
      updateRecordById_(DB_CONFIG.TABS.ACTIVITIES, 'Activity_ID', record.Activity_ID, actPatch);
      rollupSummary = recalculateProjectProgressEngine_(pid);
    }
  }

  return { success: true, log: record, rollupSummary: rollupSummary };
  } finally {
    progressSaveLock.releaseLock();
  }
}

/**
 * Approves or rejects a Daily Progress Log (requires Progress approve permission).
 * Optionally applies approved progress to the linked Activity and recalculates project roll-up.
 */
function apiReviewProgressLog(projectId, logId, decision, applyToSchedule) {
  if (!projectId || !logId) throw new Error('Project_ID and Log_ID are required.');
  const pid = String(projectId).trim();
  const progressReviewLock = LockService.getScriptLock();
  progressReviewLock.waitLock(10000);
  try {
  const ctx = assertPermission_('Progress', 'approve', pid);

  const normalized = String(decision || '').trim();
  if (!['Approved', 'Rejected'].includes(normalized)) {
    throw new Error('Decision must be Approved or Rejected.');
  }

  const existing = findRecordRowById_(DB_CONFIG.TABS.PROGRESS_UPDATES, 'Log_ID', logId);
  if (!existing) throw new Error('Progress log not found: ' + logId);
  if (String(existing.Project_ID || '').trim() !== pid) {
    throw new Error('Progress log does not belong to the active project.');
  }

  const prevClean = Object.assign({}, existing);
  delete prevClean._rowIndex;

  const patch = {
    Approval_Status: normalized,
    Approved_By: ctx.user.fullName + ' (' + ctx.user.email + ')'
  };

  const res = updateRecordById_(DB_CONFIG.TABS.PROGRESS_UPDATES, 'Log_ID', logId, patch);
  const updatedClean = Object.assign({}, res.updated);
  delete updatedClean._rowIndex;

  writeAuditLog_(ctx, 'REVIEW_PROGRESS_LOG', 'Progress', logId, prevClean, updatedClean, 'Progress log ' + normalized);

  let rollupSummary = null;
  if (normalized === 'Approved' && applyToSchedule && existing.Activity_ID) {
    const act = findRecordRowById_(DB_CONFIG.TABS.ACTIVITIES, 'Activity_ID', existing.Activity_ID);
    if (act && String(act.Project_ID || '').trim() === pid) {
      const pctVal = Math.min(100, Math.max(0, Number(existing.Reported_Progress_Pct) || 0));
      const qtyDone = Number(existing.Quantity_Accomplished) || 0;
      const actPatch = {
        Actual_Progress: pctVal,
        Actual_Quantity: qtyDone > 0 ? qtyDone : (Number(act.Actual_Quantity) || 0),
        Status: pctVal >= 100 ? 'Completed' : (pctVal > 0 ? 'In Progress' : act.Status)
      };
      if (!act.Actual_Start_Date && pctVal > 0) {
        actPatch.Actual_Start_Date = existing.Log_Date || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
      }
      if (pctVal >= 100 && !act.Actual_Finish_Date) {
        actPatch.Actual_Finish_Date = existing.Log_Date || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
      }
      updateRecordById_(DB_CONFIG.TABS.ACTIVITIES, 'Activity_ID', existing.Activity_ID, actPatch);
      rollupSummary = recalculateProjectProgressEngine_(pid);
    }
  }

  return { success: true, log: updatedClean, rollupSummary: rollupSummary };
  } finally {
    progressReviewLock.releaseLock();
  }
}

/**
 * Creates or updates a Weekly Project Report in Weekly_Reports.
 */
function apiSaveWeeklyReport(projectId, payload) {
  if (!projectId) throw new Error('Project_ID is required.');
  const pid = String(projectId).trim();

  const rawId = String(payload.Report_ID || '').trim();
  const existing = rawId ? findRecordRowById_(DB_CONFIG.TABS.WEEKLY_REPORTS, 'Report_ID', rawId) : null;
  const isUpdate = Boolean(existing);
  if (isUpdate) assertRecordProjectOwnership_(existing, pid, 'Weekly report');

  const ctx = assertPermission_('Weekly_Reports', isUpdate ? 'edit' : 'create', pid);

  if (payload.Main_WBS_ID) assertRecordProjectOwnership_(findRecordRowById_(DB_CONFIG.TABS.MAIN_WBS, 'Main_WBS_ID', payload.Main_WBS_ID), pid, 'Weekly report Main WBS');
  const reportingWeek = String(payload.Reporting_Week || '').trim();
  const reportingPeriod = String(payload.Reporting_Period || '').trim();
  if (!reportingWeek && !reportingPeriod) {
    throw new Error('Reporting Week or Reporting Period is required.');
  }

  const proj = findRecordRowById_(DB_CONFIG.TABS.PROJECTS, 'Project_ID', pid);
  const defaultPlanned = proj ? (Number(proj.Overall_Planned_Progress) || 0) : 0;
  const defaultActual = proj ? (Number(proj.Overall_Actual_Progress) || 0) : 0;

  const plannedPct = payload.Overall_Planned_Progress !== '' && payload.Overall_Planned_Progress !== undefined
    ? Number(payload.Overall_Planned_Progress) || 0
    : defaultPlanned;
  const actualPct = payload.Overall_Actual_Progress !== '' && payload.Overall_Actual_Progress !== undefined
    ? Number(payload.Overall_Actual_Progress) || 0
    : defaultActual;

  let reportId = isUpdate ? rawId : '';

  const record = {
    Report_ID: reportId,
    Project_ID: pid,
    Reporting_Week: reportingWeek,
    Reporting_Period: reportingPeriod,
    Main_WBS_ID: String(payload.Main_WBS_ID || '').trim(),
    Ongoing_Activities: String(payload.Ongoing_Activities || '').trim(),
    Accomplishments: String(payload.Accomplishments || '').trim(),
    Pending_Activities: String(payload.Pending_Activities || '').trim(),
    Issues_Encountered: String(payload.Issues_Encountered || '').trim(),
    Mitigation_Measures: String(payload.Mitigation_Measures || '').trim(),
    Next_Steps: String(payload.Next_Steps || '').trim(),
    Responsible_Team_Lead: String(payload.Responsible_Team_Lead || (proj ? proj.Project_Manager : ctx.user.fullName)).trim(),
    Overall_Planned_Progress: plannedPct,
    Overall_Actual_Progress: actualPct,
    Management_Support_Needed: String(payload.Management_Support_Needed || '').trim(),
    Project_Status: String((proj && proj.Project_Status) || payload.Project_Status || '').trim(),
    Key_Accomplishments: String(payload.Key_Accomplishments || payload.Accomplishments || '').trim(),
    Activities_Completed: String(payload.Activities_Completed || payload.Ongoing_Activities || '').trim(),
    Planned_Activities: String(payload.Planned_Activities || payload.Next_Steps || payload.Pending_Activities || '').trim(),
    Major_Concerns: String(payload.Major_Concerns || payload.Issues_Encountered || '').trim(),
    Risks_and_Issues: String(payload.Risks_and_Issues || payload.Issues_Encountered || '').trim(),
    Management_Attention_Required: String(payload.Management_Attention_Required || payload.Management_Support_Needed || '').trim(),
    Submitted_By: ctx.user.fullName + ' (' + ctx.user.email + ')',
    Submission_Date: getNowTimestamp_(),
    Remarks: String(payload.Remarks || '').trim()
  };

  let prevClean = null;
  if (existing) {
    prevClean = Object.assign({}, existing);
    delete prevClean._rowIndex;
  }

  if (isUpdate) {
    updateRecordById_(DB_CONFIG.TABS.WEEKLY_REPORTS, 'Report_ID', reportId, record);
    writeAuditLog_(ctx, 'UPDATE_WEEKLY_REPORT', 'Weekly_Reports', reportId, prevClean, record, 'Updated weekly project report');
  } else {
    insertRecordWithGeneratedId_(DB_CONFIG.TABS.WEEKLY_REPORTS, 'Report_ID', 'WKR', 4, record);
    reportId = record.Report_ID;
    writeAuditLog_(ctx, 'CREATE_WEEKLY_REPORT', 'Weekly_Reports', reportId, null, record, 'Created weekly project report');
  }

  return { success: true, report: record };
}

/**
 * Deletes a Weekly Project Report (requires Weekly_Reports delete permission) and logs to Audit_Logs.
 */
function apiDeleteWeeklyReport(projectId, reportId) {
  if (!projectId || !reportId) throw new Error('Project_ID and Report_ID are required.');
  const pid = String(projectId).trim();
  const ctx = assertPermission_('Weekly_Reports', 'delete', pid);

  const existing = findRecordRowById_(DB_CONFIG.TABS.WEEKLY_REPORTS, 'Report_ID', reportId);
  if (!existing) throw new Error('Weekly report not found: ' + reportId);
  if (String(existing.Project_ID || '').trim() !== pid) {
    throw new Error('Weekly report does not belong to the active project.');
  }

  const prevClean = Object.assign({}, existing);
  delete prevClean._rowIndex;

  deleteRecordsByIds_(DB_CONFIG.TABS.WEEKLY_REPORTS, 'Report_ID', [reportId]);

  writeAuditLog_(ctx, 'DELETE_WEEKLY_REPORT', 'Weekly_Reports', reportId, prevClean, null, 'Deleted weekly project report');
  return { success: true };
}

// ============================================================================
// PHASE 9: TEAM WORKLOAD & MULTI-PROJECT RESOURCE UTILIZATION
// ============================================================================

/**
 * Fetches project-scoped Team_Workload assignments plus deduplicated,
 * cross-project resource utilization across all projects accessible to the user.
 */
function apiGetProjectReferenceNames(projectId) {
  const pid = String(projectId || '').trim();
  const ctx = getCurrentUserContext_();
  if (!ctx || !ctx.authenticated) throw new Error('Authentication required.');
  assertProjectAssignment_(ctx, pid);
  const main = getTableRecords_(DB_CONFIG.TABS.MAIN_WBS).filter(r => String(r.Project_ID) === pid && !isTruthySheetFlag_(r.Is_Archived));
  const sub = getTableRecords_(DB_CONFIG.TABS.SUB_WBS).filter(r => String(r.Project_ID) === pid && !isTruthySheetFlag_(r.Is_Archived));
  const acts = getTableRecords_(DB_CONFIG.TABS.ACTIVITIES).filter(r => String(r.Project_ID) === pid && !isTruthySheetFlag_(r.Is_Archived));
  const employees = getTableRecords_(DB_CONFIG.TABS.TEAM_WORKLOAD).filter(r => String(r.Assigned_Project_ID) === pid);
  const projects = getTableRecords_(DB_CONFIG.TABS.PROJECTS).filter(r => String(r.Project_ID) === pid);
  return {
    project: Object.fromEntries(projects.map(r => [String(r.Project_ID), String(r.Project_Name || r.Project_ID)])),
    mainWbs: Object.fromEntries(main.map(r => [String(r.Main_WBS_ID), String(r.Module_Name || r.Main_WBS_ID)])),
    subWbs: Object.fromEntries(sub.map(r => [String(r.Sub_WBS_ID), String(r.Task_Name || r.Sub_WBS_ID)])),
    activities: Object.fromEntries(acts.map(r => [String(r.Activity_ID), String(r.Activity_Name || r.Activity_ID)])),
    employees: Object.fromEntries(employees.filter(r => r.Employee_ID && r.Employee_Name).map(r => [String(r.Employee_ID), String(r.Employee_Name)]))
  };
}

function apiGetProjectEmployeeDirectory(projectId) {
  const pid = String(projectId || '').trim();
  if (!pid) throw new Error('Project_ID is required.');
  assertPermission_('Team_Workload', 'view', pid);
  const rows = getTableRecords_(DB_CONFIG.TABS.TEAM_WORKLOAD)
    .filter(r => String(r.Assigned_Project_ID || '').trim() === pid)
    .filter(r => !['Cancelled', 'Released', 'Inactive'].includes(String(r.Assignment_Status || 'Active').trim()));
  const byName = {};
  rows.forEach(r => {
    const name = String(r.Employee_Name || '').trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (!byName[key]) byName[key] = { name: name, employeeId: String(r.Employee_ID || '').trim(), position: String(r.Position || '').trim() };
  });
  return { success: true, employees: Object.keys(byName).sort().map(k => byName[k]) };
}


function apiGetTeamWorkloadData(projectId) {
  if (!projectId) throw new Error('Project_ID is required.');
  const pid = String(projectId).trim();

  const ctx = assertPermission_('Team_Workload', 'view', pid);
  const perms = ctx.permissions['Team_Workload'] || {};

  const allProjects = getTableRecords_(DB_CONFIG.TABS.PROJECTS);
  const projectMap = {};
  const visibleProjectIds = new Set();

  allProjects.forEach(p => {
    const pKey = String(p.Project_ID || '').trim();
    if (!pKey) return;
    projectMap[pKey] = p.Project_Name || pKey;
    if (ctx.isGlobalViewer || ctx.assignedProjectIds.includes(pKey)) {
      visibleProjectIds.add(pKey);
    }
  });

  const allWorkload = getTableRecords_(DB_CONFIG.TABS.TEAM_WORKLOAD).map(r => {
    const copy = Object.assign({}, r);
    delete copy._rowIndex;
    return copy;
  });

  // 1. Assignments scoped to the active project
  const projectAssignments = allWorkload.filter(
    w => String(w.Assigned_Project_ID || '').trim() === pid
  );

  // 2. Deduplicated cross-project utilization across accessible projects
  const empMap = {};
  allWorkload
    .filter(w => visibleProjectIds.has(String(w.Assigned_Project_ID || '').trim()))
    .forEach(w => {
      const empId = String(w.Employee_ID || '').trim();
      const empName = String(w.Employee_Name || '').trim();
      const empKey = (empId || empName).toLowerCase();
      if (!empKey) return;

      const status = String(w.Assignment_Status || 'Active').trim();
      const isActiveAlloc = !['Completed', 'Cancelled', 'Released', 'Inactive'].includes(status);
      const allocPct = parseFloat(w.Workload_Allocation_Pct) || 0;
      const wProjId = String(w.Assigned_Project_ID || '').trim();

      if (!empMap[empKey]) {
        empMap[empKey] = {
          empKey: empKey,
          employeeId: empId || '-',
          employeeName: empName || empId,
          position: String(w.Position || '').trim(),
          department: String(w.Department_Or_Team || '').trim(),
          totalActiveAllocationPct: 0,
          totalAllAllocationPct: 0,
          activeAssignmentsCount: 0,
          projectIdsSet: {},
          assignments: []
        };
      }

      const entry = empMap[empKey];
      if (!entry.position && w.Position) entry.position = String(w.Position).trim();
      if (!entry.department && w.Department_Or_Team) entry.department = String(w.Department_Or_Team).trim();

      entry.totalAllAllocationPct = Number((entry.totalAllAllocationPct + allocPct).toFixed(1));
      if (isActiveAlloc) {
        entry.totalActiveAllocationPct = Number((entry.totalActiveAllocationPct + allocPct).toFixed(1));
        entry.activeAssignmentsCount++;
        if (wProjId) entry.projectIdsSet[wProjId] = projectMap[wProjId] || wProjId;
      }

      entry.assignments.push({
        Assignment_ID: w.Assignment_ID,
        Project_ID: wProjId,
        Project_Name: projectMap[wProjId] || wProjId,
        Main_WBS_ID: w.Main_WBS_ID || '',
        Sub_WBS_ID: w.Sub_WBS_ID || '',
        Main_Scope: w.Main_Scope_Of_Responsibility || '',
        Allocation_Pct: allocPct,
        Status: status,
        Start_Date: w.Assignment_Start_Date || '',
        End_Date: w.Assignment_End_Date || ''
      });
    });

  const resourceRollup = Object.keys(empMap)
    .map(k => {
      const e = empMap[k];
      const activeProjectsList = Object.keys(e.projectIdsSet).map(id => id + ' (' + e.projectIdsSet[id] + ')');
      return {
        employeeId: e.employeeId,
        employeeName: e.employeeName,
        position: e.position,
        department: e.department,
        activeProjectsCount: activeProjectsList.length,
        activeProjectsSummary: activeProjectsList.join(', '),
        activeAssignmentsCount: e.activeAssignmentsCount,
        totalActiveAllocationPct: e.totalActiveAllocationPct,
        isOverallocated: e.totalActiveAllocationPct > 100,
        assignments: e.assignments
      };
    })
    .sort((a, b) => b.totalActiveAllocationPct - a.totalActiveAllocationPct || a.employeeName.localeCompare(b.employeeName));

  const mainWbs = getTableRecords_(DB_CONFIG.TABS.MAIN_WBS)
    .filter(m => String(m.Project_ID || '').trim() === pid && String(m.Is_Archived || '').toUpperCase() !== 'TRUE')
    .map(m => ({ id: m.Main_WBS_ID, name: m.Module_Name }));

  const subWbs = getTableRecords_(DB_CONFIG.TABS.SUB_WBS)
    .filter(s => String(s.Project_ID || '').trim() === pid && String(s.Is_Archived || '').toUpperCase() !== 'TRUE')
    .map(s => ({ id: s.Sub_WBS_ID, parentId: s.Parent_Main_WBS_ID, name: s.Task_Name }));

  return {
    success: true,
    projectId: pid,
    assignments: projectAssignments,
    resourceRollup: resourceRollup,
    mainWbs: mainWbs,
    subWbs: subWbs,
    permissions: {
      create: Boolean(perms.create),
      edit: Boolean(perms.edit),
      delete: Boolean(perms.delete),
      export: Boolean(perms.export)
    }
  };
}

/**
 * Creates or updates a Team_Workload assignment row and writes an Audit_Logs entry.
 */
function apiSaveTeamWorkloadAssignment(projectId, payload) {
  if (!projectId) throw new Error('Project_ID is required.');
  const pid = String(projectId).trim();

  const rawId = String(payload.Assignment_ID || '').trim();
  const existing = rawId ? findRecordRowById_(DB_CONFIG.TABS.TEAM_WORKLOAD, 'Assignment_ID', rawId) : null;
  const isUpdate = Boolean(existing);
  if (isUpdate) assertRecordProjectOwnership_(existing, pid, 'Workload assignment');

  const ctx = assertPermission_('Team_Workload', isUpdate ? 'edit' : 'create', pid);

  const empName = String(payload.Employee_Name || '').trim();
  if (!empName) {
    throw new Error('Employee Name is required for a workload assignment.');
  }

  const allocPct = payload.Workload_Allocation_Pct !== '' && payload.Workload_Allocation_Pct !== undefined
    ? Math.max(0, Number(payload.Workload_Allocation_Pct) || 0)
    : 0;

  let assignmentId = isUpdate ? rawId : '';

  const record = {
    Assignment_ID: assignmentId,
    Employee_ID: String(payload.Employee_ID || (existing ? existing.Employee_ID : '')).trim(),
    Employee_Name: empName,
    Position: String(payload.Position || '').trim(),
    Department_Or_Team: String(payload.Department_Or_Team || '').trim(),
    Main_Scope_Of_Responsibility: String(payload.Main_Scope_Of_Responsibility || '').trim(),
    Supporting_Scope: String(payload.Supporting_Scope || '').trim(),
    Assigned_Project_ID: pid,
    Main_WBS_ID: String(payload.Main_WBS_ID || '').trim(),
    Sub_WBS_ID: String(payload.Sub_WBS_ID || '').trim(),
    Assignment_Start_Date: String(payload.Assignment_Start_Date || '').trim(),
    Assignment_End_Date: String(payload.Assignment_End_Date || '').trim(),
    Workload_Allocation_Pct: allocPct,
    Assignment_Status: String(payload.Assignment_Status || 'Active').trim(),
    Project_Manager_Remarks: String(payload.Project_Manager_Remarks || '').trim()
  };

  let prevClean = null;
  if (existing) {
    prevClean = Object.assign({}, existing);
    delete prevClean._rowIndex;
  }

  if (isUpdate) {
    updateRecordById_(DB_CONFIG.TABS.TEAM_WORKLOAD, 'Assignment_ID', assignmentId, record);
    writeAuditLog_(ctx, 'UPDATE_TEAM_WORKLOAD', 'Team_Workload', assignmentId, prevClean, record, 'Updated team workload assignment');
  } else {
    insertRecordWithGeneratedId_(DB_CONFIG.TABS.TEAM_WORKLOAD, 'Assignment_ID', 'WASG', 4, record);
    assignmentId = record.Assignment_ID;
    writeAuditLog_(ctx, 'CREATE_TEAM_WORKLOAD', 'Team_Workload', assignmentId, null, record, 'Created team workload assignment');
  }

  return { success: true, assignment: record };
}

/**
 * Deletes a Team_Workload assignment row (requires Team_Workload delete permission)
 * and writes an Audit_Logs entry.
 */
function apiDeleteTeamWorkloadAssignment(projectId, assignmentId) {
  if (!projectId || !assignmentId) throw new Error('Project_ID and Assignment_ID are required.');
  const pid = String(projectId).trim();
  const ctx = assertPermission_('Team_Workload', 'delete', pid);

  const existing = findRecordRowById_(DB_CONFIG.TABS.TEAM_WORKLOAD, 'Assignment_ID', assignmentId);
  if (!existing) throw new Error('Workload assignment not found: ' + assignmentId);
  if (String(existing.Assigned_Project_ID || '').trim() !== pid) {
    throw new Error('Assignment does not belong to the active project.');
  }

  const prevClean = Object.assign({}, existing);
  delete prevClean._rowIndex;

  deleteRecordsByIds_(DB_CONFIG.TABS.TEAM_WORKLOAD, 'Assignment_ID', [assignmentId]);

  writeAuditLog_(ctx, 'DELETE_TEAM_WORKLOAD', 'Team_Workload', assignmentId, prevClean, null, 'Deleted team workload assignment');
  return { success: true };
}

// ============================================================================
// PHASE 10: PROCUREMENT, LOGISTICS & FINANCIAL MONITORING MODULE
// ============================================================================

function resolvePhase10TabName_(kind) {
  const tabs = (typeof DB_CONFIG !== 'undefined' && DB_CONFIG.TABS) ? DB_CONFIG.TABS : {};
  if (kind === 'procurement') {
    return tabs.PROCUREMENT || tabs.PROCUREMENT_LOGISTICS || 'Procurement_Logistics';
  }
  return tabs.FINANCIALS || tabs.FINANCIAL_MONITORING || 'Financial_Monitoring';
}

function safeGetRecordsBySheetName_(sheetName) {
  try {
    const ss = getMasterSpreadsheet_();
    if (!ss || !ss.getSheetByName(sheetName)) return [];
    return getTableRecords_(sheetName).map(r => {
      const copy = Object.assign({}, r);
      delete copy._rowIndex;
      return copy;
    });
  } catch (e) {
    return [];
  }
}

/**
 * Fetches project-scoped Procurement & Logistics records and Financial Monitoring
 * records, plus variance and budget burn summaries.
 */
function resolvePhase10PermCtx_(action, pid, preferredKeys) {
  const keys = preferredKeys || ['Financials', 'Financial Monitoring', 'Budget & Financials', 'Procurement & Financials', 'Procurement'];
  let lastErr = null;

  for (let i = 0; i < keys.length; i++) {
    try {
      return assertPermission_(keys[i], action, pid);
    } catch (e) {
      lastErr = e;
    }
  }

  try {
    const fallbackCtx = assertPermission_('Projects', 'view', pid);
    const roleStr = String(fallbackCtx.role || fallbackCtx.userRole || '').trim().toLowerCase();
    if (roleStr === 'administrator' || roleStr === 'admin' || fallbackCtx.isGlobalViewer) {
      return fallbackCtx;
    }
  } catch (ignore) {}

  throw lastErr || new Error('Permission Denied');
}

/**
 * Fetches project-scoped Procurement & Logistics records and Financial Monitoring
 * records, plus variance and budget burn summaries.
 */
function apiGetProcurementFinancialData(projectId) {
  if (!projectId) throw new Error('Project_ID is required.');
  const pid = String(projectId).trim();

  const ctx = assertPermission_('Procurement_Logistics', 'view', pid);
  assertPermission_('Financial_Monitoring', 'view', pid);
  const finPerms = ctx.permissions['Financial_Monitoring'] || {};
  const procPerms = ctx.permissions['Procurement_Logistics'] || {};

  const procTab = resolvePhase10TabName_('procurement');
  const finTab = resolvePhase10TabName_('financials');

  const procurementItems = safeGetRecordsBySheetName_(procTab)
    .filter(item => String(item.Project_ID || '').trim() === pid);

  const financialItems = safeGetRecordsBySheetName_(finTab)
    .filter(item => String(item.Project_ID || '').trim() === pid);

  let totalBudget = 0;
  let totalCommitted = 0;
  let totalActual = 0;

  const enrichedFinancials = financialItems.map(f => {
    const budget = Number(f.Budget_Amount) || 0;
    const committed = Number(f.Committed_Amount) || 0;
    const actual = Number(f.Actual_Spend) || 0;
    const variance = Number((budget - actual).toFixed(2));
    const burnPct = budget > 0 ? Number(((actual / budget) * 100).toFixed(1)) : 0;

    totalBudget += budget;
    totalCommitted += committed;
    totalActual += actual;

    return Object.assign({}, f, {
      Budget_Amount: budget,
      Committed_Amount: committed,
      Actual_Spend: actual,
      Variance_Amount: variance,
      Burn_Pct: burnPct
    });
  });

  const totalProcurementValue = procurementItems.reduce((sum, p) => {
    const lineCost = Number(p.Total_Cost);
    if (!isNaN(lineCost) && lineCost > 0) return sum + lineCost;
    const qty = Number(p.Quantity) || 0;
    const unit = Number(p.Unit_Cost) || 0;
    return sum + (qty * unit);
  }, 0);

  const openShipmentsCount = procurementItems.filter(p => {
    const st = String(p.Delivery_Status || p.Status || '').trim().toLowerCase();
    return !['delivered', 'received', 'completed', 'closed', 'cancelled'].includes(st);
  }).length;

  const totalVariance = Number((totalBudget - totalActual).toFixed(2));
  const overallBurnPct = totalBudget > 0 ? Number(((totalActual / totalBudget) * 100).toFixed(1)) : 0;

  const mainWbs = safeGetRecordsBySheetName_(DB_CONFIG.TABS.MAIN_WBS)
    .filter(m => String(m.Project_ID || '').trim() === pid && String(m.Is_Archived || '').toUpperCase() !== 'TRUE')
    .map(m => ({ id: m.Main_WBS_ID, name: m.Module_Name }));

  return {
    success: true,
    projectId: pid,
    procurementItems: procurementItems,
    financialItems: enrichedFinancials,
    mainWbs: mainWbs,
    summary: {
      procurementCount: procurementItems.length,
      openShipmentsCount: openShipmentsCount,
      totalProcurementValue: Number(totalProcurementValue.toFixed(2)),
      totalBudget: Number(totalBudget.toFixed(2)),
      totalCommitted: Number(totalCommitted.toFixed(2)),
      totalActual: Number(totalActual.toFixed(2)),
      totalVariance: totalVariance,
      overallBurnPct: overallBurnPct
    },
    permissions: {
      procurement: {
        create: Boolean(procPerms.create),
        edit: Boolean(procPerms.edit),
        delete: Boolean(procPerms.delete)
      },
      financials: {
        create: Boolean(finPerms.create),
        edit: Boolean(finPerms.edit),
        delete: Boolean(finPerms.delete)
      }
    }
  };
}

/**
 * Creates or updates a Procurement & Logistics record and writes an Audit_Logs entry.
 */
function apiSaveProcurementItem(projectId, payload) {
  if (!projectId) throw new Error('Project_ID is required.');
  const pid = String(projectId).trim();

  const rawId = String(payload.Procurement_ID || '').trim();
  const procTab = resolvePhase10TabName_('procurement');
  const existing = rawId ? findRecordRowById_(procTab, 'Procurement_ID', rawId) : null;
  const isUpdate = Boolean(existing);
  if (isUpdate) assertRecordProjectOwnership_(existing, pid, 'Procurement item');

  const ctx = assertPermission_('Procurement', isUpdate ? 'edit' : 'create', pid);

  const itemName = String(payload.Item_Description || '').trim();
  if (!itemName) throw new Error('Item Description is required.');

  const qty = Math.max(0, Number(payload.Quantity) || 0);
  const unitCost = Math.max(0, Number(payload.Unit_Cost) || 0);
  const explicitTotal = payload.Total_Cost !== '' && payload.Total_Cost !== undefined
    ? Math.max(0, Number(payload.Total_Cost) || 0)
    : Number((qty * unitCost).toFixed(2));

  let procId = isUpdate ? rawId : '';

  const record = {
    Procurement_ID: procId,
    Project_ID: pid,
    Main_WBS_ID: String(payload.Main_WBS_ID || '').trim(),
    PO_Or_Reference: String(payload.PO_Or_Reference || '').trim(),
    Item_Description: itemName,
    Vendor_Or_Carrier: String(payload.Vendor_Or_Carrier || '').trim(),
    Quantity: qty,
    Unit_Cost: unitCost,
    Total_Cost: explicitTotal,
    Expected_Delivery_Date: String(payload.Expected_Delivery_Date || '').trim(),
    Delivery_Status: String(payload.Delivery_Status || 'Pending').trim(),
    Remarks: String(payload.Remarks || '').trim()
  };

  let prevClean = null;
  if (existing) {
    prevClean = Object.assign({}, existing);
    delete prevClean._rowIndex;
    updateRecordById_(procTab, 'Procurement_ID', procId, record);
    writeAuditLog_(ctx, 'UPDATE_PROCUREMENT', procTab, procId, prevClean, record, 'Updated procurement/logistics item');
  } else {
    insertRecordWithGeneratedId_(procTab, 'Procurement_ID', 'PRC', 4, record);
    procId = record.Procurement_ID;
    writeAuditLog_(ctx, 'CREATE_PROCUREMENT', procTab, procId, null, record, 'Created procurement/logistics item');
  }

  return { success: true, item: record };
}

/**
 * Deletes a Procurement & Logistics record and writes an Audit_Logs entry.
 */
function apiDeleteProcurementItem(projectId, procurementId) {
  if (!projectId || !procurementId) throw new Error('Project_ID and Procurement_ID are required.');
  const pid = String(projectId).trim();
  const ctx = assertPermission_('Procurement', 'delete', pid);

  const procTab = resolvePhase10TabName_('procurement');
  const existing = findRecordRowById_(procTab, 'Procurement_ID', procurementId);
  if (!existing) throw new Error('Procurement item not found: ' + procurementId);
  if (String(existing.Project_ID || '').trim() !== pid) {
    throw new Error('Procurement item does not belong to the active project.');
  }

  const prevClean = Object.assign({}, existing);
  delete prevClean._rowIndex;

  deleteRecordsByIds_(procTab, 'Procurement_ID', [procurementId]);

  writeAuditLog_(ctx, 'DELETE_PROCUREMENT', procTab, procurementId, prevClean, null, 'Deleted procurement/logistics item');
  return { success: true };
}

/**
 * Creates or updates a Financial Monitoring record and writes an Audit_Logs entry.
 */
function apiSaveFinancialItem(projectId, payload) {
  if (!projectId) throw new Error('Project_ID is required.');
  const pid = String(projectId).trim();

  const rawId = String(payload.Financial_ID || '').trim();
  const finTab = resolvePhase10TabName_('financials');
  const existing = rawId ? findRecordRowById_(finTab, 'Financial_ID', rawId) : null;
  const isUpdate = Boolean(existing);
  if (isUpdate) assertRecordProjectOwnership_(existing, pid, 'Financial item');

  const ctx = assertPermission_('Financials', isUpdate ? 'edit' : 'create', pid);

  const category = String(payload.Cost_Category || '').trim();
  if (!category) throw new Error('Cost Category is required.');

  const budget = Math.max(0, Number(payload.Budget_Amount) || 0);
  const committed = Math.max(0, Number(payload.Committed_Amount) || 0);
  const actual = Math.max(0, Number(payload.Actual_Spend) || 0);
  let finId = isUpdate ? rawId : '';

  const record = {
    Financial_ID: finId,
    Project_ID: pid,
    Main_WBS_ID: String(payload.Main_WBS_ID || '').trim(),
    Cost_Category: category,
    Line_Item_Description: String(payload.Line_Item_Description || '').trim(),
    Budget_Amount: budget,
    Committed_Amount: committed,
    Actual_Spend: actual,
    Financial_Status: String(payload.Financial_Status || 'On Track').trim(),
    Remarks: String(payload.Remarks || '').trim()
  };

  let prevClean = null;
  if (existing) {
    prevClean = Object.assign({}, existing);
    delete prevClean._rowIndex;
    updateRecordById_(finTab, 'Financial_ID', finId, record);
    writeAuditLog_(ctx, 'UPDATE_FINANCIAL', finTab, finId, prevClean, record, 'Updated financial monitoring item');
  } else {
    insertRecordWithGeneratedId_(finTab, 'Financial_ID', 'FIN', 4, record);
    finId = record.Financial_ID;
    writeAuditLog_(ctx, 'CREATE_FINANCIAL', finTab, finId, null, record, 'Created financial monitoring item');
  }

  return { success: true, item: record };
}

/**
 * Deletes a Financial Monitoring record and writes an Audit_Logs entry.
 */
function apiDeleteFinancialItem(projectId, financialId) {
  if (!projectId || !financialId) throw new Error('Project_ID and Financial_ID are required.');
  const pid = String(projectId).trim();
  const ctx = assertPermission_('Financials', 'delete', pid);

  const finTab = resolvePhase10TabName_('financials');
  const existing = findRecordRowById_(finTab, 'Financial_ID', financialId);
  if (!existing) throw new Error('Financial item not found: ' + financialId);
  if (String(existing.Project_ID || '').trim() !== pid) {
    throw new Error('Financial item does not belong to the active project.');
  }

  const prevClean = Object.assign({}, existing);
  delete prevClean._rowIndex;

  deleteRecordsByIds_(finTab, 'Financial_ID', [financialId]);

  writeAuditLog_(ctx, 'DELETE_FINANCIAL', finTab, financialId, prevClean, null, 'Deleted financial monitoring item');
  return { success: true };
}

// ============================================================================
// PHASE 11: EXECUTIVE PORTFOLIO DASHBOARD, REPORTS & AUDIT TRAIL MODULE
// ============================================================================

function resolvePhase11TabName_(kind) {
  const tabs = (typeof DB_CONFIG !== 'undefined' && DB_CONFIG.TABS) ? DB_CONFIG.TABS : {};
  if (kind === 'audit') return tabs.AUDIT_LOGS || tabs.AUDIT || 'Audit_Logs';
  if (kind === 'weekly') return tabs.WEEKLY_REPORTS || 'Weekly_Reports';
  if (kind === 'progress') return tabs.PROGRESS_LOGS || 'Progress_Logs';
  if (kind === 'workload') return tabs.TEAM_WORKLOAD || 'Team_Workload';
  if (kind === 'procurement') return tabs.PROCUREMENT || tabs.PROCUREMENT_LOGISTICS || 'Procurement_Logistics';
  if (kind === 'financials') return tabs.FINANCIALS || tabs.FINANCIAL_MONITORING || 'Financial_Monitoring';
  return tabs.PROJECTS || 'Projects';
}

function safePhase11Records_(sheetName) {
  try {
    const ss = getMasterSpreadsheet_();
    if (!ss || !ss.getSheetByName(sheetName)) return [];
    return getTableRecords_(sheetName).map(r => {
      const copy = Object.assign({}, r);
      delete copy._rowIndex;
      return copy;
    });
  } catch (e) {
    return [];
  }
}

/**
 * Builds the Executive Portfolio Dashboard roll-up, active project executive report
 * payload, and permission-scoped Audit_Logs entries.
 */
function apiGetExecutiveDashboardData(activeProjectId) {
  const pid = activeProjectId ? String(activeProjectId).trim() : '';
  const ctx = assertPermission_('Projects', 'view', pid || null);

  const projectsAll = safePhase11Records_(resolvePhase11TabName_('projects'));
  const visibleProjects = projectsAll.filter(p => {
    const pKey = String(p.Project_ID || '').trim();
    if (!pKey) return false;
    return ctx.isGlobalViewer || ctx.assignedProjectIds.includes(pKey);
  });

  const visibleIdSet = new Set(visibleProjects.map(p => String(p.Project_ID || '').trim()));

  const workloadAll = safePhase11Records_(resolvePhase11TabName_('workload'))
    .filter(w => visibleIdSet.has(String(w.Assigned_Project_ID || '').trim()));

  const canViewFinancial = Boolean(ctx.permissions['Financial_Monitoring'] && ctx.permissions['Financial_Monitoring'].view);
  const canViewProcurement = Boolean(ctx.permissions['Procurement_Logistics'] && ctx.permissions['Procurement_Logistics'].view);
  const finAll = canViewFinancial ? safePhase11Records_(resolvePhase11TabName_('financials')).filter(f => visibleIdSet.has(String(f.Project_ID || '').trim())) : [];
  const procAll = canViewProcurement ? safePhase11Records_(resolvePhase11TabName_('procurement')).filter(pr => visibleIdSet.has(String(pr.Project_ID || '').trim())) : [];

  const progressAll = safePhase11Records_(resolvePhase11TabName_('progress'))
    .filter(pl => visibleIdSet.has(String(pl.Project_ID || '').trim()));

  const weeklyAll = safePhase11Records_(resolvePhase11TabName_('weekly'))
    .filter(wr => visibleIdSet.has(String(wr.Project_ID || '').trim()));

  // Deduplicated active workload across visible projects
  const empAllocMap = {};
  const projOverloadCount = {};

  workloadAll.forEach(w => {
    const empId = String(w.Employee_ID || '').trim();
    const empName = String(w.Employee_Name || '').trim();
    const empKey = (empId || empName).toLowerCase();
    const status = String(w.Assignment_Status || 'Active').trim();
    const isActive = !['Completed', 'Cancelled', 'Released', 'Inactive'].includes(status);
    const pct = parseFloat(w.Workload_Allocation_Pct) || 0;
    const wPid = String(w.Assigned_Project_ID || '').trim();

    if (isActive && empKey) {
      if (!empAllocMap[empKey]) {
        empAllocMap[empKey] = {
          employeeName: empName || empId,
          totalPct: 0,
          projects: new Set()
        };
      }
      empAllocMap[empKey].totalPct = Number((empAllocMap[empKey].totalPct + pct).toFixed(1));
      if (wPid) empAllocMap[empKey].projects.add(wPid);
    }
  });

  const overallocatedPeople = [];
  Object.keys(empAllocMap).forEach(k => {
    const item = empAllocMap[k];
    if (item.totalPct > 100) {
      overallocatedPeople.push({
        employeeName: item.employeeName,
        totalPct: item.totalPct,
        projects: Array.from(item.projects)
      });
      item.projects.forEach(pId => {
        projOverloadCount[pId] = (projOverloadCount[pId] || 0) + 1;
      });
    }
  });

  // Per-project roll-up rows
  let portfolioBudget = 0;
  let portfolioActual = 0;

  const projectRows = visibleProjects.map(p => {
    const pId = String(p.Project_ID || '').trim();
    const pFin = finAll.filter(f => String(f.Project_ID || '').trim() === pId);
    const pProc = procAll.filter(pr => String(pr.Project_ID || '').trim() === pId);
    const pProg = progressAll.filter(pl => String(pl.Project_ID || '').trim() === pId);
    const pWeek = weeklyAll.filter(wr => String(wr.Project_ID || '').trim() === pId);

    const budget = pFin.reduce((s, f) => s + (Number(f.Budget_Amount) || 0), 0);
    const actual = pFin.reduce((s, f) => s + (Number(f.Actual_Spend) || 0), 0);
    const variance = Number((budget - actual).toFixed(2));
    const burnPct = budget > 0 ? Number(((actual / budget) * 100).toFixed(1)) : 0;

    portfolioBudget += budget;
    portfolioActual += actual;

    const latestProgress = pProg.length ? (pProg[pProg.length - 1].Completion_Pct ?? pProg[pProg.length - 1].Progress_Pct ?? '-') : '-';

    return {
      Project_ID: pId,
      Project_Name: p.Project_Name || pId,
      Status: p.Status || p.Project_Status || 'Active',
      Budget_Amount: Number(budget.toFixed(2)),
      Actual_Spend: Number(actual.toFixed(2)),
      Variance_Amount: variance,
      Burn_Pct: burnPct,
      Procurement_Count: pProc.length,
      Progress_Logs_Count: pProg.length,
      Weekly_Reports_Count: pWeek.length,
      Latest_Progress: latestProgress,
      Overallocated_Resources: projOverloadCount[pId] || 0
    };
  });

  // Audit logs (respecting global vs user scope)
  const rawAudit = safePhase11Records_(resolvePhase11TabName_('audit'));
  const currentUserEmail = String(ctx.userEmail || ctx.email || '').trim().toLowerCase();

  const filteredAudit = ctx.isAdmin ? rawAudit
    .filter(a => {
      if (ctx.isGlobalViewer) return true;
      const aProj = String(a.Project_ID || '').trim();
      if (aProj && visibleIdSet.has(aProj)) return true;
      const actor = String(a.Actor_Email || a.User_Email || a.Changed_By || '').trim().toLowerCase();
      return currentUserEmail && actor === currentUserEmail;
    })
    .slice(-100)
    .reverse() : [];

  const reportTargetId = (pid && visibleIdSet.has(pid))
    ? pid
    : (projectRows.length ? projectRows[0].Project_ID : '');

  const reportTargetRow = projectRows.find(r => r.Project_ID === reportTargetId) || null;
  const reportText = buildExecutiveReportText_(projectRows, reportTargetRow, overallocatedPeople);

  return {
    success: true,
    activeProjectId: reportTargetId,
    projectRows: projectRows,
    overallocatedPeople: overallocatedPeople,
    auditLogs: filteredAudit,
    reportText: reportText,
    summary: {
      visibleProjectsCount: projectRows.length,
      portfolioBudget: Number(portfolioBudget.toFixed(2)),
      portfolioActual: Number(portfolioActual.toFixed(2)),
      portfolioVariance: Number((portfolioBudget - portfolioActual).toFixed(2)),
      overallocatedCount: overallocatedPeople.length,
      auditEventsCount: filteredAudit.length
    }
  };
}

function buildExecutiveReportText_(projectRows, focusProject, overallocatedPeople) {
  const lines = [];
  lines.push('EXECUTIVE PORTFOLIO & PROJECT STATUS BRIEF');
  lines.push('==========================================');
  lines.push('Visible Projects: ' + projectRows.length);

  const totBudget = projectRows.reduce((s, r) => s + (Number(r.Budget_Amount) || 0), 0);
  const totActual = projectRows.reduce((s, r) => s + (Number(r.Actual_Spend) || 0), 0);
  const totVar = (totBudget - totActual).toFixed(2);
  lines.push('Portfolio Budget vs. Actual: ' + totBudget.toFixed(2) + ' / ' + totActual.toFixed(2) + ' (Variance: ' + totVar + ')');
  lines.push('Over-Allocated Team Members (>100%): ' + overallocatedPeople.length);
  lines.push('');

  if (focusProject) {
    lines.push('ACTIVE PROJECT FOCUS: ' + focusProject.Project_ID + ' — ' + focusProject.Project_Name);
    lines.push('- Status: ' + focusProject.Status);
    lines.push('- Budget / Actual / Variance: ' + focusProject.Budget_Amount.toFixed(2) + ' / ' + focusProject.Actual_Spend.toFixed(2) + ' / ' + focusProject.Variance_Amount.toFixed(2) + ' (' + focusProject.Burn_Pct + '% burn)');
    lines.push('- Procurement Items: ' + focusProject.Procurement_Count + ' | Progress Logs: ' + focusProject.Progress_Logs_Count + ' | Weekly Reports: ' + focusProject.Weekly_Reports_Count);
    lines.push('- Over-Allocated Resources on Project: ' + focusProject.Overallocated_Resources);
    lines.push('');
  }

  lines.push('PORTFOLIO BREAKDOWN:');
  projectRows.forEach(r => {
    lines.push('* [' + r.Project_ID + '] ' + r.Project_Name + ' | Status: ' + r.Status + ' | Spend: ' + r.Actual_Spend.toFixed(2) + '/' + r.Budget_Amount.toFixed(2) + ' | Over-Alloc: ' + r.Overallocated_Resources);
  });

  if (overallocatedPeople.length) {
    lines.push('');
    lines.push('RESOURCE CAPACITY ALERTS (>100%):');
    overallocatedPeople.forEach(o => {
      lines.push('* ' + o.employeeName + ' — ' + o.totalPct + '% across [' + o.projects.join(', ') + ']');
    });
  }

  return lines.join('\n');
}

// ============================================================================
// PHASE 12: ROLE & ACCESS ADMIN, SCOPED CSV EXPORT & PRODUCTION HARDENING
// ============================================================================

function resolvePhase12TabName_(kind) {
  const tabs = (typeof DB_CONFIG !== 'undefined' && DB_CONFIG.TABS) ? DB_CONFIG.TABS : {};
  if (kind === 'roles') return tabs.ROLE_PERMISSIONS || tabs.PERMISSIONS || 'Role_Permissions';
  if (kind === 'users') return tabs.USERS || tabs.USER_ACCESS || 'Users';
  if (kind === 'workload') return tabs.TEAM_WORKLOAD || 'Team_Workload';
  if (kind === 'procurement') return tabs.PROCUREMENT || tabs.PROCUREMENT_LOGISTICS || 'Procurement_Logistics';
  if (kind === 'financials') return tabs.FINANCIALS || tabs.FINANCIAL_MONITORING || 'Financial_Monitoring';
  if (kind === 'projects') return tabs.PROJECTS || 'Projects';
  return kind;
}

function safePhase12Rows_(sheetName) {
  try {
    const ss = getMasterSpreadsheet_();
    if (!ss || !ss.getSheetByName(sheetName)) return [];
    return getTableRecords_(sheetName).map(r => {
      const copy = Object.assign({}, r);
      delete copy._rowIndex;
      return copy;
    });
  } catch (e) {
    return [];
  }
}

function isPhase12AdminCtx_(ctx) {
  if (!ctx) return false;
  if (ctx.isGlobalViewer) return true;
  const roleVal = String(ctx.role || ctx.userRole || '').trim().toLowerCase();
  return roleVal === 'administrator' || roleVal === 'admin' || roleVal === 'super admin';
}

/**
 * Returns role permission entries and user access mappings for administrators.
 */
function apiGetRoleAccessAdminData(projectId) {
  const pid = projectId ? String(projectId).trim() : '';
  const ctx = assertPermission_('Projects', 'view', pid || null);
  const isAdmin = isPhase12AdminCtx_(ctx);

  const roleRows = safePhase12Rows_(resolvePhase12TabName_('roles'));
  const userRows = safePhase12Rows_(resolvePhase12TabName_('users')).map(u => {
    const clean = Object.assign({}, u);
    // Avoid exposing sensitive token/password fields if present
    Object.keys(clean).forEach(k => {
      if (/password|secret|token|hash/i.test(k)) delete clean[k];
    });
    return clean;
  });

  return {
    success: true,
    isAdmin: isAdmin,
    currentUser: ctx.userEmail || ctx.email || 'Current User',
    currentRole: ctx.role || ctx.userRole || (isAdmin ? 'Administrator' : 'Member'),
    rolePermissions: isAdmin ? roleRows : [],
    userAssignments: isAdmin ? userRows : []
  };
}

/**
 * Builds CSV text for an allowed dataset scoped to projectId (or accessible portfolio)
 * and records an EXPORT audit log entry.
 */
function apiExportScopedDatasetCsv(datasetKey, projectId) {
  const key = String(datasetKey || '').trim().toLowerCase();
  const pid = projectId ? String(projectId).trim() : '';

  let moduleName = 'Projects';
  let rows = [];
  let filename = 'export.csv';

  if (key === 'workload') {
    if (!pid) throw new Error('Project_ID is required to export Team Workload.');
    moduleName = 'Team_Workload';
    const ctx = assertPermission_('Team_Workload', 'export', pid);
    rows = safePhase12Rows_(resolvePhase12TabName_('workload'))
      .filter(r => String(r.Assigned_Project_ID || '').trim() === pid);
    filename = 'team_workload_' + pid + '.csv';
    writeAuditLog_(ctx, 'EXPORT_CSV', 'Team_Workload', pid, null, { count: rows.length }, 'Exported team workload CSV');
  } else if (key === 'procurement') {
    if (!pid) throw new Error('Project_ID is required to export Procurement.');
    moduleName = 'Procurement';
    const ctx = resolvePhase10PermCtx_('export', pid, ['Procurement_Logistics', 'Procurement', 'Procurement & Logistics']);
    rows = safePhase12Rows_(resolvePhase12TabName_('procurement'))
      .filter(r => String(r.Project_ID || '').trim() === pid);
    filename = 'procurement_' + pid + '.csv';
    writeAuditLog_(ctx, 'EXPORT_CSV', 'Procurement', pid, null, { count: rows.length }, 'Exported procurement CSV');
  } else if (key === 'financials') {
    if (!pid) throw new Error('Project_ID is required to export Financials.');
    moduleName = 'Financials';
    const ctx = resolvePhase10PermCtx_('export', pid, ['Financial_Monitoring', 'Financials', 'Financial Monitoring']);
    rows = safePhase12Rows_(resolvePhase12TabName_('financials'))
      .filter(r => String(r.Project_ID || '').trim() === pid);
    filename = 'financials_' + pid + '.csv';
    writeAuditLog_(ctx, 'EXPORT_CSV', 'Financials', pid, null, { count: rows.length }, 'Exported financials CSV');
  } else {
    moduleName = 'Projects';
    const ctx = assertPermission_('Projects', 'view', pid || null);
    const p = ctx.permissions['Projects'] || {};
    if (!isPhase12AdminCtx_(ctx) && p.export === false) {
      throw new Error('Permission Denied: Export is not enabled for Portfolio Projects.');
    }
    const allProjs = safePhase12Rows_(resolvePhase12TabName_('projects'));
    rows = allProjs.filter(r => {
      const pKey = String(r.Project_ID || '').trim();
      if (!pKey) return false;
      return ctx.isGlobalViewer || ctx.assignedProjectIds.includes(pKey);
    });
    filename = 'portfolio_projects_summary.csv';
    writeAuditLog_(ctx, 'EXPORT_CSV', 'Projects', pid || 'PORTFOLIO', null, { count: rows.length }, 'Exported portfolio projects CSV');
  }

  const csvText = convertRecordsToCsv_(rows);
  return {
    success: true,
    dataset: key,
    module: moduleName,
    rowCount: rows.length,
    filename: filename,
    csvContent: csvText
  };
}

function convertRecordsToCsv_(rows) {
  if (!rows || !rows.length) {
    return 'No_Records\n';
  }
  const headers = [];
  const seen = {};
  rows.forEach(r => {
    Object.keys(r || {}).forEach(k => {
      if (!seen[k]) {
        seen[k] = true;
        headers.push(k);
      }
    });
  });

  const escapeCell = val => {
    if (val === null || val === undefined) return '';
    let str = String(val);
    // Spreadsheet formula injection defense for values beginning with =, +, -, or @.
    if (/^[\s\u0000-\u001F]*[=+\-@]/.test(str)) str = "'" + str;
    if (/[",\n\r]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
    return str;
  };

  const lines = [headers.map(escapeCell).join(',')];
  rows.forEach(r => {
    lines.push(headers.map(h => escapeCell(r[h])).join(','));
  });
  return lines.join('\r\n');
}

// ============================================================================
// PHASE 14: AUTOMATED ALERTS, THRESHOLD WARNINGS & DIGEST READINESS
// ============================================================================

function resolvePhase14TabName_(kind) {
  const tabs = (typeof DB_CONFIG !== 'undefined' && DB_CONFIG.TABS) ? DB_CONFIG.TABS : {};
  if (kind === 'projects') return tabs.PROJECTS || 'Projects';
  if (kind === 'workload') return tabs.TEAM_WORKLOAD || 'Team_Workload';
  if (kind === 'financials') return tabs.FINANCIALS || tabs.FINANCIAL_MONITORING || 'Financial_Monitoring';
  if (kind === 'procurement') return tabs.PROCUREMENT || tabs.PROCUREMENT_LOGISTICS || 'Procurement_Logistics';
  return kind;
}

function safePhase14Rows_(sheetName) {
  try {
    const ss = getMasterSpreadsheet_();
    if (!ss || !ss.getSheetByName(sheetName)) return [];
    return getTableRecords_(sheetName).map(r => {
      const copy = Object.assign({}, r);
      delete copy._rowIndex;
      return copy;
    });
  } catch (e) {
    return [];
  }
}

/**
 * Evaluates resource allocation caps, budget burn/overrun thresholds, and open
 * procurement items across accessible projects (optionally focused on activeProjectId).
 */
function apiGetAlertThresholdsData(activeProjectId, options) {
  const pid = activeProjectId ? String(activeProjectId).trim() : '';
  assertPrivilegedManagementRole_(pid || null);
  const opts = options || {};
  const maxAllocPct = Math.max(1, Number(opts.maxAllocPct) || 100);
  const budgetWarnPct = Math.max(1, Number(opts.budgetWarnPct) || 85);

  const ctx = assertPermission_('Projects', 'view', pid || null);

  const projectsAll = safePhase14Rows_(resolvePhase14TabName_('projects'));
  const projectMap = {};
  const visibleIds = new Set();

  projectsAll.forEach(p => {
    const pKey = String(p.Project_ID || '').trim();
    if (!pKey) return;
    projectMap[pKey] = p.Project_Name || pKey;
    if (ctx.isGlobalViewer || ctx.assignedProjectIds.includes(pKey)) {
      visibleIds.add(pKey);
    }
  });

  const workloadRows = safePhase14Rows_(resolvePhase14TabName_('workload'))
    .filter(w => visibleIds.has(String(w.Assigned_Project_ID || '').trim()));

  const financialRows = safePhase14Rows_(resolvePhase14TabName_('financials'))
    .filter(f => visibleIds.has(String(f.Project_ID || '').trim()));

  const procurementRows = safePhase14Rows_(resolvePhase14TabName_('procurement'))
    .filter(pr => visibleIds.has(String(pr.Project_ID || '').trim()));

  const alerts = [];

  // 1. Deduplicated resource over-allocation check
  const empMap = {};
  workloadRows.forEach(w => {
    const status = String(w.Assignment_Status || 'Active').trim();
    const isActive = !['Completed', 'Cancelled', 'Released', 'Inactive'].includes(status);
    if (!isActive) return;

    const empId = String(w.Employee_ID || '').trim();
    const empName = String(w.Employee_Name || '').trim();
    const key = (empId || empName).toLowerCase();
    if (!key) return;

    const pct = parseFloat(w.Workload_Allocation_Pct) || 0;
    const wPid = String(w.Assigned_Project_ID || '').trim();

    if (!empMap[key]) {
      empMap[key] = {
        name: empName || empId,
        totalPct: 0,
        projects: new Set()
      };
    }
    empMap[key].totalPct = Number((empMap[key].totalPct + pct).toFixed(1));
    if (wPid) empMap[key].projects.add(wPid);
  });

  Object.keys(empMap).forEach(k => {
    const emp = empMap[k];
    if (emp.totalPct > maxAllocPct) {
      const projList = Array.from(emp.projects);
      const isFocus = pid && projList.includes(pid);
      alerts.push({
        severity: 'HIGH',
        category: 'Resource Capacity',
        projectId: projList.join(', '),
        isFocus: Boolean(isFocus),
        title: emp.name + ' at ' + emp.totalPct + '% active allocation (cap: ' + maxAllocPct + '%)',
        detail: 'Assigned across: ' + projList.map(id => id + (projectMap[id] ? ' (' + projectMap[id] + ')' : '')).join(', ')
      });
    }
  });

  // 2. Financial overrun & high burn threshold check
  financialRows.forEach(f => {
    const fPid = String(f.Project_ID || '').trim();
    const budget = Number(f.Budget_Amount) || 0;
    const actual = Number(f.Actual_Spend) || 0;
    if (budget <= 0 && actual <= 0) return;

    const variance = Number((budget - actual).toFixed(2));
    const burnPct = budget > 0 ? Number(((actual / budget) * 100).toFixed(1)) : 999;
    const label = (f.Financial_ID ? f.Financial_ID + ': ' : '') + (f.Cost_Category || f.Line_Item_Description || 'Budget Item');

    if (variance < 0) {
      alerts.push({
        severity: 'HIGH',
        category: 'Budget Overrun',
        projectId: fPid,
        isFocus: Boolean(pid && fPid === pid),
        title: label + ' exceeded budget by ' + Math.abs(variance).toFixed(2),
        detail: 'Project ' + fPid + ' | Budget: ' + budget.toFixed(2) + ' | Actual: ' + actual.toFixed(2) + ' (' + burnPct + '% burn)'
      });
    } else if (burnPct >= budgetWarnPct) {
      alerts.push({
        severity: 'MEDIUM',
        category: 'High Budget Burn',
        projectId: fPid,
        isFocus: Boolean(pid && fPid === pid),
        title: label + ' at ' + burnPct + '% budget burn (threshold: ' + budgetWarnPct + '%)',
        detail: 'Project ' + fPid + ' | Budget: ' + budget.toFixed(2) + ' | Actual: ' + actual.toFixed(2)
      });
    }
  });

  // 3. Open procurement / shipment items check
  procurementRows.forEach(pr => {
    const prPid = String(pr.Project_ID || '').trim();
    const st = String(pr.Delivery_Status || pr.Status || 'Pending').trim();
    const isClosed = ['delivered', 'received', 'completed', 'closed', 'cancelled'].includes(st.toLowerCase());
    if (!isClosed) {
      const desc = (pr.Procurement_ID ? pr.Procurement_ID + ': ' : '') + (pr.Item_Description || pr.PO_Or_Reference || 'Procurement Item');
      alerts.push({
        severity: 'LOW',
        category: 'Open Procurement',
        projectId: prPid,
        isFocus: Boolean(pid && prPid === pid),
        title: desc + ' [' + st + ']',
        detail: 'Project ' + prPid + (pr.Expected_Delivery_Date ? ' | ETA: ' + pr.Expected_Delivery_Date : '') + (pr.Vendor_Or_Carrier ? ' | Vendor: ' + pr.Vendor_Or_Carrier : '')
      });
    }
  });

  const digestLines = [
    'PMO ALERTS & THRESHOLD DIGEST',
    '==============================',
    'Thresholds: Max Allocation ' + maxAllocPct + '% | Budget Burn Warning ' + budgetWarnPct + '%',
    'Total Alerts: ' + alerts.length + ' (High: ' + alerts.filter(a => a.severity === 'HIGH').length +
      ', Medium: ' + alerts.filter(a => a.severity === 'MEDIUM').length +
      ', Open Procurement: ' + alerts.filter(a => a.severity === 'LOW').length + ')',
    ''
  ];

  if (!alerts.length) {
    digestLines.push('No threshold exceptions or open procurement items detected.');
  } else {
    alerts.forEach(a => {
      digestLines.push('[' + a.severity + '] [' + a.category + '] ' + a.title + ' — ' + a.detail);
    });
  }

  return {
    success: true,
    activeProjectId: pid,
    thresholds: { maxAllocPct: maxAllocPct, budgetWarnPct: budgetWarnPct },
    alerts: alerts,
    counts: {
      total: alerts.length,
      high: alerts.filter(a => a.severity === 'HIGH').length,
      medium: alerts.filter(a => a.severity === 'MEDIUM').length,
      openProcurement: alerts.filter(a => a.severity === 'LOW').length
    },
    digestText: digestLines.join('\n')
  };
}

// ============================================================================
// PHASE 15: SCHEDULE, MILESTONE & DELIVERABLE DEADLINE RISK MONITORING
// ============================================================================

function resolvePhase15TabName_(kind) {
  const tabs = (typeof DB_CONFIG !== 'undefined' && DB_CONFIG.TABS) ? DB_CONFIG.TABS : {};
  if (kind === 'projects') return tabs.PROJECTS || 'Projects';
  if (kind === 'sub_wbs') return tabs.SUB_WBS || 'Sub_WBS';
  if (kind === 'milestones') return tabs.MILESTONES || 'Milestones';
  if (kind === 'deliverables') return tabs.DELIVERABLES || 'Deliverables';
  if (kind === 'permits') return tabs.PERMITS || 'Permits';
  return kind;
}

function safePhase15Rows_(sheetName) {
  try {
    const ss = getMasterSpreadsheet_();
    if (!ss || !ss.getSheetByName(sheetName)) return [];
    return getTableRecords_(sheetName).map(r => {
      const copy = Object.assign({}, r);
      delete copy._rowIndex;
      return copy;
    });
  } catch (e) {
    return [];
  }
}

function parsePhase15Date_(val) {
  if (!val) return null;
  if (Object.prototype.toString.call(val) === '[object Date]' && !isNaN(val.getTime())) {
    return new Date(val.getFullYear(), val.getMonth(), val.getDate());
  }
  const str = String(val).trim();
  if (!str) return null;
  const d = new Date(str);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isPhase15CompletedStatus_(statusVal) {
  const s = String(statusVal || '').trim().toLowerCase();
  return ['completed', 'complete', 'done', 'closed', 'approved', 'issued', 'delivered', 'resolved', 'cancelled'].includes(s);
}

/**
 * Scans Sub_WBS tasks, Milestones, Deliverables, and Permits across accessible
 * projects for overdue and upcoming deadlines.
 */
function apiGetScheduleRiskData(activeProjectId, options) {
  const pid = activeProjectId ? String(activeProjectId).trim() : '';
  assertPrivilegedManagementRole_(pid || null);
  const opts = options || {};
  const lookaheadDays = Math.max(1, Math.min(90, Number(opts.lookaheadDays) || 7));

  const ctx = assertPermission_('Projects', 'view', pid || null);

  const projectsAll = safePhase15Rows_(resolvePhase15TabName_('projects'));
  const projectMap = {};
  const visibleIds = new Set();

  projectsAll.forEach(p => {
    const pKey = String(p.Project_ID || '').trim();
    if (!pKey) return;
    projectMap[pKey] = p.Project_Name || pKey;
    if (ctx.isGlobalViewer || ctx.assignedProjectIds.includes(pKey)) {
      visibleIds.add(pKey);
    }
  });

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const cutoff = new Date(today.getTime() + lookaheadDays * 86400000);

  const sources = [
    {
      kind: 'Sub_WBS',
      label: 'WBS Task',
      rows: safePhase15Rows_(resolvePhase15TabName_('sub_wbs')),
      idField: 'Sub_WBS_ID',
      titleField: 'Task_Name',
      dateFields: ['Planned_Finish_Date', 'Target_End_Date', 'End_Date', 'Finish_Date', 'Due_Date'],
      statusField: 'Status'
    },
    {
      kind: 'Milestones',
      label: 'Milestone',
      rows: safePhase15Rows_(resolvePhase15TabName_('milestones')),
      idField: 'Milestone_ID',
      titleField: 'Milestone_Name',
      dateFields: ['Target_Date', 'Due_Date', 'Planned_Date', 'Milestone_Date'],
      statusField: 'Status'
    },
    {
      kind: 'Deliverables',
      label: 'Deliverable',
      rows: safePhase15Rows_(resolvePhase15TabName_('deliverables')),
      idField: 'Deliverable_ID',
      titleField: 'Deliverable_Name',
      dateFields: ['Due_Date', 'Target_Date', 'Submission_Date', 'End_Date'],
      statusField: 'Status'
    },
    {
      kind: 'Permits',
      label: 'Permit',
      rows: safePhase15Rows_(resolvePhase15TabName_('permits')),
      idField: 'Permit_ID',
      titleField: 'Permit_Name',
      dateFields: ['Target_Date', 'Expiry_Date', 'Due_Date', 'Application_Deadline'],
      statusField: 'Status'
    }
  ];

  const items = [];

  sources.forEach(src => {
    src.rows.forEach(r => {
      const rPid = String(r.Project_ID || '').trim();
      if (!rPid || !visibleIds.has(rPid)) return;

      const status = String(r[src.statusField] || r.Approval_Status || 'In Progress').trim();
      if (isPhase15CompletedStatus_(status)) return;

      let targetDate = null;
      let rawDateStr = '';
      for (let i = 0; i < src.dateFields.length; i++) {
        const df = src.dateFields[i];
        if (r[df]) {
          rawDateStr = String(r[df]).trim();
          targetDate = parsePhase15Date_(r[df]);
          if (targetDate) break;
        }
      }
      if (!targetDate) return;

      const diffDays = Math.round((targetDate.getTime() - today.getTime()) / 86400000);
      let riskLevel = '';
      if (targetDate.getTime() < today.getTime()) {
        riskLevel = 'OVERDUE';
      } else if (targetDate.getTime() <= cutoff.getTime()) {
        riskLevel = 'DUE_SOON';
      } else {
        return;
      }

      const recId = String(r[src.idField] || '').trim();
      const recTitle = String(r[src.titleField] || r.Title || r.Description || src.label).trim();

      items.push({
        riskLevel: riskLevel,
        source: src.kind,
        label: src.label,
        projectId: rPid,
        projectName: projectMap[rPid] || rPid,
        isFocus: Boolean(pid && rPid === pid),
        recordId: recId,
        title: (recId ? recId + ': ' : '') + recTitle,
        dueDate: rawDateStr,
        daysDelta: diffDays,
        status: status
      });
    });
  });

  // Sort OVERDUE first (most overdue first), then DUE_SOON (soonest first)
  items.sort((a, b) => {
    if (a.riskLevel !== b.riskLevel) {
      return a.riskLevel === 'OVERDUE' ? -1 : 1;
    }
    return a.daysDelta - b.daysDelta;
  });

  const overdueCount = items.filter(i => i.riskLevel === 'OVERDUE').length;
  const dueSoonCount = items.filter(i => i.riskLevel === 'DUE_SOON').length;

  const digestLines = [
    'SCHEDULE & DEADLINE RISK BRIEF',
    '==============================',
    'Lookahead Window: Next ' + lookaheadDays + ' day(s)',
    'Overdue Items: ' + overdueCount + ' | Due Soon: ' + dueSoonCount,
    ''
  ];

  if (!items.length) {
    digestLines.push('No overdue or upcoming deadline risks found in the selected window.');
  } else {
    items.forEach(it => {
      const timing = it.riskLevel === 'OVERDUE'
        ? Math.abs(it.daysDelta) + ' day(s) overdue'
        : (it.daysDelta === 0 ? 'Due today' : 'Due in ' + it.daysDelta + ' day(s)');
      digestLines.push('[' + it.riskLevel + '] [' + it.projectId + '] [' + it.source + '] ' + it.title + ' — ' + timing + ' (Status: ' + it.status + ')');
    });
  }

  return {
    success: true,
    activeProjectId: pid,
    lookaheadDays: lookaheadDays,
    items: items,
    counts: {
      total: items.length,
      overdue: overdueCount,
      dueSoon: dueSoonCount
    },
    digestText: digestLines.join('\n')
  };
}

// ============================================================================
// PHASE 16: UNIFIED PMO DIGEST & ESCALATION DISPATCH
// ============================================================================

/**
 * Combines Executive Dashboard summary, Alert Thresholds, and Schedule Risk
 * into a single unified PMO digest payload.
 */
function apiBuildUnifiedPmoDigest(activeProjectId, options) {
  const pid = activeProjectId ? String(activeProjectId).trim() : '';
  assertPrivilegedManagementRole_(pid || null);
  const opts = options || {};
  const maxAllocPct = Math.max(1, Number(opts.maxAllocPct) || 100);
  const budgetWarnPct = Math.max(1, Number(opts.budgetWarnPct) || 85);
  const lookaheadDays = Math.max(1, Math.min(90, Number(opts.lookaheadDays) || 7));

  const ctx = assertPermission_('Projects', 'view', pid || null);

  const execData = (typeof apiGetExecutiveDashboardData === 'function')
    ? apiGetExecutiveDashboardData(pid)
    : { summary: {}, projectRows: [] };

  const alertData = (typeof apiGetAlertThresholdsData === 'function')
    ? apiGetAlertThresholdsData(pid, { maxAllocPct: maxAllocPct, budgetWarnPct: budgetWarnPct })
    : { alerts: [], counts: { total: 0, high: 0, medium: 0, openProcurement: 0 } };

  const schedData = (typeof apiGetScheduleRiskData === 'function')
    ? apiGetScheduleRiskData(pid, { lookaheadDays: lookaheadDays })
    : { items: [], counts: { total: 0, overdue: 0, dueSoon: 0 } };

  const eSum = execData.summary || {};
  const aCounts = alertData.counts || {};
  const sCounts = schedData.counts || {};

  const lines = [
    'UNIFIED PMO HEALTH & ESCALATION DIGEST',
    '======================================',
    'Generated By: ' + (ctx.userEmail || ctx.email || 'System User'),
    'Scope Context: ' + (pid ? 'Focus Project ' + pid + ' (with accessible portfolio)' : 'Accessible Portfolio'),
    '',
    '1. PORTFOLIO & FINANCIAL SNAPSHOT',
    '- Accessible Projects: ' + (eSum.visibleProjectsCount || 0),
    '- Budget / Actual / Variance: ' +
      Number(eSum.portfolioBudget || 0).toFixed(2) + ' / ' +
      Number(eSum.portfolioActual || 0).toFixed(2) + ' / ' +
      Number(eSum.portfolioVariance || 0).toFixed(2),
    '- Over-Allocated Team Members (> ' + maxAllocPct + '%): ' + (eSum.overallocatedCount || 0),
    '',
    '2. THRESHOLD & OPERATIONAL ALERTS (' + (aCounts.total || 0) + ')',
    '- High Severity: ' + (aCounts.high || 0) +
      ' | Budget Burn Warnings (>= ' + budgetWarnPct + '%): ' + (aCounts.medium || 0) +
      ' | Open Procurement: ' + (aCounts.openProcurement || 0),
    '',
    '3. SCHEDULE & DEADLINE RISKS (Next ' + lookaheadDays + 'd: ' + (sCounts.total || 0) + ')',
    '- Overdue Items: ' + (sCounts.overdue || 0) + ' | Due Soon: ' + (sCounts.dueSoon || 0),
    ''
  ];

  const topAlerts = (alertData.alerts || []).slice(0, 10);
  if (topAlerts.length) {
    lines.push('TOP ALERTS:');
    topAlerts.forEach(a => {
      lines.push('* [' + a.severity + '] [' + a.category + '] ' + a.title + ' (' + a.projectId + ')');
    });
    lines.push('');
  }

  const topSched = (schedData.items || []).slice(0, 10);
  if (topSched.length) {
    lines.push('TOP SCHEDULE / DEADLINE ITEMS:');
    topSched.forEach(s => {
      const when = s.riskLevel === 'OVERDUE'
        ? Math.abs(s.daysDelta) + 'd overdue'
        : (s.daysDelta === 0 ? 'Due today' : 'In ' + s.daysDelta + 'd');
      lines.push('* [' + s.riskLevel + '] [' + s.projectId + '] ' + s.title + ' — ' + when + ' (' + s.status + ')');
    });
  }

  return {
    success: true,
    digestText: lines.join('\n'),
    counts: {
      projects: eSum.visibleProjectsCount || 0,
      alerts: aCounts.total || 0,
      highAlerts: aCounts.high || 0,
      overdue: sCounts.overdue || 0,
      dueSoon: sCounts.dueSoon || 0
    }
  };
}

/**
 * Sends the unified PMO digest via email to the specified recipient(s)
 * and logs a governance audit event.
 */
function apiDispatchPmoDigestEmail(recipientEmail, subjectLine, digestBody, activeProjectId) {
  const pid = activeProjectId ? String(activeProjectId).trim() : '';
  assertPrivilegedManagementRole_(pid || null);
  const ctx = assertPermission_('Projects', 'view', pid || null);

  const toList = String(recipientEmail || '')
    .split(/[,;\s]+/)
    .map(s => s.trim())
    .filter(Boolean);

  if (!toList.length) {
    throw new Error('Please enter at least one valid recipient email address.');
  }

  const bodyText = String(digestBody || '').trim();
  if (!bodyText) {
    throw new Error('Digest content is empty.');
  }

  const subj = String(subjectLine || '').trim() ||
    ('PMO Health & Escalation Digest' + (pid ? ' — ' + pid : ''));

  try {
    if (typeof MailApp !== 'undefined' && typeof MailApp.sendEmail === 'function') {
      MailApp.sendEmail(toList.join(','), subj, bodyText);
    } else if (typeof GmailApp !== 'undefined' && typeof GmailApp.sendEmail === 'function') {
      GmailApp.sendEmail(toList.join(','), subj, bodyText);
    } else {
      throw new Error('Mail service is not available in this Apps Script environment.');
    }
  } catch (err) {
    throw new Error('Unable to send email: ' + (err && err.message ? err.message : err));
  }

  if (typeof writeAuditLog_ === 'function') {
    writeAuditLog_(
      ctx,
      'SEND_PMO_DIGEST',
      'PMO_Digest',
      pid || 'PORTFOLIO',
      null,
      { recipients: toList, subject: subj },
      'Dispatched PMO health & escalation digest'
    );
  }

  return {
    success: true,
    recipients: toList,
    subject: subj
  };
}

// ============================================================================
// PHASE 17: AUTOMATED TIME-DRIVEN DIGEST TRIGGERS & RUN HISTORY
// ============================================================================

var PHASE17_TRIGGER_HANDLER_ = 'runScheduledPmoDigestTrigger';
var PHASE17_PROP_KEY_ = 'PHASE17_DIGEST_SCHEDULE_CONFIG';

function isPhase17Admin_(ctx) {
  if (!ctx) return false;
  if (ctx.isGlobalViewer) return true;
  var r = String(ctx.role || ctx.userRole || '').trim().toLowerCase();
  return r === 'administrator' || r === 'admin' || r === 'super admin';
}

function readPhase17Config_() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(PHASE17_PROP_KEY_);
    if (!raw) {
      return {
        enabled: false,
        frequency: 'WEEKLY',
        hourOfDay: 8,
        recipients: '',
        projectId: ''
      };
    }
    var parsed = JSON.parse(raw);
    return {
      enabled: Boolean(parsed.enabled),
      frequency: parsed.frequency === 'DAILY' ? 'DAILY' : 'WEEKLY',
      hourOfDay: Math.max(0, Math.min(23, Number(parsed.hourOfDay) || 8)),
      recipients: String(parsed.recipients || ''),
      projectId: String(parsed.projectId || '')
    };
  } catch (e) {
    return {
      enabled: false,
      frequency: 'WEEKLY',
      hourOfDay: 8,
      recipients: '',
      projectId: ''
    };
  }
}

function getPhase17History_(ctx, visibleIdSet) {
  var rows = (typeof safePhase11Records_ === 'function')
    ? safePhase11Records_(resolvePhase11TabName_('audit'))
    : [];
  var userEmail = String((ctx && (ctx.userEmail || ctx.email)) || '').trim().toLowerCase();

  return rows
    .filter(function(a) {
      var act = String(a.Action || a.Event_Type || '').trim().toUpperCase();
      if (act !== 'SEND_PMO_DIGEST') return false;
      if (ctx && ctx.isGlobalViewer) return true;
      var pid = String(a.Project_ID || '').trim();
      if (pid && pid !== 'PORTFOLIO' && visibleIdSet && visibleIdSet.has(pid)) return true;
      var actor = String(a.Actor_Email || a.User_Email || a.Changed_By || '').trim().toLowerCase();
      return userEmail && actor === userEmail;
    })
    .slice(-30)
    .reverse();
}

/**
 * Returns trigger configuration, active Apps Script trigger status, and recent
 * digest dispatch history.
 */
function apiGetDigestTriggerStatus(activeProjectId) {
  var pid = activeProjectId ? String(activeProjectId).trim() : '';
  assertPrivilegedManagementRole_(pid || null);
  var ctx = assertPermission_('Projects', 'view', pid || null);
  var isAdmin = isPhase17Admin_(ctx);

  var allProjs = (typeof safePhase11Records_ === 'function')
    ? safePhase11Records_(resolvePhase11TabName_('projects'))
    : [];
  var visibleIds = new Set();
  allProjs.forEach(function(p) {
    var k = String(p.Project_ID || '').trim();
    if (k && (ctx.isGlobalViewer || ctx.assignedProjectIds.includes(k))) {
      visibleIds.add(k);
    }
  });

  var triggers = getSafeProjectTriggers_();
  var matching = triggers.filter(function(t) {
    return t.getHandlerFunction && t.getHandlerFunction() === PHASE17_TRIGGER_HANDLER_;
  });

  var cfg = readPhase17Config_();

  return {
    success: true,
    isAdmin: isAdmin,
    config: isAdmin ? cfg : {
      enabled: cfg.enabled,
      frequency: cfg.frequency,
      hourOfDay: cfg.hourOfDay,
      recipients: '',
      projectId: cfg.projectId
    },
    activeTriggerCount: matching.length,
    history: getPhase17History_(ctx, visibleIds)
  };
}

/**
 * Creates, updates, or removes the time-driven trigger for scheduled PMO digests.
 */
function apiSaveDigestTriggerConfig(payload, activeProjectId) {
  var pid = activeProjectId ? String(activeProjectId).trim() : '';
  var ctx = assertPermission_('Projects', 'view', pid || null);
  if (!isPhase17Admin_(ctx)) {
    throw new Error('Permission Denied: Only Administrators can configure scheduled digest triggers.');
  }

  var p = payload || {};
  var enabled = Boolean(p.enabled);
  var frequency = p.frequency === 'DAILY' ? 'DAILY' : 'WEEKLY';
  var hourOfDay = Math.max(0, Math.min(23, Number(p.hourOfDay) || 8));
  var recipients = String(p.recipients || '').trim();
  var targetPid = String(p.projectId || '').trim();

  if (enabled && !recipients) {
    throw new Error('Please enter at least one recipient email before enabling the scheduled trigger.');
  }

  var nextCfg = {
    enabled: enabled,
    frequency: frequency,
    hourOfDay: hourOfDay,
    recipients: recipients,
    projectId: targetPid
  };

  var configLock = LockService.getScriptLock();
  configLock.waitLock(10000);
  try {
    PropertiesService.getScriptProperties().setProperty(PHASE17_PROP_KEY_, JSON.stringify(nextCfg));

    // Clear existing triggers for this handler before recreating
    var triggers = ScriptApp.getProjectTriggers();
    triggers.forEach(function(t) {
      if (t.getHandlerFunction && t.getHandlerFunction() === PHASE17_TRIGGER_HANDLER_) {
        ScriptApp.deleteTrigger(t);
      }
    });

    if (enabled) {
      var builder = ScriptApp.newTrigger(PHASE17_TRIGGER_HANDLER_).timeBased();
      if (frequency === 'DAILY') {
        builder.everyDays(1).atHour(hourOfDay);
      } else {
        builder.everyWeeks(1).onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(hourOfDay);
      }
      builder.create();
    }
  } finally {
    configLock.releaseLock();
  }

  if (typeof writeAuditLog_ === 'function') {
    writeAuditLog_(
      ctx,
      enabled ? 'ENABLE_DIGEST_TRIGGER' : 'DISABLE_DIGEST_TRIGGER',
      'PMO_Digest_Trigger',
      targetPid || 'PORTFOLIO',
      null,
      { enabled: enabled, frequency: frequency, hourOfDay: hourOfDay, recipients: recipients },
      enabled ? 'Configured automated PMO digest trigger' : 'Disabled automated PMO digest trigger'
    );
  }

  return apiGetDigestTriggerStatus(pid);
}

/**
 * Executed automatically by Apps Script time-driven trigger.
 */
function runScheduledPmoDigestTrigger(e) {
  // This public trigger handler is callable by Apps Script time-driven
  // triggers, but must not become an unauthenticated browser/API endpoint.
  var triggerUid = String(e && e.triggerUid || '');
  if (!triggerUid) throw new Error('This function can only be executed by its installed time-driven trigger.');
  var validTrigger = ScriptApp.getProjectTriggers().some(function (trigger) {
    return trigger.getHandlerFunction && trigger.getHandlerFunction() === PHASE17_TRIGGER_HANDLER_ &&
      trigger.getUniqueId && String(trigger.getUniqueId()) === triggerUid;
  });
  if (!validTrigger) throw new Error('Invalid or unrecognized scheduled trigger event.');
  return runScheduledPmoDigestTrigger_();
}

function runScheduledPmoDigestTrigger_() {
  var cfg = readPhase17Config_();
  if (!cfg.enabled || !cfg.recipients) return;

  var digestRes = (typeof apiBuildUnifiedPmoDigest === 'function')
    ? apiBuildUnifiedPmoDigest(cfg.projectId || '', {})
    : { digestText: 'Scheduled PMO Digest' };

  var toList = cfg.recipients
    .split(/[,;\s]+/)
    .map(function(s) { return s.trim(); })
    .filter(Boolean);

  if (!toList.length) return;

  var subj = 'Scheduled PMO Health Digest (' + cfg.frequency + ')' + (cfg.projectId ? ' — ' + cfg.projectId : '');

  if (typeof MailApp !== 'undefined' && typeof MailApp.sendEmail === 'function') {
    MailApp.sendEmail(toList.join(','), subj, digestRes.digestText || '');
  }
}

// ============================================================================
// PHASE 18: EXCEPTION & ESCALATION WORKFLOW RULES
// ============================================================================

var PHASE18_HEADERS_ = [
  'Escalation_ID',
  'Project_ID',
  'Source_Type',
  'Severity',
  'Title',
  'Owner_Email',
  'Status',
  'Notes',
  'Created_By',
  'Created_At',
  'Updated_At'
];

function resolvePhase18TabName_() {
  var tabs = (typeof DB_CONFIG !== 'undefined' && DB_CONFIG.TABS) ? DB_CONFIG.TABS : {};
  return tabs.ESCALATIONS || tabs.EXCEPTION_ESCALATIONS || 'Escalations';
}

function ensurePhase18Sheet_() {
  var lock = LockService.getScriptLock();
  var ownsLock = !lock.hasLock();
  if (ownsLock) lock.waitLock(10000);
  try {
    var ss = getMasterSpreadsheet_();
    var tabName = resolvePhase18TabName_();
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) {
      sheet = ss.insertSheet(tabName);
      sheet.getRange(1, 1, 1, PHASE18_HEADERS_.length).setValues([PHASE18_HEADERS_]);
      return sheet;
    }
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, PHASE18_HEADERS_.length).setValues([PHASE18_HEADERS_]);
    }
    return sheet;
  } finally {
    if (ownsLock) lock.releaseLock();
  }
}

function readPhase18RowsSafe_() {
  try {
    var ss = getMasterSpreadsheet_();
    var tabName = resolvePhase18TabName_();
    var sheet = ss.getSheetByName(tabName);
    if (!sheet || sheet.getLastRow() < 2) return [];
    return getTableRecords_(tabName).map(function(r) {
      var copy = Object.assign({}, r);
      delete copy._rowIndex;
      return copy;
    });
  } catch (e) {
    return [];
  }
}

/**
 * Returns logged escalations visible to the current user plus suggested live
 * exceptions from threshold alerts and overdue items.
 */
function apiGetEscalationsData(activeProjectId) {
  var pid = activeProjectId ? String(activeProjectId).trim() : '';
  assertPrivilegedManagementRole_(pid || null);
  var ctx = assertPermission_('Projects', 'view', pid || null);

  var allProjs = (typeof safePhase11Records_ === 'function')
    ? safePhase11Records_(resolvePhase11TabName_('projects'))
    : [];
  var visibleIds = new Set();
  allProjs.forEach(function(p) {
    var k = String(p.Project_ID || '').trim();
    if (k && (ctx.isGlobalViewer || ctx.assignedProjectIds.includes(k))) {
      visibleIds.add(k);
    }
  });

  var escalations = readPhase18RowsSafe_().filter(function(row) {
    var rPid = String(row.Project_ID || '').trim();
    if (!rPid) return ctx.isGlobalViewer;
    return visibleIds.has(rPid);
  }).reverse();

  // Build candidate exceptions from live alerts & schedule risk
  var candidates = [];
  if (typeof apiGetAlertThresholdsData === 'function') {
    var aRes = apiGetAlertThresholdsData(pid, { maxAllocPct: 100, budgetWarnPct: 85 });
    (aRes.alerts || []).forEach(function(a) {
      if (a.severity === 'HIGH' || a.severity === 'MEDIUM') {
        candidates.push({
          projectId: String(a.projectId || pid || '').split(',')[0].trim(),
          sourceType: a.category.toUpperCase().indexOf('BUDGET') !== -1 ? 'BUDGET' : 'RESOURCE',
          severity: a.severity === 'HIGH' ? 'CRITICAL' : 'MEDIUM',
          title: a.title,
          notes: a.detail
        });
      }
    });
  }
  if (typeof apiGetScheduleRiskData === 'function') {
    var sRes = apiGetScheduleRiskData(pid, { lookaheadDays: 7 });
    (sRes.items || []).forEach(function(it) {
      if (it.riskLevel === 'OVERDUE') {
        candidates.push({
          projectId: it.projectId,
          sourceType: 'SCHEDULE',
          severity: 'HIGH',
          title: it.title + ' (' + Math.abs(it.daysDelta) + 'd overdue)',
          notes: 'Source: ' + it.source + ' | Target Date: ' + it.dueDate + ' | Status: ' + it.status
        });
      }
    });
  }

  var openCount = escalations.filter(function(e) {
    return String(e.Status || '').toUpperCase() !== 'RESOLVED';
  }).length;
  var criticalCount = escalations.filter(function(e) {
    var st = String(e.Status || '').toUpperCase();
    var sev = String(e.Severity || '').toUpperCase();
    return st !== 'RESOLVED' && (sev === 'CRITICAL' || sev === 'HIGH');
  }).length;

  return {
    success: true,
    escalations: escalations,
    candidates: candidates.slice(0, 15),
    counts: {
      total: escalations.length,
      open: openCount,
      criticalOrHigh: criticalCount,
      suggested: candidates.length
    }
  };
}

/**
 * Creates or updates an exception escalation row.
 */
function apiUpsertEscalationItem(payload, activeProjectId) {
  var p = payload || {};
  var targetPid = String(p.Project_ID || activeProjectId || '').trim();
  assertPrivilegedManagementRole_(targetPid || null);
  var ctx = assertPermission_('Projects', 'edit', targetPid || null);

  var title = String(p.Title || '').trim();
  if (!title) throw new Error('Escalation title is required.');

  var tabName = resolvePhase18TabName_();
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  var record;
  var previousRecord = null;
  var isUpdate = false;
  try {
    var sheet = ensurePhase18Sheet_();
    var lastCol = sheet.getLastColumn();
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) { return String(h).trim(); });
    var idIndex = headers.indexOf('Escalation_ID');
    if (idIndex < 0) throw new Error('Escalation_ID header is missing.');
    var lastRow = sheet.getLastRow();
    var rows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];
    var requestedId = String(p.Escalation_ID || '').trim();
    var existing = null;
    var existingMatches = 0;
    rows.forEach(function(row) {
      if (requestedId && String(row[idIndex] || '').trim() === requestedId) {
        existingMatches++;
        existing = {};
        headers.forEach(function(h, col) { existing[h] = row[col]; });
      }
    });
    if (existingMatches > 1) throw new Error('Duplicate Escalation_ID rows detected; refusing ambiguous update.');
    isUpdate = Boolean(existing);
    previousRecord = existing ? Object.assign({}, existing) : null;
    if (existing && String(existing.Project_ID || '').trim() !== (targetPid || 'PORTFOLIO')) {
      throw new Error('Escalation does not belong to the target project; project ownership cannot be changed.');
    }
    var nowIso = new Date().toISOString();
    var actor = String((ctx && (ctx.userEmail || ctx.email)) || getSafeActiveUserEmail_() || 'system');
    var escId = requestedId;
    if (!escId) {
      var existingIds = rows.map(function(row) { return String(row[idIndex] || '').trim(); });
      var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'UTC', 'yyyyMMdd-HHmmss');
      do {
        escId = 'ESC-' + stamp + '-' + Math.floor(100 + Math.random() * 900);
      } while (existingIds.indexOf(escId) !== -1);
    }

    record = {
      Escalation_ID: escId,
      Project_ID: targetPid || 'PORTFOLIO',
      Source_Type: String(p.Source_Type || 'MANUAL').trim().toUpperCase(),
      Severity: String(p.Severity || 'HIGH').trim().toUpperCase(),
      Title: title,
      Owner_Email: String(p.Owner_Email || actor).trim(),
      Status: String(p.Status || 'OPEN').trim().toUpperCase(),
      Notes: String(p.Notes || '').trim(),
      Created_By: existing ? (existing.Created_By || actor) : actor,
      Created_At: existing ? (existing.Created_At || nowIso) : nowIso,
      Updated_At: nowIso
    };

    if (existing) {
      updateRecordById_(tabName, 'Escalation_ID', escId, record);
    } else {
      insertRecord_(tabName, record);
    }
  } finally {
    lock.releaseLock();
  }

  if (typeof writeAuditLog_ === 'function') {
    writeAuditLog_(
      ctx,
      isUpdate ? 'UPDATE_ESCALATION' : 'CREATE_ESCALATION',
      'Escalations',
      record.Escalation_ID,
      previousRecord,
      record,
      (isUpdate ? 'Updated' : 'Created') + ' escalation ' + record.Escalation_ID
    );
  }

  return apiGetEscalationsData(activeProjectId);
}
// ============================================================================
// PHASE 19: SNAPSHOT ARCHIVING & REPORTING TEMPLATES
// ============================================================================

var PHASE19_HEADERS_ = [
  'Snapshot_ID',
  'Project_ID',
  'Label',
  'Captured_By',
  'Captured_At',
  'Total_Budget',
  'Total_Committed',
  'Total_Actual',
  'Budget_Variance',
  'Open_Escalations',
  'Overdue_Items',
  'High_Alerts',
  'Notes'
];

function resolvePhase19TabName_() {
  var tabs = (typeof DB_CONFIG !== 'undefined' && DB_CONFIG.TABS) ? DB_CONFIG.TABS : {};
  return tabs.PMO_SNAPSHOTS || tabs.SNAPSHOTS || 'PMO_Snapshots';
}

function ensurePhase19Sheet_() {
  var lock = LockService.getScriptLock();
  var ownsLock = !lock.hasLock();
  if (ownsLock) lock.waitLock(10000);
  try {
    var ss = getMasterSpreadsheet_();
    var tabName = resolvePhase19TabName_();
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) {
      sheet = ss.insertSheet(tabName);
      sheet.getRange(1, 1, 1, PHASE19_HEADERS_.length).setValues([PHASE19_HEADERS_]);
      return sheet;
    }
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, PHASE19_HEADERS_.length).setValues([PHASE19_HEADERS_]);
    }
    return sheet;
  } finally {
    if (ownsLock) lock.releaseLock();
  }
}

function readPhase19RowsSafe_() {
  try {
    var ss = getMasterSpreadsheet_();
    var tabName = resolvePhase19TabName_();
    var sheet = ss.getSheetByName(tabName);
    if (!sheet || sheet.getLastRow() < 2) return [];
    return getTableRecords_(tabName).map(function(r) {
      var copy = Object.assign({}, r);
      delete copy._rowIndex;
      return copy;
    });
  } catch (e) {
    return [];
  }
}

function computePhase19CurrentMetrics_(pid) {
  var execData = (typeof apiGetExecutiveDashboardData === 'function')
    ? apiGetExecutiveDashboardData(pid)
    : { summary: {}, projectRows: [] };

  var alertData = (typeof apiGetAlertThresholdsData === 'function')
    ? apiGetAlertThresholdsData(pid, { maxAllocPct: 100, budgetWarnPct: 85 })
    : { alerts: [], counts: { high: 0 } };

  var schedData = (typeof apiGetScheduleRiskData === 'function')
    ? apiGetScheduleRiskData(pid, { lookaheadDays: 7 })
    : { items: [], counts: { overdue: 0 } };

  var escData = (typeof apiGetEscalationsData === 'function')
    ? apiGetEscalationsData(pid)
    : { escalations: [], counts: { open: 0 } };

  var budget = 0;
  var committed = 0;
  var actual = 0;
  var variance = 0;

  if (pid && execData.projectRows && execData.projectRows.length) {
    var match = execData.projectRows.find(function(p) {
      return String(p.projectId || p.Project_ID || '').trim() === pid;
    });
    if (match) {
      budget = Number(match.budget || match.Budget_Amount || 0);
      committed = Number(match.committed || match.Committed_Amount || 0);
      actual = Number(match.actual || match.Actual_Spend || 0);
      variance = Number((budget - actual).toFixed(2));
    }
  }

  if (!pid || (budget === 0 && actual === 0 && execData.summary)) {
    var s = execData.summary || {};
    budget = Number(s.portfolioBudget || 0);
    committed = Number(s.portfolioCommitted || 0);
    actual = Number(s.portfolioActual || 0);
    variance = Number(s.portfolioVariance !== undefined ? s.portfolioVariance : (budget - actual)).toFixed(2);
    variance = Number(variance);
  }

  var overdueCount = (schedData.counts && schedData.counts.overdue !== undefined)
    ? Number(schedData.counts.overdue)
    : (schedData.items || []).filter(function(i) {
        return i.riskLevel === 'OVERDUE' && (!pid || i.projectId === pid);
      }).length;

  var highAlertsCount = (alertData.counts && alertData.counts.high !== undefined)
    ? Number(alertData.counts.high)
    : (alertData.alerts || []).filter(function(a) {
        return a.severity === 'HIGH' && (!pid || String(a.projectId || '').indexOf(pid) !== -1);
      }).length;

  var openEscCount = (escData.counts && escData.counts.open !== undefined)
    ? Number(escData.counts.open)
    : (escData.escalations || []).filter(function(e) {
        return String(e.Status || '').toUpperCase() !== 'RESOLVED' && (!pid || e.Project_ID === pid);
      }).length;

  return {
    totalBudget: Number(budget.toFixed(2)),
    totalCommitted: Number(committed.toFixed(2)),
    totalActual: Number(actual.toFixed(2)),
    budgetVariance: Number(variance.toFixed(2)),
    openEscalations: openEscCount,
    overdueItems: overdueCount,
    highAlerts: highAlertsCount
  };
}

/**
 * Returns saved PMO snapshots visible to the current user along with current
 * baseline metrics for comparison.
 */
function apiGetSnapshotsAndTemplatesData(activeProjectId) {
  var pid = activeProjectId ? String(activeProjectId).trim() : '';
  assertPrivilegedManagementRole_(pid || null);
  var ctx = assertPermission_('Projects', 'view', pid || null);

  var allProjs = (typeof safePhase11Records_ === 'function')
    ? safePhase11Records_(resolvePhase11TabName_('projects'))
    : [];
  var visibleIds = new Set();
  allProjs.forEach(function(p) {
    var k = String(p.Project_ID || '').trim();
    if (k && (ctx.isGlobalViewer || ctx.assignedProjectIds.includes(k))) {
      visibleIds.add(k);
    }
  });

  var rows = readPhase19RowsSafe_().filter(function(r) {
    var rPid = String(r.Project_ID || '').trim();
    if (!rPid || rPid === 'PORTFOLIO') return true;
    return visibleIds.has(rPid);
  }).reverse();

  var current = computePhase19CurrentMetrics_(pid);

  return {
    success: true,
    activeProjectId: pid,
    current: current,
    snapshots: rows.slice(0, 30)
  };
}

/**
 * Captures and persists a point-in-time PMO snapshot in the spreadsheet.
 */
function apiCapturePmoSnapshot(payload, activeProjectId) {
  var p = payload || {};
  var targetPid = String(p.Project_ID || activeProjectId || '').trim();
  assertPrivilegedManagementRole_(targetPid || null);
  var ctx = assertPermission_('Projects', 'edit', targetPid || null);

  // Hold the global mutation lock across metric capture and append so the
  // archived snapshot represents one consistent point in the database.
  var snapshotLock = LockService.getScriptLock();
  snapshotLock.waitLock(30000);
  var record;
  try {
    var sheet = ensurePhase19Sheet_();
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var metrics = computePhase19CurrentMetrics_(targetPid);

    var now = new Date();
    var tz = Session.getScriptTimeZone() || 'UTC';
    var actor = String((ctx && (ctx.userEmail || ctx.email)) || getSafeActiveUserEmail_() || 'system');
    var label = String(p.Label || '').trim() || ('Snapshot ' + Utilities.formatDate(now, tz, 'yyyy-MM-dd HH:mm'));

    record = {
      Snapshot_ID: '',
      Project_ID: targetPid || 'PORTFOLIO',
      Label: label,
      Captured_By: actor,
      Captured_At: now.toISOString(),
      Total_Budget: metrics.totalBudget,
      Total_Committed: metrics.totalCommitted,
      Total_Actual: metrics.totalActual,
      Budget_Variance: metrics.budgetVariance,
      Open_Escalations: metrics.openEscalations,
      Overdue_Items: metrics.overdueItems,
      High_Alerts: metrics.highAlerts,
      Notes: String(p.Notes || '').trim()
    };

    var idPrefix = 'SNP-' + Utilities.formatDate(now, tz, 'yyyyMMdd-HHmmss') + '-';
    var snapshotIdColumn = headers.map(function(h) { return String(h).trim(); }).indexOf('Snapshot_ID') + 1;
    if (snapshotIdColumn < 1) throw new Error('PMO snapshot sheet is missing Snapshot_ID header.');
    var existingIds = [];
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      existingIds = sheet.getRange(2, snapshotIdColumn, lastRow - 1, 1).getValues().map(function(r) {
        return String(r[0] || '').trim();
      });
    }
    var snapshotId;
    do {
      snapshotId = idPrefix + Math.floor(100000 + Math.random() * 900000);
    } while (existingIds.indexOf(snapshotId) !== -1);
    record.Snapshot_ID = snapshotId;

    var rowValues = headers.map(function(h) {
      var key = String(h).trim();
      return record[key] !== undefined ? record[key] : '';
    });
    sheet.appendRow(rowValues);
  } finally {
    snapshotLock.releaseLock();
  }

  if (typeof writeAuditLog_ === 'function') {
    writeAuditLog_(
      ctx,
      'CAPTURE_SNAPSHOT',
      'PMO_Snapshots',
      record.Project_ID,
      null,
      record,
      'Captured PMO snapshot ' + record.Snapshot_ID + ' (' + record.Label + ')'
    );
  }

  return apiGetSnapshotsAndTemplatesData(activeProjectId);
}
function parsePhase20DateSafe_(val) {
  if (!val) return null;
  if (Object.prototype.toString.call(val) === '[object Date]' && !isNaN(val.getTime())) {
    return new Date(val.getFullYear(), val.getMonth(), val.getDate());
  }
  var s = String(val).trim();
  if (!s) return null;
  var d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatPhase20DateIso_(d) {
  if (!d || isNaN(d.getTime())) return '';
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function isPhase20DoneStatus_(statusVal) {
  var s = String(statusVal || '').trim().toLowerCase();
  return ['completed', 'complete', 'done', 'closed', 'approved', 'issued', 'delivered', 'resolved', 'cancelled'].includes(s);
}

/**
 * Returns normalized WBS tasks, milestones, deliverables, and permits for
 * interactive cross-module filtering and drill-down.
 */
function apiGetCrossModuleWorkData(activeProjectId, options) {
  var pid = activeProjectId ? String(activeProjectId).trim() : '';
  assertPrivilegedManagementRole_(pid || null);
  var opts = options || {};
  var lookaheadDays = Math.max(1, Math.min(90, Number(opts.lookaheadDays) || 7));

  var ctx = assertPermission_('Projects', 'view', pid || null);

  var allProjs = (typeof safePhase11Records_ === 'function')
    ? safePhase11Records_(resolvePhase11TabName_('projects'))
    : [];
  var projectMap = {};
  var visibleIds = new Set();

  allProjs.forEach(function(p) {
    var k = String(p.Project_ID || '').trim();
    if (!k) return;
    projectMap[k] = p.Project_Name || k;
    if (ctx.isGlobalViewer || ctx.assignedProjectIds.includes(k)) {
      visibleIds.add(k);
    }
  });

  var now = new Date();
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var cutoff = new Date(today.getTime() + lookaheadDays * 86400000);

  var specs = [
    {
      module: 'Sub_WBS',
      label: 'WBS Task',
      rows: (typeof safePhase15Rows_ === 'function') ? safePhase15Rows_(resolvePhase15TabName_('sub_wbs')) : [],
      idField: 'Sub_WBS_ID',
      titleField: 'Task_Name',
      startFields: ['Planned_Start_Date', 'Start_Date', 'Actual_Start_Date'],
      endFields: ['Planned_Finish_Date', 'Target_End_Date', 'End_Date', 'Finish_Date', 'Due_Date'],
      ownerFields: ['Assigned_To', 'Owner', 'Assignee', 'Lead'],
      progressFields: ['Completion_Pct', 'Progress_Pct', 'Percent_Complete'],
      statusField: 'Status'
    },
    {
      module: 'Milestones',
      label: 'Milestone',
      rows: (typeof safePhase15Rows_ === 'function') ? safePhase15Rows_(resolvePhase15TabName_('milestones')) : [],
      idField: 'Milestone_ID',
      titleField: 'Milestone_Name',
      startFields: ['Baseline_Date', 'Start_Date'],
      endFields: ['Target_Date', 'Due_Date', 'Planned_Date', 'Milestone_Date'],
      ownerFields: ['Owner', 'Lead', 'Assigned_To'],
      progressFields: ['Completion_Pct', 'Progress_Pct'],
      statusField: 'Status'
    },
    {
      module: 'Deliverables',
      label: 'Deliverable',
      rows: (typeof safePhase15Rows_ === 'function') ? safePhase15Rows_(resolvePhase15TabName_('deliverables')) : [],
      idField: 'Deliverable_ID',
      titleField: 'Deliverable_Name',
      startFields: ['Start_Date'],
      endFields: ['Due_Date', 'Target_Date', 'Submission_Date', 'End_Date'],
      ownerFields: ['Owner', 'Assignee', 'Lead'],
      progressFields: ['Completion_Pct', 'Progress_Pct'],
      statusField: 'Status'
    },
    {
      module: 'Permits',
      label: 'Permit',
      rows: (typeof safePhase15Rows_ === 'function') ? safePhase15Rows_(resolvePhase15TabName_('permits')) : [],
      idField: 'Permit_ID',
      titleField: 'Permit_Name',
      startFields: ['Submitted_Date', 'Start_Date'],
      endFields: ['Target_Date', 'Expiry_Date', 'Due_Date', 'Application_Deadline'],
      ownerFields: ['Owner', 'Lead', 'Assigned_To'],
      progressFields: ['Completion_Pct'],
      statusField: 'Status'
    }
  ];

  var items = [];

  specs.forEach(function(sp) {
    sp.rows.forEach(function(r) {
      var rPid = String(r.Project_ID || '').trim();
      if (!rPid || !visibleIds.has(rPid)) return;

      var status = String(r[sp.statusField] || r.Approval_Status || 'In Progress').trim();
      var done = isPhase20DoneStatus_(status);

      var startD = null;
      for (var i = 0; i < sp.startFields.length; i++) {
        startD = parsePhase20DateSafe_(r[sp.startFields[i]]);
        if (startD) break;
      }

      var endD = null;
      for (var j = 0; j < sp.endFields.length; j++) {
        endD = parsePhase20DateSafe_(r[sp.endFields[j]]);
        if (endD) break;
      }

      var owner = '';
      for (var k = 0; k < sp.ownerFields.length; k++) {
        if (r[sp.ownerFields[k]]) {
          owner = String(r[sp.ownerFields[k]]).trim();
          break;
        }
      }

      var pct = 0;
      for (var m = 0; m < sp.progressFields.length; m++) {
        if (r[sp.progressFields[m]] !== undefined && r[sp.progressFields[m]] !== '') {
          pct = Number(r[sp.progressFields[m]]) || 0;
          break;
        }
      }
      if (done && pct === 0) pct = 100;

      var riskState = 'ON_TRACK';
      var daysDelta = null;
      if (done) {
        riskState = 'DONE';
      } else if (endD) {
        daysDelta = Math.round((endD.getTime() - today.getTime()) / 86400000);
        if (endD.getTime() < today.getTime()) {
          riskState = 'OVERDUE';
        } else if (endD.getTime() <= cutoff.getTime()) {
          riskState = 'DUE_SOON';
        }
      }

      var recId = String(r[sp.idField] || '').trim();
      var recTitle = String(r[sp.titleField] || r.Title || r.Description || sp.label).trim();

      items.push({
        module: sp.module,
        label: sp.label,
        projectId: rPid,
        projectName: projectMap[rPid] || rPid,
        recordId: recId,
        title: (recId ? recId + ': ' : '') + recTitle,
        startDate: formatPhase20DateIso_(startD),
        endDate: formatPhase20DateIso_(endD),
        daysDelta: daysDelta,
        owner: owner,
        progressPct: pct,
        status: status,
        riskState: riskState
      });
    });
  });

  return {
    success: true,
    activeProjectId: pid,
    lookaheadDays: lookaheadDays,
    items: items,
    counts: {
      total: items.length,
      overdue: items.filter(function(x) { return x.riskState === 'OVERDUE'; }).length,
      dueSoon: items.filter(function(x) { return x.riskState === 'DUE_SOON'; }).length,
      done: items.filter(function(x) { return x.riskState === 'DONE'; }).length
    }
  };
}

// ============================================================================
// PHASE 21: SYSTEM READINESS & PRODUCTION CUTOVER DIAGNOSTICS
// ============================================================================

/**
 * Checks spreadsheet accessibility, core & extended PMO tab availability,
 * and current user governance context for production cutover verification.
 */
function apiGetSystemReadinessStatus(activeProjectId) {
  var pid = activeProjectId ? String(activeProjectId).trim() : '';
  assertPrivilegedManagementRole_(pid || null);
  var ctx = assertPermission_('Projects', 'view', pid || null);

  var ss = getMasterSpreadsheet_();
  var spreadsheetName = '';
  var spreadsheetId = '';
  var existingSheetSet = new Set();

  if (ss) {
    spreadsheetName = ss.getName ? ss.getName() : 'Connected Spreadsheet';
    spreadsheetId = ss.getId ? ss.getId() : '';
    var sheets = ss.getSheets ? ss.getSheets() : [];
    sheets.forEach(function(sh) {
      if (sh && sh.getName) {
        existingSheetSet.add(String(sh.getName()).trim());
      }
    });
  }

  var requiredOrRecommendedTabs = [
    { key: 'Projects', label: 'Projects Register', critical: true },
    { key: 'Sub_WBS', label: 'Sub-WBS / Tasks', critical: true },
    { key: 'Team_Workload', label: 'Team Workload', critical: true },
    { key: 'Procurement_Logistics', label: 'Procurement & Logistics', critical: false },
    { key: 'Financial_Monitoring', label: 'Financial Monitoring', critical: false },
    { key: 'Audit_Logs', label: 'Audit Trail Logs', critical: true },
    { key: 'Escalations', label: 'Exception Escalations (Phase 18)', critical: false },
    { key: 'PMO_Snapshots', label: 'Snapshot Archive (Phase 19)', critical: false }
  ];

  var tabChecks = requiredOrRecommendedTabs.map(function(item) {
    var resolved = item.key;
    if (typeof DB_CONFIG !== 'undefined' && DB_CONFIG.TABS) {
      if (item.key === 'Projects' && DB_CONFIG.TABS.PROJECTS) resolved = DB_CONFIG.TABS.PROJECTS;
      if (item.key === 'Sub_WBS' && DB_CONFIG.TABS.SUB_WBS) resolved = DB_CONFIG.TABS.SUB_WBS;
      if (item.key === 'Team_Workload' && DB_CONFIG.TABS.TEAM_WORKLOAD) resolved = DB_CONFIG.TABS.TEAM_WORKLOAD;
      if (item.key === 'Procurement_Logistics' && (DB_CONFIG.TABS.PROCUREMENT || DB_CONFIG.TABS.PROCUREMENT_LOGISTICS)) {
        resolved = DB_CONFIG.TABS.PROCUREMENT || DB_CONFIG.TABS.PROCUREMENT_LOGISTICS;
      }
      if (item.key === 'Financial_Monitoring' && (DB_CONFIG.TABS.FINANCIALS || DB_CONFIG.TABS.FINANCIAL_MONITORING)) {
        resolved = DB_CONFIG.TABS.FINANCIALS || DB_CONFIG.TABS.FINANCIAL_MONITORING;
      }
      if (item.key === 'Audit_Logs' && DB_CONFIG.TABS.AUDIT_LOGS) resolved = DB_CONFIG.TABS.AUDIT_LOGS;
      if (item.key === 'Escalations' && (DB_CONFIG.TABS.ESCALATIONS || DB_CONFIG.TABS.EXCEPTION_ESCALATIONS)) {
        resolved = DB_CONFIG.TABS.ESCALATIONS || DB_CONFIG.TABS.EXCEPTION_ESCALATIONS;
      }
      if (item.key === 'PMO_Snapshots' && (DB_CONFIG.TABS.PMO_SNAPSHOTS || DB_CONFIG.TABS.SNAPSHOTS)) {
        resolved = DB_CONFIG.TABS.PMO_SNAPSHOTS || DB_CONFIG.TABS.SNAPSHOTS;
      }
    }

    var present = existingSheetSet.has(resolved);
    return {
      key: item.key,
      tabName: resolved,
      label: item.label,
      critical: item.critical,
      present: present
    };
  });

  var missingCritical = tabChecks.filter(function(t) {
    return t.critical && !t.present;
  }).length;

  var triggerCount = 0;
  try {
    triggerCount = ScriptApp.getProjectTriggers().length;
  } catch (e) {
    triggerCount = 0;
  }

  return {
    success: true,
    spreadsheetName: spreadsheetName,
    spreadsheetId: spreadsheetId,
    userEmail: String((ctx && (ctx.userEmail || ctx.email)) || getSafeActiveUserEmail_() || 'Unknown'),
    role: String((ctx && (ctx.role || ctx.userRole)) || 'Standard'),
    isGlobalViewer: Boolean(ctx && ctx.isGlobalViewer),
    assignedProjectsCount: (ctx && ctx.assignedProjectIds) ? ctx.assignedProjectIds.length : 0,
    totalSheetsInWorkbook: existingSheetSet.size,
    activeProjectTriggers: triggerCount,
    missingCriticalTabs: missingCritical,
    tabChecks: tabChecks
  };
}

// ============================================================================
// QA SMOKE-TEST RUNNER (BACKEND APIS + SERVER-SIDE INDEX.HTML AUDIT)
// ============================================================================

/**
 * Runs non-destructive checks across core helpers, Phases 16–21 APIs,
 * and expected wiring inside the 'index' (Index.html) HTML file.
 */
function runPmoSystemQaChecks_(testProjectId) {
  var pid = testProjectId ? String(testProjectId).trim() : '';
  var results = [];

  function check(name, fn) {
    try {
      var out = fn();
      results.push({ test: name, status: 'PASS', detail: out || 'OK' });
    } catch (e) {
      results.push({
        test: name,
        status: 'FAIL',
        detail: (e && e.message) ? e.message : String(e)
      });
    }
  }

  // 0. Server-side index.html file & symbol/API wiring audit
  check('HTML file: Index.html loads & contains Phase 13-21 wiring', function() {
    var htmlContent = HtmlService.createHtmlOutputFromFile('index').getContent();
    if (!htmlContent || htmlContent.length < 500) {
      throw new Error('Index.html appears empty or truncated');
    }

    var requiredTokens = [
      'injectPhase13HeaderButtons_',
      'openExecutiveDashboardModal',
      'openGovernanceAdminModal',
      'openAlertsModal',
      'openScheduleRiskModal',
      'openPmoDigestModal',
      'openDigestScheduleModal',
      'openEscalationsModal',
      'openSnapshotsAndTemplatesModal',
      'openCrossWorkModal',
      'openCutoverReadinessModal',
      'apiBuildUnifiedPmoDigest',
      'apiDispatchPmoDigestEmail',
      'apiGetDigestTriggerStatus',
      'apiSaveDigestTriggerConfig',
      'apiGetEscalationsData',
      'apiUpsertEscalationItem',
      'apiGetSnapshotsAndTemplatesData',
      'apiCapturePmoSnapshot',
      'apiGetCrossModuleWorkData',
      'apiGetSystemReadinessStatus',
      'pmo-digest-modal',
      'digest-schedule-modal',
      'pmo-escalations-modal',
      'snapshots-templates-modal',
      'cross-work-modal',
      'cutover-readiness-modal'
    ];

    var missing = requiredTokens.filter(function(tok) {
      return htmlContent.indexOf(tok) === -1;
    });

    if (missing.length) {
      throw new Error('Missing tokens in Index.html: ' + missing.join(', '));
    }

    var launcherCount = (htmlContent.match(/injectPhase13HeaderButtons_/g) || []).length;
    return 'Loaded (' + htmlContent.length + ' chars) | All ' + requiredTokens.length +
      ' UI/API tokens found | injectPhase13HeaderButtons_ refs: ' + launcherCount;
  });

  // 1. Core helpers
  check('Core helper: getMasterSpreadsheet_', function() {
    if (typeof getMasterSpreadsheet_ !== 'function') throw new Error('getMasterSpreadsheet_ is not defined');
    var ss = getMasterSpreadsheet_();
    if (!ss) throw new Error('getMasterSpreadsheet_() returned null/undefined');
    return 'Connected to: ' + (ss.getName ? ss.getName() : 'Spreadsheet');
  });

  check('Core helper: assertPermission_', function() {
    if (typeof assertPermission_ !== 'function') throw new Error('assertPermission_ is not defined');
    var ctx = assertPermission_('Projects', 'view', pid || null);
    var email = (ctx && (ctx.userEmail || ctx.email)) || 'unknown';
    return 'Context OK for ' + email;
  });

  // 2. Phase 16: Unified PMO Digest
  check('Phase 16: apiBuildUnifiedPmoDigest', function() {
    if (typeof apiBuildUnifiedPmoDigest !== 'function') throw new Error('apiBuildUnifiedPmoDigest is not defined');
    var res = apiBuildUnifiedPmoDigest(pid, { maxAllocPct: 100, budgetWarnPct: 85, lookaheadDays: 7 });
    if (!res || !res.success) throw new Error('Returned unsuccessful response');
    return 'Digest built (chars: ' + (res.digestText ? res.digestText.length : 0) + ')';
  });

  // 3. Phase 17: Digest Trigger Status & History
  check('Phase 17: apiGetDigestTriggerStatus', function() {
    if (typeof apiGetDigestTriggerStatus !== 'function') throw new Error('apiGetDigestTriggerStatus is not defined');
    var res = apiGetDigestTriggerStatus(pid);
    if (!res || !res.success) throw new Error('Returned unsuccessful response');
    return 'Active triggers: ' + res.activeTriggerCount + ' | History rows: ' + (res.history ? res.history.length : 0);
  });

  // 4. Phase 18: Escalations Read
  check('Phase 18: apiGetEscalationsData', function() {
    if (typeof apiGetEscalationsData !== 'function') throw new Error('apiGetEscalationsData is not defined');
    var res = apiGetEscalationsData(pid);
    if (!res || !res.success) throw new Error('Returned unsuccessful response');
    return 'Escalations: ' + (res.counts ? res.counts.total : 0) + ' | Suggestions: ' + (res.counts ? res.counts.suggested : 0);
  });

  // 5. Phase 19: Snapshots & Templates Read
  check('Phase 19: apiGetSnapshotsAndTemplatesData', function() {
    if (typeof apiGetSnapshotsAndTemplatesData !== 'function') throw new Error('apiGetSnapshotsAndTemplatesData is not defined');
    var res = apiGetSnapshotsAndTemplatesData(pid);
    if (!res || !res.success) throw new Error('Returned unsuccessful response');
    return 'Snapshots: ' + (res.snapshots ? res.snapshots.length : 0);
  });

  // 6. Phase 20: Cross-Module Work Inspector
  check('Phase 20: apiGetCrossModuleWorkData', function() {
    if (typeof apiGetCrossModuleWorkData !== 'function') throw new Error('apiGetCrossModuleWorkData is not defined');
    var res = apiGetCrossModuleWorkData(pid, { lookaheadDays: 7 });
    if (!res || !res.success) throw new Error('Returned unsuccessful response');
    return 'Work items: ' + (res.counts ? res.counts.total : 0);
  });

  // 7. Phase 21: System Readiness Diagnostics
  check('Phase 21: apiGetSystemReadinessStatus', function() {
    if (typeof apiGetSystemReadinessStatus !== 'function') throw new Error('apiGetSystemReadinessStatus is not defined');
    var res = apiGetSystemReadinessStatus(pid);
    if (!res || !res.success) throw new Error('Returned unsuccessful response');
    return 'Missing critical tabs: ' + res.missingCriticalTabs + ' | Sheets: ' + res.totalSheetsInWorkbook;
  });

  var passCount = results.filter(function(r) { return r.status === 'PASS'; }).length;
  var failCount = results.filter(function(r) { return r.status === 'FAIL'; }).length;

  Logger.log('=== PMO QA SUMMARY: ' + passCount + ' PASS, ' + failCount + ' FAIL ===');
  results.forEach(function(r) {
    Logger.log('[' + r.status + '] ' + r.test + ' -> ' + r.detail);
  });

  return {
    passed: passCount,
    failed: failCount,
    results: results
  };
}

function getSafeProjectTriggers_() {
  try {
    if (typeof ScriptApp !== 'undefined' && ScriptApp.getProjectTriggers) {
      return ScriptApp.getProjectTriggers() || [];
    }
  } catch (e) {
    Logger.log('getSafeProjectTriggers_ warning: ' + (e && e.message ? e.message : e));
  }
  return [];
}

function getSafeActiveUserEmail_() {
  try {
    if (typeof Session !== 'undefined' && Session.getActiveUser) {
      var activeEmail = Session.getActiveUser().getEmail();
      if (activeEmail) return String(activeEmail).trim();
    }
  } catch (e) {}

  try {
    if (typeof Session !== 'undefined' && Session.getEffectiveUser) {
      var effectiveEmail = Session.getEffectiveUser().getEmail();
      if (effectiveEmail) return String(effectiveEmail).trim();
    }
  } catch (e2) {}

  return 'unknown';
}

// ========================================================================
// PHASE 22: CLIENT PRESENTATION GENERATOR & EXTERNAL DECK API
// ========================================================================

const CLIENT_DECKS_SHEET_ = 'Client_Presentations';
const CLIENT_DECKS_HEADERS_ = [
  'Deck_ID', 'Project_ID', 'Deck_Title', 'Focus_Scope', 'Selected_WBS_JSON',
  'Audience_Tone', 'Custom_Prompt', 'Deck_JSON', 'Share_Token',
  'Created_By', 'Created_At', 'Updated_At', 'Status'
];

function ensureClientPresentationsSheet_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = getMasterSpreadsheet_();
    let sh = ss.getSheetByName(CLIENT_DECKS_SHEET_);
    if (!sh) {
      sh = ss.insertSheet(CLIENT_DECKS_SHEET_);
      sh.getRange(1, 1, 1, CLIENT_DECKS_HEADERS_.length).setValues([CLIENT_DECKS_HEADERS_]);
      sh.setFrozenRows(1);
    } else if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, CLIENT_DECKS_HEADERS_.length).setValues([CLIENT_DECKS_HEADERS_]);
      sh.setFrozenRows(1);
    }
    return sh;
  } finally {
    lock.releaseLock();
  }
}
function readSheetObjectsSafe_(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(sheetName);
  if (!sh || sh.getLastRow() < 2) return [];
  const data = sh.getDataRange().getValues();
  const headers = data[0].map(h => String(h || '').trim());
  return data.slice(1).map((row, idx) => {
    const obj = { _rowIndex: idx + 2 };
    headers.forEach((h, i) => {
      if (!h) return;
      const val = row[i];
      obj[h] = val instanceof Date
        ? Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd')
        : val;
    });
    return obj;
  });
}

function getCurrentActorEmailSafe_() {
  try {
    return Session.getEffectiveUser().getEmail() || 'pmo-user@system';
  } catch (e) {
    return 'pmo-user@system';
  }
}

function buildClientDeckUrl_(shareToken) {
  const props = PropertiesService.getScriptProperties();
  const customBase = String(props.getProperty('PRESENTATION_SITE_URL') || '').trim();
  const baseUrl = customBase || ScriptApp.getService().getUrl();
  const sep = baseUrl.indexOf('?') > -1 ? '&' : '?';
  return `${baseUrl}${sep}page=deck&token=${encodeURIComponent(shareToken)}`;
}

/**
 * Returns WBS options, registry counts, and published decks for a project.
 */
function apiGetPresentationScopeOptions(projectId) {
  if (!projectId) throw new Error('Project ID is required.');
  const pid = String(projectId).trim();
  assertPrivilegedManagementRole_(pid || null);
  assertPermission_('Projects', 'view', pid);
  ensureClientPresentationsSheet_();
  const mainWbs = readSheetObjectsSafe_('Main_WBS').filter(r => String(r.Project_ID) === pid);
  const subWbs = readSheetObjectsSafe_('Sub_WBS').filter(r => String(r.Project_ID) === pid);
  const permits = readSheetObjectsSafe_('Permits').filter(r => String(r.Project_ID) === pid);
  const milestones = readSheetObjectsSafe_('Milestones').filter(r => String(r.Project_ID) === pid);
  const deliverables = readSheetObjectsSafe_('Deliverables').filter(r => String(r.Project_ID) === pid);
  const risks = readSheetObjectsSafe_('Risks').filter(r => String(r.Project_ID) === pid);

  const decks = readSheetObjectsSafe_(CLIENT_DECKS_SHEET_)
    .filter(d => String(d.Project_ID) === pid && String(d.Status || 'PUBLISHED') !== 'ARCHIVED')
    .reverse()
    .map(d => ({
      deckId: d.Deck_ID,
      deckTitle: d.Deck_Title,
      focusScope: d.Focus_Scope,
      audienceTone: d.Audience_Tone,
      shareToken: d.Share_Token,
      shareUrl: buildClientDeckUrl_(d.Share_Token),
      createdAt: d.Created_At,
      createdBy: d.Created_By
    }));

  return {
    success: true,
    mainWbs: mainWbs.map(m => ({
      id: m.Main_WBS_ID,
      name: m.Module_Name,
      status: m.Status || '',
      progress: Number(m.Actual_Progress) || 0
    })),
    subWbs: subWbs.map(s => ({
      id: s.Sub_WBS_ID,
      parentId: s.Parent_Main_WBS_ID,
      name: s.Task_Name,
      status: s.Status || '',
      progress: Number(s.Actual_Progress) || 0
    })),
    counts: {
      permits: permits.length,
      milestones: milestones.length,
      deliverables: deliverables.length,
      risks: risks.length
    },
    decks: decks
  };
}

/**
 * Gathers scoped project data, calls Gemini to structure slides, and stores a token snapshot.
 */
function apiGenerateClientPresentation(config) {
  const cfg = config || {};
  const pid = String(cfg.projectId || '').trim();
  if (!pid) throw new Error('Please select a project workspace first.');

  const focusScope = String(cfg.focusScope || 'OVERALL').toUpperCase();
  if (['OVERALL', 'WBS', 'PERMITTING', 'MILESTONES_DELIVERABLES', 'CUSTOM'].indexOf(focusScope) === -1) throw new Error('Unsupported presentation scope.');
  const selectedWbsIds = Array.isArray(cfg.wbsIds) ? cfg.wbsIds.map(String).slice(0, 200) : [];
  const allowedCustomModules = ['WBS', 'PERMITS', 'MILESTONES', 'DELIVERABLES', 'RISKS'];
  const customModules = Array.isArray(cfg.customModules) ? cfg.customModules.filter(m => allowedCustomModules.indexOf(String(m).toUpperCase()) !== -1) : [];
  const audienceTone = String(cfg.audienceTone || 'Executive Steering Committee');
  const customPrompt = String(cfg.customPrompt || '').trim();
  assertPrivilegedManagementRole_(pid);
  const ctx = assertPermission_('Projects', 'edit', pid);
  if (customPrompt.length > 4000 || String(cfg.deckTitle || '').length > 200) throw new Error('Presentation title or instructions exceed the allowed length.');

  const projects = readSheetObjectsSafe_('Projects');
  const project = projects.find(p => String(p.Project_ID) === pid);
  if (!project) throw new Error('Project not found: ' + pid);

  const mainWbs = readSheetObjectsSafe_('Main_WBS').filter(r => String(r.Project_ID) === pid);
  const subWbs = readSheetObjectsSafe_('Sub_WBS').filter(r => String(r.Project_ID) === pid);
  const activities = readSheetObjectsSafe_('Activities_Schedule').filter(r => String(r.Project_ID) === pid);
  const permits = readSheetObjectsSafe_('Permits').filter(r => String(r.Project_ID) === pid);
  const milestones = readSheetObjectsSafe_('Milestones').filter(r => String(r.Project_ID) === pid);
  const deliverables = readSheetObjectsSafe_('Deliverables').filter(r => String(r.Project_ID) === pid);
  const risks = readSheetObjectsSafe_('Risks').filter(r => String(r.Project_ID) === pid);
  const issues = readSheetObjectsSafe_('Issues').filter(r => String(r.Project_ID) === pid);

  const validWbsIds = new Set();
  mainWbs.forEach(r => validWbsIds.add(String(r.Main_WBS_ID || '')));
  subWbs.forEach(r => validWbsIds.add(String(r.Sub_WBS_ID || '')));
  if (selectedWbsIds.some(id => !validWbsIds.has(String(id)))) throw new Error('One or more selected WBS records do not belong to this project.');
  const matchesWbs = (mainId, subId) => {
    if (!selectedWbsIds.length) return true;
    return selectedWbsIds.includes(String(mainId || '')) || selectedWbsIds.includes(String(subId || ''));
  };

  const factPacket = {
    project: {
      id: project.Project_ID,
      name: project.Project_Name,
      client: project.Client,
      location: project.Project_Location,
      status: project.Project_Status,
      health: project.Project_Health,
      plannedProgressPct: Number(project.Overall_Planned_Progress) || 0,
      actualProgressPct: Number(project.Overall_Actual_Progress) || 0,
      contractStart: project.Contract_Start_Date || '',
      contractFinish: project.Contract_Completion_Date || '',
      forecastFinish: project.Forecast_Completion_Date || ''
    },
    focusScope: focusScope
  };

  if (focusScope === 'OVERALL') {
    factPacket.wbsSummary = mainWbs.map(m => ({
      id: m.Main_WBS_ID,
      name: m.Module_Name,
      weight: m.WBS_Weight,
      plannedPct: m.Planned_Progress || 0,
      actualPct: m.Actual_Progress || 0,
      status: m.Status,
      baselineFinish: m.Baseline_Finish_Date
    }));
    factPacket.milestones = milestones.slice(0, 12);
    factPacket.deliverablesSummary = {
      total: deliverables.length,
      approved: deliverables.filter(d => String(d.Approval_Status).includes('Approved')).length,
      pending: deliverables.filter(d => !String(d.Approval_Status).includes('Approved')).length
    };
    factPacket.permitsSummary = {
      total: permits.length,
      issuedOrApproved: permits.filter(p => ['Approved', 'Issued'].includes(String(p.Permit_Status))).length,
      inProgress: permits.filter(p => !['Approved', 'Issued'].includes(String(p.Permit_Status))).length
    };
    factPacket.topRisks = risks.filter(r => String(r.Current_Status) !== 'Closed').slice(0, 6);
    factPacket.openIssues = issues.filter(i => !['Resolved', 'Closed'].includes(String(i.Issue_Status))).slice(0, 6);
  } else if (focusScope === 'WBS') {
    factPacket.selectedMainWbs = mainWbs.filter(m => matchesWbs(m.Main_WBS_ID, ''));
    factPacket.selectedSubWbs = subWbs.filter(s => matchesWbs(s.Parent_Main_WBS_ID, s.Sub_WBS_ID));
    factPacket.activities = activities.filter(a => matchesWbs(a.Main_WBS_ID, a.Sub_WBS_ID)).slice(0, 30);
    factPacket.deliverables = deliverables.filter(d => matchesWbs(d.Main_WBS_ID, d.Sub_WBS_ID));
    factPacket.milestones = milestones.filter(m => matchesWbs(m.Main_WBS_ID, m.Sub_WBS_ID));
    factPacket.risks = risks.filter(r => matchesWbs(r.Related_Main_WBS_ID, r.Related_Sub_WBS_ID));
  } else if (focusScope === 'PERMITTING') {
    factPacket.permits = permits.map(p => ({
      id: p.Permit_ID,
      name: p.Permit_Name,
      category: p.Permit_Category,
      agency: p.Government_Agency,
      status: p.Permit_Status,
      submissionDate: p.Submission_Date,
      expectedApproval: p.Expected_Approval_Date,
      actualApproval: p.Actual_Approval_Date,
      expirationDate: p.Expiration_Date,
      pendingRequirements: p.Pending_Requirements,
      relatedWbs: p.Related_Main_WBS_ID
    }));
  } else if (focusScope === 'MILESTONES_DELIVERABLES') {
    factPacket.milestones = milestones;
    factPacket.deliverables = deliverables;
  } else {
    if (customModules.includes('WBS')) {
      factPacket.selectedMainWbs = mainWbs.filter(m => matchesWbs(m.Main_WBS_ID, ''));
      factPacket.selectedSubWbs = subWbs.filter(s => matchesWbs(s.Parent_Main_WBS_ID, s.Sub_WBS_ID));
      factPacket.activities = activities.filter(a => matchesWbs(a.Main_WBS_ID, a.Sub_WBS_ID)).slice(0, 25);
    }
    if (customModules.includes('PERMITS')) factPacket.permits = permits;
    if (customModules.includes('MILESTONES')) factPacket.milestones = milestones;
    if (customModules.includes('DELIVERABLES')) factPacket.deliverables = deliverables;
    if (customModules.includes('RISKS')) {
      factPacket.risks = risks.filter(r => String(r.Current_Status) !== 'Closed');
      factPacket.issues = issues.filter(i => !['Resolved', 'Closed'].includes(String(i.Issue_Status)));
    }
  }

  const aiDeck = generateAiSlideDeckWithGemini_(factPacket, audienceTone, customPrompt);
  const deckTitle = String(cfg.deckTitle || aiDeck.deckTitle || `${project.Project_Name} — Client Status Update`).trim();

  const sh = ensureClientPresentationsSheet_();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  let deckId;
  const shareToken = Utilities.getUuid().replace(/-/g, '');
  const nowIso = new Date().toISOString();
  const actor = ctx.user.email;

  const fullDeckPayload = {
    deckId: '',
    deckTitle: deckTitle,
    subtitle: aiDeck.subtitle || `${project.Client || 'Client'} | ${focusScope} Briefing`,
    project: factPacket.project,
    focusScope: focusScope,
    audienceTone: audienceTone,
    generatedAt: nowIso,
    executiveSummary: aiDeck.executiveSummary || '',
    slides: aiDeck.slides || [],
    rawMetrics: factPacket
  };

  try {
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim());
    const idIndex = headers.indexOf('Deck_ID');
    if (idIndex < 0) throw new Error('Client presentations sheet is missing Deck_ID header.');
    const lastRow = sh.getLastRow();
    const existingIds = lastRow > 1 ? sh.getRange(2, idIndex + 1, lastRow - 1, 1).getValues().map(row => String(row[0] || '').trim()) : [];
    const baseId = 'DECK-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
    deckId = baseId;
    var suffix = 0;
    while (existingIds.indexOf(deckId) !== -1) {
      suffix++;
      deckId = baseId + '-' + String(suffix).padStart(3, '0');
    }
    fullDeckPayload.deckId = deckId;
    insertRecord_(CLIENT_DECKS_SHEET_, {
      Deck_ID: deckId,
      Project_ID: pid,
      Deck_Title: deckTitle,
      Focus_Scope: focusScope,
      Selected_WBS_JSON: JSON.stringify(selectedWbsIds),
      Audience_Tone: audienceTone,
      Custom_Prompt: customPrompt,
      Deck_JSON: JSON.stringify(fullDeckPayload),
      Share_Token: shareToken,
      Created_By: actor,
      Created_At: nowIso,
      Updated_At: nowIso,
      Status: 'PUBLISHED'
    });
  } finally {
    lock.releaseLock();
  }

  return {
    success: true,
    deckId: deckId,
    shareToken: shareToken,
    shareUrl: buildClientDeckUrl_(shareToken),
    deck: fullDeckPayload
  };
}

function generateAiSlideDeckWithGemini_(factPacket, audienceTone, customPrompt) {
  const apiKey = String(PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || '').trim();
  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY in Apps Script Project Settings > Script Properties.');
  }

  const prompt = [
    'You are an executive PMO presentation architect creating a client-facing slide deck.',
    'Use ONLY the verified project metrics provided below. Never invent dates, percentages, or permit statuses.',
    `Target Audience & Tone: ${audienceTone}`,
    customPrompt ? `Special Focus Instructions: ${customPrompt}` : '',
    '',
    'Return ONLY valid JSON (no markdown fences) matching this exact schema:',
    '{',
    '  "deckTitle": "Clear client-facing presentation title",',
    '  "subtitle": "Concise subtitle with project & reporting focus",',
    '  "executiveSummary": "2-3 sentence executive synthesis",',
    '  "slides": [',
    '    {',
    '      "slideNumber": 1,',
    '      "layout": "kpi_summary | wbs_progress | permit_status | milestone_tracker | risk_mitigation | next_steps",',
    '      "title": "Action-oriented slide title",',
    '      "headlineTakeaway": "Single key takeaway sentence for the client",',
    '      "metrics": [{"label": "Metric Name", "value": "Metric Value"}],',
    '      "bullets": ["Concise client-ready bullet point 1", "Concise bullet point 2"],',
    '      "speakerNotes": "Talking points for the presenter"',
    '    }',
    '  ]',
    '}',
    '',
    'Create 4 to 7 well-structured slides tailored to the focusScope in the data.',
    'Verified Project Data JSON:',
    JSON.stringify(factPacket)
  ].filter(Boolean).join('\n');

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + encodeURIComponent(apiKey);
  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    payload: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        responseMimeType: 'application/json'
      }
    })
  });

  const code = resp.getResponseCode();
  const body = JSON.parse(resp.getContentText() || '{}');
  if (code >= 300) {
    const msg = (body.error && body.error.message) ? body.error.message : ('HTTP ' + code);
    throw new Error('Gemini API error: ' + msg);
  }

  const rawText = (((body.candidates || [])[0] || {}).content || {}).parts?.[0]?.text || '{}';
  return JSON.parse(rawText);
}

/**
 * Retrieves a published client presentation snapshot by Share_Token.
 */
function apiGetPublishedClientDeckByToken(token) {
  const cleanToken = String(token || '').trim();
  if (!/^[a-f0-9]{32}$/i.test(cleanToken)) return { success: false, error: 'Invalid presentation token.' };

  const decks = readSheetObjectsSafe_(CLIENT_DECKS_SHEET_);
  const found = decks.find(d => String(d.Share_Token) === cleanToken && String(d.Status || 'PUBLISHED') === 'PUBLISHED');
  if (!found) return { success: false, error: 'Presentation not found or link has been archived.' };

  return {
    success: true,
    deck: JSON.parse(found.Deck_JSON || '{}')
  };
}

function testAuthorizeExternalRequest_() {
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || '';
  Logger.log('GEMINI_API_KEY present: ' + Boolean(key));
  UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models', {
    muteHttpExceptions: true
  });
}


function apiGetUsersList() {
  const ctx = assertPermission_('Users_Admin', 'view', null);
  ensureHybridAuthTables_();
  const passwordUserIds = new Set((getTableRecords_(DB_CONFIG.TABS.AUTH_CREDENTIALS) || []).filter(r => isTruthySheetFlag_(r.Is_Active)).map(r => String(r.User_ID)));
  const assignmentRows = getTableRecords_(DB_CONFIG.TABS.PROJECT_ASSIGNMENTS) || [];
  const assignedByUser = {};
  assignmentRows.forEach(function (a) {
    const statusActive = a.Assignment_Status !== undefined && a.Assignment_Status !== '' ? !['inactive','revoked','removed','false','0'].includes(String(a.Assignment_Status).trim().toLowerCase()) : true;
    const flagActive = a.Is_Active === undefined || a.Is_Active === '' ? true : isTruthySheetFlag_(a.Is_Active);
    if (!statusActive || !flagActive || !a.Project_ID) return;
    const key = String(a.User_ID || '').trim();
    if (!key) return;
    if (!assignedByUser[key]) assignedByUser[key] = [];
    const pid = String(a.Project_ID).trim();
    if (assignedByUser[key].indexOf(pid) === -1) assignedByUser[key].push(pid);
  });
  const users = getTableRecords_(DB_CONFIG.TABS.USERS).map(u => ({
    User_ID: u.User_ID || '', Email: u.Email || '', Full_Name: u.Full_Name || '',
    Role_Name: u.Role_Name || '', Position: u.Position || '',
    Department: u.Department || '', Department_Or_Team: u.Department_Or_Team || '',
    Assigned_Project_IDs: assignedByUser[String(u.User_ID || '').trim()] || [], Has_Password_Login: passwordUserIds.has(String(u.User_ID)),
    Is_Active: u.Is_Active, Created_At: u.Created_At || '', Updated_At: u.Updated_At || ''
  }));
  return { success: true, users: users, actor: ctx.user.email };
}

/**
 * Filters workscope/project rows for non-admin users when no separate
 * assignment table exists.
 *
 * @param {Array<Object>} rows - Workscope/project records.
 * @param {Object} ctx - User context from getCurrentUserContext_().
 * @param {Object} [opts]
 * @param {boolean} [opts.allowAllAuthenticatedRead=false] - True for Option 1; false for Option 2.
 * @param {Array<string>} [opts.matchFields] - Columns to check against user email/name for Option 2.
 */
function resolveWorkscopeRowsForUser_(rows, ctx, opts) {
  const list = Array.isArray(rows) ? rows : [];
  const options = Object.assign({
    allowAllAuthenticatedRead: false,
    matchFields: ['Email', 'Owner_Email', 'Assigned_Email', 'Owner', 'Lead', 'Assigned_To']
  }, opts || {});

  if (!ctx || !ctx.authenticated) return [];

  const roleUpper = String(ctx.role || '').toUpperCase();
  const isAdmin = roleUpper === 'ADMIN' || roleUpper === 'ADMINISTRATOR' || Boolean(ctx.isAdmin);
  if (isAdmin || ctx.isGlobalViewer || options.allowAllAuthenticatedRead) {
    return list;
  }

  const email = String(ctx.email || '').trim().toLowerCase();
  const fullName = String((ctx.user && ctx.user.fullName) || ctx.fullName || '').trim().toLowerCase();

  return list.filter(function (row) {
    if (!row) return false;
    return options.matchFields.some(function (field) {
      const val = String(row[field] || '').trim().toLowerCase();
      if (!val) return false;
      return (email && val.indexOf(email) !== -1) || (fullName && val === fullName);
    });
  });
}

// ============================================================================
// DATABASE TRANSFER + PROJECT REPORT EXPORT SUPPORT
// ============================================================================
function assertDatabaseTransferAdmin_() {
  var ctx = getCurrentUserContext_();
  if (!ctx || !ctx.authenticated || !ctx.isAdmin) throw new Error('Database import/export is restricted to Administrators.');
  return ctx;
}

/**
 * Destructively resets operational project data while preserving identity,
 * authentication, permissions, system configuration, and audit history.
 * A complete spreadsheet copy is created before any row is cleared.
 */
function apiStartFreshDatabase(confirmationText) {
  var ctx = assertDatabaseTransferAdmin_();
  if (String(confirmationText || '').trim() !== 'START FRESH') {
    throw new Error('Confirmation text must be exactly START FRESH. No data was changed.');
  }

  // Deliberate allowlist: never clear user/authentication/security/configuration tabs.
  var resetTabs = [
    DB_CONFIG.TABS.PROJECT_ASSIGNMENTS,
    DB_CONFIG.TABS.PROJECTS,
    DB_CONFIG.TABS.MAIN_WBS,
    DB_CONFIG.TABS.SUB_WBS,
    DB_CONFIG.TABS.ACTIVITIES,
    DB_CONFIG.TABS.DEPENDENCIES,
    DB_CONFIG.TABS.BASELINES,
    DB_CONFIG.TABS.PROGRESS_UPDATES,
    DB_CONFIG.TABS.MILESTONES,
    DB_CONFIG.TABS.DELIVERABLES,
    DB_CONFIG.TABS.PERMITS,
    DB_CONFIG.TABS.RISKS,
    DB_CONFIG.TABS.ISSUES,
    DB_CONFIG.TABS.REPOSITORY,
    DB_CONFIG.TABS.WEEKLY_REPORTS,
    DB_CONFIG.TABS.TEAM_WORKLOAD,
    DB_CONFIG.TABS.APPROVALS,
    DB_CONFIG.TABS.PROCUREMENT,
    DB_CONFIG.TABS.FINANCIAL
  ];

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = getMasterSpreadsheet_();
    var plan = resetTabs.map(function(name) {
      var sheet = ss.getSheetByName(name);
      if (!sheet) throw new Error('Required database tab is missing: ' + name + '. No reset was applied.');
      var lastCol = sheet.getLastColumn();
      if (lastCol < 1) throw new Error('Database tab has no header row: ' + name + '. No reset was applied.');
      var headers = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
      if (!headers.some(function(h) { return String(h).trim() !== ''; })) {
        throw new Error('Database tab has an empty header row: ' + name + '. No reset was applied.');
      }
      return { name: name, sheet: sheet, lastRow: sheet.getLastRow(), lastCol: lastCol };
    });

    // Backup must succeed before the first destructive operation.
    var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
    var backup = DriveApp.getFileById(getMasterSpreadsheetId_()).makeCopy('PMO_PRE_START_FRESH_BACKUP_' + stamp);
    var cleared = [];
    var totalRows = 0;
    plan.forEach(function(item) {
      var rowCount = Math.max(0, item.lastRow - 1);
      if (rowCount > 0) {
        var dataRange = item.sheet.getRange(2, 1, rowCount, item.lastCol);
        var formulas = dataRange.getFormulas();
        dataRange.clearContent();
        // Preserve any calculated columns while removing stored operational values.
        var hasFormula = formulas.some(function(row) { return row.some(function(f) { return Boolean(f); }); });
        if (hasFormula) dataRange.setFormulas(formulas);
        totalRows += rowCount;
      }
      cleared.push({ tab: item.name, rows: rowCount });
      if (typeof invalidateTableCache_ === 'function') invalidateTableCache_(item.name);
    });

    if (typeof writeAuditLog_ === 'function') {
      writeAuditLog_(ctx, 'DATABASE_START_FRESH', 'Database', getMasterSpreadsheetId_(),
        null, { backupId: backup.getId(), clearedTabs: cleared, rowsCleared: totalRows },
        'Started fresh database: operational project records and project assignments cleared; user accounts, authentication, permissions, settings, and audit history preserved');
    }
    return { success: true, backupName: backup.getName(), backupUrl: backup.getUrl(),
      clearedTabs: cleared, rowsCleared: totalRows,
      preserved: ['Users', 'Auth_Credentials', 'Auth_Sessions', 'Role_Permissions', 'System_Settings', 'Audit_Logs'] };
  } finally {
    lock.releaseLock();
  }
}

function apiCreateDatabaseBackupCopy() {
  var ctx = assertDatabaseTransferAdmin_();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  var copy;
  try {
    var source = DriveApp.getFileById(getMasterSpreadsheetId_());
    var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
    copy = source.makeCopy('PMO_DATABASE_BACKUP_' + stamp);
  } finally {
    lock.releaseLock();
  }
  if (typeof writeAuditLog_ === 'function') writeAuditLog_(ctx, 'DATABASE_EXPORT', 'Database', getMasterSpreadsheetId_(), null, { backupId: copy.getId() }, 'Created full Google Sheets database backup');
  return { success: true, id: copy.getId(), name: copy.getName(), url: copy.getUrl() };
}
function apiCreateDatabaseTemplateCopy() {
  assertDatabaseTransferAdmin_();
  var source = getMasterSpreadsheet_();
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
  var template = SpreadsheetApp.create('PMO_DATABASE_TEMPLATE_' + stamp);
  var first = template.getSheets()[0];
  var usedFirst = false;
  Object.keys(DB_CONFIG.TABS).forEach(function(key) {
    var name = DB_CONFIG.TABS[key];
    var sourceSheet = source.getSheetByName(name);
    if (!sourceSheet) return;
    var lastCol = Math.max(1, sourceSheet.getLastColumn());
    var headers = sourceSheet.getRange(1, 1, 1, lastCol).getValues();
    var target;
    if (!usedFirst) { target = first; target.setName(name); usedFirst = true; }
    else target = template.insertSheet(name);
    target.getRange(1, 1, 1, lastCol).setValues(headers);
    target.setFrozenRows(1);
  });
  if (!usedFirst) first.setName('Template');
  return { success: true, id: template.getId(), name: template.getName(), url: template.getUrl() };
}

function apiImportDatabaseFromGoogleSheet(sourceSpreadsheetId) {
  var ctx = assertDatabaseTransferAdmin_();
  var sourceId = String(sourceSpreadsheetId || '').trim().match(/[-\w]{25,}/);
  if (!sourceId) throw new Error('Enter a valid Google Sheets URL or spreadsheet ID.');
  var source = SpreadsheetApp.openById(sourceId[0]);
  var target = getMasterSpreadsheet_();
  if (source.getId() === target.getId()) throw new Error('The source spreadsheet is already the live database.');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    // Validate every matching tab before changing any destination data.
    var plan = [];
    Object.keys(DB_CONFIG.TABS).forEach(function(key) {
      var tabName = DB_CONFIG.TABS[key];
      var src = source.getSheetByName(tabName);
      var dst = target.getSheetByName(tabName);
      if (!src || !dst) return;
      var srcCols = src.getLastColumn(), dstCols = dst.getLastColumn();
      if (!srcCols || !dstCols) throw new Error('Missing header row in tab: ' + tabName);
      var srcHeaders = src.getRange(1, 1, 1, srcCols).getDisplayValues()[0].map(String);
      var dstHeaders = dst.getRange(1, 1, 1, dstCols).getDisplayValues()[0].map(String);
      if (srcHeaders.length !== dstHeaders.length || srcHeaders.some(function(h, i) { return h !== dstHeaders[i]; })) {
        throw new Error('Header mismatch in tab "' + tabName + '". No import was applied.');
      }
      var srcLast = src.getLastRow();
      plan.push({ tab: tabName, src: src, dst: dst, cols: srcCols, rows: srcLast > 1 ? src.getRange(2, 1, srcLast - 1, srcCols).getValues() : [] });
    });
    if (!plan.length) throw new Error('No matching database tabs were found in the source spreadsheet.');
    // Always create a full backup only after all source headers have passed validation.
    var backup = DriveApp.getFileById(getMasterSpreadsheetId_()).makeCopy('PMO_PRE_IMPORT_BACKUP_' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss'));
    var updated = [];
    plan.forEach(function(item) {
      var dstLast = item.dst.getLastRow();
      if (dstLast > 1) item.dst.getRange(2, 1, dstLast - 1, item.cols).clearContent();
      if (item.rows.length) {
        var requiredLastRow = item.rows.length + 1;
        if (requiredLastRow > item.dst.getMaxRows()) item.dst.insertRowsAfter(item.dst.getMaxRows(), requiredLastRow - item.dst.getMaxRows());
        item.dst.getRange(2, 1, item.rows.length, item.cols).setValues(item.rows);
      }
      updated.push({ tab: item.tab, rows: item.rows.length });
    });
    writeAuditLog_(ctx, 'DATABASE_IMPORT', 'Database', sourceId[0], null, { tabs: updated, backupId: backup.getId() }, 'Imported matching tabs from Google Sheets source');
    return { success: true, updated: updated, backupUrl: backup.getUrl(), backupId: backup.getId() };
  } finally { lock.releaseLock(); }
}

function apiGetProjectModuleReportData(projectId, moduleKey) {
  var pid = String(projectId || '').trim();
  var key = String(moduleKey || '').trim();
  var map = {
    'Project Progress': ['Progress', DB_CONFIG.TABS.PROGRESS_UPDATES, 'Project_ID'],
    'Milestones': ['Milestones', DB_CONFIG.TABS.MILESTONES, 'Project_ID'],
    'Deliverables': ['Deliverables', DB_CONFIG.TABS.DELIVERABLES, 'Project_ID'],
    'Permits': ['Permits', DB_CONFIG.TABS.PERMITS, 'Project_ID'],
    'Risks': ['Risks', DB_CONFIG.TABS.RISKS, 'Project_ID'],
    'Issues': ['Issues', DB_CONFIG.TABS.ISSUES, 'Project_ID'],
    'Repository': ['Repository', DB_CONFIG.TABS.REPOSITORY, 'Project_ID'],
    'Weekly Reports': ['Weekly_Reports', DB_CONFIG.TABS.WEEKLY_REPORTS, 'Project_ID'],
    'Team Workload': ['Team_Workload', DB_CONFIG.TABS.TEAM_WORKLOAD, 'Assigned_Project_ID'],
    'Approvals': ['Approvals', DB_CONFIG.TABS.APPROVALS, 'Project_ID'],
    'Procurement and Logistics': ['Procurement_Logistics', DB_CONFIG.TABS.PROCUREMENT, 'Project_ID'],
    'Procurement & Logistics': ['Procurement_Logistics', DB_CONFIG.TABS.PROCUREMENT, 'Project_ID'],
    'Financial Monitoring': ['Financial_Monitoring', DB_CONFIG.TABS.FINANCIAL, 'Project_ID']
  };
  var spec = map[key];
  if (!spec) throw new Error('Report export is not available for this module.');
  var reportCtx = assertPermission_(spec[0], 'view', pid);
  var project = findRecordRowById_(DB_CONFIG.TABS.PROJECTS, 'Project_ID', pid);
  if (!project) throw new Error('Project not found.');
  var rows = getTableRecords_(spec[1]).filter(function(r) { return String(r[spec[2]] || '').trim() === pid; });
  if (key === 'Project Progress' && normalizeRoleName_(reportCtx.role) === 'Project Team Member') {
    rows = rows.filter(function(r) {
      var owner = String(r.Submitted_By_Email || '').trim().toLowerCase();
      var legacy = String(r.Submitted_By || '').toLowerCase().indexOf(String(reportCtx.email || '').toLowerCase()) !== -1;
      return owner ? owner === String(reportCtx.email || '').trim().toLowerCase() : legacy;
    });
  }
  rows = rows.map(function(r) { var o = {}; Object.keys(r).forEach(function(k) { if (k !== '_rowIndex') o[k] = r[k]; }); return o; });
  return { success: true, project: { id: project.Project_ID, name: project.Project_Name }, module: key, generatedAt: Utilities.formatDate(new Date(), 'Asia/Manila', 'yyyy-MM-dd HH:mm'), records: rows };
}
