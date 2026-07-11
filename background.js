/**
 * Indian Freelancer Tax Dashboard — Background Service Worker
 * Handles tax deadline alarms only. All data is read/written by content scripts
 * and popup directly via chrome.storage.local.
 */

'use strict';

// Set up daily alarm to check for upcoming tax deadlines
chrome.alarms.create('deadlineCheck', { periodInMinutes: 60 * 24 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'deadlineCheck') return;

  const data = await chrome.storage.local.get(['earnings', 'settings', 'dismissedAlarms']);
  if (!data.earnings?.length) return;

  const settings = data.settings || { regime: 'new', state: 'Maharashtra' };
  const fyYear = new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1;
  const fyEarnings = data.earnings.find(e => e.fyYear === fyYear);
  if (!fyEarnings) return;

  // Check for upcoming deadlines within 7 days
  const ADVANCE_TAX_SCHEDULE = [
    { quarter: 'Q1', month: 5, day: 15 },
    { quarter: 'Q2', month: 8, day: 15 },
    { quarter: 'Q3', month: 11, day: 15 },
    { quarter: 'Q4', month: 2, day: 15 }
  ];

  for (const item of ADVANCE_TAX_SCHEDULE) {
    const year = item.quarter === 'Q4' ? fyYear + 1 : fyYear;
    const deadline = new Date(year, item.month, item.day);
    const daysLeft = Math.ceil((deadline - Date.now()) / 86400000);

    if (daysLeft >= 0 && daysLeft <= 7) {
      const alarmKey = `${item.quarter}-${fyYear}`;
      if (!(data.dismissedAlarms || []).includes(alarmKey)) {
        chrome.action.setBadgeText({ text: '!' });
        chrome.action.setBadgeBackgroundColor({ color: '#e3b341' });
        break;
      }
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  }
});

// Clear badge when popup opens
chrome.action.onClicked?.addListener(() => {
  chrome.action.setBadgeText({ text: '' });
});
