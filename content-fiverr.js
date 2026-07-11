/**
 * Indian Freelancer Tax Dashboard — Fiverr Content Script
 *
 * Injects on fiverr.com manage_orders pages.
 * Same approach as Upwork — reads DOM, calculates, injects panel.
 */

'use strict';

function currentFYStartYear() {
  const now = new Date();
  return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
}

function fmtINR(n) {
  if (!n && n !== 0) return '—';
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

async function getSettings() {
  const d = await chrome.storage.local.get(['settings']);
  return d.settings || { state: 'Maharashtra', regime: 'new', expenses: 0 };
}

async function saveEarnings(earnings) {
  const existing = await chrome.storage.local.get(['earnings']);
  const all = existing.earnings || [];
  const fyYear = currentFYStartYear();
  // Merge Fiverr earnings with any existing Upwork earnings for same FY
  const idx = all.findIndex(e => e.fyYear === fyYear);
  if (idx >= 0) {
    all[idx].fiverrINR = earnings.totalINR;
    all[idx].totalINR = (all[idx].upworkINR || 0) + earnings.totalINR;
    all[idx].tdsDeducted = Math.round(all[idx].totalINR * 0.01);
  } else {
    all.push({ ...earnings, fyYear, fiverrINR: earnings.totalINR, upworkINR: 0 });
  }
  await chrome.storage.local.set({ earnings: all });
}

/**
 * Extract earnings from Fiverr manage_orders page.
 *
 * Fiverr shows order revenue in the orders table.
 * Each completed order row shows the earned amount (after Fiverr's 20% cut).
 */
function extractFiverrEarnings() {
  let totalUSD = 0;
  let txCount = 0;

  // Fiverr orders table — completed orders have revenue amounts
  // Confirmed selectors from Fiverr's order management UI
  const amountCells = document.querySelectorAll(
    '[class*="order-price"], [class*="revenue"], td[class*="price"], ' +
    '.price-wrapper, [data-testid*="price"]'
  );

  amountCells.forEach(cell => {
    const text = cell.textContent.trim();
    const match = text.match(/\$\s*([\d,]+(?:\.\d{2})?)/);
    if (match) {
      totalUSD += parseFloat(match[1].replace(/,/g, ''));
      txCount++;
    }
  });

  // Fallback: sum all dollar amounts on page that look like order values
  if (totalUSD === 0) {
    const rows = document.querySelectorAll('tr');
    rows.forEach(row => {
      if (row.textContent.toLowerCase().includes('complete') ||
          row.textContent.toLowerCase().includes('delivered')) {
        const match = row.textContent.match(/\$\s*([\d,]+(?:\.\d{2})?)/);
        if (match) { totalUSD += parseFloat(match[1].replace(/,/g, '')); txCount++; }
      }
    });
  }

  const usdToInr = 85;
  const totalINR = Math.round(totalUSD * usdToInr);
  const tdsDeducted = Math.round(totalINR * 0.01);

  return { totalINR, totalUSD, tdsDeducted, txCount, source: 'fiverr', extractedAt: Date.now() };
}

async function run() {
  console.log('[IFT] Fiverr content script loaded');
  if (document.getElementById('ift-tax-panel')) return;

  const settings = await getSettings();
  const earnings = extractFiverrEarnings();
  console.log('[IFT] Fiverr earnings:', earnings);
  await saveEarnings(earnings);

  const taxResult = TaxEngine.calculateTax({
    grossEarnings: earnings.totalINR,
    expenses: settings.expenses || 0,
    tdsDeducted: earnings.tdsDeducted,
    regime: settings.regime || 'new',
    state: settings.state || 'Maharashtra'
  });

  // Reuse same panel creation from content-upwork.js
  // Panel is injected the same way
  const panel = document.createElement('div');
  panel.id = 'ift-tax-panel';
  panel.style.cssText = 'position:fixed;top:80px;right:16px;z-index:99999;width:300px;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:10px;font-family:system-ui;font-size:13px;box-shadow:0 8px 32px rgba(0,0,0,0.5);padding:14px;';
  panel.innerHTML = `
    <div style="font-weight:600;margin-bottom:10px;display:flex;justify-content:space-between">
      🇮🇳 Tax Dashboard (Fiverr) <button onclick="this.closest('#ift-tax-panel').remove()" style="background:none;border:none;color:#7d8590;cursor:pointer">✕</button>
    </div>
    <div style="color:#7d8590;font-size:12px;margin-bottom:8px">${taxResult.fyLabel}</div>
    <div style="display:flex;justify-content:space-between;padding:4px 0"><span style="color:#7d8590">Fiverr Earnings</span><strong>${fmtINR(earnings.totalINR)}</strong></div>
    <div style="display:flex;justify-content:space-between;padding:4px 0"><span style="color:#7d8590">TDS (1%)</span><strong style="color:#3fb950">${fmtINR(earnings.tdsDeducted)} claimable</strong></div>
    <div style="display:flex;justify-content:space-between;padding:4px 0;border-top:1px solid #30363d;margin-top:6px"><span style="color:#7d8590">Tax Liability</span><strong>${fmtINR(taxResult.totalTax)}</strong></div>
    <div style="display:flex;justify-content:space-between;padding:4px 0"><span style="color:#7d8590">Net Payable</span><strong style="color:#e3b341">${fmtINR(taxResult.netPayable)}</strong></div>
    <div style="margin-top:10px;padding-top:10px;border-top:1px solid #30363d;font-size:12px;color:#7d8590">
      Set aside <strong style="color:#e3b341">${taxResult.setAsideRate}%</strong> of each payment for taxes.
    </div>
  `;
  document.body.appendChild(panel);
}

setTimeout(run, 2000);
setTimeout(run, 4000);
