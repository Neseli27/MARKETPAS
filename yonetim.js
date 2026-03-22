// =====================================================
// MarketPas v3 — Yönetim Paneli
// =====================================================

var marketId = null;
var marketData = null;
var registersListener = null;
var queueListener = null;
var currentListener = null;
var editingAnnId = null;
var congestionInterval = null;
var reportInterval = null;

// ─── Başlangıç ────────────────────────────────────────
function init() {
  var params = new URLSearchParams(window.location.search);
  marketId = params.get('market');

  // Session kontrolü
  var savedId = localStorage.getItem('mp_market_id');
  if (!marketId && savedId) { marketId = savedId; history.replaceState({}, '', '?market=' + marketId); }

  if (marketId) {
    document.getElementById('auth-overlay').style.display = 'flex';
    // Otomatik giriş denemesi (session varsa)
    if (savedId === marketId) { autoLogin(); }
  } else {
    window.location.href = '/';
  }
}

async function autoLogin() {
  try {
    var doc = await db.collection('markets').doc(marketId).get();
    if (doc.exists && doc.data().status !== 'deleted') {
      document.getElementById('auth-overlay').style.display = 'none';
      marketData = doc.data();
      startPanel();
    }
  } catch(e) {}
}

// ─── Auth (PIN ile) ──────────────────────────────────
async function handleAuth() {
  var pin = document.getElementById('auth-pin').value.trim();
  var errEl = document.getElementById('auth-error');
  errEl.style.display = 'none';
  if (!pin) { errEl.textContent = 'PIN veya şifre girin.'; errEl.style.display = 'block'; return; }

  try {
    var doc = await db.collection('markets').doc(marketId).get();
    if (!doc.exists) { errEl.textContent = 'Market bulunamadı.'; errEl.style.display = 'block'; return; }
    var d = doc.data();

    // PIN veya şifre ile giriş
    var passHash = await hashPassword(pin);
    if (d.kasiyerPin !== pin && d.passwordHash !== passHash) {
      errEl.textContent = 'Geçersiz PIN veya şifre.'; errEl.style.display = 'block'; return;
    }
    if (d.status === 'deleted' || d.status === 'suspended') {
      errEl.textContent = 'Bu hesap aktif değil.'; errEl.style.display = 'block'; return;
    }

    localStorage.setItem('mp_market_id', marketId);
    document.getElementById('auth-overlay').style.display = 'none';
    marketData = d;
    startPanel();
  } catch(e) { errEl.textContent = 'Bağlantı hatası.'; errEl.style.display = 'block'; }
}

function startPanel() {
  document.getElementById('panel-market-name').textContent = marketData.name;
  var mobTitle = document.getElementById('mob-title');
  if (mobTitle) mobTitle.textContent = marketData.name;
  showSection('reports');
  startLiveListeners();
  startMarketListener(); // Market verisini canlı dinle (lisans değişiklikleri vs.)
  loadAnnouncements();
  loadCongestionStats();
  congestionInterval = setInterval(loadCongestionStats, 10000);
  checkLicenseWarning();
  updateSidebarLicense();
}

// ─── Market Verisi Canlı Dinleyici ───────────────────
function startMarketListener() {
  db.collection('markets').doc(marketId).onSnapshot(function(doc) {
    if (!doc.exists) return;
    marketData = doc.data();
    document.getElementById('panel-market-name').textContent = marketData.name;
    var mt = document.getElementById('mob-title'); if (mt) mt.textContent = marketData.name;
    updateSidebarLicense();
    checkLicenseWarning();
  });
}

// ─── Sidebar Lisans Durumu ───────────────────────────
function updateSidebarLicense() {
  var el = document.getElementById('sidebar-license');
  if (!el) return;

  if (!marketData.licenseExpiry) {
    el.className = 'sidebar-license expired';
    el.innerHTML = '<span>🚫</span><span>Lisans tanımlanmamış</span>';
    return;
  }

  var days = getLicenseRemainingDays(marketData.licenseExpiry);
  var expDate = (marketData.licenseExpiry.toDate ? marketData.licenseExpiry.toDate() : new Date(marketData.licenseExpiry)).toLocaleDateString('tr-TR');
  var planName = marketData.licenseDays === 1 ? 'Günübirlik' : (marketData.licenseDays || '') + ' günlük plan';

  if (days <= 0) {
    el.className = 'sidebar-license expired';
    el.innerHTML = '<span>🚫</span><div><div>Lisans süresi dolmuş</div><div style="font-size:11px;opacity:.7;margin-top:2px">Bitiş: ' + expDate + '</div></div>';
  } else if (days <= 5) {
    el.className = 'sidebar-license warning';
    el.innerHTML = '<span>⚠️</span><div><span class="lic-days">' + days + ' gün</span> kaldı<div style="font-size:11px;opacity:.7;margin-top:2px">' + planName + ' · ' + expDate + '</div></div>';
  } else {
    el.className = 'sidebar-license active';
    el.innerHTML = '<span>✓</span><div><span class="lic-days">' + days + ' gün</span> kaldı<div style="font-size:11px;opacity:.7;margin-top:2px">' + planName + ' · ' + expDate + '</div></div>';
  }
}

// ─── Lisans Uyarısı (Dashboard) ──────────────────────
function checkLicenseWarning() {
  var warn = document.getElementById('license-warning');
  if (!warn) return;
  if (!marketData.licenseExpiry) {
    warn.style.display = 'block';
    warn.className = 'alert-card critical';
    warn.innerHTML = '<div class="alert-icon">🚫</div><div class="alert-content"><div class="alert-title">Lisans Tanımlanmamış</div><div class="alert-sub">Sistem müşteri kodu üretemez. Lütfen yönetici ile iletişime geçin.</div></div>';
    return;
  }
  var days = getLicenseRemainingDays(marketData.licenseExpiry);
  if (days <= 0) {
    warn.style.display = 'block';
    warn.className = 'alert-card critical';
    warn.innerHTML = '<div class="alert-icon">🚫</div><div class="alert-content"><div class="alert-title">Lisans Süresi Dolmuş</div><div class="alert-sub">Sistem müşteri kodu üretemiyor. Lisansınızı yenilemek için yönetici ile iletişime geçin.</div></div>';
  } else if (days <= 5) {
    warn.style.display = 'block';
    warn.className = 'alert-card';
    warn.innerHTML = '<div class="alert-icon">⚠️</div><div class="alert-content"><div class="alert-title">Lisans Süresi Doluyor — ' + days + ' gün kaldı</div><div class="alert-sub">Lisansınızı yenilemek için yönetici ile iletişime geçin.</div></div>';
  } else {
    warn.style.display = 'none';
  }
}

// ─── Canlı Dinleyiciler ──────────────────────────────
function startLiveListeners() {
  if (registersListener) registersListener();
  if (queueListener) queueListener();
  if (currentListener) currentListener();

  // Kasa durumları — canlı
  registersListener = db.collection('registers').where('marketId', '==', marketId).orderBy('kasaNo', 'asc')
    .onSnapshot(function(snap) { renderRegisters(snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); })); });

  // Sıra bekleyenler — canlı (sadece waiting + priority)
  queueListener = db.collection('queue').where('marketId', '==', marketId).where('status', 'in', ['waiting', 'priority'])
    .onSnapshot(function(snap) { document.getElementById('queue-count').textContent = snap.size; });

  // Anlık müşteri — canlı (tüm aktif durumlar)
  currentListener = db.collection('queue').where('marketId', '==', marketId)
    .where('status', 'in', ['waiting', 'priority', 'priority_ready', 'called', 'arrived', 'active'])
    .onSnapshot(function(snap) {
      var el = document.getElementById('stat-current');
      if (el) el.textContent = snap.size;
    });

  loadStats();
}

function renderRegisters(registers) {
  var grid = document.getElementById('registers-grid');
  grid.innerHTML = '';

  // marketData'yı güncel kasa sayısıyla güncelle
  if (marketData) marketData.kasaSayisi = registers.length;

  registers.forEach(function(r) {
    var sc = 'idle', st = 'BOŞTA';
    if (r.activeQueueId && r.waitingQueueId) { sc = 'full'; st = 'DOLU'; }
    else if (r.activeQueueId) { sc = 'active'; st = 'AKTİF'; }
    else if (r.waitingQueueId) { sc = 'calling'; st = 'ÇAĞIRIYOR'; }

    var card = document.createElement('div'); card.className = 'kasa-card ' + sc;
    card.innerHTML = '<div class="kasa-num">Kasa ' + r.kasaNo + '</div><div class="kasa-status">' + st + '</div>';

    var td = document.createElement('div'); td.className = 'kasa-toggle';
    var lbl = document.createElement('label'); lbl.className = 'switch';
    var inp = document.createElement('input'); inp.type = 'checkbox'; inp.checked = r.active;
    inp.onchange = function() { toggleKasa(r.id, this.checked); };
    var sl = document.createElement('span'); sl.className = 'slider';
    lbl.appendChild(inp); lbl.appendChild(sl); td.appendChild(lbl);
    var sp = document.createElement('span'); sp.textContent = r.active ? 'Açık' : 'Kapalı'; td.appendChild(sp);

    var del = document.createElement('button');
    del.className = 'btn btn-sm'; del.style.cssText = 'background:#FEE2E2;color:#DC2626;margin-left:8px;padding:4px 10px;font-size:11px;';
    del.textContent = 'Sil';
    del.onclick = function() { if (confirm('Kasa ' + r.kasaNo + ' silinsin mi?')) deleteKasa(r.id); };
    td.appendChild(del);

    card.appendChild(td);
    grid.appendChild(card);
  });

  // QR sayfası açıksa kasiyer linklerini de güncelle
  var qrSection = document.getElementById('section-qr');
  if (qrSection && qrSection.classList.contains('active')) {
    buildKasiyerLinks(getBaseUrl());
  }
}

async function toggleKasa(regId, active) { await db.collection('registers').doc(regId).update({ active: active }); }

async function deleteKasa(regId) {
  try {
    await db.collection('registers').doc(regId).delete();
    await db.collection('markets').doc(marketId).update({ kasaSayisi: firebase.firestore.FieldValue.increment(-1) });
  } catch(e) { alert('Hata: ' + e.message); }
}

async function handleAddKasa() {
  try {
    var snap = await db.collection('registers').where('marketId', '==', marketId).get();
    var max = 0; snap.forEach(function(d) { if (d.data().kasaNo > max) max = d.data().kasaNo; });
    await db.collection('registers').add({
      marketId: marketId, kasaNo: max + 1, active: true,
      activeQueueId: null, waitingQueueId: null, waitingCode: null, calledAt: null
    });
    await db.collection('markets').doc(marketId).update({ kasaSayisi: firebase.firestore.FieldValue.increment(1) });
    alert('Kasa ' + (max + 1) + ' eklendi.');
  } catch(e) { alert('Hata: ' + e.message); }
}

// ─── Yoğunluk + Performans ──────────────────────────
async function loadCongestionStats() {
  try {
    var stats = await getMarketStats(marketId);
    var avgEl = document.getElementById('stat-avg-time');
    var congEl = document.getElementById('stat-congestion');
    var kasaEl = document.getElementById('stat-active-kasas');
    var waitEl = document.getElementById('stat-est-wait');
    if (avgEl) avgEl.textContent = stats.avgProcessTime > 0 ? formatWaitTime(stats.avgProcessTime) : '—';
    if (congEl) { congEl.textContent = '%' + stats.congestionPercent; congEl.style.color = stats.congestionLevel === 'yogun' ? '#EF4444' : stats.congestionLevel === 'normal' ? '#D97706' : '#16A34A'; }
    if (kasaEl) kasaEl.textContent = stats.activeCasas;
    if (waitEl) waitEl.textContent = stats.estimatedWait > 0 ? formatWaitTime(stats.estimatedWait) : '—';

    var al = document.getElementById('congestion-alert');
    if (stats.congestionPercent >= 90) { al.style.display = 'flex'; al.className = 'alert-card critical'; al.querySelector('.alert-icon').textContent = '🚨'; al.querySelector('.alert-title').textContent = 'Aşırı Yoğunluk! (%' + stats.congestionPercent + ')'; al.querySelector('.alert-sub').textContent = stats.waitingCount + ' müşteri bekliyor. Acil yeni kasa açın!'; }
    else if (stats.congestionPercent >= 70) { al.style.display = 'flex'; al.className = 'alert-card'; al.querySelector('.alert-icon').textContent = '⚠️'; al.querySelector('.alert-title').textContent = 'Yoğunluk Artıyor (%' + stats.congestionPercent + ')'; al.querySelector('.alert-sub').textContent = stats.waitingCount + ' müşteri bekliyor.'; }
    else { al.style.display = 'none'; }

    await loadKasaPerformance();
    await loadStats();

    // Raporlar sayfası açıksa günlük detayları da güncelle
    var reportSection = document.getElementById('section-reports');
    if (reportSection && reportSection.classList.contains('active')) {
      await loadReport();
    }
  } catch(e) {}
}

async function loadKasaPerformance() {
  var grid = document.getElementById('perf-grid');
  var empty = document.getElementById('perf-empty');
  if (!grid) return;
  try {
    var today = new Date(); today.setHours(0,0,0,0);
    var todayTs = firebase.firestore.Timestamp.fromDate(today);
    var doneSnap = await db.collection('queue').where('marketId', '==', marketId).where('status', '==', 'done').where('createdAt', '>=', todayTs).get();
    var ks = {};
    doneSnap.forEach(function(doc) {
      var d = doc.data(); var kNo = d.kasaNo; if (!kNo) return;
      if (!ks[kNo]) ks[kNo] = { count: 0, totalTime: 0, times: [] };
      ks[kNo].count++;
      if (d.arrivedAt && d.completedAt) {
        var a = d.arrivedAt.toDate ? d.arrivedAt.toDate() : new Date(d.arrivedAt);
        var c = d.completedAt.toDate ? d.completedAt.toDate() : new Date(d.completedAt);
        var pt = c.getTime() - a.getTime();
        if (pt > 0 && pt < 1800000) { ks[kNo].totalTime += pt; ks[kNo].times.push(pt); }
      }
    });
    var keys = Object.keys(ks).sort(function(a,b) { return parseInt(a) - parseInt(b); });
    if (!keys.length) { grid.innerHTML = ''; if (empty) empty.style.display = 'block'; return; }
    if (empty) empty.style.display = 'none';
    var gTotal = 0, gCount = 0;
    keys.forEach(function(k) { if (ks[k].times.length) { gTotal += ks[k].totalTime; gCount += ks[k].times.length; } });
    var gAvg = gCount > 0 ? gTotal / gCount : 0;
    grid.innerHTML = '';
    keys.forEach(function(k) {
      var s = ks[k]; var avg = s.times.length ? s.totalTime / s.times.length : 0;
      var rankCls = '', rankText = '';
      if (avg > 0 && gAvg > 0) {
        if (avg <= gAvg * 0.85) { rankCls = 'fast'; rankText = '⚡ Hızlı'; }
        else if (avg >= gAvg * 1.15) { rankCls = 'slow'; rankText = '🐌 Yavaş'; }
        else { rankCls = 'normal'; rankText = '— Normal'; }
      }
      grid.innerHTML += '<div class="perf-card"><div class="perf-kasa">Kasa ' + k + '</div><div class="perf-time">' + (avg > 0 ? formatWaitTime(avg) : '—') + '</div><div class="perf-count">' + s.count + ' müşteri bugün</div>' + (rankCls ? '<div class="perf-rank ' + rankCls + '">' + rankText + '</div>' : '') + '</div>';
    });
  } catch(e) {}
}

// ─── İstatistikler ───────────────────────────────────
async function loadStats() {
  try {
    var today = new Date(); today.setHours(0,0,0,0);
    var ts = firebase.firestore.Timestamp.fromDate(today);
    var t1 = await db.collection('queue').where('marketId', '==', marketId).where('status', '==', 'done').where('createdAt', '>=', ts).get();
    var t3 = await db.collection('queue').where('marketId', '==', marketId).where('status', '==', 'timeout').where('createdAt', '>=', ts).get();
    var el1 = document.getElementById('stat-today'); if (el1) el1.textContent = t1.size;
    var el3 = document.getElementById('stat-timeout'); if (el3) el3.textContent = t3.size;
  } catch(e) {}
}

// ─── İçerik Yönetimi (3 Kategori) ────────────────────
var currentCategory = 'kampanya';
var allAnnouncements = [];

var CAT_LABELS = {
  kampanya: { icon: '🏷️', name: 'Kampanyalar' },
  surpriz: { icon: '🎁', name: 'Sürpriz İndirimler' },
  gunun_firsati: { icon: '⭐', name: 'Günün Fırsatı' }
};

function loadAnnouncements() {
  db.collection('announcements').where('marketId', '==', marketId)
    .onSnapshot(function(snap) {
      allAnnouncements = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
      // Eskisi kategorisiz olanları 'kampanya' olarak ata
      allAnnouncements.forEach(function(a) { if (!a.category) a.category = 'kampanya'; });
      updateCategoryCounts();
      renderAnnouncements();
    }, function(error) {
      console.error('İçerik yükleme hatası:', error);
    });
}

function switchCategory(cat) {
  currentCategory = cat;
  document.querySelectorAll('.cat-tab').forEach(function(t) { t.classList.remove('active'); });
  var tab = document.getElementById('tab-' + cat);
  if (tab) tab.classList.add('active');
  var title = document.getElementById('cat-list-title');
  if (title && CAT_LABELS[cat]) title.textContent = CAT_LABELS[cat].name;
  renderAnnouncements();
  cancelAnnForm();
}

function updateCategoryCounts() {
  ['kampanya', 'surpriz', 'gunun_firsati'].forEach(function(cat) {
    var count = allAnnouncements.filter(function(a) { return a.category === cat && a.active; }).length;
    var el = document.getElementById('count-' + cat);
    if (el) el.textContent = count;
  });
}

function renderAnnouncements() {
  var list = allAnnouncements
    .filter(function(a) { return a.category === currentCategory; })
    .sort(function(a, b) { return (a.order || 0) - (b.order || 0); });

  var c = document.getElementById('ann-list'); c.innerHTML = '';
  if (!list.length) {
    var label = CAT_LABELS[currentCategory] || {};
    c.innerHTML = '<p class="empty-msg">Henüz ' + (label.name || 'içerik').toLowerCase() + ' eklenmemiş.</p>';
    return;
  }
  list.forEach(function(a) {
    var card = document.createElement('div');
    card.className = 'ann-card ' + (a.active ? 'ann-active' : 'ann-inactive');

    var thumbHtml = '';
    if (a.imageUrl) {
      thumbHtml = '<div class="ann-thumb"><img src="' + a.imageUrl + '" alt="" onerror="this.parentNode.style.display=\'none\'"></div>';
    }

    var catBadge = '<span class="ann-cat-badge ' + (a.category || 'kampanya') + '">' + (CAT_LABELS[a.category] ? CAT_LABELS[a.category].icon + ' ' + CAT_LABELS[a.category].name : '🏷️ Kampanya') + '</span>';

    card.innerHTML = thumbHtml +
      '<div class="ann-info"><div class="ann-title-text">' + escapeHtml(a.title) + '</div><div class="ann-content-text">' + escapeHtml(a.content || '') + '</div>' +
      '<div class="ann-status-row">' + catBadge + '<span class="ann-order-badge">Sıra: ' + (a.order || 1) + '</span>' +
      (a.imageUrl ? '<span class="ann-has-img">🖼</span>' : '') +
      '</div></div>' +
      '<div class="ann-actions">' +
      '<button class="btn-sm ' + (a.active ? 'btn-warn' : 'btn-success') + '" onclick="toggleAnn(\'' + a.id + '\',' + !a.active + ')">' + (a.active ? 'Pasif' : 'Aktif') + '</button>' +
      '<button class="btn-sm btn-edit" onclick="editAnn(\'' + a.id + '\')">Düzenle</button>' +
      '<button class="btn-sm btn-del" onclick="deleteAnn(\'' + a.id + '\')">Sil</button>' +
      '</div>';
    c.appendChild(card);
  });
}

// ─── Upload Handling ─────────────────────────────────
var uploadedImageData = null;

function handleFileSelect(input) {
  var file = input.files[0];
  if (!file) return;
  if (!file.type.match(/image\/(jpeg|png|webp)/)) { alert('Sadece JPG, PNG veya WebP yükleyebilirsiniz.'); input.value = ''; return; }

  var ph = document.getElementById('upload-placeholder');
  ph.innerHTML = '<div style="font-size:12px;color:var(--accent)">Sıkıştırılıyor...</div>';

  var steps = [{ maxW: 800, q: 0.45 },{ maxW: 600, q: 0.30 },{ maxW: 500, q: 0.20 },{ maxW: 400, q: 0.15 }];
  function tryCompress(i) {
    compressImage(file, steps[i].maxW, steps[i].q, function(dataUrl) {
      var sizeKB = Math.round(dataUrl.length * 0.75 / 1024);
      if (sizeKB > 700 && i < steps.length - 1) tryCompress(i + 1);
      else finishUpload(dataUrl, sizeKB);
    });
  }
  tryCompress(0);
}

var defaultPlaceholderHTML = '<div style="font-size:24px">📸</div><div style="font-size:12px;color:var(--text2)">Görsel Yükle</div>';

function finishUpload(dataUrl, sizeKB) {
  uploadedImageData = dataUrl;
  document.getElementById('upload-preview-img').src = dataUrl;
  document.getElementById('upload-preview').style.display = 'block';
  document.getElementById('upload-placeholder').style.display = 'none';
  document.getElementById('upload-placeholder').innerHTML = defaultPlaceholderHTML;
  var sizeEl = document.getElementById('upload-size');
  if (sizeEl) sizeEl.textContent = sizeKB + ' KB';
  document.getElementById('form-ann-img').value = '';
}

function removeUpload() {
  uploadedImageData = null;
  document.getElementById('upload-preview').style.display = 'none';
  document.getElementById('upload-placeholder').style.display = 'block';
  document.getElementById('upload-placeholder').innerHTML = defaultPlaceholderHTML;
  document.getElementById('form-ann-file').value = '';
}

function compressImage(file, maxWidth, quality, callback) {
  var reader = new FileReader();
  reader.onload = function(e) {
    var img = new Image();
    img.onload = function() {
      var canvas = document.createElement('canvas');
      var w = img.width, h = img.height;
      if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      callback(canvas.toDataURL('image/jpeg', quality));
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// ─── İçerik CRUD ────────────────────────────────────
function showAnnForm(id) {
  editingAnnId = id || null;
  uploadedImageData = null;
  document.getElementById('ann-form').style.display = 'block';
  document.getElementById('ann-form-title').textContent = id ? 'İçerik Düzenle' : 'Yeni İçerik';
  document.getElementById('upload-preview').style.display = 'none';
  document.getElementById('upload-placeholder').style.display = 'block';
  document.getElementById('upload-placeholder').innerHTML = defaultPlaceholderHTML;
  document.getElementById('form-ann-file').value = '';
  // Kategori radyo butonlarını ayarla
  setFormCategory(currentCategory);
  if (!id) {
    document.getElementById('form-ann-title').value = '';
    document.getElementById('form-ann-content').value = '';
    document.getElementById('form-ann-img').value = '';
    document.getElementById('form-ann-order').value = '1';
  }
}

function setFormCategory(cat) {
  document.querySelectorAll('.cat-opt').forEach(function(el) { el.classList.remove('active'); });
  var radios = document.querySelectorAll('input[name="ann-cat"]');
  radios.forEach(function(r) { r.checked = (r.value === cat); });
  var opt = document.getElementById('opt-' + cat);
  if (opt) opt.classList.add('active');
}

// Radyo buton tıklama dinle
document.addEventListener('change', function(e) {
  if (e.target.name === 'ann-cat') {
    document.querySelectorAll('.cat-opt').forEach(function(el) { el.classList.remove('active'); });
    e.target.closest('.cat-opt').classList.add('active');
  }
});

async function editAnn(id) {
  var d = (await db.collection('announcements').doc(id).get()).data();
  showAnnForm(id);
  document.getElementById('form-ann-title').value = d.title;
  document.getElementById('form-ann-content').value = d.content || '';
  document.getElementById('form-ann-img').value = d.imageUrl || '';
  document.getElementById('form-ann-order').value = d.order || 1;
  setFormCategory(d.category || 'kampanya');
  if (d.imageUrl) {
    document.getElementById('upload-preview-img').src = d.imageUrl;
    document.getElementById('upload-preview').style.display = 'block';
    document.getElementById('upload-placeholder').style.display = 'none';
  }
}

async function saveAnn() {
  var t = document.getElementById('form-ann-title').value.trim();
  var c = document.getElementById('form-ann-content').value.trim();
  var urlImg = document.getElementById('form-ann-img').value.trim();
  var o = parseInt(document.getElementById('form-ann-order').value) || 1;
  var cat = document.querySelector('input[name="ann-cat"]:checked');
  var category = cat ? cat.value : currentCategory;
  var errEl = document.getElementById('ann-save-error');
  errEl.style.display = 'none';

  if (!t) { errEl.textContent = 'Başlık zorunludur.'; errEl.style.display = 'block'; return; }

  var btn = document.getElementById('btn-save-ann');
  btn.disabled = true; btn.textContent = 'Kaydediliyor...';

  var imageUrl = uploadedImageData || urlImg;

  if (imageUrl && imageUrl.indexOf('data:') === 0) {
    var sizeKB = Math.round(imageUrl.length * 0.75 / 1024);
    if (sizeKB > 900) {
      errEl.textContent = 'Görsel çok büyük (' + sizeKB + ' KB). Daha küçük görsel kullanın veya URL ekleyin.';
      errEl.style.display = 'block';
      btn.disabled = false; btn.textContent = 'Kaydet';
      return;
    }
  }

  var data = { marketId: marketId, title: t, content: c, imageUrl: imageUrl || '', order: o, active: true, category: category };

  try {
    if (editingAnnId) {
      await db.collection('announcements').doc(editingAnnId).update(data);
    } else {
      data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      await db.collection('announcements').add(data);
    }
    cancelAnnForm();
  } catch(e) {
    var msg = 'Kayıt hatası: ';
    if (e.message && e.message.indexOf('exceeds') > -1) msg += 'Görsel çok büyük.';
    else msg += e.message || 'Bilinmeyen hata';
    errEl.textContent = msg; errEl.style.display = 'block';
  }
  btn.disabled = false; btn.textContent = 'Kaydet';
}

function cancelAnnForm() {
  document.getElementById('ann-form').style.display = 'none';
  editingAnnId = null;
  uploadedImageData = null;
}
async function toggleAnn(id, active) { await db.collection('announcements').doc(id).update({ active: active }); }
async function deleteAnn(id) { if (confirm('Bu içerik silinsin mi?')) await db.collection('announcements').doc(id).delete(); }

// ─── Ayarlar ──────────────────────────────────────────
async function saveSettings() {
  var name = document.getElementById('settings-name').value.trim();
  var pin = document.getElementById('settings-pin').value.trim();
  var logo = document.getElementById('settings-logo').value.trim();
  var thanks = document.getElementById('settings-thanks').value.trim();
  var u = {};
  if (name) u.name = name; if (pin && pin.length >= 4) u.kasiyerPin = pin;
  if (logo !== undefined) u.logoUrl = logo; if (thanks) u.thanksMessage = thanks;
  if (!Object.keys(u).length) { alert('Değişiklik yok.'); return; }
  await db.collection('markets').doc(marketId).update(u);
  if (u.name) { marketData.name = u.name; document.getElementById('panel-market-name').textContent = u.name; }
  alert('Kaydedildi.');
}

// ─── QR ───────────────────────────────────────────────
var qrInstance = null;
function getBaseUrl() { return window.location.origin + '/'; }
function buildQR() {
  if (!marketId) return;
  var base = getBaseUrl(); var url = base + 'musteri.html?market=' + marketId;
  document.getElementById('qr-url-display').textContent = url;
  var c = document.getElementById('qr-container'); c.innerHTML = '';
  qrInstance = new QRCode(c, { text: url, width: 200, height: 200, colorDark: '#0f172a', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.H });
  buildKasiyerLinks(base);
}

function buildKasiyerLinks(base) {
  var kc = document.getElementById('kasiyer-links');
  if (!kc || !marketData) return;
  kc.innerHTML = '';
  var count = marketData.kasaSayisi || 0;
  for (var i = 1; i <= count; i++) {
    kc.innerHTML += '<div class="url-row" style="margin-bottom:10px"><label>Kasa ' + i + ':</label><code style="font-size:12px;word-break:break-all">' + (base || getBaseUrl()) + 'kasiyer.html?market=' + marketId + '&kasa=' + i + '</code></div>';
  }
  if (count === 0) {
    kc.innerHTML = '<p style="color:var(--text2);font-size:13px">Henüz kasa eklenmemiş. Dashboard\'dan kasa ekleyin.</p>';
  }
}
function downloadQR() { var c = document.querySelector('#qr-container canvas'); if (!c) { alert('Önce QR sayfasını açın.'); return; } var a = document.createElement('a'); a.download = 'marketpas-qr.png'; a.href = c.toDataURL('image/png'); a.click(); }
function printQR() { var c = document.querySelector('#qr-container canvas'); if (!c) return; var w = window.open(''); w.document.write('<html><body style="text-align:center;padding:40px;font-family:sans-serif"><h2>' + escapeHtml(marketData?.name || 'Market') + '</h2><p style="color:#666;margin:16px 0">Sıra almak için QR kodu okutun</p><img src="' + c.toDataURL() + '" style="width:250px"><p style="margin-top:20px;font-size:13px;color:#666">MarketPas</p></body></html>'); w.document.close(); setTimeout(function() { w.print(); }, 500); }

// ─── Navigasyon ──────────────────────────────────────
function showSection(name) {
  document.querySelectorAll('.section').forEach(function(s) { s.classList.remove('active'); });
  document.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });
  // Mobil bottom nav
  document.querySelectorAll('.mnav-item').forEach(function(n) { n.classList.remove('active'); });
  var sec = document.getElementById('section-' + name); var nav = document.getElementById('nav-' + name);
  var mnav = document.getElementById('mnav-' + name);
  if (sec) sec.classList.add('active'); if (nav) nav.classList.add('active');
  if (mnav) mnav.classList.add('active');
  if (name === 'qr' && marketId) setTimeout(buildQR, 100);
  if (name === 'reports' && marketId) setTimeout(loadReport, 100);
  if (name === 'settings' && marketData) {
    document.getElementById('settings-name').value = marketData.name || '';
    document.getElementById('settings-logo').value = marketData.logoUrl || '';
    document.getElementById('settings-thanks').value = marketData.thanksMessage || '';
    document.getElementById('settings-pin').value = '';
    loadPwaIconPreview();
    loadWelcomeImagePreview();
  }
  // Mobil sidebar açıksa kapat
  closeMobileSidebar();
}

// ─── Mobil Sidebar ───────────────────────────────────
function toggleMobileSidebar() {
  var sb = document.getElementById('sidebar');
  var ov = document.getElementById('sidebar-overlay');
  if (sb.classList.contains('open')) {
    closeMobileSidebar();
  } else {
    sb.classList.add('open');
    ov.classList.add('show');
  }
}
function closeMobileSidebar() {
  var sb = document.getElementById('sidebar');
  var ov = document.getElementById('sidebar-overlay');
  if (sb) sb.classList.remove('open');
  if (ov) ov.classList.remove('show');
}

// ─── PWA İkon Yönetimi ───────────────────────────────
function loadPwaIconPreview() {
  var iconUrl = marketData.pwaIconUrl || '';
  var imgEl = document.getElementById('pwa-icon-img');
  var emptyEl = document.getElementById('pwa-icon-empty');
  var infoEl = document.getElementById('pwa-icon-info');
  var removeBtn = document.getElementById('btn-remove-icon');
  var simIcon = document.getElementById('pwa-sim-icon');
  var simName = document.getElementById('pwa-sim-name');

  if (simName) simName.textContent = (marketData.name || 'Market').substring(0, 10);

  if (iconUrl) {
    if (imgEl) { imgEl.src = iconUrl; imgEl.style.display = 'block'; }
    if (emptyEl) emptyEl.style.display = 'none';
    if (infoEl) infoEl.textContent = 'Özel ikon tanımlı. Müşteriler bu ikonu görecek.';
    if (removeBtn) removeBtn.style.display = 'inline-block';
    if (simIcon) simIcon.innerHTML = '<img src="' + iconUrl + '" alt="">';
  } else {
    if (imgEl) imgEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'block';
    if (infoEl) infoEl.textContent = 'Henüz özel ikon tanımlanmamış. Varsayılan MarketPas ikonu kullanılıyor.';
    if (removeBtn) removeBtn.style.display = 'none';
    if (simIcon) simIcon.innerHTML = '<div style="font-size:20px">🛒</div>';
  }
}

function handlePwaIconUpload(input) {
  var file = input.files[0];
  if (!file) return;
  if (!file.type.match(/image\/(png|jpeg|webp)/)) { alert('PNG, JPG veya WebP yükleyin.'); input.value = ''; return; }

  // 192x192'ye sıkıştır
  compressImage(file, 192, 0.85, function(dataUrl) {
    var sizeKB = Math.round(dataUrl.length * 0.75 / 1024);
    if (sizeKB > 200) {
      compressImage(file, 192, 0.5, function(smallUrl) { savePwaIcon(smallUrl); });
    } else {
      savePwaIcon(dataUrl);
    }
  });
  input.value = '';
}

async function savePwaIcon(dataUrl) {
  try {
    await db.collection('markets').doc(marketId).update({ pwaIconUrl: dataUrl });
    marketData.pwaIconUrl = dataUrl;
    loadPwaIconPreview();
  } catch(e) { alert('İkon kayıt hatası: ' + e.message); }
}

async function savePwaIconUrl() {
  var url = document.getElementById('pwa-icon-url').value.trim();
  if (!url) { alert('URL girin.'); return; }
  try {
    await db.collection('markets').doc(marketId).update({ pwaIconUrl: url });
    marketData.pwaIconUrl = url;
    loadPwaIconPreview();
    document.getElementById('pwa-icon-url').value = '';
  } catch(e) { alert('Kayıt hatası: ' + e.message); }
}

async function removePwaIcon() {
  if (!confirm('Özel ikon kaldırılsın mı? Varsayılan ikon kullanılacak.')) return;
  try {
    await db.collection('markets').doc(marketId).update({ pwaIconUrl: '' });
    marketData.pwaIconUrl = '';
    loadPwaIconPreview();
  } catch(e) { alert('Hata: ' + e.message); }
}

// ─── Karşılama Görseli Yönetimi ──────────────────────
function loadWelcomeImagePreview() {
  var imgUrl = marketData.welcomeImageUrl || '';
  var imgEl = document.getElementById('welcome-img-thumb');
  var emptyEl = document.getElementById('welcome-img-empty');
  var infoEl = document.getElementById('welcome-img-info');
  var removeBtn = document.getElementById('btn-remove-welcome');

  if (imgUrl) {
    if (imgEl) { imgEl.src = imgUrl; imgEl.style.display = 'block'; }
    if (emptyEl) emptyEl.style.display = 'none';
    if (infoEl) infoEl.textContent = 'Karşılama görseli tanımlı. QR okutulduğunda bu görsel gösterilecek.';
    if (removeBtn) removeBtn.style.display = 'inline-block';
  } else {
    if (imgEl) imgEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'block';
    if (infoEl) infoEl.textContent = 'Henüz karşılama görseli tanımlanmamış. Varsayılan koyu gradient kullanılıyor.';
    if (removeBtn) removeBtn.style.display = 'none';
  }
}

function handleWelcomeImageUpload(input) {
  var file = input.files[0];
  if (!file) return;
  if (!file.type.match(/image\/(png|jpeg|webp)/)) { alert('PNG, JPG veya WebP yükleyin.'); input.value = ''; return; }
  compressImage(file, 800, 0.5, function(dataUrl) {
    var sizeKB = Math.round(dataUrl.length * 0.75 / 1024);
    if (sizeKB > 700) {
      compressImage(file, 600, 0.35, function(smallUrl) { saveWelcomeImage(smallUrl); });
    } else {
      saveWelcomeImage(dataUrl);
    }
  });
  input.value = '';
}

async function saveWelcomeImage(dataUrl) {
  try {
    await db.collection('markets').doc(marketId).update({ welcomeImageUrl: dataUrl });
    marketData.welcomeImageUrl = dataUrl;
    loadWelcomeImagePreview();
  } catch(e) { alert('Görsel kayıt hatası: ' + e.message); }
}

async function saveWelcomeImageUrl() {
  var url = document.getElementById('welcome-img-url').value.trim();
  if (!url) { alert('URL girin.'); return; }
  try {
    await db.collection('markets').doc(marketId).update({ welcomeImageUrl: url });
    marketData.welcomeImageUrl = url;
    loadWelcomeImagePreview();
    document.getElementById('welcome-img-url').value = '';
  } catch(e) { alert('Kayıt hatası: ' + e.message); }
}

async function removeWelcomeImage() {
  if (!confirm('Karşılama görseli kaldırılsın mı?')) return;
  try {
    await db.collection('markets').doc(marketId).update({ welcomeImageUrl: '' });
    marketData.welcomeImageUrl = '';
    loadWelcomeImagePreview();
  } catch(e) { alert('Hata: ' + e.message); }
}

function handleLogout() {
  if (!confirm('Çıkış?')) return;
  localStorage.removeItem('mp_market_id');
  localStorage.removeItem('mp_market_email');
  window.location.href = '/';
}

// ═══════════════════════════════════════════════════════
// GÜNLÜK RAPOR
// ═══════════════════════════════════════════════════════

var hourlyChartInstance = null;
var kasaChartInstance = null;

async function loadReport() {
  try {
    var today = new Date(); today.setHours(0,0,0,0);
    var todayTs = firebase.firestore.Timestamp.fromDate(today);

    // Bugünkü tüm kuyruk kayıtları
    var allSnap = await db.collection('queue')
      .where('marketId', '==', marketId)
      .where('createdAt', '>=', todayTs)
      .get();

    var allRecords = [];
    allSnap.forEach(function(doc) { allRecords.push(Object.assign({ id: doc.id }, doc.data())); });

    // Durumlara göre ayır
    var activeStatuses = ['waiting','priority','priority_ready','called','arrived','active'];
    var doneRecords = allRecords.filter(function(r) { return r.status === 'done'; });
    var timeoutRecords = allRecords.filter(function(r) { return r.status === 'timeout'; });
    var currentInMarket = allRecords.filter(function(r) { return activeStatuses.indexOf(r.status) > -1; });

    // ─── 1. Ayrılan Müşteri ───
    document.getElementById('rp-left').textContent = doneRecords.length;

    // ─── 3. Toplam Müşteri ───
    document.getElementById('rp-total').textContent = allRecords.length;

    // ─── 4-6. Kalış Süreleri ───
    var stayTimes = [];
    doneRecords.forEach(function(r) {
      if (r.createdAt && r.completedAt) {
        var start = r.createdAt.toDate ? r.createdAt.toDate() : new Date(r.createdAt);
        var end = r.completedAt.toDate ? r.completedAt.toDate() : new Date(r.completedAt);
        var diff = end.getTime() - start.getTime();
        if (diff > 0 && diff < 4 * 60 * 60 * 1000) stayTimes.push(diff); // max 4 saat mantıklı
      }
    });

    if (stayTimes.length > 0) {
      var totalStay = stayTimes.reduce(function(a,b) { return a + b; }, 0);
      var avgStay = totalStay / stayTimes.length;
      var longest = Math.max.apply(null, stayTimes);
      var shortest = Math.min.apply(null, stayTimes);

      document.getElementById('rp-avg-stay').textContent = formatDuration(avgStay);
      document.getElementById('rp-longest').textContent = formatDuration(longest);
      document.getElementById('rp-longest-sub').textContent = 'QR okutma → ödeme arası';
      document.getElementById('rp-shortest').textContent = formatDuration(shortest);
      document.getElementById('rp-shortest-sub').textContent = 'QR okutma → ödeme arası';
    } else {
      document.getElementById('rp-avg-stay').textContent = '—';
      document.getElementById('rp-longest').textContent = '—';
      document.getElementById('rp-longest-sub').textContent = 'Henüz veri yok';
      document.getElementById('rp-shortest').textContent = '—';
      document.getElementById('rp-shortest-sub').textContent = 'Henüz veri yok';
    }

    // ─── 7. En Yoğun Saat ───
    var hourCounts = {};
    allRecords.forEach(function(r) {
      if (r.createdAt) {
        var d = r.createdAt.toDate ? r.createdAt.toDate() : new Date(r.createdAt);
        var h = d.getHours();
        hourCounts[h] = (hourCounts[h] || 0) + 1;
      }
    });

    var peakHour = null; var peakCount = 0;
    for (var h in hourCounts) {
      if (hourCounts[h] > peakCount) { peakCount = hourCounts[h]; peakHour = parseInt(h); }
    }

    if (peakHour !== null) {
      document.getElementById('rp-peak-hour').textContent = padHour(peakHour) + ' - ' + padHour(peakHour + 1);
      document.getElementById('rp-peak-sub').textContent = peakCount + ' müşteri';
    } else {
      document.getElementById('rp-peak-hour').textContent = '—';
      document.getElementById('rp-peak-sub').textContent = 'Henüz veri yok';
    }

    // ─── 8. Timeout Oranı ───
    var totalProcessed = doneRecords.length + timeoutRecords.length;
    var timeoutRate = totalProcessed > 0 ? Math.round((timeoutRecords.length / totalProcessed) * 100) : 0;
    document.getElementById('rp-timeout-rate').textContent = '%' + timeoutRate;

    // ─── 9. Saat Bazlı Grafik ───
    renderHourlyChart(hourCounts);

    // ─── 10. Kasa Bazlı Dağılım ───
    await renderKasaChart(doneRecords);

    // Güncelleme zamanı
    document.getElementById('report-updated').textContent = 'Son güncelleme: ' + new Date().toLocaleTimeString('tr-TR');

  } catch(e) { console.error('Rapor yükleme hatası:', e); }
}

// ─── Süre Formatlama (dk sn) ─────────────────────────
function formatDuration(ms) {
  if (!ms || ms <= 0) return '—';
  var totalSec = Math.round(ms / 1000);
  var min = Math.floor(totalSec / 60);
  var sec = totalSec % 60;
  if (min >= 60) {
    var hr = Math.floor(min / 60);
    min = min % 60;
    return hr + ' sa ' + min + ' dk';
  }
  return min + ' dk ' + sec + ' sn';
}

function padHour(h) {
  h = h % 24;
  return (h < 10 ? '0' : '') + h + ':00';
}

// ─── Saat Bazlı Çubuk Grafik ────────────────────────
function renderHourlyChart(hourCounts) {
  var ctx = document.getElementById('hourly-chart');
  if (!ctx) return;

  // 07:00 - 23:00 arası saatler
  var labels = [];
  var data = [];
  var bgColors = [];
  var borderColors = [];

  // Neon renk paleti (saate göre döner)
  var neonColors = [
    { bg: 'rgba(45,212,191,.2)', border: '#2DD4BF' },   // teal
    { bg: 'rgba(74,222,128,.2)', border: '#4ADE80' },    // green
    { bg: 'rgba(96,165,250,.2)', border: '#60A5FA' },    // blue
    { bg: 'rgba(251,146,60,.2)', border: '#FB923C' },    // orange
    { bg: 'rgba(167,139,250,.2)', border: '#A78BFA' },   // purple
    { bg: 'rgba(244,114,182,.2)', border: '#F472B6' },   // pink
    { bg: 'rgba(251,191,36,.2)', border: '#FBBF24' },    // yellow
    { bg: 'rgba(248,113,113,.2)', border: '#F87171' }    // red
  ];

  for (var h = 7; h <= 23; h++) {
    labels.push(padHour(h));
    data.push(hourCounts[h] || 0);
    var ci = (h - 7) % neonColors.length;
    bgColors.push(neonColors[ci].bg);
    borderColors.push(neonColors[ci].border);
  }

  if (hourlyChartInstance) hourlyChartInstance.destroy();

  hourlyChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Müşteri Sayısı',
        data: data,
        backgroundColor: bgColors,
        borderColor: borderColors,
        borderWidth: 2,
        borderRadius: 8,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0F172A',
          titleFont: { family: 'Outfit', weight: '600' },
          bodyFont: { family: 'Outfit' },
          padding: 12,
          cornerRadius: 8,
          callbacks: {
            label: function(ctx) { return ctx.parsed.y + ' müşteri'; }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1, font: { family: 'Outfit', size: 12 }, color: '#94A3B8' },
          grid: { color: 'rgba(0,0,0,.04)' }
        },
        x: {
          ticks: { font: { family: 'Outfit', size: 11 }, color: '#94A3B8' },
          grid: { display: false }
        }
      }
    }
  });
}

// ─── Kasa Bazlı Grafik ──────────────────────────────
async function renderKasaChart(doneRecords) {
  var ctx = document.getElementById('kasa-chart');
  if (!ctx) return;

  var kasaData = {};
  doneRecords.forEach(function(r) {
    var kNo = r.kasaNo;
    if (!kNo) return;
    if (!kasaData[kNo]) kasaData[kNo] = { count: 0, totalTime: 0 };
    kasaData[kNo].count++;
    if (r.arrivedAt && r.completedAt) {
      var a = r.arrivedAt.toDate ? r.arrivedAt.toDate() : new Date(r.arrivedAt);
      var c = r.completedAt.toDate ? r.completedAt.toDate() : new Date(r.completedAt);
      var pt = c.getTime() - a.getTime();
      if (pt > 0 && pt < 1800000) kasaData[kNo].totalTime += pt;
    }
  });

  var keys = Object.keys(kasaData).sort(function(a,b) { return parseInt(a) - parseInt(b); });

  var labels = keys.map(function(k) { return 'Kasa ' + k; });
  var counts = keys.map(function(k) { return kasaData[k].count; });
  var avgTimes = keys.map(function(k) {
    return kasaData[k].count > 0 ? Math.round(kasaData[k].totalTime / kasaData[k].count / 60000 * 10) / 10 : 0;
  });

  var neonBg = ['rgba(74,222,128,.2)','rgba(96,165,250,.2)','rgba(251,146,60,.2)','rgba(167,139,250,.2)','rgba(244,114,182,.2)','rgba(45,212,191,.2)','rgba(251,191,36,.2)','rgba(248,113,113,.2)'];
  var neonBorder = ['#4ADE80','#60A5FA','#FB923C','#A78BFA','#F472B6','#2DD4BF','#FBBF24','#F87171'];

  if (kasaChartInstance) kasaChartInstance.destroy();

  kasaChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Müşteri Sayısı',
          data: counts,
          backgroundColor: keys.map(function(_,i) { return neonBg[i % neonBg.length]; }),
          borderColor: keys.map(function(_,i) { return neonBorder[i % neonBorder.length]; }),
          borderWidth: 2, borderRadius: 8, borderSkipped: false,
          yAxisID: 'y'
        },
        {
          label: 'Ort. İşlem (dk)',
          data: avgTimes,
          type: 'line',
          borderColor: '#A78BFA',
          backgroundColor: 'rgba(167,139,250,.1)',
          borderWidth: 3,
          pointBackgroundColor: '#7C3AED',
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
          pointRadius: 5,
          tension: 0.3,
          fill: true,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'top',
          labels: { font: { family: 'Outfit', size: 12 }, padding: 16, usePointStyle: true, pointStyleWidth: 12 }
        },
        tooltip: {
          backgroundColor: '#0F172A',
          titleFont: { family: 'Outfit', weight: '600' },
          bodyFont: { family: 'Outfit' },
          padding: 12, cornerRadius: 8
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          position: 'left',
          title: { display: true, text: 'Müşteri', font: { family: 'Outfit', size: 12 }, color: '#94A3B8' },
          ticks: { stepSize: 1, font: { family: 'Outfit', size: 12 }, color: '#94A3B8' },
          grid: { color: 'rgba(0,0,0,.04)' }
        },
        y1: {
          beginAtZero: true,
          position: 'right',
          title: { display: true, text: 'Ort. dk', font: { family: 'Outfit', size: 12 }, color: '#A78BFA' },
          ticks: { font: { family: 'Outfit', size: 12 }, color: '#A78BFA' },
          grid: { display: false }
        },
        x: {
          ticks: { font: { family: 'Outfit', size: 12 }, color: '#94A3B8' },
          grid: { display: false }
        }
      }
    }
  });
}

if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(function(){});
document.addEventListener('DOMContentLoaded', init);
