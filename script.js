document.addEventListener("DOMContentLoaded", function () {
  /**************************************************************************
   * Helpers / config
   **************************************************************************/
  const STORAGE_KEY_EXCEL = "excel_rows_v2";
  const STORAGE_KEY_FINAL = "final_selection_v2";
  const NAME_IDX = 0, PRICE_IDX = 1, CODE_IDX = 2, QR_IDX = 3;

  // DOM refs (required ids must exist in index.html)
  const statusEl = document.getElementById("status");
  const messagesPanel = document.getElementById("messagesPanel");
  const persistentNotice = document.getElementById("persistentNotice");
  const dismissPersistent = document.getElementById("dismissPersistent");

  const searchBar = document.getElementById("searchBar");
  const searchBtn = document.getElementById("searchBtn");
  const clearBtn = document.getElementById("clearBtn");
  const cameraBtn = document.getElementById("cameraBtn");
  const scaleBtn = document.getElementById("scaleBtn");
  const adminBtn = document.getElementById("adminBtn");

  const resultsTbody = document.querySelector("#results tbody");
  const finalTbody = document.querySelector("#finalResults tbody");
  const clearResultsBtn = document.getElementById("clearResultsBtn");
  const clearAllBtnEl = document.getElementById("clearAllBtn");
  const exportExcelBtn = document.getElementById("exportBtn");
  const exportPdfBtn = document.getElementById("exportPdfBtn");
  const showCancelledBtn = document.getElementById("showCancelledBtn");

  const receiveModalOverlay = document.getElementById("receiveModal");
  const modalInput = document.getElementById("modalInput");
  const modalName = document.getElementById("modalName");
  const modalBack = document.getElementById("modalBack");
  const modalCancel = document.getElementById("modalCancel");
  const modalConfirm = document.getElementById("modalConfirm");

  const fileInput = document.getElementById("fileInput");
  const excelFileInput = document.getElementById("excelFile");

  // state
  let excelData = [];
  let startIndex = 1; // assume first row headers
  let finalMap = new Map(); // uid -> { uid, rowArray, qty, createdAt, status }
  let modalOpen = false;
  let modalCurrentSourceIndex = null;
  let modalEditingUid = null;
  let scannerRunning = false;
  let qrScanner = null;
  let lastScan = { text: null, time: 0, tol: 800 };
  let showCancelled = false;
  let scaleFilterActive = false;

  /**************************************************************************
   * UI helpers: toasts and dialogs (simple)
   **************************************************************************/
  function createToastElement(type, text) {
    const el = document.createElement("div");
    el.className = "toast " + (type || "info");
    const msg = document.createElement("div");
    msg.className = "msg";
    msg.textContent = text;
    const closeBtn = document.createElement("button");
    closeBtn.className = "closeBtn";
    closeBtn.innerHTML = "✕";
    closeBtn.addEventListener("click", () => el.remove());
    el.appendChild(msg);
    el.appendChild(closeBtn);
    return el;
  }

  function showToast(type, text, timeout = 4000) {
    try {
      const el = createToastElement(type, text);
      messagesPanel.appendChild(el);
      if (timeout) setTimeout(() => { try { el.remove(); } catch (e) {} }, timeout);
    } catch (e) { console.log(type, text); }
  }

  function setStatus(text, active = true) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.style.background = active ? "var(--accent)" : "var(--danger)";
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  /**************************************************************************
   * Excel loading/parsing
   **************************************************************************/
  async function parseWorkbook(arrayBuffer, sourceName) {
    try {
      const wb = XLSX.read(new Uint8Array(arrayBuffer), { type: "array" });
      const first = wb.SheetNames[0];
      excelData = XLSX.utils.sheet_to_json(wb.Sheets[first], { header: 1 });
      // decide start index
      if (excelData.length > 0) {
        const firstRow = (excelData[0] || []).join(" ");
        startIndex = (/[^\s]/.test(firstRow) && /[a-zA-Z\u0600-\u06FF]/.test(firstRow)) ? 1 : 0;
      } else startIndex = 0;
      try { localStorage.setItem(STORAGE_KEY_EXCEL, JSON.stringify(excelData)); } catch (e) {}
      setStatus("ملف فعال: " + (sourceName || first), true);
      showToast("success", "تم تحميل: " + (sourceName || first));
    } catch (err) {
      console.error("parseWorkbook", err);
      setStatus("فشل قراءة الإكسل", false);
      showToast("error", "فشل قراءة الإكسل");
      excelData = [];
    }
  }

  // try auto load from common names or github pages
  async function tryAutoLoadExcel() {
    // fallback to localStorage snapshot
    try {
      const raw = localStorage.getItem(STORAGE_KEY_EXCEL);
      if (raw) {
        excelData = JSON.parse(raw);
        startIndex = 1;
        setStatus("تم تحميل بيانات الإكسل من الذاكرة المحلية", true);
        showToast("info", "تم تحميل بيانات الإكسل من الذاكرة المحلية");
        return;
      }
    } catch (e) { /* ignore */ }
    setStatus("لم يعثر على ملف إكسل تلقائيًا — دبل كليك هنا لرفع ملف إكسل محلي.", false);
  }

  // file inputs
  statusEl && statusEl.addEventListener("dblclick", () => fileInput && fileInput.click());
  if (fileInput) {
    fileInput.addEventListener("change", (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = (ev) => parseWorkbook(ev.target.result, f.name);
      r.onerror = () => { setStatus("فشل قراءة الملف المحلي", false); showToast("error", "فشل قراءة الملف المحلي"); };
      r.readAsArrayBuffer(f);
    });
  }

  if (excelFileInput) {
    excelFileInput.addEventListener("change", (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = (ev) => parseWorkbook(ev.target.result, f.name);
      r.onerror = () => { setStatus("فشل قراءة الملف المحلي", false); showToast("error", "فشل قراءة الملف المحلي"); };
      r.readAsArrayBuffer(f);
    });
  }

  /**************************************************************************
   * Search and results rendering
   **************************************************************************/
  function getCell(row, idx) {
    if (!row) return "";
    const v = row[idx];
    return (v === undefined || v === null) ? "" : String(v);
  }

  function uidFromRow(row) {
    const qr = getCell(row, QR_IDX).trim();
    const code = getCell(row, CODE_IDX).trim();
    const name = getCell(row, NAME_IDX).trim();
    if (qr) return "QR::" + qr;
    if (code) return "CODE::" + code;
    return "NAME::" + name;
  }

  function search(fromScanner = false, value = "") {
    const q = (fromScanner ? String(value) : (searchBar.value || "")).trim().toLowerCase();
    resultsTbody.innerHTML = "";
    dupWarningEl && (dupWarningEl.style.display = "none");
    if (!Array.isArray(excelData) || excelData.length <= startIndex) { checkClearResults(); return; }
    if (!q) { checkClearResults(); return; }

    const seenUids = new Set();
    let dupFound = false;

    for (let i = startIndex; i < excelData.length; i++) {
      const row = excelData[i] || [];
      if (row.length === 0) continue;
      const name = getCell(row, NAME_IDX).toLowerCase();
      const price = getCell(row, PRICE_IDX);
      const code = getCell(row, CODE_IDX).toLowerCase();
      const qr = getCell(row, QR_IDX).toLowerCase();

      if (name.includes(q) || code.includes(q) || qr.includes(q)) {
        const uid = uidFromRow(row);
        if (seenUids.has(uid)) { dupFound = true; continue; }
        seenUids.add(uid);

        const tr = document.createElement("tr");
        tr.dataset.sourceIndex = i;
        tr.dataset.uid = uid;

        const tdName = document.createElement("td");
        tdName.textContent = getCell(row, NAME_IDX);
        tr.appendChild(tdName);

        const tdPrice = document.createElement("td");
        tdPrice.textContent = price;
        tr.appendChild(tdPrice);

        const tdCode = document.createElement("td");
        tdCode.textContent = getCell(row, CODE_IDX);
        tr.appendChild(tdCode);

        const tdQr = document.createElement("td");
        tdQr.textContent = getCell(row, QR_IDX);
        tr.appendChild(tdQr);

        // action cell: only the "استلام" button opens the modal (prevents accidental adds)
        const tdAction = document.createElement("td");
        const receiveBtn = document.createElement("button");
        receiveBtn.type = "button";
        receiveBtn.className = "btn primary";
        receiveBtn.textContent = "استلام";
        receiveBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          openReceiveModal(i);
        });
        tdAction.appendChild(receiveBtn);
        tr.appendChild(tdAction);

        resultsTbody.appendChild(tr);
      }
    }

    if (dupFound) {
      dupWarningEl && (dupWarningEl.textContent = "تحذير: يوجد تكرار لنفس المنتج في ملف الإكسل — تم عرض نسخة واحدة فقط.", dupWarningEl.style.display = "block");
    } else {
      dupWarningEl && (dupWarningEl.style.display = "none");
    }

    applyScaleFilter(resultsTbody);
    checkClearResults();

    if (fromScanner && value) {
      const matchIndex = findRowByValue(value);
      if (matchIndex !== null) {
        if (!modalOpen) openReceiveModal(matchIndex);
      }
    }
  }

  function findRowByValue(val) {
    if (!Array.isArray(excelData) || excelData.length <= startIndex) return null;
    const v = String(val || "").trim();
    if (!v) return null;
    for (let i = startIndex; i < excelData.length; i++) {
      const row = excelData[i] || [];
      if (getCell(row, QR_IDX).trim() === v) return i;
    }
    for (let i = startIndex; i < excelData.length; i++) {
      const row = excelData[i] || [];
      if (getCell(row, CODE_IDX).trim() === v) return i;
    }
    for (let i = startIndex; i < excelData.length; i++) {
      const row = excelData[i] || [];
      if (getCell(row, NAME_IDX).toLowerCase().includes(v.toLowerCase())) return i;
    }
    return null;
  }

  function clearSearch() {
    searchBar.value = "";
    resultsTbody.innerHTML = "";
    dupWarningEl && (dupWarningEl.style.display = "none");
    checkClearResults();
  }
  function checkClearResults() { clearResultsBtn && (clearResultsBtn.style.display = (resultsTbody.rows.length === 0) ? "none" : "inline-block"); }

  /**************************************************************************
   * Scale filter (keeps original behaviour)
   **************************************************************************/
  function toggleScaleFilter() { scaleFilterActive = !scaleFilterActive; scaleBtn.classList.toggle("btn.warn", scaleFilterActive); applyScaleFilter(resultsTbody); applyScaleFilter(finalTbody); }
  function applyScaleFilter(tbody) {
    if (!tbody) return;
    Array.from(tbody.rows).forEach(row => {
      const codeCell = row.cells[2];
      const val = codeCell ? (codeCell.textContent || "").trim() : "";
      row.style.display = (scaleFilterActive && val === "") ? "none" : "";
    });
  }

  /**************************************************************************
   * Modal (receive) handling - OPEN / CLOSE / CONFIRM
   **************************************************************************/
  function openReceiveModal(sourceIndex) {
    modalCurrentSourceIndex = sourceIndex;
    modalEditingUid = null;
    modalOpen = true;
    const row = excelData[sourceIndex] || [];
    modalName.textContent = getCell(row, NAME_IDX) || "";
    const uid = uidFromRow(row);
    if (finalMap.has(uid)) modalInput.value = finalMap.get(uid).qty || ""; else modalInput.value = "";
    if (receiveModalOverlay) receiveModalOverlay.style.display = "flex";
    setTimeout(() => { try { modalInput.focus(); modalInput.select && modalInput.select(); } catch (e) {} }, 120);
  }

  function openEditFinal(uid) {
    if (!finalMap.has(uid)) return;
    modalEditingUid = uid;
    modalCurrentSourceIndex = null;
    modalOpen = true;
    const entry = finalMap.get(uid);
    modalName.textContent = getCell(entry.rowArray, NAME_IDX) || "";
    modalInput.value = entry.qty || "";
    if (receiveModalOverlay) receiveModalOverlay.style.display = "flex";
    setTimeout(() => { try { modalInput.focus(); modalInput.select && modalInput.select(); } catch (e) {} }, 120);
  }

  function closeModal() {
    if (receiveModalOverlay) receiveModalOverlay.style.display = "none";
    modalInput.value = "";
    modalCurrentSourceIndex = null;
    modalEditingUid = null;
    modalOpen = false;
  }

  // close modal only if clicking outside modal content
  if (receiveModalOverlay) {
    receiveModalOverlay.addEventListener("click", function (e) {
      if (e.target === receiveModalOverlay) closeModal();
    });
  }

  // numpad handlers inside receive modal (if present)
  document.querySelectorAll(".numpad button[data-key]").forEach(btn => {
    btn.addEventListener("click", () => {
      const k = btn.getAttribute("data-key");
      insertAtCaret(modalInput, k);
      modalInput.focus();
    });
  });
  modalBack && modalBack.addEventListener("click", () => { backspaceAtCaret(modalInput); modalInput.focus(); });

  function insertAtCaret(input, text) {
    try {
      const start = input.selectionStart || 0;
      const end = input.selectionEnd || 0;
      const val = input.value || "";
      input.value = val.slice(0, start) + text + val.slice(end);
      const pos = start + text.length;
      input.setSelectionRange(pos, pos);
    } catch (e) { input.value = (input.value || "") + text; }
  }
  function backspaceAtCaret(input) {
    try {
      const start = input.selectionStart || 0;
      const end = input.selectionEnd || 0;
      if (start === end && start > 0) {
        const val = input.value || "";
        input.value = val.slice(0, start - 1) + val.slice(end);
        const pos = start - 1;
        input.setSelectionRange(pos, pos);
      } else {
        const val = input.value || "";
        input.value = val.slice(0, start) + val.slice(end);
        input.setSelectionRange(start, start);
      }
    } catch (e) { input.value = (input.value || "").slice(0, -1); }
  }

  // modal confirm logic
  function modalConfirmHandler() {
    const v = (modalInput.value || "").trim();
    if (v === "") { showToast("error", "لا يمكن ترك الحقل فارغاً"); modalInput.focus(); return; }
    const num = Number(v);
    if (!isFinite(num) || num <= 0) { showToast("error", "الرجاء إدخال رقم صالح أكبر من صفر"); modalInput.focus(); return; }

    if (modalEditingUid) {
      const entry = finalMap.get(modalEditingUid);
      if (entry) {
        entry.qty = v;
        entry.createdAt = (new Date()).toISOString();
        finalMap.set(modalEditingUid, entry);
        saveFinalToStorage();
        renderFinals();
        showToast("success", "تم تعديل الكمية");
      }
      closeModal();
      return;
    }

    if (modalCurrentSourceIndex == null) {
      showToast("error", "خطأ: لا توجد بيانات مصدر");
      closeModal(); return;
    }

    const rowArray = excelData[modalCurrentSourceIndex] || [];
    addOrUpdateFinal(rowArray, v);
    searchBar.value = "";
    try { searchBar.focus(); } catch (e) {}
    closeModal();
  }

  modalConfirm && modalConfirm.addEventListener("click", modalConfirmHandler);
  modalCancel && modalCancel.addEventListener("click", closeModal);

  // keyboard - enter handling
  document.addEventListener("keydown", function (e) {
    if (modalOpen) {
      if (e.key === "Enter") { e.preventDefault(); modalConfirmHandler(); return; }
      if (e.key === "Escape") { e.preventDefault(); closeModal(); return; }
      if ((e.key >= "0" && e.key <= "9") || e.key === ".") {
        if (document.activeElement !== modalInput) {
          insertAtCaret(modalInput, e.key);
          e.preventDefault();
        }
        return;
      }
      if (e.key === "Backspace") {
        if (document.activeElement !== modalInput) {
          backspaceAtCaret(modalInput); e.preventDefault();
        }
        return;
      }
    } else {
      if (e.key === "Enter" && document.activeElement === searchBar) {
        e.preventDefault(); search(false);
      }
    }
  });

  /**************************************************************************
   * Final add / update / persistence (localStorage)
   **************************************************************************/
  function loadFinalFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_FINAL);
      if (!raw) return;
      const arr = JSON.parse(raw);
      finalMap.clear();
      arr.forEach(item => finalMap.set(item.uid, item));
      renderFinals();
    } catch (e) { console.error("loadFinalFromStorage", e); }
  }

  function saveFinalToStorage() {
    try {
      const arr = Array.from(finalMap.values()).map(e => ({ uid: e.uid, rowArray: e.rowArray, qty: e.qty, createdAt: e.createdAt, status: e.status }));
      localStorage.setItem(STORAGE_KEY_FINAL, JSON.stringify(arr));
      updatePersistentNotice();
    } catch (e) { console.error("saveFinalToStorage", e); }
  }

  function addOrUpdateFinal(rowArray, qty) {
    const uid = uidFromRow(rowArray);
    const now = (new Date()).toISOString();
    if (finalMap.has(uid)) {
      const entry = finalMap.get(uid);
      entry.qty = qty;
      entry.createdAt = now;
      entry.status = entry.status || "received";
      finalMap.set(uid, entry);
      showToast("success", "تم تحديث المنتج: " + (getCell(rowArray, NAME_IDX) || uid));
    } else {
      const entry = { uid, rowArray, qty, createdAt: now, status: "received" };
      finalMap.set(uid, entry);
      showToast("success", "تم إضافة المنتج: " + (getCell(rowArray, NAME_IDX) || uid));
    }
    saveFinalToStorage();
    renderFinals();
  }

  function renderFinals() {
    finalTbody.innerHTML = "";
    Array.from(finalMap.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).forEach(entry => {
      if (entry.status === "cancelled" && !showCancelled) return;
      const r = document.createElement("tr");
      if (entry.status === "cancelled") r.classList.add("cancelled-row");

      const td0 = document.createElement("td"); td0.textContent = getCell(entry.rowArray, NAME_IDX); r.appendChild(td0);
      const td1 = document.createElement("td"); td1.textContent = entry.qty; r.appendChild(td1);
      const td2 = document.createElement("td"); td2.textContent = getCell(entry.rowArray, CODE_IDX); r.appendChild(td2);
      const td3 = document.createElement("td");
      const barWrap = document.createElement("div"); barWrap.className = "barcode-cell";
      const barThumb = document.createElement("div"); barThumb.className = "barcode-thumb";
      barWrap.appendChild(barThumb);
      td3.appendChild(barWrap);
      r.appendChild(td3);
      const td4 = document.createElement("td"); td4.textContent = new Date(entry.createdAt).toLocaleString(); r.appendChild(td4);
      const td5 = document.createElement("td"); td5.textContent = entry.status || ""; r.appendChild(td5);

      const tdAction = document.createElement("td");
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "btn warn";
      editBtn.textContent = "تعديل";
      editBtn.addEventListener("click", () => openEditFinal(entry.uid));
      tdAction.appendChild(editBtn);

      const barcodeViewBtn = document.createElement("button");
      barcodeViewBtn.type = "button";
      barcodeViewBtn.className = "btn ghost";
      barcodeViewBtn.style.marginLeft = "6px";
      barcodeViewBtn.textContent = "عرض باركود";
      barcodeViewBtn.addEventListener("click", () => {
        const codeValue = getCell(entry.rowArray, QR_IDX) || getCell(entry.rowArray, CODE_IDX) || getCell(entry.rowArray, NAME_IDX);
        showBarcodeModal(codeValue);
      });
      tdAction.appendChild(barcodeViewBtn);

      if (entry.status !== "cancelled") {
        const cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className = "btn";
        cancelBtn.style.marginLeft = "6px";
        cancelBtn.textContent = "إلغاء";
        cancelBtn.addEventListener("click", async () => {
          const ok = confirm("هل تريد إلغاء هذا المنتج؟ سيتم إخفاؤه لكنه سيبقى محفوظاً كسجل ملغى.");
          if (!ok) return;
          cancelEntry(entry.uid);
        });
        tdAction.appendChild(cancelBtn);
      } else {
        // admin-only final delete is not implemented here for brevity
      }

      r.appendChild(tdAction);
      finalTbody.appendChild(r);

      // generate small barcode thumbnail (SVG) using JsBarcode
      const codeForBar = (getCell(entry.rowArray, QR_IDX) || getCell(entry.rowArray, CODE_IDX) || getCell(entry.rowArray, NAME_IDX)).toString();
      try {
        barThumb.innerHTML = "";
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("width", "140");
        svg.setAttribute("height", "48");
        JsBarcode(svg, codeForBar, { format: "CODE128", displayValue: false, height: 40, width: 1.2, margin: 0 });
        barThumb.appendChild(svg);
      } catch (e) { /* ignore */ }
    });

    updateSelectedCount();
    applyScaleFilter(finalTbody);
    checkClearAll();
  }

  function cancelEntry(uid) {
    const e = finalMap.get(uid);
    if (!e) return;
    e.status = "cancelled";
    e.createdAt = (new Date()).toISOString();
    finalMap.set(uid, e);
    saveFinalToStorage();
    renderFinals();
    showToast("info", "تم إلغاء المنتج: " + (getCell(e.rowArray, NAME_IDX) || uid));
  }

  function updateSelectedCount() {
    const active = Array.from(finalMap.values()).filter(e => e.status === "received" || !e.status).length;
    const el = document.getElementById("selectedCount");
    if (el) el.textContent = active;
    updatePersistentNotice();
  }

  function checkClearAll() { clearAllBtnEl && (clearAllBtnEl.style.display = (finalTbody.rows.length === 0) ? "none" : "inline-block"); }

  /**************************************************************************
   * Export to Excel (existing functionality)
   **************************************************************************/
  function exportToExcel(includeCancelled = false) {
    const rows = [];
    rows.push(["اسم المنتج", "كود الميزان", "العدد/الوزن", "QR/Barcode", "التاريخ", "الحالة"]);
    for (const entry of Array.from(finalMap.values())) {
      if (!includeCancelled && entry.status === "cancelled") continue;
      const r = entry.rowArray || [];
      const name = getCell(r, NAME_IDX) || "";
      const code = getCell(r, CODE_IDX) || "";
      const qty = entry.qty || "";
      const qr = getCell(r, QR_IDX) || "";
      const created = entry.createdAt || "";
      const status = entry.status || "";
      rows.push([name, code, qty, qr, created, status]);
    }

    let html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" lang="ar"><head><meta http-equiv="content-type" content="text/html; charset=utf-8"/></head><body>';
    html += '<table border="1" style="border-collapse:collapse; font-family: Arial, sans-serif;">';
    html += '<thead><tr>';
    rows[0].forEach(h => html += `<th style="background:#cfe2ff; font-weight:bold; padding:8px 12px; text-align:center;">${h}</th>`);
    html += '</tr></thead><tbody>';
    for (let i = 1; i < rows.length; i++) {
      html += "<tr>";
      rows[i].forEach(cell => html += `<td style="padding:6px 10px; text-align:center;">${cell}</td>`);
      html += "</tr>";
    }
    html += "</tbody></table></body></html>";

    const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "export_selected.xls";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast("success", "تم تصدير ملف الإكسل");
  }

  exportExcelBtn && exportExcelBtn.addEventListener("click", () => exportToExcel(false));

  /**************************************************************************
   * Barcode viewer (opens in new window)
   **************************************************************************/
  function showBarcodeModal(text) {
    const code = String(text || "");
    const win = window.open("", "_blank", "width=520,height=300");
    const doc = win.document;
    doc.open();
    doc.write('<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>Barcode</title>');
    doc.write('<style>body{font-family:Arial,sans-serif;text-align:center;padding:20px} .info{word-break:break-all;margin-top:12px}</style>');
    doc.write("</head><body>");
    doc.write("<h3>رمز خطي (Barcode)</h3>");
    doc.write('<div id="barcode"></div>');
    doc.write('<div class="info">' + escapeHtml(code) + "</div>");
    doc.write("</body></html>");
    doc.close();
    try {
      const svg = win.document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("width", "480");
      svg.setAttribute("height", "120");
      win.document.getElementById("barcode").appendChild(svg);
      JsBarcode(svg, code, { format: "CODE128", displayValue: true, height: 80, width: 2, margin: 10 });
    } catch (e) { /* ignore */ }
  }

  /**************************************************************************
   * QR Scanner using html5-qrcode
   **************************************************************************/
  function chooseBackCamera(devices) {
    if (!devices || devices.length === 0) return null;
    const keywords = ["back", "rear", "env", "environment", "back camera", "rear camera", "الكاميرا الخلفية", "خلفي"];
    for (const d of devices) {
      const label = (d.label || "").toString().toLowerCase();
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
    if (!window.Html5Qrcode) { showToast("error", "مكتبة html5-qrcode غير محمّلة"); return; }
    reader && (reader.style.display = "block");
    cameraBtn.textContent = "⏹ إيقاف الماسح";
    try {
      qrScanner = new Html5Qrcode("reader");
      const devices = await Html5Qrcode.getCameras().catch(() => []);
      const chosen = chooseBackCamera(devices);
      const cameraIdOrConfig = chosen ? chosen : { facingMode: "environment" };

      await qrScanner.start(
        cameraIdOrConfig,
        { fps: 10, qrbox: 250 },
        (decodedText, decodedResult) => {
          try {
            const now = Date.now();
            if (decodedText === lastScan.text && (now - lastScan.time) < lastScan.tol) { lastScan.time = now; return; }
            lastScan.text = decodedText; lastScan.time = now;
            if (modalOpen) return;
            searchBar.value = decodedText;
            try { search(true, decodedText); } catch (e) { console.error(e); }
          } catch (err) { console.error("scan callback err", err); }
        },
        (errMsg) => { /* frame errors ignored */ }
      );
      scannerRunning = true;
      cameraBtn.textContent = "⏹ إيقاف الماسح";
    } catch (err) {
      showToast("error", "فشل تشغيل الكاميرا: " + (err && err.message ? err.message : err));
      reader && (reader.style.display = "none");
      scannerRunning = false;
      cameraBtn.textContent = "📷 QR";
    }
  }

  async function stopScanner() {
    if (!qrScanner) return;
    try { await qrScanner.stop(); } catch (e) { /* ignore */ }
    try { qrScanner.clear(); } catch (e) { /* ignore */ }
    qrScanner = null;
    reader && (reader.style.display = "none");
    scannerRunning = false;
    cameraBtn.textContent = "📷 QR";
  }

  cameraBtn && cameraBtn.addEventListener("click", () => { if (scannerRunning) stopScanner(); else startScanner(); });

  /**************************************************************************
   * Admin mode (simple)
   **************************************************************************/
  function isAdminSession() { return sessionStorage.getItem("admin_mode_v2") === "1"; }
  adminBtn && adminBtn.addEventListener("click", async () => {
    if (isAdminSession()) {
      const ok = confirm("هل تريد الخروج من وضع الأدمن؟");
      if (ok) { sessionStorage.removeItem("admin_mode_v2"); showToast("info", "تم إيقاف وضع الأدمن"); renderFinals(); }
    } else {
      const p = prompt("أدخل كلمة مرور الأدمن (سيتم التحقق محليًا):");
      if (!p) return;
      const hash = await sha256(p);
      const stored = localStorage.getItem("admin_hash_v2");
      if (!stored) { localStorage.setItem("admin_hash_v2", hash); showToast("success", "تم إعداد كلمة مرور الأدمن محليًا"); }
      if (hash === localStorage.getItem("admin_hash_v2")) {
        sessionStorage.setItem("admin_mode_v2", "1"); showToast("success", "تم تفعيل وضع الأدمن"); renderFinals();
      } else showToast("error", "كلمة المرور غير صحيحة");
    }
  });

  async function sha256(msg) {
    const enc = new TextEncoder();
    const data = enc.encode(msg);
    const buf = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
  }

  /**************************************************************************
   * Persist notice
   **************************************************************************/
  window.addEventListener("beforeunload", function (e) {
    if (Array.from(finalMap.values()).some(e => e.status === "received" || !e.status)) {
      const msg = "لديك منتجات مختارة محفوظة محليًا — تحديث أو إغلاق الصفحة قد يؤثر على تجربتك. هل أنت متأكد؟";
      e.preventDefault(); e.returnValue = msg; return msg;
    }
  });

  function updatePersistentNotice() {
    const active = Array.from(finalMap.values()).filter(e => e.status === "received" || !e.status).length;
    if (active > 0) {
      persistentNotice && (persistentNotice.style.display = "");
      const pt = document.getElementById("persistentText");
      pt && (pt.textContent = `لديك ${active} منتجات محفوظة محليًا — ستظل محفوظة حتى تحذفها.`);
    } else {
      persistentNotice && (persistentNotice.style.display = "none");
    }
  }
  dismissPersistent && dismissPersistent.addEventListener("click", () => { persistentNotice.style.display = "none"; });

  /**************************************************************************
   * UI binding / startup
   **************************************************************************/
  searchBtn && searchBtn.addEventListener("click", () => search(false));
  clearBtn && clearBtn.addEventListener("click", clearSearch);
  scaleBtn && scaleBtn.addEventListener("click", toggleScaleFilter);
  clearResultsBtn && clearResultsBtn.addEventListener("click", () => { resultsTbody.innerHTML = ""; checkClearResults(); });
  clearAllBtnEl && clearAllBtnEl.addEventListener("click", async () => {
    if (!isAdminSession()) { showToast("error", "غير مسموح. فعّل وضع الأدمن لحذف الكل."); return; }
    const ok = confirm("حذف الكل: سيُحذف كل السجلات المحفوظة نهائيًا من المتصفح. موافق؟");
    if (!ok) return;
    finalMap.clear(); saveFinalToStorage(); renderFinals(); showToast("success", "تم حذف كل السجلات محليًا");
  });
  showCancelledBtn && showCancelledBtn.addEventListener("click", () => { showCancelled = !showCancelled; renderFinals(); showCancelledBtn.textContent = showCancelled ? "إخفاء الملغى" : "إظهار الملغى"; });

  searchBar && searchBar.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); search(false); } });

  window.addEventListener("load", async function () { await tryAutoLoadExcel(); loadFinalFromStorage(); setTimeout(() => { try { searchBar.focus(); } catch (e) {} }, 200); });

  /**************************************************************************
   * PDF Export (3 cols x 7 rows = 21 per page) with JsBarcode => dataURL
   **************************************************************************/
  if (exportPdfBtn) {
    exportPdfBtn.addEventListener("click", function () {
      const items = Array.from(finalMap.values()).filter(e => e.status !== "cancelled" && (e.status === "received" || !e.status));
      if (!items || items.length === 0) { showToast("error", "لا توجد منتجات مختارة لتصديرها."); return; }

      // helper to create barcode dataURL synchronously (JsBarcode runs synchronously)
      function barcodeDataUrl(code, w = 300, h = 60) {
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        try {
          JsBarcode(canvas, code || " ", { format: "CODE128", displayValue: false, height: h, width: 1, margin: 0 });
          return canvas.toDataURL("image/png");
        } catch (e) {
          // blank png fallback
          const c2 = document.createElement("canvas"); c2.width = w; c2.height = h;
          return c2.toDataURL("image/png");
        }
      }

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
              const name = getCell(entry.rowArray, NAME_IDX) || "";
              const code = (getCell(entry.rowArray, QR_IDX) || getCell(entry.rowArray, CODE_IDX) || "").toString();
              const dataImg = barcodeDataUrl(code, 260, 60);
              row.push({
                stack: [
                  { image: dataImg, width: 120, alignment: "center", margin: [0, 6, 0, 6] },
                  { text: name, fontSize: 10, alignment: "center", margin: [0, 0, 0, 2] },
                  { text: code, fontSize: 9, alignment: "center" }
                ],
                margin: [4, 4, 4, 4]
              });
            } else {
              row.push({ text: "", border: [false, false, false, false] });
            }
          }
          body.push(row);
        }

        content.push({
          table: { widths: ["33%", "33%", "33%"], body: body },
          layout: { hLineColor: "#dddddd", vLineColor: "#dddddd" }
        });

        if (pageIndex < chunks.length - 1) content.push({ text: "", pageBreak: "after" });
      });

      const docDefinition = {
        content: [{ text: "المنتجات المختارة", style: "header", alignment: "center", margin: [0, 0, 0, 8] }, ...content],
        styles: { header: { fontSize: 16, bold: true } },
        defaultStyle: { font: "Roboto", alignment: "right" },
        pageSize: "A4",
        pageMargins: [10, 20, 10, 20]
      };

      try {
        pdfMake && pdfMake.createPdf(docDefinition).download("selected_products.pdf");
      } catch (e) {
        console.error("PDF export error", e);
        showToast("error", "فشل إنشاء ملف PDF — تأكد من تحميل المكتبات.");
      }
    });
  }

  /**************************************************************************
   * small utilities + startup checks
   **************************************************************************/
  function updatePersistentNotice() { /* implemented above */ }

  // expose small debug function
  window.__app_debug = { finalMap, excelData };

}); // end DOMContentLoaded
