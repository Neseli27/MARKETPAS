// =====================================================
// MarketPas v2.3 — Kasiyer Sayfası
// =====================================================

var marketId = null;
var kasaNo = null;
var registerId = null;
var registerListener = null;
var registerData = null;
var marketData = null;
var timerInterval = null;
var queueCountListener = null;
var autoMode = true;
var TIMEOUT_MS = 2 * 60 * 1000;

// ─── Başlangıç ────────────────────────────────────────
async function init() {
  var params = new URLSearchParams(window.location.search);
  var urlMarket = params.get('market');
  var urlKasa = parseInt(params.get('kasa'));

  if (urlMarket && urlKasa) {
    marketId = urlMarket; kasaNo = urlKasa;
    switchToMain(); loadRegister(); return;
  }
  var savedMarket = localStorage.getItem('mp_kasiyer_market');
  var savedKasa = parseInt(localStorage.getItem('mp_kasiyer_kasa'));
  if (savedMarket && savedKasa) {
    marketId = savedMarket; kasaNo = savedKasa;
    switchToMain(); loadRegister(); return;
  }
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('main-screen').style.display = 'none';
}

var kasiyerStartTime = null;
var kasiyerServedCount = 0;
var kasiyerTotalTime = 0;
var clockInterval = null;

function switchToMain() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('main-screen').style.display = 'flex';
  var saved = localStorage.getItem('mp_auto_' + marketId);
  if (saved !== null) autoMode = saved === 'true';
  updateAutoToggleUI();
  startClock();
  kasiyerStartTime = new Date();
  var stEl = document.getElementById('stat-start');
  if (stEl) stEl.textContent = kasiyerStartTime.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

function startClock() {
  function tick() {
    var now = new Date();
    var ce = document.getElementById('live-clock');
    var de = document.getElementById('live-date');
    if (ce) ce.textContent = now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (de) {
      var days = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
      de.textContent = days[now.getDay()] + ', ' + now.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
    }
  }
  tick();
  clockInterval = setInterval(tick, 1000);
}

function updateKasiyerStats() {
  var se = document.getElementById('stat-served');
  var ae = document.getElementById('stat-avg');
  if (se) se.textContent = kasiyerServedCount;
  if (ae) {
    if (kasiyerServedCount > 0 && kasiyerTotalTime > 0) {
      var avgMin = Math.round(kasiyerTotalTime / kasiyerServedCount / 60000 * 10) / 10;
      ae.textContent = avgMin + ' dk';
    } else { ae.textContent = '—'; }
  }
}

// ─── Giriş ───────────────────────────────────────────
async function handleLogin() {
  var mId = document.getElementById('login-market').value.trim();
  var kNo = parseInt(document.getElementById('login-kasa').value.trim());
  var pin = document.getElementById('login-pin').value.trim();
  var errEl = document.getElementById('login-error');
  var btn = document.getElementById('btn-login');
  errEl.style.display = 'none';
  if (!mId || !kNo || !pin) { errEl.textContent = 'Tüm alanları doldurun.'; errEl.style.display = 'block'; return; }
  btn.disabled = true; btn.textContent = 'Kontrol ediliyor...';
  try {
    var mDoc = await db.collection('markets').doc(mId).get();
    if (!mDoc.exists || mDoc.data().kasiyerPin !== pin) {
      errEl.textContent = 'Geçersiz market ID veya PIN.'; errEl.style.display = 'block';
      btn.disabled = false; btn.textContent = 'Giriş Yap'; return;
    }
    marketId = mId; kasaNo = kNo; marketData = mDoc.data();
    localStorage.setItem('mp_kasiyer_market', mId);
    localStorage.setItem('mp_kasiyer_kasa', kNo.toString());
    switchToMain();
    document.getElementById('header-market-name').textContent = marketData.name || '';
    loadRegister();
  } catch(e) {
    errEl.textContent = 'Bağlantı hatası.'; errEl.style.display = 'block';
    btn.disabled = false; btn.textContent = 'Giriş Yap';
  }
}

async function handleLogout() {
  var ok=await mpConfirm('Çıkış yapmak istiyor musunuz?','👋');if(!ok)return;
  localStorage.removeItem('mp_kasiyer_market');
  localStorage.removeItem('mp_kasiyer_kasa');
  if (registerListener) registerListener();
  if (queueCountListener) queueCountListener();
  if (timerInterval) clearInterval(timerInterval);
  if (clockInterval) clearInterval(clockInterval);
  location.reload();
}

// ─── Kasa yükle ──────────────────────────────────────
async function loadRegister() {
  var snap = await db.collection('registers')
    .where('marketId', '==', marketId).where('kasaNo', '==', kasaNo).limit(1).get();
  if (snap.empty) { mpAlert('Kasa ' + kasaNo + ' bulunamadı.','❌'); return; }
  registerId = snap.docs[0].id;
  document.getElementById('kasa-no').textContent = 'KASA ' + kasaNo;
  if (!marketData) {
    var mDoc = await db.collection('markets').doc(marketId).get();
    if (mDoc.exists) { marketData = mDoc.data(); document.getElementById('header-market-name').textContent = marketData.name || ''; }
  }
  startRegisterListener();
  startQueueCountListener();
  setInterval(checkTimeout, 5000);
  loadTodayStats();
}

async function loadTodayStats() {
  try {
    var today = new Date(); today.setHours(0,0,0,0);
    var ts = firebase.firestore.Timestamp.fromDate(today);
    var snap = await db.collection('queue').where('marketId', '==', marketId)
      .where('status', '==', 'done').where('kasaNo', '==', kasaNo)
      .where('createdAt', '>=', ts).get();
    kasiyerServedCount = snap.size;
    kasiyerTotalTime = 0;
    snap.forEach(function(doc) {
      var d = doc.data();
      if (d.arrivedAt && d.completedAt) {
        var a = d.arrivedAt.toDate ? d.arrivedAt.toDate() : new Date(d.arrivedAt);
        var c = d.completedAt.toDate ? d.completedAt.toDate() : new Date(d.completedAt);
        var pt = c.getTime() - a.getTime();
        if (pt > 0 && pt < 1800000) kasiyerTotalTime += pt;
      }
    });
    updateKasiyerStats();
  } catch(e) { /* index eksik olabilir */ }
}

function startRegisterListener() {
  if (registerListener) registerListener();
  registerListener = db.collection('registers').doc(registerId).onSnapshot(function(doc) {
    if (!doc.exists) return;
    registerData = doc.data();
    renderCards();
  });
}

function startQueueCountListener() {
  if (queueCountListener) queueCountListener();
  queueCountListener = db.collection('queue')
    .where('marketId', '==', marketId)
    .where('status', 'in', ['waiting', 'priority'])
    .onSnapshot(function(snap) {
      var el = document.getElementById('queue-count-display');
      if (el) el.textContent = snap.size;
    });
}

// ─── Otomatik/Manuel Toggle ──────────────────────────
function toggleAutoMode() {
  autoMode = !autoMode;
  localStorage.setItem('mp_auto_' + marketId, autoMode.toString());
  updateAutoToggleUI();
}

function updateAutoToggleUI() {
  var toggle = document.getElementById('auto-toggle');
  var label = document.getElementById('auto-label');
  if (toggle) toggle.checked = autoMode;
  if (label) label.textContent = autoMode ? 'Otomatik Çağırma AÇIK' : 'Manuel Mod — Kendiniz Çağırın';
  var cagirBtn = document.getElementById('btn-cagir');
  if (cagirBtn && !autoMode && registerData && !registerData.waitingQueueId) {
    cagirBtn.style.display = 'block';
  }
}

// ─── Kartları Render Et ──────────────────────────────
async function renderCards() {
  var d = registerData;

  // ── AKTİF MÜŞTERİ (üst kart) ──
  var activeCard = document.getElementById('active-card');
  if (d.activeQueueId) {
    try {
      var qDoc = await db.collection('queue').doc(d.activeQueueId).get();
      if (qDoc.exists) {
        var qData = qDoc.data();
        activeCard.className = 'customer-card active-card occupied';
        activeCard.innerHTML = '';
        var b = document.createElement('div'); b.className = 'card-badge'; b.textContent = 'AKTİF — ÖDEME YAPILIYOR'; activeCard.appendChild(b);
        var c = document.createElement('div'); c.className = 'card-code'; c.textContent = qData.code || '—'; activeCard.appendChild(c);
        var bt = document.createElement('button'); bt.className = 'btn-islem-tamam'; bt.textContent = '✓ İşlem Tamamlandı';
        bt.onclick = function() { handleIslemTamam(d.activeQueueId); }; activeCard.appendChild(bt);
      }
    } catch(e) {}
  } else {
    activeCard.className = 'customer-card active-card empty';
    activeCard.innerHTML = '<div class="card-badge">AKTİF</div><div class="card-empty-text">Aktif müşteri yok</div>';
  }

  // ── BEKLEYEN MÜŞTERİ (alt kart) ──
  var waitingCard = document.getElementById('waiting-card');
  var cagirBtn = document.getElementById('btn-cagir');

  if (d.waitingQueueId) {
    if (cagirBtn && autoMode) cagirBtn.style.display = 'none';
    try {
      var qDoc2 = await db.collection('queue').doc(d.waitingQueueId).get();
      if (qDoc2.exists) {
        var qData2 = qDoc2.data();
        var status = qData2.status;

        if (status === 'called') {
          waitingCard.className = 'customer-card waiting-card calling';
          waitingCard.innerHTML = '';
          var b1 = document.createElement('div'); b1.className = 'card-badge'; b1.textContent = 'ÇAĞRILDI — GELİYOR'; waitingCard.appendChild(b1);
          var c1 = document.createElement('div'); c1.className = 'card-code'; c1.textContent = qData2.code || '—'; waitingCard.appendChild(c1);
          var t1 = document.createElement('div'); t1.className = 'card-timer'; t1.id = 'waiting-timer'; t1.textContent = '⏱ 2:00'; waitingCard.appendChild(t1);
          var gb = document.createElement('button'); gb.className = 'btn-geldi'; gb.textContent = '✓ Müşteri Kasaya Geldi';
          gb.onclick = function() { handleGeldi(d.waitingQueueId); }; waitingCard.appendChild(gb);
          startWaitingTimer(qData2.calledAt?.toDate());

        } else if (status === 'arrived') {
          if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
          waitingCard.className = 'customer-card waiting-card arrived';
          waitingCard.innerHTML = '';
          var b2 = document.createElement('div'); b2.className = 'card-badge'; b2.textContent = 'KASADA — SIRA BEKLİYOR'; waitingCard.appendChild(b2);
          var c2 = document.createElement('div'); c2.className = 'card-code'; c2.textContent = qData2.code || '—'; waitingCard.appendChild(c2);
          var t2 = document.createElement('div'); t2.className = 'card-arrived-text'; t2.textContent = '✅ Müşteri kasada — aktif müşteri bitince başlayacak'; waitingCard.appendChild(t2);
        }
      }
    } catch(e) {}
  } else {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    waitingCard.className = 'customer-card waiting-card empty';
    waitingCard.innerHTML = '<div class="card-badge">BEKLEME SLOTU</div><div class="card-empty-text">Boş — sıradaki müşteri buraya çağrılacak</div>';
    if (cagirBtn) {
      if (!autoMode) { cagirBtn.style.display = 'block'; cagirBtn.disabled = false; cagirBtn.textContent = '📢 Sıradaki Müşteriyi Çağır'; }
      else { cagirBtn.style.display = 'none'; }
    }
  }
}

// ─── Timer ───────────────────────────────────────────
function startWaitingTimer(calledAt) {
  if (timerInterval) clearInterval(timerInterval);
  if (!calledAt) return;
  function tick() {
    var el = document.getElementById('waiting-timer');
    if (!el) { clearInterval(timerInterval); return; }
    var left = Math.max(0, TIMEOUT_MS - (Date.now() - calledAt.getTime()));
    var s = Math.ceil(left / 1000);
    el.textContent = '⏱ ' + Math.floor(s / 60) + ':' + (s % 60).toString().padStart(2, '0');
    el.className = 'card-timer' + (left < 30000 ? ' urgent' : '');
    if (left <= 0) clearInterval(timerInterval);
  }
  tick();
  timerInterval = setInterval(tick, 1000);
}

// ═══════════════════════════════════════════════════════
// KASİYER BUTONLARI
// ═══════════════════════════════════════════════════════

// ── "Geldi" ──────────────────────────────────────────
async function handleGeldi(queueId) {
  try {
    var regRef = db.collection('registers').doc(registerId);
    var d = registerData;
    var now = firebase.firestore.FieldValue.serverTimestamp();

    if (!d.activeQueueId) {
      // Aktif slot BOŞ → müşteriyi direkt aktife al
      await db.collection('queue').doc(queueId).update({ status: 'active', arrivedAt: now });
      await regRef.update({ activeQueueId: queueId, waitingQueueId: null, waitingCode: null, calledAt: null });
      if (autoMode) await assignNextToRegister(marketId, registerId, kasaNo);
    } else {
      // Aktif slot DOLU → müşteri beklesin
      await db.collection('queue').doc(queueId).update({ status: 'arrived', arrivedAt: now });
    }
  } catch(e) { console.error('Geldi hatası:', e); mpAlert('İşlem hatası.','❌'); }
}

// ── "İşlem Tamam" ────────────────────────────────────
async function handleIslemTamam(queueId) {
  try {
    var regRef = db.collection('registers').doc(registerId);
    var d = registerData;
    var now = new Date();

    // İşlem süresini hesapla ve kaydet
    var qDoc = await db.collection('queue').doc(queueId).get();
    if (qDoc.exists) {
      var qData = qDoc.data();
      var arrivedAt = qData.arrivedAt?.toDate();
      if (arrivedAt) {
        var processTime = now.getTime() - arrivedAt.getTime();
        if (processTime > 0 && processTime < 30 * 60 * 1000) { // max 30dk mantıklı
          updateAvgProcessTime(marketId, processTime); // arka planda güncelle
        }
      }
    }

    // 1) Aktif müşteriyi "done" yap
    await db.collection('queue').doc(queueId).update({
      status: 'done',
      completedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    // İstatistik güncelle
    kasiyerServedCount++;
    if (qDoc.exists) {
      var at = qDoc.data().arrivedAt?.toDate();
      if (at) { var pt = now.getTime() - at.getTime(); if (pt > 0 && pt < 1800000) kasiyerTotalTime += pt; }
    }
    updateKasiyerStats();

    // 2) Bekleme slotundaki müşteriyi aktife taşı
    if (d.waitingQueueId) {
      var wDoc = await db.collection('queue').doc(d.waitingQueueId).get();
      if (wDoc.exists && wDoc.data().status === 'arrived') {
        await db.collection('queue').doc(d.waitingQueueId).update({ status: 'active' });
        await regRef.update({ activeQueueId: d.waitingQueueId, waitingQueueId: null, waitingCode: null, calledAt: null });
        if (autoMode) await assignNextToRegister(marketId, registerId, kasaNo);
      } else {
        await regRef.update({ activeQueueId: null, waitingQueueId: null, waitingCode: null, calledAt: null });
        if (autoMode) await assignNextToRegister(marketId, registerId, kasaNo);
      }
    } else {
      await regRef.update({ activeQueueId: null });
      if (autoMode) await assignNextToRegister(marketId, registerId, kasaNo);
    }
  } catch(e) { console.error('İşlem tamam hatası:', e); mpAlert('İşlem hatası: ' + e.message,'❌'); }
}

// ── Manuel Çağır ─────────────────────────────────────
async function handleManuelCagir() {
  var btn = document.getElementById('btn-cagir');
  if (btn) { btn.disabled = true; btn.textContent = 'Çağrılıyor...'; }
  try {
    await assignNextToRegister(marketId, registerId, kasaNo);
    setTimeout(function() {
      if (registerData && !registerData.waitingQueueId) mpAlert('Sırada bekleyen müşteri yok.','ℹ️');
      if (btn) { btn.disabled = false; btn.textContent = '📢 Sıradaki Müşteriyi Çağır'; }
    }, 1500);
  } catch(e) {
    if (btn) { btn.disabled = false; btn.textContent = '📢 Sıradaki Müşteriyi Çağır'; }
  }
}

// ─── Timeout ─────────────────────────────────────────
async function checkTimeout() {
  if (!registerData?.waitingQueueId || !registerData?.calledAt) return;
  var calledAt; try { calledAt = registerData.calledAt.toDate(); } catch(e) { return; }
  if (Date.now() - calledAt.getTime() < TIMEOUT_MS) return;
  try {
    var qDoc = await db.collection('queue').doc(registerData.waitingQueueId).get();
    if (!qDoc.exists || qDoc.data().status !== 'called') return;
    var batch = db.batch();
    batch.update(db.collection('queue').doc(registerData.waitingQueueId), { status: 'timeout', code: null, registerId: null, kasaNo: null });
    batch.update(db.collection('registers').doc(registerId), { waitingQueueId: null, waitingCode: null, calledAt: null });
    await batch.commit();
    if (autoMode) await assignNextToRegister(marketId, registerId, kasaNo);
  } catch(e) { console.error('Timeout hatası:', e); }
}

document.addEventListener('DOMContentLoaded', init);
if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(function(){});
