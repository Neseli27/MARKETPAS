// =====================================================
// MarketPas v3.5 — Müşteri Sayfası
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
var isQueueMode = false;
var welcomeShown = false;
var WELCOME_DURATION = 12000; // 12 saniye

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
  var urlMarket = params.get('market');
  if (!urlMarket) { marketId = localStorage.getItem('mp_last_market'); }
  else { marketId = urlMarket; }
  if (!marketId) { showError('Lütfen marketteki QR kodu telefonunuzla okutun.'); return; }
  localStorage.setItem('mp_last_market', marketId);
  isQueueMode = !!urlMarket;
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

    if (isQueueMode) {
      // QR okutmuş — karşılama ekranı göster, sonra sıra moduna geç
      showWelcomeSplash(function() {
        enterQueueMode();
        loadCongestion();
        checkExistingQueue();
        requestNotificationPermission();
        statsInterval = setInterval(loadCongestion, 15000);
      });
    } else {
      // Vitrin modu — direkt reklamlar
      checkExistingQueueSilent();
    }
  } catch (e) {
    showError('Bağlantı hatası. Sayfayı yenileyin.');
  } finally {
    showLoading(false);
  }
}

function applyMarketBranding() {
  document.getElementById('header-market-name').textContent = market.name;
  document.title = market.name;
  applyPWABranding();
}

function applyPWABranding() {
  var iconUrl = market.pwaIconUrl || market.logoUrl || '/icon-192.png';
  var marketName = market.name || 'MarketPas';
  var favEl = document.getElementById('pwa-icon');
  var appleEl = document.getElementById('pwa-apple-icon');
  if (favEl && iconUrl) favEl.href = iconUrl;
  if (appleEl && iconUrl) appleEl.href = iconUrl;
  var manifest = {
    name: marketName, short_name: marketName.length > 12 ? marketName.substring(0, 12) : marketName,
    description: marketName + ' — Dijital sıra ve kampanyalar',
    start_url: '/musteri.html', display: 'standalone',
    background_color: '#0d1117', theme_color: '#10e5b0', orientation: 'portrait',
    icons: [{ src: iconUrl, sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
            { src: iconUrl, sizes: '512x512', type: 'image/png', purpose: 'any maskable' }]
  };
  var oldM = document.querySelector('link[rel="manifest"]');
  if (oldM) oldM.remove();
  var blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
  var link = document.createElement('link'); link.rel = 'manifest'; link.href = URL.createObjectURL(blob);
  document.head.appendChild(link);
}

// ═══════════════════════════════════════════════════════
// KARŞILAMA EKRANI
// ═══════════════════════════════════════════════════════

function showWelcomeSplash(callback) {
  // Daha önce gösterilmişse veya aktif sıra varsa atla
  var splashKey = 'mp_welcome_' + marketId;
  var lastSplash = localStorage.getItem(splashKey);
  if (lastSplash && (Date.now() - parseInt(lastSplash)) < 10 * 60 * 1000) {
    // Son 10 dakika içinde gösterilmiş — tekrar gösterme
    if (callback) callback();
    return;
  }

  var splash = document.getElementById('welcome-splash');
  var bg = document.getElementById('welcome-bg');
  var nameEl = document.getElementById('welcome-market-name');
  var progressEl = document.getElementById('welcome-progress');

  nameEl.textContent = market.name;

  // Karşılama görseli (market yönetiminden belirlenen)
  if (market.welcomeImageUrl) {
    bg.style.backgroundImage = 'url(' + market.welcomeImageUrl + ')';
    bg.style.backgroundSize = 'cover';
    bg.style.backgroundPosition = 'center';
  }

  splash.style.display = 'flex';
  localStorage.setItem(splashKey, Date.now().toString());

  // İlerleme çubuğu animasyonu
  var elapsed = 0;
  var progressInterval = setInterval(function() {
    elapsed += 100;
    var pct = Math.min(100, (elapsed / WELCOME_DURATION) * 100);
    progressEl.style.width = pct + '%';
    if (elapsed >= WELCOME_DURATION) {
      clearInterval(progressInterval);
      // Splash'ı kapat
      splash.style.opacity = '0';
      splash.style.transition = 'opacity .5s ease';
      setTimeout(function() {
        splash.style.display = 'none';
        splash.style.opacity = '1';
        splash.style.transition = '';
        if (callback) callback();
      }, 500);
    }
  }, 100);

  // Ekrana dokunursa erken geç
  splash.onclick = function() {
    clearInterval(progressInterval);
    splash.style.display = 'none';
    splash.onclick = null;
    if (callback) callback();
  };
}

// ═══════════════════════════════════════════════════════
// MOD GEÇİŞLERİ
// ═══════════════════════════════════════════════════════

function enterQueueMode() {
  isQueueMode = true;
  document.getElementById('queue-panel').classList.remove('hidden');
  // Bilet ikonu pulse animasyonu kaldır
  document.getElementById('ticket-btn').classList.remove('active-pulse');
}

function enterVitrinMode() {
  isQueueMode = false;
  document.getElementById('queue-panel').classList.add('hidden');
  // Bilet ikonuna pulse animasyonu ekle — dikkat çeksin
  document.getElementById('ticket-btn').classList.add('active-pulse');
}

// Bilet ikonuna tıklayınca panel aç/kapa
function toggleQueuePanel() {
  var panel = document.getElementById('queue-panel');
  if (panel.classList.contains('hidden')) {
    // Panel kapalı — aç ve sıra moduna geç
    enterQueueMode();
    if (!statsInterval) {
      loadCongestion();
      statsInterval = setInterval(loadCongestion, 15000);
    }
    checkExistingQueue();
    requestNotificationPermission();
  } else {
    // Aktif sıra varsa kapatma
    if (myQueueData && ['waiting','priority','priority_ready','called','arrived','active'].indexOf(myQueueData.status) > -1) {
      // Sıra aktif — kapatma
      return;
    }
    enterVitrinMode();
  }
}

async function checkExistingQueueSilent() {
  try {
    var doc = await db.collection('queue').doc(sessionId).get();
    if (doc.exists) {
      var status = doc.data().status;
      if (['waiting', 'priority', 'priority_ready', 'called', 'arrived', 'active'].includes(status)) {
        enterQueueMode();
        loadCongestion();
        statsInterval = setInterval(loadCongestion, 15000);
        requestNotificationPermission();
        startQueueListener();
        return;
      }
    }
  } catch(e) {}
}

// ─── Yoğunluk ────────────────────────────────────────
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
  if (!dot) return;
  var level = stats.congestionLevel;
  dot.className = 'cg-dot ' + level;
  fill.className = 'cg-fill ' + level;
  fill.style.width = stats.congestionPercent + '%';
  if (level === 'sakin') label.textContent = '🟢 Sakin';
  else if (level === 'normal') label.textContent = '🟡 Normal';
  else label.textContent = '🔴 Yoğun (%' + stats.congestionPercent + ')';
  var parts = [stats.activeCasas + ' kasa'];
  if (stats.waitingCount > 0) parts.push(stats.waitingCount + ' sırada');
  info.textContent = parts.join(' · ');
}

function updateWaitEstimate(stats) {
  var el = document.getElementById('wait-estimate');
  var display = document.getElementById('wait-time-display');
  if (!el || !display) return;
  var queuedScreen = document.getElementById('screen-queued');
  if (!queuedScreen || !queuedScreen.classList.contains('active')) return;
  if (stats && stats.estimatedWait > 0) { display.textContent = formatWaitTime(stats.estimatedWait); el.style.display = 'flex'; }
  else if (stats && stats.waitingCount === 0) { display.textContent = 'Hemen'; el.style.display = 'flex'; }
}

// ─── Duyurular ────────────────────────────────────────
function loadAnnouncements() {
  db.collection('announcements')
    .where('marketId', '==', marketId).where('active', '==', true)
    .orderBy('order', 'asc')
    .onSnapshot(function(snap) {
      announcements = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
      renderAnnouncements();
    }, function(error) {
      db.collection('announcements').where('marketId', '==', marketId)
        .onSnapshot(function(snap) {
          announcements = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); })
            .filter(function(a) { return a.active === true; })
            .sort(function(a, b) { return (a.order || 0) - (b.order || 0); });
          renderAnnouncements();
        });
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

// ─── Sıra kontrolü ───────────────────────────────────
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
    if (!doc.exists) {
      if (!isQueueMode) enterVitrinMode(); else showScreen('ready');
      return;
    }
    myQueueData = doc.data();
    var status = myQueueData.status;
    if (!isQueueMode && status !== 'done' && status !== 'cancelled') enterQueueMode();

    switch (status) {
      case 'waiting': case 'priority': case 'priority_ready':
        showScreen('queued');
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
        showScreen('arrived'); break;
      case 'active':
        clearInterval(countdownInterval); notifiedForThisCall = false;
        showScreen('active'); break;
      case 'timeout':
        clearInterval(countdownInterval); notifiedForThisCall = false;
        showScreen('timeout'); break;
      case 'done':
        clearInterval(countdownInterval); notifiedForThisCall = false;
        document.getElementById('thanks-title').textContent = '🛍️ Teşekkürler!';
        document.getElementById('thanks-sub').textContent = market?.thanksMessage || 'Alışverişiniz için teşekkür ederiz. İyi günler!';
        showScreen('thanks');
        setTimeout(function() {
          newSession(); enterVitrinMode();
          if (window.location.search) history.replaceState({}, '', window.location.pathname);
        }, 5000);
        break;
      case 'cancelled':
        clearInterval(countdownInterval); notifiedForThisCall = false;
        newSession(); enterVitrinMode();
        if (window.location.search) history.replaceState({}, '', window.location.pathname);
        break;
      default: showScreen('ready');
    }
  });
}

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
    await loadCongestion();
  } catch (e) { btn.disabled = false; btn.textContent = 'KASA SIRASI AL'; alert('Bir hata oluştu. Tekrar deneyin.'); }
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

async function handleCancel() {
  if (!confirm('Sıranızı iptal etmek istiyor musunuz?')) return;
  try { await db.collection('queue').doc(sessionId).update({ status: 'cancelled' }); } catch(e) {}
  if (queueListener) queueListener();
  newSession(); enterVitrinMode();
  if (window.location.search) history.replaceState({}, '', window.location.pathname);
}

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

async function handleRetryQueue() {
  var btn = document.getElementById('btn-retry'); btn.disabled = true;
  try {
    await db.collection('queue').doc(sessionId).update({ status: 'priority', calledAt: null, code: null, registerId: null, kasaNo: null });
    notifiedForThisCall = false; startQueueListener(); await tryAssignToOpenRegister();
  } catch (e) { btn.disabled = false; }
}

// ─── Canlı Kamera QR Tarayıcı ────────────────────────
var qrStream = null;
var qrScanInterval = null;

function openQRScanner() {
  var overlay = document.getElementById('qr-scanner');
  var video = document.getElementById('qr-video');
  var status = document.getElementById('qr-status');
  overlay.style.display = 'flex';
  status.textContent = 'Kamera açılıyor...'; status.style.color = '#8b949e';
  navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 640 } }
  }).then(function(stream) {
    qrStream = stream; video.srcObject = stream; video.play();
    status.textContent = 'Kamerayı QR koda doğrultun...';
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d');
    qrScanInterval = setInterval(function() {
      if (video.readyState < 2) return;
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      if (typeof jsQR !== 'undefined') {
        var code = jsQR(imageData.data, canvas.width, canvas.height, { inversionAttempts: 'dontInvert' });
        if (code && code.data) processQRResult(code.data, status);
      }
    }, 200);
  }).catch(function(err) {
    status.textContent = 'Kamera açılamadı. Tarayıcı izin vermiyor olabilir.'; status.style.color = '#f87171';
  });
}

function closeQRScanner() {
  if (qrScanInterval) { clearInterval(qrScanInterval); qrScanInterval = null; }
  if (qrStream) { qrStream.getTracks().forEach(function(t) { t.stop(); }); qrStream = null; }
  var video = document.getElementById('qr-video');
  if (video) video.srcObject = null;
  document.getElementById('qr-scanner').style.display = 'none';
}

function processQRResult(data, statusEl) {
  try {
    var url = new URL(data);
    var qMarket = url.searchParams.get('market');
    if (qMarket) {
      statusEl.textContent = '✓ QR kod okundu!'; statusEl.style.color = '#10e5b0';
      if (navigator.vibrate) navigator.vibrate(100);
      setTimeout(function() {
        closeQRScanner();
        marketId = qMarket;
        localStorage.setItem('mp_last_market', marketId);
        sessionId = localStorage.getItem('mp_s_' + marketId);
        if (!sessionId) { sessionId = generateId(); localStorage.setItem('mp_s_' + marketId, sessionId); }
        isQueueMode = true;
        history.replaceState({}, '', '?market=' + marketId);
        loadMarket();
      }, 500);
      return;
    }
  } catch(e) {}
  statusEl.textContent = 'Bu bir MarketPas QR kodu değil.'; statusEl.style.color = '#fbbf24';
  setTimeout(function() { statusEl.textContent = 'Kamerayı QR koda doğrultun...'; statusEl.style.color = '#8b949e'; }, 2000);
}

// ─── Yardımcılar ─────────────────────────────────────
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(function(s) { s.classList.remove('active'); });
  var el = document.getElementById('screen-' + name);
  if (el) el.classList.add('active');
  if (name === 'ready') { var btn = document.getElementById('btn-queue'); if (btn) { btn.disabled = false; btn.textContent = 'KASA SIRASI AL'; } }
  if (name === 'timeout') { var btn2 = document.getElementById('btn-retry'); if (btn2) btn2.disabled = false; }
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

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(function(e) {});
document.addEventListener('DOMContentLoaded', init);
