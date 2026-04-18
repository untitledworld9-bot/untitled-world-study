/**
 * ============================================================
 *  Study Grid Prep — admin-mock.js
 *  Full mock question admin system
 *
 *  Features:
 *   - Auth gate (code + Firebase)
 *   - Single question upload to Firestore
 *   - Bulk JSON/CSV upload
 *   - Live browse & filter with real-time Firestore listener
 *   - Edit & delete questions
 *   - Live test enable/disable control
 *   - Stats dashboard
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
  onSnapshot,
  query,
  orderBy,
  where,
  serverTimestamp
} from './firebase.js';

// ============================================================
//  CONSTANTS
// ============================================================

const ADMIN_CODE   = "7905";
const ADMIN_EMAILS = [
  "untitledworld9@gmail.com",
  "ayushgupt640@gmail.com"
];
const COLL_QUESTIONS = "mockQuestions";
const COLL_CONTROL   = "testControl";

// ============================================================
//  STATE
// ============================================================

const STATE = {
  adminUser:    null,
  allQuestions: [],        // full live list from Firestore
  filtered:     [],        // currently displayed (after filters)
  bulkJsonData: null,
  bulkCsvData:  null,
  unsubQ:       null       // Firestore onSnapshot cleanup
};

// ============================================================
//  DOM HELPER
// ============================================================

const $ = id => document.getElementById(id);

// ============================================================
//  TOAST
// ============================================================

function toast(message, type = 'info', duration = 3500) {
  const container = $('toastContainer');
  const icons = { success:'✅', error:'❌', info:'ℹ️', warning:'⚠️' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type] || '•'}</span><span>${escHtml(message)}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('removing');
    el.addEventListener('animationend', () => el.remove(), { once:true });
  }, duration);
}

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
  // Lazy load data on section switch
  if (id === 'sectionBrowse') renderQuestionsTable(STATE.filtered);
  if (id === 'sectionStats')  renderStats();
  if (id === 'sectionControl') loadTestControl();
  closeSidebar();
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
//  AUTH GATE
// ============================================================

window.verifyAdmin = async () => {
  const code  = $('adminCodeInput').value.trim();
  const errEl = $('authError');
  const btn   = document.querySelector('.auth-btn');

  if (code !== ADMIN_CODE) {
    errEl.textContent = 'Incorrect access code. Access denied.';
    $('adminCodeInput').value = '';
    $('adminCodeInput').focus();
    return;
  }

  btn.disabled    = true;
  btn.textContent = 'Verifying...';
  errEl.textContent = '';

  try {
    const user = await new Promise((resolve, reject) => {
      const unsub = onAuthStateChanged(auth, u => {
        unsub(); // one-shot
        resolve(u);
      }, reject);
    });

    if (!user) {
      errEl.textContent = 'Not signed in. Please sign in first.';
      btn.disabled = false;
      btn.textContent = 'Verify Access';
      return;
    }

    if (!ADMIN_EMAILS.includes(user.email)) {
      errEl.textContent = 'This account does not have admin access.';
      btn.disabled = false;
      btn.textContent = 'Verify Access';
      return;
    }

    STATE.adminUser = user;
    initAdminPanel(user);
  } catch(err) {
    errEl.textContent = 'Auth error: ' + err.message;
    btn.disabled = false;
    btn.textContent = 'Verify Access';
  }
};

function initAdminPanel(user) {
  // Hide auth gate
  const gate = $('authGate');
  if (gate) { gate.style.opacity = '0'; gate.style.transition = 'opacity .4s'; setTimeout(() => gate.remove(), 400); }

  // Set admin profile
  const initial = (user.displayName || user.email || 'A').charAt(0).toUpperCase();
  const adminAvatar = $('adminAvatar');
  const adminName   = $('adminName');
  const adminEmail  = $('adminEmail');
  if (adminAvatar) adminAvatar.textContent = initial;
  if (adminName)   adminName.textContent   = user.displayName || 'Admin';
  if (adminEmail)  adminEmail.textContent  = user.email;

  listenQuestions();
  loadTestControl();
}

// ============================================================
//  LIVE LISTENER — mockQuestions
// ============================================================

function listenQuestions() {
  if (STATE.unsubQ) STATE.unsubQ();

  const q = query(collection(db, COLL_QUESTIONS), orderBy('exam'), orderBy('subject'), orderBy('questionNo'));

  STATE.unsubQ = onSnapshot(q, snap => {
    STATE.allQuestions = [];
    snap.forEach(d => STATE.allQuestions.push({ _id: d.id, ...d.data() }));
    applyFilters();
    updateQCountBadge();
    renderStats();
  }, err => {
    console.error('Question listener error:', err);
    toast('Firebase listener error: ' + err.message, 'error');
  });
}

function updateQCountBadge() {
  const badge = $('qCountBadge');
  if (badge) badge.textContent = STATE.allQuestions.length;
}

// ============================================================
//  FORM HELPERS — exam / type switching
// ============================================================

window.handleExamChange = () => {
  const exam = $('fExam').value;
  const cuetF = $('cuetFields');
  const jeeF  = $('jeeFields');
  if (exam === 'jee') {
    if (cuetF) cuetF.style.display = 'none';
    if (jeeF)  jeeF.style.display = 'block';
  } else {
    if (cuetF) cuetF.style.display = 'grid';
    if (jeeF)  jeeF.style.display = 'none';
  }
};

window.handleTypeChange = () => {
  const type = $('fType').value;
  const opts = $('mcqOptionsWrap');
  if (opts) opts.style.display = type === 'integer' ? 'none' : 'block';
};

// ============================================================
//  SINGLE QUESTION UPLOAD
// ============================================================

window.uploadSingleQuestion = async () => {
  const btn = document.querySelector('[onclick="uploadSingleQuestion()"]');

  const exam     = $('fExam').value;
  const type     = $('fType').value;
  const subject  = $('fSubject').value.trim();
  const question = $('fQuestion').value.trim();
  const qno      = parseInt($('fQno').value) || 1;
  const correct  = $('fCorrect').value.trim();

  if (!subject || !question || !correct) {
    toast('Please fill: Subject, Question, and Correct Answer.', 'warning');
    return;
  }

  const data = {
    exam, type, subject, question,
    questionNo: qno,
    correctAnswer: correct,
    createdAt: serverTimestamp()
  };

  if (exam === 'cuet') {
    data.year  = parseInt($('fYear').value) || new Date().getFullYear();
    data.shift = $('fShift').value;
  } else {
    data.section = $('fSection').value;
  }

  if (type === 'mcq') {
    data.options = [
      $('optA').value.trim(),
      $('optB').value.trim(),
      $('optC').value.trim(),
      $('optD').value.trim()
    ].filter(Boolean);
    if (data.options.length < 2) {
      toast('Please provide at least 2 options for MCQ.', 'warning');
      return;
    }
  }

  try {
    btn.disabled = true;
    btn.textContent = 'Saving...';
    await addDoc(collection(db, COLL_QUESTIONS), data);
    toast(`Question saved successfully! (${exam.toUpperCase()} — ${subject})`, 'success');
    clearForm();
  } catch(err) {
    toast('Save failed: ' + err.message, 'error');
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Save to Firebase';
  }
};

window.clearForm = () => {
  ['fSubject','fQuestion','fQno','fCorrect','optA','optB','optC','optD','fYear'].forEach(id => {
    const el = $(id);
    if (el) el.value = '';
  });
};

// ============================================================
//  BULK JSON UPLOAD
// ============================================================

window.handleJsonFile = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!Array.isArray(data)) throw new Error('JSON must be an array of question objects.');
      STATE.bulkJsonData = data;
      const preview = $('jsonPreview');
      if (preview) {
        preview.textContent = `Parsed ${data.length} questions.\n\nFirst question preview:\n${JSON.stringify(data[0], null, 2)}`;
        preview.classList.add('visible');
      }
      const btn = $('jsonUploadBtn');
      if (btn) btn.disabled = false;
      toast(`JSON parsed: ${data.length} questions ready.`, 'info');
    } catch(err) {
      toast('JSON parse error: ' + err.message, 'error');
      STATE.bulkJsonData = null;
    }
  };
  reader.readAsText(file);
};

window.uploadJson = async () => {
  if (!STATE.bulkJsonData || !STATE.bulkJsonData.length) {
    toast('No JSON data loaded.', 'warning'); return;
  }

  const btn = $('jsonUploadBtn');
  btn.disabled = true;
  btn.textContent = 'Uploading...';

  let success = 0, failed = 0;

  // Batch in chunks of 10
  const chunks = chunkArray(STATE.bulkJsonData, 10);
  for (const chunk of chunks) {
    await Promise.all(chunk.map(async (q) => {
      try {
        const data = sanitizeQuestion(q);
        await addDoc(collection(db, COLL_QUESTIONS), data);
        success++;
      } catch(err) {
        console.warn('Failed to upload question:', err);
        failed++;
      }
    }));
  }

  toast(`Uploaded: ${success} questions. Failed: ${failed}.`, success > 0 ? 'success' : 'error');
  btn.disabled = false;
  btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Upload JSON to Firebase';
  STATE.bulkJsonData = null;
};

window.clearBulk = () => {
  STATE.bulkJsonData = null;
  const preview = $('jsonPreview');
  if (preview) { preview.textContent = ''; preview.classList.remove('visible'); }
  const inp = $('jsonFileInput');
  if (inp) inp.value = '';
  const btn = $('jsonUploadBtn');
  if (btn) btn.disabled = true;
};

// ============================================================
//  BULK CSV UPLOAD
// ============================================================

window.handleCsvFile = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const parsed = parseCSV(ev.target.result);
      STATE.bulkCsvData = parsed;
      const preview = $('csvPreview');
      if (preview) {
        preview.textContent = `Parsed ${parsed.length} rows.\n\nFirst row:\n${JSON.stringify(parsed[0], null, 2)}`;
        preview.classList.add('visible');
      }
      const btn = $('csvUploadBtn');
      if (btn) btn.disabled = false;
      toast(`CSV parsed: ${parsed.length} questions ready.`, 'info');
    } catch(err) {
      toast('CSV parse error: ' + err.message, 'error');
      STATE.bulkCsvData = null;
    }
  };
  reader.readAsText(file);
};

window.uploadCsv = async () => {
  if (!STATE.bulkCsvData || !STATE.bulkCsvData.length) {
    toast('No CSV data loaded.', 'warning'); return;
  }

  const btn = $('csvUploadBtn');
  btn.disabled = true;
  btn.textContent = 'Uploading...';

  let success = 0, failed = 0;
  const chunks = chunkArray(STATE.bulkCsvData, 10);
  for (const chunk of chunks) {
    await Promise.all(chunk.map(async row => {
      try {
        const q = {
          exam:          (row.exam || '').toLowerCase(),
          year:          parseInt(row.year) || null,
          shift:         row.shift || '',
          subject:       row.subject || '',
          section:       row.section || '',
          questionNo:    parseInt(row.questionNo) || 1,
          question:      row.question || '',
          options:       [row.optionA, row.optionB, row.optionC, row.optionD].filter(Boolean),
          correctAnswer: row.correctAnswer || '',
          type:          row.type || 'mcq',
          createdAt:     serverTimestamp()
        };
        const data = sanitizeQuestion(q);
        await addDoc(collection(db, COLL_QUESTIONS), data);
        success++;
      } catch(err) {
        console.warn('CSV row failed:', err);
        failed++;
      }
    }));
  }

  toast(`CSV Uploaded: ${success} success, ${failed} failed.`, success > 0 ? 'success' : 'error');
  btn.disabled = false;
  btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Upload CSV to Firebase';
  STATE.bulkCsvData = null;
};

window.clearCsvBulk = () => {
  STATE.bulkCsvData = null;
  const preview = $('csvPreview');
  if (preview) { preview.textContent = ''; preview.classList.remove('visible'); }
  const inp = $('csvFileInput');
  if (inp) inp.value = '';
  const btn = $('csvUploadBtn');
  if (btn) btn.disabled = true;
};

// ============================================================
//  FILTER
// ============================================================

window.applyFilters = () => {
  const exam    = ($('filterExam')?.value    || '').toLowerCase();
  const subject = ($('filterSubject')?.value || '').toLowerCase().trim();
  const year    = parseInt($('filterYear')?.value) || null;

  STATE.filtered = STATE.allQuestions.filter(q => {
    if (exam    && (q.exam||'').toLowerCase() !== exam) return false;
    if (subject && !(q.subject||'').toLowerCase().includes(subject)) return false;
    if (year    && q.year !== year) return false;
    return true;
  });

  renderQuestionsTable(STATE.filtered);
};

// ============================================================
//  QUESTIONS TABLE
// ============================================================

function renderQuestionsTable(questions) {
  const tbody = $('questionsBody');
  if (!tbody) return;

  if (!questions || questions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:32px;color:var(--text-muted);">No questions found.</td></tr>`;
    return;
  }

  tbody.innerHTML = questions.map((q, i) => {
    const examBadge    = q.exam === 'jee' ? 'badge-amber' : 'badge-cyan';
    const typeBadge    = q.type === 'integer' ? 'badge-violet' : 'badge-green';
    const yearShift    = q.exam === 'cuet' ? `${q.year || '—'} / ${q.shift || '—'}` : (q.section ? `Sec ${q.section}` : '—');
    const questionText = (q.question || '').length > 55 ? q.question.substring(0, 55) + '...' : (q.question || '—');

    return `<tr>
      <td>${i + 1}</td>
      <td><span class="badge ${examBadge}">${(q.exam||'—').toUpperCase()}</span></td>
      <td>${escHtml(q.subject || '—')}</td>
      <td style="font-size:11px;">${escHtml(yearShift)}</td>
      <td>${q.questionNo || '—'}</td>
      <td><span class="badge ${typeBadge}">${q.type || 'mcq'}</span></td>
      <td style="max-width:240px;font-size:11px;color:var(--text-secondary);">${escHtml(questionText)}</td>
      <td><span style="color:var(--accent-green);font-weight:700;">${escHtml(q.correctAnswer || '—')}</span></td>
      <td>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-secondary btn-sm" onclick="openEditModal('${q._id}')">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button class="btn btn-danger btn-sm" onclick="deleteQuestion('${q._id}')">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

// ============================================================
//  DELETE QUESTION
// ============================================================

window.deleteQuestion = async (id) => {
  if (!confirm('Delete this question? This cannot be undone.')) return;
  try {
    await deleteDoc(doc(db, COLL_QUESTIONS, id));
    toast('Question deleted.', 'success');
  } catch(err) {
    toast('Delete failed: ' + err.message, 'error');
  }
};

// ============================================================
//  EDIT QUESTION
// ============================================================

window.openEditModal = (id) => {
  const q = STATE.allQuestions.find(x => x._id === id);
  if (!q) { toast('Question not found.', 'error'); return; }

  $('editDocId').value    = id;
  $('editQuestion').value = q.question || '';
  $('editCorrect').value  = q.correctAnswer || '';
  $('editQno').value      = q.questionNo || 1;

  const opts = $('editOptionsWrap');
  if (q.type === 'integer') {
    if (opts) opts.style.display = 'none';
  } else {
    if (opts) opts.style.display = 'block';
    const options = Array.isArray(q.options) ? q.options : [];
    $('editOptA').value = options[0] || '';
    $('editOptB').value = options[1] || '';
    $('editOptC').value = options[2] || '';
    $('editOptD').value = options[3] || '';
  }

  $('editModal').classList.add('open');
};

window.closeEditModal = () => {
  $('editModal').classList.remove('open');
};

window.saveEdit = async () => {
  const id       = $('editDocId').value;
  const question = $('editQuestion').value.trim();
  const correct  = $('editCorrect').value.trim();
  const qno      = parseInt($('editQno').value) || 1;

  if (!id || !question || !correct) {
    toast('Question text and correct answer are required.', 'warning');
    return;
  }

  const q = STATE.allQuestions.find(x => x._id === id);
  const updates = { question, correctAnswer: correct, questionNo: qno, updatedAt: serverTimestamp() };

  if ((q?.type || 'mcq') !== 'integer') {
    updates.options = [
      $('editOptA').value.trim(),
      $('editOptB').value.trim(),
      $('editOptC').value.trim(),
      $('editOptD').value.trim()
    ].filter(Boolean);
  }

  try {
    await updateDoc(doc(db, COLL_QUESTIONS, id), updates);
    toast('Question updated successfully!', 'success');
    closeEditModal();
  } catch(err) {
    toast('Update failed: ' + err.message, 'error');
  }
};

// ============================================================
//  TEST CONTROL
// ============================================================

async function loadTestControl() {
  try {
    const cuetDoc = await getDoc(doc(db, COLL_CONTROL, 'cuet'));
    const jeeDoc  = await getDoc(doc(db, COLL_CONTROL, 'jee'));

    const toggleCuet = $('toggleCuet');
    const toggleJee  = $('toggleJee');
    if (toggleCuet) toggleCuet.checked = cuetDoc.exists() ? (cuetDoc.data().enabled === true) : false;
    if (toggleJee)  toggleJee.checked  = jeeDoc.exists()  ? (jeeDoc.data().enabled  === true) : false;
  } catch(err) {
    console.warn('Test control load error:', err);
  }

  // Build config list from questions
  const configs = {};
  STATE.allQuestions.forEach(q => {
    const key = `${q.exam}|${q.year || ''}|${q.shift || ''}`;
    if (!configs[key]) configs[key] = { exam: q.exam, year: q.year, shift: q.shift, count: 0 };
    configs[key].count++;
  });

  const configList = $('testConfigList');
  if (configList) {
    const items = Object.values(configs);
    if (!items.length) {
      configList.innerHTML = '<div style="color:var(--text-muted);font-size:13px;">No test configurations found. Upload questions first.</div>';
    } else {
      configList.innerHTML = items.map(c => `
        <div class="test-control-row">
          <div class="test-ctrl-info">
            <div class="test-ctrl-name">${(c.exam||'').toUpperCase()} ${c.year ? '— ' + c.year : ''} ${c.shift ? '· ' + c.shift : ''}</div>
            <div class="test-ctrl-meta">${c.count} question${c.count !== 1 ? 's' : ''} in bank</div>
          </div>
          <span class="badge badge-green">${c.count} Q</span>
        </div>`).join('');
    }
  }
}

window.updateTestControl = async (exam, enabled) => {
  try {
    await setDoc(doc(db, COLL_CONTROL, exam), {
      enabled,
      updatedAt: serverTimestamp(),
      updatedBy: STATE.adminUser?.email || 'admin'
    }, { merge: true });
    toast(`${exam.toUpperCase()} mock test ${enabled ? 'ENABLED' : 'DISABLED'}.`, enabled ? 'success' : 'warning');
  } catch(err) {
    toast('Control update failed: ' + err.message, 'error');
    // Revert toggle
    const toggle = $('toggle' + exam.charAt(0).toUpperCase() + exam.slice(1));
    if (toggle) toggle.checked = !enabled;
  }
};

// ============================================================
//  STATS
// ============================================================

function renderStats() {
  const all  = STATE.allQuestions;
  const cuet = all.filter(q => q.exam === 'cuet');
  const jee  = all.filter(q => q.exam === 'jee');
  const subs = [...new Set(all.map(q => q.subject).filter(Boolean))];

  // Animate stat values
  animateStat($('statTotal'),    all.length);
  animateStat($('statCuet'),     cuet.length);
  animateStat($('statJee'),      jee.length);
  animateStat($('statSubjects'), subs.length);

  // Subject breakdown
  const breakdown = {};
  all.forEach(q => {
    const k = q.subject || 'Unknown';
    if (!breakdown[k]) breakdown[k] = { exam: q.exam, count: 0 };
    breakdown[k].count++;
  });

  const brkEl = $('subjectBreakdown');
  if (brkEl) {
    const sorted = Object.entries(breakdown).sort((a,b) => b[1].count - a[1].count);
    if (!sorted.length) {
      brkEl.innerHTML = '<div style="color:var(--text-muted);font-size:13px;">No data yet.</div>';
      return;
    }
    const maxCount = Math.max(...sorted.map(s => s[1].count));
    brkEl.innerHTML = sorted.map(([sub, info]) => {
      const pct = Math.round((info.count / maxCount) * 100);
      const badgeCls = info.exam === 'jee' ? 'badge-amber' : 'badge-cyan';
      return `<div style="margin-bottom:14px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
          <span class="badge ${badgeCls}" style="font-size:10px;">${(info.exam||'').toUpperCase()}</span>
          <span style="font-size:13px;font-weight:600;color:var(--text-primary);">${escHtml(sub)}</span>
          <span style="margin-left:auto;font-size:12px;color:var(--text-muted);">${info.count} Q</span>
        </div>
        <div style="height:6px;background:rgba(255,255,255,.06);border-radius:99px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--accent-cyan),var(--accent-violet));border-radius:99px;transition:width .5s ease;"></div>
        </div>
      </div>`;
    }).join('');
  }
}

function animateStat(el, val) {
  if (!el) return;
  el.classList.remove('value-flash');
  void el.offsetWidth;
  el.textContent = val;
  el.classList.add('value-flash');
}

// ============================================================
//  LOGOUT
// ============================================================

window.doLogout = async () => {
  try {
    await signOut(auth);
    window.location.reload();
  } catch(err) {
    toast('Logout failed: ' + err.message, 'error');
  }
};

// ============================================================
//  UTILITIES
// ============================================================

function escHtml(str) {
  if (!str && str !== 0) return '';
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

function sanitizeQuestion(q) {
  const out = {
    exam:          (q.exam || '').toLowerCase(),
    subject:       q.subject || '',
    questionNo:    parseInt(q.questionNo) || 1,
    question:      q.question || '',
    correctAnswer: String(q.correctAnswer || ''),
    type:          q.type || 'mcq',
    createdAt:     serverTimestamp()
  };
  if (q.year)    out.year  = parseInt(q.year);
  if (q.shift)   out.shift = q.shift;
  if (q.section) out.section = q.section;
  if (Array.isArray(q.options) && q.options.length > 0) {
    out.options = q.options.map(String).filter(Boolean);
  }
  return out;
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function parseCSV(text) {
  const lines = text.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row.');

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const vals = splitCSVLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => { row[h] = (vals[idx] || '').replace(/^"|"$/g, '').trim(); });
    rows.push(row);
  }
  return rows;
}

function splitCSVLine(line) {
  const result = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') { inQ = !inQ; continue; }
    if (line[i] === ',' && !inQ) { result.push(cur); cur = ''; continue; }
    cur += line[i];
  }
  result.push(cur);
  return result;
}

// ============================================================
//  DRAG-AND-DROP for upload zones
// ============================================================

['jsonDropZone','csvDropZone'].forEach(id => {
  const zone = $(id);
  if (!zone) return;
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const isJson = id === 'jsonDropZone';
    const inp    = $(isJson ? 'jsonFileInput' : 'csvFileInput');
    const dt     = new DataTransfer();
    dt.items.add(file);
    inp.files = dt.files;
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  });
});

// ============================================================
//  End of admin-mock.js
// ============================================================
