/* script.js — نسخة مُحدّثة
   التعديلات الرئيسية:
   - منع حذف الاختيارات النهائية من زر إزالة الإكسل إلا للأدمن
   - فتح مودال الاستلام فوراً عند مطابقة باركود/كود ميزان كاملة من شريط البحث
   - إصلاح تراكب/خروج جدول final/results عبر تعديلات CSS وبرمجية
*/

const EXCEL_FILENAME_PATTERN = /^product\.template\((\d+)\)\.xlsx$/i;
const STORAGE_KEY_EXCEL = 'excel_rows_v2';
const STORAGE_KEY_FINAL = 'final_selection_v2';
const STORAGE_KEY_ADMIN_HASH = 'admin_hash_v2';
const STORAGE_KEY_PRINT = 'print_items_v2';

const NAME_IDX = 0, PRICE_IDX = 1, SCALE_IDX = 2, BARCODE_IDX = 3;

/* ---------------- DOM refs ---------------- */
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

const removeExcelBtn = document.getElementById('removeExcelBtn'); // زر الإزالة الذي تضيفه في HTML

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
const selectedProductsHiddenTable = document.getElementById('selectedProducts');

/* ---------------- state ---------------- */
let excelData = [];
let headerRow = null;
let startIndex = 0;
let templateNumber = null;

let finalMap = new Map();
let modalOpen = false;
let modalSourceIndex = null;
let modalEditingUid = null;

let scannerRunning = false;
let qrScanner = null;
let lastScan = { text: null, time: 0, tol: 800 };

let showCancelled = false;
let scaleFilterActive = false;

/* ---------------- UI helpers ---------------- */
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
    messagesPanel && messagesPanel.appendChild(el);
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

/* ---------------- util ---------------- */
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

/* ---------------- inject layout-fix CSS ---------------- */
(function injectLayoutFix() {
  try {
    const css = `
      /* responsive tables to avoid overflow */
      #results, #finalResults { width: 100% !important; table-layout: fixed !important; max-width: 100% !important; }
      #results td, #results th, #finalResults td, #finalResults th { word-break: break-word; overflow-wrap: break-word; white-space: normal; }
      /* provide optional wrappers scroll fallback */
      .results-wrapper, .final-wrapper { overflow-x: auto; width: 100%; }
    `;
    const s = document.createElement('style'); s.setAttribute('id','script-layout-fix'); s.innerHTML = css;
    document.head && document.head.appendChild(s);
  } catch (e) { console.warn('injectLayoutFix failed', e); }
})();

/* ---------------- auto-load template ---------------- */
async function tryAutoLoadTemplate() {
  const preferred = 240;
  const filenamesToTry = [`product.template(${preferred}).xlsx`];

  for (const name of filenamesToTry) {
    try {
      const res = await fetch(name, { method: 'GET' });
      if (!res.ok) continue;
      const ab = await res.arrayBuffer();
      await parseWorkbook(ab, name);
      return;
    } catch (err) { /* ignore */ }
  }

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

  setStatus('لم يتم العثور على ملف الإكسل product.template(XXX).xlsx — ارفع الملف يدوياً', false);
  templateBadge && (templateBadge.style.display = 'none');
}

/* ---------------- parse workbook ---------------- */
async function parseWorkbook(arrayBuffer, sourceName) {
  try {
    const wb = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
    const sheetName = wb.SheetNames[0];
    const raw = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1 });
    if (!Array.isArray(raw) || raw.length === 0) throw new Error('ورقة الإكسل فارغة');

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
    try { localStorage.setItem(STORAGE_KEY_EXCEL, JSON.stringify(excelData)); } catch (e) {}

    if (sourceName) {
      const m = EXCEL_FILENAME_PATTERN.exec(sourceName.split('/').pop());
      if (m) {
        templateNumber = m[1];
        templateNumberEl && (templateNumberEl.textContent = templateNumber);
        templateBadge && (templateBadge.style.display = '');
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

/* ---------------- file input handlers ---------------- */
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

/* ---------------- helpers for rows ---------------- */
function getCell(row, idx) { if (!row) return ''; const v = row[idx]; return (v === undefined || v === null) ? '' : String(v); }
function uidFromRow(row) {
  const bc = getCell(row, BARCODE_IDX).trim();
  const sc = getCell(row, SCALE_IDX).trim();
  const name = getCell(row, NAME_IDX).trim();
  if (bc) return `BC::${bc}`;
  if (sc) return `SC::${sc}`;
  return `NM::${name}`;
}

/* ---------------- search & find ---------------- */
function renderResultsEmpty() { if (resultsTbody) resultsTbody.innerHTML = ''; if (dupWarningEl) dupWarningEl.style.display = 'none'; if (clearResultsBtn) clearResultsBtn.style.display = 'none'; }
function checkClearResults() { clearResultsBtn && (clearResultsBtn.style.display = (resultsTbody && resultsTbody.rows.length === 0) ? 'none' : 'inline-block'); }
function applyScaleFilter(tbody) {
  if (!tbody) return;
  Array.from(tbody.rows).forEach(row => {
    const codeCell = row.cells[2];
    const val = codeCell ? (codeCell.textContent || '').trim() : '';
    row.style.display = (scaleFilterActive && val === '') ? 'none' : '';
  });
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

// جديد: فحص مطابق بالضبط للباركود/كود الميزان — لا يبحث بالاسم
function findExactBarcodeOrScale(val) {
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
  return null;
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

  if (dupFound) { dupWarningEl && (dupWarningEl.textContent = 'تحذير: يوجد تكرار لنفس المنتج — عرض نسخة واحدة فقط.', dupWarningEl.style.display = 'block'); }
  else { dupWarningEl && (dupWarningEl.style.display = 'none'); }

  applyScaleFilter(resultsTbody);
  checkClearResults();

  if (fromScanner && value) {
    const matchIndex = findRowByValue(value);
    if (matchIndex !== null) {
      if (!modalOpen) openReceiveModal(matchIndex);
    }
  }
}

/* ---------------- search bar immediate-match handler ---------------- */
if (searchBar) {
  searchBar.addEventListener('input', function (e) {
    const v = (this.value || '').trim();
    if (!v) { renderResultsEmpty(); return; }

    // إذا كان الباركود مطابق تماماً لكود في الإكسل — افتح المودال فورًا
    const exactIndex = findExactBarcodeOrScale(v);
    if (exactIndex !== null) {
      if (!modalOpen) {
        openReceiveModal(exactIndex);
      }
      return;
    }

    // خلاف ذلك، اعرض نتائج مطابقة عامة
    search(false);
  });
}

/* ربط أزرار البحث ومسح الحقل */
searchBtn && searchBtn.addEventListener('click', () => {
  if (!searchBar.value || !searchBar.value.trim()) { showToast('info', 'اكتب ما تود البحث عنه'); return; }
  const val = searchBar.value.trim();
  const matched = findRowByValue(val);
  if (matched !== null && (getCell(excelData[matched], BARCODE_IDX).trim() === val || getCell(excelData[matched], SCALE_IDX).trim() === val)) {
    openReceiveModal(matched);
    return;
  }
  search(false);
});
clearBtn && clearBtn.addEventListener('click', () => { searchBar.value = ''; renderResultsEmpty(); });

/* ---------------- scale filter ---------------- */
scaleBtn && scaleBtn.addEventListener('click', () => {
  scaleFilterActive = !scaleFilterActive;
  scaleBtn.classList.toggle('btn.warn', scaleFilterActive);
  applyScaleFilter(resultsTbody);
});

/* ---------------- modal receive ---------------- */
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

/* numpad/backspace */
document.querySelectorAll('.numpad button[data-key]').forEach(btn => {
  btn.addEventListener('click', () => {
    const k = btn.getAttribute('data-key'); insertAtCaret(modalInput, k); modalInput.focus();
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

/* modal confirm */
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

/* keyboard */
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

/* ---------------- finalMap storage ---------------- */
function loadFinalFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_FINAL);
    if (!raw) return;
    const arr = JSON.parse(raw);
    finalMap.clear();
    arr.forEach(
