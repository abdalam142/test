<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>نظام إدارة المنتجات</title>

  <!-- مكتبات خارجية -->
  <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"></script>
  <script src="https://unpkg.com/html5-qrcode"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/pdfmake.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/vfs_fonts.js"></script>

  <!-- رابط ملف التنسيق -->
  <link rel="stylesheet" href="style.css" />

  <style>
    /* fallback مصغر سريع لو ماكانش style.css متوفر مؤقتًا */
    body { font-family: Arial, sans-serif; background:#f6f7fb; color:#222; margin:18px; direction:rtl; }
  </style>
</head>
<body>
  <!-- حالة التحميل / رفع الإكسل (دبل كليك لفتح حوار تحميل) -->
  <div id="status" title="دبل كليك لرفع ملف الإكسل محلي">جارٍ محاولة تحميل ملف الإكسل...</div>

  <!-- منطقة الإشعارات (toasts) -->
  <div id="messagesPanel" aria-live="polite"></div>

  <!-- إشعار دائم عند وجود منتجات محفوظة -->
  <div id="persistentNotice" style="display:none;">
    <div class="notice">
      <div id="persistentText">لديك منتجات محفوظة محليًا — ستظل محفوظة حتى تحذفها.</div>
      <div><button id="dismissPersistent" type="button" class="btn ghost">إخفاء</button></div>
    </div>
  </div>

  <main id="app">
    <header>
      <h2>نظام إدارة المنتجات</h2>
    </header>

    <!-- شريط البحث والأدوات -->
    <section class="controls">
      <input id="searchBar" type="text" placeholder="اكتب الاسم أو الباركود أو وصف المنتج أو الكود هنا" aria-label="بحث" />
      <button id="searchBtn" type="button" class="btn primary">بحث</button>
      <button id="clearBtn" type="button" class="btn ghost">حذف</button>

      <button id="cameraBtn" type="button" class="btn camera">📷 QR</button>
      <button id="scaleBtn" type="button" class="btn ghost">📶 كود الميزان</button>
      <button id="adminBtn" type="button" class="btn ghost">وضع الأدمن</button>

      <!-- رفع إكسل اختياري صافٍ -->
      <input id="excelFile" type="file" accept=".xlsx,.xls" style="display:none" />
    </section>

    <!-- تحذير التكرار -->
    <div class="dup-warning" id="dupWarning" role="alert" style="display:none;"></div>

    <!-- قارئ الكاميرا -->
    <div id="reader" aria-hidden="true" style="display:none;"></div>

    <!-- الجداول -->
    <section class="tables">
      <!-- جدول نتائج البحث -->
      <div class="col" aria-label="نتائج البحث">
        <h3>نتائج البحث</h3>
        <div style="text-align:left; margin-bottom:6px;">
          <button id="clearResultsBtn" type="button" class="btn ghost" style="display:none;">حذف الكل</button>
        </div>
        <table id="results" aria-live="polite">
          <thead>
            <tr>
              <th>اسم المنتج</th>
              <th>السعر</th>
              <th>كود الميزان</th>
              <th>الكود الخطي</th>
              <th>إجراء</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>

      <!-- جدول المنتجات المختارة -->
      <div class="col" aria-label="المنتجات المختارة">
        <h3>المنتجات المختارة (<span id="selectedCount">0</span>)</h3>

        <div style="text-align:left; margin-bottom:6px;">
          <button id="showCancelledBtn" type="button" class="btn ghost">إظهار الملغى</button>
          <button id="clearAllBtn" type="button" class="btn ghost" style="display:none; margin-left:8px;">حذف الكل (أدمن)</button>
        </div>

        <table id="finalResults" aria-live="polite">
          <thead>
            <tr>
              <th>اسم المنتج</th>
              <th>العدد</th>
              <th>كود الميزان</th>
              <th>الباركود</th>
              <th>التاريخ</th>
              <th>الحالة</th>
              <th>إجراء</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>

        <div style="margin-top:8px; text-align:left;">
          <button id="exportBtn" type="button" class="btn primary">تصدير إكسل</button>
          <button id="exportPdfBtn" type="button" class="btn primary" style="margin-left:8px;">تصدير PDF</button>
        </div>
      </div>
    </section>

    <!-- (اختياري) جدول إضافي باسم selectedProducts إذا كان سكربتك القديم يستخدمه -->
    <!-- احتفظنا به لتوافقية التصدير القديم/جديد -->
    <section style="display:none;">
      <table id="selectedProducts">
        <thead><tr><th>الاسم</th><th>الباركود</th><th>السعر</th></tr></thead>
        <tbody></tbody>
      </table>
    </section>
  </main>

  <!-- Dialog عام بديل alert/prompt -->
  <div class="dialog-overlay" id="dialogModal" style="display:none;">
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialogTitle">
      <h4 id="dialogTitle">عنوان</h4>
      <div class="dialog-msg" id="dialogMsg"></div>
      <input id="dialogInput" class="dialog-input" style="display:none;" />
      <div class="dialog-actions" id="dialogActions">
        <button id="dialogCancel" type="button" class="btn ghost">إلغاء</button>
        <button id="dialogOk" type="button" class="btn primary">موافق</button>
      </div>
    </div>
  </div>

  <!-- مودال الاستلام -->
  <div class="modal-overlay" id="receiveModal" style="display:none;">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
      <h4 id="modalTitle">استلام المنتج</h4>
      <div id="modalName" style="text-align:center; font-weight:700; margin-bottom:8px;"></div>
      <input id="modalInput" class="modal-input" inputmode="decimal" placeholder="العدد أو الوزن (مثال: 2 أو 0.5)" autocomplete="off" />
      <div class="numpad" aria-hidden="false">
        <button type="button" data-key="7">7</button>
        <button type="button" data-key="8">8</button>
        <button type="button" data-key="9">9</button>
        <button type="button" data-key="4">4</button>
        <button type="button" data-key="5">5</button>
        <button type="button" data-key="6">6</button>
        <button type="button" data-key="1">1</button>
        <button type="button" data-key="2">2</button>
        <button type="button" data-key="3">3</button>
        <button type="button" id="modalBack">⌫</button>
        <button type="button" data-key="0">0</button>
        <button type="button" data-key=".">.</button>
      </div>
      <div class="actions" style="display:flex; gap:8px; justify-content:center; margin-top:12px">
        <button id="modalCancel" type="button" class="btn ghost">إلغاء</button>
        <button id="modalConfirm" type="button" class="btn primary">تم</button>
      </div>
    </div>
  </div>

  <!-- ملف رفع مخفي (يستخدم عند دبل-كليك على الحالة أو زر رفع) -->
  <input id="fileInput" type="file" accept=".xlsx,.xls" style="display:none" />

  <!-- ربط السكربت (script.js) في الأسفل -->
  <script src="script.js"></script>
</body>
</html>
