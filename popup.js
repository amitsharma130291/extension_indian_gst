'use strict';

// ─── Helpers ─────────────────────────────────────────────────────────────────
function el(id) { return document.getElementById(id); }
function fmtINR(n) {
  if (n === null || n === undefined || isNaN(n)) return '₹—';
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

// ─── Storage ─────────────────────────────────────────────────────────────────
async function loadSaved() {
  const d = await chrome.storage.local.get(['lastInput', 'checklist']);
  return { lastInput: d.lastInput || {}, checklist: d.checklist || {} };
}

async function saveInput(inp) {
  await chrome.storage.local.set({ lastInput: inp });
}

async function saveChecklist(checklist) {
  await chrome.storage.local.set({ checklist });
}

// ─── FY Label ────────────────────────────────────────────────────────────────
const fyYear = TaxEngine.currentFYStartYear();
el('fy-label').textContent = `FY ${fyYear}–${String(fyYear + 1).slice(2)}`;

// ─── Show/hide expenses field for old regime ─────────────────────────────────
el('inp-regime').addEventListener('change', () => {
  el('row-expenses').style.display = el('inp-regime').value === 'old' ? 'flex' : 'none';
});

// ─── Main Calculate ───────────────────────────────────────────────────────────
el('btn-calc').addEventListener('click', calculate);

function calculate() {
  const earnings  = parseFloat(el('inp-earnings').value) || 0;
  const regime    = el('inp-regime').value;
  const state     = el('inp-state').value;
  const expenses  = parseFloat(el('inp-expenses').value) || 0;
  const tdsInput  = el('inp-tds').value;
  const tdsDeducted = tdsInput !== '' ? parseFloat(tdsInput) : Math.round(earnings * 0.01);

  if (!earnings || earnings <= 0) {
    el('inp-earnings').focus();
    el('inp-earnings').style.borderColor = '#f85149';
    setTimeout(() => el('inp-earnings').style.borderColor = '', 1500);
    return;
  }

  // Save last input
  saveInput({ earnings, regime, state, expenses, tdsDeducted });

  // Calculate
  const result = TaxEngine.calculateTax({ grossEarnings: earnings, expenses, tdsDeducted, regime, state });

  // Show results
  el('results').classList.remove('hidden');

  // Summary cards
  el('r-gross').textContent     = fmtINR(earnings);
  el('r-tds').textContent       = fmtINR(tdsDeducted);
  el('r-liability').textContent = fmtINR(result.totalTax);
  el('r-payable').textContent   = fmtINR(result.netPayable);

  // Colour net payable
  const rpEl = el('r-payable');
  rpEl.className = result.netPayable > 50000 ? 'sum-value red'
                 : result.netPayable > 10000 ? 'sum-value amber'
                 : 'sum-value green';

  // Breakdown
  el('bk-taxable').textContent    = fmtINR(result.taxableIncome);
  el('bk-base').textContent       = fmtINR(result.baseTax);
  el('bk-cess').textContent       = fmtINR(result.cess);
  el('bk-total').textContent      = fmtINR(result.totalTax);
  el('bk-tds-credit').textContent = `− ${fmtINR(tdsDeducted)}`;

  if (result.rebate > 0) {
    el('bk-rebate-row').classList.remove('hidden');
    el('bk-rebate').textContent = `− ${fmtINR(result.rebate)}`;
  } else {
    el('bk-rebate-row').classList.add('hidden');
  }

  // Advance tax
  renderAdvanceTax(result);

  // GST
  renderGST(earnings, result, state);

  // Update set-aside placeholder
  el('sa-payment').placeholder = `Amount (set aside ~${result.setAsideRate}%)`;

  // Scroll results into view
  el('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─── Advance Tax ─────────────────────────────────────────────────────────────
function renderAdvanceTax(result) {
  const list = el('advance-list');
  const noteEl = el('advance-note');

  if (!result.advanceTaxRequired) {
    list.innerHTML = `<div style="font-size:12px;color:#3fb950;padding:4px 0">
      ✅ No advance tax needed — net payable is below ₹10,000</div>`;
    noteEl.textContent = '';
    return;
  }

  list.innerHTML = result.installments.map(inst => {
    let cls = inst.isPast ? 'past' : inst.isUrgent ? 'urgent' : '';
    let badge = inst.isPast
      ? '<span class="adv-badge past">Verify paid</span>'
      : inst.isUrgent
        ? `<span class="adv-badge urgent">⚠ ${inst.daysLeft}d left</span>`
        : `<span class="adv-badge">${inst.daysLeft}d away</span>`;

    return `<div class="advance-row ${cls}">
      <div class="adv-left">
        <span class="adv-q">${inst.quarter}</span>
        <span class="adv-date">${inst.deadline}</span>
      </div>
      <div class="adv-right">
        <span class="adv-amt">${fmtINR(inst.installment)}</span>
        ${badge}
      </div>
    </div>`;
  }).join('');

  const urgent = result.installments.find(i => i.isUrgent);
  noteEl.textContent = urgent
    ? `⚠ Pay ${fmtINR(urgent.installment)} via Challan 280 on the IT portal before ${urgent.deadline}. Late payment attracts 1% interest/month.`
    : 'Pay via Challan 280 on the Income Tax portal. Late payment attracts 1% interest per month under Section 234B/234C.';
}

// ─── GST ─────────────────────────────────────────────────────────────────────
function renderGST(earnings, result, state) {
  const pct = Math.min(result.gstPct, 100);

  el('gst-earnings').textContent     = fmtINR(earnings);
  el('gst-thresh').textContent       = fmtINR(result.gstThreshold);
  el('gst-pct-badge').textContent    = `${result.gstPct}%`;
  el('gst-fill').style.width         = `${pct}%`;
  el('gst-fill').style.background    = pct >= 100 ? '#f85149' : pct >= 75 ? '#e3b341' : '#14c98f';

  const statusEl = el('gst-status');
  if (result.gstRequired) {
    statusEl.textContent  = '🔴 You have crossed the threshold — GST registration required. Consult a CA.';
    statusEl.className    = 'gst-status danger';
  } else if (pct >= 75) {
    statusEl.textContent  = `⚠ ${fmtINR(result.gstThreshold - earnings)} remaining before threshold. Plan ahead.`;
    statusEl.className    = 'gst-status warning';
  } else {
    statusEl.textContent  = `✅ No GST registration needed — you are ${result.gstPct}% of the ${TaxEngine.SPECIAL_CATEGORY_STATES.includes(state) ? '₹10L' : '₹20L'} threshold.`;
    statusEl.className    = 'gst-status safe';
  }
}

// ─── Breakdown Toggle ─────────────────────────────────────────────────────────
let breakdownOpen = false;
el('toggle-breakdown').addEventListener('click', () => {
  breakdownOpen = !breakdownOpen;
  el('breakdown').classList.toggle('hidden', !breakdownOpen);
  el('toggle-breakdown').textContent = breakdownOpen ? '▾ Hide breakdown' : '▸ Show breakdown';
});

// ─── Set-Aside Calculator ─────────────────────────────────────────────────────
el('sa-calc').addEventListener('click', () => {
  const payment = parseFloat(el('sa-payment').value);
  if (!payment || payment <= 0) return;

  const earnings = parseFloat(el('inp-earnings').value) || 0;
  const regime   = el('inp-regime').value;
  const state    = el('inp-state').value;
  const result   = earnings > 0
    ? TaxEngine.calculateTax({ grossEarnings: earnings, regime, state })
    : { setAsideRate: 30 };

  const sa = TaxEngine.calcPaymentSetAside(payment, result.setAsideRate);
  const res = el('sa-result');
  res.classList.remove('hidden');
  res.innerHTML = `
    <div class="sa-row"><span>Set aside (${sa.setAsideRate}% for tax)</span><strong style="color:#e3b341">${fmtINR(sa.setAside)}</strong></div>
    <div class="sa-row"><span>TDS deducted by platform (1%)</span><strong style="color:#3fb950">${fmtINR(sa.tds)}</strong></div>
    <div class="sa-row"><span>Safe to spend / transfer</span><strong>${fmtINR(sa.available)}</strong></div>`;
});

// ─── Checklist ────────────────────────────────────────────────────────────────
['26as', 'q2', 'books', 'itr'].forEach(key => {
  el(`chk-${key}`)?.addEventListener('change', async () => {
    const d = await chrome.storage.local.get(['checklist']);
    const checklist = d.checklist || {};
    checklist[key] = el(`chk-${key}`).checked;
    await saveChecklist(checklist);
  });
});

// ─── Init — restore last input ────────────────────────────────────────────────
(async () => {
  const { lastInput, checklist } = await loadSaved();

  if (lastInput.earnings) {
    el('inp-earnings').value = lastInput.earnings;
    el('inp-regime').value   = lastInput.regime || 'new';
    el('inp-state').value    = lastInput.state || 'Maharashtra';
    if (lastInput.regime === 'old') {
      el('row-expenses').style.display = 'flex';
      el('inp-expenses').value = lastInput.expenses || '';
    }
    if (lastInput.tdsDeducted !== undefined) {
      el('inp-tds').value = lastInput.tdsDeducted;
    }
    // Auto-recalculate on load
    calculate();
  }

  // Restore checklist
  ['26as', 'q2', 'books', 'itr'].forEach(key => {
    const chkEl = el(`chk-${key}`);
    if (chkEl) chkEl.checked = checklist[key] || false;
  });
})();
