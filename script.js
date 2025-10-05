document.addEventListener('DOMContentLoaded', function(){
    /**************************************************************************
     * مفاتيح التخزين المحلية
     **************************************************************************/
    const STORAGE_KEY_EXCEL = 'excel_rows_v2';
    const STORAGE_KEY_FINAL = 'final_selection_v2';
    const STORAGE_KEY_ADMIN_HASH = 'admin_hash_v2';
    const STORAGE_KEY_ADMIN_SESSION = 'admin_mode_v2';

    // أعمدة الإكسل: [0]=اسم, [1]=سعر, [2]=كود الميزان, [3]=QR/Barcode
    const NAME_IDX = 0, PRICE_IDX = 1, CODE_IDX = 2, QR_IDX = 3;

    // DOM
    const statusEl = document.getElementById('status');
    const dupWarningEl = document.getElementById('dupWarning');
    const searchBar = document.getElementById('searchBar');
    const searchBtn = document.getElementById('searchBtn');
    const clearBtn = document.getElementById('clearBtn');
    const cameraBtn = document.getElementById('cameraBtn');
    const scaleBtn = document.getElementById('scaleBtn');
    const reader = document.getElementById('reader');

    const resultsTbody = document.querySelector('#results tbody');
    const finalTbody = document.querySelector('#finalResults tbody');
    const clearResultsBtn = document.getElementById('clearResultsBtn');
    const clearAllBtnEl = document.getElementById('clearAllBtn');
    const exportBtn = document.getElementById('exportBtn');
    const showCancelledBtn = document.getElementById('showCancelledBtn');

    const receiveModalOverlay = document.getElementById('receiveModal');
    const modalInput = document.getElementById('modalInput');
    const modalName = document.getElementById('modalName');
    const modalBack = document.getElementById('modalBack');
    const modalCancel = document.getElementById('modalCancel');
    const modalConfirm = document.getElementById('modalConfirm');

    const adminBtn = document.getElementById('adminBtn');
    const fileInput = document.getElementById('fileInput');

    // dialog elements
    const dialogModal = document.getElementById('dialogModal');
    const dialogTitle = document.getElementById('dialogTitle');
    const dialogMsg = document.getElementById('dialogMsg');
    const dialogInput = document.getElementById('dialogInput');
    const dialogOk = document.getElementById('dialogOk');
    const dialogCancel = document.getElementById('dialogCancel');

    const messagesPanel = document.getElementById('messagesPanel');
    const persistentNotice = document.getElementById('persistentNotice');
    const dismissPersistent = document.getElementById('dismissPersistent');

    // State
    let excelData = [];
    let startIndex = 1;
    let finalMap = new Map(); // uid -> { uid, rowArray, qty, createdAt, status }
    let scannerRunning = false;
    let qrScanner = null;
    let lastScan = { text: null, time: 0, tol: 800 };
    let scaleFilterActive = false;
    let modalCurrentSourceIndex = null;
    let modalEditingUid = null;
    let modalOpen = false;
    let showCancelled = false;

    const excelCandidates = [
      "products.xlsx",
      "products.xls",
      "product.xlsx",
      "product.xls",
      "data.xlsx",
      "data.xls",
      "db.xlsx",
      "db.xls",
      "items.xlsx",
      "items.xls",
      "inventory.xlsx",
      "inventory.xls",
      "عندك.xlsx",
      "عندك.xls",
      "products_list.xlsx",
      "products-list.xlsx"
    ];

    /**************************************************************************
     * مساعدة الرسائل (بديل للـ alert/prompt/confirm)
     **************************************************************************/
    function createToastElement(type, text, options={}) {
      const el = document.createElement('div');
      el.className = 'toast ' + (type||'info');
      const msg = document.createElement('div'); msg.className = 'msg'; msg.textContent = text;
      const closeBtn = document.createElement('button'); closeBtn.className = 'closeBtn'; closeBtn.innerHTML = '✕';
      closeBtn.addEventListener('click', ()=> { el.remove(); });
      el.appendChild(msg);
      el.appendChild(closeBtn);
      return el;
    }

    function showToast(type, text, {autoHide = true, timeout = 4500} = {}) {
      const el = createToastElement(type, text);
      messagesPanel.appendChild(el);
      if(autoHide){
        setTimeout(()=> { try{ el.remove(); }catch(e){} }, timeout);
      }
      return el;
    }

    // Generic dialog that returns Promise
    function showDialog({title = '', message = '', type = 'alert', inputType = 'text', placeholder = ''} = {}) {
      return new Promise((resolve) => {
        dialogTitle.textContent = title || '';
        dialogMsg.textContent = message || '';
        dialogInput.value = '';
        dialogInput.type = inputType || 'text';
        dialogInput.placeholder = placeholder || '';

        // configure UI
        if(type === 'prompt') dialogInput.style.display = '';
        else dialogInput.style.display = 'none';

        dialogOk.style.display = '';
        dialogCancel.style.display = '';

        // set text for buttons according to type
        dialogOk.textContent = (type === 'confirm') ? 'نعم' : 'موافق';
        dialogCancel.textContent = (type === 'alert') ? 'إغلاق' : 'إلغاء';

        // show
        dialogModal.style.display = 'flex';
        try{ dialogInput.focus(); }catch(e){}

        function cleanup(){
          dialogOk.removeEventListener('click', onOk);
          dialogCancel.removeEventListener('click', onCancel);
        }

        function onOk(){
          const val = (dialogInput.style.display !== 'none') ? dialogInput.value : true;
          cleanup(); dialogModal.style.display = 'none'; resolve(type === 'prompt' ? val : true);
        }
        function onCancel(){
          cleanup(); dialogModal.style.display = 'none'; resolve(type === 'prompt' ? null : false);
        }

        dialogOk.addEventListener('click', onOk);
        dialogCancel.addEventListener('click', onCancel);

        // keyboard handling
        function onKey(e){
          if(e.key === 'Enter') { onOk(); }
          if(e.key === 'Escape') { onCancel(); }
        }
        dialogModal.addEventListener('keydown', onKey);
        // ensure focus trap
        setTimeout(()=>{ try{ dialogModal.focus(); }catch(e){} }, 50);
      });
    }

    async function showConfirm(message){ return await showDialog({title: 'تأكيد', message, type: 'confirm'}); }
    async function showPrompt(message, {placeholder = '', inputType = 'text'} = {}){ return await showDialog({title: '', message, type: 'prompt', placeholder, inputType}); }
    async function showAlert(message){ return await showDialog({title: '', message, type: 'alert'}); }

    /**************************************************************************
     * مساعدات صغيرة
     **************************************************************************/
    function setStatus(text, active=true){
      statusEl.textContent = text;
      statusEl.style.background = active ? 'var(--accent)' : 'var(--danger)';
    }
    function escapeHtml(s){ return String(s||'').replace(/[&<>"]|'/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
    function getCell(row, idx){ if(!row) return ""; const v = row[idx]; return (v === undefined || v === null) ? "" : String(v); }
    function uidFromRow(row){ const qr = getCell(row, QR_IDX).trim(); const code = getCell(row, CODE_IDX).trim(); const name = getCell(row, NAME_IDX).trim(); if(qr) return "QR::" + qr; if(code) return "CODE::" + code; return "NAME::" + name; }

    /**************************************************************************
     * تحميل تلقائي لملفات Excel مرشحة من الريبو (GitHub Pages)
     **************************************************************************/
    async function tryAutoLoadExcel(){
      // 1) If hosted on GitHub Pages, try GitHub API to list files in repo root
      try {
        const host = location.hostname;
        if(host.endsWith('.github.io')){
          const owner = host.split('.')[0];
          const pathParts = location.pathname.split('/').filter(Boolean);
          let repo, apiPath = '';
          if(pathParts.length === 0){
            repo = owner + '.github.io';
          } else {
            repo = pathParts[0];
            apiPath = pathParts.slice(1).join('/');
          }
          const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${apiPath}`;
          const res = await fetch(apiUrl).catch(()=>null);
          if(res && res.ok){
            const items = await res.json();
            if(Array.isArray(items)){
              const excels = items.filter(it => it && it.name && (it.name.toLowerCase().endsWith('.xlsx') || it.name.toLowerCase().endsWith('.xls')));
              if(excels.length > 0){
                for(const file of excels){
                  if(file && file.download_url){
                    const ok = await tryFetchAndParse(file.download_url, file.name);
                    if(ok) return true;
                  }
                }
              }
            }
          }
        }
      } catch(e){ /* ignore */ }

      // 2) Try common candidate filenames (fallback)
      for(const name of excelCandidates){
        try {
          const ok = await tryFetchAndParse(name, name);
          if(ok) return true;
        } catch(e){}
      }

      // 3) Try to find <a> links on page that point to .xlsx/.xls
      try {
        const anchors = Array.from(document.querySelectorAll('a[href]'));
        for(const a of anchors){
          const href = a.getAttribute('href');
          if(href && /\.(xlsx|xls)$/i.test(href)){
            const url = new URL(href, window.location.href).href;
            const ok = await tryFetchAndParse(url, url);
            if(ok) return true;
          }
        }
      } catch(e){}

      // 4) fallback to localStorage snapshot if exists
      try {
        const persisted = localStorage.getItem(STORAGE_KEY_EXCEL);
        if(persisted){
          excelData = JSON.parse(persisted);
          startIndex = 1;
          setStatus('تم تحميل بيانات الإكسل من الذاكرة المحلية', true);
          showToast('info', 'تم تحميل بيانات الإكسل من الذاكرة المحلية');
          return true;
        }
      } catch(e){}

      setStatus('لم يعثر على ملف إكسل تلقائيًا — دبل كليك هنا لرفع ملف إكسل محلي.', false);
      return false;
    }

    async function tryFetchAndParse(url, sourceName){
      try {
        const res = await fetch(url);
        if(!res.ok) throw new Error('not found');
        const buf = await res.arrayBuffer();
        parseWorkbook(buf, sourceName);
        showToast('success', 'تم تحميل: ' + sourceName);
        return true;
      } catch(e){
        return false;
      }
    }

    function parseWorkbook(arrayBuffer, sourceName){
      try {
        const wb = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
        const first = wb.SheetNames[0];
        excelData = XLSX.utils.sheet_to_json(wb.Sheets[first], { header: 1 });
        if(excelData.length > 0){
          const text = (excelData[0] || []).join(" ");
          startIndex = ((/[^\s]/.test(text) && /[a-zA-Z\u0600-\u06FF]/.test(text)) ? 1 : 0);
        } else startIndex = 0;
        try{ localStorage.setItem(STORAGE_KEY_EXCEL, JSON.stringify(excelData)); }catch(e){}
        setStatus("ملف فعال: " + (sourceName || first), true);
      } catch(err){
        console.error(err);
        setStatus("فشل قراءة الإكسل", false);
        showToast('error', 'فشل قراءة الإكسل');
        excelData = [];
      }
    }

    statusEl.addEventListener('dblclick', ()=> fileInput.click());
    fileInput.addEventListener('change', (e)=>{
      const f = e.target.files[0];
      if(!f) return;
      const r = new FileReader();
      r.onload = (ev) => parseWorkbook(ev.target.result, f.name);
      r.onerror = ()=> { setStatus("فشل قراءة الملف المحلي", false); showToast('error','فشل قراءة الملف المحلي'); };
      r.readAsArrayBuffer(f);
    });

    /**************************************************************************
     * البحث و عرض النتائج
     **************************************************************************/
    function search(fromScanner=false, value=""){
      const q = (fromScanner ? String(value) : (searchBar.value || "")).trim().toLowerCase();
      resultsTbody.innerHTML = "";
      dupWarningEl.style.display = 'none';
      if(!Array.isArray(excelData) || excelData.length <= startIndex) { checkClearResults(); return; }
      if(!q) { checkClearResults(); return; }

      const seenUids = new Set();
      let dupFound = false;

      for(let i = startIndex; i < excelData.length; i++){
        const row = excelData[i] || [];
        if(row.length === 0) continue;
        const name = getCell(row, NAME_IDX).toLowerCase();
        const price = getCell(row, PRICE_IDX);
        const code = getCell(row, CODE_IDX).toLowerCase();
        const qr = getCell(row, QR_IDX).toLowerCase();

        if(name.includes(q) || code.includes(q) || qr.includes(q)){
          const uid = uidFromRow(row);
          if(seenUids.has(uid)){
            dupFound = true;
            continue;
          }
          seenUids.add(uid);

          const tr = document.createElement('tr');
          tr.dataset.sourceIndex = i;
          tr.dataset.uid = uid;
          const tdName = document.createElement('td'); tdName.textContent = getCell(row, NAME_IDX); tr.appendChild(tdName);
          const tdPrice = document.createElement('td'); tdPrice.textContent = price; tr.appendChild(tdPrice);
          const tdCode = document.createElement('td'); tdCode.textContent = getCell(row, CODE_IDX); tr.appendChild(tdCode);
          const tdQr = document.createElement('td'); tdQr.textContent = getCell(row, QR_IDX); tr.appendChild(tdQr);

          const tdAction = document.createElement('td');
          const receiveBtn = document.createElement('button');
          receiveBtn.className = 'btn primary';
          receiveBtn.textContent = 'استلام';
          receiveBtn.addEventListener('click', ()=> openReceiveModal(i));
          tdAction.appendChild(receiveBtn);

          tr.appendChild(tdAction);
          resultsTbody.appendChild(tr);
        }
      }

      if(dupFound){
        dupWarningEl.textContent = "تحذير: يوجد تكرار لنفس المنتج في ملف الإكسل — تم عرض نسخة واحدة فقط.";
        dupWarningEl.style.display = 'block';
      } else {
        dupWarningEl.style.display = 'none';
      }

      applyScaleFilter(resultsTbody);
      checkClearResults();

      if(fromScanner && value){
        const matchIndex = findRowByValue(value);
        if(matchIndex !== null){
          if(!modalOpen) openReceiveModal(matchIndex);
        }
      }
    }

    function findRowByValue(val){
      if(!Array.isArray(excelData) || excelData.length <= startIndex) return null;
      const v = String(val || "").trim();
      if(!v) return null;
      for(let i = startIndex; i < excelData.length; i++){
        const row = excelData[i] || [];
        if(getCell(row, QR_IDX).trim() === v) return i;
      }
      for(let i = startIndex; i < excelData.length; i++){
        const row = excelData[i] || [];
        if(getCell(row, CODE_IDX).trim() === v) return i;
      }
      for(let i = startIndex; i < excelData.length; i++){
        const row = excelData[i] || [];
        if(getCell(row, NAME_IDX).toLowerCase().includes(v.toLowerCase())) return i;
      }
      return null;
    }

    function clearSearch(){ searchBar.value = ""; resultsTbody.innerHTML = ""; dupWarningEl.style.display = 'none'; checkClearResults(); }
    function checkClearResults(){ clearResultsBtn.style.display = (resultsTbody.rows.length === 0) ? 'none' : 'inline-block'; }

    /**************************************************************************
     * Scale filter
     **************************************************************************/
    function toggleScaleFilter(){
      scaleFilterActive = !scaleFilterActive;
      scaleBtn.classList.toggle('btn.warn', scaleFilterActive);
      applyScaleFilter(resultsTbody);
      applyScaleFilter(finalTbody);
    }
    function applyScaleFilter(tbody){
      if(!tbody) return;
      Array.from(tbody.rows).forEach(row=>{
        const codeCell = row.cells[2];
        const val = codeCell ? (codeCell.textContent || "").trim() : "";
        row.style.display = (scaleFilterActive && val === "") ? 'none' : '';
      });
    }

    /**************************************************************************
     * Modal functions (استلام وتعديل)
     **************************************************************************/
    function openReceiveModal(sourceIndex){
      modalCurrentSourceIndex = sourceIndex;
      modalEditingUid = null;
      modalOpen = true;
      const row = excelData[sourceIndex] || [];
      modalName.textContent = getCell(row, NAME_IDX) || "";
      const uid = uidFromRow(row);
      if(finalMap.has(uid)) modalInput.value = finalMap.get(uid).qty || ""; else modalInput.value = "";
      receiveModalOverlay.style.display = 'flex';
      setTimeout(()=> { try{ modalInput.focus(); modalInput.select && modalInput.select(); }catch(e){} }, 120);
    }

    function openEditFinal(uid){
      if(!finalMap.has(uid)) return;
      modalEditingUid = uid;
      modalCurrentSourceIndex = null;
      modalOpen = true;
      const entry = finalMap.get(uid);
      modalName.textContent = getCell(entry.rowArray, NAME_IDX) || (entry.rowEl && entry.rowEl.cells[0] && entry.rowEl.cells[0].textContent) || "";
      modalInput.value = entry.qty || "";
      receiveModalOverlay.style.display = 'flex';
      setTimeout(()=> { try{ modalInput.focus(); modalInput.select && modalInput.select(); }catch(e){} }, 120);
    }

    function closeModal(){
      receiveModalOverlay.style.display = 'none';
      modalInput.value = "";
      modalCurrentSourceIndex = null;
      modalEditingUid = null;
      modalOpen = false;
    }

    // Numpad handlers
    document.querySelectorAll('.numpad button[data-key]').forEach(btn=>{
      btn.addEventListener('click', ()=> {
        const k = btn.getAttribute('data-key');
        insertAtCaret(modalInput, k);
        modalInput.focus();
      });
    });
    modalBack.addEventListener('click', ()=> { backspaceAtCaret(modalInput); modalInput.focus(); });

    function insertAtCaret(input, text){
      try{
        const start = input.selectionStart || 0;
        const end = input.selectionEnd || 0;
        const val = input.value || "";
        input.value = val.slice(0,start) + text + val.slice(end);
        const pos = start + text.length;
        input.setSelectionRange(pos,pos);
      }catch(e){ input.value = (input.value || "") + text; }
    }
    function backspaceAtCaret(input){
      try{
        const start = input.selectionStart || 0;
        const end = input.selectionEnd || 0;
        if(start === end && start > 0){
          const val = input.value || "";
          input.value = val.slice(0, start-1) + val.slice(end);
          const pos = start-1;
          input.setSelectionRange(pos,pos);
        } else {
          const val = input.value || "";
          input.value = val.slice(0,start) + val.slice(end);
          input.setSelectionRange(start,start);
        }
      }catch(e){ input.value = (input.value || "").slice(0,-1); }
    }

    // Keyboard handling
    document.addEventListener('keydown', function(e){
      if(modalOpen){
        if(e.key === 'Enter'){ e.preventDefault(); modalConfirmHandler(); return; }
        if(e.key === 'Escape'){ e.preventDefault(); closeModal(); return; }
        if((e.key >= '0' && e.key <= '9') || e.key === '.'){
          if(document.activeElement !== modalInput){
            insertAtCaret(modalInput, e.key); e.preventDefault();
          }
          return;
        }
        if(e.key === 'Backspace'){
          if(document.activeElement !== modalInput){
            backspaceAtCaret(modalInput); e.preventDefault();
          }
          return;
        }
      } else {
        if(e.key === 'Enter' && document.activeElement === searchBar){
          e.preventDefault(); search(false);
        }
      }
    });

    modalInput.addEventListener('keydown', function(e){
      if(e.key === 'Enter'){ e.preventDefault(); modalConfirmHandler(); }
      else if(e.key === 'Escape'){ e.preventDefault(); closeModal(); }
    });

    modalCancel.addEventListener('click', closeModal);

    /**************************************************************************
     * Final add / update / persistence (localStorage)
     **************************************************************************/
    function loadFinalFromStorage(){
      try{
        const raw = localStorage.getItem(STORAGE_KEY_FINAL);
        if(!raw) return;
        const arr = JSON.parse(raw);
        finalMap.clear();
        arr.forEach(item=>{
          finalMap.set(item.uid, item);
        });
        renderFinals();
      }catch(e){ console.error("load final failed", e); }
    }

    function saveFinalToStorage(){
      try{
        const arr = Array.from(finalMap.values()).map(e=>({
          uid: e.uid, rowArray: e.rowArray, qty: e.qty, createdAt: e.createdAt, status: e.status
        }));
        localStorage.setItem(STORAGE_KEY_FINAL, JSON.stringify(arr));
        updatePersistentNotice();
      }catch(e){ console.error("save final failed", e); }
    }

    function addOrUpdateFinal(rowArray, qty){
      const uid = uidFromRow(rowArray);
      const now = (new Date()).toISOString();
      if(finalMap.has(uid)){
        const entry = finalMap.get(uid);
        entry.qty = qty;
        entry.createdAt = now; // update timestamp on change
        entry.status = entry.status || 'received';
        finalMap.set(uid, entry);
        showToast('success', 'تم تحديث المنتج: ' + (getCell(rowArray, NAME_IDX) || uid));
      } else {
        const entry = { uid, rowArray, qty, createdAt: now, status: 'received' };
        finalMap.set(uid, entry);
        showToast('success', 'تم إضافة المنتج: ' + (getCell(rowArray, NAME_IDX) || uid));
      }
      saveFinalToStorage();
      renderFinals();
      return 'ok';
    }

    function renderFinals(){
      finalTbody.innerHTML = '';
      Array.from(finalMap.values()).sort((a,b)=> b.createdAt.localeCompare(a.createdAt)).forEach(entry=>{
        if(entry.status === 'cancelled' && !showCancelled) return;
        const r = document.createElement('tr');
        if(entry.status==='cancelled') r.classList.add('cancelled-row');

        const td0 = document.createElement('td'); td0.textContent = getCell(entry.rowArray, NAME_IDX); r.appendChild(td0);
        const td1 = document.createElement('td'); td1.textContent = entry.qty; r.appendChild(td1);
        const td2 = document.createElement('td'); td2.textContent = getCell(entry.rowArray, CODE_IDX); r.appendChild(td2);
        const td3 = document.createElement('td');
        // Barcode thumbnail
        const barWrap = document.createElement('div'); barWrap.className = 'barcode-cell';
        const barThumb = document.createElement('div'); barThumb.className = 'barcode-thumb';
        barWrap.appendChild(barThumb);
        td3.appendChild(barWrap);
        r.appendChild(td3);
        const td4 = document.createElement('td'); td4.textContent = new Date(entry.createdAt).toLocaleString(); r.appendChild(td4);
        const td5 = document.createElement('td'); td5.textContent = entry.status || ''; r.appendChild(td5);

        const tdAction = document.createElement('td');
        const editBtn = document.createElement('button');
        editBtn.className = 'btn warn';
        editBtn.textContent = 'تعديل';
        editBtn.addEventListener('click', ()=> openEditFinal(entry.uid));
        tdAction.appendChild(editBtn);

        const barcodeViewBtn = document.createElement('button');
        barcodeViewBtn.className = 'btn ghost';
        barcodeViewBtn.style.marginLeft = '6px';
        barcodeViewBtn.textContent = 'عرض باركود';
        barcodeViewBtn.addEventListener('click', ()=> {
          const codeValue = getCell(entry.rowArray, QR_IDX) || getCell(entry.rowArray, CODE_IDX) || getCell(entry.rowArray, NAME_IDX);
          showBarcodeModal(codeValue);
        });
        tdAction.appendChild(barcodeViewBtn);

        if(entry.status !== 'cancelled'){
          const cancelBtn = document.createElement('button');
          cancelBtn.className = 'btn';
          cancelBtn.style.marginLeft = '6px';
          cancelBtn.textContent = 'إلغاء';
          cancelBtn.addEventListener('click', async ()=> {
            const ok = await showConfirm('هل تريد إلغاء هذا المنتج؟ سيتم إخفاؤه لكنه سيبقى محفوظاً كسجل ملغى.');
            if(!ok) return; cancelEntry(entry.uid);
          });
          tdAction.appendChild(cancelBtn);
        } else {
          if(isAdminSession()){
            const delBtn = document.createElement('button');
            delBtn.className = 'btn danger';
            delBtn.style.marginLeft = '6px';
            delBtn.textContent = 'حذف نهائي';
            delBtn.addEventListener('click', async ()=> { const ok = await showConfirm('حذف نهائي: غير قابل للاسترجاع. موافق؟'); if(!ok) return; finalMap.delete(entry.uid); saveFinalToStorage(); renderFinals(); updateSelectedCount(); });
            tdAction.appendChild(delBtn);
          }
        }

        r.appendChild(tdAction);
        finalTbody.appendChild(r);

        // generate small linear barcode thumbnail using JsBarcode
        const codeForBar = (getCell(entry.rowArray, QR_IDX) || getCell(entry.rowArray, CODE_IDX) || getCell(entry.rowArray, NAME_IDX)).toString();
        try {
          barThumb.innerHTML = '';
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          // set reasonable defaults for thumbnail
          svg.setAttribute('width', '140');
          svg.setAttribute('height', '48');
          JsBarcode(svg, codeForBar, { format: "CODE128", displayValue: false, height: 40, width: 1.2, margin: 0 });
          barThumb.appendChild(svg);
        } catch(e){}
      });
      updateSelectedCount();
      applyScaleFilter(finalTbody);
      checkClearAll();
    }

    function cancelEntry(uid){
      const e = finalMap.get(uid);
      if(!e) return;
      e.status = 'cancelled';
      e.createdAt = (new Date()).toISOString();
      finalMap.set(uid, e);
      saveFinalToStorage();
      renderFinals();
      showToast('info', 'تم إلغاء المنتج: ' + (getCell(e.rowArray, NAME_IDX) || uid));
    }

    function updateSelectedCount(){
      const active = Array.from(finalMap.values()).filter(e=> e.status==='received' || !e.status).length;
      document.getElementById('selectedCount').textContent = active;
      updatePersistentNotice();
    }

    function checkClearAll(){ clearAllBtnEl.style.display = (finalTbody.rows.length === 0) ? 'none' : 'inline-block'; }

    async function clearAllSelected(){
      if(!isAdminSession()){ showToast('error', 'غير مسموح. فعّل وضع الأدمن لحذف الكل.'); return; }
      const ok = await showConfirm('حذف الكل: سيُحذف كل السجلات المحفوظة نهائيًا من المتصفح. موافق؟');
      if(!ok) return;
      finalMap.clear();
      saveFinalToStorage();
      renderFinals();
      showToast('success', 'تم حذف كل السجلات محليًا');
    }

    /**************************************************************************
     * modal confirm (استبدلت التنبيهات)
     **************************************************************************/
    function modalConfirmHandler(){
      const v = (modalInput.value || '').trim();
      if(v === ''){ showToast('error','لا يمكن ترك الحقل فارغاً'); modalInput.focus(); return; }
      const num = Number(v);
      if(!isFinite(num) || num <= 0){ showToast('error','الرجاء إدخال رقم صالح أكبر من صفر'); modalInput.focus(); return; }

      if(modalEditingUid){
        const entry = finalMap.get(modalEditingUid);
        if(entry){
          entry.qty = v;
          entry.createdAt = (new Date()).toISOString();
          finalMap.set(modalEditingUid, entry);
          saveFinalToStorage();
          renderFinals();
          showToast('success','تم تعديل الكمية');
        }
        closeModal();
        return;
      }

      if(modalCurrentSourceIndex == null){
        showToast('error','خطأ: لا توجد بيانات مصدر');
        closeModal(); return;
      }

      const rowArray = excelData[modalCurrentSourceIndex] || [];
      addOrUpdateFinal(rowArray, v);

      searchBar.value = "";
