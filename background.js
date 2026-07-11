'use strict';

// Show badge on toolbar when an advance tax deadline is within 7 days
chrome.alarms.create('deadlineCheck', { periodInMinutes: 60 * 12 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'deadlineCheck') return;

  const DEADLINES = [
    { month: 5,  day: 15 }, // 15 Jun
    { month: 8,  day: 15 }, // 15 Sep
    { month: 11, day: 15 }, // 15 Dec
    { month: 2,  day: 15 }  // 15 Mar
  ];

  const fyYear = new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1;
  let showBadge = false;

  for (const d of DEADLINES) {
    const year = d.month === 2 ? fyYear + 1 : fyYear;
    const deadline = new Date(year, d.month, d.day);
    const daysLeft = Math.ceil((deadline - Date.now()) / 86400000);
    if (daysLeft >= 0 && daysLeft <= 7) { showBadge = true; break; }
  }

  chrome.action.setBadgeText({ text: showBadge ? '!' : '' });
  if (showBadge) chrome.action.setBadgeBackgroundColor({ color: '#e3b341' });
});
