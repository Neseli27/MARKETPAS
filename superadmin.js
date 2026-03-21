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

  // Süper admin doğrulama — Firestore'dan oku
  try {
    var saDoc = await db.collection('config').doc('superadmin').get();
    if (!saDoc.exists) {
      // İlk kurulum — hash'i oluştur ve kaydet
      if (user === 'marketpas_admin' && pass.length >= 8) {
        await db.collection('config').doc('superadmin').set({ username: user, passwordHash: passHash });
        startPanel();
        return;
      }
      errEl.textContent = 'Süper admin henüz tanımlı değil. Kullanıcı: marketpas_admin, en az 8 karakter şifre girin.';
      errEl.style.display = 'block'; return;
    }

    var sa = saDoc.data();
    if (sa.username !== user || sa.passwordHash !== passHash) {
      errEl.textContent = 'Geçersiz kullanıcı adı veya şifre.'; errEl.style.display = 'block'; return;
    }

    startPanel();
  } catch(e) {
    errEl.textContent = 'Bağlantı hatası.'; errEl.style.display = 'block';
  }
}

function saLogout() {
  document.getElementById('sa-panel').style.display = 'none';
  document.getElementById('sa-login').style.display = 'flex';
  document.getElementById('sa-user').value = '';
  document.getElementById('sa-pass').value = '';
}

function startPanel() {
  document.getElementById('sa-login').style.display = 'none';
  document.getElementById('sa-panel').style.display = 'block';
  loadMarkets();
}

// ─── Marketleri Yükle (canlı) ────────────────────────
function loadMarkets() {
  db.collection('markets').orderBy('createdAt', 'desc').onSnapshot(function(snap) {
    allMarkets = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
    renderMarkets();
  });
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

    // Badge
    var badge = getBadge(m);

    // Kalan gün
    var remaining = '';
    if (m.licenseExpiry) {
      var days = getLicenseRemainingDays(m.licenseExpiry);
      remaining = days > 0 ? days + ' gün kaldı' : 'Süresi dolmuş';
    } else {
      remaining = 'Lisans yok';
    }

    // Tarih
    var created = m.createdAt?.toDate ? m.createdAt.toDate().toLocaleDateString('tr-TR') : '—';

    card.innerHTML = '<div class="sa-card-info">' +
      '<div class="sa-card-name">' + escapeHtml(m.name) + ' <span class="sa-badge ' + badge.cls + '">' + badge.text + '</span></div>' +
      '<div class="sa-card-meta">' +
        '<span>📍 ' + escapeHtml(m.city || '—') + '</span>' +
        '<span>👤 ' + escapeHtml(m.ownerName || '—') + '</span>' +
        '<span>📧 ' + escapeHtml(m.ownerEmail || '—') + '</span>' +
        '<span>📞 ' + escapeHtml(m.ownerPhone || '—') + '</span>' +
      '</div>' +
      '<div class="sa-card-license">📅 Kayıt: ' + created + ' · ' + remaining + (m.licenseDays ? ' (' + m.licenseDays + ' gün plan)' : '') + '</div>' +
    '</div>';

    // Aksiyonlar
    var actions = document.createElement('div');
    actions.className = 'sa-card-actions';

    // Lisans tanımla butonu
    var licBtn = document.createElement('button');
    licBtn.className = 'sa-btn green';
    licBtn.textContent = '📋 Lisans';
    licBtn.onclick = function() { openLicenseModal(m); };
    actions.appendChild(licBtn);

    // Durum butonları
    if (m.status === 'pending') {
      var appBtn = document.createElement('button');
      appBtn.className = 'sa-btn green';
      appBtn.textContent = '✓ Onayla';
      appBtn.onclick = function() { setStatus(m.id, 'active'); };
      actions.appendChild(appBtn);
    }

    if (m.status === 'active') {
      var susBtn = document.createElement('button');
      susBtn.className = 'sa-btn orange';
      susBtn.textContent = '⏸ Askıya Al';
      susBtn.onclick = function() { if (confirm(m.name + ' askıya alınsın mı?')) setStatus(m.id, 'suspended'); };
      actions.appendChild(susBtn);
    }

    if (m.status === 'suspended') {
      var actBtn = document.createElement('button');
      actBtn.className = 'sa-btn green';
      actBtn.textContent = '▶ Aktifleştir';
      actBtn.onclick = function() { setStatus(m.id, 'active'); };
      actions.appendChild(actBtn);
    }

    var delBtn = document.createElement('button');
    delBtn.className = 'sa-btn red';
    delBtn.textContent = '🗑 Sil';
    delBtn.onclick = function() { if (confirm(m.name + ' silinsin mi? Bu işlem geri alınamaz.')) setStatus(m.id, 'deleted'); };
    actions.appendChild(delBtn);

    card.appendChild(actions);
    list.appendChild(card);
  });
}

function getBadge(m) {
  if (m.status === 'pending') return { cls: 'pending', text: 'Onay Bekliyor' };
  if (m.status === 'suspended') return { cls: 'suspended', text: 'Askıda' };
  if (m.status === 'deleted') return { cls: 'suspended', text: 'Silindi' };
  // Active ama süresi dolmuş?
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
  try {
    await db.collection('markets').doc(marketId).update({ status: status });
  } catch(e) { alert('Hata: ' + e.message); }
}

// ─── Lisans Modal ────────────────────────────────────
function openLicenseModal(market) {
  document.getElementById('modal-market-id').value = market.id;
  document.getElementById('modal-title').textContent = 'Lisans Tanımla';
  document.getElementById('modal-sub').textContent = market.name + ' — ' + (market.ownerEmail || '');
  document.getElementById('sa-modal').style.display = 'flex';
}

function closeModal() {
  document.getElementById('sa-modal').style.display = 'none';
}

async function setLicense(days) {
  var marketId = document.getElementById('modal-market-id').value;
  if (!marketId) return;
  try {
    var expiry = new Date();
    expiry.setDate(expiry.getDate() + days);

    await db.collection('markets').doc(marketId).update({
      licenseExpiry: firebase.firestore.Timestamp.fromDate(expiry),
      licenseDays: days,
      status: 'active'  // Lisans verildiğinde otomatik aktif
    });
    closeModal();
  } catch(e) { alert('Hata: ' + e.message); }
}

document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('sa-login').style.display = 'flex';
});
