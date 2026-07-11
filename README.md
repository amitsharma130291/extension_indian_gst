# Indian Freelancer Tax Dashboard

Know exactly what you owe in tax, when to pay it, and how much to set aside — right from your Upwork or Fiverr earnings page.

**Built for Indian freelancers earning from foreign platforms.**

---

## What It Does

| Feature | Details |
|---|---|
| **Earnings tracker** | Reads your Upwork/Fiverr earnings page and calculates FY totals |
| **Tax estimate** | Income tax under new or old regime, with correct slab rates |
| **TDS tracking** | Shows 1% TDS deducted by Upwork (Section 194O) — claimable in ITR |
| **Advance tax schedule** | Exact amounts due on 15 Jun / 15 Sep / 15 Dec / 15 Mar |
| **GST threshold monitor** | Tracks % of ₹20L threshold used — warns before you cross it |
| **Set-aside calculator** | Enter any payment amount → shows exact tax set-aside |
| **Tax checklist** | Form 26AS, advance tax, books, ITR — stays across sessions |

---

## Zero Trust

- No account connection, no OAuth, no PAN/GSTIN required
- Reads only the earnings pages you're already viewing
- All data stored locally in `chrome.storage.local`
- Nothing sent to any server — ever

---

## Install

1. Download or clone this repo
2. Open Chrome → `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** → select the `extension/` folder
5. Visit your Upwork payments page — the tax panel appears automatically

---

## First-Time Setup (1 minute)

1. Click the extension icon (🇮🇳 in your toolbar)
2. Click **⚙ Settings**
3. Select your state (affects GST threshold — ₹10L for NE/hill states)
4. Select tax regime (New is default from FY 2023-24)
5. Optionally enter your annual expenses (for old regime deductions)
6. Save

Your earnings are auto-detected from the Upwork payments page. If it's not accurate, set **Manual Earnings** in settings.

---

## Tax Logic

### Income Tax (New Regime FY 2025-26)
| Slab | Rate |
|---|---|
| Up to ₹4L | 0% |
| ₹4L – ₹8L | 5% |
| ₹8L – ₹12L | 10% |
| ₹12L – ₹16L | 15% |
| ₹16L – ₹20L | 20% |
| ₹20L – ₹24L | 25% |
| Above ₹24L | 30% |

Rebate under 87A: up to ₹25,000 if taxable income ≤ ₹7L (new regime).
Health & Education Cess: 4% on tax.

### Advance Tax Deadlines
| Quarter | Deadline | Cumulative % |
|---|---|---|
| Q1 | 15 June | 15% |
| Q2 | 15 September | 45% |
| Q3 | 15 December | 75% |
| Q4 | 15 March | 100% |

Required if net tax liability > ₹10,000/year. Interest @ 1%/month for late payment.

### TDS (Section 194O)
Upwork deducts 1% TDS on payments to Indian bank accounts.
This is claimable as tax already paid when filing ITR.

### GST Threshold
- ₹20,00,000 for most states
- ₹10,00,000 for NE and hill states (Manipur, Mizoram, Nagaland, Tripura, Meghalaya, Arunachal Pradesh, Sikkim, Uttarakhand, Himachal Pradesh, J&K, Ladakh)

---

## Roadmap (Pro Features)

1. **Deadline push notifications** — Chrome notification 7 days before each advance tax due date
2. **Challan 280 pre-fill** — Auto-fill IT payment form with your details
3. **Multi-year view** — Compare earnings and tax across FYs
4. **Excel export** — Full tax working sheet for your CA
5. **GST invoice generator** — One-click GST invoice from each Upwork payment

---

## Disclaimer

This extension provides estimates for planning purposes only. Tax laws change — consult a CA for filing. The developer is not responsible for any tax penalties arising from reliance on this tool.

---

## Privacy

All data is local. No analytics, no tracking, no servers. The source code is yours to inspect.
