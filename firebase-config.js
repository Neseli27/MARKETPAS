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
// Kasa sayısına göre birim fiyat: kök fonksiyonu ile yumuşak düşüş
// Toplam fiyat HER ZAMAN artar — kademe atlama sorunu yok
// Formül: unitPrice = minPrice + (maxPrice - minPrice) / √kasaSayısı
function calculateUnitPrice(kasaSayisi, minPrice, maxPrice) {
  if (!kasaSayisi || kasaSayisi <= 0) return maxPrice;
  if (minPrice >= maxPrice) return minPrice;
  var price = minPrice + (maxPrice - minPrice) / Math.sqrt(kasaSayisi);
  return Math.round(price);
}

// Market için geçerli birim fiyat
// Birim fiyat günlük KULLANILAN kasa sayısına göre hesaplanır
// kasaLimit sadece maksimum kasa sınırıdır, fiyat indirimi için geçerli değildir
// Bu fonksiyon genel amaçlı — süper admin kartlarında kasaSayisi ile gösterim yapar
function getEffectiveUnitPrice(market, minPrice, maxPrice) {
  if (market.customPrice && market.customPrice > 0) return market.customPrice;
  return calculateUnitPrice(market.kasaSayisi || 0, minPrice, maxPrice);
}

// Günlük kullanıma dayalı gerçek maliyet hesabı
// dailyCount: o gün kullanılan kasa sayısı
function calculateDailyCost(dailyCount, minPrice, maxPrice) {
  if (!dailyCount || dailyCount <= 0) return 0;
  var unitPrice = calculateUnitPrice(dailyCount, minPrice, maxPrice);
  return unitPrice * dailyCount;
}

// ─── Günlük Kasa Kullanım Takibi ────────────────────
// Bir kasa işlem gördüğünde çağrılır. O kasayı bugünün kullanım kaydına yazar.
// Firestore: dailyUsage/{marketId}_{YYYY-MM-DD}
// { marketId, date, kasas: { "1": true, "3": true }, count: 2, lastUpdated }
function getTodayStr() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

async function logKasaUsage(marketId, kasaNo) {
  if (!marketId || !kasaNo) return;
  try {
    var today = getTodayStr();
    var docId = marketId + '_' + today;
    var ref = db.collection('dailyUsage').doc(docId);

    var doc = await ref.get();
    var kasas = {};
    if (doc.exists && doc.data().kasas) {
      kasas = doc.data().kasas;
    }

    // Bu kasa zaten kaydedildiyse tekrar yazma
    if (kasas[String(kasaNo)]) return;

    // Yeni kasayı ekle
    kasas[String(kasaNo)] = true;
    var count = Object.keys(kasas).length;

    // Fiyatlandırma bilgisini al ve günlük maliyeti hesapla
    var unitPrice = 0, dailyCost = 0;
    try {
      var pricingDoc = await db.collection('config').doc('pricing').get();
      var min = 20, max = 50;
      if (pricingDoc.exists) { min = pricingDoc.data().minPrice || 20; max = pricingDoc.data().maxPrice || 50; }
      // Özel fiyat kontrolü
      var mDoc = await db.collection('markets').doc(marketId).get();
      if (mDoc.exists && mDoc.data().customPrice > 0) {
        unitPrice = mDoc.data().customPrice;
      } else {
        unitPrice = calculateUnitPrice(count, min, max);
      }
      dailyCost = unitPrice * count;
    } catch(pe) {}

    await ref.set({
      marketId: marketId,
      date: today,
      kasas: kasas,
      count: count,
      unitPrice: unitPrice,
      dailyCost: dailyCost,
      lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    console.log('MarketPas: Kasa ' + kasaNo + ' bugün kullanıldı → ' + count + ' kasa aktif, birim: ' + unitPrice + '₺, günlük: ' + dailyCost + '₺');
  } catch(e) { console.warn('MarketPas logKasaUsage hata:', e); }
}

// Bir marketin belirli ay içindeki kullanım özetini al
// Döndürür: { totalDays, totalKasaDays, avgKasaPerDay, dailyDetails: [...] }
async function getMonthlyUsage(marketId, year, month) {
  var prefix = marketId + '_' + year + '-' + String(month).padStart(2,'0');
  var result = { totalDays: 0, totalKasaDays: 0, avgKasaPerDay: 0, dailyDetails: [] };
  try {
    var snap = await db.collection('dailyUsage')
      .where('marketId', '==', marketId)
      .where('date', '>=', year + '-' + String(month).padStart(2,'0') + '-01')
      .where('date', '<=', year + '-' + String(month).padStart(2,'0') + '-31')
      .orderBy('date', 'asc').get();
    snap.forEach(function(doc) {
      var d = doc.data();
      result.totalDays++;
      result.totalKasaDays += d.count || 0;
      result.dailyDetails.push({ date: d.date, count: d.count || 0, kasas: d.kasas || {} });
    });
    result.avgKasaPerDay = result.totalDays > 0 ? Math.round(result.totalKasaDays / result.totalDays * 10) / 10 : 0;
  } catch(e) { console.warn('getMonthlyUsage hata:', e); }
  return result;
}

// Bugünkü kullanım sayısını al (hızlı)
async function getTodayUsage(marketId) {
  try {
    var doc = await db.collection('dailyUsage').doc(marketId + '_' + getTodayStr()).get();
    if (doc.exists) return doc.data().count || 0;
  } catch(e) {}
  return 0;
}

// ─── Türkiye Şehirleri ───────────────────────────────
var TURKEY_CITIES = ["Adana","Adıyaman","Afyonkarahisar","Ağrı","Aksaray","Amasya","Ankara","Antalya","Ardahan","Artvin","Aydın","Balıkesir","Bartın","Batman","Bayburt","Bilecik","Bingöl","Bitlis","Bolu","Burdur","Bursa","Çanakkale","Çankırı","Çorum","Denizli","Diyarbakır","Düzce","Edirne","Elazığ","Erzincan","Erzurum","Eskişehir","Gaziantep","Giresun","Gümüşhane","Hakkâri","Hatay","Iğdır","Isparta","İstanbul","İzmir","Kahramanmaraş","Karabük","Karaman","Kars","Kastamonu","Kayseri","Kilis","Kırıkkale","Kırklareli","Kırşehir","Kocaeli","Konya","Kütahya","Malatya","Manisa","Mardin","Mersin","Muğla","Muş","Nevşehir","Niğde","Ordu","Osmaniye","Rize","Sakarya","Samsun","Şanlıurfa","Siirt","Sinop","Sivas","Şırnak","Tekirdağ","Tokat","Trabzon","Tunceli","Uşak","Van","Yalova","Yozgat","Zonguldak"];
// ═══ GLOBAL MODAL SİSTEMİ ═══════════════════════════
// Tüm sayfalarda kullanılır — alert() ve confirm() yerine
(function(){
  // Modal container'ı oluştur
  var css=document.createElement('style');
  css.textContent='.mp-modal-overlay{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;padding:20px;animation:mpModalFade .2s ease;font-family:"DM Sans","Outfit",sans-serif}.mp-modal-box{background:#151c2c;border:1px solid #1e293b;border-radius:18px;padding:28px 24px;max-width:340px;width:100%;text-align:center;animation:mpModalPop .3s cubic-bezier(.34,1.56,.64,1);box-shadow:0 20px 60px rgba(0,0,0,.5)}.mp-modal-icon{font-size:36px;margin-bottom:10px}.mp-modal-msg{font-size:15px;font-weight:600;color:#f1f5f9;line-height:1.5;margin-bottom:20px}.mp-modal-btns{display:flex;gap:10px}.mp-modal-btn{flex:1;padding:13px;border-radius:12px;font-size:14px;font-weight:700;cursor:pointer;border:none;transition:all .15s;font-family:inherit}.mp-modal-btn:active{transform:scale(.96)}.mp-modal-btn.cancel{background:#1e293b;color:#94a3b8}.mp-modal-btn.ok{background:#10e5b0;color:#0a0f1a}.mp-modal-btn.danger{background:#ef4444;color:#fff}@keyframes mpModalFade{from{opacity:0}to{opacity:1}}@keyframes mpModalPop{from{transform:scale(.5);opacity:0}to{transform:scale(1);opacity:1}}@media(prefers-color-scheme:light){.mp-modal-box{background:#fff;border-color:#e2e8f0;box-shadow:0 20px 60px rgba(0,0,0,.15)}.mp-modal-msg{color:#0f172a}.mp-modal-btn.cancel{background:#f0f2f5;color:#64748b}}';
  document.head.appendChild(css);

  // mpAlert — alert() yerine
  window.mpAlert=function(msg,icon){
    return new Promise(function(resolve){
      var ov=document.createElement('div');ov.className='mp-modal-overlay';
      ov.innerHTML='<div class="mp-modal-box">'+(icon?'<div class="mp-modal-icon">'+icon+'</div>':'')+
        '<div class="mp-modal-msg">'+msg+'</div>'+
        '<div class="mp-modal-btns"><button class="mp-modal-btn ok" id="mp-ok">Tamam</button></div></div>';
      document.body.appendChild(ov);
      ov.querySelector('#mp-ok').onclick=function(){ov.remove();resolve()};
      ov.querySelector('#mp-ok').focus();
    });
  };

  // mpConfirm — confirm() yerine
  // mpConfirm(msg, icon, confirmText, cancelText)
  window.mpConfirm=function(msg,icon,confirmText,cancelText){
    return new Promise(function(resolve){
      var yesLabel=confirmText||'Evet';
      var noLabel=cancelText||'Vazgeç';
      var ov=document.createElement('div');ov.className='mp-modal-overlay';
      ov.innerHTML='<div class="mp-modal-box">'+(icon?'<div class="mp-modal-icon">'+icon+'</div>':'')+
        '<div class="mp-modal-msg">'+msg+'</div>'+
        '<div class="mp-modal-btns"><button class="mp-modal-btn cancel" id="mp-no">'+noLabel+'</button><button class="mp-modal-btn danger" id="mp-yes">'+yesLabel+'</button></div></div>';
      document.body.appendChild(ov);
      ov.querySelector('#mp-no').onclick=function(){ov.remove();resolve(false)};
      ov.querySelector('#mp-yes').onclick=function(){ov.remove();resolve(true)};
      ov.onclick=function(e){if(e.target===ov){ov.remove();resolve(false)}};
    });
  };

  // mpSuccess — başarı bildirimi (otomatik kapanır)
  window.mpSuccess=function(msg,icon){
    var ov=document.createElement('div');ov.className='mp-modal-overlay';
    ov.innerHTML='<div class="mp-modal-box">'+(icon?'<div class="mp-modal-icon">'+icon+'</div>':'<div class="mp-modal-icon">✅</div>')+
      '<div class="mp-modal-msg">'+msg+'</div></div>';
    document.body.appendChild(ov);
    ov.onclick=function(){ov.remove()};
    setTimeout(function(){if(ov.parentNode)ov.remove()},2000);
  };
})();
