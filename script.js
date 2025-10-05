/* script.js — إعادة بناء كاملة
   متوافق مع index.html و style.css اللذين زودتني بهما.
   يعتمد اسم الإكسل الأساسي على النمط: product.template(XXX).xlsx
   XXX هو رقم القالب المتغير وسيعرض في الشريط.
*/

/* ----------------------------- إعدادات ومتحولات ----------------------------- */
const EXCEL_FILENAME_PATTERN = /^product\.template\((\d+)\)\.xlsx$/i;
const STORAGE_KEY_EXCEL = 'excel_rows_v2';
const STORAGE_KEY_FINAL = 'final_selection_v2';
const STORAGE_KEY_ADMIN_HASH = 'admin_hash_v2';
const NAME_IDX = 0, PRICE_IDX = 1, SCALE_IDX = 2, BARCODE_IDX = 3; // افتراض ترتيب الأعمدة إن كانت مصفوفة headerless

/* DOM refs */
const statusEl = document.getElementById('status');
const templateBadge = document.getElementById('templateBadge');
const templateNumberEl = document.getElementById('templateNumber');
const messagesPanel = document.getElementById('messagesPanel');
const persistentNotice = document.getElementById('persistentNotice');
const dismissPersistent = document.getElementById('dismissPersistent');

const searchBar = document.getElementById('searchBar');
const searchBtn = document.getElementById('searchBtn');
const clearBtn = document.getElementById('clearBtn');
const uploadBtn = document.getElementById('uploadBtn');
const fileInput = document.getElementById('fileInput');
const excelFileInput = document.getElementById('excelFile');

const cameraBtn = document.getElementById('cameraBtn');
const scaleBtn = document.getElementById('scaleBtn');
const adminBtn = document.getElementById('adminBtn');

const resultsTbody = document.querySelector('#results tbody');
const clearResultsBtn = document.getElementById('clearResultsBtn');

const finalTbody = document.querySelector('#finalResults tbody');
const selectedCountEl = document.getElementById('selectedCount');
const showCancelledBtn = document.getElementById('showCancelledBtn');
const clearAllBtn = document.getElementById('clearAllBtn');

const exportExcelBtn = document.getElementById('exportBtn');
const exportPdfBtn = document.getElementById('exportPdfBtn');

const reader = document.getElementById('reader');

const receiveModalOverlay = document.getElementById('receiveModal');
const modalName = document.getElementById('modalName');
const modalInput = document.getElementById('modalInput');
const modalBack = document.getElementById('modalBack');
const modalCancel = document.getElementById('modalCancel');
const modalConfirm = document.getElementById('modalConfirm');

const dupWarningEl = document.getElementById('dupWarning');
const selectedProductsHiddenTable = document.getElementById('selectedProducts'); // قد يكون مخفياً

/* حالة التطبيق */
let excelData = [];           // مصفوفة الصفوف (كل صف مصفوفة خلايا)
let headerRow = null;         // في حال وجود رؤوس
let startIndex = 0;           // مكان بداية البيانات (0 أو 1)
let templateNumber = null;

let finalMap = new Map();     // uid -> { uid, rowArray, qty, createdAt, status }
let modalOpen = false;
let modalSourceIndex = null;
let modalEditingUid = null;

let scannerRunning = false;
let qrScanner = null;
let lastScan = { text: null, time: 0, tol: 800 };

let showCancelled = false;
let scaleFilterActive = false;

/* ----------------------------- مساعدات UI ----------------------------- */
function createToastElement(type, text) {
  const el = document.createElement('div');
  el.className = `toast ${type || 'info'}`;
  const msg = document.createElement('div'); msg.className = 'msg'; msg.textContent = text;
  const closeBtn = document.createElement('button'); closeBtn.className = 'closeBtn'; closeBtn.innerHTML = '✕';
  closeBtn.addEventListener('click', () => el.remove());
  el.appendChild(msg); el.appendChild(closeBtn);
  return el;
}
function showToast(type, text, timeout = 4000) {
  try {
    const el = createToastElement(type, text);
    messagesPanel.appendChild(el);
    if (timeout) setTimeout(() => { try { el.remove(); } catch (e) {} }, timeout);
  } catch (e) { console[type === 'error' ? 'error' : 'log'](text); }
}
function setStatus(text, ok = true) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.style.background = ok ? 'var(--accent)' : 'var(--danger)';
}
function escapeHtml(s) {
  return String(s||'').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[ch]));
}

/* ----------------------------- تحويل ArrayBuffer إلى base64 (خطوط/pdf) ----------------------------- */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

/* ----------------------------- تحميل ملف الإكسل تلقائيًا إذا وجد -----------------------------
   نستخدم الـ fetch لمحاولة تحميل أي ملف يطابق pattern في نفس المجلد.
   للأسف لا يمكننا استعراض مجلد السيرفر مباشرة من الجهة العميلة،
   لذلك نفترض وجود ملف باسم محدد يتم تكوينه من الرقم داخل القوسين إذا كان معروفاً،
   لكن بناءً على طلبك سنجرب هذه الآلية العملية:
   - نحاول تحميل product.template(XXX).xlsx لكل رقم من 0 إلى 999 بسرعة طفيفة
   - لكن لتفادي طلبات كثيرة سنجرب أولاً الأرقام الشائعة: (240) ثم 0..50؟
   ملاحظة: في بيئة حقيقية من الأفضل أن يضع الخادم endpoint يُرجع اسم الملف الصحيح.
----------------------------------------------------------------------------*/

/* نفذت استراتيجية متوازنة: نحاول تحميل أولًا product.template(240).xlsx،
   ثم إذا فشل نعرض إمكانية الرفع اليدوي. */
async function tryAutoLoadTemplate() {
  const preferred = 240; // القيمة الابتدائية شائعة كما ذكرت
  const filenamesToTry = [`product.template(${preferred}).xlsx`];

  // يمكنك إضافة أرقام أخرى هنا إن أردت البحث تلقائيًا على نطاق أوسع
  for (const name of filenamesToTry) {
    try {
      const res = await fetch(name, { method: 'GET' });
      if (!res.ok) continue;
      const ab = await res.arrayBuffer();
      await parseWorkbook(ab, name);
      return;
    } catch (err) {
      // تجاهل وجرّب التالي
    }
  }

  // لو لم نعثر: نبحث في التخزين المحلي snapshot
  try {
    const raw = localStorage.getItem(STORAGE_KEY_EXCEL);
    if (raw) {
      excelData = JSON.parse(raw);
      startIndex = 1;
      setStatus('تم تحميل بيانات الإكسل من الذاكرة المحلية', true);
      showToast('info', 'تم تحميل بيانات الإكسل من الذاكرة المحلية');
      return;
    }
  } catch (e) {}

  // لم نعثر — نعرض حالة واضحة وندع المستخدم يرفع الملف يدوياً
  setStatus('لم يتم العثور على ملف الإكسل product.template(XXX).xlsx — ارفع الملف يدوياً', false);
  templateBadge.style.display = 'none';
}

/* ----------------------------- parsing الإكسل ----------------------------- */
async function parseWorkbook(arrayBuffer, sourceName) {
  try {
    const wb = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
    const sheetName = wb.SheetNames[0];
    const raw = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1 });
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new Error('ورقة الإكسل فارغة');
    }
    // نقرر هل الصف الأول رؤوس نصية أم بيانات
    const firstRowCombined = (raw[0] || []).join(' ');
    if (/[^\s]/.test(firstRowCombined) && /[A-Za-z\u0600-\u06FF]/.test(firstRowCombined)) {
      headerRow = raw[0];
      excelData = raw;
      startIndex = 1;
    } else {
      headerRow = null;
      excelData = raw;
      startIndex = 0;
    }

    // حفظ snapshot محليًا لتشغيل offline لاحقًا
    try { localStorage.setItem(STORAGE_KEY_EXCEL, JSON.stringify(excelData)); } catch (e) {}

    // استخرج رقم القالب من اسم المصدر لو أمكن
    if (sourceName) {
      const m = EXCEL_FILENAME_PATTERN.exec(sourceName.split('/').pop());
      if (m) {
        templateNumber = m[1];
        templateNumberEl.textContent = templateNumber;
        templateBadge.style.display = '';
      }
    }

    setStatus(`تم تحميل: ${sourceName || 'ملف محلي'}`, true);
    showToast('success', `تم تحميل ${sourceName || 'الملف'}`);
    renderResultsEmpty();
  } catch (err) {
    console.error('parseWorkbook', err);
    setStatus('فشل قراءة الإكسل', false);
    showToast('error', 'فشل قراءة ملف الإكسل');
  }
}

/* ----------------------------- رفع ملف يدوي ----------------------------- */
statusEl && statusEl.addEventListener('dblclick', () => fileInput && fileInput.click());
uploadBtn && uploadBtn.addEventListener('click', () => fileInput && fileInput.click());

if (fileInput) {
  fileInput.addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (!EXCEL_FILENAME_PATTERN.test(f.name)) {
      showToast('error', 'اسم الملف غير مطابق للنمط required: product.template(XXX).xlsx');
      return;
    }
    const r = new FileReader();
    r.onload = (ev) => parseWorkbook(ev.target.result, f.name);
    r.onerror = () => { setStatus('فشل قراءة الملف المحلي', false); showToast('error', 'فشل قراءة الملف المحلي'); };
    r.readAsArrayBuffer(f);
  });
}

/* أيضاً السماح برفع عبر العنصر المرئي excelFile (اختياري) */
if (excelFileInput) {
  excelFileInput.addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (!EXCEL_FILENAME_PATTERN.test(f.name)) {
      showToast('error', 'اسم الملف غير مطابق للنمط required: product.template(XXX).xlsx');
      return;
    }
    const r = new FileReader();
    r.onload = (ev) => parseWorkbook(ev.target.result, f.name);
    r.onerror = () => { setStatus('فشل قراءة الملف المحلي', false); showToast('error', 'فشل قراءة الملف المحلي'); };
    r.readAsArrayBuffer(f);
  });
}

/* ----------------------------- دوال مساعدة للبحث / uid ----------------------------- */
function getCell(row, idx) {
  if (!row) return '';
  const v = row[idx];
  return (v === undefined || v === null) ? '' : String(v);
}
function uidFromRow(row) {
  const bc = getCell(row, BARCODE_IDX).trim();
  const sc = getCell(row, SCALE_IDX).trim();
  const name = getCell(row, NAME_IDX).trim();
  if (bc) return `BC::${bc}`;
  if (sc) return `SC::${sc}`;
  return `NM::${name}`;
}

/* ----------------------------- البحث وعرض نتائج البحث ----------------------------- */
function renderResultsEmpty() {
  if (resultsTbody) resultsTbody.innerHTML = '';
  if (dupWarningEl) dupWarningEl.style.display = 'none';
  if (clearResultsBtn) clearResultsBtn.style.display = 'none';
}

function checkClearResults() {
  clearResultsBtn && (clearResultsBtn.style.display = (resultsTbody && resultsTbody.rows.length === 0) ? 'none' : 'inline-block');
}

function applyScaleFilter(tbody) {
  if (!tbody) return;
  Array.from(tbody.rows).forEach(row => {
    const codeCell = row.cells[2]; // كود الميزان في العمود 3
    const val = codeCell ? (codeCell.textContent || '').trim() : '';
    row.style.display = (scaleFilterActive && val === '') ? 'none' : '';
  });
}

function search(fromScanner = false, value = '') {
  const q = (fromScanner ? String(value) : (searchBar.value || '')).trim();
  if (!resultsTbody) return;
  resultsTbody.innerHTML = '';
  dupWarningEl && (dupWarningEl.style.display = 'none');
  if (!Array.isArray(excelData) || excelData.length <= startIndex) { checkClearResults(); return; }
  if (!q) { checkClearResults(); return; }

  const seen = new Set();
  let dupFound = false;

  const lowerQ = q.toLowerCase();

  for (let i = startIndex; i < excelData.length; i++) {
    const row = excelData[i] || [];
    if (row.length === 0) continue;
    const name = getCell(row, NAME_IDX).toLowerCase();
    const price = getCell(row, PRICE_IDX);
    const scale = getCell(row, SCALE_IDX).toLowerCase();
    const bc = getCell(row, BARCODE_IDX).toLowerCase();

    if (name.includes(lowerQ) || scale.includes(lowerQ) || bc.includes(lowerQ)) {
      const uid = uidFromRow(row);
      if (seen.has(uid)) { dupFound = true; continue; }
      seen.add(uid);

      const tr = document.createElement('tr');
      tr.dataset.sourceIndex = i;
      tr.dataset.uid = uid;

      const tdName = document.createElement('td'); tdName.textContent = getCell(row, NAME_IDX); tr.appendChild(tdName);
      const tdPrice = document.createElement('td'); tdPrice.textContent = price; tr.appendChild(tdPrice);
      const tdScale = document.createElement('td'); tdScale.textContent = getCell(row, SCALE_IDX); tr.appendChild(tdScale);
      const tdBc = document.createElement('td'); tdBc.textContent = getCell(row, BARCODE_IDX); tr.appendChild(tdBc);

      const tdAction = document.createElement('td');
      const receiveBtn = document.createElement('button');
      receiveBtn.type = 'button';
      receiveBtn.className = 'btn primary';
      receiveBtn.textContent = 'استلام';
      receiveBtn.addEventListener('click', (ev) => { ev.stopPropagation(); openReceiveModal(i); });
      tdAction.appendChild(receiveBtn);
      tr.appendChild(tdAction);

      resultsTbody.appendChild(tr);
    }
  }

  if (dupFound) {
    dupWarningEl && (dupWarningEl.textContent = 'تحذير: يوجد تكرار لنفس المنتج — عرض نسخة واحدة فقط.', dupWarningEl.style.display = 'block');
  } else {
    dupWarningEl && (dupWarningEl.style.display = 'none');
  }

  applyScaleFilter(resultsTbody);
  checkClearResults();

  if (fromScanner && value) {
    // إذا المدخل يمثل كودًا خطيًا تمامًا، نفتح المودال (المطلوب)
    const matchIndex = findRowByValue(value);
    if (matchIndex !== null) {
      if (!modalOpen) openReceiveModal(matchIndex);
    }
  }
}

function findRowByValue(val) {
  if (!Array.isArray(excelData) || excelData.length <= startIndex) return null;
  const v = String(val || '').trim();
  if (!v) return null;
  for (let i = startIndex; i < excelData.length; i++) {
    const row = excelData[i] || [];
    if (getCell(row, BARCODE_IDX).trim() === v) return i;
  }
  for (let i = startIndex; i < excelData.length; i++) {
    const row = excelData[i] || [];
    if (getCell(row, SCALE_IDX).trim() === v) return i;
  }
  for (let i = startIndex; i < excelData.length; i++) {
    const row = excelData[i] || [];
    if (getCell(row, NAME_IDX).toLowerCase().includes(v.toLowerCase())) return i;
  }
  return null;
}

/* ربط أزرار البحث ومسح الحقل */
searchBtn && searchBtn.addEventListener('click', () => {
  // إذا ما دخل المستخدم شيء، لا نفعل
  if (!searchBar.value || !searchBar.value.trim()) { showToast('info', 'اكتب ما تود البحث عنه'); return; }
  // إذا الإدخال يطابق كود خطي موجود، سنفتح المودال بدل عرض النتائج
  const val = searchBar.value.trim();
  const matched = findRowByValue(val);
  if (matched !== null && (getCell(excelData[matched], BARCODE_IDX).trim() === val || getCell(excelData[matched], SCALE_IDX).trim() === val)) {
    openReceiveModal(matched);
    return;
  }
  search(false);
});
clearBtn && clearBtn.addEventListener('click', () => { searchBar.value = ''; renderResultsEmpty(); });

/* ----------------------------- فلتر كود الميزان ----------------------------- */
scaleBtn && scaleBtn.addEventListener('click', () => {
  scaleFilterActive = !scaleFilterActive;
  scaleBtn.classList.toggle('btn.warn', scaleFilterActive);
  applyScaleFilter(resultsTbody);
});

/* ----------------------------- مودال الاستلام (فتح/غلق/تأكيد) ----------------------------- */
function openReceiveModal(sourceIndex) {
  modalSourceIndex = sourceIndex;
  modalEditingUid = null;
  modalOpen = true;
  const row = excelData[sourceIndex] || [];
  modalName.textContent = getCell(row, NAME_IDX) || '';
  const uid = uidFromRow(row);
  if (finalMap.has(uid)) modalInput.value = finalMap.get(uid).qty || ''; else modalInput.value = '';
  if (receiveModalOverlay) receiveModalOverlay.style.display = 'flex';
  setTimeout(() => { try { modalInput.focus(); modalInput.select && modalInput.select(); } catch (e) {} }, 120);
}
function openEditFinal(uid) {
  if (!finalMap.has(uid)) return;
  modalEditingUid = uid;
  modalSourceIndex = null;
  modalOpen = true;
  const entry = finalMap.get(uid);
  modalName.textContent = getCell(entry.rowArray, NAME_IDX) || '';
  modalInput.value = entry.qty || '';
  if (receiveModalOverlay) receiveModalOverlay.style.display = 'flex';
  setTimeout(() => { try { modalInput.focus(); modalInput.select && modalInput.select(); } catch (e) {} }, 120);
}
function closeModal() {
  if (receiveModalOverlay) receiveModalOverlay.style.display = 'none';
  modalInput.value = '';
  modalSourceIndex = null;
  modalEditingUid = null;
  modalOpen = false;
}
if (receiveModalOverlay) {
  receiveModalOverlay.addEventListener('click', function (e) {
    if (e.target === receiveModalOverlay) closeModal();
  });
}

/* numpad */
document.querySelectorAll('.numpad button[data-key]').forEach(btn => {
  btn.addEventListener('click', () => {
    const k = btn.getAttribute('data-key');
    insertAtCaret(modalInput, k);
    modalInput.focus();
  });
});
modalBack && modalBack.addEventListener('click', () => { backspaceAtCaret(modalInput); modalInput.focus(); });

function insertAtCaret(input, text) {
  try {
    const start = input.selectionStart || 0;
    const end = input.selectionEnd || 0;
    const val = input.value || '';
    input.value = val.slice(0, start) + text + val.slice(end);
    const pos = start + text.length;
    input.setSelectionRange(pos, pos);
  } catch (e) { input.value = (input.value || '') + text; }
}
function backspaceAtCaret(input) {
  try {
    const start = input.selectionStart || 0;
    const end = input.selectionEnd || 0;
    if (start === end && start > 0) {
      const val = input.value || '';
      input.value = val.slice(0, start - 1) + val.slice(end);
      const pos = start - 1;
      input.setSelectionRange(pos, pos);
    } else {
      const val = input.value || '';
      input.value = val.slice(0, start) + val.slice(end);
      input.setSelectionRange(start, start);
    }
  } catch (e) { input.value = (input.value || '').slice(0, -1); }
}

/* تأكيد المودال */
function modalConfirmHandler() {
  const v = (modalInput.value || '').trim();
  if (v === '') { showToast('error', 'لا يمكن ترك الحقل فارغاً'); modalInput.focus(); return; }
  const num = Number(v);
  if (!isFinite(num) || num <= 0) { showToast('error', 'الرجاء إدخال رقم صالح أكبر من صفر'); modalInput.focus(); return; }

  if (modalEditingUid) {
    const entry = finalMap.get(modalEditingUid);
    if (entry) {
      entry.qty = v; entry.createdAt = (new Date()).toISOString();
      finalMap.set(modalEditingUid, entry);
      saveFinalToStorage(); renderFinals(); showToast('success', 'تم تعديل الكمية');
    }
    closeModal(); return;
  }

  if (modalSourceIndex == null) { showToast('error', 'خطأ: لا توجد بيانات مصدر'); closeModal(); return; }

  const rowArray = excelData[modalSourceIndex] || [];
  addOrUpdateFinal(rowArray, v);
  searchBar.value = '';
  try { searchBar.focus(); } catch (e) {}
  closeModal();
}
modalConfirm && modalConfirm.addEventListener('click', modalConfirmHandler);
modalCancel && modalCancel.addEventListener('click', closeModal);

/* اختصارات كيبورد داخل المودال */
document.addEventListener('keydown', function (e) {
  if (modalOpen) {
    if (e.key === 'Enter') { e.preventDefault(); modalConfirmHandler(); return; }
    if (e.key === 'Escape') { e.preventDefault(); closeModal(); return; }
    if ((e.key >= '0' && e.key <= '9') || e.key === '.') {
      if (document.activeElement !== modalInput) { insertAtCaret(modalInput, e.key); e.preventDefault(); } return;
    }
    if (e.key === 'Backspace') {
      if (document.activeElement !== modalInput) { backspaceAtCaret(modalInput); e.preventDefault(); } return;
    }
  } else {
    if (e.key === 'Enter' && document.activeElement === searchBar) { e.preventDefault(); search(false); }
  }
});

/* ----------------------------- إدارة finalMap وlocalStorage ----------------------------- */
function loadFinalFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_FINAL);
    if (!raw) return;
    const arr = JSON.parse(raw);
    finalMap.clear();
    arr.forEach(item => finalMap.set(item.uid, item));
    renderFinals();
  } catch (e) { console.error('loadFinalFromStorage', e); }
}
function saveFinalToStorage() {
  try {
    const arr = Array.from(finalMap.values()).map(e => ({ uid: e.uid, rowArray: e.rowArray, qty: e.qty, createdAt: e.createdAt, status: e.status }));
    localStorage.setItem(STORAGE_KEY_FINAL, JSON.stringify(arr));
    updatePersistentNotice();
  } catch (e) { console.error('saveFinalToStorage', e); }
}

function addOrUpdateFinal(rowArray, qty) {
  const uid = uidFromRow(rowArray);
  const now = (new Date()).toISOString();
  if (finalMap.has(uid)) {
    const entry = finalMap.get(uid);
    entry.qty = qty; entry.createdAt = now; entry.status = entry.status || 'received';
    finalMap.set(uid, entry);
    showToast('success', 'تم تحديث المنتج: ' + (getCell(rowArray, NAME_IDX) || uid));
  } else {
    const entry = { uid, rowArray, qty, createdAt: now, status: 'received' };
    finalMap.set(uid, entry);
    showToast('success', 'تم إضافة المنتج: ' + (getCell(rowArray, NAME_IDX) || uid));
  }
  saveFinalToStorage(); renderFinals();
}

/* ----------------------------- عرض Final table ----------------------------- */
function renderFinals() {
  if (!finalTbody) return;
  finalTbody.innerHTML = '';
  Array.from(finalMap.values()).sort((a,b)=> b.createdAt.localeCompare(a.createdAt)).forEach(entry => {
    if (entry.status === 'cancelled' && !showCancelled) return;
    const r = document.createElement('tr');
    if (entry.status === 'cancelled') r.classList.add('cancelled-row');

    const td0 = document.createElement('td'); td0.textContent = getCell(entry.rowArray, NAME_IDX); r.appendChild(td0);
    const td1 = document.createElement('td'); td1.textContent = entry.qty; r.appendChild(td1);
    const td2 = document.createElement('td'); td2.textContent = getCell(entry.rowArray, SCALE_IDX); r.appendChild(td2);

    const td3 = document.createElement('td');
    const barWrap = document.createElement('div'); barWrap.className = 'barcode-cell';
    const barThumb = document.createElement('div'); barThumb.className = 'barcode-thumb';
    barWrap.appendChild(barThumb); td3.appendChild(barWrap); r.appendChild(td3);

    const td4 = document.createElement('td'); td4.textContent = new Date(entry.createdAt).toLocaleString(); r.appendChild(td4);
    const td5 = document.createElement('td'); td5.textContent = entry.status || ''; r.appendChild(td5);

    const tdAction = document.createElement('td');
    const editBtn = document.createElement('button'); editBtn.type='button'; editBtn.className='btn warn'; editBtn.textContent='تعديل';
    editBtn.addEventListener('click', ()=> openEditFinal(entry.uid));
    tdAction.appendChild(editBtn);

    const barcodeViewBtn = document.createElement('button'); barcodeViewBtn.type='button'; barcodeViewBtn.className='btn ghost';
    barcodeViewBtn.style.marginLeft='6px'; barcodeViewBtn.textContent='عرض باركود';
    barcodeViewBtn.addEventListener('click', ()=> {
      const codeValue = getCell(entry.rowArray, BARCODE_IDX) || getCell(entry.rowArray, SCALE_IDX) || getCell(entry.rowArray, NAME_IDX);
      showBarcodeModal(codeValue);
    });
    tdAction.appendChild(barcodeViewBtn);

    if (entry.status !== 'cancelled') {
      const cancelBtn = document.createElement('button'); cancelBtn.type='button'; cancelBtn.className='btn';
      cancelBtn.style.marginLeft='6px'; cancelBtn.textContent='إلغاء';
      cancelBtn.addEventListener('click', ()=> { if(confirm('هل تريد إلغاء هذا المنتج؟')) cancelEntry(entry.uid); });
      tdAction.appendChild(cancelBtn);
    } else {
      const deleteBtn = document.createElement('button'); deleteBtn.type='button'; deleteBtn.className='btn danger';
      deleteBtn.style.marginLeft='6px'; deleteBtn.textContent='حذف نهائي';
      deleteBtn.addEventListener('click', ()=> {
        if (!isAdminSession()) { showToast('error','فقط الأدمن يمكنه الحذف النهائي'); return; }
        if (!confirm('حذف نهائي لهذا المنتج؟')) return;
        finalMap.delete(entry.uid); saveFinalToStorage(); renderFinals();
      });
      tdAction.appendChild(deleteBtn);
    }

    r.appendChild(tdAction);
    finalTbody.appendChild(r);

    // thumbnail barcode via JsBarcode
    const codeForBar = (getCell(entry.rowArray, BARCODE_IDX) || getCell(entry.rowArray, SCALE_IDX) || getCell(entry.rowArray, NAME_IDX)).toString();
    try {
      barThumb.innerHTML = '';
      const svg = document.createElementNS('http://www.w3.org/2000/svg','svg'); svg.setAttribute('width','140'); svg.setAttribute('height','48');
      JsBarcode(svg, codeForBar, { format: 'CODE128', displayValue: false, height: 40, width: 1.2, margin: 0 });
      barThumb.appendChild(svg);
    } catch(e){}
  });

  updateSelectedCount();
  applyScaleFilter(finalTbody);
  checkClearAll();
}
function cancelEntry(uid) {
  const e = finalMap.get(uid);
  if (!e) return;
  e.status = 'cancelled'; e.createdAt = (new Date()).toISOString(); finalMap.set(uid, e);
  saveFinalToStorage(); renderFinals(); showToast('info', 'تم إلغاء المنتج: ' + (getCell(e.rowArray, NAME_IDX) || uid));
}
function updateSelectedCount() {
  const active = Array.from(finalMap.values()).filter(e=> e.status==='received' || !e.status).length;
  if (selectedCountEl) selectedCountEl.textContent = active;
  updatePersistentNotice();
}
function checkClearAll() { clearAllBtn && (clearAllBtn.style.display = (finalTbody.rows.length === 0) ? 'none' : 'inline-block'); }

/* ----------------------------- تصدير Excel ----------------------------- */
function exportToExcel(includeCancelled=false) {
  const rows = [];
  rows.push(["اسم المنتج","كود الميزان","العدد/الوزن","الكود الخطي","التاريخ","الحالة"]);
  for (const entry of Array.from(finalMap.values())) {
    if (!includeCancelled && entry.status === 'cancelled') continue;
    const r = entry.rowArray || [];
    rows.push([ getCell(r, NAME_IDX)||'', getCell(r, SCALE_IDX)||'', entry.qty||'', getCell(r, BARCODE_IDX)||'', entry.createdAt||'', entry.status||'' ]);
  }

  let html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" lang="ar"><head><meta http-equiv="content-type" content="text/html; charset=utf-8"/></head><body>';
  html += '<table border="1" style="border-collapse:collapse; font-family: Arial, sans-serif;">';
  html += '<thead><tr>';
  rows[0].forEach(h => html += `<th style="background:#cfe2ff; font-weight:bold; padding:8px 12px; text-align:center;">${h}</th>`);
  html += '</tr></thead><tbody>';
  for (let i = 1; i < rows.length; i++) {
    html += '<tr>';
    rows[i].forEach(cell => html += `<td style="padding:6px 10px; text-align:center;">${cell}</td>`);
    html += '</tr>';
  }
  html += '</tbody></table></body></html>';

  const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'export_selected.xls'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  showToast('success', 'تم تصدير ملف الإكسل');
}
exportExcelBtn && exportExcelBtn.addEventListener('click', () => exportToExcel(false));

/* ----------------------------- عرض باركود كبير ----------------------------- */
function showBarcodeModal(text) {
  const code = String(text || '');
  const win = window.open('', '_blank', 'width=520,height=300');
  const doc = win.document;
  doc.open();
  doc.write('<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>Barcode</title>');
  doc.write('<style>body{font-family:Arial,sans-serif;text-align:center;padding:20px} .info{word-break:break-all;margin-top:12px}</style>');
  doc.write('</head><body>');
  doc.write('<h3>رمز خطي (Barcode)</h3>');
  doc.write('<div id="barcode"></div>');
  doc.write('<div class="info">' + escapeHtml(code) + '</div>');
  doc.write('</body></html>');
  doc.close();
  try {
    const svg = win.document.createElementNS('http://www.w3.org/2000/svg','svg'); svg.setAttribute('width','480'); svg.setAttribute('height','120');
    win.document.getElementById('barcode').appendChild(svg);
    JsBarcode(svg, code, { format: "CODE128", displayValue: true, height: 80, width: 2, margin: 10 });
  } catch (e) {}
}

/* ----------------------------- QR/Barcode Scanner ----------------------------- */
function chooseBackCamera(devices) {
  if (!devices || devices.length === 0) return null;
  const keywords = ['back','rear','env','environment','back camera','rear camera','الكاميرا الخلفية','خلفي'];
  for (const d of devices) {
    const label = (d.label || '').toString().toLowerCase();
    for (const k of keywords) if (label.includes(k)) return d.id || d.deviceId || (d.id ?? d.deviceId);
  }
  if (devices.length > 1) {
    const last = devices[devices.length - 1];
    return last.id || last.deviceId || (last.id ?? last.deviceId);
  }
  const first = devices[0];
  return first.id || first.deviceId || (first.id ?? first.deviceId);
}

async function startScanner() {
  if (!window.Html5Qrcode) { showToast('error', 'مكتبة html5-qrcode غير محمّلة'); return; }
  reader && (reader.style.display = 'block');
  try {
    qrScanner = new Html5Qrcode('reader');
    const devices = await Html5Qrcode.getCameras().catch(() => []);
    const chosen = chooseBackCamera(devices);
    const cameraIdOrConfig = chosen ? chosen : { facingMode: 'environment' };

    await qrScanner.start(cameraIdOrConfig, { fps: 10, qrbox: 250 },
      (decodedText, decodedResult) => {
        try {
          const now = Date.now();
          if (decodedText === lastScan.text && (now - lastScan.time) < lastScan.tol) { lastScan.time = now; return; }
          lastScan.text = decodedText; lastScan.time = now;
          if (modalOpen) return;
          // املأ شريط البحث واعمل بحث ذكي
          searchBar.value = decodedText;
          const matchIndex = findRowByValue(decodedText);
          if (matchIndex !== null) {
            openReceiveModal(matchIndex);
          } else {
            showToast('info', 'لم يتم العثور على المنتج الممسوح');
          }
        } catch (err) { console.error('scan cb', err); }
      },
      (errMsg) => { /* ignored frame errors */ }
    );
    scannerRunning = true;
    cameraBtn.textContent = '⏹ إيقاف الماسح';
  } catch (err) {
    showToast('error', 'فشل تشغيل الكاميرا: ' + (err && err.message ? err.message : err));
    reader && (reader.style.display = 'none');
    scannerRunning = false;
    cameraBtn.textContent = '📷 QR';
  }
}
async function stopScanner() {
  if (!qrScanner) return;
  try { await qrScanner.stop(); } catch (e) {}
  try { qrScanner.clear(); } catch (e) {}
  qrScanner = null;
  reader && (reader.style.display = 'none');
  scannerRunning = false;
  cameraBtn.textContent = '📷 QR';
}
cameraBtn && cameraBtn.addEventListener('click', () => { if (scannerRunning) stopScanner(); else startScanner(); });

/* ----------------------------- Admin mode ----------------------------- */
function isAdminSession() { return sessionStorage.getItem('admin_mode_v2') === '1'; }
adminBtn && adminBtn.addEventListener('click', async () => {
  if (isAdminSession()) {
    if (confirm('هل تريد الخروج من وضع الأدمن؟')) { sessionStorage.removeItem('admin_mode_v2'); showToast('info', 'تم إيقاف وضع الأدمن'); renderFinals(); }
    return;
  }
  const p = prompt('أدخل كلمة مرور الأدمن (سيتم تخزينها محليًا لأول مرة):');
  if (!p) return;
  const hash = await sha256(p);
  const stored = localStorage.getItem(STORAGE_KEY_ADMIN_HASH);
  if (!stored) { localStorage.setItem(STORAGE_KEY_ADMIN_HASH, hash); showToast('success', 'تم إعداد كلمة مرور الأدمن محليًا'); }
  if (hash === localStorage.getItem(STORAGE_KEY_ADMIN_HASH)) {
    sessionStorage.setItem('admin_mode_v2', '1'); showToast('success', 'تم تفعيل وضع الأدمن'); renderFinals();
  } else {
    showToast('error', 'كلمة المرور غير صحيحة');
  }
});
async function sha256(msg) { const enc = new TextEncoder(); const data = enc.encode(msg); const buf = await crypto.subtle.digest('SHA-256', data); return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join(''); }

/* ----------------------------- Persistent notice & unload protection ----------------------------- */
window.addEventListener('beforeunload', function (e) {
  if (Array.from(finalMap.values()).some(e => e.status === 'received' || !e.status)) {
    const msg = 'لديك منتجات مختارة محفوظة محليًا — تحديث أو إغلاق الصفحة قد يؤثر على تجربتك. هل أنت متأكد؟';
    e.preventDefault(); e.returnValue = msg; return msg;
  }
});
function updatePersistentNotice() {
  const active = Array.from(finalMap.values()).filter(e => e.status === 'received' || !e.status).length;
  if (active > 0) {
    persistentNotice && (persistentNotice.style.display = '');
    const pt = document.getElementById('persistentText'); pt && (pt.textContent = `لديك ${active} منتجات محفوظة محليًا — ستظل محفوظة حتى تحذفها.`);
  } else {
    persistentNotice && (persistentNotice.style.display = 'none');
  }
}
dismissPersistent && dismissPersistent.addEventListener('click', () => { persistentNotice.style.display = 'none'; });

/* ----------------------------- البحث التلقائي عند الضغط Enter ----------------------------- */
searchBar && searchBar.addEventListener('keydown', function (e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    search(false);
  }
});

/* ----------------------------- PDF Export — يدعم العربية (Cairo) + باركود خطي أقصر ----------------------------- */
async function ensureArabicFontInPdfMake() {
  if (typeof pdfMake === 'undefined') throw new Error('pdfMake غير محمّل');
  if (pdfMake.vfs && pdfMake.vfs['Cairo-Regular.ttf']) return;
  try {
    const fontUrl = 'https://cdn.jsdelivr.net/gh/google/fonts/ofl/cairo/Cairo-Regular.ttf';
    const res = await fetch(fontUrl);
    if (!res.ok) throw new Error('فشل تحميل الخط');
    const ab = await res.arrayBuffer();
    const base64 = arrayBufferToBase64(ab);
    if (!pdfMake.vfs) pdfMake.vfs = {};
    pdfMake.vfs['Cairo-Regular.ttf'] = base64;
    pdfMake.fonts = {
      ArabicFont: {
        normal: 'Cairo-Regular.ttf',
        bold: 'Cairo-Regular.ttf',
        italics: 'Cairo-Regular.ttf',
        bolditalics: 'Cairo-Regular.ttf'
      }
    };
  } catch (err) {
    console.error('ensureArabicFontInPdfMake error', err);
    throw err;
  }
}

function barcodeDataUrlLinear(code, w = 260, h = 40) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  try {
    JsBarcode(canvas, String(code || ' '), { format: 'CODE128', displayValue: false, height: h, width: 1.6, margin: 0 });
    return canvas.toDataURL('image/png');
  } catch (e) {
    const c2 = document.createElement('canvas'); c2.width = w; c2.height = h;
    return c2.toDataURL('image/png');
  }
}

exportPdfBtn && exportPdfBtn.addEventListener('click', async () => {
  try {
    const items = Array.from(finalMap.values()).filter(e => e.status !== 'cancelled' && (e.status === 'received' || !e.status));
    if (!items || items.length === 0) { showToast('error', 'لا توجد منتجات مختارة لتصديرها.'); return; }

    try { await ensureArabicFontInPdfMake(); } catch (err) { showToast('error', 'فشل تحميل الخط العربي للـPDF — قد تظهر العربية كمربعات'); }

    const perPage = 21;
    const chunks = [];
    for (let i = 0; i < items.length; i += perPage) chunks.push(items.slice(i, i + perPage));

    const content = [];
    chunks.forEach((pageItems, pageIndex) => {
      const body = [];
      for (let r = 0; r < 7; r++) {
        const row = [];
        for (let c = 0; c < 3; c++) {
          const idx = r * 3 + c;
          const entry = pageItems[idx];
          if (entry) {
            const name = getCell(entry.rowArray, NAME_IDX) || '';
            const price = getCell(entry.rowArray, PRICE_IDX) || '';
            const code = (getCell(entry.rowArray, BARCODE_IDX) || getCell(entry.rowArray, SCALE_IDX) || '').toString();
            const imgData = barcodeDataUrlLinear(code, 260, 40);

            row.push({
              stack: [
                { text: name, font: 'ArabicFont', fontSize: 12, alignment: 'center', margin: [0, 2, 0, 2] },
                { text: price ? `السعر: ${price}` : '', font: 'ArabicFont', fontSize: 11, alignment: 'center', margin: [0, 0, 0, 6] },
                { image: imgData, width: 120, alignment: 'center', margin: [0, 0, 0, 4] }
              ],
              margin: [4, 4, 4, 4]
            });
          } else {
            row.push({ text: '', border: [false, false, false, false] });
          }
        }
        body.push(row);
      }

      content.push({ table: { widths: ['33%','33%','33%'], body: body }, layout: { hLineColor: '#dddddd', vLineColor: '#dddddd' } });
      if (pageIndex < chunks.length - 1) content.push({ text: '', pageBreak: 'after' });
    });

    const docDefinition = {
      content: [{ text: 'المنتجات المختارة', style: 'header', alignment: 'center', margin: [0, 0, 0, 8] }, ...content],
      styles: { header: { fontSize: 16, bold: true } },
      defaultStyle: { font: 'ArabicFont', alignment: 'center' },
      pageSize: 'A4',
      pageMargins: [10, 20, 10, 20]
    };

    pdfMake && pdfMake.createPdf(docDefinition).open();
  } catch (err) {
    console.error('exportPdf error', err);
    showToast('error', 'فشل إنشاء ملف PDF — تحقق من Console للأخطاء.');
  }
});

/* ----------------------------- أدوات صغيرة وتهيئة عند البدء ----------------------------- */
function updatePersistentNotice() { /* implemented above */ }
window.__app_debug = { finalMap, excelData };

/* تحميل Snapshot final من التخزين ثم محاولة تحميل قالب الإكسل */
window.addEventListener('load', async () => {
  loadFinalFromStorage();
  await tryAutoLoadTemplate();
  // تحضير حالة الواجهة
  try { searchBar && searchBar.focus(); } catch (e) {}
});

/* ربط أزرار التحكم المتبقية */
clearResultsBtn && clearResultsBtn.addEventListener('click', () => { if (resultsTbody) resultsTbody.innerHTML = ''; checkClearResults(); });
showCancelledBtn && showCancelledBtn.addEventListener('click', () => { showCancelled = !showCancelled; renderFinals(); showCancelledBtn.textContent = showCancelled ? 'إخفاء الملغى' : 'إظهار الملغى'; });

/* ترويسة: عرض نافذة/زرار رفع إذا لزم */
statusEl && statusEl.addEventListener('click', () => { fileInput && fileInput.click(); });

/* exposed debug */
window.__app_debug = {
  finalMap, excelData, findRowByValue, openReceiveModal
};
