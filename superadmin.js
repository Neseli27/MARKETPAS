// =====================================================
// MarketPas v3 — Süper Admin Paneli
// =====================================================

var allMarkets = [];
var currentFilter = 'all';

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
  document.getElementById('sa-user').value = ''; document.getElementById('sa-pass').value = '';
}

function startPanel() {
  document.getElementById('sa-login').style.display = 'none';
  document.getElementById('sa-panel').style.display = 'block';
  loadMarkets();
}

// ─── Marketleri Yükle ────────────────────────────────
function loadMarkets() {
  db.collection('markets').orderBy('createdAt', 'desc').onSnapshot(function(snap) {
    allMarkets = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
    updateStats();
    renderMarkets();
  });
}

// ─── İstatistikler ───────────────────────────────────
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
      if (exp.getTime() < Date.now()) { expired++; } else { active++; }
    }
  });
  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-active').textContent = active;
  document.getElementById('stat-pending').textContent = pending;
  document.getElementById('stat-expired').textContent = expired;
}

// ─── Filtre ──────────────────────────────────────────
function saFilter(filter) {
  currentFilter = filter;
  document.querySelectorAll('.sa-filter').forEach(function(b) { b.classList.toggle('active', b.getAttribute('data-filter') === filter); });
  renderMarkets();
}

// ─── Render ──────────────────────────────────────────
function renderMarkets() {
  var list = document.getElementById('sa-list');
  list.innerHTML = '';

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

    // ── Üst bölüm: market adı + bilgiler ──
    var top = document.createElement('div');
    top.className = 'sa-card-top';

    var info = document.createElement('div');
    info.className = 'sa-card-info';

    // Market adı — büyük neon yeşil
    var nameEl = document.createElement('div');
    nameEl.className = 'sa-card-name';
    nameEl.textContent = m.name;
    var badgeEl = document.createElement('span');
    badgeEl.className = 'sa-badge ' + badge.cls;
    badgeEl.textContent = badge.text;
    nameEl.appendChild(document.createTextNode(' '));
    nameEl.appendChild(badgeEl);
    info.appendChild(nameEl);

    // Meta bilgiler
    var meta = document.createElement('div');
    meta.className = 'sa-card-meta';
    meta.innerHTML = '<span>📍 ' + escapeHtml(m.city || '—') + '</span>' +
      '<span>👤 ' + escapeHtml(m.ownerName || '—') + '</span>' +
      '<span>📧 ' + escapeHtml(m.ownerEmail || '—') + '</span>' +
      '<span>📞 ' + escapeHtml(m.ownerPhone || '—') + '</span>' +
      '<span>📅 ' + created + '</span>';
    info.appendChild(meta);

    top.appendChild(info);
    card.appendChild(top);

    // ── Lisans bilgi şeridi ──
    var licBar = document.createElement('div');
    licBar.className = 'sa-card-license-bar';

    if (m.licenseExpiry) {
      var days = getLicenseRemainingDays(m.licenseExpiry);
      var expDate = (m.licenseExpiry.toDate ? m.licenseExpiry.toDate() : new Date(m.licenseExpiry)).toLocaleDateString('tr-TR');

      if (days > 0) {
        licBar.innerHTML =
          '<span class="sa-license-pill active">✓ Aktif Lisans</span>' +
          '<span class="sa-license-days">' + days + ' gün kaldı</span>' +
          '<span class="sa-license-plan">' + (m.licenseDays || '—') + ' günlük plan</span>' +
          '<span class="sa-license-expiry">Bitiş: ' + expDate + '</span>';
      } else {
        licBar.innerHTML =
          '<span class="sa-license-pill expired">✗ Süresi Dolmuş</span>' +
          '<span class="sa-license-days" style="color:#DC2626">Süresi ' + Math.abs(days) + ' gün önce doldu</span>' +
          '<span class="sa-license-plan">' + (m.licenseDays || '—') + ' günlük plandı</span>' +
          '<span class="sa-license-expiry">Bitiş: ' + expDate + '</span>';
      }
    } else if (m.status === 'pending') {
      licBar.innerHTML = '<span class="sa-license-pill pending">⏳ Onay Bekliyor</span><span>Lisans henüz tanımlanmadı</span>';
    } else if (m.status === 'suspended') {
      licBar.innerHTML = '<span class="sa-license-pill suspended">⏸ Askıda</span><span>Hesap askıya alınmış</span>';
    } else {
      licBar.innerHTML = '<span class="sa-license-pill expired">— Lisans Yok</span><span>Henüz lisans tanımlanmadı</span>';
    }
    card.appendChild(licBar);

    // ── Aksiyon şeridi ──
    var actionsBar = document.createElement('div');
    actionsBar.className = 'sa-card-actions-bar';

    var licBtn = document.createElement('button');
    licBtn.className = 'sa-btn green';
    licBtn.textContent = '📋 Lisans Tanımla';
    licBtn.onclick = function() { openLicenseModal(m); };
    actionsBar.appendChild(licBtn);

    if (m.status === 'pending') {
      var appBtn = document.createElement('button');
      appBtn.className = 'sa-btn green';
      appBtn.textContent = '✓ Onayla';
      appBtn.onclick = function() { setStatus(m.id, 'active'); };
      actionsBar.appendChild(appBtn);
    }
    if (m.status === 'active') {
      var susBtn = document.createElement('button');
      susBtn.className = 'sa-btn orange';
      susBtn.textContent = '⏸ Askıya Al';
      susBtn.onclick = function() { if (confirm(m.name + ' askıya alınsın mı?')) setStatus(m.id, 'suspended'); };
      actionsBar.appendChild(susBtn);
    }
    if (m.status === 'suspended') {
      var actBtn = document.createElement('button');
      actBtn.className = 'sa-btn green';
      actBtn.textContent = '▶ Aktifleştir';
      actBtn.onclick = function() { setStatus(m.id, 'active'); };
      actionsBar.appendChild(actBtn);
    }

    var delBtn = document.createElement('button');
    delBtn.className = 'sa-btn red';
    delBtn.textContent = '🗑 Sil';
    delBtn.onclick = function() { if (confirm(m.name + ' silinsin mi? Bu işlem geri alınamaz.')) setStatus(m.id, 'deleted'); };
    actionsBar.appendChild(delBtn);

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
  } else {
    return { cls: 'expired', text: 'Lisans Yok' };
  }
  return { cls: 'active', text: 'Aktif' };
}

// ─── Durum Güncelle ──────────────────────────────────
async function setStatus(marketId, status) {
  try { await db.collection('markets').doc(marketId).update({ status: status }); }
  catch(e) { alert('Hata: ' + e.message); }
}

// ─── Lisans Modal ────────────────────────────────────
function openLicenseModal(market) {
  document.getElementById('modal-market-id').value = market.id;
  document.getElementById('modal-title').textContent = 'Lisans Tanımla';
  document.getElementById('modal-sub').textContent = market.name + ' — ' + (market.ownerEmail || '') +
    (market.licenseExpiry ? ' · Mevcut: ' + getLicenseRemainingDays(market.licenseExpiry) + ' gün kaldı' : ' · Lisans yok');
  document.getElementById('sa-modal').style.display = 'flex';
}

function closeModal() { document.getElementById('sa-modal').style.display = 'none'; }

async function setLicense(days) {
  var marketId = document.getElementById('modal-market-id').value;
  if (!marketId) return;
  try {
    var expiry = new Date();
    expiry.setDate(expiry.getDate() + days);
    await db.collection('markets').doc(marketId).update({
      licenseExpiry: firebase.firestore.Timestamp.fromDate(expiry),
      licenseDays: days, status: 'active'
    });
    closeModal();
  } catch(e) { alert('Hata: ' + e.message); }
}

document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('sa-login').style.display = 'flex';
});
