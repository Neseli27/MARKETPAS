// =====================================================
// MarketPas v3 — Müşteri Sayfası (Çift Mod)
// =====================================================
// VİTRİN MODU: Tam ekran reklam/kampanya (PWA açılışı)
// SIRA MODU:   Üst %30 sıra + alt %70 reklam (QR okutunca)
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
var isQueueMode = false; // true = sıra modu, false = vitrin modu

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

  // Kayıtlı market ID (PWA için)
  if (!urlMarket) {
    marketId = localStorage.getItem('mp_last_market');
  } else {
    marketId = urlMarket;
  }

  if (!marketId) {
    showError('Lütfen marketteki QR kodu telefonunuzla okutun.');
    return;
  }

  // Market ID'yi kaydet (PWA sonraki açılışlar için)
  localStorage.setItem('mp_last_market', marketId);

  // URL'de market parametresi varsa → QR okutmuş → sıra modu
  // Yoksa → PWA'dan açmış → vitrin modu
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
      // Sıra modu — üst bölümü aç
      enterQueueMode();
      loadCongestion();
      checkExistingQueue();
      requestNotificationPermission();
      statsInterval = setInterval(loadCongestion, 15000);
    } else {
      // Vitrin modu — sadece reklamlar
      enterVitrinMode();
      // Eski aktif sıra var mı kontrol et
      checkExistingQueueSilent();
    }
  } catch (e) {
    showError('Bağlantı hatası. Sayfayı yenileyin.');
  } finally {
    showLoading(false);
  }
}

function applyMarketBranding() {
  document.getElementById('market-name').textContent = market.name;
  document.title = market.name;

  // Üst bölüm logosu
  if (market.logoUrl) {
    var img = document.getElementById('market-logo');
    img.src = market.logoUrl; img.style.display = 'block';
  }

  // Vitrin header
  document.getElementById('vitrin-name').textContent = market.name;
  if (market.logoUrl) {
    var vImg = document.getElementById('vitrin-logo');
    vImg.src = market.logoUrl; vImg.classList.add('has-img');
  }
}

// ═══════════════════════════════════════════════════════
// MOD GEÇİŞLERİ
// ═══════════════════════════════════════════════════════

function enterQueueMode() {
  isQueueMode = true;
  var top = document.getElementById('top-section');
  top.classList.remove('hidden');
  // Vitrin header'ı gizle
  document.getElementById('vitrin-header').classList.remove('visible');
}

function enterVitrinMode() {
  isQueueMode = false;
  var top = document.getElementById('top-section');
  top.classList.add('hidden');
  // Vitrin header'ı göster
  document.getElementById('vitrin-header').classList.add('visible');
}

// Vitrin modunda sessizce eski sıra kontrolü
async function checkExistingQueueSilent() {
  try {
    var doc = await db.collection('queue').doc(sessionId).get();
    if (doc.exists) {
      var status = doc.data().status;
      if (['waiting', 'priority', 'priority_ready', 'called', 'arrived', 'active'].includes(status)) {
        // Aktif sıra var — sıra moduna geç
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
  var parts = [];
  parts.push(stats.activeCasas + ' kasa');
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
      console.warn('Duyuru sorgusu hata (index eksik olabilir), fallback deneniyor:', error.message);
      // Fallback — index yoksa sadece marketId ile çek, client tarafında filtrele
      db.collection('announcements')
        .where('marketId', '==', marketId)
        .onSnapshot(function(snap) {
          announcements = snap.docs
            .map(function(d) { return Object.assign({ id: d.id }, d.data()); })
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
    if (!doc.exists) {
      // Sıra kaydı yok — vitrin moduna dön
      if (!isQueueMode) { enterVitrinMode(); }
      else { showScreen('ready'); }
      return;
    }
    myQueueData = doc.data();
    var status = myQueueData.status;

    // Sıra modu açık değilse aç
    if (!isQueueMode && status !== 'done' && status !== 'cancelled') {
      enterQueueMode();
    }

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
        document.getElementById('thanks-title').textContent = '🛍️ Teşekkürler!';
        document.getElementById('thanks-sub').textContent = market?.thanksMessage || 'Alışverişiniz için teşekkür ederiz. İyi günler!';
        showScreen('thanks');
        // 5sn sonra vitrin moduna dön ve URL'yi temizle
        setTimeout(function() {
          newSession();
          enterVitrinMode();
          // URL'den ?market= parametresini kaldır (sonraki açılışta vitrin modu olsun)
          if (window.location.search) {
            history.replaceState({}, '', window.location.pathname);
          }
        }, 5000);
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

async function handleCancel() {
  if (!confirm('Sıranızı iptal etmek istiyor musunuz?')) return;
  try { await db.collection('queue').doc(sessionId).update({ status: 'cancelled' }); } catch(e) {}
  if (queueListener) queueListener();
  newSession();
  enterVitrinMode();
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

// ─── Kamera ile QR Kod Okuma ─────────────────────────
function handleQRCapture(input) {
  var file = input.files[0];
  if (!file) return;

  var reader = new FileReader();
  reader.onload = function(e) {
    var img = new Image();
    img.onload = function() {
      // Canvas'a çiz ve pixel verisini al
      var canvas = document.createElement('canvas');
      var maxDim = 800;
      var w = img.width, h = img.height;
      if (w > maxDim || h > maxDim) {
        var ratio = Math.min(maxDim / w, maxDim / h);
        w = Math.round(w * ratio); h = Math.round(h * ratio);
      }
      canvas.width = w; canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      var imageData = ctx.getImageData(0, 0, w, h);

      // jsQR ile QR kodu çöz
      var code = null;
      if (typeof jsQR !== 'undefined') {
        code = jsQR(imageData.data, w, h);
      }

      if (code && code.data) {
        // URL'den market parametresini çıkar
        try {
          var url = new URL(code.data);
          var qMarket = url.searchParams.get('market');
          if (qMarket) {
            // QR okundu — sıra moduna geç
            marketId = qMarket;
            localStorage.setItem('mp_last_market', marketId);
            sessionId = localStorage.getItem('mp_s_' + marketId);
            if (!sessionId) { sessionId = generateId(); localStorage.setItem('mp_s_' + marketId, sessionId); }
            isQueueMode = true;
            history.replaceState({}, '', '?market=' + marketId);
            enterQueueMode();
            loadCongestion();
            checkExistingQueue();
            requestNotificationPermission();
            if (!statsInterval) statsInterval = setInterval(loadCongestion, 15000);
          } else {
            showQRError();
          }
        } catch(err) {
          showQRError();
        }
      } else {
        showQRError();
      }
      input.value = '';
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function showQRError() {
  // Kısa süre hata göster — toast tarzı
  var toast = document.createElement('div');
  toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1f2937;color:#f87171;padding:12px 20px;border-radius:10px;font-size:13px;font-weight:600;z-index:200;border:1px solid rgba(248,113,113,.3);box-shadow:0 4px 16px rgba(0,0,0,.3)';
  toast.textContent = 'QR kod okunamadı. Lütfen tekrar deneyin.';
  document.body.appendChild(toast);
  setTimeout(function() { toast.remove(); }, 3000);
}

// ─── Yardımcılar ─────────────────────────────────────
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(function(s) { s.classList.remove('active'); });
  var el = document.getElementById('screen-' + name);
  if (el) el.classList.add('active');
  if (name === 'ready') { var btn = document.getElementById('btn-queue'); if (btn) { btn.disabled = false; btn.textContent = 'SIRA NUMARASI AL'; } }
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

// ─── PWA Service Worker Kaydı ────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(function(e) {});
}

document.addEventListener('DOMContentLoaded', init);
