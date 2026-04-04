// =====================================================
// MarketPas v3 — Firebase Config & Ortak Fonksiyonlar
// =====================================================

var firebaseConfig = {
  apiKey:            "AIzaSyCqUSoowo2EbKKhG0SBcIzBYddwYOzHKRo",
  authDomain:        "egitim-yonetim-platformu.firebaseapp.com",
  projectId:         "egitim-yonetim-platformu",
  storageBucket:     "egitim-yonetim-platformu.firebasestorage.app",
  messagingSenderId: "548967060709",
  appId:             "1:548967060709:web:d95bbd360347021634700c",
  measurementId:     "G-89D843J9RF"
};
firebase.initializeApp(firebaseConfig);
var db = firebase.firestore();

// ─── SÜPER ADMİN KİMLİK BİLGİLERİ ──────────────────
var SUPER_ADMIN = { username: 'marketpas_admin', passwordHash: '' };
// Şifre hash'i ilk çalıştırmada konsoldan ayarlanır (aşağıdaki hashPassword fonk.)

// ─── SHA-256 Hash ────────────────────────────────────
async function hashPassword(password) {
  var encoder = new TextEncoder();
  var data = encoder.encode(password + '_marketpas_salt_2026');
  var hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
}

// ─── Benzersiz ID ────────────────────────────────────
function generateId() {
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  var id = ''; var array = new Uint8Array(20); crypto.getRandomValues(array);
  for (var i = 0; i < 20; i++) id += chars[array[i] % chars.length];
  return id;
}

// ─── 6 Haneli Kod ────────────────────────────────────
function generateCode() {
  var n = Math.floor(100000 + Math.random() * 900000).toString();
  return n.slice(0, 3) + '-' + n.slice(3);
}

// ─── Sıra Numarası (Atomik) ─────────────────────────
async function getNextQueueNumber(marketId) {
  var ref = db.collection('marketCounters').doc(marketId);
  return await db.runTransaction(async function(tx) {
    var doc = await tx.get(ref);
    if (!doc.exists) { tx.set(ref, { queueCounter: 1 }); return 1; }
    var next = (doc.data().queueCounter || 0) + 1;
    tx.update(ref, { queueCounter: next }); return next;
  });
}

// ─── Lisans Kontrolü ─────────────────────────────────
// true = aktif, false = süresi dolmuş veya askıda
async function checkLicense(marketId) {
  try {
    var doc = await db.collection('markets').doc(marketId).get();
    if (!doc.exists) return false;
    var d = doc.data();
    if (d.status === 'suspended' || d.status === 'deleted') return false;
    if (!d.licenseExpiry) return false;
    var expiry = d.licenseExpiry.toDate ? d.licenseExpiry.toDate() : new Date(d.licenseExpiry);
    return expiry.getTime() > Date.now();
  } catch(e) { return false; }
}

// Kalan gün hesapla
function getLicenseRemainingDays(licenseExpiry) {
  if (!licenseExpiry) return 0;
  var exp = licenseExpiry.toDate ? licenseExpiry.toDate() : new Date(licenseExpiry);
  var now = new Date();
  // Saat/dakika farkını ortadan kaldır — sadece gün hesapla
  var expDay = new Date(exp.getFullYear(), exp.getMonth(), exp.getDate());
  var nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var diff = expDay.getTime() - nowDay.getTime();
  return Math.max(0, Math.round(diff / (1000 * 60 * 60 * 24)));
}

// ─── Sıradaki Müşteriyi Kasaya Ata ───────────────────
async function assignNextToRegister(marketId, registerId, kasaNo) {
  try {
    // Lisans kontrolü
    var licensed = await checkLicense(marketId);
    if (!licensed) { console.warn('MarketPas: Lisans süresi dolmuş veya tanımsız — kod üretilemez'); return; }

    var regCheck = await db.collection('registers').doc(registerId).get();
    if (!regCheck.exists || !regCheck.data().active) { console.warn('MarketPas: Kasa bulunamadı veya pasif:', registerId); return; }
    if (regCheck.data().waitingQueueId) { console.log('MarketPas: Kasa zaten dolu:', registerId); return; }

    // Öncelikli müşteri ara (priority_ready > priority > waiting)
    var candidateId = null;

    // 1. priority_ready (Hazırım demiş)
    var prSnap = await db.collection('queue')
      .where('marketId', '==', marketId)
      .where('status', '==', 'priority_ready')
      .orderBy('createdAt', 'asc').limit(1).get();
    if (!prSnap.empty) { candidateId = prSnap.docs[0].id; }

    // 2. priority (öncelikli)
    if (!candidateId) {
      var pSnap = await db.collection('queue')
        .where('marketId', '==', marketId)
        .where('status', '==', 'priority')
        .orderBy('createdAt', 'asc').limit(1).get();
      if (!pSnap.empty) { candidateId = pSnap.docs[0].id; }
    }

    // 3. waiting (normal sıra)
    if (!candidateId) {
      var wSnap = await db.collection('queue')
        .where('marketId', '==', marketId)
        .where('status', '==', 'waiting')
        .orderBy('queueNumber', 'asc').limit(1).get();
      if (!wSnap.empty) candidateId = wSnap.docs[0].id;
    }

    if (!candidateId) { console.log('MarketPas: Sırada bekleyen müşteri yok'); return; }

    var code = generateCode();
    var regRef = db.collection('registers').doc(registerId);
    var qRef = db.collection('queue').doc(candidateId);

    await db.runTransaction(async function(tx) {
      var regDoc = await tx.get(regRef);
      var qDoc = await tx.get(qRef);
      if (!regDoc.exists || !qDoc.exists) return;
      if (regDoc.data().waitingQueueId) return;
      var st = qDoc.data().status;
      if (st !== 'waiting' && st !== 'priority' && st !== 'priority_ready') return;
      var now = firebase.firestore.FieldValue.serverTimestamp();
      tx.update(qRef, { status: 'called', code: code, registerId: registerId, kasaNo: kasaNo, calledAt: now });
      tx.update(regRef, { waitingQueueId: candidateId, waitingCode: code, calledAt: now });
    });
    console.log('MarketPas: Kod üretildi:', code, '→ Kasa', kasaNo);
  } catch (e) { console.error('MarketPas assignNext HATA:', e); }
}

// ─── Market İstatistikleri ────────────────────────────
async function getMarketStats(marketId) {
  var stats = { activeCasas: 0, busyCasas: 0, waitingCount: 0, avgProcessTime: 0, estimatedWait: 0, congestionPercent: 0, congestionLevel: 'sakin' };
  try {
    var regSnap = await db.collection('registers').where('marketId', '==', marketId).where('active', '==', true).get();
    stats.activeCasas = regSnap.size;
    regSnap.forEach(function(doc) { var d = doc.data(); if (d.activeQueueId || d.waitingQueueId) stats.busyCasas++; });
    var qSnap = await db.collection('queue').where('marketId', '==', marketId).where('status', 'in', ['waiting', 'priority', 'priority_ready']).get();
    stats.waitingCount = qSnap.size;
    var mDoc = await db.collection('markets').doc(marketId).get();
    stats.avgProcessTime = (mDoc.exists && mDoc.data().avgProcessTime) ? mDoc.data().avgProcessTime : 3 * 60 * 1000;
    if (stats.activeCasas > 0) {
      stats.estimatedWait = Math.ceil((stats.waitingCount / stats.activeCasas) * stats.avgProcessTime);
      var cap = stats.activeCasas * 2;
      stats.congestionPercent = Math.min(100, Math.round(((stats.busyCasas + stats.waitingCount) / cap) * 100));
    }
    if (stats.congestionPercent < 30) stats.congestionLevel = 'sakin';
    else if (stats.congestionPercent < 70) stats.congestionLevel = 'normal';
    else stats.congestionLevel = 'yogun';
  } catch(e) {}
  return stats;
}

async function updateAvgProcessTime(marketId, processTimeMs) {
  try {
    var mRef = db.collection('markets').doc(marketId);
    var mDoc = await mRef.get();
    var oldAvg = (mDoc.exists && mDoc.data().avgProcessTime) ? mDoc.data().avgProcessTime : processTimeMs;
    var newAvg = Math.round(oldAvg * 0.8 + processTimeMs * 0.2);
    await mRef.update({ avgProcessTime: newAvg });
  } catch(e) {}
}

function escapeHtml(str) { if (!str) return ''; var d = document.createElement('div'); d.textContent = str; return d.innerHTML; }
function formatWaitTime(ms) {
  if (ms <= 0) return 'Hemen'; var m = Math.round(ms / 60000);
  if (m < 1) return '< 1 dk'; if (m === 1) return '~1 dk'; return '~' + m + ' dk';
}

// ─── Fiyatlandırma Hesaplama ─────────────────────────
// Kasa sayısına göre birim fiyat hesapla (min-max arası kademeli)
// Kasa arttıkça birim fiyat max'tan min'e doğru düşer
function calculateUnitPrice(kasaSayisi, minPrice, maxPrice) {
  if (!kasaSayisi || kasaSayisi <= 0) return maxPrice;
  if (minPrice >= maxPrice) return minPrice;
  // Kademe eşikleri: 1-2 → max, 3-5 → %75, 6-10 → %50, 11-20 → %25, 20+ → min
  var ratio;
  if (kasaSayisi <= 2) ratio = 1;
  else if (kasaSayisi <= 5) ratio = 0.75;
  else if (kasaSayisi <= 10) ratio = 0.45;
  else if (kasaSayisi <= 20) ratio = 0.2;
  else ratio = 0;
  var price = minPrice + (maxPrice - minPrice) * ratio;
  return Math.round(price);
}

// Market için geçerli birim fiyat: özel fiyat varsa onu, yoksa otomatik hesapla
function getEffectiveUnitPrice(market, minPrice, maxPrice) {
  if (market.customPrice && market.customPrice > 0) return market.customPrice;
  return calculateUnitPrice(market.kasaSayisi || 0, minPrice, maxPrice);
}

// ─── Türkiye Şehirleri ───────────────────────────────
var TURKEY_CITIES = ["Adana","Adıyaman","Afyonkarahisar","Ağrı","Aksaray","Amasya","Ankara","Antalya","Ardahan","Artvin","Aydın","Balıkesir","Bartın","Batman","Bayburt","Bilecik","Bingöl","Bitlis","Bolu","Burdur","Bursa","Çanakkale","Çankırı","Çorum","Denizli","Diyarbakır","Düzce","Edirne","Elazığ","Erzincan","Erzurum","Eskişehir","Gaziantep","Giresun","Gümüşhane","Hakkâri","Hatay","Iğdır","Isparta","İstanbul","İzmir","Kahramanmaraş","Karabük","Karaman","Kars","Kastamonu","Kayseri","Kilis","Kırıkkale","Kırklareli","Kırşehir","Kocaeli","Konya","Kütahya","Malatya","Manisa","Mardin","Mersin","Muğla","Muş","Nevşehir","Niğde","Ordu","Osmaniye","Rize","Sakarya","Samsun","Şanlıurfa","Siirt","Sinop","Sivas","Şırnak","Tekirdağ","Tokat","Trabzon","Tunceli","Uşak","Van","Yalova","Yozgat","Zonguldak"];
