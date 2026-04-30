/**
 * ============================================================
 *  Study Grid Prep — admin-mock.js  (v3.0 — Production)
 *
 *  Architecture: TEST-FIRST → ADD QUESTIONS → PUBLISH
 *
 *  Collections:
 *    mockTests        — test metadata (draft / published / archived)
 *    mockQuestions    — individual questions tagged to a testId
 *    activeTests      — live users currently taking a test
 *    userTestHistory  — completed test records per user
 *    announcements    — broadcast announcements (mock-home)
 *    promotions       — popup/banner/modal promotions (mock-home)
 *    notifications    — push notification queue
 *    maintenance      — maintenance mode config
 * ============================================================
 */

import {
  auth,
  onAuthStateChanged,
  signOut,
  db,
  collection,
  addDoc,
  getDocs,
  doc,
  setDoc,
  getDoc,
  deleteDoc,
  updateDoc,
  increment,
  onSnapshot,
  query,
  orderBy,
  where,
  limit,
  serverTimestamp,
  writeBatch
} from '../firebase.js';

// ============================================================
//  CONSTANTS
// ============================================================

const ADMIN_CODE   = "7905";
const ADMIN_EMAILS = ["untitledworld9@gmail.com", "ayushgupt640@gmail.com"];

const COLL = {
  TESTS:        "mockTests",
  QUESTIONS:    "mockQuestions",
  ACTIVE:       "activeTests",
  LIVE_USERS:   "liveUsers",
  HISTORY:      "userTestHistory",
  ANNOUNCEMENTS:"announcements",
  PROMOTIONS:   "promotions",
  NOTIFICATIONS:"notifications",
  MAINTENANCE:  "maintenance",
  DRAFTS:       "mockDrafts"
};

// ============================================================
//  STATE
// ============================================================

const STATE = {
  adminUser:      null,

  // Draft in-memory question queue (before publish)
  activeTest:     null,        // { id, exam, year, date, shift, ... }
  draftQuestions: [],          // [{subject, questionNo, question, options, correctAnswer, type, section}]

  // Live Firestore data
  allTests:       [],          // from mockTests
  allHistory:     [],          // from userTestHistory
  liveUsers:      [],          // from activeTests

  // Unsub handles
  unsubTests:     null,
  unsubActive:    null,
  unsubLiveUsers: null,
  unsubHistory:   null,
  unsubAnnounce:  null,
  unsubPromo:     null,
  unsubNotify:    null,

  // Question block counter
  qBlockCount:    0
};

// ============================================================
//  COMPUTE MAX MARKS & BUILD TEST LABEL
// ============================================================

function computeMaxMarks(h) {
  const totalQ = h.total ?? 0;
  if (!totalQ) return '—';
  const marking = h.marking || ((h.exam||'').toLowerCase() === 'jee' ? '+4/-1' : '+5/-1');
  const pos = parseInt((marking||'').split('/')[0]) || ((h.exam||'').toLowerCase() === 'jee' ? 4 : 5);
  return totalQ * pos;
}

function buildTestLabel(h) {
  if (h.testName && h.testName.trim()) return h.testName.trim();
  const exam = (h.exam || '').toUpperCase();
  const year = h.year || '';
  const subs = Array.isArray(h.subjects) && h.subjects.length
    ? h.subjects.join(', ')
    : (h.shift || '');
  return (exam + ' ' + year + (subs ? ' — ' + subs : '')).trim() || '—';
}

// ============================================================
//  DOM HELPER
// ============================================================

const $ = id => document.getElementById(id);

// ============================================================
//  TOAST
// ============================================================

window.toast = function(message, type = 'info', duration = 3800) {
  const container = $('toastContainer');
  if (!container) return;
  const icons = { success:'<i class="fa-solid fa-circle-check"></i>', error:'<i class="fa-solid fa-circle-xmark"></i>', info:'<i class="fa-solid fa-circle-info"></i>', warning:'<i class="fa-solid fa-triangle-exclamation"></i>' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span style="font-size:14px;flex-shrink:0;">${icons[type] || ''}</span><span>${escHtml(message)}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('removing');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, duration);
};

// ============================================================
//  CONFIRM MODAL
// ============================================================

let _confirmResolve = null;

function confirmModal(title, body) {
  return new Promise(resolve => {
    _confirmResolve = resolve;
    $('confirmTitle').textContent = title;
    $('confirmBody').textContent  = body;
    // FIX: Do NOT call closeModal() here — closeModal resolves with false, which
    // would override resolve(true) since a Promise can only settle once.
    // Instead, close the modal directly and then resolve(true).
    $('confirmOkBtn').onclick = () => {
      $('confirmModal').classList.remove('open');
      _confirmResolve = null;
      resolve(true);
    };
    $('confirmModal').classList.add('open');
  });
}

window.closeModal = () => {
  $('confirmModal').classList.remove('open');
  if (_confirmResolve) {
    const res = _confirmResolve;
    _confirmResolve = null;
    res(false); // cancel / backdrop click → false
  }
};

// ============================================================
//  SECTION NAV
// ============================================================

window.showSection = id => {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  const target = $(id);
  if (target) target.classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === id);
  });
  closeSidebar();

  // Lazy load per section
  if (id === 'sectionTestManager')  applyTestFilters();
  if (id === 'sectionUserHistory')  applyHistoryFilters();
  if (id === 'sectionPublish')      renderPublishSummary(); // async — runs independently
  if (id === 'sectionAddQuestions') { refreshActiveTestBanner(); renderSubjectNav(); }
  if (id === 'sectionUserAttempts') { applyAttemptFilters(); renderAttemptsRecent(); }
  if (id === 'sectionUserList')     renderUserList();
};

// ============================================================
//  SIDEBAR (mobile)
// ============================================================

window.toggleSidebar = () => {
  $('sidebar').classList.toggle('open');
  $('mobOverlay').classList.toggle('open');
};
window.closeSidebar = () => {
  $('sidebar').classList.remove('open');
  $('mobOverlay').classList.remove('open');
};

// ============================================================
//  BROADCAST TABS
// ============================================================

window.switchBroadcastTab = (paneId, btnEl) => {
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  $(paneId).classList.add('active');
  btnEl.classList.add('active');
};

// ============================================================
//  AUTH GATE
// ============================================================

window.verifyAdmin = async () => {
  const code  = $('adminCodeInput').value.trim();
  const errEl = $('authError');
  const btn   = document.querySelector('.auth-btn');

  if (code !== ADMIN_CODE) {
    errEl.textContent = 'Incorrect access code.';
    $('adminCodeInput').value = '';
    $('adminCodeInput').focus();
    return;
  }

  btn.disabled    = true;
  btn.textContent = 'Verifying...';
  errEl.textContent = '';

  try {
    const user = await new Promise((resolve, reject) => {
      const unsub = onAuthStateChanged(auth, u => { unsub(); resolve(u); }, reject);
    });

    if (!user) {
      errEl.textContent = 'Not signed in. Please sign in first.';
      btn.disabled = false; btn.textContent = 'Verify Access'; return;
    }

    if (!ADMIN_EMAILS.includes(user.email)) {
      errEl.textContent = 'This account does not have admin access.';
      btn.disabled = false; btn.textContent = 'Verify Access'; return;
    }

    STATE.adminUser = user;
    initAdminPanel(user);
  } catch(err) {
    errEl.textContent = 'Auth error: ' + err.message;
    btn.disabled = false; btn.textContent = 'Verify Access';
  }
};

function initAdminPanel(user) {
  const gate = $('authGate');
  if (gate) { gate.style.opacity = '0'; gate.style.transition = 'opacity .4s'; setTimeout(() => gate.remove(), 400); }

  const initial = (user.displayName || user.email || 'A').charAt(0).toUpperCase();
  if ($('adminAvatar')) $('adminAvatar').textContent = initial;
  if ($('adminName'))   $('adminName').textContent   = user.displayName || 'Admin';
  if ($('adminEmail'))  $('adminEmail').textContent  = user.email;

  // Start all live listeners
  listenTests();
  listenActiveUsers();
  // listenLiveUsers() — needs Firestore rule: match /liveUsers/{id} { allow read,write: if request.auth != null; }
  listenUserHistory();
  listenAnnouncements();
  listenPromotions();
  listenNotifications();
  loadMaintenance();
  restoreDraftFromFirestore();
}


// ============================================================
//  DRAFT RESTORE — Reload-safe: restores draft from Firestore
// ============================================================

/**
 * On every page load, check if any mockTests doc has status='draft'
 * and has questions in mockDrafts/{testId}/questions.
 * If yes, restore STATE.activeTest and rebuild the question builder DOM.
 * This is what makes drafts survive page reload.
 */
async function restoreDraftFromFirestore() {
  try {
    // Find the most recent draft test
    const draftSnap = await getDocs(
      query(
        collection(db, COLL.TESTS),
        where('status', '==', 'draft'),
        orderBy('createdAt', 'desc'),
        limit(1)
      )
    );

    if (draftSnap.empty) return; // No draft test found

    const draftTestDoc = draftSnap.docs[0];
    const testData = { id: draftTestDoc.id, ...draftTestDoc.data() };

    // Check if there are draft questions for this test
    const draftQSnap = await getDocs(
      query(
        collection(db, COLL.DRAFTS, testData.id, 'questions'),
        orderBy('questionNo')
      )
    );

    // Restore STATE.activeTest
    STATE.activeTest     = testData;
    STATE.draftQuestions = [];
    STATE.qBlockCount    = 0;

    if ($('qBuilderWrap')) $('qBuilderWrap').innerHTML = '';

    if (!draftQSnap.empty) {
      // Restore each question block from Firestore into the DOM
      draftQSnap.docs.forEach(qDoc => {
        const q = qDoc.data();
        restoreQuestionBlock({
          fsId:          qDoc.id,
          subject:       q.subject       || 'General',
          section:       q.section       || '',
          type:          q.type          || 'mcq',
          question:      q.questionText  || q.question || '',
          optionA:       q.options?.[0]  || '',
          optionB:       q.options?.[1]  || '',
          optionC:       q.options?.[2]  || '',
          optionD:       q.options?.[3]  || '',
          correctAnswer: q.correctAnswer || '',
          questionNo:    q.questionNo    || 1
        });
      });

      toast(
        `Draft restored: ${testData.exam?.toUpperCase()} ${testData.year} · ${testData.shift} (${draftQSnap.size} questions)`,
        'info',
        5000
      );
    } else {
      // Draft test exists but no questions yet — still restore the test
      toast(
        `Draft test restored: ${testData.exam?.toUpperCase()} ${testData.year} · ${testData.shift}`,
        'info',
        4000
      );
    }

    refreshActiveTestBanner();
    renderSubjectNav();

  } catch(err) {
    // Silently fail — this is best-effort restore
    console.warn('restoreDraftFromFirestore error:', err);
  }
}

/**
 * Restore a single question block into the DOM from saved Firestore data.
 * Unlike addQuestionBlock() which creates empty blocks, this fills in all values
 * and does NOT re-save to Firestore (data already exists there).
 */
function restoreQuestionBlock(data) {
  const wrap = $('qBuilderWrap');
  if (!wrap) return;

  const idx   = STATE.qBlockCount++;
  const qno   = data.questionNo || idx + 1;
  const block = document.createElement('div');
  block.className = 'q-block';
  block.id = `qBlock_${idx}`;

  block.innerHTML = `
    <div class="q-block-header">
      <div class="q-block-num">${qno}</div>
      <div class="q-block-label">Question ${qno}</div>
      <button class="q-block-remove" onclick="removeQuestionBlock(${idx})">
        <i class="fa-solid fa-xmark"></i> Remove
      </button>
    </div>

    <div class="form-grid cols-3" style="margin-bottom:12px;">
      <div class="form-group">
        <label class="form-label">Subject</label>
        <input class="form-control q-subject" type="text"
               placeholder="Physics / Maths / GT..."
               oninput="syncDefaultSubject(this)">
      </div>
      <div class="form-group">
        <label class="form-label">Section (optional)</label>
        <input class="form-control q-section" type="text" placeholder="Section A / B...">
      </div>
      <div class="form-group">
        <label class="form-label">Type</label>
        <select class="form-control q-type" onchange="handleQTypeChange(this, ${idx})">
          <option value="mcq">MCQ</option>
          <option value="integer">Integer Type</option>
        </select>
      </div>
    </div>

    <div class="form-group" style="margin-bottom:12px;">
      <label class="form-label">Question Text</label>
      <textarea class="form-control q-text" rows="3" placeholder="Enter the full question text here..."></textarea>
    </div>

    <div class="q-mcq-wrap" id="qMcqWrap_${idx}">
      <div class="form-label" style="margin-bottom:8px;">Options</div>
      <div class="options-grid">
        <div class="opt-inp-wrap"><div class="opt-letter-badge">A</div><input class="opt-inp q-optA" type="text" placeholder="Option A"></div>
        <div class="opt-inp-wrap"><div class="opt-letter-badge">B</div><input class="opt-inp q-optB" type="text" placeholder="Option B"></div>
        <div class="opt-inp-wrap"><div class="opt-letter-badge">C</div><input class="opt-inp q-optC" type="text" placeholder="Option C"></div>
        <div class="opt-inp-wrap"><div class="opt-letter-badge">D</div><input class="opt-inp q-optD" type="text" placeholder="Option D"></div>
      </div>
    </div>

    <div class="form-grid" style="margin-top:12px;">
      <div class="form-group">
        <label class="form-label">Correct Answer</label>
        <input class="form-control q-correct" type="text" placeholder="A / B / C / D / integer value">
      </div>
      <div class="form-group">
        <label class="form-label">Q. No.</label>
        <input class="form-control q-qno" type="number" value="${qno}" min="1">
      </div>
    </div>
  `;

  // Fill in saved values
  block.querySelector('.q-subject').value = data.subject    || '';
  block.querySelector('.q-section').value = data.section    || '';
  block.querySelector('.q-text').value    = data.question   || '';
  block.querySelector('.q-correct').value = data.correctAnswer || '';
  block.querySelector('.q-qno').value     = qno;

  if (data.type) {
    const typeEl = block.querySelector('.q-type');
    if (typeEl) {
      typeEl.value = data.type;
      if (data.type === 'integer') {
        const mcqWrap = block.querySelector(`#qMcqWrap_${idx}`);
        if (mcqWrap) mcqWrap.style.display = 'none';
      }
    }
  }

  if (data.type !== 'integer') {
    block.querySelector('.q-optA').value = data.optionA || '';
    block.querySelector('.q-optB').value = data.optionB || '';
    block.querySelector('.q-optC').value = data.optionC || '';
    block.querySelector('.q-optD').value = data.optionD || '';
  }

  wrap.appendChild(block);

  // Track in STATE with the Firestore doc ID — do NOT re-save to Firestore
  STATE.draftQuestions.push({ _blockId: idx, _fsId: data.fsId || null });
}

// ============================================================
//  STEP 1 — CREATE TEST
// ============================================================

/** Select exam card (CUET / JEE) */
window.selectExamCard = exam => {
  $('cuetSelectorCard').className = 'exam-selector-card' + (exam === 'cuet' ? ' selected-cuet' : '');
  $('jeeSelectorCard').className  = 'exam-selector-card' + (exam === 'jee'  ? ' selected-jee'  : '');
  $('ctExamCuet').checked = exam === 'cuet';
  $('ctExamJee').checked  = exam === 'jee';
  handleCreateExamChange();
};

window.handleCreateExamChange = () => {
  const exam = $('ctExamCuet').checked ? 'cuet' : ($('ctExamJee').checked ? 'jee' : '');
  $('ctCuetFields').style.display = exam === 'cuet' ? 'block' : 'none';
  $('ctJeeFields').style.display  = exam === 'jee'  ? 'block' : 'none';
  if (exam === 'cuet') { $('ctTotalQ').value = 50; $('ctDuration').value = 60; if ($('ctMarking')) $('ctMarking').value = '+5/-1'; }
  if (exam === 'jee')  { $('ctTotalQ').value = 75; $('ctDuration').value = 180; if ($('ctMarking')) $('ctMarking').value = '+4/-1'; }
};

window.resetCreateForm = () => {
  ['ctYear','ctDate','ctShift','ctDuration','ctTotalQ','ctPaper','ctDesc'].forEach(id => { if ($(id)) $(id).value = ''; });
  $('ctTotalQ').value = '50'; $('ctDuration').value = '180';
  $('cuetSelectorCard').className = 'exam-selector-card';
  $('jeeSelectorCard').className  = 'exam-selector-card';
  $('ctExamCuet').checked = false; $('ctExamJee').checked = false;
  $('ctCuetFields').style.display = 'none';
  $('ctJeeFields').style.display  = 'none';
};

window.createTest = async () => {
  const exam = $('ctExamCuet').checked ? 'cuet' : ($('ctExamJee').checked ? 'jee' : '');
  if (!exam) { toast('Please select an exam (CUET or JEE).', 'warning'); return; }

  const year       = parseInt($('ctYear').value) || new Date().getFullYear();
  const date       = $('ctDate').value;
  const shift      = $('ctShift').value;
  const duration   = parseInt($('ctDuration').value) || 180;
  const totalQ     = parseInt($('ctTotalQ').value) || 50;
  const marking    = $('ctMarking').value;
  const desc       = $('ctDesc').value.trim();
  const paper      = $('ctPaper')?.value.trim() || '';
  const testName   = $('ctTestName')?.value.trim() || '';

  if (!shift) { toast('Please select a shift.', 'warning'); return; }
  if (!date)  { toast('Please select the exam date.', 'warning'); return; }

  // Get selected subjects from checkboxes
  const subjCheckboxes = document.querySelectorAll(
    exam === 'cuet' ? 'input[name="cuetSubj"]:checked' : 'input[name="jeeSubj"]:checked'
  );
  const selectedSubjects = [...subjCheckboxes].map(cb => cb.value);
  if (selectedSubjects.length === 0) {
    toast('Please select at least one subject.', 'warning'); return;
  }

  const btn = document.querySelector('[onclick="createTest()"]');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Creating...';

  try {
    const testData = {
      exam,
      year,
      date,
      shift,
      duration,
      totalQuestions: totalQ,
      marking,
      testName:     testName || null,
      description: desc || null,
      paper:        (exam === 'cuet' && paper) ? paper : null,
      status:       'draft',
      questionCount: 0,
      subjects:     selectedSubjects,
      createdAt:    serverTimestamp(),
      createdBy:    STATE.adminUser?.email || 'admin'
    };

    const docRef = await addDoc(collection(db, COLL.TESTS), testData);
    
    // Set as active test in memory
    STATE.activeTest     = { id: docRef.id, ...testData };
    STATE.draftQuestions = [];
    STATE.qBlockCount    = 0;

    toast(`Test created! ${exam.toUpperCase()} ${year} · ${shift}`, 'success');
    refreshActiveTestBanner();
    resetCreateForm();

    // Proceed to add questions
    showSection('sectionAddQuestions');
    renderSubjectNav();
    // Seed first question block for first subject
    addQuestionBlock();
  } catch(err) {
    toast('Create failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-circle-plus"></i> Create Test & Proceed to Questions';
  }
};

// ============================================================
//  SUBJECT NAV (Add Questions section)
// ============================================================

/**
 * Renders the left subject navigation panel in the Add Questions section.
 * Shows each subject from the active test with a button to set defaultSubject.
 */
function renderSubjectNav() {
  const panel   = $('subjectNavPanel');
  const navList = $('subjectNavList');
  if (!panel || !navList) return;

  if (!STATE.activeTest || !Array.isArray(STATE.activeTest.subjects) || STATE.activeTest.subjects.length === 0) {
    panel.style.display = 'none';
    return;
  }

  panel.style.display = 'block';
  const subjects = STATE.activeTest.subjects;

  navList.innerHTML = subjects.map((sub, i) => {
    const qCount = STATE.draftQuestions.filter(q => {
      const block = $(`qBlock_${q._blockId}`);
      if (!block) return false;
      const s = block.querySelector('.q-subject')?.value.trim().toLowerCase();
      return s === sub.toLowerCase();
    }).length;
    return `
    <button onclick="switchSubjectNav('${escHtml(sub)}')"
      id="subNav_${i}"
      style="width:100%;text-align:left;padding:9px 12px;border-radius:var(--radius-md);
      background:rgba(255,255,255,.04);border:1px solid var(--border);
      color:var(--text-secondary);font-family:var(--font-body);font-size:12px;font-weight:600;
      cursor:pointer;transition:.18s;display:flex;align-items:center;justify-content:space-between;gap:6px;"
      onmouseover="this.style.color='var(--accent-cyan)';this.style.borderColor='rgba(0,224,255,.2)'"
      onmouseout="this.style.color='var(--text-secondary)';this.style.borderColor='var(--border)'">
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(sub)}</span>
      <span style="font-size:10px;background:rgba(0,224,255,.08);border:1px solid rgba(0,224,255,.15);
        color:var(--accent-cyan);border-radius:99px;padding:1px 7px;flex-shrink:0;">${qCount}</span>
    </button>`;
  }).join('');
}

window.switchSubjectNav = function(subject) {
  // Set default subject input
  const defSubj = $('defaultSubject');
  if (defSubj) defSubj.value = subject;
  // Also update subject field in the latest empty block (if any)
  const blocks = document.querySelectorAll('.q-block');
  let filledLast = false;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const subInp = blocks[i].querySelector('.q-subject');
    if (subInp && !subInp.value.trim()) {
      subInp.value = subject;
      filledLast = true;
      break;
    }
  }
  if (!filledLast) {
    // Add new block for this subject
    addQuestionBlock();
    const newBlocks = document.querySelectorAll('.q-block');
    const last = newBlocks[newBlocks.length - 1];
    if (last) {
      const subInp = last.querySelector('.q-subject');
      if (subInp) subInp.value = subject;
    }
  }
  toast(`Working on: ${subject}`, 'info', 2000);
};

// ============================================================
//  EDIT PUBLISHED TEST
// ============================================================

window.editPublishedTest = async (id) => {
  const t = STATE.allTests.find(x => x.id === id);
  if (!t) return;

  const yes = await confirmModal(
    'Edit Published Test',
    `Edit "${t.testName || (t.exam?.toUpperCase() + ' ' + t.year + ' · ' + t.shift)}"? You can modify questions. Test will stay published.`
  );
  if (!yes) return;

  STATE.activeTest     = { ...t };
  STATE.draftQuestions = [];
  STATE.qBlockCount    = 0;
  if ($('qBuilderWrap')) $('qBuilderWrap').innerHTML = '';

  showSection('sectionAddQuestions');
  refreshActiveTestBanner();
  renderSubjectNav();

  // Load existing published questions from Firestore
  toast('Loading existing questions...', 'info', 3000);
  try {
    const qSnap = await getDocs(
      query(
        collection(db, COLL.QUESTIONS),
        where('testId', '==', id),
        orderBy('questionNo')
      )
    );
    if (!qSnap.empty) {
      qSnap.docs.forEach(qDoc => {
        const q = qDoc.data();
        restoreQuestionBlock({
          fsId:          qDoc.id,
          subject:       q.subject       || 'General',
          section:       q.section       || '',
          type:          q.type          || 'mcq',
          question:      q.questionText  || q.question || '',
          optionA:       q.options?.[0]  || '',
          optionB:       q.options?.[1]  || '',
          optionC:       q.options?.[2]  || '',
          optionD:       q.options?.[3]  || '',
          correctAnswer: q.correctAnswer || '',
          questionNo:    q.questionNo    || 1
        });
      });
      toast(`Loaded ${qSnap.size} questions. Edit and re-publish.`, 'success', 5000);
    } else {
      toast('No questions found. Add new ones.', 'info', 4000);
    }
  } catch(err) {
    toast('Could not load questions: ' + err.message, 'error');
  }
};

// ============================================================
//  STEP 2 — QUESTION BUILDER
// ============================================================

function refreshActiveTestBanner() {
  const banner     = $('activeTestBanner');
  const nameEl     = $('activeTestName');
  const metaEl     = $('activeTestMeta');
  const counterEl  = $('qCounter');
  const draftBadge = $('qDraftBadge');

  if (!STATE.activeTest) {
    banner.className = 'active-test-banner no-test';
    if (nameEl) nameEl.textContent = 'No test selected';
    if (metaEl) metaEl.textContent = 'Create a test first in Step 1';
    if (counterEl) counterEl.textContent = '0 / 0 Questions';
    if (draftBadge) draftBadge.style.display = 'none';
    return;
  }

  const t = STATE.activeTest;
  banner.className = 'active-test-banner';
  banner.querySelector('.active-test-dot').style.background = 'var(--accent-green)';
  banner.querySelector('.active-test-dot').style.boxShadow  = '0 0 8px rgba(0,229,160,.6)';
  if (nameEl) nameEl.textContent = t.testName || `${t.exam.toUpperCase()} Mock ${t.year} · ${t.shift}`;
  if (metaEl) metaEl.textContent = `${formatDate(t.date)} · ${t.duration} min · ${t.totalQuestions} Questions · ${t.marking}`;

  const total = t.totalQuestions || 50;
  const added = STATE.draftQuestions.length;
  if (counterEl) counterEl.textContent = `${added} / ${total} Questions`;
  if (draftBadge) {
    draftBadge.textContent    = added;
    draftBadge.style.display  = added > 0 ? 'flex' : 'none';
    draftBadge.style.background = added >= total ? 'var(--accent-green)' : '';
    draftBadge.style.color      = added >= total ? '#07080d' : '';
  }
  // Re-render subject nav counts
  renderSubjectNav();
}

/** Add a new question block to the builder */
window.addQuestionBlock = () => {
  const wrap = $('qBuilderWrap');
  if (!wrap) return;

  // For multi-subject tests, the max is 50 per subject (or totalQuestions × subjects.length)
  if (STATE.activeTest) {
    const subCount = Array.isArray(STATE.activeTest.subjects) && STATE.activeTest.subjects.length > 1
      ? STATE.activeTest.subjects.length
      : 1;
    const perSubjectLimit = STATE.activeTest.totalQuestions || 50;
    const maxTotal = perSubjectLimit * subCount;
    if (STATE.draftQuestions.length >= maxTotal) {
      toast(`Already at maximum ${maxTotal} questions for ${subCount} subject(s).`, 'warning'); return;
    }
  }

  const idx  = STATE.qBlockCount++;
  const qno  = idx + 1;
  const block = document.createElement('div');
  block.className = 'q-block';
  block.id = `qBlock_${idx}`;

  block.innerHTML = `
    <div class="q-block-header">
      <div class="q-block-num">${qno}</div>
      <div class="q-block-label">Question ${qno}</div>
      <button class="q-block-remove" onclick="removeQuestionBlock(${idx})">
        <i class="fa-solid fa-xmark"></i> Remove
      </button>
    </div>

    <div class="form-grid cols-3" style="margin-bottom:12px;">
      <div class="form-group">
        <label class="form-label">Subject</label>
        <input class="form-control q-subject" type="text"
               placeholder="Physics / Maths / GT..."
               oninput="syncDefaultSubject(this)">
      </div>
      <div class="form-group">
        <label class="form-label">Section (optional)</label>
        <input class="form-control q-section" type="text" placeholder="Section A / B...">
      </div>
      <div class="form-group">
        <label class="form-label">Type</label>
        <select class="form-control q-type" onchange="handleQTypeChange(this, ${idx})">
          <option value="mcq">MCQ</option>
          <option value="integer">Integer Type</option>
        </select>
      </div>
    </div>

    <div class="form-group" style="margin-bottom:12px;">
      <label class="form-label">Question Text</label>
      <textarea class="form-control q-text" rows="3" placeholder="Enter the full question text here..."></textarea>
    </div>

    <div class="q-mcq-wrap" id="qMcqWrap_${idx}">
      <div class="form-label" style="margin-bottom:8px;">Options</div>
      <div class="options-grid">
        <div class="opt-inp-wrap"><div class="opt-letter-badge">A</div><input class="opt-inp q-optA" type="text" placeholder="Option A"></div>
        <div class="opt-inp-wrap"><div class="opt-letter-badge">B</div><input class="opt-inp q-optB" type="text" placeholder="Option B"></div>
        <div class="opt-inp-wrap"><div class="opt-letter-badge">C</div><input class="opt-inp q-optC" type="text" placeholder="Option C"></div>
        <div class="opt-inp-wrap"><div class="opt-letter-badge">D</div><input class="opt-inp q-optD" type="text" placeholder="Option D"></div>
      </div>
    </div>

    <div class="form-grid" style="margin-top:12px;">
      <div class="form-group">
        <label class="form-label">Correct Answer</label>
        <input class="form-control q-correct" type="text" placeholder="A / B / C / D / integer value">
      </div>
      <div class="form-group">
        <label class="form-label">Q. No.</label>
        <input class="form-control q-qno" type="number" value="${qno}" min="1">
      </div>
    </div>
  `;

  // Prefill default subject/section if set
  const defSubj = $('defaultSubject')?.value.trim();
  const defSec  = $('defaultSection')?.value.trim();
  if (defSubj) block.querySelector('.q-subject').value = defSubj;
  if (defSec)  block.querySelector('.q-section').value = defSec;

  wrap.appendChild(block);
  block.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  // Add to draft array (track _blockId for DOM removal, _fsId for Firestore deletion)
  STATE.draftQuestions.push({ _blockId: idx, _fsId: null });
  refreshActiveTestBanner();

  // Save draft question to Firestore immediately if we have an active test
  if (STATE.activeTest) {
    _saveDraftToFirestore(idx);
  }
}

/** Save a specific draft block to Firestore (mockDrafts/{testId}/questions) */
async function _saveDraftToFirestore(blockIdx) {
  if (!STATE.activeTest) return;
  const block = $(`qBlock_${blockIdx}`);
  if (!block) return;

  const testId  = STATE.activeTest.id;
  const subject = block.querySelector('.q-subject')?.value.trim() || 'General';
  const section = block.querySelector('.q-section')?.value.trim() || null;
  const type    = block.querySelector('.q-type')?.value || 'mcq';
  const question= block.querySelector('.q-text')?.value.trim() || '';
  const correct = block.querySelector('.q-correct')?.value.trim() || '';
  const qno     = parseInt(block.querySelector('.q-qno')?.value) || (blockIdx + 1);

  const options = type === 'mcq' ? [
    block.querySelector('.q-optA')?.value.trim() || '',
    block.querySelector('.q-optB')?.value.trim() || '',
    block.querySelector('.q-optC')?.value.trim() || '',
    block.querySelector('.q-optD')?.value.trim() || ''
  ].filter(Boolean) : [];

  const data = {
    testId,
    exam:         STATE.activeTest.exam,
    year:         STATE.activeTest.year,
    date:         STATE.activeTest.date,
    shift:        STATE.activeTest.shift,
    subject,
    section,
    questionNo:   qno,
    questionText: question,
    options,
    correctAnswer: correct,
    type,
    isDraft:      true,
    createdAt:    serverTimestamp()
  };

  try {
    const draftEntry = STATE.draftQuestions.find(q => q._blockId === blockIdx);
    if (draftEntry && draftEntry._fsId) {
      // Update existing draft doc
      await setDoc(
        doc(db, COLL.DRAFTS, testId, 'questions', draftEntry._fsId),
        data,
        { merge: true }
      );
    } else {
      // Create new draft doc
      const qRef = await addDoc(
        collection(db, COLL.DRAFTS, testId, 'questions'),
        data
      );
      if (draftEntry) draftEntry._fsId = qRef.id;
    }
  } catch(err) {
    console.warn('Draft save error:', err);
  }
}

window.removeQuestionBlock = async idx => {
  const draftEntry = STATE.draftQuestions.find(q => q._blockId === idx);

  // Delete from Firestore draft if it has a saved doc
  if (draftEntry && draftEntry._fsId && STATE.activeTest) {
    try {
      await deleteDoc(
        doc(db, COLL.DRAFTS, STATE.activeTest.id, 'questions', draftEntry._fsId)
      );
    } catch(err) {
      console.warn('Draft delete error:', err);
    }
  }

  const block = $(`qBlock_${idx}`);
  if (block) block.remove();
  STATE.draftQuestions = STATE.draftQuestions.filter(q => q._blockId !== idx);
  refreshActiveTestBanner();
};

window.clearAllQuestions = async () => {
  const yes = await confirmModal('Clear All Questions', 'Remove all question blocks from the builder and delete draft from Firestore?');
  if (!yes) return;

  // Delete all Firestore drafts for this test
  if (STATE.activeTest) {
    try {
      const draftSnap = await getDocs(
        collection(db, COLL.DRAFTS, STATE.activeTest.id, 'questions')
      );
      if (!draftSnap.empty) {
        const batch = writeBatch(db);
        draftSnap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
    } catch(err) {
      console.warn('Clear drafts error:', err);
    }
  }

  const wrap = $('qBuilderWrap');
  if (wrap) wrap.innerHTML = '';
  STATE.draftQuestions = [];
  STATE.qBlockCount    = 0;
  refreshActiveTestBanner();
};

window.handleQTypeChange = (sel, idx) => {
  const wrap = $(`qMcqWrap_${idx}`);
  if (wrap) wrap.style.display = sel.value === 'integer' ? 'none' : 'block';
};

window.syncDefaultSubject = el => {
  // When user updates subject in first block, offer as default
};

/** Sync all current draft blocks to Firestore (called before publish or manually) */
window.syncAllDrafts = async () => {
  if (!STATE.activeTest) { toast('No active test to sync drafts for.', 'warning'); return; }
  const blocks = document.querySelectorAll('.q-block');
  let saved = 0;
  for (const block of blocks) {
    const idStr = block.id.replace('qBlock_', '');
    const idx = parseInt(idStr);
    if (!isNaN(idx)) {
      await _saveDraftToFirestore(idx);
      saved++;
    }
  }
  if (saved > 0) toast(`${saved} question${saved !== 1 ? 's' : ''} synced to Firestore.`, 'success');
};

/** Collect all question blocks from DOM into STATE.draftQuestions, and sync to Firestore */
function collectQuestionsFromDOM() {
  const blocks = document.querySelectorAll('.q-block');
  const collected = [];

  blocks.forEach((block) => {
    const subject  = block.querySelector('.q-subject')?.value.trim();
    const section  = block.querySelector('.q-section')?.value.trim();
    const type     = block.querySelector('.q-type')?.value || 'mcq';
    const question = block.querySelector('.q-text')?.value.trim();
    const correct  = block.querySelector('.q-correct')?.value.trim();
    const qno      = parseInt(block.querySelector('.q-qno')?.value) || (collected.length + 1);

    if (!question) return; // skip empty blocks

    const q = {
      subject:       subject  || 'General',
      section:       section  || null,
      type,
      question,
      questionNo:    qno,
      correctAnswer: correct
    };

    if (type === 'mcq') {
      q.options = [
        block.querySelector('.q-optA')?.value.trim() || '',
        block.querySelector('.q-optB')?.value.trim() || '',
        block.querySelector('.q-optC')?.value.trim() || '',
        block.querySelector('.q-optD')?.value.trim() || ''
      ].filter(Boolean);
    }

    collected.push(q);
  });

  return collected;
}

// ============================================================
//  STEP 3 — PUBLISH TEST
// ============================================================

async function renderPublishSummary() {
  const el = $('publishSummary');
  if (!el) return;

  if (!STATE.activeTest) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state-text">No draft test. Go back to Create Test.</div></div>`;
    if ($('publishBtn')) $('publishBtn').disabled = true;
    return;
  }

  // Count from DOM first
  let questions = collectQuestionsFromDOM();

  // If DOM is empty, try Firestore drafts
  if (!questions.length) {
    try {
      const draftSnap = await getDocs(
        collection(db, COLL.DRAFTS, STATE.activeTest.id, 'questions')
      );
      if (!draftSnap.empty) {
        questions = draftSnap.docs.map(d => {
          const q = d.data();
          return {
            subject:       q.subject || 'General',
            section:       q.section || null,
            type:          q.type || 'mcq',
            question:      q.questionText || q.question || '',
            questionNo:    q.questionNo || 1,
            correctAnswer: q.correctAnswer || '',
            options:       q.options || []
          };
        }).filter(q => q.question);
      }
    } catch(e) { console.warn('Draft count fetch:', e); }
  }

  const t   = STATE.activeTest;
  const total = t.totalQuestions || 50;
  const ready = questions.length;
  const pct   = Math.round((ready / total) * 100);
  const color = ready >= total ? 'var(--accent-green)' : (ready > 0 ? 'var(--accent-amber)' : 'var(--accent-red)');

  // Subject breakdown
  const subjectMap = {};
  questions.forEach(q => {
    const k = q.subject || 'Unknown';
    subjectMap[k] = (subjectMap[k] || 0) + 1;
  });

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin-bottom:20px;">
      <div style="background:rgba(0,224,255,.05);border:1px solid rgba(0,224,255,.1);border-radius:12px;padding:16px;text-align:center;">
        <div style="font-family:var(--font-display);font-size:22px;font-weight:800;color:var(--accent-cyan);">${t.exam.toUpperCase()}</div>
        <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.1em;margin-top:4px;">Exam</div>
      </div>
      <div style="background:rgba(124,92,252,.05);border:1px solid rgba(124,92,252,.1);border-radius:12px;padding:16px;text-align:center;">
        <div style="font-family:var(--font-display);font-size:22px;font-weight:800;color:var(--accent-violet);">${t.year} · ${t.shift}</div>
        <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.1em;margin-top:4px;">Year · Shift</div>
      </div>
      <div style="background:rgba(0,229,160,.05);border:1px solid rgba(0,229,160,.1);border-radius:12px;padding:16px;text-align:center;">
        <div style="font-family:var(--font-display);font-size:22px;font-weight:800;color:${color};">${ready} / ${total}</div>
        <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.1em;margin-top:4px;">Questions Ready</div>
      </div>
    </div>

    <div style="margin-bottom:16px;">
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted);margin-bottom:6px;">
        <span>Progress</span><span style="color:${color}">${pct}%</span>
      </div>
      <div style="height:6px;background:rgba(255,255,255,.06);border-radius:99px;overflow:hidden;">
        <div style="height:100%;width:${pct}%;background:${pct>=100?'var(--accent-green)':'linear-gradient(90deg,var(--accent-cyan),var(--accent-violet))'};border-radius:99px;transition:width .5s ease;"></div>
      </div>
    </div>

    <div style="margin-bottom:16px;">
      <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px;">Subject Breakdown</div>
      ${Object.entries(subjectMap).map(([sub, cnt]) => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.04);">
          <span style="font-size:13px;color:var(--text-primary);font-weight:500;">${escHtml(sub)}</span>
          <span class="badge badge-cyan">${cnt} Q</span>
        </div>`).join('') || '<div style="color:var(--text-muted);font-size:13px;">No questions added yet.</div>'}
    </div>

    <div style="font-size:12px;color:var(--text-muted);">
      <i class="fa-solid fa-circle-info" style="color:var(--accent-cyan);margin-right:4px;"></i>
      Date: ${formatDate(t.date)} &nbsp;·&nbsp; Duration: ${t.duration} min &nbsp;·&nbsp; Marking: ${t.marking}
    </div>
  `;

  // Enable publish only if at least 1 question ready
  if ($('publishBtn')) $('publishBtn').disabled = ready === 0;
}

window.publishTest = async () => {
  if (!STATE.activeTest) {
    toast('No active test. Create a test first.', 'warning'); return;
  }

  // Collect questions from DOM FIRST
  let questions = collectQuestionsFromDOM();

  // ── FALLBACK: if DOM is empty, load from Firestore mockDrafts ──
  if (!questions.length) {
    try {
      const draftSnap = await getDocs(
        query(
          collection(db, COLL.DRAFTS, STATE.activeTest.id, 'questions'),
          orderBy('questionNo')
        )
      );
      if (!draftSnap.empty) {
        questions = draftSnap.docs.map(d => {
          const q = d.data();
          return {
            subject:       q.subject       || 'General',
            section:       q.section       || null,
            type:          q.type          || 'mcq',
            question:      q.questionText  || q.question || '',
            questionNo:    q.questionNo    || 1,
            correctAnswer: q.correctAnswer || '',
            options:       q.options       || []
          };
        }).filter(q => q.question); // skip empty
      }
    } catch(fetchErr) {
      console.warn('Fallback draft fetch error:', fetchErr);
    }
  }

  if (!questions.length) {
    toast('No questions to publish. Add questions first.', 'warning'); return;
  }

  // Snapshot the active test NOW before any async/modal operations
  const testSnapshot = { ...STATE.activeTest };
  const questionSnapshot = [...questions];

  const yes = await confirmModal(
    'Publish Test',
    `Upload ${questionSnapshot.length} questions and publish ${testSnapshot.exam.toUpperCase()} ${testSnapshot.year} · ${testSnapshot.shift}? This makes the test live.`
  );
  if (!yes) return;

  const btn = $('publishBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Uploading...'; }

  try {
    const testId = testSnapshot.id;

    // ── Step 1: Upload questions to mockQuestions in batches ──
    const CHUNK = 490; // safe under 500 Firestore batch limit
    const chunks = [];
    for (let i = 0; i < questionSnapshot.length; i += CHUNK) {
      chunks.push(questionSnapshot.slice(i, i + CHUNK));
    }

    for (let c = 0; c < chunks.length; c++) {
      const batch = writeBatch(db);
      chunks[c].forEach((q, i) => {
        const globalIdx = c * CHUNK + i;
        const qRef = doc(collection(db, COLL.QUESTIONS));
        batch.set(qRef, {
          testId,
          exam:          testSnapshot.exam,
          year:          testSnapshot.year,
          date:          testSnapshot.date,
          shift:         testSnapshot.shift,
          subject:       q.subject       || 'General',
          section:       q.section       || null,
          questionNo:    q.questionNo    || (globalIdx + 1),
          questionText:  q.question,
          question:      q.question,
          options:       q.options       || [],
          correctAnswer: q.correctAnswer || '',
          type:          q.type          || 'mcq',
          createdAt:     serverTimestamp()
        });
      });
      await batch.commit();
      if (chunks.length > 1 && btn) {
        btn.innerHTML = `<span class="spinner"></span> Uploading... (${Math.min((c+1)*CHUNK, questionSnapshot.length)}/${questionSnapshot.length})`;
      }
    }

    // ── Step 2: Mark test as published ──
    // Build subjects list: keep admin's original order, only include subjects that have questions
    const uploadedSubjectSet = new Set(
      questionSnapshot.map(q => (q.subject || '').trim().toLowerCase()).filter(Boolean)
    );
    const publishedSubjects = (testSnapshot.subjects || []).filter(
      s => uploadedSubjectSet.has((s || '').trim().toLowerCase())
    );
    // If none match (e.g., custom subject names), fall back to all unique question subjects
    const finalSubjects = publishedSubjects.length > 0
      ? publishedSubjects
      : [...new Set(questionSnapshot.map(q => q.subject).filter(Boolean))];

    await updateDoc(doc(db, COLL.TESTS, testId), {
      status:         'published',
      published:      true,
      questionCount:  questionSnapshot.length,
      totalQuestions: questionSnapshot.length,
      attempts:       0,
      subjects:       finalSubjects,
      publishedAt:    serverTimestamp(),
      publishedBy:    STATE.adminUser?.email || 'admin'
    });

    // ── Step 3: Clean up Firestore drafts ──
    try {
      const draftSnap = await getDocs(
        collection(db, COLL.DRAFTS, testId, 'questions')
      );
      if (!draftSnap.empty) {
        const cleanBatch = writeBatch(db);
        draftSnap.docs.forEach(d => cleanBatch.delete(d.ref));
        await cleanBatch.commit();
      }
    } catch(cleanErr) {
      console.warn('Draft cleanup (non-fatal):', cleanErr);
    }

    // ── Step 4: Clear local draft state ──
    STATE.activeTest     = null;
    STATE.draftQuestions = [];
    STATE.qBlockCount    = 0;
    if ($('qBuilderWrap')) $('qBuilderWrap').innerHTML = '';
    refreshActiveTestBanner();

    // ── Step 5: Show dedicated success modal ──
    showPublishModal(
      true,
      `${testSnapshot.exam.toUpperCase()} ${testSnapshot.year} · ${testSnapshot.shift}`,
      `${questionSnapshot.length} questions saved to Firestore. Test is now LIVE for users.`
    );

  } catch(err) {
    console.error('publishTest error:', err);
    showPublishModal(false, 'Publish Failed', err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Publish Test Now';
    }
  }
};

/** Show dedicated publish result modal — does NOT conflict with confirmModal */
function showPublishModal(success, title, body) {
  const modal   = $('publishResultModal');
  const iconEl  = $('publishResultIcon');
  const titleEl = $('publishResultTitle');
  const bodyEl  = $('publishResultBody');
  if (!modal) {
    // Fallback if modal not in HTML
    toast(success ? `✅ ${title}: ${body}` : `❌ ${title}: ${body}`, success ? 'success' : 'error', 6000);
    if (success) setTimeout(() => showSection('sectionTestManager'), 1500);
    return;
  }
  if (iconEl)  iconEl.textContent  = success ? '✅' : '❌';
  if (titleEl) titleEl.textContent = title;
  if (bodyEl)  bodyEl.textContent  = body;
  modal.classList.add('open');
}

window.closePublishModal = () => {
  const modal = $('publishResultModal');
  if (modal) modal.classList.remove('open');
  showSection('sectionTestManager');
};


// ============================================================
//  LIVE LISTENER — mockTests
// ============================================================

function listenTests() {
  if (STATE.unsubTests) STATE.unsubTests();

  STATE.unsubTests = onSnapshot(
    query(collection(db, COLL.TESTS), orderBy('createdAt', 'desc')),
    snap => {
      STATE.allTests = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      applyTestFilters();
      updateDashboardStats();
      renderDashRecentTests();
    },
    err => { console.error('Tests listener error:', err); toast('Tests listener error.', 'error'); }
  );
}

// ============================================================
//  TEST MANAGER — DISPLAY
// ============================================================

window.applyTestFilters = () => {
  const examFilter   = $('tmFilterExam')?.value   || '';
  const statusFilter = $('tmFilterStatus')?.value || '';

  let list = [...STATE.allTests];
  if (examFilter)   list = list.filter(t => t.exam   === examFilter);
  if (statusFilter) list = list.filter(t => t.status === statusFilter);

  renderTestCards(list);
};

window.loadAllTests = () => applyTestFilters();

function renderTestCards(tests) {
  const grid = $('testManagerGrid');
  if (!grid) return;

  if (!tests.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
      <div class="empty-state-icon"><i class="fa-regular fa-folder-open"></i></div>
      <div class="empty-state-text">No tests found</div>
    </div>`;
    return;
  }

  grid.innerHTML = tests.map(t => {
    const statusCls = { published: 'badge-green', draft: 'badge-amber', archived: 'badge-muted' }[t.status] || 'badge-muted';
    const examCls   = t.exam === 'cuet' ? 'cuet' : 'jee';
    const examColor = t.exam === 'cuet' ? 'var(--accent-cyan)' : 'var(--accent-amber)';

    return `<div class="test-card" onclick="viewTestDetail('${t.id}')">
      <div class="test-card-glow ${examCls}"></div>
      <div class="test-card-exam ${examCls}">${t.testName || (t.exam.toUpperCase() + ' ' + (t.year||'')).trim()}</div>
      <div class="test-card-meta">
        ${formatDate(t.date)} &nbsp;·&nbsp; ${t.shift || '—'}<br>
        ${t.duration || '—'} min &nbsp;·&nbsp; ${t.marking || '—'}<br>
        ${t.paper ? `Paper: ${escHtml(t.paper)}<br>` : ''}
        ${t.description ? `<span style="color:var(--text-secondary);">${escHtml(t.description)}</span>` : ''}
      </div>
      <div class="test-card-footer">
        <span class="badge ${statusCls}" style="text-transform:capitalize;">${t.status}</span>
        <span class="badge badge-cyan" style="margin-left:6px;">
          <i class="fa-solid fa-list-check" style="margin-right:4px;"></i>${t.questionCount || 0} Q
        </span>
      </div>
      <div class="test-card-actions">
        ${t.status === 'draft' ? `
          <button class="btn btn-secondary" style="font-size:11px;padding:6px 10px;"
            onclick="event.stopPropagation();editTestStatus('${t.id}','sectionAddQuestions')">
            <i class="fa-solid fa-pen"></i> Edit
          </button>` : ''}
        ${t.status === 'published' ? `
          <button class="btn btn-secondary" style="font-size:11px;padding:6px 10px;"
            onclick="event.stopPropagation();editPublishedTest('${t.id}')">
            <i class="fa-solid fa-pen-to-square"></i> Edit
          </button>
          <button class="btn btn-amber" style="font-size:11px;padding:6px 10px;"
            onclick="event.stopPropagation();archiveTest('${t.id}')">
            <i class="fa-solid fa-box-archive"></i> Archive
          </button>` : ''}
        ${t.status === 'archived' ? `
          <button class="btn btn-success" style="font-size:11px;padding:6px 10px;"
            onclick="event.stopPropagation();unarchiveTest('${t.id}')">
            <i class="fa-solid fa-box-open"></i> Restore
          </button>` : ''}
        <button class="btn btn-danger" style="font-size:11px;padding:6px 10px;"
          onclick="event.stopPropagation();deleteTest('${t.id}')">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    </div>`;
  }).join('');

  // Update published badge
  const published = STATE.allTests.filter(t => t.status === 'published').length;
  if ($('publishedBadge')) $('publishedBadge').textContent = published;
}

// ============================================================
//  TEST DETAIL MODAL
// ============================================================

window.viewTestDetail = async id => {
  const t = STATE.allTests.find(x => x.id === id);
  if (!t) return;

  $('testDetailTitle').textContent = `${t.exam.toUpperCase()} ${t.year || ''} — ${t.shift || ''}`;
  $('testDetailBody').innerHTML    = `<div style="text-align:center;padding:20px;color:var(--text-muted);">Loading questions...</div>`;
  $('testDetailModal').classList.add('open');

  try {
    const snap = await getDocs(
      query(collection(db, COLL.QUESTIONS), where('testId', '==', id), orderBy('questionNo'))
    );
    const questions = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    $('testDetailBody').innerHTML = `
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px;">
        <span class="badge badge-cyan">${t.exam.toUpperCase()}</span>
        <span class="badge badge-violet">${t.year} · ${t.shift}</span>
        <span class="badge ${t.status === 'published' ? 'badge-green' : 'badge-amber'}" style="text-transform:capitalize;">${t.status}</span>
        <span class="badge badge-muted">${t.duration} min</span>
        <span class="badge badge-muted">${t.marking}</span>
        ${t.paper ? `<span class="badge badge-muted">${escHtml(t.paper)}</span>` : ''}
      </div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:20px;">
        Date: ${formatDate(t.date)} &nbsp;·&nbsp; ${questions.length} Questions
      </div>

      ${questions.length ? `
        <div class="table-wrap" style="max-height:400px;overflow-y:auto;">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Subject</th>
                <th>Type</th>
                <th>Question</th>
                <th>Correct</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${questions.map((q, i) => `
                <tr>
                  <td style="font-family:var(--font-mono);font-size:12px;">${q.questionNo || (i+1)}</td>
                  <td><span class="badge badge-cyan" style="font-size:10px;">${escHtml(q.subject || '—')}</span></td>
                  <td><span class="badge badge-violet" style="font-size:10px;">${escHtml(q.type || 'mcq')}</span></td>
                  <td style="max-width:280px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px;">${escHtml(q.question || '—')}</td>
                  <td style="font-family:var(--font-mono);color:var(--accent-green);font-size:12px;">${escHtml(q.correctAnswer || '—')}</td>
                  <td><button class="btn btn-danger" style="font-size:11px;padding:4px 8px;" onclick="deleteQuestion('${q.id}')"><i class="fa-solid fa-trash"></i></button></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>` : `<div class="empty-state"><div class="empty-state-text">No questions in this test yet.</div></div>`}
    `;
  } catch(err) {
    $('testDetailBody').innerHTML = `<div class="empty-state"><div class="empty-state-text">Error loading: ${escHtml(err.message)}</div></div>`;
  }
};

window.closeTestDetailModal = () => $('testDetailModal').classList.remove('open');

window.deleteQuestion = async id => {
  const yes = await confirmModal('Delete Question', 'Remove this question from Firestore?');
  if (!yes) return;
  try {
    await deleteDoc(doc(db, COLL.QUESTIONS, id));
    toast('Question deleted.', 'info');
  } catch(err) { toast('Delete failed: ' + err.message, 'error'); }
};

window.archiveTest = async id => {
  const yes = await confirmModal('Archive Test', 'Archive this test? It will no longer be visible to users.');
  if (!yes) return;
  try {
    await updateDoc(doc(db, COLL.TESTS, id), { status: 'archived', archivedAt: serverTimestamp() });
    toast('Test archived.', 'info');
  } catch(err) { toast('Archive failed: ' + err.message, 'error'); }
};

window.unarchiveTest = async id => {
  try {
    await updateDoc(doc(db, COLL.TESTS, id), { status: 'published' });
    toast('Test restored to published.', 'success');
  } catch(err) { toast('Restore failed: ' + err.message, 'error'); }
};

window.deleteTest = async id => {
  const yes = await confirmModal('Delete Test', 'Permanently delete this test and all its questions? This cannot be undone.');
  if (!yes) return;

  try {
    // Fetch all questions for this test
    const qSnap = await getDocs(query(collection(db, COLL.QUESTIONS), where('testId', '==', id)));

    // Delete questions in chunks of 500 (Firestore batch limit)
    const CHUNK = 499;
    const docs  = qSnap.docs;
    for (let i = 0; i < docs.length; i += CHUNK) {
      const batch = writeBatch(db);
      docs.slice(i, i + CHUNK).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }

    // Delete the test document itself
    await deleteDoc(doc(db, COLL.TESTS, id));
    toast('Test and all questions deleted.', 'info');
  } catch(err) {
    toast('Delete failed: ' + err.message, 'error');
    console.error('deleteTest error:', err);
  }
};

window.editTestStatus = (id, section) => {
  const t = STATE.allTests.find(x => x.id === id);
  if (t) {
    STATE.activeTest = t;
    refreshActiveTestBanner();
  }
  showSection(section);
};

// ============================================================
//  LIVE USERS — liveUsers collection (new)
// ============================================================

function listenLiveUsers() {
  if (STATE.unsubLiveUsers) STATE.unsubLiveUsers();

  STATE.unsubLiveUsers = onSnapshot(
    collection(db, COLL.LIVE_USERS),
    snap => {
      // Merge liveUsers into STATE.liveUsers alongside activeTests data
      const liveUsersDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Merge with existing activeTests — prefer liveUsers data but keep both
      const activeIds = new Set(STATE.liveUsers.filter(u => u._source === 'active').map(u => u.id));
      const merged = [
        ...liveUsersDocs.map(u => ({ ...u, _source: 'liveUsers' })),
        ...STATE.liveUsers.filter(u => u._source === 'active' && !liveUsersDocs.find(l => l.userId === u.id))
      ];
      STATE.liveUsers = merged;
      renderLiveUsers();
      updateDashboardStats();
    },
    err => console.error('liveUsers listener:', err)
  );
}

// ============================================================
//  LIVE USERS — activeTests collection
// ============================================================

function listenActiveUsers() {
  if (STATE.unsubActive) STATE.unsubActive();

  STATE.unsubActive = onSnapshot(
    collection(db, COLL.ACTIVE),
    snap => {
      const activeDocs = snap.docs
        .map(d => ({ id: d.id, ...d.data(), _source: 'active' }))
        .filter(u => u.status !== 'completed');
      // Merge: keep liveUsers docs + add activeTests docs not already covered
      const liveUserIds = new Set(STATE.liveUsers.filter(u => u._source === 'liveUsers').map(u => u.userId || u.id));
      const merged = [
        ...STATE.liveUsers.filter(u => u._source === 'liveUsers'),
        ...activeDocs.filter(u => !liveUserIds.has(u.userId || u.id))
      ];
      STATE.liveUsers = merged;
      renderLiveUsers();
      updateDashboardStats();
    },
    err => console.error('Active users listener:', err)
  );
}

function renderLiveUsers() {
  const list   = $('liveUsersList');
  const dash   = $('dashLiveList');
  const badge  = $('liveCountBadge');
  const dbadge = $('dashLiveBadge');

  const users  = STATE.liveUsers;
  const cuet   = users.filter(u => (u.exam || '').toLowerCase() === 'cuet').length;
  const jee    = users.filter(u => (u.exam || '').toLowerCase() === 'jee').length;

  animateStat($('liveTotal'), users.length);
  animateStat($('liveCuet'),  cuet);
  animateStat($('liveJee'),   jee);
  animateStat($('dashLiveUsers'), users.length);
  if (badge)  badge.textContent  = users.length;
  if (dbadge) dbadge.textContent = `${users.length} Live`;

  const buildHTML = () => users.length ? users.map(u => {
    const init = (u.userName || u.name || '?')[0].toUpperCase();
    const exam = (u.exam || '').toUpperCase();
    const test = u.testName || u.shift || '';
    return `<div class="live-user-row">
      <div class="live-avatar">${init}</div>
      <div style="flex:1;">
        <div class="live-user-name">${escHtml(u.userName || u.name || 'Unknown')}</div>
        <div class="live-user-meta">
          ${exam ? `<span class="badge badge-${exam === 'CUET' ? 'cyan' : 'amber'}" style="font-size:9px;margin-right:6px;">${exam}</span>` : ''}
          ${escHtml(test)}
          ${u.startedAt ? ` · Started ${formatTimestamp(u.startedAt)}` : ''}
        </div>
      </div>
      <div class="live-pulse"></div>
    </div>`;
  }).join('') : `<div class="empty-state"><div class="empty-state-text">No users active right now</div></div>`;

  if (list) list.innerHTML = buildHTML();
  if (dash) dash.innerHTML = buildHTML();
}

// ============================================================
//  USER TEST HISTORY
// ============================================================

function listenUserHistory() {
  if (STATE.unsubHistory) STATE.unsubHistory();

  STATE.unsubHistory = onSnapshot(
    query(collection(db, COLL.HISTORY), orderBy('submittedAt', 'desc'), limit(200)),
    snap => {
      STATE.allHistory = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      applyHistoryFilters();
      updateDashboardStats();
      renderDashRecentUsers();
      renderRecentUsers();
      applyAttemptFilters();
      renderAttemptsRecent();
      renderUserList();
    },
    err => console.error('History listener:', err)
  );
}

window.applyHistoryFilters = () => {
  const search = ($('histSearch')?.value || '').toLowerCase();
  const exam   = $('histExamFilter')?.value || '';

  let list = [...STATE.allHistory];
  if (search) list = list.filter(h =>
    (h.userName || '').toLowerCase().includes(search) ||
    (h.exam     || '').toLowerCase().includes(search)
  );
  if (exam) list = list.filter(h => (h.exam || '').toLowerCase() === exam);

  renderHistoryTable(list);
};

window.loadUserHistory = () => applyHistoryFilters();

function renderHistoryTable(history) {
  const tbody = $('historyBody');
  if (!tbody) return;

  if (!history.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--text-muted);">No records found</td></tr>`;
    return;
  }

  tbody.innerHTML = history.map((h, i) => {
    const init   = (h.userName || '?')[0].toUpperCase();
    const exam   = (h.exam || '').toUpperCase();
    const examCls = exam === 'CUET' ? 'badge-cyan' : 'badge-amber';
    const acc    = h.accuracy != null ? `${h.accuracy}%` : '—';
    const time   = h.timeTaken ? formatTime(h.timeTaken) : '—';
    return `<tr>
      <td style="font-family:var(--font-mono);font-size:12px;color:var(--text-muted);">${i+1}</td>
      <td>
        <div style="display:flex;align-items:center;gap:8px;">
          <div class="ru-avatar">${init}</div>
          <div>
            <div style="font-size:13px;font-weight:600;">${escHtml(h.userName || '—')}</div>
            <div style="font-size:11px;color:var(--text-muted);">${escHtml(h.userEmail || '')}</div>
          </div>
        </div>
      </td>
      <td><span class="badge ${examCls}">${exam || '—'}</span></td>
      <td style="font-size:12px;color:var(--text-secondary);">${escHtml(h.shift || h.testName || '—')}</td>
      <td style="font-family:var(--font-mono);color:var(--accent-cyan);font-size:13px;font-weight:700;">${h.score ?? '—'} / ${h.total ?? '—'}</td>
      <td style="font-family:var(--font-mono);color:var(--accent-green);font-size:12px;">${acc}</td>
      <td style="font-size:12px;color:var(--text-muted);">${time}</td>
      <td style="font-size:11px;color:var(--text-muted);">${formatTimestamp(h.submittedAt || h.date)}</td>
    </tr>`;
  }).join('');
}

// ============================================================
//  DASHBOARD — stat cards + recent lists
// ============================================================

function updateDashboardStats() {
  const total     = STATE.allTests.length;
  const published = STATE.allTests.filter(t => t.status === 'published').length;
  const totalQ    = STATE.allTests.reduce((s, t) => s + (t.questionCount || 0), 0);
  const attempts  = STATE.allHistory.length;

  animateStat($('dashTotalTests'), total);
  animateStat($('dashPublished'),  published);
  animateStat($('dashTotalQ'),     totalQ);
  animateStat($('dashAttempts'),   attempts);
  if ($('publishedBadge')) $('publishedBadge').textContent = published;
}

function renderDashRecentTests() {
  const el = $('dashRecentTests');
  if (!el) return;

  const recent = STATE.allTests.slice(0, 6);
  if (!recent.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state-text">No tests yet</div></div>`; return;
  }

  el.innerHTML = recent.map(t => {
    const examCls   = t.exam === 'cuet' ? 'badge-cyan' : 'badge-amber';
    const statusCls = t.status === 'published' ? 'badge-green' : 'badge-amber';
    return `<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border);">
      <div style="flex:1;">
        <div style="font-size:13px;font-weight:600;color:var(--text-primary);">${t.testName || (t.exam.toUpperCase() + ' ' + (t.year||'')).trim()}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${escHtml(Array.isArray(t.subjects)&&t.subjects.length ? t.subjects.slice(0,3).join(', ') : (t.shift||'—'))} · ${formatDate(t.date)}</div>
      </div>
      <span class="badge ${statusCls}" style="text-transform:capitalize;font-size:9px;">${t.status}</span>
      <span class="badge ${examCls}" style="font-size:9px;">${t.questionCount || 0} Q</span>
    </div>`;
  }).join('');
}

function renderDashRecentUsers() {
  const el = $('dashRecentUsers');
  if (!el) return;

  const recent = STATE.allHistory.slice(0, 6);
  if (!recent.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state-text">No attempts yet</div></div>`; return;
  }

  el.innerHTML = recent.map(h => {
    const init  = (h.userName || '?')[0].toUpperCase();
    const exam  = (h.exam || '').toUpperCase();
    return `<div class="recent-user-item">
      <div class="ru-avatar">${init}</div>
      <div class="ru-info">
        <div class="ru-name">${escHtml(h.userName || '—')}</div>
        <div class="ru-meta">${exam} · ${escHtml(h.shift || '—')} · ${formatTimestamp(h.submittedAt || h.date)}</div>
      </div>
      <div class="ru-score">${h.score ?? '—'}/${computeMaxMarks(h)}</div>
    </div>`;
  }).join('');
}

// ============================================================
//  BROADCASTS — Announcements
// ============================================================

function listenAnnouncements() {
  if (STATE.unsubAnnounce) STATE.unsubAnnounce();
  STATE.unsubAnnounce = onSnapshot(
    query(collection(db, COLL.ANNOUNCEMENTS), orderBy('time', 'desc'), limit(30)),
    snap => renderAnnouncements(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => console.error('Announcements listener:', err)
  );
}

function renderAnnouncements(list) {
  const el = $('announceList');
  if (!el) return;
  if (!list.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state-text">No announcements yet</div></div>`; return;
  }
  el.innerHTML = list.map(a => `
    <div class="announce-item">
      <span class="announce-priority p-${a.priority || 'medium'}">${a.priority || 'medium'}</span>
      <div style="flex:1;">
        <div class="announce-text">${escHtml(a.text || '')}</div>
        ${a.imageUrl ? `<div style="font-size:11px;color:var(--accent-cyan);margin-top:3px;"><i class="fa-solid fa-image"></i> Image attached</div>` : ''}
        <div class="announce-meta">${formatTimestamp(a.time)} · ${escHtml(a.target || 'all')} · 📄 ${escHtml(a.page || 'all')}</div>
      </div>
      <button class="announce-delete" onclick="deleteAnnouncement('${a.id}')"><i class="fa-solid fa-xmark"></i></button>
    </div>`).join('');
}

window.sendAnnouncement = async () => {
  const text       = ($('announceText')?.value || '').trim();
  const priority   = $('announcePriority')?.value || 'medium';
  const imageUrl   = ($('announceImageUrl')?.value || '').trim();
  const page       = $('announcePage')?.value || 'mock-home';
  const targetType = $('announceTarget')?.value || 'all';
  const selUser    = ($('announceUser')?.value || '').trim();
  const btn        = $('announceBtn');

  if (!text) { toast('Write an announcement first.', 'warning'); return; }
  if (targetType === 'user' && !selUser) { toast('Enter a target username.', 'warning'); return; }

  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Sending…';
  const finalTarget = targetType === 'user' ? selUser : 'all';

  try {
    await addDoc(collection(db, COLL.ANNOUNCEMENTS), {
      text, imageUrl: imageUrl || null, priority,
      target: finalTarget, user: targetType === 'user' ? selUser : null,
      page, active: true, time: Date.now(), createdAt: serverTimestamp()
    });
    toast('Announcement sent!', 'success');
    $('announceText').value = '';
    if ($('announceImageUrl')) $('announceImageUrl').value = '';
    if ($('announceUser'))     $('announceUser').value     = '';
  } catch(err) { toast('Failed: ' + err.message, 'error'); }
  finally { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-megaphone"></i> Send Announcement'; }
};

window.deleteAnnouncement = async id => {
  const yes = await confirmModal('Delete Announcement', 'Remove this announcement?');
  if (!yes) return;
  try { await deleteDoc(doc(db, COLL.ANNOUNCEMENTS, id)); toast('Deleted.', 'info'); }
  catch(err) { toast('Delete failed: ' + err.message, 'error'); }
};

window.previewAnnouncement = () => {
  const text = ($('announceText')?.value || '').trim();
  if (!text) { toast('Write an announcement first.', 'warning'); return; }
  $('confirmTitle').textContent = 'Preview — How users will see it';
  $('confirmBody').innerHTML = `<div style="background:rgba(0,224,255,.07);border:1px solid rgba(0,224,255,.2);border-radius:10px;padding:16px;color:var(--text-primary);line-height:1.6;">${escHtml(text)}</div>`;
  $('confirmOkBtn').style.display = '';
  $('confirmOkBtn').textContent   = 'Close';
  // Preview mode: OK just closes, doesn't go through confirmModal Promise
  $('confirmOkBtn').onclick = () => {
    $('confirmModal').classList.remove('open');
    _confirmResolve = null;
  };
  _confirmResolve = null; // not using the promise for preview
  $('confirmModal').classList.add('open');
};

// ============================================================
//  BROADCASTS — Promotions
// ============================================================

function listenPromotions() {
  if (STATE.unsubPromo) STATE.unsubPromo();
  STATE.unsubPromo = onSnapshot(
    query(collection(db, COLL.PROMOTIONS), orderBy('time', 'desc'), limit(20)),
    snap => renderPromotionHistory(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => console.error('Promotions listener:', err)
  );
}

function renderPromotionHistory(list) {
  const el = $('promoHistory');
  if (!el) return;
  if (!list.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state-text">No promotions yet</div></div>`; return;
  }
  el.innerHTML = list.map(p => `
    <div class="announce-item">
      <span class="announce-priority p-medium" style="text-transform:capitalize;">${escHtml(p.type || 'popup')}</span>
      <div style="flex:1;">
        <div style="font-weight:600;font-size:13px;">${escHtml(p.title || '—')}</div>
        <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">${escHtml(p.body || '')}</div>
        ${p.url ? `<div style="font-size:11px;color:var(--accent-cyan);margin-top:2px;">${escHtml(p.url)}</div>` : ''}
        <div class="announce-meta">
          ${formatTimestamp(p.time)}
          · <span style="color:${p.active ? 'var(--accent-green)' : 'var(--text-muted)'};">${p.active ? '● Active' : '○ Inactive'}</span>
          · 📄 ${escHtml(p.page || 'all')}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end;">
        <button class="announce-delete" onclick="deletePromotion('${p.id}')"><i class="fa-solid fa-xmark"></i></button>
        <button class="btn btn-outline" style="padding:4px 8px;font-size:10px;" onclick="togglePromoActive('${p.id}',${!p.active})">
          ${p.active ? 'Deactivate' : 'Activate'}
        </button>
      </div>
    </div>`).join('');
}

window.selectPromoType = (type, el) => {
  document.querySelectorAll('.promo-type-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  $('promoType').value = type;
  const imgGroup = $('promoBannerImgGroup');
  if (imgGroup) imgGroup.style.display = type === 'banner' ? 'block' : 'none';
};

window.sendPromotion = async () => {
  const title    = ($('promoTitle')?.value   || '').trim();
  const body     = ($('promoBody')?.value    || '').trim();
  const cta      = ($('promoCTA')?.value     || '').trim();
  const type     = $('promoType')?.value     || 'popup';
  const duration = parseInt($('promoDuration')?.value || '8');
  const imageUrl = ($('promoBannerImageUrl')?.value || '').trim();
  const url      = ($('promoUrl')?.value     || '').trim();
  const page     = $('promoPage')?.value     || 'mock-home';
  const platform = $('promoPlatform')?.value || 'both';
  const targetT  = $('promoTarget')?.value   || 'all';
  const selUser  = ($('promoUser')?.value    || '').trim();
  const btn      = $('promoBtn');

  if (!title && !body) { toast('Fill in title or message.', 'warning'); return; }
  if (targetT === 'user' && !selUser) { toast('Enter target username.', 'warning'); return; }

  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Sending…';
  const finalTarget = targetT === 'user' ? selUser : 'all';

  try {
    await addDoc(collection(db, COLL.PROMOTIONS), {
      type, title, body, cta: cta || 'Got it', url: url || null,
      duration, imageUrl: imageUrl || null, page, platform,
      target: finalTarget, user: targetT === 'user' ? selUser : null,
      active: true, time: Date.now(), createdAt: serverTimestamp()
    });
    toast(`${type} promotion sent!`, 'success');
    $('promoTitle').value = ''; $('promoBody').value = ''; $('promoCTA').value = '';
    if ($('promoUrl'))  $('promoUrl').value  = '';
    if ($('promoUser')) $('promoUser').value = '';
  } catch(err) { toast('Failed: ' + err.message, 'error'); }
  finally { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-bullseye"></i> Send Promotion'; }
};

window.deletePromotion = async id => {
  const yes = await confirmModal('Delete Promotion', 'Remove this promotion?');
  if (!yes) return;
  try { await deleteDoc(doc(db, COLL.PROMOTIONS, id)); toast('Deleted.', 'info'); }
  catch(err) { toast('Delete failed: ' + err.message, 'error'); }
};

window.togglePromoActive = async (id, active) => {
  try {
    await updateDoc(doc(db, COLL.PROMOTIONS, id), { active });
    toast(active ? 'Promotion activated.' : 'Deactivated.', 'info');
  } catch(err) { toast('Update failed: ' + err.message, 'error'); }
};

// ============================================================
//  BROADCASTS — Notifications
// ============================================================

function listenNotifications() {
  if (STATE.unsubNotify) STATE.unsubNotify();
  STATE.unsubNotify = onSnapshot(
    query(collection(db, COLL.NOTIFICATIONS), orderBy('time', 'desc'), limit(30)),
    snap => renderNotificationHistory(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => console.error('Notifications listener:', err)
  );
}

function renderNotificationHistory(list) {
  const el = $('notifyHistory');
  if (!el) return;
  if (!list.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state-text">No notifications yet</div></div>`; return;
  }
  el.innerHTML = list.map(n => `
    <div class="announce-item">
      <span class="announce-priority p-medium">${n.target === 'all' ? 'All' : 'User'}</span>
      <div style="flex:1;">
        <div style="font-weight:600;font-size:13px;">${escHtml(n.icon || '🔔')} ${escHtml(n.title || '')}</div>
        <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">${escHtml(n.body || '')}</div>
        <div class="announce-meta">${formatTimestamp(n.time)}${n.user ? ` · 👤 ${escHtml(n.user)}` : ''}</div>
      </div>
      <button class="announce-delete" onclick="deleteNotification('${n.id}')"><i class="fa-solid fa-xmark"></i></button>
    </div>`).join('');
}

window.sendNotification = async () => {
  const target  = $('notifyTarget')?.value || 'all';
  const user    = ($('notifyUser')?.value  || '').trim();
  const title   = ($('notifyTitle')?.value || '').trim();
  const body    = ($('notifyText')?.value  || '').trim();
  const icon    = ($('notifyIcon')?.value  || '🔔').trim();
  const image   = ($('notifyImage')?.value || '').trim();
  const platform= $('notifyPlatform')?.value || 'both';
  const btn     = $('notifyBtn');

  if (!title || !body)             { toast('Fill in title and message.', 'warning'); return; }
  if (target === 'user' && !user)  { toast('Enter a target username.', 'warning');  return; }

  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Sending…';

  try {
    await addDoc(collection(db, COLL.NOTIFICATIONS), {
      target: target === 'all' ? 'all' : user,
      user: target === 'user' ? user : null,
      title, body, icon, image: image || null, platform,
      read: false, time: Date.now(), sentAt: serverTimestamp()
    });
    toast(target === 'all' ? 'Broadcast sent!' : `Sent to ${user}!`, 'success');
    ['notifyTitle','notifyText','notifyIcon','notifyUser','notifyImage'].forEach(id => { if ($(id)) $(id).value = id === 'notifyIcon' ? '🔔' : ''; });
  } catch(err) { toast('Failed: ' + err.message, 'error'); }
  finally { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-bell"></i> Send Notification'; }
};

window.deleteNotification = async id => {
  const yes = await confirmModal('Delete Notification', 'Remove this notification?');
  if (!yes) return;
  try { await deleteDoc(doc(db, COLL.NOTIFICATIONS, id)); toast('Deleted.', 'info'); }
  catch(err) { toast('Delete failed: ' + err.message, 'error'); }
};

// ── Delete a draft test (and its draft questions subcollection) ──
window.deleteDraft = async id => {
  const yes = await confirmModal('Delete Draft', 'Delete this draft test and all its draft questions?');
  if (!yes) return;
  try {
    // Delete draft questions subcollection
    const draftSnap = await getDocs(collection(db, COLL.DRAFTS, id, 'questions'));
    if (!draftSnap.empty) {
      const batch = writeBatch(db);
      draftSnap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
    // Delete draft root doc (if exists in mockDrafts)
    try { await deleteDoc(doc(db, COLL.DRAFTS, id)); } catch(_) {}
    // Delete the test doc from mockTests
    await deleteDoc(doc(db, COLL.TESTS, id));
    // Clear local state if this was the active draft
    if (STATE.activeTest?.id === id) {
      STATE.activeTest = null;
      STATE.draftQuestions = [];
      STATE.qBlockCount = 0;
      if ($('qBuilderWrap')) $('qBuilderWrap').innerHTML = '';
      refreshActiveTestBanner();
    }
    toast('Draft deleted.', 'info');
  } catch(err) { toast('Delete failed: ' + err.message, 'error'); }
};

// Toggle user field
window.toggleUserField = () => {
  const v = $('notifyTarget')?.value;
  const g = $('userTargetGroup');
  if (g) g.style.display = v === 'user' ? 'flex' : 'none';
};
window.toggleAnnounceUserField = () => {
  const v = $('announceTarget')?.value;
  const g = $('announceUserGroup');
  if (g) g.style.display = v === 'user' ? 'flex' : 'none';
};
window.togglePromoUserField = () => {
  const v = $('promoTarget')?.value;
  const g = $('promoUserGroup');
  if (g) g.style.display = v === 'user' ? 'flex' : 'none';
};

// ============================================================
//  MAINTENANCE
// ============================================================

async function loadMaintenance() {
  try {
    const snap = await getDoc(doc(db, COLL.MAINTENANCE, 'current'));
    if (!snap.exists()) return;
    const d = snap.data();

    if ($('maintenanceToggle')) $('maintenanceToggle').checked = d.enabled || false;
    if ($('maintenanceMsg'))    $('maintenanceMsg').value       = d.message || '';
    if ($('maintenanceEta'))    $('maintenanceEta').value       = d.eta || '';
    if ($('maintenanceEmail'))  $('maintenanceEmail').value     = d.email || '';

    updateMaintenanceUI(d.enabled || false);
  } catch(err) { console.warn('Maintenance load:', err); }
}

function updateMaintenanceUI(enabled) {
  const statusEl = $('maintenanceStatus');
  const textEl   = $('maintenanceStatusText');
  const metaEl   = $('maintenanceStatusMeta');

  if (!statusEl) return;
  if (enabled) {
    statusEl.className = 'maintenance-status on';
    statusEl.querySelector('i').className = 'fa-solid fa-triangle-exclamation';
    statusEl.querySelector('i').style.color = 'var(--accent-red)';
    if (textEl) textEl.textContent = 'Maintenance Mode Active';
    if (metaEl) metaEl.textContent = 'mock-home.html is currently blocked for all users.';
  } else {
    statusEl.className = 'maintenance-status off';
    statusEl.querySelector('i').className = 'fa-solid fa-circle-check';
    statusEl.querySelector('i').style.color = 'var(--accent-green)';
    if (textEl) textEl.textContent = 'All Systems Operational';
    if (metaEl) metaEl.textContent = 'mock-home.html is live and accessible.';
  }
}

window.toggleMaintenance = enabled => updateMaintenanceUI(enabled);

window.saveMaintenance = async () => {
  const enabled = $('maintenanceToggle')?.checked || false;
  const message = ($('maintenanceMsg')?.value || '').trim();
  const eta     = $('maintenanceEta')?.value || '';
  const email   = ($('maintenanceEmail')?.value || '').trim();

  try {
    await setDoc(doc(db, COLL.MAINTENANCE, 'current'), {
      enabled, message: message || null, eta: eta || null,
      email: email || null, updatedAt: serverTimestamp(),
      updatedBy: STATE.adminUser?.email || 'admin'
    });
    toast(enabled ? 'Maintenance mode enabled.' : 'Maintenance mode disabled.', enabled ? 'warning' : 'success');
    updateMaintenanceUI(enabled);
  } catch(err) { toast('Save failed: ' + err.message, 'error'); }
};

window.clearMaintenance = async () => {
  if ($('maintenanceToggle')) $('maintenanceToggle').checked = false;
  try {
    await setDoc(doc(db, COLL.MAINTENANCE, 'current'), {
      enabled: false, updatedAt: serverTimestamp(),
      updatedBy: STATE.adminUser?.email || 'admin'
    }, { merge: true });
    toast('Maintenance cleared. System is live.', 'success');
    updateMaintenanceUI(false);
  } catch(err) { toast('Failed: ' + err.message, 'error'); }
};

// ============================================================
//  LOGOUT
// ============================================================

window.doLogout = async () => {
  const yes = await confirmModal('Logout', 'Sign out of admin panel?');
  if (!yes) return;
  try {
    [STATE.unsubTests, STATE.unsubActive, STATE.unsubLiveUsers, STATE.unsubHistory,
     STATE.unsubAnnounce, STATE.unsubPromo, STATE.unsubNotify]
      .forEach(fn => { if (fn) fn(); });
    await signOut(auth);
    window.location.reload();
  } catch(err) { toast('Logout failed: ' + err.message, 'error'); }
};

// ============================================================
//  UTILITIES
// ============================================================

function animateStat(el, val) {
  if (!el) return;
  el.classList.remove('value-flash');
  void el.offsetWidth;
  el.textContent = val;
  el.classList.add('value-flash');
}

function escHtml(str) {
  if (!str && str !== 0) return '';
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
  } catch { return dateStr; }
}

function formatTimestamp(ts) {
  if (!ts) return '—';
  let date;
  if (ts?.toDate)              date = ts.toDate();
  else if (typeof ts === 'number') date = new Date(ts);
  else if (ts instanceof Date)     date = ts;
  else return '—';

  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60)    return 'just now';
  if (diff < 3600)  return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return date.toLocaleDateString('en-IN', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
}

function formatTime(seconds) {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ============================================================
//  BULK UPLOAD — CSV / JSON
// ============================================================

window.importCSV = function(input) {
  if (!STATE.activeTest) { toast('Create a test first before importing.', 'warning'); input.value=''; return; }
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const lines = e.target.result.split('\n').filter(l => l.trim());
    if (lines.length < 2) { toast('CSV is empty or has no data rows.', 'error'); return; }
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s/g,''));
    let count = 0;
    for (let i = 1; i < lines.length; i++) {
      // Handle quoted commas by simple split (basic CSV)
      const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g,''));
      if (cols.every(c => !c)) continue;
      const row = {};
      headers.forEach((h, j) => row[h] = cols[j] || '');
      if (!row.question) continue;
      addQuestionBlockFromData({
        questionNo:    parseInt(row.questionno || row['q.no'] || row.qno) || (i),
        subject:       row.subject || 'General',
        section:       row.section || null,
        type:          row.type || 'mcq',
        question:      row.question,
        optionA:       row.optiona,
        optionB:       row.optionb,
        optionC:       row.optionc,
        optionD:       row.optiond,
        correctAnswer: row.correctanswer || row.correct || row.answer || ''
      });
      count++;
    }
    toast(`${count} question${count !== 1 ? 's' : ''} imported from CSV!`, 'success');
  };
  reader.onerror = () => toast('Failed to read CSV file.', 'error');
  reader.readAsText(file);
  input.value = '';
};

window.importJSON = function(input) {
  if (!STATE.activeTest) { toast('Create a test first before importing.', 'warning'); input.value=''; return; }
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      const questions = Array.isArray(data) ? data : (data.questions || []);
      if (!questions.length) { toast('No questions found in JSON.', 'warning'); return; }
      questions.forEach((q, i) => addQuestionBlockFromData({
        questionNo:    q.questionNo || q.qno || q['q. no'] || (i + 1),
        subject:       q.subject || 'General',
        section:       q.section || null,
        type:          q.type || 'mcq',
        question:      q.question || q.text || '',
        optionA:       q.options?.[0] ?? q.optionA ?? '',
        optionB:       q.options?.[1] ?? q.optionB ?? '',
        optionC:       q.options?.[2] ?? q.optionC ?? '',
        optionD:       q.options?.[3] ?? q.optionD ?? '',
        correctAnswer: q.correctAnswer || q.correct || q.answer || ''
      }));
      toast(`${questions.length} question${questions.length !== 1 ? 's' : ''} imported from JSON!`, 'success');
    } catch(err) {
      toast('Invalid JSON file: ' + err.message, 'error');
    }
  };
  reader.onerror = () => toast('Failed to read JSON file.', 'error');
  reader.readAsText(file);
  input.value = '';
};

function addQuestionBlockFromData(data) {
  // Ensure active test & wrap exist
  if (!$('qBuilderWrap')) return;
  window.addQuestionBlock();
  const idx   = STATE.qBlockCount - 1;
  const block = $(`qBlock_${idx}`);
  if (!block) return;

  const set = (sel, val) => { if (val !== undefined && val !== null && val !== '') { const el = block.querySelector(sel); if (el) el.value = val; } };

  set('.q-subject', data.subject);
  set('.q-section', data.section);
  set('.q-text',    data.question);
  set('.q-correct', data.correctAnswer);
  set('.q-qno',     data.questionNo);

  if (data.type) {
    const typeEl = block.querySelector('.q-type');
    if (typeEl) {
      typeEl.value = data.type;
      // Trigger type change for integer (hides options)
      window.handleQTypeChange(typeEl, idx);
    }
  }

  set('.q-optA', data.optionA);
  set('.q-optB', data.optionB);
  set('.q-optC', data.optionC);
  set('.q-optD', data.optionD);
}

// ============================================================
//  End of admin-mock.js
// ============================================================

// ============================================================
//  USER ATTEMPTS SECTION
// ============================================================

let _attTab = 'all';

window.setAttemptTab = (tab, btn) => {
  _attTab = tab;
  // Update active state on tab buttons (they're inside sectionUserAttempts)
  const tabs = document.querySelectorAll('#sectionUserAttempts .tab-btn');
  tabs.forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  applyAttemptFilters();
};

window.applyAttemptFilters = () => {
  const search = ($('attSearch')?.value || '').toLowerCase();
  let list = [...STATE.allHistory];
  if (_attTab !== 'all') list = list.filter(h => (h.exam || '').toLowerCase() === _attTab);
  if (search) list = list.filter(h =>
    (h.userName  || '').toLowerCase().includes(search) ||
    (h.testName  || '').toLowerCase().includes(search) ||
    (h.userEmail || '').toLowerCase().includes(search)
  );
  renderAttempts(list);
};

function renderAttempts(list) {
  const el      = $('attemptsList');
  const countEl = $('attCount');
  if (countEl) countEl.textContent = `${list.length} attempt${list.length !== 1 ? 's' : ''}`;
  if (!el) return;

  if (!list.length) {
    el.innerHTML = `<div class="empty-state" style="padding:32px 0;"><div class="empty-state-text">No attempts found</div></div>`;
    return;
  }

  el.innerHTML = list.map(h => {
    const init      = (h.userName || '?')[0].toUpperCase();
    const exam      = (h.exam || '').toUpperCase();
    const examCls   = exam === 'CUET' ? 'badge-cyan' : 'badge-amber';
    const testName  = buildTestLabel(h);
    const attempted = h.attempted ?? ((h.correct != null && h.incorrect != null) ? h.correct + h.incorrect : '—');
    return `
    <div class="attempt-row">
      <div class="attempt-user">
        <div class="ru-avatar" style="width:32px;height:32px;font-size:12px;flex-shrink:0;">${init}</div>
        <div style="min-width:0;">
          <div style="font-size:12px;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100px;">${escHtml(h.userName || '—')}</div>
          <div style="font-size:10px;color:var(--text-muted);">${formatTimestamp(h.submittedAt || h.date)}</div>
        </div>
      </div>
      <div class="attempt-test">
        <span class="badge ${examCls}" style="font-size:9px;margin-right:5px;">${exam}</span>${escHtml(testName)}
      </div>
      <div class="attempt-pills">
        <span class="attempt-pill pill-attempted" title="Attempted">${attempted}</span>
        <span class="attempt-pill pill-right"     title="Correct">✓ ${h.correct ?? '—'}</span>
        <span class="attempt-pill pill-wrong"     title="Wrong">✗ ${h.incorrect ?? '—'}</span>
        <span class="attempt-pill pill-score">${h.score ?? '—'}/${computeMaxMarks(h)}</span>
      </div>
    </div>`;
  }).join('');
}

function renderAttemptsRecent() {
  const el = $('attRecentList');
  if (!el) return;

  const recent = STATE.allHistory.slice(0, 20);
  if (!recent.length) {
    el.innerHTML = `<div style="padding:14px;font-size:12px;color:var(--text-muted);">No attempts yet.</div>`;
    return;
  }

  el.innerHTML = recent.map(h => {
    const exam    = (h.exam || '').toUpperCase();
    const examCls = exam === 'CUET' ? 'badge-cyan' : 'badge-amber';
    const testName = h.testName || `${exam} ${h.year || ''} ${h.shift || ''}`.trim() || '—';
    return `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);">
      <div class="ru-avatar" style="width:28px;height:28px;font-size:11px;flex-shrink:0;">${(h.userName||'?')[0].toUpperCase()}</div>
      <div style="flex:1;min-width:0;">
        <span style="font-size:12px;font-weight:600;color:var(--text-primary);">${escHtml(h.userName||'—')}</span>
        <span class="badge ${examCls}" style="font-size:9px;margin-left:5px;">${exam}</span>
        <div style="font-size:10px;color:var(--text-muted);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(testName)}</div>
      </div>
      <div style="text-align:right;flex-shrink:0;">
        <div style="font-family:var(--font-mono);font-size:12px;color:var(--accent-green);font-weight:700;">${h.score??'—'}/${computeMaxMarks(h)}</div>
        <div style="font-size:10px;color:var(--text-muted);">${formatTimestamp(h.submittedAt||h.date)}</div>
      </div>
    </div>`;
  }).join('');
}

// ============================================================
//  USER LIST SECTION
// ============================================================

function renderUserList() {
  const el = $('userListBody');
  if (!el) return;

  // Group by uid or name+email
  const userMap = new Map();
  STATE.allHistory.forEach(h => {
    const key = h.uid || `${h.userName}||${h.userEmail}`;
    if (!userMap.has(key)) {
      userMap.set(key, {
        _key: key, uid: h.uid || key,
        name: h.userName || '—', email: h.userEmail || '',
        tests: []
      });
    }
    userMap.get(key).tests.push(h);
  });

  const users = [...userMap.values()].sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  // Summary stats
  const cuetUsers = users.filter(u => u.tests.some(t => (t.exam||'').toLowerCase() === 'cuet')).length;
  const jeeUsers  = users.filter(u => u.tests.some(t => (t.exam||'').toLowerCase() === 'jee')).length;
  animateStat($('ulTotalUsers'), users.length);
  animateStat($('ulCuetUsers'),  cuetUsers);
  animateStat($('ulJeeUsers'),   jeeUsers);

  if (!users.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state-text">No users found</div></div>`;
    return;
  }

  el.innerHTML = users.map(u => {
    const init       = (u.name || '?')[0].toUpperCase();
    const total      = u.tests.length;
    const cuet       = u.tests.filter(t => (t.exam||'').toLowerCase() === 'cuet').length;
    const jee        = u.tests.filter(t => (t.exam||'').toLowerCase() === 'jee').length;
    const best       = total ? Math.max(...u.tests.map(t => t.score || 0)) : 0;
    const avgAcc     = total ? Math.round(u.tests.reduce((s, t) => s + (t.accuracy || 0), 0) / total) : 0;
    // Encode key safely for inline onclick
    const keyEncoded = encodeURIComponent(u._key);
    return `
    <div class="user-list-item" onclick="openUserPopup('${escHtml(u._key)}')">
      <div class="admin-avatar" style="flex-shrink:0;">${init}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:600;color:var(--text-primary);">${escHtml(u.name)}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(u.email)}</div>
      </div>
      <div class="ul-stats">
        <span class="badge badge-muted"    style="font-size:9px;">${total} Test${total !== 1 ? 's' : ''}</span>
        ${cuet ? `<span class="badge badge-cyan"  style="font-size:9px;">CUET ×${cuet}</span>` : ''}
        ${jee  ? `<span class="badge badge-amber" style="font-size:9px;">JEE ×${jee}</span>`  : ''}
        <span class="badge badge-green"   style="font-size:9px;">Best ${best}</span>
        <span class="badge badge-violet"  style="font-size:9px;">Avg ${avgAcc}%</span>
      </div>
    </div>`;
  }).join('');
}

// ============================================================
//  USER POPUP
// ============================================================

let _upCurrentUser = null;
let _upCurrentTab  = 'cuet';

window.openUserPopup = (key) => {
  // Find all tests for this user
  let userTests, userName, userEmail;

  const byUid = STATE.allHistory.filter(h => h.uid === key);
  if (byUid.length) {
    userTests = byUid;
    userName  = byUid[0].userName  || '—';
    userEmail = byUid[0].userEmail || '';
  } else {
    // name||email fallback key
    const sepIdx  = key.indexOf('||');
    const kName   = sepIdx >= 0 ? key.slice(0, sepIdx) : key;
    const kEmail  = sepIdx >= 0 ? key.slice(sepIdx + 2) : '';
    userTests = STATE.allHistory.filter(h =>
      (h.userName || '') === kName && (h.userEmail || '') === kEmail
    );
    userName  = kName  || '—';
    userEmail = kEmail || '';
  }

  _upCurrentUser = { tests: userTests, name: userName, email: userEmail };
  _upCurrentTab  = 'cuet';

  // Header
  const init = (userName || '?')[0].toUpperCase();
  if ($('upAvatar')) $('upAvatar').textContent = init;
  if ($('upName'))   $('upName').textContent   = userName;
  if ($('upEmail'))  $('upEmail').textContent  = userEmail;

  // Stats
  const total     = userTests.length;
  const cuetCount = userTests.filter(t => (t.exam||'').toLowerCase() === 'cuet').length;
  const jeeCount  = userTests.filter(t => (t.exam||'').toLowerCase() === 'jee').length;
  const best      = total ? Math.max(...userTests.map(t => t.score || 0)) : 0;
  const avgAcc    = total ? Math.round(userTests.reduce((s, t) => s + (t.accuracy||0), 0) / total) : 0;

  if ($('upStats')) $('upStats').innerHTML = `
    <span class="badge badge-muted">${total} Total Tests</span>
    ${cuetCount ? `<span class="badge badge-cyan">CUET ×${cuetCount}</span>` : ''}
    ${jeeCount  ? `<span class="badge badge-amber">JEE ×${jeeCount}</span>` : ''}
    <span class="badge badge-green">Best ${best}</span>
    <span class="badge badge-violet">Avg ${avgAcc}%</span>
  `;

  // Tabs
  document.querySelectorAll('.user-popup-tab').forEach(b => b.classList.remove('active'));
  if ($('upTabCuet')) $('upTabCuet').classList.add('active');
  renderUpTests('cuet');

  $('userPopupOverlay').classList.add('open');
};

window.closeUserPopup = () => {
  if ($('userPopupOverlay')) $('userPopupOverlay').classList.remove('open');
  _upCurrentUser = null;
};

window.handleUserPopupBg = e => {
  if (e.target === $('userPopupOverlay')) closeUserPopup();
};

window.switchUpTab = (tab, btn) => {
  _upCurrentTab = tab;
  document.querySelectorAll('.user-popup-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderUpTests(tab);
};

function renderUpTests(exam) {
  const el = $('upTestList');
  if (!el || !_upCurrentUser) return;

  const tests = _upCurrentUser.tests
    .filter(t => (t.exam || '').toLowerCase() === exam)
    .sort((a, b) => (b.date || 0) - (a.date || 0));

  if (!tests.length) {
    el.innerHTML = `<div class="empty-state" style="padding:28px 0;"><div class="empty-state-text">No ${exam.toUpperCase()} tests attempted yet</div></div>`;
    return;
  }

  const examAccent = exam === 'cuet' ? 'var(--accent-cyan)' : 'var(--accent-amber)';
  el.innerHTML = tests.map(t => {
    const testName  = t.testName || `${(t.exam||'').toUpperCase()} ${t.year||''} ${t.shift||''}`.trim() || '—';
    const attempted = t.attempted ?? ((t.correct != null && t.incorrect != null) ? t.correct + t.incorrect : '—');
    return `
    <div class="popup-test-row">
      <div style="flex:1;min-width:0;">
        <div class="popup-test-name">${escHtml(testName)}</div>
        <div class="popup-test-meta">${formatTimestamp(t.submittedAt || t.date)}</div>
        <div class="popup-test-scores">
          <span class="badge badge-muted"   style="font-size:9px;">Total ${t.total ?? '—'} Q</span>
          <span class="badge badge-cyan"    style="font-size:9px;">Attempted ${attempted}</span>
          <span class="badge badge-green"   style="font-size:9px;">✓ ${t.correct ?? '—'} Right</span>
          <span class="badge badge-red"     style="font-size:9px;">✗ ${t.incorrect ?? '—'} Wrong</span>
          ${t.accuracy != null ? `<span class="badge badge-violet" style="font-size:9px;">${t.accuracy}% Acc</span>` : ''}
        </div>
      </div>
      <div style="text-align:right;flex-shrink:0;margin-left:14px;min-width:60px;">
        <div style="font-family:var(--font-display);font-size:22px;font-weight:800;color:${examAccent};">
          ${t.score ?? '—'}
        </div>
        <div style="font-size:10px;color:var(--text-muted);">/ ${t.total ?? '—'}</div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:2px;">${formatTime(t.timeTaken)}</div>
      </div>
    </div>`;
  }).join('');
}

// ============================================================
//  RECENT USERS (Live Users section)
// ============================================================

function renderRecentUsers() {
  const el = $('recentUsersList');
  if (!el) return;

  const recent = STATE.allHistory.slice(0, 30);
  if (!recent.length) {
    el.innerHTML = `<div style="padding:14px;font-size:12px;color:var(--text-muted);text-align:center;">No test submissions yet</div>`;
    return;
  }

  el.innerHTML = recent.map(h => {
    const exam    = (h.exam || '').toUpperCase();
    const examCls = exam === 'CUET' ? 'badge-cyan' : 'badge-amber';
    const init    = (h.userName || '?')[0].toUpperCase();
    return `
    <div class="ru-row">
      <div class="ru-avatar" style="width:32px;height:32px;font-size:12px;flex-shrink:0;">${init}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:12px;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${escHtml(h.userName || '—')}
        </div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:1px;">
          <span class="badge ${examCls}" style="font-size:8px;margin-right:4px;">${exam}</span>
          ${escHtml(h.testName || h.shift || '')}
        </div>
      </div>
      <div style="font-size:10px;color:var(--text-muted);flex-shrink:0;text-align:right;">
        ${formatTimestamp(h.submittedAt || h.date)}
      </div>
    </div>`;
  }).join('');
}
// ============================================================
//  TOP SCORER DASHBOARD
// ============================================================

window.loadTopScorerTests = function() {
  const exam    = $('tsExamFilter')?.value || 'cuet';
  const testSel = $('tsTestFilter');
  if (!testSel) return;

  // Filter published tests by exam from STATE.allTests
  const tests = STATE.allTests
    .filter(t => (t.exam || '').toLowerCase() === exam && t.status === 'published')
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

  testSel.innerHTML = `<option value="">— Select Test —</option>` +
    tests.map(t =>
      `<option value="${escHtml(t.id)}">${escHtml(t.testName || (t.exam.toUpperCase()+' '+(t.year||'')).trim())} ${Array.isArray(t.subjects)&&t.subjects.length ? '— '+t.subjects.join(', ') : ('· '+(t.shift||''))}</option>`
    ).join('');

  const el = $('topScorerBody');
  if (el) el.innerHTML = `<div class="empty-state"><div class="empty-state-text">Select a test to view top scorers</div></div>`;
};

window.renderTopScorers = function() {
  const testId = $('tsTestFilter')?.value || '';
  const exam   = ($('tsExamFilter')?.value || 'cuet').toLowerCase();
  const el     = $('topScorerBody');
  if (!el) return;

  if (!testId) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state-text">Select a test to view top scorers</div></div>`;
    return;
  }

  el.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px;"><span class="spinner"></span> Loading…</div>`;

  // Filter from STATE.allHistory (already live via listenUserHistory)
  let list = STATE.allHistory.filter(h => h.testId === testId);

  // Fallback: match by exam if testId not in history docs
  if (!list.length) {
    list = STATE.allHistory.filter(h => (h.exam || '').toLowerCase() === exam);
  }

  if (!list.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state-text">No submissions found for this test yet</div></div>`;
    return;
  }

  // Sort by score descending
  list = [...list].sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));

  const totalAttempts = list.length;
  const examAccent    = exam === 'cuet' ? 'var(--accent-cyan)' : 'var(--accent-amber)';
  const medalIcons    = ['🥇', '🥈', '🥉'];

  const topScore = list[0]?.score ?? 0;
  const avgScore = totalAttempts
    ? Math.round(list.reduce((s, h) => s + (h.score || 0), 0) / totalAttempts)
    : 0;
  const avgAcc = totalAttempts
    ? Math.round(list.reduce((s, h) => s + (h.accuracy || 0), 0) / totalAttempts)
    : 0;

  // ── Summary strip ──
  const summaryHTML = `
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px;padding:4px 0;">
    <div style="background:rgba(0,224,255,.06);border:1px solid rgba(0,224,255,.12);border-radius:12px;padding:14px;text-align:center;">
      <div style="font-family:var(--font-display);font-size:22px;font-weight:800;color:var(--accent-cyan);">${totalAttempts}</div>
      <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;margin-top:3px;">Total Attempts</div>
    </div>
    <div style="background:rgba(255,215,0,.06);border:1px solid rgba(255,215,0,.15);border-radius:12px;padding:14px;text-align:center;">
      <div style="font-family:var(--font-display);font-size:22px;font-weight:800;color:#FFD700;">${topScore}</div>
      <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;margin-top:3px;">Top Score</div>
    </div>
    <div style="background:rgba(0,229,160,.06);border:1px solid rgba(0,229,160,.12);border-radius:12px;padding:14px;text-align:center;">
      <div style="font-family:var(--font-display);font-size:22px;font-weight:800;color:var(--accent-green);">${avgAcc}%</div>
      <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;margin-top:3px;">Avg Accuracy</div>
    </div>
  </div>`;

  // ── Ranked rows ──
  const rowsHTML = list.map((h, i) => {
    const rank       = i + 1;
    const percentile = totalAttempts > 1
      ? parseFloat(((totalAttempts - rank) / totalAttempts * 100).toFixed(1))
      : 100.0;
    const init       = (h.userName || '?')[0].toUpperCase();
    const medal      = rank <= 3 ? medalIcons[rank - 1] : null;
    const rankColor  = rank === 1 ? '#FFD700' : rank === 2 ? '#C0C0C0' : rank === 3 ? '#CD7F32' : 'var(--text-muted)';
    const scoreColor = rank === 1 ? '#FFD700' : examAccent;
    const accuracy   = h.accuracy != null
      ? h.accuracy
      : (h.attempted > 0 ? Math.round((h.correct || 0) / h.attempted * 100) : 0);
    const rowBg      = rank <= 3 ? 'background:rgba(255,255,255,.018);border-radius:10px;padding:10px 12px;margin-bottom:3px;' : 'padding:10px 0;';

    return `
    <div style="display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--border);${rowBg}">
      <div style="width:30px;text-align:center;flex-shrink:0;">
        ${medal
          ? `<span style="font-size:20px;line-height:1;">${medal}</span>`
          : `<span style="font-family:var(--font-mono);font-size:11px;font-weight:700;color:${rankColor};">#${rank}</span>`}
      </div>
      <div class="admin-avatar" style="width:32px;height:32px;font-size:12px;flex-shrink:0;">${init}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${escHtml(h.userName || '—')}
        </div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:2px;">
          ✓ ${h.correct ?? '—'} &nbsp;✗ ${h.incorrect ?? '—'} &nbsp;🕐 ${formatTime(h.timeTaken)} &nbsp;·&nbsp; ${formatTimestamp(h.submittedAt || h.date)}
        </div>
      </div>
      <div style="text-align:right;flex-shrink:0;min-width:92px;">
        <div style="font-family:var(--font-display);font-size:21px;font-weight:800;color:${scoreColor};line-height:1.1;">${h.score ?? '—'}</div>
        <div style="font-size:10px;color:var(--text-muted);">/ ${computeMaxMarks(h)}</div>
        <div style="display:flex;gap:3px;justify-content:flex-end;margin-top:4px;flex-wrap:wrap;">
          <span class="badge badge-violet" style="font-size:9px;">${accuracy}% Acc</span>
          <span class="badge badge-cyan"   style="font-size:9px;">${percentile}%ile</span>
        </div>
      </div>
    </div>`;
  }).join('');

  el.innerHTML = summaryHTML +
    `<div style="overflow-y:auto;max-height:500px;padding-right:2px;">${rowsHTML}</div>`;
};

// ── Auto-load test list when section is opened ──
const _origShowSectionUL = window.showSection;
window.showSection = function(id) {
  _origShowSectionUL(id);
  if (id === 'sectionUserList') {
    // Small tick so STATE.allTests is guaranteed populated
    setTimeout(() => loadTopScorerTests(), 80);
  }
};
