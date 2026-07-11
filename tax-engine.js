/**
 * Indian Freelancer Tax Engine
 * Pure calculation logic — no DOM, no Chrome APIs.
 * Used by both content scripts and popup.
 *
 * Covers FY 2025-26 (Apr 2025 – Mar 2026)
 */

'use strict';

// ─── Constants ───────────────────────────────────────────────────────────────

const GST_THRESHOLD_GENERAL = 2000000;   // ₹20L — most states
const GST_THRESHOLD_SPECIAL  = 1000000;  // ₹10L — NE + hill states
const TDS_RATE = 0.01;                   // 1% under Section 194O

// Special category states with lower GST threshold
const SPECIAL_CATEGORY_STATES = [
  'Manipur', 'Mizoram', 'Nagaland', 'Tripura', 'Meghalaya',
  'Arunachal Pradesh', 'Sikkim', 'Uttarakhand', 'Himachal Pradesh',
  'Jammu & Kashmir', 'Ladakh'
];

// Advance tax schedule (cumulative % by each deadline)
const ADVANCE_TAX_SCHEDULE = [
  { quarter: 'Q1', deadline: { month: 5, day: 15 }, cumPct: 0.15 },  // 15 Jun (month 5 = June)
  { quarter: 'Q2', deadline: { month: 8, day: 15 }, cumPct: 0.45 },  // 15 Sep
  { quarter: 'Q3', deadline: { month: 11, day: 15 }, cumPct: 0.75 }, // 15 Dec
  { quarter: 'Q4', deadline: { month: 2, day: 15 }, cumPct: 1.00 }   // 15 Mar (next year)
];

// New Tax Regime slabs FY 2025-26 (Budget 2025 — revised slabs)
const NEW_REGIME_SLABS = [
  { upto: 400000,  rate: 0 },
  { upto: 800000,  rate: 0.05 },
  { upto: 1200000, rate: 0.10 },
  { upto: 1600000, rate: 0.15 },
  { upto: 2000000, rate: 0.20 },
  { upto: 2400000, rate: 0.25 },
  { upto: Infinity, rate: 0.30 }
];

// Old Tax Regime slabs FY 2025-26
const OLD_REGIME_SLABS = [
  { upto: 250000,  rate: 0 },
  { upto: 500000,  rate: 0.05 },
  { upto: 1000000, rate: 0.20 },
  { upto: Infinity, rate: 0.30 }
];

// ─── Financial Year Helpers ───────────────────────────────────────────────────

/**
 * Returns start and end timestamps for a given financial year.
 * India FY: 1 April to 31 March.
 * @param {number} startYear — e.g. 2025 for FY 2025-26
 */
function getFYRange(startYear) {
  const start = new Date(startYear, 3, 1).getTime();       // 1 Apr
  const end   = new Date(startYear + 1, 2, 31, 23, 59, 59).getTime(); // 31 Mar
  return { start, end };
}

/** Current FY start year (e.g. 2025 for FY 2025-26) */
function currentFYStartYear() {
  const now = new Date();
  return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
}

/** Format date as "15 Sep 2025" */
function fmtDate(date) {
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Format INR */
function fmtINR(n) {
  if (n === null || n === undefined) return '—';
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

// ─── Tax Computation ──────────────────────────────────────────────────────────

/**
 * Calculate income tax using slab rates.
 * @param {number} taxableIncome — after deductions
 * @param {string} regime — 'new' | 'old'
 * @returns {number} tax amount before cess
 */
function calcSlabTax(taxableIncome, regime = 'new') {
  const slabs = regime === 'old' ? OLD_REGIME_SLABS : NEW_REGIME_SLABS;
  let tax = 0;
  let prev = 0;
  for (const slab of slabs) {
    if (taxableIncome <= prev) break;
    const chunk = Math.min(taxableIncome, slab.upto) - prev;
    tax += chunk * slab.rate;
    prev = slab.upto;
  }
  return tax;
}

/**
 * Full tax calculation for a freelancer.
 *
 * @param {object} params
 *   grossEarnings    — total FY earnings in INR
 *   expenses         — estimated deductible expenses (0 for new regime)
 *   tdsDeducted      — TDS already deducted (claimable)
 *   regime           — 'new' | 'old'
 *   state            — Indian state name (for GST threshold)
 *
 * @returns {object} full tax breakdown
 */
function calculateTax({ grossEarnings, expenses = 0, tdsDeducted = 0, regime = 'new', state = 'Maharashtra' }) {
  // Taxable income
  const deductions = regime === 'old' ? Math.min(expenses, grossEarnings * 0.5) : 0; // 50% presumptive under 44ADA
  const taxableIncome = Math.max(0, grossEarnings - deductions);

  // Income tax
  const baseTax = calcSlabTax(taxableIncome, regime);

  // Rebate under 87A (new regime: rebate up to ₹25,000 if income ≤ ₹7L)
  const rebate = (regime === 'new' && taxableIncome <= 700000) ? Math.min(baseTax, 25000) : 0;
  const taxAfterRebate = Math.max(0, baseTax - rebate);

  // Health & Education Cess @ 4%
  const cess = taxAfterRebate * 0.04;
  const totalTax = taxAfterRebate + cess;

  // Net payable after TDS credit
  const netPayable = Math.max(0, totalTax - tdsDeducted);

  // Advance tax required if net payable > ₹10,000
  const advanceTaxRequired = netPayable > 10000;

  // GST threshold
  const gstThreshold = SPECIAL_CATEGORY_STATES.includes(state)
    ? GST_THRESHOLD_SPECIAL
    : GST_THRESHOLD_GENERAL;
  const gstPct = (grossEarnings / gstThreshold) * 100;
  const gstRequired = grossEarnings >= gstThreshold;

  // Advance tax installments
  const fyStart = currentFYStartYear();
  const installments = ADVANCE_TAX_SCHEDULE.map((item, i) => {
    const year = item.quarter === 'Q4' ? fyStart + 1 : fyStart;
    const deadline = new Date(year, item.deadline.month, item.deadline.day);
    const due = Math.round(netPayable * item.cumPct);
    const prevDue = i > 0 ? Math.round(netPayable * ADVANCE_TAX_SCHEDULE[i-1].cumPct) : 0;
    const installmentAmt = due - prevDue;
    const daysLeft = Math.ceil((deadline - Date.now()) / 86400000);
    return {
      quarter: item.quarter,
      deadline: fmtDate(deadline),
      deadlineTs: deadline.getTime(),
      cumulative: due,
      installment: installmentAmt,
      daysLeft,
      isPast: daysLeft < 0,
      isUrgent: daysLeft >= 0 && daysLeft <= 30
    };
  });

  // Set-aside rate (rough: tax / gross)
  const setAsideRate = grossEarnings > 0 ? totalTax / grossEarnings : 0.30;

  return {
    grossEarnings,
    taxableIncome,
    deductions,
    baseTax,
    rebate,
    taxAfterRebate,
    cess,
    totalTax,
    tdsDeducted,
    netPayable,
    advanceTaxRequired,
    gstThreshold,
    gstRequired,
    gstPct: Math.round(gstPct * 10) / 10,
    installments,
    setAsideRate: Math.round(setAsideRate * 100),
    regime,
    fyLabel: `FY ${fyStart}-${String(fyStart + 1).slice(2)}`
  };
}

/**
 * Calculate set-aside for a single payment.
 * @param {number} payment — gross payment received
 * @param {number} setAsideRate — percentage (e.g. 30)
 * @returns {object}
 */
function calcPaymentSetAside(payment, setAsideRate = 30) {
  const tds = Math.round(payment * TDS_RATE);
  const setAside = Math.round(payment * (setAsideRate / 100));
  const available = payment - setAside;
  return { payment, tds, setAside, available, setAsideRate };
}

// ─── Exports (module pattern for content scripts) ─────────────────────────────

const TaxEngine = {
  calculateTax,
  calcPaymentSetAside,
  getFYRange,
  currentFYStartYear,
  fmtINR,
  fmtDate,
  TDS_RATE,
  GST_THRESHOLD_GENERAL,
  GST_THRESHOLD_SPECIAL,
  SPECIAL_CATEGORY_STATES
};

// Works as both a module and a plain script
if (typeof module !== 'undefined') module.exports = TaxEngine;
