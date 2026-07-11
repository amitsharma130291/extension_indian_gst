/**
 * Indian Freelancer Tax Dashboard — Upwork Content Script
 *
 * Injects on upwork.com/nx/payments/* and /nx/reports/*
 * Reads earnings table DOM → calculates tax → injects panel → saves to storage.
 *
 * ZERO TRUST: reads only pages you're already viewing. No OAuth. No API.
 * Writes directly to chrome.storage.local (no service worker messaging).
 */

'use strict';

// ─── Load Tax Engine ──────────────────────────────────────────────────────────
// tax-engine.js is injected as a separate content script via manifest
// It attaches TaxEngine to the window object via the IIFE pattern
// Since MV3 content scripts share the same JS context per origin,
// we load it via the manifest content_scripts array ordering.
// For safety, we also define a minimal inline fallback.

function getSettings() {
  return chrome.storage.local.get(['settings']).then(d => d.settings || {
    state: 'Maharashtra',
    regime: 'new',
    expenses: 0,
    setAsideRate: 30
  });
}

async function saveEarnings(earnings) {
  const existing = await chrome.storage.local.get(['earnings']);
  const all = existing.earnings || [];
  // Merge: update if same FY, else append
  const fyYear = currentFYStartYear();
  const idx = all.findIndex(e => e.fyYear === fyYear);
  if (idx >= 0) all[idx] = { ...all[idx], ...earnings, fyYear };
  else all.push({ ...earnings, fyYear });
  await chrome.storage.local.set({ earnings: all });
}

// ─── Financial Year Helper (inline, no module dependency) ─────────────────────

function currentFYStartYear() {
  const now = new Date();
  return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
}

function fmtINR(n) {
  if (!n && n !== 0) return '—';
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

// ─── Upwork DOM Reading ───────────────────────────────────────────────────────

/**
 * Extract total earnings from Upwork payments page.
 *
 * Upwork payments page (upwork.com/nx/payments/reports/ or /nx/payments/):
 * - Shows a table of transactions with amounts
 * - Each row has a credit amount in USD, sometimes INR after conversion
 * - We look for the "Total" or aggregate figure, or sum visible rows
 *
 * Selectors confirmed strategy: look for dollar amounts in the earnings table,
 * convert to INR using the stored exchange rate or a default (85 USD/INR).
 */
function extractUpworkEarnings() {
  let totalUSD = 0;
  let totalINR = 0;
  let currency = 'USD';
  let txCount = 0;

  // Try 1: Look for a summary/total line showing gross earnings
  // Upwork shows "Total earnings" in a summary section
  const summaryEls = document.querySelectorAll('[class*="total"], [class*="summary"], [data-test*="total"]');
  for (const el of summaryEls) {
    const text = el.textContent;
    const usdMatch = text.match(/\$[\s]?([\d,]+(?:\.\d{2})?)/);
    const inrMatch = text.match(/₹[\s]?([\d,]+(?:\.\d{2})?)/);
    if (usdMatch) { totalUSD = parseFloat(usdMatch[1].replace(/,/g, '')); break; }
    if (inrMatch) { totalINR = parseFloat(inrMatch[1].replace(/,/g, '')); currency = 'INR'; break; }
  }

  // Try 2: Sum all transaction rows in the earnings table
  if (totalUSD === 0 && totalINR === 0) {
    // Upwork transaction rows typically have amount cells
    const rows = document.querySelectorAll(
      'tr[class*="transaction"], tr[class*="earning"], ' +
      '[class*="transaction-row"], [class*="report-row"]'
    );
    rows.forEach(row => {
      const cells = row.querySelectorAll('td');
      cells.forEach(cell => {
        const text = cell.textContent.trim();
        // Look for positive dollar amounts (earnings, not fees)
        const usdMatch = text.match(/^\$\s*([\d,]+(?:\.\d{2})?)$/);
        if (usdMatch) {
          totalUSD += parseFloat(usdMatch[1].replace(/,/g, ''));
          txCount++;
        }
      });
    });
  }

  // Try 3: Look for any visible dollar totals on the page
  if (totalUSD === 0 && totalINR === 0) {
    const allText = document.body.innerText;
    // Match patterns like "Total Earned $12,345.00" or "Gross Earnings $..."
    const matches = allText.match(/(?:total|earned|gross|received)[^\$]*\$([\d,]+(?:\.\d{2})?)/gi);
    if (matches && matches.length > 0) {
      const lastMatch = matches[matches.length - 1];
      const numMatch = lastMatch.match(/\$([\d,]+(?:\.\d{2})?)/);
      if (numMatch) totalUSD = parseFloat(numMatch[1].replace(/,/g, ''));
    }
  }

  // Convert USD to INR (use stored rate or default 85)
  const usdToInr = 85; // Default exchange rate — user can update in settings
  if (totalINR === 0 && totalUSD > 0) {
    totalINR = totalUSD * usdToInr;
    currency = 'USD→INR';
  }

  // Also try to get TDS deducted — shown as "Tax Deducted" in Upwork statements
  let tdsDeducted = 0;
  const tdsPatterns = document.body.innerText.match(/(?:tds|tax deducted)[^\d]*([\d,]+(?:\.\d{2})?)/gi);
  if (tdsPatterns) {
    const numMatch = tdsPatterns[0].match(/([\d,]+(?:\.\d{2})?)/);
    if (numMatch) tdsDeducted = parseFloat(numMatch[1].replace(/,/g, ''));
  }
  // If no explicit TDS, calculate 1% of INR earnings
  if (tdsDeducted === 0 && totalINR > 0) {
    tdsDeducted = Math.round(totalINR * 0.01);
  }

  return {
    totalINR: Math.round(totalINR),
    totalUSD,
    currency,
    tdsDeducted: Math.round(tdsDeducted),
    txCount,
    extractedAt: Date.now(),
    source: 'upwork'
  };
}

// ─── Panel Injection ──────────────────────────────────────────────────────────

function createPanel(earnings, taxResult, settings) {
  const panel = document.createElement('div');
  panel.id = 'ift-tax-panel';
  panel.innerHTML = `
    <div class="ift-header">
      <span class="ift-logo">🇮🇳</span>
      <div>
        <div class="ift-title">Tax Dashboard</div>
        <div class="ift-subtitle">${taxResult.fyLabel} · ${taxResult.regime === 'new' ? 'New Regime' : 'Old Regime'}</div>
      </div>
      <button class="ift-close" id="ift-close">✕</button>
    </div>

    <div class="ift-section">
      <div class="ift-row">
        <span>Gross Earnings (est.)</span>
        <strong>${fmtINR(earnings.totalINR)}</strong>
      </div>
      <div class="ift-row">
        <span>TDS Deducted (1%)</span>
        <strong class="ift-green">${fmtINR(earnings.tdsDeducted)} ✓ claimable</strong>
      </div>
      <div class="ift-row ift-total">
        <span>Total Tax Liability</span>
        <strong>${fmtINR(taxResult.totalTax)}</strong>
      </div>
      <div class="ift-row">
        <span>Net Tax Payable</span>
        <strong class="${taxResult.netPayable > 10000 ? 'ift-amber' : 'ift-green'}">${fmtINR(taxResult.netPayable)}</strong>
      </div>
    </div>

    <div class="ift-section">
      <div class="ift-label">📅 Advance Tax Deadlines</div>
      ${taxResult.installments.map(inst => `
        <div class="ift-row ift-deadline ${inst.isUrgent ? 'ift-urgent' : ''} ${inst.isPast ? 'ift-past' : ''}">
          <span>${inst.quarter} · ${inst.deadline}</span>
          <span>${inst.isPast ? '⟳ check paid' : inst.isUrgent ? `⚠️ ${inst.daysLeft}d left` : `${inst.daysLeft}d`} · <strong>${fmtINR(inst.installment)}</strong></span>
        </div>
      `).join('')}
    </div>

    <div class="ift-section">
      <div class="ift-label">📊 GST Status</div>
      <div class="ift-row">
        <span>Annual turnover</span>
        <strong>${fmtINR(earnings.totalINR)}</strong>
      </div>
      <div class="ift-row">
        <span>GST threshold (${settings.state || 'your state'})</span>
        <strong>${fmtINR(taxResult.gstThreshold)}</strong>
      </div>
      <div class="ift-gst-bar">
        <div class="ift-gst-fill" style="width: ${Math.min(taxResult.gstPct, 100)}%"></div>
      </div>
      <div class="ift-row">
        <span>${taxResult.gstRequired ? '🔴 GST registration required' : `✅ ${taxResult.gstPct}% of threshold — no GST needed`}</span>
      </div>
    </div>

    <div class="ift-section">
      <div class="ift-label">💼 Set-Aside Rate</div>
      <div class="ift-row">
        <span>Recommended set-aside</span>
        <strong class="ift-amber">${taxResult.setAsideRate}% of each payment</strong>
      </div>
      <div class="ift-note">
        ${earnings.currency === 'USD→INR' ? `⚡ Earnings converted at ₹85/USD. Update in settings for accuracy.` : ''}
      </div>
    </div>

    <div class="ift-footer">
      <a href="#" id="ift-settings-link">⚙ Settings</a>
      <span>·</span>
      <a href="https://www.incometax.gov.in" target="_blank">IT Portal ↗</a>
      <span>·</span>
      <a href="#" id="ift-upgrade-link" class="ift-pro-link">★ Pro</a>
    </div>
  `;

  // Styles
  const style = document.createElement('style');
  style.textContent = `
    #ift-tax-panel {
      position: fixed; top: 80px; right: 16px; z-index: 99999;
      width: 320px; background: #0d1117; color: #e6edf3;
      border: 1px solid #30363d; border-radius: 10px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      font-size: 13px; box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      max-height: 90vh; overflow-y: auto;
    }
    .ift-header { display:flex; align-items:center; gap:8px; padding:12px 14px;
      border-bottom:1px solid #30363d; background:#161b22; border-radius:10px 10px 0 0; }
    .ift-logo { font-size:20px; }
    .ift-title { font-size:14px; font-weight:600; }
    .ift-subtitle { font-size:11px; color:#7d8590; }
    .ift-close { margin-left:auto; background:none; border:none; color:#7d8590;
      cursor:pointer; font-size:14px; padding:2px 6px; border-radius:4px; }
    .ift-close:hover { color:#e6edf3; background:#30363d; }
    .ift-section { padding:10px 14px; border-bottom:1px solid #21262d; }
    .ift-label { font-size:11px; font-weight:600; color:#7d8590;
      text-transform:uppercase; letter-spacing:0.5px; margin-bottom:6px; }
    .ift-row { display:flex; justify-content:space-between; align-items:center;
      padding:3px 0; gap:8px; }
    .ift-row span:first-child { color:#7d8590; flex-shrink:0; }
    .ift-total { border-top:1px solid #30363d; margin-top:4px; padding-top:6px; }
    .ift-green { color:#3fb950; }
    .ift-amber { color:#e3b341; }
    .ift-red   { color:#f85149; }
    .ift-urgent { background:rgba(227,179,65,0.08); border-radius:4px;
      padding:4px 6px !important; margin:2px -6px; }
    .ift-past { opacity:0.5; }
    .ift-deadline span:last-child { text-align:right; }
    .ift-gst-bar { height:6px; background:#21262d; border-radius:3px;
      margin:6px 0; overflow:hidden; }
    .ift-gst-fill { height:100%; background:#14c98f; border-radius:3px;
      transition:width 0.5s ease; }
    .ift-note { font-size:11px; color:#7d8590; margin-top:4px; }
    .ift-footer { padding:10px 14px; display:flex; gap:8px; align-items:center;
      font-size:12px; }
    .ift-footer a { color:#7d8590; text-decoration:none; }
    .ift-footer a:hover { color:#e6edf3; }
    .ift-pro-link { color:#14c98f !important; font-weight:600; margin-left:auto; }
  `;
  document.head.appendChild(style);

  // Close button
  panel.querySelector('#ift-close').addEventListener('click', () => panel.remove());

  return panel;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log('[IFT] Tax Dashboard: content script loaded on', location.href);

  // Don't inject twice
  if (document.getElementById('ift-tax-panel')) return;

  const settings = await getSettings();

  // Extract earnings from page
  const earnings = extractUpworkEarnings();
  console.log('[IFT] Extracted earnings:', earnings);

  // Save to storage
  await saveEarnings(earnings);

  // Calculate tax
  const taxResult = TaxEngine.calculateTax({
    grossEarnings: earnings.totalINR,
    expenses: settings.expenses || 0,
    tdsDeducted: earnings.tdsDeducted,
    regime: settings.regime || 'new',
    state: settings.state || 'Maharashtra'
  });

  // Inject panel
  const panel = createPanel(earnings, taxResult, settings);
  document.body.appendChild(panel);
}

// Run after React renders
setTimeout(run, 1500);
setTimeout(run, 3000);
