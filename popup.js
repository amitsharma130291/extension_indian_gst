/**
 * Indian Freelancer Tax Dashboard — Popup Script
 * Reads chrome.storage.local directly. No service worker dependency.
 */

'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
let currentSettings = {};
let currentTaxResult = null;

// ─── Storage ──────────────────────────────────────────────────────────────────
async function loadAll() {
  const data = await chrome.storage.local.get(['earnings', 'settings', 'checklist', 'dismissedAlarms']);
  return {
    earnings: data.earnings || [],
    settings: data.settings || { state: 'Maharashtra', regime: 'new', expenses: 0, usdRate: 85 },
    checklist: data.checklist || {},
    dismissedAlarms: data.dismissedAlarms || []
  };
}

async function saveSettings(settings) {
  await chrome.storage.local.set({ settings });
}

async function saveChecklist(checklist) {
  await chrome.storage.local.set({ checklist });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtINR(n) {
  if (n === null || n === undefined || isNaN(n)) return '₹—';
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

function el(id) { return document.getElementById(id); }

// ─── Render Dashboard ─────────────────────────────────────────────────────────
function renderDashboard(data) {
  const { earnings, settings, checklist } = data;
  currentSettings = settings;

  const fyYear = TaxEngine.currentFYStartYear();
  const fyLabel = `FY ${fyYear}-${String(fyYear + 1).slice(2)}`;
  el('fy-label').textContent = fyLabel;

  // Find this FY's earnings
  let fyEarnings = earnings.find(e => e.fyYear === fyYear);

  // If manual override set in settings, use that
  if (settings.manualEarnings && settings.manualEarnings > 0) {
    fyEarnings = fyEarnings
      ? { ...fyEarnings, totalINR: settings.manualEarnings }
      : { totalINR: settings.manualEarnings, tdsDeducted: Math.round(settings.manualEarnings * 0.01), fyYear };
  }

  if (!fyEarnings || !fyEarnings.totalINR) {
    // No data yet — show helpful empty state
    el('gross-earnings').textContent = '₹0';
    el('tds-deducted').textContent = '₹0';
    el('total-tax').textContent = '₹—';
    el('net-payable').textContent = '₹—';
    el('deadlines-list').innerHTML = `
      <div class="no-data">
        <strong>No earnings data yet</strong>
        Visit your <a href="https://www.upwork.com/nx/payments/" target="_blank" style="color:#14c98f">Upwork payments page</a>
        or <a href="https://www.fiverr.com" target="_blank" style="color:#14c98f">Fiverr orders page</a>
        while the extension is active — your earnings will appear here automatically.<br><br>
        Or enter your earnings manually in <strong>Settings → Manual Earnings</strong>.
      </div>`;
    renderGST(0, settings);
    renderChecklist(checklist);
    return;
  }

  // Calculate tax
  const taxResult = TaxEngine.calculateTax({
    grossEarnings: fyEarnings.totalINR,
    expenses: settings.expenses || 0,
    tdsDeducted: fyEarnings.tdsDeducted || 0,
    regime: settings.regime || 'new',
    state: settings.state || 'Maharashtra'
  });
  currentTaxResult = taxResult;

  // Earnings cards
  el('gross-earnings').textContent = fmtINR(fyEarnings.totalINR);
  el('tds-deducted').textContent = fmtINR(fyEarnings.tdsDeducted || 0);
  el('total-tax').textContent = fmtINR(taxResult.totalTax);
  el('net-payable').textContent = fmtINR(taxResult.netPayable);

  // Colour net payable
  const netEl = el('net-payable');
  if (taxResult.netPayable > 50000) netEl.className = 'earn-value red';
  else if (taxResult.netPayable > 10000) netEl.className = 'earn-value amber';
  else netEl.className = 'earn-value green';

  // Advance tax deadlines
  renderDeadlines(taxResult.installments);

  // GST
  renderGST(fyEarnings.totalINR, settings);

  // Checklist
  renderChecklist(checklist);

  // Set aside rate for calculator
  el('payment-input').placeholder = `Enter payment (set aside ~${taxResult.setAsideRate}%)`;
}

function renderDeadlines(installments) {
  const list = el('deadlines-list');
  list.innerHTML = installments.map(inst => {
    let cls = '';
    let badge = '';
    if (inst.isPast) { cls = 'overdue'; badge = '<span class="deadline-badge overdue">Check paid</span>'; }
    else if (inst.isUrgent) { cls = 'urgent'; badge = `<span class="deadline-badge urgent">⚠ ${inst.daysLeft}d left</span>`; }
    else { badge = `<span class="deadline-badge">${inst.daysLeft}d</span>`; }

    return `
      <div class="deadline-row ${cls}">
        <div class="deadline-left">
          <span class="deadline-quarter">${inst.quarter}</span>
          <span class="deadline-date">${inst.deadline}</span>
        </div>
        <div class="deadline-right">
          <span class="deadline-amount">${fmtINR(inst.installment)}</span>
          ${badge}
        </div>
      </div>`;
  }).join('');
}

function renderGST(turnover, settings) {
  const isSpecial = TaxEngine.SPECIAL_CATEGORY_STATES.includes(settings.state || 'Maharashtra');
  const threshold = isSpecial ? TaxEngine.GST_THRESHOLD_SPECIAL : TaxEngine.GST_THRESHOLD_GENERAL;
  const pct = Math.min((turnover / threshold) * 100, 100);

  el('gst-turnover').textContent = fmtINR(turnover);
  el('gst-threshold').textContent = fmtINR(threshold);
  el('gst-bar-fill').style.width = `${pct}%`;
  el('gst-pct').textContent = `${Math.round(pct)}%`;

  // Colour the bar
  const fill = el('gst-bar-fill');
  if (pct >= 100) fill.style.background = '#f85149';
  else if (pct >= 75) fill.style.background = '#e3b341';
  else fill.style.background = '#14c98f';

  // Status message
  const statusEl = el('gst-status');
  if (turnover >= threshold) {
    statusEl.textContent = '🔴 GST registration required — consult a CA';
    statusEl.className = 'gst-status danger';
  } else if (pct >= 75) {
    const remaining = fmtINR(threshold - turnover);
    statusEl.textContent = `⚠ ${remaining} until threshold — plan ahead`;
    statusEl.className = 'gst-status warning';
  } else {
    statusEl.textContent = `✅ No GST registration needed yet`;
    statusEl.className = 'gst-status safe';
  }
}

function renderChecklist(checklist) {
  ['26as', 'advance', 'books', 'itr'].forEach(key => {
    const chkEl = el(`chk-${key}`);
    if (chkEl) chkEl.checked = checklist[key] || false;
  });
}

// ─── Set-Aside Calculator ─────────────────────────────────────────────────────
el('btn-calc').addEventListener('click', () => {
  const payment = parseFloat(el('payment-input').value);
  if (!payment || isNaN(payment) || payment <= 0) return;

  const rate = currentTaxResult?.setAsideRate || 30;
  const result = TaxEngine.calcPaymentSetAside(payment, rate);
  const res = el('setaside-result');
  res.classList.remove('hidden');
  res.innerHTML = `
    <div class="sa-row"><span>Set aside (${result.setAsideRate}%)</span><strong style="color:#e3b341">${fmtINR(result.setAside)}</strong></div>
    <div class="sa-row"><span>TDS already deducted (1%)</span><strong style="color:#3fb950">${fmtINR(result.tds)}</strong></div>
    <div class="sa-row"><span>Safe to spend</span><strong>${fmtINR(result.available)}</strong></div>
  `;
});

// ─── Checklist persistence ────────────────────────────────────────────────────
['26as', 'advance', 'books', 'itr'].forEach(key => {
  const chkEl = el(`chk-${key}`);
  if (chkEl) {
    chkEl.addEventListener('change', async () => {
      const data = await chrome.storage.local.get(['checklist']);
      const checklist = data.checklist || {};
      checklist[key] = chkEl.checked;
      await saveChecklist(checklist);
    });
  }
});

// ─── Settings View ────────────────────────────────────────────────────────────
el('btn-settings').addEventListener('click', () => {
  el('view-main').classList.add('hidden');
  el('view-settings').classList.remove('hidden');

  // Pre-fill settings
  el('setting-state').value = currentSettings.state || 'Maharashtra';
  el('setting-regime').value = currentSettings.regime || 'new';
  el('setting-expenses').value = currentSettings.expenses || '';
  el('setting-usdrate').value = currentSettings.usdRate || 85;
  el('setting-manual-earnings').value = currentSettings.manualEarnings || '';
});

el('btn-back').addEventListener('click', () => {
  el('view-settings').classList.add('hidden');
  el('view-main').classList.remove('hidden');
});

el('btn-save-settings').addEventListener('click', async () => {
  const settings = {
    state: el('setting-state').value,
    regime: el('setting-regime').value,
    expenses: parseFloat(el('setting-expenses').value) || 0,
    usdRate: parseFloat(el('setting-usdrate').value) || 85,
    manualEarnings: parseFloat(el('setting-manual-earnings').value) || 0
  };
  await saveSettings(settings);
  currentSettings = settings;

  el('save-status').classList.remove('hidden');
  setTimeout(() => {
    el('save-status').classList.add('hidden');
    el('view-settings').classList.add('hidden');
    el('view-main').classList.remove('hidden');
    init(); // Refresh dashboard with new settings
  }, 1000);
});

// ─── Upgrade ──────────────────────────────────────────────────────────────────
el('btn-upgrade').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: 'https://your-site.com/upgrade' });
});

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  const data = await loadAll();
  renderDashboard(data);
}

init();
