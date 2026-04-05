// Manager Portal — approve/reject requests, look up employees via AI chat
const API = '/api';

async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Error ${res.status}`);
  return data;
}
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

// Navigation
document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', () => {
    document.querySelectorAll('.nav-link').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    link.classList.add('active');
    document.getElementById(`view-${link.dataset.view}`).classList.add('active');
    if (link.dataset.view === 'approvals') renderApprovals();
    if (link.dataset.view === 'resolved') renderResolved();
  });
});

// --- Approvals ---
async function renderApprovals() {
  const el = document.getElementById('view-approvals');
  let pending = [];
  try { pending = await api('/requests?status=pending_approval'); } catch {}

  if (pending.length === 0) {
    el.innerHTML = `<div class="section-header"><h1>Pending Approvals</h1></div>
      <div class="empty-state"><div class="icon">✨</div><p>No pending requests</p></div>`;
    return;
  }

  el.innerHTML = `<div class="section-header"><h1>Pending Approvals</h1><p>${pending.length} request${pending.length > 1 ? 's' : ''} waiting</p></div>` +
    pending.map(r => `
      <div class="request-card">
        <h3>${r.toolName} (${r.accessLevel || 'standard'}) ${badge('pending_approval')}</h3>
        <div class="meta">Requested by <strong>${r.employeeName || r.employeeId}</strong> (${r.jobLevel || 'N/A'}) · ${timeAgo(r.createdAt)} · ${r.id}</div>
        <p style="font-size:13px;margin-bottom:8px"><strong>Reason:</strong> ${r.reason || 'N/A'}</p>
        <div class="actions">
          <button class="btn btn-approve btn-sm" data-id="${r.id}" data-token="${r.approvalToken || ''}" data-act="approve">✓ Approve</button>
          <button class="btn btn-reject btn-sm" data-id="${r.id}" data-token="${r.approvalToken || ''}" data-act="reject">✗ Reject</button>
        </div>
      </div>
    `).join('');

  el.querySelectorAll('[data-act]').forEach(btn => {
    btn.addEventListener('click', () => showDecisionModal(btn.dataset.id, btn.dataset.token, btn.dataset.act));
  });
}

function showDecisionModal(requestId, token, action) {
  const modal = document.getElementById('modal');
  const isApprove = action === 'approve';
  modal.innerHTML = `
    <div class="modal-content">
      <h2>${isApprove ? '✓ Approve' : '✗ Reject'} Request</h2>
      <div class="form-group">
        <label>${isApprove ? 'Approval note (optional)' : 'Reason for rejection'}</label>
        <textarea id="decisionReason" placeholder="${isApprove ? 'Any notes…' : 'Why is this being rejected?'}">${isApprove ? '' : ''}</textarea>
      </div>
      <div class="modal-actions">
        <button class="btn btn-cancel" id="modalCancel">Cancel</button>
        <button class="btn ${isApprove ? 'btn-approve' : 'btn-reject'}" id="modalSubmit">${isApprove ? 'Approve' : 'Reject'}</button>
      </div>
    </div>`;
  modal.classList.remove('hidden');

  document.getElementById('modalCancel').onclick = () => modal.classList.add('hidden');
  document.getElementById('modalSubmit').onclick = async () => {
    const reason = document.getElementById('decisionReason').value.trim();
    if (!isApprove && !reason) { toast('Please provide a rejection reason', 'error'); return; }
    const btn = document.getElementById('modalSubmit');
    btn.disabled = true; btn.textContent = 'Processing…';
    try {
      await api(`/requests/${requestId}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ token, reason: reason || undefined }),
      });
      modal.classList.add('hidden');
      toast(isApprove ? '✅ Request approved' : '❌ Request rejected');
      renderApprovals();
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false; btn.textContent = isApprove ? 'Approve' : 'Reject';
    }
  };
  modal.onclick = (e) => { if (e.target === modal) modal.classList.add('hidden'); };
}

// --- Resolved requests ---
async function renderResolved() {
  const el = document.getElementById('view-resolved');
  let all = [];
  try {
    const provisioned = await api('/requests?status=provisioned');
    const rejected = await api('/requests?status=rejected');
    const failed = await api('/requests?status=failed');
    all = [...provisioned, ...rejected, ...failed].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  } catch {}

  if (all.length === 0) {
    el.innerHTML = `<div class="section-header"><h1>Resolved</h1></div>
      <div class="empty-state"><div class="icon">📋</div><p>No resolved requests yet</p></div>`;
    return;
  }

  el.innerHTML = `<div class="section-header"><h1>Resolved</h1><p>${all.length} resolved</p></div>` +
    all.map(r => `
      <div class="request-card">
        <h3>${r.toolName} ${badge(r.status)}</h3>
        <div class="meta">${r.employeeName || r.employeeId} · ${r.id} · ${timeAgo(r.updatedAt || r.createdAt)}</div>
        ${r.rejectionReason ? `<p style="font-size:12px;color:var(--red);">Reason: ${r.rejectionReason}</p>` : ''}
      </div>
    `).join('');
}

// --- Chat (manager can look up employees) ---
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

function addMsg(text, type, recs) {
  const div = document.createElement('div');
  div.className = `chat-msg ${type}`;
  div.innerHTML = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function sendChat() {
  const msg = chatInput.value.trim();
  if (!msg) return;
  chatInput.value = '';
  addMsg(msg, 'user');
  try {
    const res = await api('/chat', {
      method: 'POST',
      body: JSON.stringify({ message: msg, employeeId: null }),
    });
    addMsg(res.reply, 'bot');
  } catch {
    addMsg('Sorry, something went wrong.', 'bot');
  }
}

chatSend.addEventListener('click', sendChat);
chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

// --- Init ---
renderApprovals();
