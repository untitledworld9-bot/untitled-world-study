/**
 * Study Grid Prep — admin-mock.js  (v3.1 — BUG FIXED)
 *
 * FIXES:
 *  BUG 1 (ROOT CAUSE OF ALL FAILURES): confirmModal always returned false.
 *    Old code: confirmOkBtn.onclick = () => { closeModal(); resolve(true); }
 *    closeModal() called _confirmResolve(false) FIRST → Promise settled as false.
 *    resolve(true) was then a no-op.  ALL confirms → silently cancelled.
 *    Fix: OK button resolves true WITHOUT calling closeModal().
 *         closeModal() (Cancel/backdrop) resolves false only.
 *
 *  BUG 2: STATE.activeTest lost on re-login/refresh.
 *    Fix: Persist to sessionStorage. Restored on initAdminPanel().
 *
 *  BUG 3: select pages show draft tests (fixed in cuetmockselect/jeemockselect).
 */

import {
  auth, onAuthStateChanged, signOut,
  db, collection, addDoc, getDocs, doc, setDoc, getDoc,
  deleteDoc, updateDoc, onSnapshot, query, orderBy, where,
  limit, serverTimestamp, writeBatch
} from './firebase.js';

// ── Constants ──────────────────────────────────────────────
const ADMIN_CODE   = "7905";
const ADMIN_EMAILS = ["untitledworld9@gmail.com", "ayushgupt640@gmail.com"];
const COLL = {
  TESTS:"mockTests", QUESTIONS:"mockQuestions", ACTIVE:"activeTests",
  HISTORY:"userTestHistory", ANNOUNCEMENTS:"announcements",
  PROMOTIONS:"promotions", NOTIFICATIONS:"notifications", MAINTENANCE:"maintenance"
};

// ── State ──────────────────────────────────────────────────
const STATE = {
  adminUser:null, activeTest:null, draftQuestions:[],
  allTests:[], allHistory:[], liveUsers:[],
  unsubTests:null, unsubActive:null, unsubHistory:null,
  unsubAnnounce:null, unsubPromo:null, unsubNotify:null,
  qBlockCount:0
};
const SS_KEY = 'adminMock_activeTest';
const saveSession  = () => { try { STATE.activeTest ? sessionStorage.setItem(SS_KEY, JSON.stringify(STATE.activeTest)) : sessionStorage.removeItem(SS_KEY); } catch(e){} };
const loadSession  = () => { try { const r=sessionStorage.getItem(SS_KEY); if(r) STATE.activeTest=JSON.parse(r); } catch(e){ sessionStorage.removeItem(SS_KEY); } };

const $ = id => document.getElementById(id);

// ── Toast ──────────────────────────────────────────────────
window.toast = function(msg, type='info', dur=3800) {
  const c=$('toastContainer'); if(!c) return;
  const icons={success:'<i class="fa-solid fa-circle-check"></i>',error:'<i class="fa-solid fa-circle-xmark"></i>',info:'<i class="fa-solid fa-circle-info"></i>',warning:'<i class="fa-solid fa-triangle-exclamation"></i>'};
  const el=document.createElement('div');
  el.className=`toast ${type}`;
  el.innerHTML=`<span style="font-size:14px;flex-shrink:0;">${icons[type]||''}</span><span>${escHtml(msg)}</span>`;
  c.appendChild(el);
  setTimeout(()=>{ el.classList.add('removing'); el.addEventListener('animationend',()=>el.remove(),{once:true}); },dur);
};

// ── Confirm Modal (FIXED) ──────────────────────────────────
let _confirmResolve = null;

function confirmModal(title, body) {
  return new Promise(resolve => {
    _confirmResolve = resolve;
    $('confirmTitle').textContent = title;
    $('confirmBody').textContent  = body;

    // FIXED: OK resolves true WITHOUT calling closeModal first
    $('confirmOkBtn').style.display = '';
    $('confirmOkBtn').textContent   = 'Confirm';
    $('confirmOkBtn').className     = 'btn btn-primary';
    $('confirmOkBtn').onclick = () => {
      $('confirmModal').classList.remove('open');
      const res = _confirmResolve;
      _confirmResolve = null;
      if (res) res(true);   // ← correctly resolves true
    };
    $('confirmModal').classList.add('open');
  });
}

// Cancel / backdrop → resolves false
window.closeModal = () => {
  $('confirmModal').classList.remove('open');
  const res = _confirmResolve;
  _confirmResolve = null;
  if (res) res(false);
};
document.addEventListener('keydown', e => { if(e.key==='Escape') closeModal(); });

// ── Nav ────────────────────────────────────────────────────
window.showSection = id => {
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  const t=$(id); if(t) t.classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.section===id));
  closeSidebar();
  if(id==='sectionTestManager')  applyTestFilters();
  if(id==='sectionUserHistory')  applyHistoryFilters();
  if(id==='sectionPublish')      renderPublishSummary();
  if(id==='sectionAddQuestions') refreshActiveTestBanner();
};
window.toggleSidebar = ()=>{ $('sidebar').classList.toggle('open'); $('mobOverlay').classList.toggle('open'); };
window.closeSidebar  = ()=>{ $('sidebar').classList.remove('open');  $('mobOverlay').classList.remove('open'); };
window.switchBroadcastTab = (pid,btn)=>{ document.querySelectorAll('.tab-pane').forEach(p=>p.classList.remove('active')); document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active')); $(pid).classList.add('active'); btn.classList.add('active'); };

// ── Auth ───────────────────────────────────────────────────
window.verifyAdmin = async () => {
  const code=$('adminCodeInput').value.trim(), errEl=$('authError'), btn=document.querySelector('.auth-btn');
  if(code!==ADMIN_CODE){ errEl.textContent='Incorrect access code.'; $('adminCodeInput').value=''; $('adminCodeInput').focus(); return; }
  btn.disabled=true; btn.textContent='Verifying...'; errEl.textContent='';
  try {
    const user = await new Promise((res,rej)=>{ const u=onAuthStateChanged(auth,u=>{u();res(u);},rej); });
    if(!user){ errEl.textContent='Not signed in.'; btn.disabled=false; btn.textContent='Verify Access'; return; }
    if(!ADMIN_EMAILS.includes(user.email)){ errEl.textContent='No admin access for this account.'; btn.disabled=false; btn.textContent='Verify Access'; return; }
    STATE.adminUser=user; initAdminPanel(user);
  } catch(err){ errEl.textContent='Auth error: '+err.message; btn.disabled=false; btn.textContent='Verify Access'; }
};

function initAdminPanel(user) {
  const gate=$('authGate');
  if(gate){ gate.style.opacity='0'; gate.style.transition='opacity .4s'; setTimeout(()=>gate.remove(),400); }
  const init=(user.displayName||user.email||'A').charAt(0).toUpperCase();
  if($('adminAvatar')) $('adminAvatar').textContent=init;
  if($('adminName'))   $('adminName').textContent=user.displayName||'Admin';
  if($('adminEmail'))  $('adminEmail').textContent=user.email;

  loadSession(); // ← restore draft test from sessionStorage

  listenTests(); listenActiveUsers(); listenUserHistory();
  listenAnnouncements(); listenPromotions(); listenNotifications();
  loadMaintenance();
}

// ── Create Test ────────────────────────────────────────────
window.selectExamCard = exam => {
  $('cuetSelectorCard').className='exam-selector-card'+(exam==='cuet'?' selected-cuet':'');
  $('jeeSelectorCard').className ='exam-selector-card'+(exam==='jee' ?' selected-jee' :'');
  $('ctExamCuet').checked=exam==='cuet'; $('ctExamJee').checked=exam==='jee';
  handleCreateExamChange();
};
window.handleCreateExamChange = () => {
  const exam=$('ctExamCuet').checked?'cuet':($('ctExamJee').checked?'jee':'');
  if($('ctCuetFields')) $('ctCuetFields').style.display=exam==='cuet'?'block':'none';
  if($('ctJeeFields'))  $('ctJeeFields').style.display =exam==='jee' ?'block':'none';
  if(exam==='cuet'){ $('ctTotalQ').value=50;  $('ctDuration').value=60; }
  if(exam==='jee') { $('ctTotalQ').value=90;  $('ctDuration').value=180; }
};
window.resetCreateForm = () => {
  ['ctYear','ctDate','ctShift','ctDuration','ctTotalQ','ctPaper','ctDesc','ctPhyQ','ctChemQ','ctMathQ'].forEach(id=>{ if($(id)) $(id).value=''; });
  $('ctTotalQ').value='50'; $('ctDuration').value='180';
  ['cuetSelectorCard','jeeSelectorCard'].forEach(id=>{ if($(id)) $(id).className='exam-selector-card'; });
  if($('ctExamCuet')) $('ctExamCuet').checked=false;
  if($('ctExamJee'))  $('ctExamJee').checked=false;
  if($('ctCuetFields')) $('ctCuetFields').style.display='none';
  if($('ctJeeFields'))  $('ctJeeFields').style.display='none';
};

window.createTest = async () => {
  const exam=$('ctExamCuet').checked?'cuet':($('ctExamJee').checked?'jee':'');
  if(!exam){ toast('Please select an exam.','warning'); return; }
  const date=$('ctDate').value, shift=$('ctShift').value;
  if(!date){ toast('Please select exam date.','warning'); return; }
  if(!shift){ toast('Please select shift.','warning'); return; }

  const btn=document.querySelector('[onclick="createTest()"]'), orig=btn.innerHTML;
  btn.disabled=true; btn.innerHTML='<span class="spinner"></span> Creating...';

  try {
    const testData={
      exam, year:parseInt($('ctYear').value)||new Date().getFullYear(), date, shift,
      duration:parseInt($('ctDuration').value)||180, totalQuestions:parseInt($('ctTotalQ').value)||50,
      marking:$('ctMarking').value, description:($('ctDesc')?.value||'').trim()||null,
      paper:(exam==='cuet'&&$('ctPaper')?.value.trim())||null,
      status:'draft', questionCount:0, createdAt:serverTimestamp(), createdBy:STATE.adminUser?.email||'admin'
    };
    if(exam==='jee') testData.subjects={physics:parseInt($('ctPhyQ')?.value)||30,chemistry:parseInt($('ctChemQ')?.value)||30,maths:parseInt($('ctMathQ')?.value)||30};

    const ref=await addDoc(collection(db,COLL.TESTS),testData);
    STATE.activeTest={id:ref.id,...testData,createdAt:Date.now()};
    STATE.draftQuestions=[]; STATE.qBlockCount=0;
    saveSession();

    toast(`Test created — ${exam.toUpperCase()} ${testData.year} · ${shift}`,'success');
    resetCreateForm(); showSection('sectionAddQuestions'); addQuestionBlock();
  } catch(err){ toast('Create failed: '+err.message,'error'); console.error(err); }
  finally{ btn.disabled=false; btn.innerHTML=orig; }
};

// ── Question Builder ───────────────────────────────────────
function refreshActiveTestBanner() {
  const banner=$('activeTestBanner'), nameEl=$('activeTestName'), metaEl=$('activeTestMeta'), cEl=$('qCounter'), dBadge=$('qDraftBadge');
  if(!STATE.activeTest){
    if(banner) banner.className='active-test-banner no-test';
    if(nameEl) nameEl.textContent='No test selected';
    if(metaEl) metaEl.textContent='Create a test first in Step 1';
    if(cEl)    cEl.textContent='0 / 0 Questions';
    if(dBadge) dBadge.style.display='none';
    return;
  }
  const t=STATE.activeTest;
  if(banner){ banner.className='active-test-banner'; const dot=banner.querySelector('.active-test-dot'); if(dot){dot.style.background='var(--accent-green)';dot.style.boxShadow='0 0 8px rgba(0,229,160,.6)';} }
  if(nameEl) nameEl.textContent=`${(t.exam||'').toUpperCase()} Mock ${t.year||''} · ${t.shift||''}`;
  if(metaEl) metaEl.textContent=`${formatDate(t.date)} · ${t.duration} min · ${t.totalQuestions} Questions · ${t.marking||''}`;
  const filled=document.querySelectorAll('.q-block .q-text').length, total=t.totalQuestions||50;
  if(cEl)    cEl.textContent=`${filled} / ${total} Questions`;
  if(dBadge){ dBadge.textContent=filled; dBadge.style.display=filled>0?'flex':'none'; dBadge.style.background=filled>=total?'var(--accent-green)':''; dBadge.style.color=filled>=total?'#07080d':''; }
}

window.addQuestionBlock = () => {
  const wrap=$('qBuilderWrap'); if(!wrap) return;
  if(!STATE.activeTest){ toast('Create a test first.','warning'); showSection('sectionCreateTest'); return; }
  const idx=STATE.qBlockCount++, qno=document.querySelectorAll('.q-block').length+1;
  const block=document.createElement('div');
  block.className='q-block'; block.id=`qBlock_${idx}`;
  block.innerHTML=`
    <div class="q-block-header">
      <div class="q-block-num">${qno}</div>
      <div class="q-block-label">Question ${qno}</div>
      <button class="q-block-remove" onclick="removeQuestionBlock(${idx})"><i class="fa-solid fa-xmark"></i> Remove</button>
    </div>
    <div class="form-grid cols-3" style="margin-bottom:12px;">
      <div class="form-group"><label class="form-label">Subject</label><input class="form-control q-subject" type="text" placeholder="Physics / Maths / GT..."></div>
      <div class="form-group"><label class="form-label">Section (optional)</label><input class="form-control q-section" type="text" placeholder="Section A / B..."></div>
      <div class="form-group"><label class="form-label">Type</label><select class="form-control q-type" onchange="handleQTypeChange(this,${idx})"><option value="mcq">MCQ</option><option value="integer">Integer Type</option></select></div>
    </div>
    <div class="form-group" style="margin-bottom:12px;"><label class="form-label">Question Text</label><textarea class="form-control q-text" rows="3" placeholder="Enter full question text..."></textarea></div>
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
      <div class="form-group"><label class="form-label">Correct Answer</label><input class="form-control q-correct" type="text" placeholder="A / B / C / D  or  integer value"></div>
      <div class="form-group"><label class="form-label">Q. No.</label><input class="form-control q-qno" type="number" value="${qno}" min="1"></div>
    </div>`;
  const ds=$('defaultSubject')?.value.trim(), dc=$('defaultSection')?.value.trim();
  if(ds) block.querySelector('.q-subject').value=ds;
  if(dc) block.querySelector('.q-section').value=dc;
  wrap.appendChild(block); block.scrollIntoView({behavior:'smooth',block:'nearest'});
  STATE.draftQuestions.push({_blockId:idx}); refreshActiveTestBanner();
};
window.removeQuestionBlock = idx => { const b=$(`qBlock_${idx}`); if(b) b.remove(); STATE.draftQuestions=STATE.draftQuestions.filter(q=>q._blockId!==idx); refreshActiveTestBanner(); };
window.clearAllQuestions   = async () => { const yes=await confirmModal('Clear All Questions','Remove all question blocks? (Not yet uploaded to Firebase)'); if(!yes) return; const w=$('qBuilderWrap'); if(w) w.innerHTML=''; STATE.draftQuestions=[]; STATE.qBlockCount=0; refreshActiveTestBanner(); };
window.handleQTypeChange   = (sel,idx) => { const w=$(`qMcqWrap_${idx}`); if(w) w.style.display=sel.value==='integer'?'none':'block'; };
window.syncDefaultSubject  = () => {};

function collectQuestionsFromDOM() {
  const blocks=document.querySelectorAll('.q-block'), out=[];
  blocks.forEach((block,idx)=>{
    const question=block.querySelector('.q-text')?.value.trim(); if(!question) return;
    const q={ subject:block.querySelector('.q-subject')?.value.trim()||'General', section:block.querySelector('.q-section')?.value.trim()||null, type:block.querySelector('.q-type')?.value||'mcq', question, questionNo:parseInt(block.querySelector('.q-qno')?.value)||(out.length+1), correctAnswer:block.querySelector('.q-correct')?.value.trim()||'' };
    if(q.type==='mcq') q.options=[block.querySelector('.q-optA')?.value.trim()||'',block.querySelector('.q-optB')?.value.trim()||'',block.querySelector('.q-optC')?.value.trim()||'',block.querySelector('.q-optD')?.value.trim()||''].filter(Boolean);
    out.push(q);
  });
  return out;
}

// ── Publish ────────────────────────────────────────────────
function renderPublishSummary() {
  const el=$('publishSummary'); if(!el) return;
  const questions=collectQuestionsFromDOM();
  if(!STATE.activeTest){ el.innerHTML=`<div class="empty-state"><div class="empty-state-text">No draft test. Go back to Create Test (Step 1).</div></div>`; if($('publishBtn')) $('publishBtn').disabled=true; return; }
  const t=STATE.activeTest, total=t.totalQuestions||50, ready=questions.length, pct=Math.min(100,Math.round((ready/total)*100));
  const color=ready>=total?'var(--accent-green)':(ready>0?'var(--accent-amber)':'var(--accent-red)');
  const sm={}; questions.forEach(q=>{ const k=q.subject||'Unknown'; sm[k]=(sm[k]||0)+1; });
  el.innerHTML=`<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin-bottom:20px;">
    <div style="background:rgba(0,224,255,.05);border:1px solid rgba(0,224,255,.1);border-radius:12px;padding:16px;text-align:center;"><div style="font-family:var(--font-display);font-size:22px;font-weight:800;color:var(--accent-cyan);">${(t.exam||'').toUpperCase()}</div><div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;margin-top:4px;">Exam</div></div>
    <div style="background:rgba(124,92,252,.05);border:1px solid rgba(124,92,252,.1);border-radius:12px;padding:16px;text-align:center;"><div style="font-family:var(--font-display);font-size:18px;font-weight:800;color:var(--accent-violet);">${t.year||'—'} · ${t.shift||'—'}</div><div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;margin-top:4px;">Year · Shift</div></div>
    <div style="background:rgba(0,229,160,.05);border:1px solid rgba(0,229,160,.1);border-radius:12px;padding:16px;text-align:center;"><div style="font-family:var(--font-display);font-size:22px;font-weight:800;color:${color};">${ready}/${total}</div><div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;margin-top:4px;">Questions Ready</div></div>
  </div>
  <div style="margin-bottom:16px;"><div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted);margin-bottom:6px;"><span>Completion</span><span style="color:${color}">${pct}%</span></div><div style="height:6px;background:rgba(255,255,255,.06);border-radius:99px;overflow:hidden;"><div style="height:100%;width:${pct}%;background:${pct>=100?'var(--accent-green)':'linear-gradient(90deg,var(--accent-cyan),var(--accent-violet))'};border-radius:99px;transition:width .5s;"></div></div></div>
  <div style="margin-bottom:16px;"><div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px;">Subject Breakdown</div>${Object.entries(sm).map(([s,c])=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.04);"><span style="font-size:13px;color:var(--text-primary);font-weight:500;">${escHtml(s)}</span><span class="badge badge-cyan">${c} Q</span></div>`).join('')||'<div style="color:var(--text-muted);font-size:13px;">No questions yet.</div>'}</div>
  <div style="font-size:12px;color:var(--text-muted);"><i class="fa-solid fa-circle-info" style="color:var(--accent-cyan);margin-right:4px;"></i>Date: ${formatDate(t.date)} · Duration: ${t.duration} min · Marking: ${t.marking||'—'}</div>`;
  if($('publishBtn')) $('publishBtn').disabled=ready===0;
}

window.publishTest = async () => {
  const questions=collectQuestionsFromDOM();
  if(!STATE.activeTest){ toast('No active test. Create one first.','warning'); return; }
  if(!questions.length){ toast('No valid questions. Fill in question text first.','warning'); return; }

  // FIXED: confirmModal now correctly returns true
  const yes=await confirmModal('Publish Test',`Upload ${questions.length} question${questions.length>1?'s':''} and publish ${(STATE.activeTest.exam||'').toUpperCase()} ${STATE.activeTest.year||''} · ${STATE.activeTest.shift||''}? This makes the test live for users.`);
  if(!yes) return;

  const btn=$('publishBtn'); btn.disabled=true; btn.innerHTML='<span class="spinner"></span> Uploading...';

  try {
    const testId=STATE.activeTest.id;
    const CHUNK=400;
    for(let c=0; c<Math.ceil(questions.length/CHUNK); c++){
      const batch=writeBatch(db);
      questions.slice(c*CHUNK,(c+1)*CHUNK).forEach((q,i)=>{
        const qRef=doc(collection(db,COLL.QUESTIONS));
        batch.set(qRef,{ testId, exam:STATE.activeTest.exam, year:STATE.activeTest.year, date:STATE.activeTest.date, shift:STATE.activeTest.shift, subject:q.subject||'General', section:q.section||null, questionNo:q.questionNo||(c*CHUNK+i+1), question:q.question, options:q.options||[], correctAnswer:q.correctAnswer||'', type:q.type||'mcq', createdAt:serverTimestamp() });
      });
      await batch.commit();
      if(Math.ceil(questions.length/CHUNK)>1) btn.innerHTML=`<span class="spinner"></span> Uploading ${Math.min((c+1)*CHUNK,questions.length)}/${questions.length}...`;
    }

    await updateDoc(doc(db,COLL.TESTS,testId),{ status:'published', questionCount:questions.length, publishedAt:serverTimestamp(), publishedBy:STATE.adminUser?.email||'admin' });

    toast(`Published! ${questions.length} questions uploaded.`,'success');
    STATE.activeTest=null; STATE.draftQuestions=[]; STATE.qBlockCount=0;
    saveSession();
    if($('qBuilderWrap')) $('qBuilderWrap').innerHTML='';
    refreshActiveTestBanner(); showSection('sectionTestManager');
  } catch(err){ toast('Publish failed: '+err.message,'error'); console.error('publishTest:',err); }
  finally{ btn.disabled=false; btn.innerHTML='<i class="fa-solid fa-cloud-arrow-up"></i> Publish Test Now'; }
};

// ── Listen Tests ───────────────────────────────────────────
function listenTests() {
  if(STATE.unsubTests) STATE.unsubTests();
  STATE.unsubTests=onSnapshot(
    query(collection(db,COLL.TESTS),orderBy('createdAt','desc')),
    snap=>{ STATE.allTests=snap.docs.map(d=>({id:d.id,...d.data()})); applyTestFilters(); updateDashboardStats(); renderDashRecentTests(); },
    err=>{ console.error('Tests listener:',err); }
  );
}

// ── Test Manager ───────────────────────────────────────────
window.applyTestFilters = () => {
  let list=[...STATE.allTests];
  const ef=$('tmFilterExam')?.value||'', sf=$('tmFilterStatus')?.value||'';
  if(ef) list=list.filter(t=>t.exam===ef);
  if(sf) list=list.filter(t=>t.status===sf);
  renderTestCards(list);
};
window.loadAllTests=()=>applyTestFilters();

function renderTestCards(tests) {
  const grid=$('testManagerGrid'); if(!grid) return;
  if(!tests.length){ grid.innerHTML=`<div class="empty-state" style="grid-column:1/-1;"><div class="empty-state-icon"><i class="fa-regular fa-folder-open"></i></div><div class="empty-state-text">No tests found</div></div>`; return; }
  const sc=s=>({published:'badge-green',draft:'badge-amber',archived:'badge-muted'}[s]||'badge-muted');
  grid.innerHTML=tests.map(t=>{
    const ec=t.exam==='cuet'?'cuet':'jee';
    return `<div class="test-card" onclick="viewTestDetail('${t.id}')">
      <div class="test-card-glow ${ec}"></div>
      <div class="test-card-exam ${ec}">${(t.exam||'').toUpperCase()} ${t.year||''}</div>
      <div class="test-card-meta">${formatDate(t.date)} · ${t.shift||'—'}<br>${t.duration||'—'} min · ${t.marking||'—'}${t.paper?`<br>Paper: ${escHtml(t.paper)}`:''}${t.description?`<br><span style="color:var(--text-secondary);font-size:11px;">${escHtml(t.description)}</span>`:''}</div>
      <div class="test-card-footer">
        <span class="badge ${sc(t.status)}" style="text-transform:capitalize;">${t.status||'draft'}</span>
        <span class="badge badge-cyan" style="margin-left:6px;"><i class="fa-solid fa-list-check" style="margin-right:4px;"></i>${t.questionCount||0} Q</span>
      </div>
      <div class="test-card-actions">
        ${t.status==='draft'?`<button class="btn btn-secondary" style="font-size:11px;padding:6px 10px;" onclick="event.stopPropagation();resumeDraftTest('${t.id}')"><i class="fa-solid fa-pen"></i> Resume</button>`:''}
        ${t.status==='published'?`<button class="btn btn-amber" style="font-size:11px;padding:6px 10px;" onclick="event.stopPropagation();archiveTest('${t.id}')"><i class="fa-solid fa-box-archive"></i> Archive</button>`:''}
        ${t.status==='archived'?`<button class="btn btn-success" style="font-size:11px;padding:6px 10px;" onclick="event.stopPropagation();unarchiveTest('${t.id}')"><i class="fa-solid fa-box-open"></i> Restore</button>`:''}
        <button class="btn btn-danger" style="font-size:11px;padding:6px 10px;" onclick="event.stopPropagation();deleteTest('${t.id}')"><i class="fa-solid fa-trash"></i></button>
      </div>
    </div>`;
  }).join('');
  if($('publishedBadge')) $('publishedBadge').textContent=STATE.allTests.filter(t=>t.status==='published').length;
}

window.resumeDraftTest = id => { const t=STATE.allTests.find(x=>x.id===id); if(!t) return; STATE.activeTest=t; saveSession(); toast(`Resumed: ${(t.exam||'').toUpperCase()} ${t.year||''} · ${t.shift||''}`,'info'); showSection('sectionAddQuestions'); };

window.viewTestDetail = async id => {
  const t=STATE.allTests.find(x=>x.id===id); if(!t) return;
  $('testDetailTitle').textContent=`${(t.exam||'').toUpperCase()} ${t.year||''} — ${t.shift||''}`;
  $('testDetailBody').innerHTML=`<div style="text-align:center;padding:20px;color:var(--text-muted);">Loading questions...</div>`;
  $('testDetailModal').classList.add('open');
  try {
    const snap=await getDocs(query(collection(db,COLL.QUESTIONS),where('testId','==',id),orderBy('questionNo')));
    const qs=snap.docs.map(d=>({id:d.id,...d.data()}));
    $('testDetailBody').innerHTML=`<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px;"><span class="badge badge-cyan">${(t.exam||'').toUpperCase()}</span><span class="badge badge-violet">${t.year||'—'} · ${t.shift||'—'}</span><span class="badge ${t.status==='published'?'badge-green':'badge-amber'}" style="text-transform:capitalize;">${t.status||'draft'}</span><span class="badge badge-muted">${t.duration||'—'} min</span><span class="badge badge-muted">${t.marking||'—'}</span>${t.paper?`<span class="badge badge-muted">${escHtml(t.paper)}</span>`:''}</div><div style="font-size:12px;color:var(--text-muted);margin-bottom:20px;">Date: ${formatDate(t.date)} · ${qs.length} Questions</div>${qs.length?`<div class="table-wrap" style="max-height:420px;overflow-y:auto;"><table><thead><tr><th>#</th><th>Subject</th><th>Type</th><th>Question</th><th>Correct</th><th>Del</th></tr></thead><tbody>${qs.map((q,i)=>`<tr><td style="font-family:var(--font-mono);font-size:12px;">${q.questionNo||(i+1)}</td><td><span class="badge badge-cyan" style="font-size:10px;">${escHtml(q.subject||'—')}</span></td><td><span class="badge badge-violet" style="font-size:10px;">${escHtml(q.type||'mcq')}</span></td><td style="max-width:240px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px;">${escHtml(q.question||'—')}</td><td style="font-family:var(--font-mono);color:var(--accent-green);font-size:12px;">${escHtml(q.correctAnswer||'—')}</td><td><button class="btn btn-danger" style="font-size:11px;padding:4px 8px;" onclick="deleteQuestion('${q.id}')"><i class="fa-solid fa-trash"></i></button></td></tr>`).join('')}</tbody></table></div>`:`<div class="empty-state"><div class="empty-state-text">No questions uploaded yet.</div></div>`}`;
  } catch(err){ $('testDetailBody').innerHTML=`<div class="empty-state"><div class="empty-state-text">Error: ${escHtml(err.message)}</div></div>`; console.error(err); }
};
window.closeTestDetailModal=()=>$('testDetailModal').classList.remove('open');

// FIXED: deleteQuestion, archiveTest, unarchiveTest, deleteTest now work
window.deleteQuestion = async id => { const yes=await confirmModal('Delete Question','Remove this question permanently?'); if(!yes) return; try{ await deleteDoc(doc(db,COLL.QUESTIONS,id)); toast('Question deleted.','info'); }catch(err){ toast('Failed: '+err.message,'error'); } };
window.archiveTest    = async id => { const yes=await confirmModal('Archive Test','Archive this test? Users won\'t see it.'); if(!yes) return; try{ await updateDoc(doc(db,COLL.TESTS,id),{status:'archived',archivedAt:serverTimestamp()}); toast('Archived.','info'); }catch(err){ toast('Failed: '+err.message,'error'); } };
window.unarchiveTest  = async id => { const yes=await confirmModal('Restore Test','Restore this test to published?'); if(!yes) return; try{ await updateDoc(doc(db,COLL.TESTS,id),{status:'published'}); toast('Restored.','success'); }catch(err){ toast('Failed: '+err.message,'error'); } };
window.deleteTest     = async id => {
  const yes=await confirmModal('Delete Test Permanently','This deletes the test AND all its questions. Cannot be undone.');
  if(!yes) return;
  try{
    const qSnap=await getDocs(query(collection(db,COLL.QUESTIONS),where('testId','==',id)));
    const docs=qSnap.docs;
    for(let i=0;i<docs.length;i+=499){ const b=writeBatch(db); docs.slice(i,i+499).forEach(d=>b.delete(d.ref)); await b.commit(); }
    await deleteDoc(doc(db,COLL.TESTS,id));
    toast('Test and all questions deleted.','info');
  }catch(err){ toast('Delete failed: '+err.message,'error'); console.error('deleteTest:',err); }
};
window.editTestStatus=(id,sec)=>{ const t=STATE.allTests.find(x=>x.id===id); if(t){ STATE.activeTest=t; saveSession(); refreshActiveTestBanner(); } showSection(sec); };

// ── Live Users ─────────────────────────────────────────────
function listenActiveUsers() {
  if(STATE.unsubActive) STATE.unsubActive();
  STATE.unsubActive=onSnapshot(collection(db,COLL.ACTIVE), snap=>{ STATE.liveUsers=snap.docs.map(d=>({id:d.id,...d.data()})); renderLiveUsers(); updateDashboardStats(); }, err=>console.error('ActiveUsers:',err));
}
function renderLiveUsers() {
  const users=STATE.liveUsers, cuet=users.filter(u=>(u.exam||'').toLowerCase()==='cuet').length, jee=users.filter(u=>(u.exam||'').toLowerCase()==='jee').length;
  animateStat($('liveTotal'),users.length); animateStat($('liveCuet'),cuet); animateStat($('liveJee'),jee); animateStat($('dashLiveUsers'),users.length);
  if($('liveCountBadge')) $('liveCountBadge').textContent=users.length;
  if($('dashLiveBadge'))  $('dashLiveBadge').textContent=`${users.length} Live`;
  const html=users.length?users.map(u=>`<div class="live-user-row"><div class="live-avatar">${(u.userName||u.name||'?')[0].toUpperCase()}</div><div style="flex:1;"><div class="live-user-name">${escHtml(u.userName||u.name||'Unknown')}</div><div class="live-user-meta">${(u.exam||'').toUpperCase()?`<span class="badge badge-${(u.exam||'').toUpperCase()==='CUET'?'cyan':'amber'}" style="font-size:9px;margin-right:6px;">${(u.exam||'').toUpperCase()}</span>`:''} ${escHtml(u.testName||u.shift||'')} ${u.startedAt?`· Started ${formatTimestamp(u.startedAt)}`:''}</div></div><div class="live-pulse"></div></div>`).join(''):`<div class="empty-state"><div class="empty-state-text">No users active right now</div></div>`;
  if($('liveUsersList')) $('liveUsersList').innerHTML=html;
  if($('dashLiveList'))  $('dashLiveList').innerHTML=html;
}

// ── User Test History ──────────────────────────────────────
function listenUserHistory() {
  if(STATE.unsubHistory) STATE.unsubHistory();
  STATE.unsubHistory=onSnapshot(query(collection(db,COLL.HISTORY),orderBy('submittedAt','desc'),limit(200)), snap=>{ STATE.allHistory=snap.docs.map(d=>({id:d.id,...d.data()})); applyHistoryFilters(); updateDashboardStats(); renderDashRecentUsers(); }, err=>console.error('History:',err));
}
window.applyHistoryFilters=()=>{ let l=[...STATE.allHistory]; const s=($('histSearch')?.value||'').toLowerCase(), e=$('histExamFilter')?.value||''; if(s) l=l.filter(h=>(h.userName||'').toLowerCase().includes(s)||(h.exam||'').toLowerCase().includes(s)); if(e) l=l.filter(h=>(h.exam||'').toLowerCase()===e); renderHistoryTable(l); };
window.loadUserHistory=()=>applyHistoryFilters();
function renderHistoryTable(h) {
  const tb=$('historyBody'); if(!tb) return;
  if(!h.length){ tb.innerHTML=`<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--text-muted);">No records found</td></tr>`; return; }
  tb.innerHTML=h.map((r,i)=>{ const init=(r.userName||'?')[0].toUpperCase(),exam=(r.exam||'').toUpperCase(),ec=exam==='CUET'?'badge-cyan':'badge-amber'; return `<tr><td style="font-family:var(--font-mono);font-size:12px;color:var(--text-muted);">${i+1}</td><td><div style="display:flex;align-items:center;gap:8px;"><div class="ru-avatar">${init}</div><div><div style="font-size:13px;font-weight:600;">${escHtml(r.userName||'—')}</div><div style="font-size:11px;color:var(--text-muted);">${escHtml(r.userEmail||'')}</div></div></div></td><td><span class="badge ${ec}">${exam||'—'}</span></td><td style="font-size:12px;color:var(--text-secondary);">${escHtml(r.shift||r.testName||'—')}</td><td style="font-family:var(--font-mono);color:var(--accent-cyan);font-size:13px;font-weight:700;">${r.score??'—'}/${r.total??'—'}</td><td style="font-family:var(--font-mono);color:var(--accent-green);font-size:12px;">${r.accuracy!=null?r.accuracy+'%':'—'}</td><td style="font-size:12px;color:var(--text-muted);">${r.timeTaken?formatTime(r.timeTaken):'—'}</td><td style="font-size:11px;color:var(--text-muted);">${formatTimestamp(r.submittedAt||r.date)}</td></tr>`; }).join('');
}

// ── Dashboard ──────────────────────────────────────────────
function updateDashboardStats() {
  const total=STATE.allTests.length, pub=STATE.allTests.filter(t=>t.status==='published').length, totalQ=STATE.allTests.reduce((s,t)=>s+(t.questionCount||0),0), att=STATE.allHistory.length;
  animateStat($('dashTotalTests'),total); animateStat($('dashPublished'),pub); animateStat($('dashTotalQ'),totalQ); animateStat($('dashAttempts'),att);
  if($('publishedBadge')) $('publishedBadge').textContent=pub;
}
function renderDashRecentTests() {
  const el=$('dashRecentTests'); if(!el) return;
  const r=STATE.allTests.slice(0,6);
  if(!r.length){ el.innerHTML=`<div class="empty-state"><div class="empty-state-text">No tests yet</div></div>`; return; }
  el.innerHTML=r.map(t=>`<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border);"><div style="flex:1;"><div style="font-size:13px;font-weight:600;color:var(--text-primary);">${(t.exam||'').toUpperCase()} ${t.year||''}</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${escHtml(t.shift||'—')} · ${formatDate(t.date)}</div></div><span class="badge ${t.status==='published'?'badge-green':'badge-amber'}" style="text-transform:capitalize;font-size:9px;">${t.status||'draft'}</span><span class="badge ${t.exam==='cuet'?'badge-cyan':'badge-amber'}" style="font-size:9px;">${t.questionCount||0} Q</span></div>`).join('');
}
function renderDashRecentUsers() {
  const el=$('dashRecentUsers'); if(!el) return;
  const r=STATE.allHistory.slice(0,6);
  if(!r.length){ el.innerHTML=`<div class="empty-state"><div class="empty-state-text">No attempts yet</div></div>`; return; }
  el.innerHTML=r.map(h=>`<div class="recent-user-item"><div class="ru-avatar">${(h.userName||'?')[0].toUpperCase()}</div><div class="ru-info"><div class="ru-name">${escHtml(h.userName||'—')}</div><div class="ru-meta">${(h.exam||'').toUpperCase()} · ${escHtml(h.shift||'—')} · ${formatTimestamp(h.submittedAt||h.date)}</div></div><div class="ru-score">${h.score??'—'}/${h.total??'—'}</div></div>`).join('');
}

// ── Announcements ──────────────────────────────────────────
function listenAnnouncements() {
  if(STATE.unsubAnnounce) STATE.unsubAnnounce();
  STATE.unsubAnnounce=onSnapshot(query(collection(db,COLL.ANNOUNCEMENTS),orderBy('time','desc'),limit(30)), snap=>renderAnnouncements(snap.docs.map(d=>({id:d.id,...d.data()}))), err=>console.error('Announcements:',err));
}
function renderAnnouncements(list) {
  const el=$('announceList'); if(!el) return;
  if(!list.length){ el.innerHTML=`<div class="empty-state"><div class="empty-state-text">No announcements yet</div></div>`; return; }
  el.innerHTML=list.map(a=>`<div class="announce-item"><span class="announce-priority p-${a.priority||'medium'}">${a.priority||'medium'}</span><div style="flex:1;"><div class="announce-text">${escHtml(a.text||'')}</div>${a.imageUrl?`<div style="font-size:11px;color:var(--accent-cyan);margin-top:3px;"><i class="fa-solid fa-image"></i> Image attached</div>`:''}<div class="announce-meta">${formatTimestamp(a.time)} · ${escHtml(a.target||'all')} · 📄 ${escHtml(a.page||'all')}</div></div><button class="announce-delete" onclick="deleteAnnouncement('${a.id}')"><i class="fa-solid fa-xmark"></i></button></div>`).join('');
}
window.sendAnnouncement=async()=>{
  const text=($('announceText')?.value||'').trim(), priority=$('announcePriority')?.value||'medium', imageUrl=($('announceImageUrl')?.value||'').trim(), page=$('announcePage')?.value||'mock-home', targetType=$('announceTarget')?.value||'all', selUser=($('announceUser')?.value||'').trim(), btn=$('announceBtn');
  if(!text){toast('Write an announcement first.','warning');return;} if(targetType==='user'&&!selUser){toast('Enter a target username.','warning');return;}
  btn.disabled=true; btn.innerHTML='<span class="spinner"></span> Sending…';
  try{ await addDoc(collection(db,COLL.ANNOUNCEMENTS),{text,imageUrl:imageUrl||null,priority,target:targetType==='user'?selUser:'all',user:targetType==='user'?selUser:null,page,active:true,time:Date.now(),createdAt:serverTimestamp()}); toast('Announcement sent!','success'); $('announceText').value=''; if($('announceImageUrl')) $('announceImageUrl').value=''; if($('announceUser')) $('announceUser').value=''; }
  catch(err){toast('Failed: '+err.message,'error');} finally{btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-megaphone"></i> Send Announcement';}
};
// FIXED
window.deleteAnnouncement=async id=>{const yes=await confirmModal('Delete Announcement','Remove from all user feeds?');if(!yes)return;try{await deleteDoc(doc(db,COLL.ANNOUNCEMENTS,id));toast('Deleted.','info');}catch(err){toast('Failed: '+err.message,'error');}};
window.previewAnnouncement=()=>{const text=($('announceText')?.value||'').trim();if(!text){toast('Write an announcement first.','warning');return;}$('confirmTitle').textContent='Preview';$('confirmBody').innerHTML=`<div style="background:rgba(0,224,255,.07);border:1px solid rgba(0,224,255,.2);border-radius:10px;padding:16px;color:var(--text-primary);line-height:1.6;">${escHtml(text)}</div>`;$('confirmOkBtn').style.display='';$('confirmOkBtn').textContent='Close';$('confirmOkBtn').className='btn btn-outline';$('confirmOkBtn').onclick=()=>{$('confirmModal').classList.remove('open');_confirmResolve=null;};$('confirmModal').classList.add('open');};

// ── Promotions ─────────────────────────────────────────────
function listenPromotions() {
  if(STATE.unsubPromo) STATE.unsubPromo();
  STATE.unsubPromo=onSnapshot(query(collection(db,COLL.PROMOTIONS),orderBy('time','desc'),limit(20)), snap=>renderPromotionHistory(snap.docs.map(d=>({id:d.id,...d.data()}))), err=>console.error('Promotions:',err));
}
function renderPromotionHistory(list) {
  const el=$('promoHistory'); if(!el) return;
  if(!list.length){el.innerHTML=`<div class="empty-state"><div class="empty-state-text">No promotions yet</div></div>`;return;}
  el.innerHTML=list.map(p=>`<div class="announce-item"><span class="announce-priority p-medium" style="text-transform:capitalize;">${escHtml(p.type||'popup')}</span><div style="flex:1;"><div style="font-weight:600;font-size:13px;">${escHtml(p.title||'—')}</div><div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">${escHtml(p.body||'')}</div>${p.url?`<div style="font-size:11px;color:var(--accent-cyan);margin-top:2px;">${escHtml(p.url)}</div>`:''}<div class="announce-meta">${formatTimestamp(p.time)} · <span style="color:${p.active?'var(--accent-green)':'var(--text-muted)'};">${p.active?'● Active':'○ Inactive'}</span> · 📄 ${escHtml(p.page||'all')}</div></div><div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end;"><button class="announce-delete" onclick="deletePromotion('${p.id}')"><i class="fa-solid fa-xmark"></i></button><button class="btn btn-outline" style="padding:4px 8px;font-size:10px;" onclick="togglePromoActive('${p.id}',${!p.active})">${p.active?'Deactivate':'Activate'}</button></div></div>`).join('');
}
window.selectPromoType=(type,el)=>{document.querySelectorAll('.promo-type-card').forEach(c=>c.classList.remove('selected'));el.classList.add('selected');$('promoType').value=type;const ig=$('promoBannerImgGroup');if(ig) ig.style.display=type==='banner'?'block':'none';};
window.sendPromotion=async()=>{
  const title=($('promoTitle')?.value||'').trim(),body=($('promoBody')?.value||'').trim(),cta=($('promoCTA')?.value||'').trim(),type=$('promoType')?.value||'popup',duration=parseInt($('promoDuration')?.value||'8'),imageUrl=($('promoBannerImageUrl')?.value||'').trim(),url=($('promoUrl')?.value||'').trim(),page=$('promoPage')?.value||'mock-home',platform=$('promoPlatform')?.value||'both',targetT=$('promoTarget')?.value||'all',selUser=($('promoUser')?.value||'').trim(),btn=$('promoBtn');
  if(!title&&!body){toast('Fill in title or message.','warning');return;} if(targetT==='user'&&!selUser){toast('Enter target username.','warning');return;}
  btn.disabled=true; btn.innerHTML='<span class="spinner"></span> Sending…';
  try{await addDoc(collection(db,COLL.PROMOTIONS),{type,title,body,cta:cta||'Got it',url:url||null,duration,imageUrl:imageUrl||null,page,platform,target:targetT==='user'?selUser:'all',user:targetT==='user'?selUser:null,active:true,time:Date.now(),createdAt:serverTimestamp()});toast(`${type} promotion sent!`,'success');$('promoTitle').value='';$('promoBody').value='';$('promoCTA').value='';if($('promoUrl')) $('promoUrl').value='';if($('promoUser')) $('promoUser').value='';}
  catch(err){toast('Failed: '+err.message,'error');} finally{btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-bullseye"></i> Send Promotion';}
};
// FIXED
window.deletePromotion=async id=>{const yes=await confirmModal('Delete Promotion','Remove permanently?');if(!yes)return;try{await deleteDoc(doc(db,COLL.PROMOTIONS,id));toast('Deleted.','info');}catch(err){toast('Failed: '+err.message,'error');}};
window.togglePromoActive=async(id,active)=>{try{await updateDoc(doc(db,COLL.PROMOTIONS,id),{active});toast(active?'Activated.':'Deactivated.','info');}catch(err){toast('Failed: '+err.message,'error');}};

// ── Notifications ──────────────────────────────────────────
function listenNotifications() {
  if(STATE.unsubNotify) STATE.unsubNotify();
  STATE.unsubNotify=onSnapshot(query(collection(db,COLL.NOTIFICATIONS),orderBy('time','desc'),limit(30)), snap=>renderNotificationHistory(snap.docs.map(d=>({id:d.id,...d.data()}))), err=>console.error('Notifications:',err));
}
function renderNotificationHistory(list) {
  const el=$('notifyHistory'); if(!el) return;
  if(!list.length){el.innerHTML=`<div class="empty-state"><div class="empty-state-text">No notifications yet</div></div>`;return;}
  el.innerHTML=list.map(n=>`<div class="announce-item"><span class="announce-priority p-medium">${n.target==='all'?'All':'User'}</span><div style="flex:1;"><div style="font-weight:600;font-size:13px;">${escHtml(n.icon||'🔔')} ${escHtml(n.title||'')}</div><div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">${escHtml(n.body||'')}</div><div class="announce-meta">${formatTimestamp(n.time)}${n.user?` · 👤 ${escHtml(n.user)}`:''}</div></div><button class="announce-delete" onclick="deleteNotification('${n.id}')"><i class="fa-solid fa-xmark"></i></button></div>`).join('');
}
window.sendNotification=async()=>{
  const target=$('notifyTarget')?.value||'all',user=($('notifyUser')?.value||'').trim(),title=($('notifyTitle')?.value||'').trim(),body=($('notifyText')?.value||'').trim(),icon=($('notifyIcon')?.value||'🔔').trim(),image=($('notifyImage')?.value||'').trim(),platform=$('notifyPlatform')?.value||'both',btn=$('notifyBtn');
  if(!title||!body){toast('Fill in title and message.','warning');return;} if(target==='user'&&!user){toast('Enter a target username.','warning');return;}
  btn.disabled=true; btn.innerHTML='<span class="spinner"></span> Sending…';
  try{await addDoc(collection(db,COLL.NOTIFICATIONS),{target:target==='all'?'all':user,user:target==='user'?user:null,title,body,icon,image:image||null,platform,read:false,time:Date.now(),sentAt:serverTimestamp()});toast(target==='all'?'Broadcast sent!':`Sent to ${user}!`,'success');['notifyTitle','notifyText','notifyUser','notifyImage'].forEach(id=>{if($(id)) $(id).value='';});if($('notifyIcon')) $('notifyIcon').value='🔔';}
  catch(err){toast('Failed: '+err.message,'error');} finally{btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-bell"></i> Send Notification';}
};
// FIXED
window.deleteNotification=async id=>{const yes=await confirmModal('Delete Notification','Remove permanently?');if(!yes)return;try{await deleteDoc(doc(db,COLL.NOTIFICATIONS,id));toast('Deleted.','info');}catch(err){toast('Failed: '+err.message,'error');}};
window.toggleUserField=()=>{ const v=$('notifyTarget')?.value,g=$('userTargetGroup'); if(g) g.style.display=v==='user'?'flex':'none'; };
window.toggleAnnounceUserField=()=>{ const v=$('announceTarget')?.value,g=$('announceUserGroup'); if(g) g.style.display=v==='user'?'flex':'none'; };
window.togglePromoUserField=()=>{ const v=$('promoTarget')?.value,g=$('promoUserGroup'); if(g) g.style.display=v==='user'?'flex':'none'; };

// ── Maintenance ────────────────────────────────────────────
async function loadMaintenance() {
  try{ const snap=await getDoc(doc(db,COLL.MAINTENANCE,'current')); if(!snap.exists()) return; const d=snap.data(); if($('maintenanceToggle')) $('maintenanceToggle').checked=d.enabled||false; if($('maintenanceMsg')) $('maintenanceMsg').value=d.message||''; if($('maintenanceEta')) $('maintenanceEta').value=d.eta||''; if($('maintenanceEmail')) $('maintenanceEmail').value=d.email||''; updateMaintenanceUI(d.enabled||false); }
  catch(err){console.warn('Maintenance:',err);}
}
function updateMaintenanceUI(enabled) {
  const s=$('maintenanceStatus'),t=$('maintenanceStatusText'),m=$('maintenanceStatusMeta'); if(!s) return;
  if(enabled){ s.className='maintenance-status on'; const i=s.querySelector('i'); if(i){i.className='fa-solid fa-triangle-exclamation';i.style.color='var(--accent-red)';} if(t) t.textContent='Maintenance Mode Active'; if(m) m.textContent='mock-home.html is currently blocked.'; }
  else{ s.className='maintenance-status off'; const i=s.querySelector('i'); if(i){i.className='fa-solid fa-circle-check';i.style.color='var(--accent-green)';} if(t) t.textContent='All Systems Operational'; if(m) m.textContent='mock-home.html is live and accessible.'; }
}
window.toggleMaintenance=enabled=>updateMaintenanceUI(enabled);
window.saveMaintenance=async()=>{
  const enabled=$('maintenanceToggle')?.checked||false,message=($('maintenanceMsg')?.value||'').trim(),eta=$('maintenanceEta')?.value||'',email=($('maintenanceEmail')?.value||'').trim();
  try{await setDoc(doc(db,COLL.MAINTENANCE,'current'),{enabled,message:message||null,eta:eta||null,email:email||null,updatedAt:serverTimestamp(),updatedBy:STATE.adminUser?.email||'admin'});toast(enabled?'Maintenance mode enabled.':'Maintenance saved.',enabled?'warning':'success');updateMaintenanceUI(enabled);}
  catch(err){toast('Save failed: '+err.message,'error');}
};
window.clearMaintenance=async()=>{
  if($('maintenanceToggle')) $('maintenanceToggle').checked=false;
  try{await setDoc(doc(db,COLL.MAINTENANCE,'current'),{enabled:false,updatedAt:serverTimestamp(),updatedBy:STATE.adminUser?.email||'admin'},{merge:true});toast('Maintenance cleared. System is live.','success');updateMaintenanceUI(false);}
  catch(err){toast('Failed: '+err.message,'error');}
};

// ── Logout ─────────────────────────────────────────────────
// FIXED
window.doLogout=async()=>{const yes=await confirmModal('Logout','Sign out of the admin panel?');if(!yes)return;try{[STATE.unsubTests,STATE.unsubActive,STATE.unsubHistory,STATE.unsubAnnounce,STATE.unsubPromo,STATE.unsubNotify].forEach(fn=>{try{if(fn) fn();}catch(e){}});await signOut(auth);window.location.reload();}catch(err){toast('Logout failed: '+err.message,'error');}};

// ── CSV / JSON Import ──────────────────────────────────────
window.importCSV=function(input){if(!STATE.activeTest){toast('Create a test first.','warning');input.value='';return;}const file=input.files[0];if(!file)return;const r=new FileReader();r.onload=e=>{const lines=e.target.result.split('\n').filter(l=>l.trim());if(lines.length<2){toast('CSV empty or no data.','error');return;}const headers=lines[0].split(',').map(h=>h.trim().toLowerCase().replace(/\s/g,''));let count=0;for(let i=1;i<lines.length;i++){const cols=lines[i].split(',').map(c=>c.trim().replace(/^"|"$/g,''));if(cols.every(c=>!c)) continue;const row={};headers.forEach((h,j)=>row[h]=cols[j]||'');if(!row.question) continue;addQuestionBlockFromData({questionNo:parseInt(row.questionno||row['q.no']||row.qno)||i,subject:row.subject||'General',section:row.section||null,type:row.type||'mcq',question:row.question,optionA:row.optiona,optionB:row.optionb,optionC:row.optionc,optionD:row.optiond,correctAnswer:row.correctanswer||row.correct||row.answer||''});count++;}toast(`${count} question${count!==1?'s':''} imported from CSV!`,'success');};r.onerror=()=>toast('Failed to read CSV.','error');r.readAsText(file);input.value='';};
window.importJSON=function(input){if(!STATE.activeTest){toast('Create a test first.','warning');input.value='';return;}const file=input.files[0];if(!file)return;const r=new FileReader();r.onload=e=>{try{const data=JSON.parse(e.target.result);const qs=Array.isArray(data)?data:(data.questions||[]);if(!qs.length){toast('No questions in JSON.','warning');return;}qs.forEach((q,i)=>addQuestionBlockFromData({questionNo:q.questionNo||q.qno||(i+1),subject:q.subject||'General',section:q.section||null,type:q.type||'mcq',question:q.question||q.text||'',optionA:q.options?.[0]??q.optionA??'',optionB:q.options?.[1]??q.optionB??'',optionC:q.options?.[2]??q.optionC??'',optionD:q.options?.[3]??q.optionD??'',correctAnswer:q.correctAnswer||q.correct||q.answer||''}));toast(`${qs.length} question${qs.length!==1?'s':''} imported!`,'success');}catch(err){toast('Invalid JSON: '+err.message,'error');}};r.onerror=()=>toast('Failed to read JSON.','error');r.readAsText(file);input.value='';};
function addQuestionBlockFromData(data){if(!$('qBuilderWrap')) return;window.addQuestionBlock();const idx=STATE.qBlockCount-1,block=$(`qBlock_${idx}`);if(!block) return;const set=(sel,val)=>{if(val!==undefined&&val!==null&&val!==''){const el=block.querySelector(sel);if(el) el.value=val;}};set('.q-subject',data.subject);set('.q-section',data.section);set('.q-text',data.question);set('.q-correct',data.correctAnswer);set('.q-qno',data.questionNo);set('.q-optA',data.optionA);set('.q-optB',data.optionB);set('.q-optC',data.optionC);set('.q-optD',data.optionD);if(data.type){const t=block.querySelector('.q-type');if(t){t.value=data.type;window.handleQTypeChange(t,idx);}}}

// ── Utilities ──────────────────────────────────────────────
function animateStat(el,val){if(!el)return;el.classList.remove('value-flash');void el.offsetWidth;el.textContent=val;el.classList.add('value-flash');}
function escHtml(str){if(!str&&str!==0)return '';return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function formatDate(d){if(!d)return '—';try{return new Date(d).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});}catch{return String(d);}}
function formatTimestamp(ts){if(!ts)return '—';let d;if(ts?.toDate) d=ts.toDate();else if(typeof ts==='number') d=new Date(ts);else if(ts instanceof Date) d=ts;else return '—';const diff=(Date.now()-d.getTime())/1000;if(diff<60)return 'just now';if(diff<3600)return `${Math.floor(diff/60)}m ago`;if(diff<86400)return `${Math.floor(diff/3600)}h ago`;return d.toLocaleDateString('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});}
function formatTime(s){if(!s)return '—';const h=Math.floor(s/3600),m=Math.floor((s%3600)/60);return h>0?`${h}h ${m}m`:`${m}m`;}

// End of admin-mock.js v3.1
