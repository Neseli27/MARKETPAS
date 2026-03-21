// =====================================================
// MarketPas v2.3 — Müşteri Sayfası
// =====================================================

var marketId = null;
var sessionId = null;
var market = null;
var queueListener = null;
var myQueueData = null;
var countdownInterval = null;
var announcementInterval = null;
var statsInterval = null;
var announcements = [];
var annIndex = 0;
var notifiedForThisCall = false;
var currentStats = null;

// ─── Bildirim ─────────────────────────────────────────
async function requestNotificationPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') await Notification.requestPermission();
}

function notifyCustomer(code, kasaNo) {
  if (navigator.vibrate) navigator.vibrate([300, 100, 300, 100, 500]);
  try {
    var ctx = new (window.AudioContext || window.webkitAudioContext)();
    var osc = ctx.createOscillator(); var gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880; gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.5);
  } catch(e) {}
  if (Notification.permission === 'granted' && document.hidden) {
    new Notification('Sıranız Geldi!', {
      body: 'Kodunuz: ' + code + ' — Kasa ' + kasaNo + "'e gidiniz",
      icon: '/icon-192.png', tag: 'marketpas-queue', requireInteraction: true
    });
  }
}

// ─── Başlangıç ────────────────────────────────────────
function init() {
  var params = new URLSearchParams(window.location.search);
  marketId = params.get('market');
  if (!marketId) { showError('Geçersiz QR kod. Lütfen marketteki QR kodu okutun.'); return; }

  sessionId = localStorage.getItem('mp_s_' + marketId);
  if (!sessionId) { sessionId = generateId(); localStorage.setItem('mp_s_' + marketId, sessionId); }

  loadMarket();
}

async function loadMarket() {
  showLoading(true);
  try {
    var doc = await db.collection('markets').doc(marketId).get();
    if (!doc.exists) { showError('Market bulunamadı.'); return; }
    market = doc.data();
    applyMarketBranding();
    loadAnnouncements();
    loadCongestion(); // Yoğunluk bilgisini yükle
    checkExistingQueue();
    requestNotificationPermission();
    // Yoğunluk bilgisini periyodik güncelle
    statsInterval = setInterval(loadCongestion, 15000);
  } catch (e) {
    showError('Bağlantı hatası. Sayfayı yenileyin.');
  } finally {
    showLoading(false);
  }
}

function applyMarketBranding() {
  document.getElementById('market-name').textContent = market.name;
  document.title = market.name + ' — Sıra';
  if (market.logoUrl) {
    var img = document.getElementById('market-logo');
    img.src = market.logoUrl; img.style.display = 'block';
  }
}

// ─── Yoğunluk Bilgisi ────────────────────────────────
async function loadCongestion() {
  try {
    currentStats = await getMarketStats(marketId);
    renderCongestion(currentStats);
    updateWaitEstimate(currentStats);
  } catch(e) {}
}

function renderCongestion(stats) {
  var dot = document.getElementById('cg-dot');
  var label = document.getElementById('cg-label');
  var fill = document.getElementById('cg-fill');
  var info = document.getElementById('cg-info');
  if (!dot || !label || !fill || !info) return;

  var level = stats.congestionLevel;
  var pct = stats.congestionPercent;

  // Dot rengi
  dot.className = 'cg-dot ' + level;
  fill.className = 'cg-fill ' + level;
  fill.style.width = pct + '%';

  // Label
  if (level === 'sakin') label.textContent = '🟢 Sakin — Kasalar müsait';
  else if (level === 'normal') label.textContent = '🟡 Normal — Biraz bekleme olabilir';
  else label.textContent = '🔴 Yoğun — Kasalar meşgul (%' + pct + ')';

  // Alt bilgi
  var parts = [];
  parts.push(stats.activeCasas + ' kasa açık');
  if (stats.waitingCount > 0) parts.push(stats.waitingCount + ' kişi sırada');
  if (stats.avgProcessTime > 0 && stats.activeCasas > 0) {
    parts.push('ort. işlem ' + formatWaitTime(stats.avgProcessTime));
  }
  info.textContent = parts.join(' · ');
}

function updateWaitEstimate(stats) {
  var el = document.getElementById('wait-estimate');
  var display = document.getElementById('wait-time-display');
  if (!el || !display) return;

  // Sadece kuyrukta ekranındayken göster
  var queuedScreen = document.getElementById('screen-queued');
  if (!queuedScreen || !queuedScreen.classList.contains('active')) return;

  if (stats && stats.estimatedWait > 0) {
    display.textContent = formatWaitTime(stats.estimatedWait);
    el.style.display = 'flex';
  } else if (stats && stats.waitingCount === 0) {
    display.textContent = 'Hemen';
    el.style.display = 'flex';
  }
}

// ─── Duyurular ────────────────────────────────────────
function loadAnnouncements() {
  db.collection('announcements')
    .where('marketId', '==', marketId).where('active', '==', true)
    .orderBy('order', 'asc')
    .onSnapshot(function(snap) {
      announcements = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
      renderAnnouncements();
    });
}

function renderAnnouncements() {
  var section = document.getElementById('ann-section');
  var slider = document.getElementById('ann-slider');
  var dotsEl = document.getElementById('ann-dots');
  if (!announcements.length) { section.classList.add('empty'); return; }
  section.classList.remove('empty');
  slider.innerHTML = ''; dotsEl.innerHTML = '';

  announcements.forEach(function(a, i) {
    var slide = document.createElement('div');
    slide.className = 'ann-slide' + (a.imageUrl ? '' : ' no-img') + (i === 0 ? ' active' : '');
    var textDiv = document.createElement('div'); textDiv.className = 'ann-slide-text';
    var badge = document.createElement('div'); badge.className = 'ann-slide-badge'; badge.textContent = '🏷️ Kampanya'; textDiv.appendChild(badge);
    var titleEl = document.createElement('div'); titleEl.className = 'ann-slide-title'; titleEl.textContent = a.title; textDiv.appendChild(titleEl);
    if (a.content) { var contentEl = document.createElement('div'); contentEl.className = 'ann-slide-content'; contentEl.textContent = a.content; textDiv.appendChild(contentEl); }
    if (a.imageUrl) { var img = document.createElement('img'); img.className = 'ann-slide-img has-img'; img.src = a.imageUrl; img.alt = ''; img.onerror = function() { this.style.display = 'none'; }; slide.appendChild(img); }
    slide.appendChild(textDiv); slider.appendChild(slide);
    var dot = document.createElement('div'); dot.className = 'ann-dot' + (i === 0 ? ' active' : ''); dotsEl.appendChild(dot);
  });

  annIndex = 0; clearInterval(announcementInterval);
  if (announcements.length > 1) {
    announcementInterval = setInterval(function() {
      annIndex = (annIndex + 1) % announcements.length;
      document.querySelectorAll('.ann-slide').forEach(function(s, idx) { s.classList.toggle('active', idx === annIndex); });
      document.querySelectorAll('.ann-dot').forEach(function(d, idx) { d.classList.toggle('active', idx === annIndex); });
    }, 5000);
  }
}

// ─── Mevcut sıra kontrolü ────────────────────────────
async function checkExistingQueue() {
  try {
    var doc = await db.collection('queue').doc(sessionId).get();
    if (doc.exists) {
      var status = doc.data().status;
      if (['waiting', 'priority', 'priority_ready', 'called', 'arrived', 'active'].includes(status)) {
        startQueueListener(); return;
      }
    }
    newSession(); showScreen('ready');
  } catch(e) { showScreen('ready'); }
}

// ─── Firestore dinleyici ─────────────────────────────
function startQueueListener() {
  if (queueListener) queueListener();
  queueListener = db.collection('queue').doc(sessionId).onSnapshot(function(doc) {
    if (!doc.exists) { showScreen('ready'); return; }
    myQueueData = doc.data();
    var status = myQueueData.status;

    switch (status) {
      case 'waiting': case 'priority': case 'priority_ready':
        showScreen('queued');
        // Tahmini süreyi göster
        if (currentStats) updateWaitEstimate(currentStats);
        break;

      case 'called':
        showScreen('called');
        document.getElementById('called-code').textContent = myQueueData.code || '---';
        document.getElementById('called-kasa').textContent = 'Kasa ' + (myQueueData.kasaNo || '—');
        startCountdown(myQueueData.calledAt?.toDate() || new Date());
        if (!notifiedForThisCall) { notifyCustomer(myQueueData.code, myQueueData.kasaNo); notifiedForThisCall = true; }
        break;

      case 'arrived':
        clearInterval(countdownInterval); notifiedForThisCall = false;
        showScreen('arrived');
        break;

      case 'active':
        clearInterval(countdownInterval); notifiedForThisCall = false;
        showScreen('active');
        break;

      case 'timeout':
        clearInterval(countdownInterval); notifiedForThisCall = false;
        showScreen('timeout');
        break;

      case 'done':
        clearInterval(countdownInterval); notifiedForThisCall = false;
        document.getElementById('thanks-title').textContent = 'Teşekkürler! 🛍️';
        document.getElementById('thanks-sub').textContent = market?.thanksMessage || 'Alışverişiniz için teşekkür ederiz. İyi günler!';
        showScreen('thanks');
        setTimeout(function() { newSession(); showScreen('ready'); }, 5000);
        break;

      case 'cancelled':
        clearInterval(countdownInterval); notifiedForThisCall = false;
        newSession(); showScreen('ready');
        break;

      default: showScreen('ready');
    }
  });
}

// ─── Geri sayım ──────────────────────────────────────
function startCountdown(calledAt) {
  clearInterval(countdownInterval);
  var totalMs = 2 * 60 * 1000;
  function tick() {
    var left = totalMs - (Date.now() - calledAt.getTime());
    if (left <= 0) { document.getElementById('countdown').textContent = '0:00'; clearInterval(countdownInterval); return; }
    var s = Math.ceil(left / 1000);
    document.getElementById('countdown').textContent = Math.floor(s / 60) + ':' + (s % 60).toString().padStart(2, '0');
  }
  tick(); countdownInterval = setInterval(tick, 500);
}

// ─── Sıra Al ─────────────────────────────────────────
async function handleQueueButton() {
  var btn = document.getElementById('btn-queue');
  btn.disabled = true; btn.textContent = 'Sıraya alınıyor...';
  try {
    var num = await getNextQueueNumber(marketId);
    await db.collection('queue').doc(sessionId).set({
      marketId: marketId, sessionId: sessionId, queueNumber: num,
      status: 'waiting', code: null, registerId: null, kasaNo: null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      calledAt: null, arrivedAt: null, completedAt: null
    });
    notifiedForThisCall = false;
    startQueueListener();
    await tryAssignToOpenRegister();
    // Sıraya girdikten sonra süre bilgisini yenile
    await loadCongestion();
  } catch (e) {
    btn.disabled = false; btn.textContent = 'SIRA NUMARASI AL';
    alert('Bir hata oluştu. Tekrar deneyin.');
  }
}

async function tryAssignToOpenRegister() {
  try {
    var snap = await db.collection('registers').where('marketId', '==', marketId).where('active', '==', true).get();
    for (var i = 0; i < snap.docs.length; i++) {
      var d = snap.docs[i].data();
      if (!d.waitingQueueId) { await assignNextToRegister(marketId, snap.docs[i].id, d.kasaNo); break; }
    }
  } catch(e) {}
}

// ─── İptal ───────────────────────────────────────────
async function handleCancel() {
  if (!confirm('Sıranızı iptal etmek istiyor musunuz?')) return;
  try { await db.collection('queue').doc(sessionId).update({ status: 'cancelled' }); } catch(e) {}
  if (queueListener) queueListener();
  newSession(); showScreen('ready');
}

// ─── Ertele ──────────────────────────────────────────
async function handleErtele() {
  if (!myQueueData) return;
  var rid = myQueueData.registerId;
  await db.collection('queue').doc(sessionId).update({ status: 'priority', code: null, registerId: null, kasaNo: null, calledAt: null });
  if (rid) {
    await db.collection('registers').doc(rid).update({ waitingQueueId: null, waitingCode: null, calledAt: null });
    var regDoc = await db.collection('registers').doc(rid).get();
    if (regDoc.exists) await assignNextToRegister(marketId, rid, regDoc.data().kasaNo);
  }
}

// ─── Tekrar Sıra Al ─────────────────────────────────
async function handleRetryQueue() {
  var btn = document.getElementById('btn-retry'); btn.disabled = true;
  try {
    await db.collection('queue').doc(sessionId).update({ status: 'priority', calledAt: null, code: null, registerId: null, kasaNo: null });
    notifiedForThisCall = false; startQueueListener(); await tryAssignToOpenRegister();
  } catch (e) { btn.disabled = false; }
}

// ─── Yardımcılar ─────────────────────────────────────
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(function(s) { s.classList.remove('active'); });
  var el = document.getElementById('screen-' + name);
  if (el) el.classList.add('active');
  if (name === 'ready') { var btn = document.getElementById('btn-queue'); if (btn) { btn.disabled = false; btn.textContent = 'SIRA NUMARASI AL'; } }
  if (name === 'timeout') { var btn2 = document.getElementById('btn-retry'); if (btn2) btn2.disabled = false; }
  // Tahmini süreyi sadece kuyrukta ekranında göster
  var we = document.getElementById('wait-estimate');
  if (we) we.style.display = (name === 'queued' && currentStats && currentStats.estimatedWait > 0) ? 'flex' : 'none';
}

function showLoading(v) { var el = document.getElementById('loading'); if (el) el.style.display = v ? 'flex' : 'none'; }
function showError(msg) { document.body.innerHTML = '<div class="error-screen"><p>⚠️</p><p>' + escapeHtml(msg) + '</p></div>'; }

function newSession() {
  sessionId = generateId();
  localStorage.setItem('mp_s_' + marketId, sessionId);
  if (queueListener) { queueListener(); queueListener = null; }
  clearInterval(countdownInterval); notifiedForThisCall = false;
}

document.addEventListener('DOMContentLoaded', init);
