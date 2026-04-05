// AccessDesk Self-Service Portal
const API = '/api';
let catalog = [];
let employeeProfile = null;
let activeCategory = 'All';
let myPendingRequests = []; // track requests the current employee has pending

// --- API ---
async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Error ${res.status}`);
  return data;
}
function getEmpId() { return document.getElementById('employeeId')?.value.trim() || 'emp-001'; }
function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg; el.className = `toast ${type}`;
  setTimeout(() => el.classList.add('hidden'), 3000);
}
function badge(status) { return `<span class="badge badge-${status}">${status.replace(/_/g, ' ')}</span>`; }
function timeAgo(iso) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now'; if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60); if (h < 24) return h + 'h ago'; return Math.floor(h / 24) + 'd ago';
}

// --- Icon map using real product logos (CDN) ---
const ICONS = {
  office365: 'https://img.icons8.com/color/96/microsoft-office-2019.png',
  figma: 'https://img.icons8.com/color/96/figma.png',
  github: 'https://img.icons8.com/ios-glyphs/96/github.png',
  jira: 'https://img.icons8.com/color/96/jira.png',
  slack: 'https://img.icons8.com/color/96/slack-new.png',
  camtasia: 'https://img.icons8.com/color/96/camtasia-studio.png',
  salesforce: 'https://img.icons8.com/color/96/salesforce.png',
  datadog: 'https://img.icons8.com/color/96/datadog.png',
  zoom: 'https://img.icons8.com/color/96/zoom.png',
  adobe: 'https://img.icons8.com/color/96/adobe-creative-cloud.png',
};
function iconImg(key) {
  const url = ICONS[key];
  if (url) return `<img src="${url}" alt="${key}" style="width:64px;height:64px;object-fit:contain;">`;
  return `<span style="font-size:48px;">📦</span>`;
}

// --- Check if employee can auto-install a tool ---
function canAutoInstall(entry) {
  if (entry.requiresApprovalAlways) return false;
  if (!employeeProfile) return false;
  return entry.autoGrantJobLevels.includes(employeeProfile.jobLevel);
}
function isInstalled(entry) {
  if (!employeeProfile) return false;
  return employeeProfile.grantedAccess?.some(g => g.toolName === entry.toolName && g.accessLevel === entry.accessLevel);
}
function isPendingApproval(entry) {
  return myPendingRequests.some(r => r.toolName === entry.toolName && r.accessLevel === entry.accessLevel && r.status === 'pending_approval');
}

// --- Load data ---
async function loadCatalog() { try { catalog = await api('/catalog'); } catch { catalog = []; } }
async function loadProfile() {
  try { employeeProfile = await api(`/employees/${getEmpId()}/profile`); } catch { employeeProfile = null; }
}
async function loadMyPendingRequests() {
  try { myPendingRequests = await api(`/requests?employeeId=${getEmpId()}`); } catch { myPendingRequests = []; }
}

// --- Navigation ---
function switchView(view) {
  document.querySelectorAll('.nav-link').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.cat-item').forEach(c => c.classList.remove('active'));
  const link = document.querySelector(`[data-view="${view}"]`);
  if (link) link.classList.add('active');
  const el = document.getElementById(`view-${view}`);
  if (el) { el.classList.add('active'); }
  if (view === 'catalog') renderCatalog();
  else if (view === 'notifications') renderNotifications();
  else if (view === 'history') renderHistory();
}

document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', () => switchView(link.dataset.view));
});

// Employee ID change reloads profile + catalog
document.getElementById('employeeId')?.addEventListener('change', async () => {
  await loadProfile();
  await loadMyPendingRequests();
  renderCatalog();
});

// --- Catalog View ---
function renderCategories() {
  const cats = ['All', ...new Set(catalog.map(c => c.category).filter(Boolean))];
  const el = document.getElementById('categories');
  el.innerHTML = cats.map(c =>
    `<a class="cat-item${c === activeCategory ? ' active' : ''}" data-cat="${c}">${c}</a>`
  ).join('');
  el.querySelectorAll('.cat-item').forEach(item => {
    item.addEventListener('click', () => {
      activeCategory = item.dataset.cat;
      // Switch back to catalog view if on another view
      document.querySelectorAll('.nav-link').forEach(n => n.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      document.getElementById('view-catalog').classList.add('active');
      renderCatalog();
    });
  });
}

function renderCatalog() {
  const el = document.getElementById('view-catalog');
  const search = document.getElementById('searchInput')?.value.toLowerCase() || '';
  let filtered = catalog;
  if (activeCategory !== 'All') filtered = filtered.filter(c => c.category === activeCategory);
  if (search) filtered = filtered.filter(c => c.toolName.toLowerCase().includes(search) || (c.description || '').toLowerCase().includes(search));

  renderCategories();

  // Mark active category in sidebar
  document.querySelectorAll('.cat-item').forEach(c => {
    c.classList.toggle('active', c.dataset.cat === activeCategory);
  });

  if (filtered.length === 0) {
    el.innerHTML = `<div class="section-header"><h1>${activeCategory}</h1></div>
      <div class="empty-state"><div class="icon">📦</div><p>No software found</p></div>`;
    return;
  }

  el.innerHTML = `
    <div class="section-header"><h1>${activeCategory === 'All' ? 'Software Catalog' : activeCategory}</h1>
    <p>${filtered.length} application${filtered.length > 1 ? 's' : ''} available</p></div>
    <div class="software-grid">
      ${filtered.map(c => {
        const installed = isInstalled(c);
        const autoInstall = canAutoInstall(c);
        const pending = isPendingApproval(c);
        const pendingReq = myPendingRequests.find(r => r.toolName === c.toolName && r.accessLevel === c.accessLevel && r.status === 'pending_approval');
        let btnHtml;
        if (installed) {
          btnHtml = `<button class="btn btn-installed" disabled>✓ Installed</button>`;
        } else if (pending) {
          const approver = pendingReq?.approverName || pendingReq?.approverId || 'approver';
          btnHtml = `<button class="btn btn-pending" disabled>⏳ Requested</button><div style="font-size:10px;color:var(--text2);margin-top:4px;">Sent to ${approver}</div>`;
        } else if (autoInstall) {
          btnHtml = `<button class="btn btn-install" data-tool="${c.toolName}" data-level="${c.accessLevel}" data-action="install">Install</button>`;
        } else {
          btnHtml = `<button class="btn btn-request" data-tool="${c.toolName}" data-level="${c.accessLevel}" data-action="request">Request Approval</button>`;
        }
        return `
          <div class="software-card">
            <span class="icon">${iconImg(c.icon)}</span>
            <div class="name">${c.toolName}</div>
            <div class="desc">${c.description || ''}</div>
            ${btnHtml}
          </div>`;
      }).join('')}
    </div>`;

  // Attach button handlers
  el.querySelectorAll('[data-action="install"]').forEach(btn => {
    btn.addEventListener('click', () => handleInstall(btn.dataset.tool, btn.dataset.level, btn));
  });
  el.querySelectorAll('[data-action="request"]').forEach(btn => {
    btn.addEventListener('click', () => showRequestModal(btn.dataset.tool, btn.dataset.level));
  });
}

// --- Install (auto-grant) ---
async function handleInstall(toolName, accessLevel, btn) {
  btn.disabled = true;
  btn.textContent = 'Installing…';
  try {
    const result = await api('/requests', {
      method: 'POST',
      body: JSON.stringify({ toolName, accessLevel, reason: 'Self-service install', employeeId: getEmpId() }),
    });
    if (result.status === 'provisioned') {
      toast(`✅ ${toolName} installed`);
      await loadProfile();
      renderCatalog();
    } else if (result.status === 'failed') {
      toast(`Failed to install ${toolName}`, 'error');
      btn.disabled = false; btn.textContent = 'Install';
    } else {
      toast(`${toolName} request submitted`);
      await loadProfile();
      renderCatalog();
    }
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false; btn.textContent = 'Install';
  }
}

// --- Request Approval modal ---
function showRequestModal(toolName, accessLevel) {
  const modal = document.getElementById('modal');
  const entry = catalog.find(c => c.toolName === toolName && c.accessLevel === accessLevel);
  modal.innerHTML = `
    <div class="modal-content">
      <h2>Request Approval — ${toolName}</h2>
      <p style="font-size:13px;color:var(--text2);margin-bottom:16px;">
        This software requires manager approval. A ticket will be created and sent to <strong>${entry?.defaultApproverName || 'an approver'}</strong>.
      </p>
      <div class="form-group">
        <label>Why do you need this?</label>
        <textarea id="modalReason" placeholder="Briefly explain your need…"></textarea>
      </div>
      <div class="modal-actions">
        <button class="btn btn-cancel" id="modalCancel">Cancel</button>
        <button class="btn btn-request" id="modalSubmit">Submit Request</button>
      </div>
    </div>`;
  modal.classList.remove('hidden');

  document.getElementById('modalCancel').onclick = () => modal.classList.add('hidden');
  document.getElementById('modalSubmit').onclick = async () => {
    const reason = document.getElementById('modalReason').value.trim();
    if (!reason) { toast('Please provide a reason', 'error'); return; }
    const btn = document.getElementById('modalSubmit');
    btn.disabled = true; btn.textContent = 'Submitting…';
    try {
      await api('/requests', {
        method: 'POST',
        body: JSON.stringify({ toolName, accessLevel, reason, employeeId: getEmpId() }),
      });
      modal.classList.add('hidden');
      toast(`📧 Approval request sent for ${toolName}`);
      await loadMyPendingRequests();
      renderCatalog();
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false; btn.textContent = 'Submit Request';
    }
  };
  modal.onclick = (e) => { if (e.target === modal) modal.classList.add('hidden'); };
}

// --- Search ---
document.getElementById('searchInput')?.addEventListener('input', () => renderCatalog());

// --- Notifications (pending approvals) ---
async function renderNotifications() {
  const el = document.getElementById('view-notifications');
  let pending = [];
  try { pending = await api('/requests?status=pending_approval'); } catch {}
  // Filter out requests from the current employee (can't approve your own)
  const empId = getEmpId();
  pending = pending.filter(r => r.employeeId !== empId);

  if (pending.length === 0) {
    el.innerHTML = `<div class="section-header"><h1>Notifications</h1><p>Pending approval requests</p></div>
      <div class="empty-state"><div class="icon">✨</div><p>No pending approvals</p></div>`;
    return;
  }

  el.innerHTML = `<div class="section-header"><h1>Notifications</h1><p>${pending.length} pending</p></div>` +
    pending.map(r => `
      <div class="request-card">
        <h3>${r.toolName} (${r.accessLevel || 'standard'})</h3>
        <div class="meta">Requested by ${r.employeeName || r.employeeId} · ${timeAgo(r.createdAt)} · ${r.id}</div>
        <p style="font-size:13px;margin-bottom:4px">${r.reason || ''}</p>
        <p style="font-size:12px;color:var(--text2)">Job Level: ${r.jobLevel || 'N/A'} · $${Number(r.monthlyCost || 0).toFixed(2)}/mo</p>
        <div class="actions">
          <button class="btn btn-approve btn-sm" data-id="${r.id}" data-token="${r.approvalToken || ''}" data-act="approve">✓ Approve</button>
          <button class="btn btn-reject btn-sm" data-id="${r.id}" data-token="${r.approvalToken || ''}" data-act="reject">✗ Reject</button>
        </div>
      </div>
    `).join('');

  el.querySelectorAll('[data-act]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/requests/${btn.dataset.id}/${btn.dataset.act}`, {
          method: 'POST', body: JSON.stringify({ token: btn.dataset.token }),
        });
        toast(btn.dataset.act === 'approve' ? '✅ Approved' : '❌ Rejected');
        renderNotifications();
      } catch (err) { toast(err.message, 'error'); }
    });
  });
}

// --- History ---
async function renderHistory() {
  const el = document.getElementById('view-history');
  let reqs = [];
  try { reqs = await api(`/requests?employeeId=${getEmpId()}`); } catch {}

  if (reqs.length === 0) {
    el.innerHTML = `<div class="section-header"><h1>History</h1><p>Your access requests</p></div>
      <div class="empty-state"><div class="icon">📋</div><p>No requests yet</p></div>`;
    return;
  }

  el.innerHTML = `<div class="section-header"><h1>History</h1><p>${reqs.length} request${reqs.length > 1 ? 's' : ''}</p></div>` +
    reqs.map(r => `
      <div class="request-card">
        <h3>${r.toolName} ${badge(r.status)}</h3>
        <div class="meta">${r.id} · ${timeAgo(r.createdAt)}</div>
        <p style="font-size:12px;color:var(--text2)">${r.agentReason || ''}</p>
      </div>
    `).join('');
}

// --- Init ---
(async () => {
  await loadCatalog();
  await loadProfile();
  await loadMyPendingRequests();
  renderCatalog();

  // --- Chat panel ---
  const chatToggle = document.getElementById('chatToggle');
  const chatPanel = document.getElementById('chatPanel');
  const chatClose = document.getElementById('chatClose');
  const chatInput = document.getElementById('chatInput');
  const chatSend = document.getElementById('chatSend');
  const chatMessages = document.getElementById('chatMessages');

  chatToggle.addEventListener('click', () => {
    chatPanel.classList.toggle('hidden');
    if (!chatPanel.classList.contains('hidden')) chatInput.focus();
  });
  chatClose.addEventListener('click', () => chatPanel.classList.add('hidden'));

  function addChatMsg(text, type, recommendations) {
    const div = document.createElement('div');
    div.className = `chat-msg ${type}`;
    // Simple markdown bold → html
    let html = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
    if (recommendations && recommendations.length > 0) {
      html += '<div style="margin-top:8px;">';
      recommendations.forEach(r => {
        html += `<span class="tool-chip" data-tool="${r.toolName}" data-level="${r.accessLevel}">${r.toolName}</span>`;
      });
      html += '</div>';
    }
    div.innerHTML = html;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Make tool chips clickable — navigate to catalog and highlight
    div.querySelectorAll('.tool-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        chatPanel.classList.add('hidden');
        activeCategory = 'All';
        document.getElementById('searchInput').value = chip.dataset.tool;
        switchView('catalog');
      });
    });
  }

  async function sendChat() {
    const msg = chatInput.value.trim();
    if (!msg) return;
    chatInput.value = '';
    addChatMsg(msg, 'user');
    try {
      const res = await api('/chat', {
        method: 'POST',
        body: JSON.stringify({ message: msg, employeeId: getEmpId() }),
      });
      addChatMsg(res.reply, 'bot', res.recommendations);
    } catch (err) {
      addChatMsg('Sorry, something went wrong. Try again.', 'bot');
    }
  }

  chatSend.addEventListener('click', sendChat);
  chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });
})();
