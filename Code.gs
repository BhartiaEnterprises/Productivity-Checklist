// ════════════════════════════════════════════════════════════════════
// BHARTIA ENTERPRISES — Google Apps Script (Code.gs)
// Version 5.0 — adds Social Media Exec, Billing Exec, Inventory, CRM,
// BDA, Daily 10-min Training, Salesman Closing, and Points sheets
// Sheets: Checklist | Attendance | Camera | Productivity | Tasks
//         Daily Vitals | Digital Media | Staff Assignment | All Records
//         Social Media Exec | Billing Exec Summary | Billing Customers
//         Inventory | CRM | BDA | Daily Training (10-min) |
//         Salesman Closing | Points Log
// ════════════════════════════════════════════════════════════════════

const OWNER_EMAIL       = 'bhartiacoll@gmail.com';
const SEND_EMAIL_ALERTS = true;

// ── SHEET NAMES ──────────────────────────────────────────────────────
const SH = {
  CHECKLIST      : 'Checklists',
  ATTENDANCE     : 'Attendance',
  CAMERA         : 'Camera Reports',
  GROOMING       : 'Staff Grooming',
  PRODUCTIVITY   : 'Productivity',
  TASKS          : 'Tasks',
  DIGITAL        : 'Digital Media',
  STAFF_ASSIGN   : 'Staff Assignment',
  TRAINING       : 'Training',
  LEAVE          : 'Leave Applications',
  INTERCHANGE    : 'Staff Interchange',
  WA_GROUPS      : 'WA Group Additions',
  VITALS         : 'Daily Vitals',
  LOG            : 'All Records',
  // ── New in v5.0 ──
  SOCIAL_EXEC    : 'Social Media Exec',
  BILLING_EXEC   : 'Billing Exec Summary',
  BILLING_CUST   : 'Billing Customers',
  INVENTORY      : 'Inventory',
  CRM            : 'CRM',
  BDA            : 'BDA',
  DAILY_TRAINING : 'Daily Training (10-min)',
  SALESMAN       : 'Salesman Closing',
  POINTS         : 'Points Log',
  // ── New in v5.1 (Phase 0) ──
  SUBMITLOG      : 'Submit Log',
};

// ════════════════════════════════════════════════════════════════════
// doPost — MAIN ENTRY POINT (receives all submissions)
// ════════════════════════════════════════════════════════════════════
function doPost(e) {
  // Allow CORS so browser JS can read the response
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);
  try {
    const ss   = SpreadsheetApp.getActiveSpreadsheet();
    const d    = e.parameter;
    const type = d.type_ || 'checklist';
    const now  = nowIST();

    // ── Phase 0: duplicate protection ──
    // The app retries failed posts and re-sends queued ones. Each submission
    // carries a unique cid; if we've already processed it, skip silently.
    const cid = d.cid || '';
    if (cid && isDuplicateCid(cid)) {
      return jsonResp({ status:'ok', dup:true, timestamp: now });
    }

    switch(type) {
      case 'checklist':        handleChecklist(ss, d, now);       break;
      case 'attendance':       handleAttendance(ss, d, now);      break;
      case 'camera':           handleCamera(ss, d, now);          break;
      case 'productivity':     handleProductivity(ss, d, now);    break;
      case 'tasks':            handleTasks(ss, d, now);           break;
      case 'social_exec':      handleSocialExec(ss, d, now);      break;
      case 'billing_exec':     handleBillingExec(ss, d, now);     break;
      case 'inventory':        handleInventory(ss, d, now);       break;
      case 'crm':               handleCRM(ss, d, now);            break;
      case 'bda':               handleBDA(ss, d, now);            break;
      case 'training_daily':   handleDailyTraining(ss, d, now);   break;
      case 'salesman_closing': handleSalesmanClosing(ss, d, now); break;
      case 'points':           handlePoints(ss, d, now);          break;
    }

    // photo_upload is handled separately below and should NOT also hit logRecord/email
    if (type === 'photo_upload') {
      const url = handleSinglePhoto(d);
      logCid(ss, cid, type);
      return jsonResp({ status:'ok', url: url, timestamp: now });
    }

    // task_sync (Phase 1): background upsert — no All-Records log, no email
    if (type === 'task_sync') {
      handleTaskSync(ss, d, now);
      logCid(ss, cid, type);
      return jsonResp({ status:'ok', timestamp: now });
    }

    logRecord(ss, d, now);
    logCid(ss, cid, type);
    if (SEND_EMAIL_ALERTS) sendEmailAlert(d, type, now);

    return jsonResp({ status: 'ok', timestamp: now });

  } catch (err) {
    Logger.log('doPost error: ' + err.toString());
    return jsonResp({ status: 'error', message: err.toString() });
  }
}

// ════════════════════════════════════════════════════════════════════
// SINGLE PHOTO UPLOAD — called one photo at a time from app
// ════════════════════════════════════════════════════════════════════
function handleSinglePhoto(d) {
  try {
    const b64      = d.photo || '';
    const store    = d.store || 'BC';
    const date     = d.date  || new Date().toISOString().slice(0,10);
    const category = d.category || 'photo';
    const staffName= d.staffName || '';
    const by       = d.by || 'Unknown';

    if (!b64 || b64.length < 100) return '';

    const fname = [store, date, category, staffName||by, Date.now()]
      .filter(Boolean).join('_').replace(/\s/g,'_') + '.jpg';
    const url = savePhotoToDrive(b64, fname, store, date);

    // Log it in Camera sheet
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getSheet(ss, SH.CAMERA);
    if (isEmpty(sheet)) {
      appendRow(sheet,[
        'Timestamp','Store','Date','Captured By',
        'Category','Staff Name','Drive Photo Link',
        'Capture Time','Submitted At'
      ]);
      styleHeader(sheet);
      sheet.setColumnWidth(7, 250);
    }
    appendRow(sheet,[
      nowIST(), store, date, by,
      category, staffName, url,
      d.captureTime||'', d.submittedAt||nowIST()
    ]);

    // Also log grooming grade if provided
    if (d.groomGrade && staffName) {
      const grSheet = getSheet(ss, SH.GROOMING);
      if (isEmpty(grSheet)) {
        appendRow(grSheet,[
          'Timestamp','Store','Date','Staff Name',
          'Uniform','Hair','Shoes','ID Card','Clean Hands',
          'Grade','Photo Link','Submitted At'
        ]);
        styleHeader(grSheet);
        grSheet.setColumnWidth(11, 250);
      }
      let checks = []; try{checks=JSON.parse(d.groomChecks||'[]');}catch(e){}
      appendRow(grSheet,[
        nowIST(), store, date, staffName,
        checks.includes(0)||checks.includes('0')?'Yes':'No',
        checks.includes(1)||checks.includes('1')?'Yes':'No',
        checks.includes(2)||checks.includes('2')?'Yes':'No',
        checks.includes(3)||checks.includes('3')?'Yes':'No',
        checks.includes(4)||checks.includes('4')?'Yes':'No',
        d.groomGrade, url, d.submittedAt||nowIST()
      ]);
    }

    return url;
  } catch(err) {
    Logger.log('Single photo error: ' + err);
    return '';
  }
}

// ════════════════════════════════════════════════════════════════════
// doGet — RETURNS DATA TO APP (Reports, Analytics)
// ════════════════════════════════════════════════════════════════════
function doGet(e) {
  try {
    const action = safeParam(e, 'action');
    const ss     = SpreadsheetApp.getActiveSpreadsheet();

    // Phase 1: per-store per-date fill state (app dashboard + WhatsApp triggers)
    if (action === 'state') {
      return getStateEndpoint(ss, safeParam(e,'date'), safeParam(e,'store'));
    }

    // Phase 0: read-back verification — did submission <cid> actually land?
    if (action === 'confirm') {
      const cid = safeParam(e,'cid');
      return jsonResp({ status:'ok', found: cid ? isDuplicateCid(cid) : false });
    }

    if (action === 'getReports') {
      return getReports(ss,
        safeParam(e,'store'), safeParam(e,'date'),
        safeParam(e,'type_'), parseInt(safeParam(e,'limit')||'300')
      );
    }
    if (action === 'getAnalytics') {
      return getAnalytics(ss, safeParam(e,'store'), safeParam(e,'month'));
    }
    if (action === 'getAttendance') {
      return getSheetData(ss, SH.ATTENDANCE, safeParam(e,'store'), safeParam(e,'date'));
    }
    if (action === 'getDigital') {
      return getSheetData(ss, SH.DIGITAL, safeParam(e,'store'), safeParam(e,'date'));
    }
    if (action === 'getVitals') {
      return getSheetData(ss, SH.VITALS, safeParam(e,'store'), safeParam(e,'month'));
    }

    // Get Drive link for a specific photo after upload
    if (action === 'getPhotoLink') {
      const store    = safeParam(e,'store');
      const date     = safeParam(e,'date');
      const category = safeParam(e,'category');
      const staff    = safeParam(e,'staffName');
      return getPhotoLink(ss, store, date, category, staff);
    }

    // Get Drive folder link for today's store photos
    if (action === 'getFolderLink') {
      const store = safeParam(e,'store');
      const date  = safeParam(e,'date');
      try {
        const folder = getPhotoFolder(store, date);
        folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        const link = 'https://drive.google.com/drive/folders/' + folder.getId();
        return jsonResp({ status:'ok', url: link });
      } catch(err) {
        return jsonResp({ status:'error', message: err.toString() });
      }
    }

    return ContentService.createTextOutput(
      'Bhartia Enterprises API v5.1 — Running — ' + nowIST()
    ).setMimeType(ContentService.MimeType.TEXT);

  } catch(err) {
    return jsonResp({ status:'error', message: err.toString() });
  }
}

// ════════════════════════════════════════════════════════════════════
// CHECKLIST HANDLER — splits into multiple sheets
// ════════════════════════════════════════════════════════════════════
function handleChecklist(ss, d, now) {
  const sheetType = d.sheetType || '';
  let figs = {};   try { figs = JSON.parse(d.figures||'{}'); }     catch(e){}
  let checks = {}; try { checks = JSON.parse(d.checks||'{}'); }    catch(e){}
  let staffT = {}; try { staffT = JSON.parse(d.staffTasks||'{}'); } catch(e){}
  let trainD = {}; try { trainD = JSON.parse(d.training||'{}'); }   catch(e){}
  let leaves = []; try { leaves = JSON.parse(d.leaveApps||'[]'); }  catch(e){}
  let ixs    = []; try { ixs    = JSON.parse(d.interchanges||'[]');}catch(e){}
  let waGrps = []; try { waGrps = JSON.parse(d.waGroups||'[]'); }   catch(e){}
  let prsnts = []; try { prsnts = JSON.parse(d.presentStaff||'[]');}catch(e){}
  let priors = []; try { priors = JSON.parse(d.priorities||'[]'); } catch(e){}
  let priAsgn= []; try { priAsgn= JSON.parse(d.priAssign||'[]'); }  catch(e){}
  let asgns  = {}; try { asgns  = JSON.parse(d.assignments||'{}');} catch(e){}

  const checkedCount = Object.values(checks).filter(
    v => v===true || (Array.isArray(v) && v.length>0)
  ).length;

  // ── 1. MAIN CHECKLIST SHEET ─────────────────────────────────────
  const clSheet = getSheet(ss, SH.CHECKLIST);
  if (isEmpty(clSheet)) {
    appendRow(clSheet, [
      'Timestamp','Store','Sheet Type','Manager','Role','Date','Time',
      'Supervisor','Filled By','Checks Done',
      'Prayer Done','Vision Read',
      'Opening — Lights ON','Opening — Floor Cleaned',
      'Opening — Display Updated','Opening — Golchakri Updated',
      'Opening — Board Morning','Opening — Board Evening',
      'Closing — Lights OFF','Closing — Shutters Down',
      'Closing — ERP Done','Closing — Cash Tallied','Closing — UPI Done',
      'Closing — Trial Room','Closing — Alterations to Tailor',
      'Closing — Attendance Closed','Closing — Next Day Targets Set',
      'Closing — Lockup Done',
      'Important Work Today','Present Staff','Present Count',
      'Priority 1 Task','Priority 1 Assigned',
      'Priority 2 Task','Priority 2 Assigned',
      'Priority 3 Task','Priority 3 Assigned',
      'SME Follow-up','Billing Follow-up',
      'Manager Notes','Strategic Notes','Submitted At'
    ]);
    styleHeader(clSheet);
  }
  appendRow(clSheet, [
    now, d.store||'', sheetType, d.manager||'', d.role||'', d.date||'', d.time||'',
    d.supervisor||'', d.filledBy||'', checkedCount,
    checks['infra_prayer']||checks['open_prayer']  ? 'Yes':'No',
    checks['infra_vision']||checks['open_vision']   ? 'Yes':'No',
    checks['infra_lights']  ? 'Yes':'No',
    checks['infra_floor']   ? 'Yes':'No',
    checks['infra_golch']   ? 'Yes':'No',
    checks['infra_display'] ? 'Yes':'No',
    (checks['infra_board']||[]).includes('Morning')||(checks['infra_board']||[]).includes('सुबह') ? 'Yes':'No',
    (checks['infra_board']||[]).includes('Evening')||(checks['infra_board']||[]).includes('शाम')  ? 'Yes':'No',
    checks['cinfra_lights']  ? 'Yes':'No',
    checks['cinfra_shutters']? 'Yes':'No',
    checks['cbill_erp']     ? 'Yes':'No',
    checks['cbill_cash']    ? 'Yes':'No',
    checks['cbill_upi']     ? 'Yes':'No',
    checks['cfloor_trial']  ? 'Yes':'No',
    checks['cfloor_alteration']?'Yes':'No',
    checks['cstaff_att']    ? 'Yes':'No',
    checks['cstaff_targets']? 'Yes':'No',
    checks['cstaff_lockup'] ? 'Yes':'No',
    d.impWork||'',
    Array.isArray(prsnts) ? prsnts.join(', '):'',
    Array.isArray(prsnts) ? prsnts.length : 0,
    priors[0]||'', priAsgn[0]||'',
    priors[1]||'', priAsgn[1]||'',
    priors[2]||'', priAsgn[2]||'',
    figs.sme_followup||'', figs.billing_followup||'',
    d.mgrNotes||'', d.rsNotes||'', d.submittedAt||now
  ]);

  // ── 2. STAFF ASSIGNMENT SHEET ───────────────────────────────────
  const aSheet = getSheet(ss, SH.STAFF_ASSIGN);
  if (isEmpty(aSheet)) {
    appendRow(aSheet, [
      'Timestamp','Store','Sheet Type','Manager','Date',
      'Staff Name','Task 1','Task 1 Priority','Task 1 Done',
      'Task 2','Task 2 Priority','Task 2 Done',
      'Task 3','Task 3 Priority','Task 3 Done',
      'Task 4','Task 4 Priority','Task 4 Done',
      'Total Tasks','Done Count','Pending Count'
    ]);
    styleHeader(aSheet);
  }
  Object.entries(staffT).forEach(([name, tasks]) => {
    if (!Array.isArray(tasks) || tasks.length===0) return;
    const row = [now, d.store||'', sheetType, d.manager||'', d.date||'', name];
    let total=0, doneCount=0;
    for (let i=0; i<4; i++) {
      const t = tasks[i] || {};
      row.push(t.desc||'', t.pri||'', t.done?'Yes':'No');
      if (t.desc) { total++; if(t.done) doneCount++; }
    }
    row.push(total, doneCount, total-doneCount);
    appendRow(aSheet, row);
  });

  // ── 3. DIGITAL MEDIA SHEET ──────────────────────────────────────
  const digSheet = getSheet(ss, SH.DIGITAL);
  if (isEmpty(digSheet)) {
    appendRow(digSheet, [
      'Timestamp','Store','Manager','Date',
      'FB — Post','FB — Reel','FB — Story','FB — Live','FB — Video','FB Time','FB Topic',
      'IG — Post','IG — Reel','IG — Story','IG — Live','IG Time','IG Topic',
      'YouTube — Video','YouTube — Shorts','YouTube — Community','YouTube — Live','YT Time','YT Topic',
      'Google Map — Post','Google Map — Video','Google Map — Offer','GM Time',
      'WA — Status Video','WA — Status Photo','WA — Broadcast','WA Time',
      'WA Team Status Updated (Names)',
      'New Contacts Added','Total Videos Today','Content Notes',
      'WA Groups — Group Name','WA Groups — Count Added','WA Groups — From','WA Groups — To'
    ]);
    styleHeader(digSheet);
  }
  const digCk = checks;
  const digFig = figs;
  const times = {}; try { Object.assign(times, JSON.parse(d.times||'{}')); } catch(e){}
  const fbArr  = digCk['dig_fb']    ||[];
  const igArr  = digCk['dig_ig']    ||[];
  const ytArr  = digCk['dig_yt']    ||[];
  const gmArr  = digCk['dig_gm']    ||[];
  const waFmt  = digCk['dig_wa_fmt']||[];
  const waTm   = digCk['dig_team']  ||[];
  appendRow(digSheet, [
    now, d.store||'', d.manager||'', d.date||'',
    fbArr.includes('Post 📸')||fbArr.includes('पोस्ट 📸')?'Yes':'No',
    fbArr.includes('Reel 🎬')||fbArr.includes('रील 🎬')?'Yes':'No',
    fbArr.includes('Story 📲')||fbArr.includes('स्टोरी 📲')?'Yes':'No',
    fbArr.includes('Live 🔴')||fbArr.includes('लाइव 🔴')?'Yes':'No',
    fbArr.includes('Video 🎥')||fbArr.includes('वीडियो 🎥')?'Yes':'No',
    times['fb_t']||'', digFig['fb_t_topic']||'',
    igArr.includes('Post 📸')||igArr.includes('पोस्ट 📸')?'Yes':'No',
    igArr.includes('Reel 🎬')||igArr.includes('रील 🎬')?'Yes':'No',
    igArr.includes('Story 📲')||igArr.includes('स्टोरी 📲')?'Yes':'No',
    igArr.includes('Live 🔴')||igArr.includes('लाइव 🔴')?'Yes':'No',
    times['ig_t']||'', digFig['ig_t_topic']||'',
    ytArr.includes('Video 🎥')||ytArr.includes('वीडियो 🎥')?'Yes':'No',
    ytArr.includes('Shorts ⚡')||ytArr.includes('शॉर्ट्स ⚡')?'Yes':'No',
    ytArr.includes('Community 📝')||ytArr.includes('कम्युनिटी 📝')?'Yes':'No',
    ytArr.includes('Live 🔴')||ytArr.includes('लाइव 🔴')?'Yes':'No',
    times['yt_t']||'', digFig['yt_t_topic']||'',
    gmArr.includes('Photo 📸')||gmArr.includes('फोटो 📸')?'Yes':'No',
    gmArr.includes('Video 🎥')||gmArr.includes('वीडियो 🎥')?'Yes':'No',
    gmArr.includes('Offer Update 🏷️')||gmArr.includes('ऑफर अपडेट 🏷️')?'Yes':'No',
    times['gm_t']||'',
    waFmt.includes('Status Video 🎬')||waFmt.includes('स्टेटस वीडियो 🎬')?'Yes':'No',
    waFmt.includes('Status Photo 📸')||waFmt.includes('स्टेटस फोटो 📸')?'Yes':'No',
    waFmt.includes('Broadcast 📢')||waFmt.includes('ब्रॉडकास्ट 📢')?'Yes':'No',
    times['wa_t']||'',
    Array.isArray(waTm)?waTm.join(', '):'',
    digFig['contacts']||'0', digFig['total_videos']||'0', digFig['content_note']||'',
    waGrps.map(g=>g.group||'').join(' | '),
    waGrps.map(g=>g.count||'').join(' | '),
    waGrps.map(g=>g.from||'').join(' | '),
    waGrps.map(g=>g.to||'').join(' | ')
  ]);

  // ── 4. TRAINING SHEET (per-checklist manager-assigned training) ─
  const trSheet = getSheet(ss, SH.TRAINING);
  if (isEmpty(trSheet)) {
    appendRow(trSheet,[
      'Timestamp','Store','Manager','Date','Staff Name','Subject / Topic','Duration (mins)','Result / Notes'
    ]);
    styleHeader(trSheet);
  }
  Object.entries(trainD).forEach(([name, tr]) => {
    if (!tr || (!tr.subject && !tr.mins)) return;
    appendRow(trSheet,[now,d.store||'',d.manager||'',d.date||'',name,tr.subject||'',tr.mins||'',tr.result||'']);
  });

  // ── 5. LEAVE APPLICATIONS ───────────────────────────────────────
  const lvSheet = getSheet(ss, SH.LEAVE);
  if (isEmpty(lvSheet)) {
    appendRow(lvSheet,[
      'Timestamp','Store','Manager','Date Submitted',
      'Staff Name','Leave Type','From Date','To Date','Reason','Granted?'
    ]);
    styleHeader(lvSheet);
  }
  leaves.forEach(l => {
    if (!l.name) return;
    appendRow(lvSheet,[
      now,d.store||'',d.manager||'',d.date||'',
      l.name||'',l.type||'',l.from||'',l.to||'',l.reason||'',
      l.granted==='yes'?'Yes':l.granted==='no'?'No':'Pending'
    ]);
  });

  // ── 6. STAFF INTERCHANGE ────────────────────────────────────────
  const ixSheet = getSheet(ss, SH.INTERCHANGE);
  if (isEmpty(ixSheet)) {
    appendRow(ixSheet,[
      'Timestamp','Store','Manager','Date','Staff Name','From Store','To Store','Direction'
    ]);
    styleHeader(ixSheet);
  }
  ixs.forEach(ix => {
    if (!ix.name) return;
    appendRow(ixSheet,[
      now,d.store||'',d.manager||'',d.date||'',
      ix.name||'',ix.from||'',ix.to||'',ix.to===d.store?'Incoming':'Outgoing'
    ]);
  });

  // ── 7. DAILY VITALS (closing only) ──────────────────────────────
  if (sheetType === 'closing' && Object.keys(figs).length > 0) {
    const vSheet = getSheet(ss, SH.VITALS);
    if (isEmpty(vSheet)) {
      appendRow(vSheet,[
        'Date','Store','Manager',
        'Total Bills','Total Sales (Rs)','Total Items Sold',
        'Avg Bill Value (Rs)','Avg Item Value (Rs)',
        'New Customers','Repeat Customers',
        'Walk-ins','Conversion %',
        'RB Stock Sold','HO Orders Given','Alterations to Tailor',
        'Google Reviews','Coupons Distributed',
        'WA Status Views','WA Enquiry Replies',
        'FB/Meta Replies','Instagram Replies',
        'Contacts Added','Total Videos Today',
        'Next Day Priority 1','Next Day Priority 2','Next Day Priority 3'
      ]);
      styleHeader(vSheet);
    }
    const bills = parseFloat(figs.bills||0);
    const sales = parseFloat(figs.total_sales||0);
    const items = parseFloat(figs.items||0);
    const walk  = parseFloat(figs.walkin||0);
    appendRow(vSheet,[
      d.date,d.store,d.manager,
      bills, sales, items,
      bills>0 ? Math.round(sales/bills) : '',
      items>0 ? Math.round(sales/items) : '',
      figs.newcust||'', figs.repeat||'',
      walk, walk>0 ? Math.round((bills/walk)*100)+'%' : '',
      figs.rbsold||'', figs.hoorder||'', figs.tailor||'',
      figs.review||'', figs.coupon||'',
      figs.waviews||'', figs.wareply||'',
      figs.fbreply||'', figs.instreply||'',
      figs.contacts||'', figs.total_videos||'',
      priors[0]||'', priors[1]||'', priors[2]||''
    ]);
  }
}

// ════════════════════════════════════════════════════════════════════
// ATTENDANCE HANDLER — full detail
// ════════════════════════════════════════════════════════════════════
function handleAttendance(ss, d, now) {
  const sheet = getSheet(ss, SH.ATTENDANCE);
  if (isEmpty(sheet)) {
    appendRow(sheet,[
      'Timestamp','Store','Date','Supervisor','Submitted By',
      'Staff Name','Status',
      'Time In','Lunch Out','Lunch In','Time Out',
      'Work Hours (approx)','Remark','Submitted At'
    ]);
    styleHeader(sheet);
  }
  let att = {};
  try { att = JSON.parse(d.attendance||'{}'); } catch(e){}
  Object.entries(att).forEach(([key,val]) => {
    const name = key.replace('att_','');
    let workHrs = '';
    try {
      if (val.timeIn && val.timeOut) {
        const [ih,im] = val.timeIn.split(':').map(Number);
        const [oh,om] = val.timeOut.split(':').map(Number);
        let lunchMins = 0;
        if (val.lunchOut && val.lunchIn) {
          const [loh,lom] = val.lunchOut.split(':').map(Number);
          const [lih,lim] = val.lunchIn.split(':').map(Number);
          lunchMins = (lih*60+lim)-(loh*60+lom);
        }
        const total = (oh*60+om)-(ih*60+im)-lunchMins;
        workHrs = (total/60).toFixed(1)+' hrs';
      }
    } catch(e){}
    appendRow(sheet,[
      now, d.store||'', d.date||'', d.supervisor||'', d.filledBy||'',
      name, val.status||'',
      val.timeIn||'', val.lunchOut||'', val.lunchIn||'', val.timeOut||'',
      workHrs, val.remark||'', d.submittedAt||now
    ]);
  });

  // Summary row
  const sumSheet = getSheet(ss, 'Attendance Summary');
  if (isEmpty(sumSheet)) {
    appendRow(sumSheet,[
      'Timestamp','Store','Date','Supervisor',
      'Total Staff','Present','Absent','Late','Half Day',
      'On Leave (Granted)','Interchange In','Submitted At'
    ]);
    styleHeader(sumSheet);
  }
  let pr=0,ab=0,lt=0,hd=0;
  Object.values(att).forEach(v=>{
    if(v.status==='present')pr++;
    else if(v.status==='absent')ab++;
    else if(v.status==='late')lt++;
    else if(v.status==='halfday')hd++;
  });
  const total=Object.keys(att).length;
  appendRow(sumSheet,[
    now,d.store||'',d.date||'',d.supervisor||'',
    total,pr,ab,lt,hd,'','',d.submittedAt||now
  ]);
}


// ════════════════════════════════════════════════════════════════════
// GOOGLE DRIVE — PHOTO STORAGE
// ════════════════════════════════════════════════════════════════════

// Gets or creates the main BE Photos folder in Drive
function getPhotoFolder(store, date) {
  const rootName = 'BE Daily Photos';
  let root = null;
  const rootFolders = DriveApp.getFoldersByName(rootName);
  root = rootFolders.hasNext() ? rootFolders.next() : DriveApp.createFolder(rootName);

  // Sub-folder: Store name
  const storeFolders = root.getFoldersByName(store);
  const storeFolder  = storeFolders.hasNext() ? storeFolders.next() : root.createFolder(store);

  // Sub-folder: Date
  const dateFolders = storeFolder.getFoldersByName(date);
  return dateFolders.hasNext() ? dateFolders.next() : storeFolder.createFolder(date);
}

// Saves a base64 image to Drive, returns public URL
function savePhotoToDrive(base64Data, fileName, store, date) {
  try {
    if (!base64Data || base64Data.length < 100) return '';
    // Strip data:image/jpeg;base64, prefix
    const clean    = base64Data.split(',')[1] || base64Data;
    const blob     = Utilities.newBlob(Utilities.base64Decode(clean), 'image/jpeg', fileName);
    const folder   = getPhotoFolder(store, date);
    const file     = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return 'https://drive.google.com/file/d/' + file.getId() + '/view';
  } catch(err) {
    Logger.log('Photo save error: ' + err + ' | File: ' + fileName);
    return '';
  }
}

// ════════════════════════════════════════════════════════════════════
// CAMERA HANDLER — saves photos to Google Drive
// ════════════════════════════════════════════════════════════════════
function handleCamera(ss, d, now) {
  const store = d.store||'BC';
  const date  = d.date||new Date().toISOString().slice(0,10);
  const by    = d.by||'Unknown';

  // ── Opening photos ──────────────────────────────────────────────
  const openCats = [
    {key:'exterior',    label:'Store Exterior'},
    {key:'group_selfie',label:'Group Selfie'},
    {key:'floor',       label:'Floor Cleanliness'},
    {key:'display',     label:'Display Golchakri'},
    {key:'trial_room',  label:'Trial Room'},
    {key:'posters',     label:'Posters Offers'},
  ];
  const closeCats = [
    {key:'closing_ext', label:'Closing Exterior'},
    {key:'closing_int', label:'Closing Lights Off'},
  ];

  // Parse photo data sent from app
  let photoData = {};
  try { photoData = JSON.parse(d.photoData||'{}'); } catch(e){}
  // Phase 0: new app versions upload photos individually first, then send
  // ready-made Drive links here — no base64 re-upload needed.
  let photoUrls = {};
  try { photoUrls = JSON.parse(d.photoUrls||'{}'); } catch(e){}

  // Save each photo to Drive and get URL (or use the pre-uploaded link)
  const urls = {};
  [...openCats,...closeCats].forEach(cat => {
    if (photoUrls[cat.key]) { urls[cat.key] = photoUrls[cat.key]; return; }
    const b64 = photoData[cat.key] || d[cat.key+'_b64'] || '';
    if (b64 && b64.length > 100) {
      const fname = store+'_'+date+'_'+cat.key+'_'+by.replace(/\s/g,'_')+'.jpg';
      urls[cat.key] = savePhotoToDrive(b64, fname, store, date);
    } else {
      urls[cat.key] = '';
    }
  });

  // ── Camera Sheet with Drive links ───────────────────────────────
  const sheet = getSheet(ss, SH.CAMERA);
  if (isEmpty(sheet)) {
    appendRow(sheet,[
      'Timestamp','Store','Date','Captured By','Opening Time',
      'Store Exterior (Drive Link)',
      'Group Selfie (Drive Link)',
      'Floor & Cleanliness (Drive Link)',
      'Display / Golchakri (Drive Link)',
      'Trial Room (Drive Link)',
      'Posters & Offers (Drive Link)',
      'Total Opening Photos',
      'Closing Exterior (Drive Link)',
      'Closing Lights Off (Drive Link)',
      'Drive Folder Link','Submitted At'
    ]);
    styleHeader(sheet);
    // Make link columns wider
    [6,7,8,9,10,11,13,14,15].forEach(col => sheet.setColumnWidth(col, 220));
  }

  // Get folder link
  let folderLink = '';
  try {
    const f = getPhotoFolder(store, date);
    folderLink = 'https://drive.google.com/drive/folders/'+f.getId();
  } catch(e){}

  const openCount = openCats.filter(c=>urls[c.key]).length;

  appendRow(sheet,[
    now, store, date, by, d.captureTime||now,
    urls['exterior']    || 'No photo',
    urls['group_selfie']|| 'No photo',
    urls['floor']       || 'No photo',
    urls['display']     || 'No photo',
    urls['trial_room']  || 'No photo',
    urls['posters']     || 'No photo',
    openCount+'/6',
    urls['closing_ext'] || 'No photo',
    urls['closing_int'] || 'No photo',
    folderLink,
    d.submittedAt||now
  ]);

  // ── Grooming Sheet with Drive links ─────────────────────────────
  const grSheet = getSheet(ss, SH.GROOMING);
  if (isEmpty(grSheet)) {
    appendRow(grSheet,[
      'Timestamp','Store','Date','Captured By',
      'Staff Name','Uniform ✓','Hair ✓','Shoes ✓','ID Card ✓','Clean Hands ✓',
      'Grooming Grade (A/B/C)',
      'Full Body Photo (Drive Link)',
      'Submitted At'
    ]);
    styleHeader(grSheet);
    grSheet.setColumnWidth(12, 220);
  }

  let grooming = {};
  try { grooming = JSON.parse(d.groomingData||'{}'); } catch(e){}

  Object.entries(grooming).forEach(([nm,g]) => {
    if (!nm) return;
    const checks = g.checks||[];
    let groomPhotoUrl = g.url || '';
    if (!groomPhotoUrl && g.thumb && g.thumb.length > 100) {
      const fname = store+'_'+date+'_groom_'+nm.replace(/\s/g,'_')+'.jpg';
      groomPhotoUrl = savePhotoToDrive(g.thumb, fname, store, date);
    }
    appendRow(grSheet,[
      now, store, date, by, nm,
      checks.includes(0)?'Yes':'No',
      checks.includes(1)?'Yes':'No',
      checks.includes(2)?'Yes':'No',
      checks.includes(3)?'Yes':'No',
      checks.includes(4)?'Yes':'No',
      g.grade||'',
      groomPhotoUrl || 'No photo',
      d.submittedAt||now
    ]);
  });
}

// ════════════════════════════════════════════════════════════════════
// PRODUCTIVITY HANDLER
// ════════════════════════════════════════════════════════════════════
function handleProductivity(ss, d, now) {
  const sheet = getSheet(ss, SH.PRODUCTIVITY);
  if (isEmpty(sheet)) {
    appendRow(sheet,[
      'Timestamp','Store','Staff','Date','Block (min)',
      'Total Work Slots','Slots Filled','Slots Done',
      'Productivity %','Top Category',
      'Full Data JSON','Submitted At'
    ]);
    styleHeader(sheet);
  }
  let filled=0, done=0, total=0;
  const catCount = {};
  try {
    const pd = JSON.parse(d.data||'{}');
    Object.values(pd).forEach(s => {
      if (s.isLunch) return;
      total++;
      if (s.task && s.task.trim()) filled++;
      if (s.done) done++;
      if (s.cat) catCount[s.cat] = (catCount[s.cat]||0)+1;
    });
  } catch(e){}
  const topCat = Object.entries(catCount).sort((a,b)=>b[1]-a[1])[0];
  appendRow(sheet,[
    now, d.store||'', d.staff||'', d.date||'', d.block||'30',
    total, filled, done,
    total>0 ? Math.round(filled/total*100)+'%' : '0%',
    topCat ? topCat[0] : '',
    d.data||'', d.submittedAt||now
  ]);

  // Also write individual time slots for detailed tracking
  const detSheet = getSheet(ss, 'Productivity Detail');
  if (isEmpty(detSheet)) {
    appendRow(detSheet,[
      'Timestamp','Store','Staff','Date','Block (min)',
      'Time Slot','Task','Category','Done?'
    ]);
    styleHeader(detSheet);
  }
  try {
    const pd = JSON.parse(d.data||'{}');
    Object.entries(pd).forEach(([id,s]) => {
      if (!s.task || !s.task.trim()) return;
      const [h,m] = id.split('_');
      const timeStr = String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');
      appendRow(detSheet,[
        now, d.store||'', d.staff||'', d.date||'', d.block||'30',
        timeStr, s.task||'', s.cat||'', s.done?'Yes':'No'
      ]);
    });
  } catch(e){}
}

// ════════════════════════════════════════════════════════════════════
// TASKS HANDLER
// ════════════════════════════════════════════════════════════════════
function handleTasks(ss, d, now) {
  const sheet = getSheet(ss, SH.TASKS);
  if (isEmpty(sheet)) {
    appendRow(sheet,[
      'Timestamp','Store','Task Description','Assigned To','Added By',
      'Priority','Due','Status','Source / Checklist Section',
      'Carried Forward?','Carried From Date','Done At','Created At'
    ]);
    styleHeader(sheet);
  }
  let tasks = [];
  try { tasks = JSON.parse(d.tasks||'[]'); } catch(e){}
  tasks.forEach(t => {
    if (!t.desc) return;
    appendRow(sheet,[
      now, t.store||d.store||'', t.desc||'',
      t.assignedTo||'', t.addedBy||'', t.priority||'normal',
      t.due||'', t.status||'pending', t.source||'',
      t.carried?'Yes':'No', t.carriedFrom||'', t.doneAt||'', t.createdAt||now
    ]);
  });
}

// ════════════════════════════════════════════════════════════════════
// SOCIAL MEDIA EXECUTIVE HANDLER (v5.0)
// Payload: type_, store, date, executive, socialExecData (JSON), submittedAt
// socialExecData shape: { platformKey: { video:{shot,edited,posted,*_ts}, photo:{captured,edited,posted,*_ts} } }
// ════════════════════════════════════════════════════════════════════
function handleSocialExec(ss, d, now) {
  const sheet = getSheet(ss, SH.SOCIAL_EXEC);
  if (isEmpty(sheet)) {
    appendRow(sheet,[
      'Timestamp','Store','Date','Executive','Platform',
      'Video — Shot','Video — Edited','Video — Posted','Video Posted Time',
      'Photo — Captured','Photo — Edited','Photo — Posted','Photo Posted Time',
      'Fully Posted?','Submitted At'
    ]);
    styleHeader(sheet);
  }
  let data = {};
  try { data = JSON.parse(d.socialExecData || '{}'); } catch(e){}
  const platforms = ['instagram','facebook','youtube','google','whatsapp','telegram','linkedin'];
  const found = Object.keys(data).length ? Object.keys(data) : platforms;
  found.forEach(pk => {
    const pd = data[pk] || {};
    const v = pd.video || {};
    const p = pd.photo || {};
    const fullyPosted = (v.posted || p.posted) ? 'Yes' : 'No';
    appendRow(sheet,[
      now, d.store||'', d.date||'', d.executive||'', pk,
      v.shot?'Yes':'No', v.edited?'Yes':'No', v.posted?'Yes':'No', v.posted_ts||'',
      p.captured?'Yes':'No', p.edited?'Yes':'No', p.posted?'Yes':'No', p.posted_ts||'',
      fullyPosted, d.submittedAt||now
    ]);
  });
}

// ════════════════════════════════════════════════════════════════════
// BILLING EXECUTIVE HANDLER (v5.0)
// Payload: type_, store, date, executive, billingData (JSON array), submittedAt
// billingData item: {name,mobile,whatsapp,city,occasion,interest,status,bill_no,
//   bill_amt,source,steps:{lead,xsell,slip,review,coupon},review_done,coupon_done,lost,ts}
// ════════════════════════════════════════════════════════════════════
function handleBillingExec(ss, d, now) {
  let arr = [];
  try { arr = JSON.parse(d.billingData || '[]'); } catch(e){}

  function stepDone(c, step) {
    const s = (c.steps && c.steps[step]) || {};
    return Object.keys(s).some(k => s[k] === true);
  }

  // ── Summary row ──
  const sumSheet = getSheet(ss, SH.BILLING_EXEC);
  if (isEmpty(sumSheet)) {
    appendRow(sumSheet,[
      'Timestamp','Store','Date','Executive',
      'Customers Handled','Mobiles Collected','Bills Made','Lost Customers',
      'Cross-sell Attempted','Cross-sell Success',
      'Google Reviews','Coupons Issued','Slips Issued',
      'Coupon Conversion %','Submitted At'
    ]);
    styleHeader(sumSheet);
  }
  const handled   = arr.length;
  const mobiles   = arr.filter(c => c.mobile && String(c.mobile).trim()).length;
  const bills     = arr.filter(c => c.bill_no && String(c.bill_no).trim()).length;
  const lost      = arr.filter(c => c.lost).length;
  const xsellAtt  = arr.filter(c => stepDone(c,'xsell')).length;
  const xsellSucc = arr.filter(c => (c.steps && c.steps.xsell || {}).added).length;
  const reviews   = arr.filter(c => c.review_done).length;
  const coupons   = arr.filter(c => c.coupon_done).length;
  const slips     = arr.filter(c => (c.steps && c.steps.slip || {}).handed).length;
  appendRow(sumSheet,[
    now, d.store||'', d.date||'', d.executive||'',
    handled, mobiles, bills, lost,
    xsellAtt, xsellSucc,
    reviews, coupons, slips,
    handled>0 ? Math.round(coupons/handled*100)+'%' : '0%',
    d.submittedAt||now
  ]);

  // ── Per-customer detail rows ──
  const custSheet = getSheet(ss, SH.BILLING_CUST);
  if (isEmpty(custSheet)) {
    appendRow(custSheet,[
      'Timestamp','Store','Date','Executive',
      'Customer Name','Mobile','WhatsApp','City/Area','Occasion','Interest',
      'Source','Purchase Status','Bill No','Bill Amount',
      'Lead Step Done','Cross-sell Step Done','Cross-sell Added Item',
      'Bill/Slip Step Done','Review Step Done','Google Review Done',
      'Coupon Step Done','₹200 Coupon Issued','Lost Customer?','Captured At'
    ]);
    styleHeader(custSheet);
  }
  arr.forEach(c => {
    if (!c || (!c.name && !c.mobile)) return;
    appendRow(custSheet,[
      now, d.store||'', d.date||'', d.executive||'',
      c.name||'', c.mobile||'', c.whatsapp||'', c.city||'', c.occasion||'', c.interest||'',
      c.source||'', c.status||'', c.bill_no||'', c.bill_amt||'',
      stepDone(c,'lead')?'Yes':'No',
      stepDone(c,'xsell')?'Yes':'No',
      (c.steps && c.steps.xsell || {}).added ? 'Yes':'No',
      stepDone(c,'slip')?'Yes':'No',
      stepDone(c,'review')?'Yes':'No',
      c.review_done?'Yes':'No',
      stepDone(c,'coupon')?'Yes':'No',
      c.coupon_done?'Yes':'No',
      c.lost?'Yes':'No',
      c.ts||''
    ]);
  });
}

// ════════════════════════════════════════════════════════════════════
// INVENTORY HANDLER (v5.0)
// Payload: type_, location, date, executive, invData (JSON: {checks,fields}), submittedAt
// ════════════════════════════════════════════════════════════════════
function handleInventory(ss, d, now) {
  const sheet = getSheet(ss, SH.INVENTORY);
  if (isEmpty(sheet)) {
    appendRow(sheet,[
      'Timestamp','Location','Date','Executive',
      'Fast-Moving SKUs (5-6 days)','Fast-movers Noted?','Noted by Size/Color?',
      'Slow SKUs (7+ days)','Dead SKUs (15+ days)','Slow Stock Flagged?',
      'Replenishment List','Replenishment Sent?',
      'Arranged Size-wise?','Arranged Color-wise?','No Idle Warehouse Stock?',
      'All Barcoded?','No Missing Barcode?','Stapler Kept?','Barcode Pending (count)',
      'Trending Items for Store','Missing/Out-of-Stock Items','Manager Updated?',
      'Submitted At'
    ]);
    styleHeader(sheet);
  }
  let data = {};
  try { data = JSON.parse(d.invData || '{}'); } catch(e){}
  const c = data.checks || {};
  const f = data.fields || {};
  appendRow(sheet,[
    now, d.location||'', d.date||'', d.executive||'',
    f.fast_sku||'', c.fast_noted?'Yes':'No', c.fast_size_color?'Yes':'No',
    f.slow_7||'', f.slow_15||'', c.slow_flagged?'Yes':'No',
    f.replenish_list||'', c.replenish_sent?'Yes':'No',
    c.arr_size?'Yes':'No', c.arr_color?'Yes':'No', c.arr_nowh?'Yes':'No',
    c.bc_all?'Yes':'No', c.bc_none?'Yes':'No', c.bc_stapler?'Yes':'No', f.bc_pending||'0',
    f.mgr_trending||'', f.mgr_missing||'', c.mgr_updated?'Yes':'No',
    d.submittedAt||now
  ]);
}

// ════════════════════════════════════════════════════════════════════
// CRM HANDLER (v5.0)
// Payload: type_, store, date, executive, crmData (JSON: {checks,fields}), submittedAt
// ════════════════════════════════════════════════════════════════════
function handleCRM(ss, d, now) {
  const sheet = getSheet(ss, SH.CRM);
  if (isEmpty(sheet)) {
    appendRow(sheet,[
      'Timestamp','Store','Date','Executive',
      'Numbers Collected (yesterday)','Numbers Added to WA Group',
      'All New Customers Added?','Welcome Message Sent?',
      'Birthday/Anniversary Wished?','Followed Up Old Customers?',
      'Submitted At'
    ]);
    styleHeader(sheet);
  }
  let data = {};
  try { data = JSON.parse(d.crmData || '{}'); } catch(e){}
  const c = data.checks || {};
  const f = data.fields || {};
  appendRow(sheet,[
    now, d.store||'', d.date||'', d.executive||'',
    f.count_collected||'0', f.count_added||'0',
    c.added_group?'Yes':'No', c.welcome_sent?'Yes':'No',
    c.birthday_check?'Yes':'No', c.followup_prev?'Yes':'No',
    d.submittedAt||now
  ]);
}

// ════════════════════════════════════════════════════════════════════
// BDA (Business Development) HANDLER (v5.0)
// Payload: type_, store, date, executive, bdaData (JSON: {checks,fields}), submittedAt
// ════════════════════════════════════════════════════════════════════
function handleBDA(ss, d, now) {
  const sheet = getSheet(ss, SH.BDA);
  if (isEmpty(sheet)) {
    appendRow(sheet,[
      'Timestamp','Store','Date','Executive',
      'Partners Met Today','Partner Type','New Tie-ups (count)',
      'Referrals Received (count)','Sale from Referrals (₹)',
      'Contacted New Partner?','Followed Up Existing?',
      'Explained Offer/Commission?','Gave Card/Catalogue?','Connected on WhatsApp?',
      'Submitted At'
    ]);
    styleHeader(sheet);
  }
  let data = {};
  try { data = JSON.parse(d.bdaData || '{}'); } catch(e){}
  const c = data.checks || {};
  const f = data.fields || {};
  appendRow(sheet,[
    now, d.store||'', d.date||'', d.executive||'',
    f.partners_met||'', f.partner_type||'', f.new_tieups||'0',
    f.referrals_recv||'0', f.referral_sales||'0',
    c.c_new_partner?'Yes':'No', c.c_followup?'Yes':'No',
    c.c_offer?'Yes':'No', c.c_card?'Yes':'No', c.c_wa?'Yes':'No',
    d.submittedAt||now
  ]);
}

// ════════════════════════════════════════════════════════════════════
// DAILY 10-MIN TRAINING HANDLER (v5.0) — every executive, every day
// Payload: type_, executive, date, done, total, trainData (JSON: {checks}), submittedAt
// ════════════════════════════════════════════════════════════════════
function handleDailyTraining(ss, d, now) {
  const sheet = getSheet(ss, SH.DAILY_TRAINING);
  if (isEmpty(sheet)) {
    appendRow(sheet,[
      'Timestamp','Executive','Date','Topics Done','Topics Total','Completion %',
      'Greeting','Need-Analysis Qs','7 Sales Stages','Objection Handling',
      'Cross-sell/Upsell','Google Review Ask','Today Focus Understood',
      'Submitted At'
    ]);
    styleHeader(sheet);
  }
  let data = {};
  try { data = JSON.parse(d.trainData || '{}'); } catch(e){}
  const c = data.checks || {};
  const done  = parseInt(d.done||0);
  const total = parseInt(d.total||7);
  appendRow(sheet,[
    now, d.executive||'', d.date||'', done, total,
    total>0 ? Math.round(done/total*100)+'%' : '0%',
    c.greeting?'Yes':'No', c.need?'Yes':'No', c.stages?'Yes':'No',
    c.objection?'Yes':'No', c.crosssell?'Yes':'No', c.review?'Yes':'No',
    c.today_focus?'Yes':'No',
    d.submittedAt||now
  ]);
}

// ════════════════════════════════════════════════════════════════════
// SALESMAN CLOSING CHECKLIST HANDLER (v5.0)
// Payload: type_, staff, store, date, salesData (JSON: {checks,nums,rainbow,text}), submittedAt
// ════════════════════════════════════════════════════════════════════
function handleSalesmanClosing(ss, d, now) {
  const sheet = getSheet(ss, SH.SALESMAN);
  if (isEmpty(sheet)) {
    appendRow(sheet,[
      'Timestamp','Staff','Store','Date',
      'Customers Attended','Bills Generated','Did Not Purchase',
      'Cross-sold Customers','Accessories Sold',
      'Names Collected','Mobiles Collected','Wedding/Event Dates',
      'Google Reviews Received','Video Testimonials','Complaints Today','Complaints Resolved?',
      'Rainbow (old stock) Items Sold — JSON',
      'Missing Running Item','Low Stock Reported?',
      'Unavailable Item / SKU','Stock Required Urgently','Issue Faced Today',
      'Submitted At'
    ]);
    styleHeader(sheet);
  }
  let data = {};
  try { data = JSON.parse(d.salesData || '{}'); } catch(e){}
  const c = data.checks || {};
  const n = data.nums   || {};
  const r = data.rainbow|| {};
  const t = data.text   || {};
  appendRow(sheet,[
    now, d.staff||'', d.store||'', d.date||'',
    n.s1_customers||'0', n.s1_bills||'0', n.s1_nopurchase||'0',
    n.s2_crosssold||'0', n.s2_accessories||'0',
    n.s3_names||'0', n.s3_mobiles||'0', n.s3_dates||'0',
    n.s4_reviews||'0', n.s4_videos||'0', n.s4_complaints||'0', c.s4_resolved?'Yes':'No',
    JSON.stringify(r),
    t.s6_unavailable||'', c.s6_lowstock?'Yes':'No',
    t.s9_demand||'', t.s9_stock||'', t.s9_issue||'',
    d.submittedAt||now
  ]);
}

// ════════════════════════════════════════════════════════════════════
// POINTS HANDLER (v5.0) — logs every points award for audit
// Payload: type_, staff, form, points, breakdown (JSON array of {reason,pts}), date, submittedAt
// ════════════════════════════════════════════════════════════════════
function handlePoints(ss, d, now) {
  const sheet = getSheet(ss, SH.POINTS);
  if (isEmpty(sheet)) {
    appendRow(sheet,[
      'Timestamp','Staff','Form','Total Points','Breakdown','Date','Submitted At'
    ]);
    styleHeader(sheet);
  }
  let breakdown = [];
  try { breakdown = JSON.parse(d.breakdown || '[]'); } catch(e){}
  const breakdownStr = breakdown.map(b => (b.reason||'')+': '+(b.pts>=0?'+':'')+b.pts).join(' | ');
  appendRow(sheet,[
    now, d.staff||'', d.form||'', d.points||'0', breakdownStr, d.date||'', d.submittedAt||now
  ]);
}

// ════════════════════════════════════════════════════════════════════
// MASTER LOG
// ════════════════════════════════════════════════════════════════════
function logRecord(ss, d, now) {
  const sheet = getSheet(ss, SH.LOG);
  if (isEmpty(sheet)) {
    appendRow(sheet,[
      'timestamp','type_','sheetType','store','manager',
      'date','time','supervisor','filledBy',
      'checks','figures','attendance','mgrNotes','submittedAt'
    ]);
    styleHeader(sheet);
  }
  appendRow(sheet,[
    now, d.type_||'checklist', d.sheetType||'',
    d.store||d.location||'', d.manager||d.staff||d.by||d.executive||'',
    d.date||'', d.time||'', d.supervisor||'', d.filledBy||'',
    d.checks||'', d.figures||'', d.attendance||'',
    d.mgrNotes||'', d.submittedAt||now
  ]);
}

// ════════════════════════════════════════════════════════════════════
// EMAIL ALERTS
// ════════════════════════════════════════════════════════════════════
function sendEmailAlert(d, type, now) {
  try {
    let subject='', body='';
    if (type==='attendance') {
      subject = '✅ Attendance — '+d.store+' — '+d.date;
      let att={}; try{att=JSON.parse(d.attendance||'{}');}catch(e){}
      const lines = Object.entries(att).map(([k,v]) =>
        k.replace('att_','') + ': ' + v.status +
        ' | In:' + (v.timeIn||'—') + ' Lunch:' + (v.lunchOut||'—') +
        '→' + (v.lunchIn||'—') + ' Out:' + (v.timeOut||'—') +
        (v.remark?' | '+v.remark:'')
      );
      body = 'Store:'+d.store+'\nDate:'+d.date+'\nSupervisor:'+d.supervisor+'\n\n'+lines.join('\n');

    } else if (type==='camera') {
      subject = '📸 Camera Report — '+d.store+' — '+d.date;
      body = 'Store:'+d.store+'\nDate:'+d.date+'\nBy:'+d.by+
             '\nOpening Photos:'+d.openingPhotos+'/6'+
             '\nGrooming Done:'+d.groomingDone;

    } else if (type==='productivity') {
      subject = '⏱️ Productivity — '+d.staff+' — '+d.date;
      body = 'Staff:'+d.staff+'\nStore:'+d.store+
             '\nDate:'+d.date+'\nBlock:'+d.block+'min';

    } else if (type==='social_exec') {
      subject = '📱 Social Media — '+d.store+' — '+d.executive+' — '+d.date;
      body = 'Store:'+d.store+'\nExecutive:'+d.executive+'\nDate:'+d.date;

    } else if (type==='billing_exec') {
      let arr=[]; try{arr=JSON.parse(d.billingData||'[]');}catch(e){}
      subject = '💳 Billing — '+d.store+' — '+d.executive+' — '+d.date;
      body = 'Store:'+d.store+'\nExecutive:'+d.executive+'\nDate:'+d.date+
             '\nCustomers handled:'+arr.length;

    } else if (type==='inventory') {
      subject = '📦 Inventory — '+d.location+' — '+d.executive+' — '+d.date;
      body = 'Location:'+d.location+'\nExecutive:'+d.executive+'\nDate:'+d.date;

    } else if (type==='crm') {
      subject = '💬 CRM — '+d.store+' — '+d.executive+' — '+d.date;
      body = 'Store:'+d.store+'\nExecutive:'+d.executive+'\nDate:'+d.date;

    } else if (type==='bda') {
      subject = '🤝 BDA — '+d.store+' — '+d.executive+' — '+d.date;
      body = 'Store:'+d.store+'\nExecutive:'+d.executive+'\nDate:'+d.date;

    } else if (type==='training_daily') {
      subject = '🎓 Daily Training — '+d.executive+' — '+d.date;
      body = 'Executive:'+d.executive+'\nDate:'+d.date+'\nDone:'+d.done+'/'+d.total;

    } else if (type==='salesman_closing') {
      subject = '🛍️ Salesman Closing — '+d.store+' — '+d.staff+' — '+d.date;
      body = 'Staff:'+d.staff+'\nStore:'+d.store+'\nDate:'+d.date;

    } else if (type==='points') {
      // Skip email for points — too frequent/noisy
      return;

    } else {
      // Checklist
      let figs={}; try{figs=JSON.parse(d.figures||'{}');}catch(e){}
      let staffT={}; try{staffT=JSON.parse(d.staffTasks||'{}');}catch(e){}
      let leaves=[]; try{leaves=JSON.parse(d.leaveApps||'[]');}catch(e){}
      const st = (d.sheetType||'checklist').toUpperCase();
      const bills=figs.bills||'—';
      const sales=figs.total_sales?'₹'+parseFloat(figs.total_sales).toLocaleString('en-IN'):'—';
      const avgB=figs.bills&&figs.total_sales?
        '₹'+Math.round(parseFloat(figs.total_sales)/parseFloat(figs.bills)):'—';
      subject = '📋 '+st+' — '+d.store+' — '+(d.manager||'?')+' — '+d.date;
      body = 'Store:'+d.store+' | Type:'+st+' | Manager:'+(d.manager||'—')+
             ' | Role:'+(d.role||'—')+
             ' | Date:'+d.date+' | Time:'+(d.time||'—')+
             '\n\nBills:'+bills+' | Sales:'+sales+' | Avg Bill:'+avgB+
             '\nWalk-ins:'+(figs.walkin||'—')+' | New Customers:'+(figs.newcust||'—')+
             '\nGoogle Reviews:'+(figs.review||'—')+
             '\nWA Views:'+(figs.waviews||'—')+' | WA Replies:'+(figs.wareply||'—')+
             '\n\nPresent Staff:'+(d.presentStaff||'—')+
             '\nImportant Work:'+(d.impWork||'—')+
             (leaves.length>0?'\nLeave Applications:'+leaves.length:'');
      if(d.mgrNotes) body+='\n\nManager Notes:'+d.mgrNotes;
      // Staff tasks summary
      Object.entries(staffT).forEach(([nm,ts])=>{
        if(!Array.isArray(ts)) return;
        const pend=ts.filter(t=>t.desc&&!t.done);
        if(pend.length>0) body+='\n'+nm+' pending: '+pend.map(t=>t.desc).join(', ');
      });
      body+='\n\nSubmitted: '+now;
    }
    if (subject) MailApp.sendEmail(OWNER_EMAIL, subject, body);
  } catch(err) { Logger.log('Email error:'+err); }
}

// ════════════════════════════════════════════════════════════════════
// REPORTS + ANALYTICS
// ════════════════════════════════════════════════════════════════════
function getReports(ss, store, date, type_, limit) {
  const sheet = getSheet(ss, SH.LOG);
  const data  = sheet.getDataRange().getValues();
  if (data.length<=1) return jsonResp({records:[]});
  const headers = data[0];
  let records = data.slice(1).map(row=>{
    const obj={};
    headers.forEach((h,i)=>{ obj[String(h)]= row[i]!==undefined?String(row[i]):''; });
    return obj;
  });
  if(store) records=records.filter(r=>r.store===store);
  if(date)  records=records.filter(r=>r.date===date);
  if(type_) records=records.filter(r=>r.type_===type_||r.sheetType===type_);
  records.reverse();
  return jsonResp({records:records.slice(0,limit||300), total:records.length});
}

function getAnalytics(ss, store, month) {
  const vSheet = getSheet(ss, SH.VITALS);
  const data   = vSheet.getDataRange().getValues();
  if (data.length<=1) return jsonResp({kpis:{},days:[]});
  const headers = data[0];
  const rows = data.slice(1).filter(r=>{
    const dt = String(r[headers.indexOf('Date')]||'');
    const st = String(r[headers.indexOf('Store')]||'');
    return dt.startsWith(month||'') && (!store||st===store);
  });
  let tBills=0,tSales=0,tItems=0,tWalk=0,tRev=0,tNew=0,tRep=0;
  rows.forEach(r=>{
    tBills+=parseFloat(r[headers.indexOf('Total Bills')]||0);
    tSales+=parseFloat(r[headers.indexOf('Total Sales (Rs)')]||0);
    tItems+=parseFloat(r[headers.indexOf('Total Items Sold')]||0);
    tWalk +=parseFloat(r[headers.indexOf('Walk-ins')]||0);
    tRev  +=parseFloat(r[headers.indexOf('Google Reviews')]||0);
    tNew  +=parseFloat(r[headers.indexOf('New Customers')]||0);
    tRep  +=parseFloat(r[headers.indexOf('Repeat Customers')]||0);
  });
  const daily={};
  rows.forEach(r=>{
    const dt=String(r[headers.indexOf('Date')]||'');
    if(!daily[dt]) daily[dt]={bills:0,sales:0};
    daily[dt].bills+=parseFloat(r[headers.indexOf('Total Bills')]||0);
    daily[dt].sales+=parseFloat(r[headers.indexOf('Total Sales (Rs)')]||0);
  });
  return jsonResp({
    kpis:{
      totalBills:tBills, totalSales:tSales, totalItems:tItems,
      avgBill: tBills>0?Math.round(tSales/tBills):0,
      avgItem: tItems>0?Math.round(tSales/tItems):0,
      totalWalkin:tWalk,
      conversion:tWalk>0?Math.round((tBills/tWalk)*100):0,
      totalReviews:tRev, totalNew:tNew, totalRepeat:tRep,
      daysWithData:rows.length
    },
    days: Object.entries(daily)
      .sort((a,b)=>a[0].localeCompare(b[0]))
      .map(([date,v])=>({date,bills:v.bills,sales:v.sales}))
  });
}

// Get link for specific photo from Camera sheet
function getPhotoLink(ss, store, date, category, staffName) {
  try {
    const sheet = getSheet(ss, SH.CAMERA);
    const data  = sheet.getDataRange().getValues();
    if (data.length <= 1) return jsonResp({ status:'ok', url:'' });
    // Search from bottom (most recent)
    for (let i = data.length-1; i >= 1; i--) {
      const row = data[i];
      // Columns: Timestamp, Store, Date, By, Category, StaffName, DriveLink...
      const rowStore    = String(row[1]||'');
      const rowDate     = String(row[2]||'');
      const rowCategory = String(row[4]||'');
      const rowStaff    = String(row[5]||'');
      const rowLink     = String(row[6]||'');
      if (rowStore===store && rowDate===date &&
          rowCategory===category &&
          (!staffName || rowStaff===staffName) &&
          rowLink && rowLink.includes('drive.google.com')) {
        return jsonResp({ status:'ok', url: rowLink });
      }
    }
    return jsonResp({ status:'ok', url:'' });
  } catch(err) {
    return jsonResp({ status:'error', message: err.toString() });
  }
}

function getSheetData(ss, sheetName, store, dateOrMonth) {
  const sheet = getSheet(ss, sheetName);
  const data  = sheet.getDataRange().getValues();
  if (data.length<=1) return jsonResp({records:[]});
  const headers = data[0];
  let records = data.slice(1).map(row=>{
    const obj={};
    headers.forEach((h,i)=>{ obj[String(h)]=row[i]!==undefined?String(row[i]):''; });
    return obj;
  });
  if(store) records=records.filter(r=>r['Store']===store||r['store']===store);
  if(dateOrMonth) records=records.filter(r=>(r['Date']||r['date']||'').startsWith(dateOrMonth));
  records.reverse();
  return jsonResp({records});
}

// ════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ════════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════
// PHASE 1 — TASKS SYNC (upsert by Task ID) + STATE ENDPOINT
// ════════════════════════════════════════════════════════════════════
const TASK_HEADERS = [
  'Task ID','Store','Assigned To','Added By','Section / Source','Task',
  'Priority','Status','Due','Created Date','Done At','Carried?','Carried From','Updated At'
];
function getTasksSheet(ss) {
  let sh = ss.getSheetByName(SH.TASKS);
  // Migrate: if an old-format Tasks sheet exists (no Task ID column), park it aside
  if (sh && sh.getLastRow() > 0 && String(sh.getRange(1,1,1,1).getValue()) !== 'Task ID'
        && String(sh.getRange(1,1,1,1).getValue()) !== '') {
    try { sh.setName('Tasks (old)'); } catch(e){}
    sh = null;
  }
  if (!sh) sh = ss.getSheetByName(SH.TASKS) || ss.insertSheet(SH.TASKS);
  if (sh.getLastRow() === 0) { appendRow(sh, TASK_HEADERS); styleHeader(sh); }
  return sh;
}
function handleTaskSync(ss, d, now) {
  const sheet = getTasksSheet(ss);
  let tasks = []; try { tasks = JSON.parse(d.tasks||'[]'); } catch(e){}
  let dels  = []; try { dels  = JSON.parse(d.deletedIds||'[]'); } catch(e){}
  if (!tasks.length && !dels.length) return;
  const data = sheet.getDataRange().getValues();
  const idRow = {};
  for (let i = 1; i < data.length; i++) idRow[String(data[i][0])] = i + 1;
  tasks.forEach(t => {
    if (!t || !t.id || !t.desc) return;
    const row = [
      String(t.id), t.store||'', t.assignedTo||'', t.addedBy||'',
      t.source||'', t.desc||'', t.priority||'normal', t.status||'pending',
      t.due||'', t.date||'', t.doneAt||'', t.carried?'Yes':'No',
      t.carriedFrom||'', now
    ];
    const r = idRow[String(t.id)];
    if (r) sheet.getRange(r, 1, 1, row.length).setValues([row]);
    else { appendRow(sheet, row); idRow[String(t.id)] = sheet.getLastRow(); }
  });
  dels.forEach(id => {
    const r = idRow[String(id)];
    if (r) { sheet.getRange(r, 8).setValue('deleted'); sheet.getRange(r, 14).setValue(now); }
  });
}
// Normalize a sheet cell to 'yyyy-MM-dd' (cells may be Date objects or strings)
function dstr(v) {
  try {
    if (Object.prototype.toString.call(v) === '[object Date]')
      return Utilities.formatDate(v, 'Asia/Kolkata', 'yyyy-MM-dd');
  } catch(e){}
  return String(v||'').slice(0, 10);
}
// STATE ENDPOINT — per store per date: which forms are filled vs pending.
// Read by the app dashboard AND (Phase 3) the WhatsApp reminder triggers.
function getStateEndpoint(ss, date, storeFilter) {
  const today = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
  date = date || today;
  const cacheKey = 'state_' + date + '_' + (storeFilter||'ALL');
  const cache = CacheService.getScriptCache();
  const hit = cache.get(cacheKey);
  if (hit) return jsonResp(JSON.parse(hit));

  const stores = storeFilter ? [storeFilter] : ['BC','VKS'];
  const state = { date: date, generatedAt: nowIST(), stores: {} };
  stores.forEach(s => {
    state.stores[s] = {
      opening:    { done:false, by:'', time:'' },
      closing:    { done:false, by:'', time:'' },
      attendance: { done:false, staffMarked:0 },
      camera:     { done:false, photos:0 },
      productivity: { staffSubmitted: [] },
      tasks:      {}   // per person: {pending, doneToday}
    };
  });
  function lastRows(sheetName, max) {
    const sh = ss.getSheetByName(sheetName);
    if (!sh || sh.getLastRow() < 2) return { header: [], rows: [] };
    const total = sh.getLastRow();
    const start = Math.max(2, total - (max||500) + 1);
    return {
      header: sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String),
      rows: sh.getRange(start, 1, total - start + 1, sh.getLastColumn()).getValues()
    };
  }
  function col(header, name) { return header.indexOf(name); }

  // Checklists → opening / closing
  const cl = lastRows(SH.CHECKLIST, 600);
  if (cl.rows.length) {
    const cSt = col(cl.header,'Store'), cTy = col(cl.header,'Sheet Type'),
          cDt = col(cl.header,'Date'), cMg = col(cl.header,'Manager'), cTm = col(cl.header,'Time');
    cl.rows.forEach(r => {
      const s = String(r[cSt]||'');
      if (!state.stores[s] || dstr(r[cDt]) !== date) return;
      const ty = String(r[cTy]||'').toLowerCase();
      if (ty === 'opening') state.stores[s].opening = { done:true, by:String(r[cMg]||''), time:String(r[cTm]||'') };
      if (ty === 'closing') state.stores[s].closing = { done:true, by:String(r[cMg]||''), time:String(r[cTm]||'') };
    });
  }
  // Attendance
  const at = lastRows(SH.ATTENDANCE, 800);
  if (at.rows.length) {
    const aSt = col(at.header,'Store'), aDt = col(at.header,'Date');
    at.rows.forEach(r => {
      const s = String(r[aSt]||'');
      if (!state.stores[s] || dstr(r[aDt]) !== date) return;
      state.stores[s].attendance.done = true;
      state.stores[s].attendance.staffMarked++;
    });
  }
  // Camera
  const cm = lastRows(SH.CAMERA, 600);
  if (cm.rows.length) {
    const mSt = col(cm.header,'Store'), mDt = col(cm.header,'Date');
    cm.rows.forEach(r => {
      const s = String(r[mSt]||'');
      if (!state.stores[s] || dstr(r[mDt]) !== date) return;
      state.stores[s].camera.done = true;
      state.stores[s].camera.photos++;
    });
  }
  // Productivity
  const pr = lastRows(SH.PRODUCTIVITY, 400);
  if (pr.rows.length) {
    const pSt = col(pr.header,'Store'), pDt = col(pr.header,'Date'), pNm = col(pr.header,'Staff');
    pr.rows.forEach(r => {
      const s = String(r[pSt]||'');
      if (!state.stores[s] || dstr(r[pDt]) !== date) return;
      const nm = String(r[pNm]||'');
      if (nm && state.stores[s].productivity.staffSubmitted.indexOf(nm) < 0)
        state.stores[s].productivity.staffSubmitted.push(nm);
    });
  }
  // Tasks (new layout) — pending counts + done-today per assignee
  const tk = lastRows(SH.TASKS, 1000);
  if (tk.header[0] === 'Task ID' && tk.rows.length) {
    tk.rows.forEach(r => {
      const s = String(r[1]||''), who = String(r[2]||'') || 'Unassigned';
      const status = String(r[7]||'');
      if (status === 'deleted') return;
      const target = state.stores[s] ? [s] : stores;   // storeless tasks count everywhere
      target.forEach(st => {
        if (!state.stores[st].tasks[who]) state.stores[st].tasks[who] = { pending:0, doneToday:0 };
        if (status === 'pending') state.stores[st].tasks[who].pending++;
        else if (status === 'done' && dstr(r[10]) === date) state.stores[st].tasks[who].doneToday++;
      });
    });
  }
  const payload = { status:'ok', state: state };
  try { cache.put(cacheKey, JSON.stringify(payload), 60); } catch(e){}
  return jsonResp(payload);
}

// ════════════════════════════════════════════════════════════════════
// PHASE 0 — SUBMISSION LOG (duplicate protection + read-back verification)
// ════════════════════════════════════════════════════════════════════
function isDuplicateCid(cid) {
  if (!cid) return false;
  try {
    const cache = CacheService.getScriptCache();
    if (cache.get('cid_' + cid)) return true;
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(SH.SUBMITLOG);
    if (!sh || sh.getLastRow() < 2) return false;
    const found = sh.createTextFinder(cid).matchEntireCell(true).findNext();
    return !!found;
  } catch(err) { return false; }
}
function logCid(ss, cid, type) {
  if (!cid) return;
  try {
    CacheService.getScriptCache().put('cid_' + cid, '1', 21600); // 6h fast-path
    const sh = getSheet(ss, SH.SUBMITLOG);
    if (isEmpty(sh)) { appendRow(sh, ['Timestamp','CID','Type']); styleHeader(sh); }
    appendRow(sh, [nowIST(), cid, type]);
    // Keep the log lean — trim oldest 500 once it passes 3000 rows
    if (sh.getLastRow() > 3000) sh.deleteRows(2, 500);
  } catch(err) { Logger.log('logCid error: ' + err); }
}

function nowIST() {
  return new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'});
}
function getSheet(ss,name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}
function isEmpty(s) { return s.getLastRow()===0; }
function appendRow(s, row) { s.appendRow(row); }
function styleHeader(s) {
  const cols = Math.max(s.getLastColumn(),1);
  const rng  = s.getRange(1,1,1,cols);
  rng.setBackground('#1A1A1A').setFontColor('#FFFFFF')
     .setFontWeight('bold').setFontSize(10).setWrap(true);
  s.setFrozenRows(1);
  s.setRowHeight(1,34);
}
function jsonResp(obj) {
  // Add CORS headers so browser can read the response
  const output = ContentService.createTextOutput(JSON.stringify(obj));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

// doOptions handles CORS preflight
function doOptions(e) {
  return ContentService.createTextOutput('')
    .setMimeType(ContentService.MimeType.TEXT);
}
function safeParam(e,key) {
  return (e && e.parameter && e.parameter[key]) ? e.parameter[key] : '';
}

// ════════════════════════════════════════════════════════════════════
// TEST FUNCTIONS — run these one by one to verify
// ════════════════════════════════════════════════════════════════════

// RUN THIS FIRST — creates all sheet tabs
function createAllSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const allSheets = [
    SH.CHECKLIST, SH.ATTENDANCE, 'Attendance Summary',
    SH.CAMERA, SH.GROOMING,
    SH.PRODUCTIVITY, 'Productivity Detail',
    SH.TASKS, SH.DIGITAL,
    SH.STAFF_ASSIGN, SH.TRAINING,
    SH.LEAVE, SH.INTERCHANGE,
    SH.WA_GROUPS, SH.VITALS, SH.LOG,
    SH.SOCIAL_EXEC, SH.BILLING_EXEC, SH.BILLING_CUST,
    SH.INVENTORY, SH.CRM, SH.BDA,
    SH.DAILY_TRAINING, SH.SALESMAN, SH.POINTS
  ];
  allSheets.forEach(name => {
    const exists = !!ss.getSheetByName(name);
    Logger.log((exists ? '✅ Already exists: ' : '✅ Created: ') + name);
    if (!exists) ss.insertSheet(name);
  });
  Logger.log('\n🎉 All '+allSheets.length+' sheets ready!');
}

// RUN SECOND — confirms connection
function testSetup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('✅ Spreadsheet: ' + ss.getName());
  Logger.log('✅ Owner email: ' + OWNER_EMAIL);
  Logger.log('✅ Sheets: ' + ss.getSheets().map(s=>s.getName()).join(', '));
  Logger.log('✅ All good — ready to Deploy!');
}

// RUN THIRD — sends test email
function testEmail() {
  MailApp.sendEmail(OWNER_EMAIL,
    '✅ BE App — Connection Confirmed!',
    'Your Bhartia Enterprises App is connected to Google Sheets!\n\n'+
    'Email alerts will come to: '+OWNER_EMAIL+'\n\n'+
    'Sheets connected:\n'+
    '• Checklists\n• Attendance\n• Camera Reports\n• Staff Grooming\n'+
    '• Productivity\n• Tasks\n• Digital Media\n• Staff Assignment\n'+
    '• Training\n• Leave Applications\n• Staff Interchange\n'+
    '• Daily Vitals\n• All Records\n'+
    '• Social Media Exec\n• Billing Exec Summary\n• Billing Customers\n'+
    '• Inventory\n• CRM\n• BDA\n• Daily Training (10-min)\n'+
    '• Salesman Closing\n• Points Log\n\n'+
    'Setup complete! ✅'
  );
  Logger.log('✅ Test email sent to '+OWNER_EMAIL);
}

// RUN FOURTH — writes sample data to all sheets
function testFullSubmission() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const now = nowIST();
  const today = new Date().toISOString().slice(0,10);

  const d = {
    type_:'checklist', sheetType:'closing', store:'BC',
    manager:'Sikander', role:'Manager', date:today, time:'21:00',
    supervisor:'Neel', filledBy:'Manager',
    checks: JSON.stringify({
      infra_prayer:true, infra_vision:true, infra_lights:true,
      infra_floor:true, cbill_erp:true, cbill_cash:true, cbill_upi:true,
      cstaff_targets:true, cstaff_lockup:true
    }),
    figures: JSON.stringify({
      bills:'20', total_sales:'60000', items:'42',
      newcust:'14', repeat:'6', walkin:'32',
      rbsold:'5', review:'3', waviews:'180',
      wareply:'8', fbreply:'12', instreply:'6',
      coupon:'10', contacts:'35', total_videos:'2'
    }),
    staffTasks: JSON.stringify({
      'Ramu':    [{desc:'Stock setting - men section',pri:'normal',done:true},
                  {desc:'Numbering new arrivals',pri:'urgent',done:false}],
      'Sikander':[{desc:'ERP billing done',pri:'normal',done:true}],
      'Krishna': [{desc:'Trial room cleaning',pri:'low',done:true}]
    }),
    training: JSON.stringify({
      'Ramu':    {subject:'Sales pitch for kurta',mins:'20',result:'Good response'},
      'Sikander':{subject:'ERP billing speed',mins:'15',result:'Improved'}
    }),
    leaveApps: JSON.stringify([
      {name:'Bijay',type:'sick',from:today,to:today,reason:'Fever',granted:'yes'}
    ]),
    interchanges: JSON.stringify([
      {name:'Kundan',from:'VKS',to:'BC',direction:'in'}
    ]),
    waGroups: JSON.stringify([
      {group:'BC Wedding Clients',count:'12',from:'2026-05-01',to:today}
    ]),
    presentStaff: JSON.stringify(['Ramu','Sikander','Krishna','Kundan']),
    priorities: JSON.stringify(['Complete numbering','Call MKK supplier','Update WA status']),
    priAssign:  JSON.stringify(['Ramu','Sikander','Krishna']),
    impWork: 'Clear RB stock - wedding season push',
    mgrNotes: 'Good day — 20 bills. Ramu performed well.',
    submittedAt: new Date().toISOString()
  };

  handleChecklist(ss, d, now);
  logRecord(ss, d, now);
  Logger.log('✅ Test submission complete!');
  Logger.log('📊 Check these sheets: Checklists, Staff Assignment, Digital Media, Training, Leave Applications, Daily Vitals');
}

// RUN FIFTH — writes sample data to all NEW v5.0 sheets
function testNewSheetsSubmission() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const now = nowIST();
  const today = new Date().toISOString().slice(0,10);

  handleSocialExec(ss, {
    store:'BC', date:today, executive:'Test SME',
    socialExecData: JSON.stringify({
      instagram:{ video:{shot:true,edited:true,posted:true,posted_ts:'11:30'}, photo:{captured:true,edited:false,posted:false} },
      facebook: { video:{shot:true,edited:false,posted:false}, photo:{captured:false,edited:false,posted:false} }
    }),
    submittedAt:new Date().toISOString()
  }, now);

  handleBillingExec(ss, {
    store:'BC', date:today, executive:'Test Billing',
    billingData: JSON.stringify([
      {name:'Rahul Sharma', mobile:'9876543210', whatsapp:'9876543210', city:'Sikar', occasion:'Wedding',
       interest:'Sherwani', status:'Purchased', bill_no:'B123', bill_amt:'25000', source:'Walk-in',
       steps:{lead:{name:true,mobile:true}, xsell:{suggested:true,added:true}, slip:{bill:true,handed:true}, review:{asked:true}, coupon:{}},
       review_done:true, coupon_done:true, lost:false, ts:'11:00'}
    ]),
    submittedAt:new Date().toISOString()
  }, now);

  handleInventory(ss, {
    location:'HO Warehouse', date:today, executive:'Test Inventory',
    invData: JSON.stringify({
      checks:{fast_noted:true, fast_size_color:true, slow_flagged:true, replenish_sent:true, arr_size:true, bc_all:true, mgr_updated:true},
      fields:{fast_sku:'Sherwani M cream', slow_7:'Old jodhpuri stock', replenish_list:'Kurta L blue x10', bc_pending:'0'}
    }),
    submittedAt:new Date().toISOString()
  }, now);

  handleCRM(ss, {
    store:'BC', date:today, executive:'Test CRM',
    crmData: JSON.stringify({
      checks:{added_group:true, welcome_sent:true, followup_prev:true},
      fields:{count_collected:'15', count_added:'15'}
    }),
    submittedAt:new Date().toISOString()
  }, now);

  handleBDA(ss, {
    store:'VKS', date:today, executive:'Test BDA',
    bdaData: JSON.stringify({
      checks:{c_new_partner:true, c_followup:true, c_offer:true, c_wa:true},
      fields:{partners_met:'ABC Wedding Planner', partner_type:'Wedding Planner', new_tieups:'1', referrals_recv:'3', referral_sales:'45000'}
    }),
    submittedAt:new Date().toISOString()
  }, now);

  handleDailyTraining(ss, {
    executive:'Test Executive', date:today, done:6, total:7,
    trainData: JSON.stringify({checks:{greeting:true,need:true,stages:true,objection:true,crosssell:true,review:true}}),
    submittedAt:new Date().toISOString()
  }, now);

  handleSalesmanClosing(ss, {
    staff:'Test Salesman', store:'BC', date:today,
    salesData: JSON.stringify({
      checks:{s1_attend:true, s1_ask:true, s2_addl:true, s4_resolved:true, s6_lowstock:true},
      nums:{s1_customers:'12', s1_bills:'8', s2_crosssold:'3', s3_names:'10', s3_mobiles:'9', s4_reviews:'2'},
      rainbow:{'Sherwani':'2','Kurta Pajama':'3'},
      text:{s9_issue:'None'}
    }),
    submittedAt:new Date().toISOString()
  }, now);

  handlePoints(ss, {
    staff:'Test Executive', form:'Test Form', points:'10',
    breakdown: JSON.stringify([{reason:'Section filled',pts:1},{reason:'Punctual',pts:5},{reason:'Early bird',pts:3}]),
    date:today, submittedAt:new Date().toISOString()
  }, now);

  Logger.log('✅ v5.0 test submissions complete!');
  Logger.log('📊 Check: Social Media Exec, Billing Exec Summary, Billing Customers, Inventory, CRM, BDA, Daily Training (10-min), Salesman Closing, Points Log');
}
