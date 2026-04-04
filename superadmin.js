// =====================================================
// MarketPas v3 — Süper Admin Paneli (Fiyatlandırma)
// =====================================================

var allMarkets = [];
var currentFilter = 'all';
var pricingData = { minPrice: 20, maxPrice: 50 }; // varsayılan

// ─── Giriş ───────────────────────────────────────────
async function saLogin() {
  var user = document.getElementById('sa-user').value.trim();
  var pass = document.getElementById('sa-pass').value;
  var errEl = document.getElementById('sa-login-error');
  errEl.style.display = 'none';
  if (!user || !pass) { errEl.textContent = 'Kullanıcı adı ve şifre girin.'; errEl.style.display = 'block'; return; }
  var passHash = await hashPassword(pass);
  try {
    var saDoc = await db.collection('config').doc('superadmin').get();
    if (!saDoc.exists) {
      if (user === 'marketpas_admin' && pass.length >= 8) {
        await db.collection('config').doc('superadmin').set({ username: user, passwordHash: passHash });
        startPanel(); return;
      }
      errEl.textContent = 'İlk kurulum: Kullanıcı "marketpas_admin", en az 8 karakter şifre girin.'; errEl.style.display = 'block'; return;
    }
    var sa = saDoc.data();
    if (sa.username !== user || sa.passwordHash !== passHash) {
      errEl.textContent = 'Geçersiz kullanıcı adı veya şifre.'; errEl.style.display = 'block'; return;
    }
    startPanel();
  } catch(e) { errEl.textContent = 'Bağlantı hatası.'; errEl.style.display = 'block'; }
}

function saLogout() {
  document.getElementById('sa-panel').style.display = 'none';
  document.getElementById('sa-login').style.display = 'flex';
}

function startPanel() {
  document.getElementById('sa-login').style.display = 'none';
  document.getElementById('sa-panel').style.display = 'block';
  loadPricing();
  loadMarkets();
}

// ═══════════════════════════════════════════════════════
// FİYATLANDIRMA
// ═══════════════════════════════════════════════════════

function togglePricingPanel() {
  var panel = document.getElementById('pricing-panel');
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

async function loadPricing() {
  try {
    var doc = await db.collection('config').doc('pricing').get();
    if (doc.exists) {
      pricingData = doc.data();
    }
    document.getElementById('price-min').value = pricingData.minPrice || 20;
    document.getElementById('price-max').value = pricingData.maxPrice || 50;
    renderPricingPreview();
  } catch(e) {}
}

async function savePricing() {
  var min = parseInt(document.getElementById('price-min').value) || 20;
  var max = parseInt(document.getElementById('price-max').value) || 50;
  if (min >= max) { mpAlert('Min fiyat, max fiyattan küçük olmalı.', '⚠️'); return; }
  if (min < 1) { mpAlert('Min fiyat en az 1 TL olmalı.', '⚠️'); return; }

  pricingData = { minPrice: min, maxPrice: max };
  try {
    await db.collection('config').doc('pricing').set(pricingData);
    renderPricingPreview();
    renderMarkets();
    mpSuccess('Fiyatlandırma kaydedildi.', '💰');
  } catch(e) { mpAlert('Hata: ' + e.message, '❌'); }
}

function renderPricingPreview() {
  var container = document.getElementById('pricing-preview');
  var min = pricingData.minPrice || 20;
  var max = pricingData.maxPrice || 50;

  var tiers = [
    { range: '1-2 kasa', count: 2 },
    { range: '3-5 kasa', count: 4 },
    { range: '6-10 kasa', count: 8 },
    { range: '11-20 kasa', count: 15 },
    { range: '20+ kasa', count: 25 }
  ];

  var html = '<div class="pricing-preview-title">Kademe Önizleme</div><div class="pricing-preview-grid">';
  tiers.forEach(function(t) {
    var price = calculateUnitPrice(t.count, min, max);
    var daily = price * t.count;
    var monthly = daily * 30;
    html += '<div class="pricing-tier">' +
      '<div class="pricing-tier-range">' + t.range + '</div>' +
      '<div class="pricing-tier-price">' + price + ' ₺</div>' +
      '<div class="pricing-tier-daily">' + daily + ' ₺/gün</div>' +
      '<div class="pricing-tier-daily">' + (monthly >= 1000 ? (monthly/1000).toFixed(1) + 'K' : monthly) + ' ₺/ay</div>' +
    '</div>';
  });
  html += '</div>';
  // Günübirlik paketi bilgisi
  html += '<div style="margin-top:12px;padding:10px 14px;background:#FFF7ED;border:1px solid #FB923C;border-radius:8px;display:flex;align-items:center;gap:12px">';
  html += '<span style="font-size:18px">⚡</span>';
  html += '<div><div style="font-size:13px;font-weight:700;color:#C2410C">Günübirlik Paket</div>';
  html += '<div style="font-size:12px;color:#9A3412">Sabit 500 ₺ / gün — kasa sayısından bağımsız. Bayram, hafta sonu gibi özel günler için.</div></div>';
  html += '</div>';
  container.innerHTML = html;
}

// ═══════════════════════════════════════════════════════
// MARKET LİSTESİ
// ═══════════════════════════════════════════════════════

function loadMarkets() {
  db.collection('markets').orderBy('createdAt', 'desc').onSnapshot(function(snap) {
    allMarkets = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
    updateStats();
    renderMarkets();
  });
}

function updateStats() {
  var total = 0, active = 0, pending = 0, expired = 0;
  allMarkets.forEach(function(m) {
    if (m.status === 'deleted') return;
    total++;
    if (m.status === 'pending') { pending++; return; }
    if (m.status === 'suspended') return;
    if (m.status === 'active') {
      if (!m.licenseExpiry) { expired++; return; }
      var exp = m.licenseExpiry.toDate ? m.licenseExpiry.toDate() : new Date(m.licenseExpiry);
      if (exp.getTime() < Date.now()) expired++; else active++;
    }
  });
  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-active').textContent = active;
  document.getElementById('stat-pending').textContent = pending;
  document.getElementById('stat-expired').textContent = expired;
}

function saFilter(filter) {
  currentFilter = filter;
  document.querySelectorAll('.sa-filter').forEach(function(b) { b.classList.toggle('active', b.getAttribute('data-filter') === filter); });
  renderMarkets();
}

function renderMarkets() {
  var list = document.getElementById('sa-list');
  list.innerHTML = '';
  var min = pricingData.minPrice || 20;
  var max = pricingData.maxPrice || 50;

  var filtered = allMarkets.filter(function(m) {
    if (currentFilter === 'all') return m.status !== 'deleted';
    if (currentFilter === 'expired') {
      if (m.status !== 'active') return false;
      if (!m.licenseExpiry) return true;
      var exp = m.licenseExpiry.toDate ? m.licenseExpiry.toDate() : new Date(m.licenseExpiry);
      return exp.getTime() < Date.now();
    }
    return m.status === currentFilter;
  });

  document.getElementById('sa-count').textContent = filtered.length + ' market';

  if (!filtered.length) {
    list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text3)">Bu kategoride market yok.</div>';
    return;
  }

  filtered.forEach(function(m) {
    var card = document.createElement('div');
    card.className = 'sa-card';
    var badge = getBadge(m);
    var created = m.createdAt?.toDate ? m.createdAt.toDate().toLocaleDateString('tr-TR') : '—';

    // ── Üst: market adı + bilgiler ──
    var top = document.createElement('div'); top.className = 'sa-card-top';
    var info = document.createElement('div'); info.className = 'sa-card-info';

    var nameEl = document.createElement('div'); nameEl.className = 'sa-card-name';
    nameEl.textContent = m.name;
    var badgeEl = document.createElement('span'); badgeEl.className = 'sa-badge ' + badge.cls; badgeEl.textContent = badge.text;
    nameEl.appendChild(document.createTextNode(' ')); nameEl.appendChild(badgeEl);
    info.appendChild(nameEl);

    var meta = document.createElement('div'); meta.className = 'sa-card-meta';
    meta.innerHTML = '<span>📍 ' + escapeHtml(m.city || '—') + '</span><span>👤 ' + escapeHtml(m.ownerName || '—') + '</span><span>📧 ' + escapeHtml(m.ownerEmail || '—') + '</span><span>📞 ' + escapeHtml(m.ownerPhone || '—') + '</span><span>📅 ' + created + '</span><span>🖥 ' + (m.kasaSayisi || 0) + ' kasa</span>';
    info.appendChild(meta);
    top.appendChild(info);
    card.appendChild(top);

    // ── Lisans bilgi şeridi ──
    var licBar = document.createElement('div'); licBar.className = 'sa-card-license-bar';
    if (m.licenseExpiry) {
      var days = getLicenseRemainingDays(m.licenseExpiry);
      var expDate = (m.licenseExpiry.toDate ? m.licenseExpiry.toDate() : new Date(m.licenseExpiry)).toLocaleDateString('tr-TR');
      var planName = m.licenseDays === 1 ? 'Günübirlik · 500 ₺' : (m.licenseDays || '—') + ' günlük plan';
      if (days > 0) {
        licBar.innerHTML = '<span class="sa-license-pill active">✓ Aktif</span><span class="sa-license-days">' + days + ' gün kaldı</span><span class="sa-license-plan">' + planName + '</span><span class="sa-license-expiry">Bitiş: ' + expDate + '</span>';
      } else {
        licBar.innerHTML = '<span class="sa-license-pill expired">✗ Dolmuş</span><span class="sa-license-days" style="color:#DC2626">' + Math.abs(days) + ' gün önce doldu</span><span class="sa-license-expiry">Bitiş: ' + expDate + '</span>';
      }
    } else if (m.status === 'pending') {
      licBar.innerHTML = '<span class="sa-license-pill pending">⏳ Onay Bekliyor</span>';
    } else {
      licBar.innerHTML = '<span class="sa-license-pill expired">— Lisans Yok</span>';
    }
    card.appendChild(licBar);

    // ── Fiyat şeridi ──
    var priceBar = document.createElement('div'); priceBar.className = 'sa-card-price-bar';
    var unitPrice = getEffectiveUnitPrice(m, min, max);
    var kasaCount = m.kasaSayisi || 0;
    var isCustom = m.customPrice && m.customPrice > 0;
    var dailyTotal = unitPrice * kasaCount;
    var monthlyTotal = dailyTotal * 30;

    priceBar.innerHTML =
      '<span class="price-tag ' + (isCustom ? 'custom' : '') + '">' + (isCustom ? '✎ Özel: ' : '') + unitPrice + ' ₺/kasa/gün</span>' +
      '<span class="price-daily">Günlük: ' + dailyTotal + ' ₺</span>' +
      '<span class="price-monthly">Aylık: ~' + (monthlyTotal >= 1000 ? (monthlyTotal/1000).toFixed(1) + 'K' : monthlyTotal) + ' ₺</span>';

    card.appendChild(priceBar);

    // ── Aksiyon şeridi ──
    var actionsBar = document.createElement('div'); actionsBar.className = 'sa-card-actions-bar';

    var licBtn = document.createElement('button'); licBtn.className = 'sa-btn green'; licBtn.textContent = '📋 Lisans';
    licBtn.onclick = function() { openLicenseModal(m); }; actionsBar.appendChild(licBtn);

    var prBtn = document.createElement('button'); prBtn.className = 'sa-btn'; prBtn.style.cssText = 'background:#EFF6FF;color:#2563EB;border-color:rgba(37,99,235,.2)';
    prBtn.textContent = '💰 Fiyat';
    prBtn.onclick = function() { openPriceModal(m); }; actionsBar.appendChild(prBtn);

    if (m.status === 'pending') {
      var appBtn = document.createElement('button'); appBtn.className = 'sa-btn green'; appBtn.textContent = '✓ Onayla';
      appBtn.onclick = function() { setStatus(m.id, 'active'); }; actionsBar.appendChild(appBtn);
    }
    if (m.status === 'active') {
      var susBtn = document.createElement('button'); susBtn.className = 'sa-btn orange'; susBtn.textContent = '⏸ Askıya Al';
      susBtn.onclick = async function() { if (await mpConfirm(m.name + ' askıya alınsın mı?', '⏸')) setStatus(m.id, 'suspended'); }; actionsBar.appendChild(susBtn);
    }
    if (m.status === 'suspended') {
      var actBtn = document.createElement('button'); actBtn.className = 'sa-btn green'; actBtn.textContent = '▶ Aktifleştir';
      actBtn.onclick = function() { setStatus(m.id, 'active'); }; actionsBar.appendChild(actBtn);
    }
    var delBtn = document.createElement('button'); delBtn.className = 'sa-btn red'; delBtn.textContent = '🗑 Sil';
    delBtn.onclick = async function() { if (await mpConfirm(m.name + ' silinsin mi?', '🗑️')) setStatus(m.id, 'deleted'); }; actionsBar.appendChild(delBtn);

    card.appendChild(actionsBar);
    list.appendChild(card);
  });
}

function getBadge(m) {
  if (m.status === 'pending') return { cls: 'pending', text: 'Onay Bekliyor' };
  if (m.status === 'suspended') return { cls: 'suspended', text: 'Askıda' };
  if (m.status === 'deleted') return { cls: 'suspended', text: 'Silindi' };
  if (m.licenseExpiry) {
    var exp = m.licenseExpiry.toDate ? m.licenseExpiry.toDate() : new Date(m.licenseExpiry);
    if (exp.getTime() < Date.now()) return { cls: 'expired', text: 'Süresi Dolmuş' };
  } else { return { cls: 'expired', text: 'Lisans Yok' }; }
  return { cls: 'active', text: 'Aktif' };
}

async function setStatus(marketId, status) {
  try { await db.collection('markets').doc(marketId).update({ status: status }); }
  catch(e) { mpAlert('Hata: ' + e.message, '❌'); }
}

// ═══════════════════════════════════════════════════════
// LİSANS MODAL
// ═══════════════════════════════════════════════════════

function openLicenseModal(market) {
  document.getElementById('modal-market-id').value = market.id;
  document.getElementById('modal-sub').textContent = market.name + ' — ' + (market.ownerEmail || '') +
    (market.licenseExpiry ? ' · Mevcut: ' + getLicenseRemainingDays(market.licenseExpiry) + ' gün kaldı' : ' · Lisans yok');
  document.getElementById('sa-modal').style.display = 'flex';
}
function closeModal() { document.getElementById('sa-modal').style.display = 'none'; }

async function setLicense(days) {
  var mId = document.getElementById('modal-market-id').value;
  if (!mId) return;

  var label = days === 1 ? 'Günübirlik (500 ₺)' : days + ' günlük';
  if (!(await mpConfirm(label + ' lisans tanımlanacak. Onaylıyor musunuz?', '📋'))) return;

  try {
    var expiry = new Date();
    if (days === 1) {
      expiry.setHours(23, 59, 59, 999);
    } else {
      expiry.setDate(expiry.getDate() + days);
      expiry.setHours(23, 59, 59, 999);
    }
    await db.collection('markets').doc(mId).update({
      licenseExpiry: firebase.firestore.Timestamp.fromDate(expiry),
      licenseDays: days,
      licenseType: days === 1 ? 'daily' : 'standard',
      status: 'active'
    });
    closeModal();
    mpSuccess(label + ' lisans tanımlandı.', '✅');
  } catch(e) { mpAlert('Hata: ' + e.message, '❌'); }
}

// ═══════════════════════════════════════════════════════
// ÖZEL FİYAT MODAL
// ═══════════════════════════════════════════════════════

function openPriceModal(market) {
  document.getElementById('price-modal-market-id').value = market.id;
  document.getElementById('price-modal-sub').textContent = market.name + ' — ' + (market.kasaSayisi || 0) + ' kasa';
  document.getElementById('price-modal-value').value = market.customPrice || '';

  var min = pricingData.minPrice || 20;
  var max = pricingData.maxPrice || 50;
  var autoPrice = calculateUnitPrice(market.kasaSayisi || 0, min, max);
  var kasaCount = market.kasaSayisi || 0;

  document.getElementById('price-modal-preview').innerHTML =
    '<strong>Otomatik fiyat:</strong> ' + autoPrice + ' ₺/kasa/gün' +
    (kasaCount > 0 ? ' → Günlük ' + (autoPrice * kasaCount) + ' ₺, Aylık ~' + (autoPrice * kasaCount * 30) + ' ₺' : '') +
    (market.customPrice ? '<br><strong>Mevcut özel fiyat:</strong> ' + market.customPrice + ' ₺/kasa/gün' : '');

  document.getElementById('price-modal').style.display = 'flex';
}

function closePriceModal() { document.getElementById('price-modal').style.display = 'none'; }

async function saveCustomPrice() {
  var mId = document.getElementById('price-modal-market-id').value;
  var val = parseInt(document.getElementById('price-modal-value').value) || 0;
  try {
    await db.collection('markets').doc(mId).update({ customPrice: val });
    closePriceModal();
    mpSuccess('Özel fiyat kaydedildi.', '💰');
  } catch(e) { mpAlert('Hata: ' + e.message, '❌'); }
}

document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('sa-login').style.display = 'flex';
});
