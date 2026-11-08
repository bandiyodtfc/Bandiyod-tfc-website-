
import { getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { getDatabase, ref, get, onValue } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js';
import { firebaseConfig } from './firebase-config.js';

// TFC BANDIYOD - MEMBERSHIP INCOME v83.3
// Read-only automatic collection report.
// Existing app.js and accounts.js remain unchanged.
// No payment or accounting records are written.

const app = getApps()[0] || initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// Start counting newly recorded payments from this date.
// 08 November 2026, 00:00 India time.
const START_AT = Date.parse('2026-11-08T00:00:00+05:30');

let members = {};
let requests = {};
let memberReady = false;
let requestReady = false;
let currentUid = null;
let stopMembers = null;
let stopRequests = null;

const el = id => document.getElementById(id);

const rupees = n =>
  '₹' + Number(n || 0).toLocaleString('en-IN');

const escapeHTML = value =>
  String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));

function setupUI() {
  const parent = el('accountsPanel');
  if (!parent || el('automaticMembershipIncome')) return;

  const section = document.createElement('section');
  section.id = 'automaticMembershipIncome';
  section.className = 'panel';

  section.innerHTML = `
    <h3>Automatic Membership Income</h3>
    <p class="muted">
      New admin-verified Cash and UPI collections only.
      Historical PDF records are excluded.
    </p>

    <label for="automaticIncomeYear">Collection Year</label>
    <select id="automaticIncomeYear"></select>

    <p><strong>Total: <span id="automaticIncomeTotal">₹0</span></strong></p>
    <p>Cash: <strong id="automaticIncomeCash">₹0</strong></p>
    <p>UPI: <strong id="automaticIncomeUpi">₹0</strong></p>

    <p id="automaticIncomeStatus">Loading...</p>
    <div id="automaticIncomeHistory"></div>

    <p class="muted">
      This is a collection report, not a reconciled bank balance.
      Cancelled payment ticks require separate financial reconciliation.
    </p>
  `;

  parent.append(section);

  el('automaticIncomeYear').onchange = render;
}

function isNewTimestamp(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) &&
    timestamp >= START_AT &&
    timestamp <= Date.now() + 300000;
}

function paymentMonths(plan, period) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(period))) {
    return [];
  }

  if (plan === 'monthly') return [period];

  if (plan === 'yearly') {
    const year = period.slice(0, 4);
    return Array.from(
      { length: 12 },
      (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`
    );
  }

  return [];
}

function collectEntries() {
  const entries = [];
  const countedUPI = new Set();
  const cashGroups = new Map();

  // CASH: Each paid month is stored separately.
  // Group months belonging to the same cash save operation.
  for (const [number, member] of Object.entries(members)) {
    for (const [period, payment] of Object.entries(
      member?.payments || {}
    )) {
      if (
        payment?.status !== 'paid' ||
        payment?.method !== 'cash' ||
        !isNewTimestamp(payment.verifiedAt)
      ) continue;

      const amount = Number(payment.amount);

      if (!Number.isFinite(amount) || amount <= 0) continue;

      const groupKey = [
        number,
        payment.verifiedAt,
        payment.verifiedBy || '',
        payment.plan || '',
        payment.receivedDate || ''
      ].join('|');

      if (!cashGroups.has(groupKey)) {
        cashGroups.set(groupKey, {
          memberNumber: number,
          memberName: member.name || 'Member',
          method: 'Cash',
          date: payment.receivedDate ||
            new Date(payment.verifiedAt).toISOString().slice(0, 10),
          amount: 0,
          periods: [],
          timestamp: Number(payment.verifiedAt)
        });
      }

      const group = cashGroups.get(groupKey);
      group.amount += amount;
      group.periods.push(period);
    }
  }

  entries.push(...cashGroups.values());

  // UPI: Count one approved request once, never per paid month.
  for (const [requestId, request] of Object.entries(requests)) {
    if (
      request?.status !== 'approved' ||
      !isNewTimestamp(request.reviewedAt) ||
      countedUPI.has(requestId)
    ) continue;

    const number = String(request.memberNumber || '');
    const member = members[number];

    const keys = paymentMonths(
      request.plan,
      request.period
    );

    const expectedAmount =
      request.plan === 'yearly' ? 600 : 50;

    if (
      !member ||
      !keys.length ||
      Number(request.amount) !== expectedAmount
    ) continue;

    // Require every selected month to reference this approved request.
    const verified = keys.every(period => {
      const payment = member.payments?.[period];

      return payment?.status === 'paid' &&
        payment.requestId === requestId &&
        isNewTimestamp(payment.verifiedAt);
    });

    if (!verified) continue;

    countedUPI.add(requestId);

    const date = new Date(
      Number(request.reviewedAt)
    ).toLocaleDateString('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });

    entries.push({
      memberNumber: number,
      memberName: member.name || 'Member',
      method: 'UPI',
      date,
      amount: expectedAmount,
      periods: keys,
      timestamp: Number(request.reviewedAt)
    });
  }

  return entries.sort((a, b) => b.timestamp - a.timestamp);
}

function render() {
  setupUI();

  const history = el('automaticIncomeHistory');
  const yearSelect = el('automaticIncomeYear');

  if (!history || !yearSelect) return;

  if (!memberReady || !requestReady) {
    el('automaticIncomeStatus').textContent =
      'Loading verified payment records...';
    return;
  }

  const entries = collectEntries();
  const previous = yearSelect.value || 'all';

  const years = [...new Set(
    entries.map(item => item.date.slice(0, 4))
  )].sort().reverse();

  yearSelect.replaceChildren(new Option('All Years', 'all'));

  for (const year of years) {
    yearSelect.add(new Option(year, year));
  }

  yearSelect.value = years.includes(previous) ?
    previous : 'all';

  const filtered = entries.filter(item =>
    yearSelect.value === 'all' ||
    item.date.startsWith(yearSelect.value)
  );

  const cash = filtered
    .filter(item => item.method === 'Cash')
    .reduce((sum, item) => sum + item.amount, 0);

  const upi = filtered
    .filter(item => item.method === 'UPI')
    .reduce((sum, item) => sum + item.amount, 0);

  el('automaticIncomeCash').textContent = rupees(cash);
  el('automaticIncomeUpi').textContent = rupees(upi);
  el('automaticIncomeTotal').textContent = rupees(cash + upi);

  el('automaticIncomeStatus').textContent =
    `${filtered.length} verified collection(s)`;

  if (!filtered.length) {
    history.textContent =
      'No new verified Cash/UPI collections for this period.';
    return;
  }

  history.innerHTML = `
    <div style="overflow-x:auto">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Member</th>
            <th>Method</th>
            <th>Period</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(item => `
            <tr>
              <td>${escapeHTML(item.date)}</td>
              <td>#${escapeHTML(item.memberNumber)}
                  ${escapeHTML(item.memberName)}</td>
              <td>${escapeHTML(item.method)}</td>
              <td>${escapeHTML(item.periods.join(', '))}</td>
              <td>${rupees(item.amount)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function stopListening() {
  if (stopMembers) stopMembers();
  if (stopRequests) stopRequests();

  stopMembers = null;
  stopRequests = null;

  members = {};
  requests = {};
  memberReady = false;
  requestReady = false;
}

onAuthStateChanged(auth, async user => {
  stopListening();
  currentUid = user?.uid || null;

  if (!user) return;

  try {
    const adminSnap = await get(
      ref(db, `admins/${user.uid}`)
    );

    if (
      auth.currentUser?.uid !== user.uid ||
      currentUid !== user.uid ||
      adminSnap.val() !== true
    ) return;

    setupUI();

    stopMembers = onValue(
      ref(db, 'members'),
      snapshot => {
        members = snapshot.val() || {};
        memberReady = true;
        render();
      },
      error => {
        if (el('automaticIncomeStatus')) {
          el('automaticIncomeStatus').textContent =
            'Members read failed: ' + error.message;
        }
      }
    );

    stopRequests = onValue(
      ref(db, 'paymentRequests'),
      snapshot => {
        requests = snapshot.val() || {};
        requestReady = true;
        render();
      },
      error => {
        if (el('automaticIncomeStatus')) {
          el('automaticIncomeStatus').textContent =
            'Payment requests read failed: ' + error.message;
        }
      }
    );

  } catch (error) {
    console.error('Membership income:', error);
  }
});

setupUI();
