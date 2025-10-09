/* script.js - functionality for the product viewer */
(() => {
  'use strict';
  // DOM
  const loading = document.getElementById('loading');
  const loadingText = document.getElementById('loadingText');
  const productTable = document.getElementById('productTable');
  const receivedTable = document.getElementById('receivedTable');
  const searchInput = document.getElementById('searchInput');
  const searchBtn = document.getElementById('searchBtn');
  const scanBtn = document.getElementById('scanBtn');
  const filterBtn = document.getElementById('filterBtn');
  const clearAllBtn = document.getElementById('clearAllBtn');
  const exportBtn = document.getElementById('exportBtn');
  const printBtn = document.getElementById('printBtn');
  const fileInput = document.getElementById('fileInput');
  const uploadNotice = document.getElementById('uploadNotice');
  const scannerArea = document.getElementById('scannerArea');
  const interactive = document.getElementById('interactive');
  const stopScan = document.getElementById('stopScan');
  const printSection = document.getElementById('printSection');
  const printGrid = document.getElementById('printGrid');
  const closePrint = document.getElementById('closePrint');
  const doPrint = document.getElementById('doPrint');

  const STORAGE_KEY = 'selected_products_v1';
  let products = [];
  let hideNoDesc = false;
  let scanning = false;
  let cameraStream = null;
  let quaggaHandler = null;
  let useBarcodeDetector = false;
  let barcodeDetector = null;

  function showLoading(msg = 'جاري تحميل البيانات...') {
    loading.style.display = 'flex'; loadingText.textContent = msg;
  }
  function hideLoading() { loading.style.display = 'none'; }

  function escapeHtml(s){ if(s===null||s===undefined) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // localStorage helpers
  function loadSelected(){ try{ return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }catch(e){ return []; } }
  function saveSelected(arr){ localStorage.setItem(STORAGE_KEY, JSON.stringify(arr)); }

  // render tables
  function renderRightTable(filter='') {
    productTable.innerHTML = '';
    const q = String(filter || '').trim();
    products.forEach(p => {
      if(hideNoDesc && !p.desc) return;
      if(q) {
        const nameMatch = String(p.name||'').toLowerCase().includes(q.toLowerCase());
        const barcodeMatch = p.barcode === q;
        if(!(nameMatch || barcodeMatch)) return;
      }
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="p-2 border border-gray-700">${escapeHtml(p.name)}</td>
        <td class="p-2 border border-gray-700">${escapeHtml(p.price)}</td>
        <td class="p-2 border border-gray-700">${escapeHtml(p.desc)}</td>
        <td class="p-2 border border-gray-700">${escapeHtml(p.barcode)}</td>
        <td class="p-2 border border-gray-700"><button class="receiveBtn bg-green-600 px-3 py-1 rounded-md" data-id="${p.id}">استلام</button></td>
      `;
      productTable.appendChild(tr);
    });
    // attach handlers
    document.querySelectorAll('.receiveBtn').forEach(btn => btn.addEventListener('click', () => {
      const id = Number(btn.dataset.id); promptReceive(id);
    }));

    // if filter is exact barcode, open receive
    if(q) {
      const found = products.find(x => x.barcode === q);
      if(found) promptReceive(found.id);
    }
  }

  function renderLeftTable() {
    receivedTable.innerHTML = '';
    const arr = loadSelected();
    arr.forEach((it, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="p-2 border border-gray-700">${escapeHtml(it.name)}</td>
        <td class="p-2 border border-gray-700">${escapeHtml(it.price)}</td>
        <td class="p-2 border border-gray-700">${escapeHtml(it.barcode)}</td>
        <td class="p-2 border border-gray-700">${escapeHtml(it.qty)}</td>
        <td class="p-2 border border-gray-700">
          <button class="editBtn bg-yellow-500 px-2 py-1 rounded-md" data-idx="${idx}">تعديل</button>
          <button class="delBtn bg-red-600 px-2 py-1 rounded-md" data-idx="${idx}" style="margin-inline-start:6px">حذف</button>
        </td>
      `;
      receivedTable.appendChild(tr);
    });
    document.querySelectorAll('.delBtn').forEach(b => b.addEventListener('click', () => {
      const i = Number(b.dataset.idx); removeLeft(i);
    }));
    document.querySelectorAll('.editBtn').forEach(b => b.addEventListener('click', () => {
      const i = Number(b.dataset.idx); editLeft(i);
    }));
  }

  function addToSelected(product, qty) {
    if(!product) return;
    const n = Number(qty);
    if(Number.isNaN(n) || n <= 0) { alert('ادخل كمية صحيحة أكبر من صفر'); return; }
    const arr = loadSelected();
    const existing = arr.find(x => x.barcode === product.barcode);
    if(existing) existing.qty = (Number(existing.qty) || 0) + n;
    else arr.push({ name: product.name, price: product.price, barcode: product.barcode, qty: n });
    saveSelected(arr);
    renderLeftTable();
  }

  function promptReceive(productId) {
    const p = products.find(x => x.id === productId);
    if(!p) return alert('المنتج غير موجود');
    const qty = prompt('ادخل عدد المنتج المستلم:\\n' + p.name, '1');
    if(qty === null) return;
    addToSelected(p, qty);
  }

  function removeLeft(idx) {
    const arr = loadSelected(); arr.splice(idx,1); saveSelected(arr); renderLeftTable();
  }
  function editLeft(idx) {
    const arr = loadSelected(); const it = arr[idx]; if(!it) return;
    const val = prompt('تعديل الكمية لل\\n'+it.name, String(it.qty)); if(val === null) return;
    const n = parseInt(val,10); if(isNaN(n) || n < 0) return alert('قيمة غير صالحة'); it.qty = n; saveSelected(arr); renderLeftTable();
  }

  // export
  exportBtn.addEventListener('click', () => {
    const arr = loadSelected(); if(!arr.length) return alert('لا توجد منتجات للتصدير');
    const ws = XLSX.utils.json_to_sheet(arr);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'selected');
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'selected_products.xlsx'; a.click(); URL.revokeObjectURL(url);
  });

  // print preview
  printBtn.addEventListener('click', () => {
    const arr = loadSelected();
    if(!arr.length) return alert('لا توجد منتجات للمعاينة');
    openPrintPreview(arr);
  });
  closePrint.addEventListener('click', () => printSection.classList.add('hidden'));
  doPrint.addEventListener('click', () => window.print());

  function openPrintPreview(arr) {
    printGrid.innerHTML = '';
    // show each selected product as a card; layout 3 columns -> per page 21
    arr.forEach(it => {
      const card = document.createElement('div');
      card.className = 'bg-white text-black p-3 rounded shadow flex flex-col justify-between';
      card.innerHTML = `
        <div class="text-sm font-semibold">${escapeHtml(it.name)}</div>
        <div class="text-sm">سعر: ${escapeHtml(it.price)}</div>
        <svg class="barcode" data-value="${escapeHtml(it.barcode)}"></svg>
        <div class="text-xs">${escapeHtml(it.barcode)}</div>
      `;
      printGrid.appendChild(card);
    });
    // init JsBarcode for svg elements inside preview after a small timeout
    setTimeout(() => {
      document.querySelectorAll('#printGrid svg.barcode').forEach(s => {
        try { JsBarcode(s, s.dataset.value, { format: 'CODE128', displayValue: false, height: 40, margin: 0 }); } catch(e) { console.warn('JsBarcode error', e); }
      });
    }, 200);
    printSection.classList.remove('hidden');
    // scroll to top of preview
    printSection.scrollTop = 0;
  }

  // Search handlers
  searchBtn.addEventListener('click', () => renderRightTable(searchInput.value || ''));
  searchInput.addEventListener('keydown', (e) => { if(e.key === 'Enter') { e.preventDefault(); renderRightTable(searchInput.value || ''); } });

  // hide no desc toggle
  filterBtn.addEventListener('click', () => { hideNoDesc = !hideNoDesc; filterBtn.textContent = hideNoDesc ? '🧾 إظهار الكل' : '🧾 إخفاء الفارغ'; renderRightTable(searchInput.value || ''); });

  // clear received items
  clearAllBtn.addEventListener('click', () => {
    if(confirm('مسح كل العناصر المستلمة من localStorage؟')) { localStorage.removeItem(STORAGE_KEY); renderLeftTable(); }
  });

  // Scanner logic: try BarcodeDetector first, else fallback to Quagga
  async function startScanner() {
    if(scanning) return;
    scanning = true;
    scannerArea.classList.remove('hidden');
    interactive.innerHTML = '';
    // try BarcodeDetector
    try {
      if('BarcodeDetector' in window) {
        const supported = await BarcodeDetector.getSupportedFormats();
        // create only if useful formats present
        if(supported && supported.length) {
          try { barcodeDetector = new BarcodeDetector({ formats: ['code_128','ean_13','ean_8','upc_e','code_39'] }); useBarcodeDetector = true; }
          catch(e) { barcodeDetector = null; useBarcodeDetector = false; }
        }
      }
    } catch(e) { useBarcodeDetector = false; barcodeDetector = null; }

    if(useBarcodeDetector && barcodeDetector) {
      // use video + detector loop
      const video = document.createElement('video');
      video.setAttribute('playsinline', 'true');
      video.style.width = '100%'; video.style.height = '100%'; interactive.appendChild(video);
      try {
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        video.srcObject = cameraStream;
        await video.play();
        const detectLoop = async () => {
          if(!scanning) return;
          try {
            const results = await barcodeDetector.detect(video);
            if(results && results.length) {
              handleScannedCode(results[0].rawValue);
              return;
            }
          } catch(e) { /* ignore detection errors */ }
          setTimeout(detectLoop, 250);
        };
        detectLoop();
      } catch(e) {
        console.error('Camera start failed', e);
        alert('تعذّر الوصول إلى الكاميرا: ' + e.message);
        stopScanner();
      }
    } else {
      // fallback Quagga
      if(typeof Quagga === 'undefined') {
        alert('المستعرض لا يدعم مسح الباركود تلقائياً (BarcodeDetector و Quagga غير متاحين)');
        stopScanner(); return;
      }
      try {
        Quagga.init({
          inputStream: {
            name: 'Live',
            type: 'LiveStream',
            target: interactive,
            constraints: { facingMode: 'environment' }
          },
          locator: { patchSize: 'medium', halfSample: true },
          decoder: { readers: ['code_128_reader','ean_reader','ean_8_reader','code_39_reader','upc_reader','upc_e_reader'] },
          locate: true
        }, function(err) {
          if(err) { console.error('Quagga init error', err); alert('خطأ في تهيئة الماسح: ' + err); stopScanner(); return; }
          Quagga.start();
        });
        quaggaHandler = function(result) {
          if(!result || !result.codeResult) return;
          const code = result.codeResult.code;
          handleScannedCode(code);
        };
        Quagga.onDetected(quaggaHandler);
      } catch(e) {
        console.error('Quagga error', e);
        alert('حدث خطأ في تشغيل Quagga');
        stopScanner();
      }
    }
  }

  function handleScannedCode(code) {
    stopScanner();
    searchInput.value = code;
    const found = products.find(p => p.barcode === code);
    if(found) promptReceive(found.id);
    else renderRightTable(code);
  }

  function stopScanner() {
    scanning = false;
    scannerArea.classList.add('hidden');
    // stop camera tracks if any
    try {
      if(cameraStream && cameraStream.getTracks) {
        cameraStream.getTracks().forEach(t => t.stop());
      }
    } catch(e) { /* ignore */ }
    cameraStream = null;
    // stop Quagga if running
    try {
      if(typeof Quagga !== 'undefined') {
        Quagga.stop();
        if(typeof Quagga.offDetected === 'function' && quaggaHandler) Quagga.offDetected(quaggaHandler);
      }
    } catch(e) { console.warn('Error stopping Quagga', e); }
    quaggaHandler = null;
    interactive.innerHTML = '';
  }

  scanBtn.addEventListener('click', () => { scanning ? stopScanner() : startScanner(); });
  stopScan.addEventListener('click', () => stopScanner());

  // Auto-fetch products.xlsx from same folder
  async function autoLoadExcel() {
    showLoading('جاري جلب products.xlsx ...');
    try {
      const res = await fetch('./products.xlsx');
      if(!res.ok) throw new Error('not found');
      const ab = await res.arrayBuffer();
      readWorkbook(ab);
    } catch(err) {
      console.warn('Auto fetch failed', err);
      hideLoading();
      uploadNotice.style.display = 'inline-block';
    }
  }

  // manual file upload handled here
  fileInput.addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if(!f) return;
    showLoading('جاري قراءة الملف...');
    const ab = await f.arrayBuffer();
    readWorkbook(ab);
  });

  function readWorkbook(arrayBuffer) {
    try {
      const wb = XLSX.read(arrayBuffer, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      products = [];
      for(let i=0;i<rows.length;i++) {
        const r = rows[i]; if(!r || r.length === 0) continue;
        const name = r[0] ? String(r[0]).trim() : '';
        const price = r[1] !== undefined ? r[1] : '';
        const desc = r[2] ? String(r[2]).trim() : '';
        const barcode = r[3] ? String(r[3]).trim() : '';
        if(!name && !price && !desc && !barcode) continue;
        products.push({ id: i, name, price, desc, barcode });
      }
      renderRightTable();
    } catch(e) {
      console.error('Read workbook error', e);
      alert('حدث خطأ أثناء قراءة ملف Excel: ' + (e.message || e));
    } finally {
      hideLoading();
      uploadNotice.style.display = 'none';
    }
  }

  // init
  window.addEventListener('DOMContentLoaded', () => {
    renderLeftTable();
    // try auto load
    autoLoadExcel();
  });

})();