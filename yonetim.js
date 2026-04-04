// =====================================================
// MarketPas v3 — Yönetim Paneli
// =====================================================

var marketId = null;
var marketData = null;
var registersListener = null;
var queueListener = null;
var editingAnnId = null;
var congestionInterval = null;

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
  showSection('dashboard');
  startLiveListeners();
  loadAnnouncements();
  loadCongestionStats();
  congestionInterval = setInterval(loadCongestionStats, 10000);
  checkLicenseWarning();
  updateSidebarLicense();
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

  if (days <= 0) {
    el.className = 'sidebar-license expired';
    el.innerHTML = '<span>🚫</span><div><div>Lisans süresi dolmuş</div><div style="font-size:11px;opacity:.7;margin-top:2px">Bitiş: ' + expDate + '</div></div>';
  } else if (days <= 5) {
    el.className = 'sidebar-license warning';
    el.innerHTML = '<span>⚠️</span><div><span class="lic-days">' + days + ' gün</span> kaldı<div style="font-size:11px;opacity:.7;margin-top:2px">' + (marketData.licenseDays || '') + ' günlük plan · ' + expDate + '</div></div>';
  } else {
    el.className = 'sidebar-license active';
    el.innerHTML = '<span>✓</span><div><span class="lic-days">' + days + ' gün</span> kaldı<div style="font-size:11px;opacity:.7;margin-top:2px">' + (marketData.licenseDays || '') + ' günlük plan · ' + expDate + '</div></div>';
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
  registersListener = db.collection('registers').where('marketId', '==', marketId).orderBy('kasaNo', 'asc')
    .onSnapshot(function(snap) { renderRegisters(snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); })); });
  queueListener = db.collection('queue').where('marketId', '==', marketId).where('status', 'in', ['waiting', 'priority'])
    .onSnapshot(function(snap) { document.getElementById('queue-count').textContent = snap.size; });
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
    del.onclick = function() { mpConfirm('Kasa ' + r.kasaNo + ' silinsin mi?','🗑️').then(function(ok){if(ok)deleteKasa(r.id)}); };
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
  } catch(e) { mpAlert('Hata: ' + e.message,'❌'); }
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
    mpSuccess('Kasa ' + (max + 1) + ' eklendi.','🎉');
  } catch(e) { mpAlert('Hata: ' + e.message,'❌'); }
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
    var t2 = await db.collection('queue').where('marketId', '==', marketId).where('status', '==', 'done').get();
    var t3 = await db.collection('queue').where('marketId', '==', marketId).where('status', '==', 'timeout').where('createdAt', '>=', ts).get();
    document.getElementById('stat-today').textContent = t1.size;
    document.getElementById('stat-total').textContent = t2.size;
    document.getElementById('stat-timeout').textContent = t3.size;
  } catch(e) {}
}

// ─── Duyurular ───────────────────────────────────────
function loadAnnouncements() {
  db.collection('announcements').where('marketId', '==', marketId).orderBy('order', 'asc')
    .onSnapshot(function(snap) { renderAnnouncements(snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); })); });
}
function renderAnnouncements(list) {
  var c = document.getElementById('ann-list'); c.innerHTML = '';
  if (!list.length) { c.innerHTML = '<p class="empty-msg">Henüz duyuru yok.</p>'; return; }
  list.forEach(function(a) {
    c.innerHTML += '<div class="ann-card ' + (a.active ? 'ann-active' : 'ann-inactive') + '"><div class="ann-info"><div class="ann-title-text">' + escapeHtml(a.title) + '</div><div class="ann-content-text">' + escapeHtml(a.content || '') + '</div></div><div class="ann-actions"><button class="btn-sm ' + (a.active ? 'btn-warn' : 'btn-success') + '" onclick="toggleAnn(\'' + a.id + '\',' + !a.active + ')">' + (a.active ? 'Pasif' : 'Aktif') + '</button><button class="btn-sm btn-edit" onclick="editAnn(\'' + a.id + '\')">Düzenle</button><button class="btn-sm btn-del" onclick="deleteAnn(\'' + a.id + '\')">Sil</button></div></div>';
  });
}
// ─── Upload Handling ─────────────────────────────────
var uploadedImageData = null; // base64 data URL

function handleFileSelect(input) {
  var file = input.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { mpAlert('Dosya çok büyük. Maksimum 2MB.','⚠️'); input.value = ''; return; }
  if (!file.type.match(/image\/(jpeg|png|webp)/)) { mpAlert('Sadece JPG, PNG veya WebP yükleyebilirsiniz.','⚠️'); input.value = ''; return; }

  // Sıkıştır ve önizle
  compressImage(file, 1200, 0.8, function(dataUrl) {
    uploadedImageData = dataUrl;
    document.getElementById('upload-preview-img').src = dataUrl;
    document.getElementById('upload-preview').style.display = 'block';
    document.getElementById('upload-placeholder').style.display = 'none';
    document.getElementById('form-ann-img').value = ''; // URL alanını temizle
  });
}

function removeUpload() {
  uploadedImageData = null;
  document.getElementById('upload-preview').style.display = 'none';
  document.getElementById('upload-placeholder').style.display = 'block';
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
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      callback(canvas.toDataURL('image/jpeg', quality));
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// ─── Duyuru CRUD ─────────────────────────────────────
function showAnnForm(id) {
  editingAnnId = id || null;
  uploadedImageData = null;
  document.getElementById('ann-form').style.display = 'block';
  document.getElementById('ann-form-title').textContent = id ? 'Duyuru Düzenle' : 'Yeni Duyuru';
  document.getElementById('upload-preview').style.display = 'none';
  document.getElementById('upload-placeholder').style.display = 'block';
  document.getElementById('form-ann-file').value = '';
  // Özel kategori dropdown'ını doldur
  var sel = document.getElementById('form-custom-cat');
  if (sel) {
    sel.innerHTML = '<option value="">— Tümü (genel) —</option>';
    var cats = (marketData && marketData.categories) || [];
    cats.forEach(function(c) {
      var opt = document.createElement('option'); opt.value = c.name; opt.textContent = c.icon + ' ' + c.name;
      sel.appendChild(opt);
    });
  }
  // Sekme kategorisi sıfırla
  var radios = document.querySelectorAll('input[name="ann-cat"]');
  radios.forEach(function(r) { r.checked = r.value === 'anasayfa'; });
  document.querySelectorAll('.cat-opt').forEach(function(o) { o.classList.toggle('active', o.querySelector('input').value === 'anasayfa'); });
  if (!id) {
    document.getElementById('form-ann-title').value = '';
    document.getElementById('form-ann-content').value = '';
    document.getElementById('form-ann-img').value = '';
    document.getElementById('form-ann-order').value = '1';
    if (sel) sel.value = '';
  }
}

async function editAnn(id) {
  var d = (await db.collection('announcements').doc(id).get()).data();
  showAnnForm(id);
  document.getElementById('form-ann-title').value = d.title;
  document.getElementById('form-ann-content').value = d.content || '';
  document.getElementById('form-ann-img').value = d.imageUrl || '';
  document.getElementById('form-ann-order').value = d.order || 1;
  // Kategori yükle
  if (d.category) {
    var radios = document.querySelectorAll('input[name="ann-cat"]');
    radios.forEach(function(r) { r.checked = r.value === d.category; });
    document.querySelectorAll('.cat-opt').forEach(function(o) { o.classList.toggle('active', o.querySelector('input').value === d.category); });
  }
  var sel = document.getElementById('form-custom-cat');
  if (sel && d.customCategory) sel.value = d.customCategory;
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
  if (!t) { mpAlert('Başlık zorunludur.','⚠️'); return; }

  // Kategori bilgileri
  var catRadio = document.querySelector('input[name="ann-cat"]:checked');
  var category = catRadio ? catRadio.value : 'anasayfa';
  var customCat = document.getElementById('form-custom-cat').value || '';

  var btn = document.getElementById('btn-save-ann');
  btn.disabled = true; btn.textContent = 'Kaydediliyor...';

  var imageUrl = uploadedImageData || urlImg;
  var data = { marketId: marketId, title: t, content: c, imageUrl: imageUrl, order: o, active: true, category: category, customCategory: customCat };

  try {
    if (editingAnnId) {
      await db.collection('announcements').doc(editingAnnId).update(data);
    } else {
      data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      await db.collection('announcements').add(data);
    }
    cancelAnnForm();
  } catch(e) {
    mpAlert('Kayıt hatası: ' + e.message,'❌');
  }
  btn.disabled = false; btn.textContent = 'Kaydet';
}

function cancelAnnForm() {
  document.getElementById('ann-form').style.display = 'none';
  editingAnnId = null;
  uploadedImageData = null;
}
async function toggleAnn(id, active) { await db.collection('announcements').doc(id).update({ active: active }); }
async function deleteAnn(id) { var ok=await mpConfirm('Duyuru silinsin mi?','🗑️');if(ok) await db.collection('announcements').doc(id).delete(); }

// ─── Ayarlar ──────────────────────────────────────────
async function saveSettings() {
  var name = document.getElementById('settings-name').value.trim();
  var pin = document.getElementById('settings-pin').value.trim();
  var logo = document.getElementById('settings-logo').value.trim();
  var thanks = document.getElementById('settings-thanks').value.trim();
  var u = {};
  if (name) u.name = name; if (pin && pin.length >= 4) u.kasiyerPin = pin;
  if (logo !== undefined) u.logoUrl = logo; if (thanks) u.thanksMessage = thanks;
  if (!Object.keys(u).length) { mpAlert('Değişiklik yok.','ℹ️'); return; }
  await db.collection('markets').doc(marketId).update(u);
  if (u.name) { marketData.name = u.name; document.getElementById('panel-market-name').textContent = u.name; }
  mpSuccess('Ayarlar kaydedildi.','✅');
}

// ─── Kategori Butonları ──────────────────────────────
function loadCategories() {
  if (!marketData) return;
  var cats = marketData.categories || [];
  for (var i = 0; i < 4; i++) {
    var iconEl = document.getElementById('cat-icon-' + i);
    var nameEl = document.getElementById('cat-name-' + i);
    if (iconEl) iconEl.value = (cats[i] && cats[i].icon) || '';
    if (nameEl) nameEl.value = (cats[i] && cats[i].name) || '';
  }
}

async function saveCategories() {
  var cats = [];
  for (var i = 0; i < 4; i++) {
    var icon = document.getElementById('cat-icon-' + i).value.trim();
    var name = document.getElementById('cat-name-' + i).value.trim();
    if (name) cats.push({ icon: icon || '📁', name: name });
  }
  var msg = document.getElementById('cat-save-msg');
  if (!cats.length) { if (msg) { msg.textContent = '⚠️ En az bir kategori girin'; msg.style.color = '#F59E0B'; msg.style.display = 'inline'; } return; }
  try {
    await db.collection('markets').doc(marketId).update({ categories: cats });
    marketData.categories = cats;
    mpSuccess(cats.length + ' kategori kaydedildi.','✅');
  } catch (e) { mpAlert('Kayıt hatası: ' + e.message, '❌'); }
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
function downloadQR() { var c = document.querySelector('#qr-container canvas'); if (!c) { mpAlert('Önce QR sayfasını açın.','ℹ️'); return; } var a = document.createElement('a'); a.download = 'marketpas-qr.png'; a.href = c.toDataURL('image/png'); a.click(); }
function printQR() { var c = document.querySelector('#qr-container canvas'); if (!c) return; var w = window.open(''); w.document.write('<html><body style="text-align:center;padding:40px;font-family:sans-serif"><h2>' + escapeHtml(marketData?.name || 'Market') + '</h2><p style="color:#666;margin:16px 0">Sıra almak için QR kodu okutun</p><img src="' + c.toDataURL() + '" style="width:250px"><p style="margin-top:20px;font-size:13px;color:#666">MarketPas</p></body></html>'); w.document.close(); setTimeout(function() { w.print(); }, 500); }

// ─── Navigasyon ──────────────────────────────────────
function showSection(name) {
  document.querySelectorAll('.section').forEach(function(s) { s.classList.remove('active'); });
  document.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });
  var sec = document.getElementById('section-' + name); var nav = document.getElementById('nav-' + name);
  if (sec) sec.classList.add('active'); if (nav) nav.classList.add('active');
  if (name === 'qr' && marketId) setTimeout(buildQR, 100);
  if (name === 'settings' && marketData) {
    document.getElementById('settings-name').value = marketData.name || '';
    document.getElementById('settings-logo').value = marketData.logoUrl || '';
    document.getElementById('settings-thanks').value = marketData.thanksMessage || '';
    document.getElementById('settings-pin').value = '';
    loadCategories();
  }
}

async function handleLogout() {
  var ok = await mpConfirm('Çıkış yapmak istiyor musunuz?', '👋');
  if (!ok) return;
  localStorage.removeItem('mp_market_id');
  localStorage.removeItem('mp_market_email');
  window.location.href = '/';
}

document.addEventListener('DOMContentLoaded', init);
