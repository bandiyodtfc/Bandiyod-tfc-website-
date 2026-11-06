
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';

import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';

import {
  getDatabase,
  ref,
  get,
  set,
  update,
  onValue,
  push,
  query,
  orderByChild,
  equalTo,
  runTransaction
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js';

import { firebaseConfig } from './firebase-config.js';

// ===================================================
// TFC BANDIYOD MEMBER PORTAL
// VERSION 75.5
//
// Existing 2024-2026 history preserved.
// 2027 import is NOT performed by this file.
// Future years supported dynamically.
// Yearly payment = January to December.
// Photo upload is disabled.
// Final archive write is disabled.
// ===================================================

const ARCHIVE_WRITE_ENABLED = false;
const MONTHLY_FEE = 50;
const YEARLY_FEE = 600;
const FIRST_YEAR = 2024;

const UPI_ID = 'waheedwahi84-1@oksbi';
const UPI_NAME = 'Waheed Wahi';

const $ = id => document.getElementById(id);

function show(id, visible) {
  const element = $(id);
  if (element) {
    element.classList.toggle('hide', !visible);
  }
}

function notify(message, error = false) {
  const element = $('msg');
  if (!element) return;

  element.textContent = message;
  element.className = error ? 'error' : 'ok';
}

function escapeHTML(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[character])
  );
}

function makeButton(label, handler, css = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  if (css) button.className = css;
  button.onclick = handler;
  return button;
}

function validMemberNumber(number) {
  return Number.isSafeInteger(Number(number)) &&
    Number(number) >= 1 &&
    Number(number) <= 99999;
}

function validPhone(value) {
  return !value ||
    /^[0-9+\s()-]{7,15}$/.test(value);
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00`);

  return !Number.isNaN(date.getTime()) &&
    date.getFullYear() === Number(value.slice(0, 4)) &&
    date.getMonth() + 1 === Number(value.slice(5, 7)) &&
    date.getDate() === Number(value.slice(8, 10));
}

function localDateString() {
  const date = new Date();

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function currentPeriod() {
  return localDateString().slice(0, 7);
}

function validPeriod(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(
    String(value || '')
  );
}

function currentYear() {
  return new Date().getFullYear();
}

function periodYear(period) {
  return Number(String(period).slice(0, 4));
}

// ===================================================
// LANGUAGE
// ===================================================

const dict = {
  en: {
    welcome: 'Welcome to TFC Bandiyod',
    loginText:
      'Members can sign in with Google. New accounts require admin approval.',
    signIn: 'Continue with Google',
    pending: 'Membership approval pending',
    pendingText:
      'Your Google account needs approval from the TFC admin.',
    memberNumber: 'Membership number',
    request: 'Request approval',
    due: 'Outstanding dues',
    paid: 'Paid months',
    fee: 'Membership fee',
    history: 'Payment history',
    month: 'Month',
    status: 'Status',
    pay: 'Pay membership fee',
    admin: 'Admin dashboard'
  },
  ml: {
    welcome: 'TFC ബണ്ടിയോടിലേക്ക് സ്വാഗതം',
    loginText:
      'Google ഉപയോഗിച്ച് പ്രവേശിക്കാം. പുതിയ അംഗങ്ങൾക്ക് അഡ്മിൻ അനുമതി ആവശ്യമാണ്.',
    signIn: 'Google ഉപയോഗിച്ച് പ്രവേശിക്കുക',
    pending: 'അംഗത്വ അനുമതി കാത്തിരിക്കുന്നു',
    pendingText:
      'നിങ്ങളുടെ Google അക്കൗണ്ടിന് അഡ്മിൻ അനുമതി ആവശ്യമാണ്.',
    memberNumber: 'അംഗ നമ്പർ',
    request: 'അനുമതി അഭ്യർത്ഥിക്കുക',
    due: 'കുടിശ്ശിക',
    paid: 'അടച്ച മാസങ്ങൾ',
    fee: 'അംഗത്വ ഫീസ്',
    history: 'പേയ്മെന്റ് ചരിത്രം',
    month: 'മാസം',
    status: 'നില',
    pay: 'അംഗത്വ ഫീസ് അടയ്ക്കുക',
    admin: 'അഡ്മിൻ ഡാഷ്ബോർഡ്'
  }
};

if ($('lang')) {
  $('lang').onchange = () => {
    const language = $('lang').value;

    document.querySelectorAll('[data-t]').forEach(
      element => {
        const translated =
          dict[language]?.[element.dataset.t];

        if (translated) {
          element.textContent = translated;
        }
      }
    );
  };
}

// ===================================================
// APPLICATION STATE
// ===================================================

let auth;
let db;

let current = null;
let admin = false;
let memberNumber = null;

let memberList = {};
let payments = {};
let historicalPayments = {};
let currentMemberData = null;

let archivedMembers = {};
let adminHistoryCache = {};

let historyLoaded = false;
let historyError = false;

let membersLoaded = false;
let adminHistoryLoaded = false;
let paymentRequestsLoaded = false;
let archiveLoaded = false;

let selectedAdminMember = null;

let archiveBusy = false;
let paymentBusy = false;
let approvalBusy = false;

let unsubscribers = [];

function isAdmin() {
  return !!current && admin;
}

function isActiveMember(member) {
  return !!member &&
    ![
      'inactive',
      'suspended',
      'archiving',
      'archived'
    ].includes(member.status);
}

function canEditMember(member) {
  return !!member &&
    !['archiving', 'archived'].includes(
      member.status
    );
}

function stopListeners() {
  for (const unsubscribe of unsubscribers) {
    try {
      unsubscribe();
    } catch (_) {}
  }

  unsubscribers = [];

  memberList = {};
  payments = {};
  historicalPayments = {};
  currentMemberData = null;

  archivedMembers = {};
  adminHistoryCache = {};

  historyLoaded = false;
  historyError = false;

  membersLoaded = false;
  adminHistoryLoaded = false;
  paymentRequestsLoaded = false;
  archiveLoaded = false;

  selectedAdminMember = null;

  archiveBusy = false;
  paymentBusy = false;
  approvalBusy = false;
}

// ===================================================
// FUTURE YEAR SUPPORT
// ===================================================

function availableYears(member = null, history = null) {
  const years = new Set();

  const latestYear = currentYear() + 1;

  for (
    let year = FIRST_YEAR;
    year <= latestYear;
    year++
  ) {
    years.add(year);
  }

  const joiningYear = Number(
    member?.joiningDate?.slice(0, 4)
  );

  if (
    Number.isInteger(joiningYear) &&
    joiningYear >= 1900 &&
    joiningYear <= 9999
  ) {
    years.add(joiningYear);
  }

  for (const year of Object.keys(
    history?.months || {}
  )) {
    if (/^\d{4}$/.test(year)) {
      years.add(Number(year));
    }
  }

  for (const period of Object.keys(
    member?.payments || {}
  )) {
    if (validPeriod(period)) {
      years.add(periodYear(period));
    }
  }

  return [...years].sort((a, b) => b - a);
}

function populateYearSelect(
  id,
  member = null,
  history = null
) {
  const select = $(id);
  if (!select) return;

  const previous = select.value || 'all';

  select.replaceChildren();

  const allOption = document.createElement('option');
  allOption.value = 'all';
  allOption.textContent = 'All Years';
  select.append(allOption);

  for (const year of availableYears(member, history)) {
    const option = document.createElement('option');
    option.value = String(year);
    option.textContent = String(year);
    select.append(option);
  }

  const exists = [...select.options].some(
    option => option.value === previous
  );

  select.value = exists ? previous : 'all';
}

function selectedYear(id) {
  return $(id)?.value || 'all';
}

function matchesYear(period, year) {
  return year === 'all' ||
    String(period).startsWith(`${year}-`);
}

// ===================================================
// HISTORICAL PAYMENT HELPERS
// ===================================================

function isHistoricalPaid(history, year, month) {
  if (year < FIRST_YEAR) return false;

  const value =
    history?.months?.[String(year)]?.[
      String(month).padStart(2, '0')
    ];

  return value === 'marked_paid' ||
    (
      value !== null &&
      typeof value === 'object' &&
      (
        value.status === 'marked_paid' ||
        value.status === 'paid'
      )
    );
}

function collectPaidMonths(member, history) {
  const paid = new Set();

  for (const year of Object.keys(
    history?.months || {}
  )) {
    if (!/^\d{4}$/.test(year)) continue;

    for (let month = 1; month <= 12; month++) {
      if (
        isHistoricalPaid(
          history,
          Number(year),
          month
        )
      ) {
        paid.add(
          `${year}-${String(month).padStart(2, '0')}`
        );
      }
    }
  }

  for (const [period, record] of Object.entries(
    member?.payments || {}
  )) {
    if (
      validPeriod(period) &&
      record?.status === 'paid'
    ) {
      paid.add(period);
    }
  }

  return [...paid].sort();
}

function historyPeriods(member, paidMonths) {
  const last = currentPeriod();

  let first =
    member?.joiningDate?.slice(0, 7) ||
    '2024-01';

  if (!validPeriod(first)) {
    first = '2024-01';
  }

  if (paidMonths[0] && paidMonths[0] < first) {
    first = paidMonths[0];
  }

  let lastPeriod = last;

  if (
    paidMonths.length &&
    paidMonths[paidMonths.length - 1] > lastPeriod
  ) {
    lastPeriod = paidMonths[paidMonths.length - 1];
  }

  if (first > lastPeriod) return [];

  const result = [];

  const startYear = Number(first.slice(0, 4));
  const endYear = Number(lastPeriod.slice(0, 4));

  for (
    let year = startYear;
    year <= endYear;
    year++
  ) {
    for (let month = 1; month <= 12; month++) {
      const period =
        `${year}-${String(month).padStart(2, '0')}`;

      if (
        period >= first &&
        period <= lastPeriod
      ) {
        result.push(period);
      }
    }
  }

  return result;
}

function renderHistoryTable(
  member,
  history,
  target,
  year = 'all'
) {
  const paidMonths = collectPaidMonths(
    member,
    history
  );

  const paidSet = new Set(paidMonths);

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const header = document.createElement('tr');

  ['Month', 'Status'].forEach(label => {
    const th = document.createElement('th');
    th.textContent = label;
    header.append(th);
  });

  thead.append(header);
  table.append(thead);

  const tbody = document.createElement('tbody');

  for (const period of historyPeriods(
    member,
    paidMonths
  )) {
    if (!matchesYear(period, year)) continue;

    const row = document.createElement('tr');

    const monthCell = document.createElement('td');
    const statusCell = document.createElement('td');

    monthCell.textContent = period;

    const paid = paidSet.has(period);

    statusCell.textContent = paid
      ? 'Paid'
      : 'Not verified';

    statusCell.className = paid
      ? 'history-paid'
      : 'history-unverified';

    row.append(monthCell, statusCell);
    tbody.append(row);
  }

  table.append(tbody);

  const container = $(target);

  if (container) {
    container.replaceChildren(table);
  }

  return paidMonths.filter(
    period => matchesYear(period, year)
  ).length;
}

// ===================================================
// INITIAL VALUES
// ===================================================

if ($('paymentPeriod')) {
  $('paymentPeriod').value = currentPeriod();
}

if ($('newMemberDate')) {
  $('newMemberDate').value = localDateString();
}

// ===================================================
// FIREBASE INITIALIZATION
// ===================================================

if (
  !firebaseConfig.databaseURL ||
  firebaseConfig.databaseURL.startsWith('REPLACE_')
) {
  notify('Firebase configuration missing.', true);

  if ($('signIn')) {
    $('signIn').disabled = true;
  }
} else {
  const app = initializeApp(firebaseConfig);

  auth = getAuth(app);
  db = getDatabase(app);

  onAuthStateChanged(auth, handleAuthChange);
}

// ===================================================
// AUTHENTICATION
// ===================================================

async function handleAuthChange(user) {
  stopListeners();

  current = user;
  admin = false;
  memberNumber = null;

  show('login', !user);
  show('logout', !!user);

  ['pending', 'member', 'admin'].forEach(
    id => show(id, false)
  );

  if (!user) return;

  try {
    const adminSnapshot = await get(
      ref(db, `admins/${user.uid}`)
    );

    if (auth.currentUser?.uid !== user.uid) {
      return;
    }

    admin = adminSnapshot.val() === true;

    if (admin) {
      show('admin', true);
      loadAdmin();
      tab('requests');
      return;
    }

    const userSnapshot = await get(
      ref(db, `users/${user.uid}`)
    );

    const record = userSnapshot.val();

    if (
      record?.status === 'approved' &&
      record.memberNumber
    ) {
      const number = String(record.memberNumber);

      const memberSnapshot = await get(
        ref(db, `members/${number}`)
      );

      const member = memberSnapshot.val();

      if (auth.currentUser?.uid !== user.uid) {
        return;
      }

      if (
        isActiveMember(member) &&
        member.uid === user.uid
      ) {
        memberNumber = Number(number);
        currentMemberData = member;

        show('member', true);
        renderMember(member);

        loadMemberListeners(number, user.uid);
        updateUpiLink();

        return;
      }
    }

    show('pending', true);

    if ($('claimNumber')) {
      $('claimNumber').value =
        record?.requestedNumber || '';
    }

  } catch (error) {
    notify(
      'Database error: ' + error.message,
      true
    );
  }
}

async function loginWithGoogle() {
  try {
    await signInWithPopup(
      auth,
      new GoogleAuthProvider()
    );
  } catch (error) {
    notify(
      'Login error: ' + error.message,
      true
    );
  }
}

$('signIn').onclick = loginWithGoogle;
$('logout').onclick = () => signOut(auth);

// ===================================================
// MEMBER APPROVAL REQUEST
// ===================================================

$('requestApproval').onclick = async () => {
  if (!current || admin) return;

  const number = Number($('claimNumber').value);

  if (!validMemberNumber(number)) {
    return notify(
      'Enter valid member number.',
      true
    );
  }

  try {
    await set(
      ref(db, `requests/${current.uid}`),
      {
        uid: current.uid,
        email: current.email || '',
        name: current.displayName || '',
        requestedNumber: number,
        createdAt: Date.now(),
        status: 'pending'
      }
    );

    notify('Approval request submitted.');

  } catch (error) {
    notify(error.message, true);
  }
};

// ===================================================
// MEMBER REALTIME LISTENERS
// ===================================================

function loadMemberListeners(number, uid) {
  unsubscribers.push(
    onValue(
      ref(db, `members/${number}`),
      snapshot => {
        const member = snapshot.val();

        if (
          !isActiveMember(member) ||
          member.uid !== uid
        ) {
          currentMemberData = null;

          show('member', false);
          show('pending', true);

          notify(
            'Membership access is not active.',
            true
          );

          return;
        }

        currentMemberData = member;
        renderMember(member);
      },
      error => {
        show('member', false);
        notify(error.message, true);
      }
    )
  );

  unsubscribers.push(
    onValue(
      ref(db, `paymentHistory/${number}`),
      snapshot => {
        historicalPayments =
          snapshot.val() || {};

        historyLoaded = true;
        historyError = false;

        renderMember(currentMemberData);
      },
      error => {
        historyLoaded = true;
        historyError = true;

        notify(
          'Historical payment error: ' +
          error.message,
          true
        );

        renderMember(currentMemberData);
      }
    )
  );

  unsubscribers.push(
    onValue(
      query(
        ref(db, 'paymentRequests'),
        orderByChild('uid'),
        equalTo(uid)
      ),
      snapshot => {
        renderMyPayments(snapshot.val() || {});
      },
      error => notify(error.message, true)
    )
  );
}

// ===================================================
// MEMBER DASHBOARD
// ===================================================

function renderMember(member) {
  if (!member) return;

  $('memberTitle').textContent =
    member.name || 'Member';

  $('memberMeta').textContent =
    'Member #' + (member.number || memberNumber);

  populateYearSelect(
    'memberHistoryYear',
    member,
    historicalPayments
  );

  const selected = selectedYear('memberHistoryYear');

  const paid = collectPaidMonths(
    member,
    historicalPayments
  );

  const paidSet = new Set(paid);
  const rows = [];

  for (const period of historyPeriods(member, paid)) {
    if (!matchesYear(period, selected)) continue;

    let status = 'Not verified';

    if (paidSet.has(period)) {
      status = 'Paid';
    } else if (!historyLoaded) {
      status = 'Loading';
    } else if (historyError) {
      status = 'History unavailable';
    }

    rows.push(
      `<tr>
        <td>${escapeHTML(period)}</td>
        <td>${escapeHTML(status)}</td>
      </tr>`
    );
  }

  $('paidCount').textContent =
    !historyLoaded
      ? 'Loading'
      : historyError
        ? 'Unavailable'
        : String(
            paid.filter(
              period => matchesYear(period, selected)
            ).length
          );

  // Dues must not be calculated from
  // unverified historical joining dates.

  $('dueAmount').textContent = 'Not verified';

  $('historyBody').innerHTML = rows.join('');
}

if ($('memberHistoryYear')) {
  $('memberHistoryYear').onchange = () => {
    renderMember(currentMemberData);
  };
}

// ===================================================
// ADMIN LISTENERS
// ===================================================

function loadAdmin() {
  unsubscribers.push(
    onValue(
      ref(db, 'requests'),
      snapshot => {
        renderApprovalRequests(snapshot.val() || {});
      },
      error => notify(error.message, true)
    )
  );

  unsubscribers.push(
    onValue(
      ref(db, 'members'),
      snapshot => {
        memberList = snapshot.val() || {};
        membersLoaded = true;

        renderAdminMembers();
        renderPhotoMembers();

        if (selectedAdminMember !== null) {
          renderAdminPaymentHistory(
            selectedAdminMember
          );
        }

        updateArchiveButton();
      },
      error => {
        membersLoaded = false;
        notify(error.message, true);
        updateArchiveButton();
      }
    )
  );

  unsubscribers.push(
    onValue(
      ref(db, 'paymentRequests'),
      snapshot => {
        payments = snapshot.val() || {};
        paymentRequestsLoaded = true;

        renderAdminPayments();
        updateArchiveButton();
      },
      error => {
        paymentRequestsLoaded = false;
        notify(error.message, true);
        updateArchiveButton();
      }
    )
  );

  unsubscribers.push(
    onValue(
      ref(db, 'paymentHistory'),
      snapshot => {
        adminHistoryCache = snapshot.val() || {};
        adminHistoryLoaded = true;

        renderAdminMembers();

        if (selectedAdminMember !== null) {
          renderAdminPaymentHistory(
            selectedAdminMember
          );
        }

        updateArchiveButton();
      },
      error => {
        adminHistoryLoaded = false;
        notify(error.message, true);
        updateArchiveButton();
      }
    )
  );

  unsubscribers.push(
    onValue(
      ref(db, 'archivedMembers'),
      snapshot => {
        archivedMembers = snapshot.val() || {};
        archiveLoaded = true;

        renderArchivedMembers();
        updateArchiveButton();
      },
      error => {
        archiveLoaded = false;
        notify(error.message, true);
        updateArchiveButton();
      }
    )
  );
}

// ===================================================
// APPROVAL REQUESTS
// ===================================================

function renderApprovalRequests(data) {
  const container = $('requestsList');
  container.replaceChildren();

  let count = 0;

  for (const [uid, request] of Object.entries(data)) {
    if (request.status !== 'pending') continue;

    count++;

    const box = document.createElement('div');
    box.className = 'panel';

    const info = document.createElement('p');

    info.textContent =
      `${request.name || ''} ` +
      `(${request.email || ''}) — ` +
      `requested #${request.requestedNumber}`;

    box.append(
      info,
      makeButton(
        'Approve',
        () => approve(uid, request)
      )
    );

    container.append(box);
  }

  if (!count) {
    container.textContent =
      'No pending approval requests.';
  }
}

async function approve(uid, request) {
  if (!isAdmin() || approvalBusy) return;

  const number = String(request.requestedNumber);
  const member = memberList[number];

  if (!isActiveMember(member)) {
    return notify('Member is not active.', true);
  }

  if (member.uid && member.uid !== uid) {
    return notify(
      'Already linked to another account.',
      true
    );
  }

  if (!confirm(
    `Approve ${request.email} as member ` +
    `#${number} (${member.name})?`
  )) return;

  approvalBusy = true;

  try {
    const memberRef = ref(db, `members/${number}`);

    const freshRequest = (
      await get(ref(db, `requests/${uid}`))
    ).val();

    if (
      !freshRequest ||
      freshRequest.status !== 'pending' ||
      String(freshRequest.requestedNumber) !== number
    ) {
      throw new Error('Approval request changed.');
    }

    const freshMember = (
      await get(memberRef)
    ).val();

    if (
      !isActiveMember(freshMember) ||
      (freshMember.uid && freshMember.uid !== uid)
    ) {
      throw new Error(
        'Member is inactive, locked or already linked.'
      );
    }

    await update(ref(db), {
      [`members/${number}/uid`]: uid,
      [`users/${uid}`]: {
        status: 'approved',
        memberNumber: Number(number),
        email: freshRequest.email || ''
      },
      [`requests/${uid}/status`]: 'approved'
    });

    notify('Member approved.');

  } catch (error) {
    notify(error.message, true);
  } finally {
    approvalBusy = false;
  }
}

// ===================================================
// ADMIN MEMBERS
// ===================================================

function renderAdminMembers() {
  const container = $('membersList');
  container.replaceChildren();

  const search =
    ($('search').value || '').toLowerCase();

  const entries = Object.entries(memberList)
    .filter(([id, member]) =>
      `${id} ${member?.name || ''}`
        .toLowerCase()
        .includes(search)
    )
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .slice(0, 300);

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const header = document.createElement('tr');

  [
    '#',
    'Name',
    'Login',
    'Status',
    'Paid Months',
    'Paid Amount',
    'Actions'
  ].forEach(label => {
    const th = document.createElement('th');
    th.textContent = label;
    header.append(th);
  });

  thead.append(header);
  table.append(thead);

  const tbody = document.createElement('tbody');

  for (const [number, member] of entries) {
    const row = document.createElement('tr');

    const paid = adminHistoryLoaded
      ? collectPaidMonths(
          member,
          adminHistoryCache[number] || {}
        )
      : [];

    const values = [
      number,
      member?.name || '',
      member?.uid ? 'Linked' : 'Not linked',
      member?.status || 'active',
      adminHistoryLoaded
        ? String(paid.length)
        : 'Loading',
      adminHistoryLoaded
        ? `₹${paid.length * MONTHLY_FEE}`
        : 'Loading'
    ];

    for (const value of values) {
      const td = document.createElement('td');
      td.textContent = value;
      row.append(td);
    }

    const actions = document.createElement('td');

    const historyButton = makeButton(
      'View History',
      () => renderAdminPaymentHistory(number)
    );

    historyButton.disabled = !adminHistoryLoaded;

    const editButton = makeButton(
      'Edit',
      () => openEditMember(number),
      'secondary'
    );

    editButton.disabled = !canEditMember(member);

    const archiveButton = makeButton(
      member.status === 'archived'
        ? 'Archived'
        : 'Archive',
      () => openArchiveMember(number),
      'danger'
    );

    archiveButton.disabled = !canEditMember(member);

    actions.append(
      historyButton,
      document.createTextNode(' '),
      editButton,
      document.createTextNode(' '),
      archiveButton
    );

    row.append(actions);
    tbody.append(row);
  }

  table.append(tbody);
  container.append(table);
}

function renderAdminPaymentHistory(number) {
  if (!isAdmin() || !adminHistoryLoaded) return;

  const member = memberList[String(number)];
  if (!member) return;

  selectedAdminMember = String(number);

  const history =
    adminHistoryCache[String(number)] || {};

  populateYearSelect(
    'adminHistoryYear',
    member,
    history
  );

  const year = selectedYear('adminHistoryYear');

  $('adminHistoryTitle').textContent =
    `#${number} — ${member.name || 'Member'}`;

  const count = renderHistoryTable(
    member,
    history,
    'adminHistoryTable',
    year
  );

  $('adminHistorySummary').textContent =
    `Year: ${year === 'all' ? 'All Years' : year} | ` +
    `Paid months: ${count} | ` +
    `Recorded paid equivalent: ₹${count * MONTHLY_FEE}`;

  show('adminMemberHistory', true);
}

$('search').oninput = renderAdminMembers;

if ($('adminHistoryYear')) {
  $('adminHistoryYear').onchange = () => {
    if (selectedAdminMember !== null) {
      renderAdminPaymentHistory(selectedAdminMember);
    }
  };
}

// ===================================================
// ADMIN TABS
// ===================================================

function tab(which) {
  [
    'requests',
    'members',
    'payments',
    'addMember',
    'archivedMembers',
    'memberPhotos'
  ].forEach(name => {
    show(`${name}Panel`, name === which);
  });
}

$('tabRequests').onclick =
  () => tab('requests');

$('tabMembers').onclick =
  () => tab('members');

$('tabPayments').onclick =
  () => tab('payments');

$('tabAddMember').onclick =
  () => tab('addMember');

$('tabArchivedMembers').onclick = () => {
  tab('archivedMembers');
  renderArchivedMembers();
};

if ($('tabMemberPhotos')) {
  $('tabMemberPhotos').onclick = () => {
    tab('memberPhotos');
    renderPhotoMembers();
  };
}

// ===================================================
// PHOTO MENU - NO UPLOAD YET
// ===================================================

function renderPhotoMembers() {
  const container = $('photoMembersList');
  if (!container) return;

  container.replaceChildren();

  const search =
    ($('photoMemberSearch')?.value || '')
      .trim()
      .toLowerCase();

  const entries = Object.entries(memberList)
    .filter(([number, member]) =>
      `${number} ${member?.name || ''}`
        .toLowerCase()
        .includes(search)
    )
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .slice(0, 300);

  if (!entries.length) {
    container.textContent = 'No members found.';
    return;
  }

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const heading = document.createElement('tr');

  ['Member #', 'Name', 'Photo'].forEach(label => {
    const th = document.createElement('th');
    th.textContent = label;
    heading.append(th);
  });

  thead.append(heading);
  table.append(thead);

  const tbody = document.createElement('tbody');

  for (const [number, member] of entries) {
    const row = document.createElement('tr');

    for (const value of [
      number,
      member?.name || '',
      'Upload coming soon'
    ]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }

    tbody.append(row);
  }

  table.append(tbody);
  container.append(table);
}

if ($('photoMemberSearch')) {
  $('photoMemberSearch').oninput =
    renderPhotoMembers;
}

if ($('memberPhotoUpload')) {
  $('memberPhotoUpload').disabled = true;
}

if ($('adminPhotoUpload')) {
  $('adminPhotoUpload').disabled = true;
}

// ===================================================
// ADD MEMBER
// ===================================================

$('addMemberForm').onsubmit = async event => {
  event.preventDefault();

  if (!isAdmin()) {
    return notify('Admin access required.', true);
  }

  const number = Number(
    $('newMemberNumber').value
  );

  const name = $('newMemberName').value.trim();
  const phone = $('newMemberPhone').value.trim();
  const joiningDate = $('newMemberDate').value;
  const status = $('newMemberStatus').value;

  if (!validMemberNumber(number)) {
    return notify('Invalid member number.', true);
  }

  if (!name || name.length > 100) {
    return notify('Invalid member name.', true);
  }

  if (!validPhone(phone)) {
    return notify('Invalid phone number.', true);
  }

  if (!validDate(joiningDate)) {
    return notify('Invalid joining date.', true);
  }

  if (!['active', 'inactive'].includes(status)) {
    return notify('Invalid status.', true);
  }

  const button = $('saveNewMember');
  button.disabled = true;

  try {
    const archiveSnapshot = await get(
      ref(db, `archivedMembers/${number}`)
    );

    if (archiveSnapshot.exists()) {
      throw new Error(
        'Member number is reserved in archive.'
      );
    }

    const result = await runTransaction(
      ref(db, `members/${number}`),
      existing => {
        if (existing !== null) return;

        return {
          number,
          name,
          phone,
          joiningDate,
          status,
          createdAt: Date.now(),
          createdBy: current.uid,
          payments: {}
        };
      },
      { applyLocally: false }
    );

    if (!result.committed) {
      throw new Error(
        'Member number already exists.'
      );
    }

    $('addMemberForm').reset();
    $('newMemberDate').value = localDateString();

    notify(
      `Member #${number} added successfully.`
    );

    tab('members');

  } catch (error) {
    notify('Save failed: ' + error.message, true);
  } finally {
    button.disabled = false;
  }
};

// ===================================================
// EDIT MEMBER
// ===================================================

function openEditMember(number) {
  if (!isAdmin()) return;

  const member = memberList[String(number)];

  if (!canEditMember(member)) {
    return notify(
      'Member cannot be edited.',
      true
    );
  }

  show('archiveMemberPanel', false);
  show('adminMemberHistory', false);

  $('editMemberNumber').value = number;
  $('editMemberName').value = member.name || '';
  $('editMemberPhone').value = member.phone || '';

  $('editMemberDate').value =
    member.joiningDate || localDateString();

  $('editMemberStatus').value =
    member.status === 'inactive'
      ? 'inactive'
      : 'active';

  show('editMemberPanel', true);

  $('editMemberPanel').scrollIntoView({
    behavior: 'smooth',
    block: 'start'
  });
}

$('cancelEditMember').onclick = () => {
  show('editMemberPanel', false);
};

$('editMemberForm').onsubmit = async event => {
  event.preventDefault();

  if (!isAdmin()) {
    return notify('Admin access required.', true);
  }

  const number = String(
    $('editMemberNumber').value
  );

  const name = $('editMemberName').value.trim();
  const phone = $('editMemberPhone').value.trim();
  const joiningDate = $('editMemberDate').value;
  const status = $('editMemberStatus').value;

  if (!name || name.length > 100) {
    return notify('Invalid name.', true);
  }

  if (!validPhone(phone)) {
    return notify('Invalid phone number.', true);
  }

  if (!validDate(joiningDate)) {
    return notify('Invalid joining date.', true);
  }

  if (!['active', 'inactive'].includes(status)) {
    return notify('Invalid status.', true);
  }

  const button = $('saveEditMember');
  button.disabled = true;

  try {
    const result = await runTransaction(
      ref(db, `members/${number}`),
      member => {
        if (!canEditMember(member)) return;

        return {
          ...member,
          name,
          phone,
          joiningDate,
          status,
          updatedAt: Date.now(),
          updatedBy: current.uid
        };
      },
      { applyLocally: false }
    );

    if (!result.committed) {
      throw new Error(
        'Member changed or is archived.'
      );
    }

    show('editMemberPanel', false);

    notify(
      `Member #${number} updated successfully.`
    );

  } catch (error) {
    notify('Edit failed: ' + error.message, true);
  } finally {
    button.disabled = false;
  }
};

// ===================================================
// ARCHIVE SAFETY
// FINAL ARCHIVE WRITE REMAINS DISABLED
// ===================================================

function openArchiveMember(number) {
  if (!isAdmin()) return;

  const member = memberList[String(number)];

  if (!canEditMember(member)) {
    return notify(
      'Member cannot be archived.',
      true
    );
  }

  show('editMemberPanel', false);
  show('adminMemberHistory', false);

  $('archiveMemberNumber').value = number;

  $('archiveMemberSummary').textContent =
    `#${number} — ${member.name || 'Member'}`;

  $('archiveMemberReason').value = '';
  $('archiveMemberNotes').value = '';
  $('archiveMemberConfirm').checked = false;

  show('archiveMemberPanel', true);

  updateArchiveButton();

  $('archiveMemberPanel').scrollIntoView({
    behavior: 'smooth',
    block: 'start'
  });
}

$('cancelArchiveMember').onclick = () => {
  show('archiveMemberPanel', false);
};

function requestsForMember(number, data) {
  return Object.entries(data || {}).filter(
    ([, request]) =>
      String(request.memberNumber) ===
      String(number)
  );
}

function unresolvedRequests(number, data) {
  return requestsForMember(number, data).filter(
    ([, request]) =>
      !['approved', 'rejected'].includes(
        request.status
      )
  );
}

function findPartialPaymentRequests(
  number,
  member,
  requests
) {
  const partial = [];

  for (const [id, request] of requestsForMember(
    number,
    requests
  )) {
    const paidRecords = Object.values(
      member?.payments || {}
    );

    const found = paidRecords.some(
      payment =>
        payment?.requestId === id &&
        payment?.status === 'paid'
    );

    if (
      found &&
      request.status !== 'approved'
    ) {
      partial.push(id);
    }
  }

  return partial;
}

async function archiveMemberSafely(event) {
  event.preventDefault();

  if (!isAdmin() || archiveBusy) return;

  const number = String(
    $('archiveMemberNumber').value
  ).trim();

  const reason = $('archiveMemberReason').value;

  if (!validMemberNumber(number)) {
    return notify(
      'Invalid member number.',
      true
    );
  }

  if (![
    'resigned',
    'inactive',
    'deceased',
    'duplicate',
    'other'
  ].includes(reason)) {
    return notify(
      'Select archive reason.',
      true
    );
  }

  if (!$('archiveMemberConfirm').checked) {
    return notify(
      'Confirm archive operation.',
      true
    );
  }

  if (
    !membersLoaded ||
    !adminHistoryLoaded ||
    !paymentRequestsLoaded ||
    !archiveLoaded
  ) {
    return notify(
      'Wait until database loading completes.',
      true
    );
  }

  archiveBusy = true;
  updateArchiveButton();

  try {
    const member = (
      await get(ref(db, `members/${number}`))
    ).val();

    if (!canEditMember(member)) {
      throw new Error(
        'Member missing, archived or locked.'
      );
    }

    const history = (
      await get(
        ref(db, `paymentHistory/${number}`)
      )
    ).val() || {};

    const requests = (
      await get(ref(db, 'paymentRequests'))
    ).val() || {};

    const unresolved = unresolvedRequests(
      number,
      requests
    );

    if (unresolved.length) {
      throw new Error(
        `${unresolved.length} unresolved payment ` +
        'request(s). Review before archive.'
      );
    }

    const partial = findPartialPaymentRequests(
      number,
      member,
      requests
    );

    if (partial.length) {
      throw new Error(
        'Partial payment approval detected. ' +
        'Reconcile before archive.'
      );
    }

    const archive = (
      await get(
        ref(db, `archivedMembers/${number}`)
      )
    ).val();

    if (archive) {
      throw new Error(
        'Archive record already exists.'
      );
    }

    const paidCount = collectPaidMonths(
      member,
      history
    ).length;

    if (!ARCHIVE_WRITE_ENABLED) {
      notify(
        `Archive pre-check passed for ` +
        `#${number}. ${paidCount} paid months. ` +
        `Final Archive is LOCKED.`,
        false
      );
      return;
    }

    // No final archive write is implemented.

    throw new Error(
      'Final Archive requires secure server-side workflow.'
    );

  } catch (error) {
    notify(
      'Archive stopped: ' + error.message,
      true
    );
  } finally {
    archiveBusy = false;
    updateArchiveButton();
  }
}

$('archiveMemberForm').onsubmit =
  archiveMemberSafely;

function updateArchiveButton() {
  const button = $('confirmArchiveMember');

  if (!button) return;

  button.disabled =
    archiveBusy ||
    !isAdmin() ||
    !membersLoaded ||
    !adminHistoryLoaded ||
    !paymentRequestsLoaded ||
    !archiveLoaded ||
    !$('archiveMemberConfirm').checked;
}

$('archiveMemberConfirm').onchange =
  updateArchiveButton;

// ===================================================
// ARCHIVED MEMBERS REGISTER
// ===================================================

function renderArchivedMembers() {
  const container = $('archivedMembersList');
  container.replaceChildren();

  const search =
    ($('archivedMembersSearch').value || '')
      .toLowerCase();

  const entries = Object.entries(archivedMembers)
    .filter(([id, record]) =>
      [
        id,
        record.originalNumber,
        record.member?.name,
        record.reason
      ].join(' ').toLowerCase().includes(search)
    )
    .sort(
      (a, b) =>
        (b[1].archivedAt || 0) -
        (a[1].archivedAt || 0)
    );

  if (!entries.length) {
    container.textContent =
      'No archived members found.';
    return;
  }

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const header = document.createElement('tr');

  [
    'Old #',
    'Name',
    'Reason',
    'Archived Date',
    'History'
  ].forEach(label => {
    const th = document.createElement('th');
    th.textContent = label;
    header.append(th);
  });

  thead.append(header);
  table.append(thead);

  const tbody = document.createElement('tbody');

  for (const [id, record] of entries) {
    const row = document.createElement('tr');

    const values = [
      record.originalNumber,
      record.member?.name || '',
      record.reason || '',
      record.archivedAt
        ? new Date(
            record.archivedAt
          ).toLocaleDateString('en-IN')
        : ''
    ];

    for (const value of values) {
      const td = document.createElement('td');
      td.textContent = value;
      row.append(td);
    }

    const actions = document.createElement('td');

    actions.append(
      makeButton(
        'View History',
        () => renderArchivedHistory(id)
      )
    );

    row.append(actions);
    tbody.append(row);
  }

  table.append(tbody);
  container.append(table);
}

function renderArchivedHistory(id) {
  if (!isAdmin()) return;

  const record = archivedMembers[id];
  if (!record) return;

  const member = record.member || {};
  const history = record.paymentHistory || {};

  $('archivedHistoryTitle').textContent =
    `#${record.originalNumber} — ` +
    `${member.name || 'Former Member'}`;

  const count = renderHistoryTable(
    member,
    history,
    'archivedHistoryTable'
  );

  $('archivedHistorySummary').textContent =
    `Paid months: ${count} | ` +
    `Recorded paid equivalent: ₹${count * MONTHLY_FEE} | ` +
    `Reason: ${record.reason || 'Not specified'} | ` +
    'Member number reserved';

  show('archivedMemberHistory', true);

  $('archivedMemberHistory').scrollIntoView({
    behavior: 'smooth',
    block: 'start'
  });
}

$('archivedMembersSearch').oninput =
  renderArchivedMembers;

// ===================================================
// UPI PAYMENT
// ===================================================

function planDetails() {
  const plan = $('paymentPlan').value;
  const period = $('paymentPeriod').value;

  return {
    plan,
    amount:
      plan === 'yearly'
        ? YEARLY_FEE
        : MONTHLY_FEE,
    period
  };
}

// Yearly payment always covers Jan-Dec
// of the selected calendar year.

function paymentMonthKeys(plan, period) {
  if (!validPeriod(period)) {
    throw new Error('Invalid payment period.');
  }

  if (!['monthly', 'yearly'].includes(plan)) {
    throw new Error('Invalid payment plan.');
  }

  const [year] = period.split('-').map(Number);

  if (plan === 'monthly') {
    return [period];
  }

  return Array.from({ length: 12 }, (_, i) =>
    `${year}-${String(i + 1).padStart(2, '0')}`
  );
}

function updateUpiLink() {
  const { plan, amount, period } = planDetails();

  const year = periodYear(period);

  const description = plan === 'yearly'
    ? `Year ${year} Jan-Dec`
    : `Month ${period}`;

  const params = new URLSearchParams({
    pa: UPI_ID,
    pn: UPI_NAME,
    am: String(amount),
    cu: 'INR',
    tn:
      `TFC ${memberNumber || ''} ${description}`
  });

  $('upiPayLink').href =
    `upi://pay?${params.toString()}`;

  $('upiPayLink').textContent =
    `Open UPI app — ₹${amount}`;
}

$('paymentPlan').onchange = updateUpiLink;
$('paymentPeriod').onchange = updateUpiLink;

updateUpiLink();

// ===================================================
// MEMBER PAYMENT SUBMISSION
// ===================================================

$('submitPayment').onclick = async () => {
  if (!current || !memberNumber || admin) {
    return notify(
      'Member login required.',
      true
    );
  }

  const { plan, amount, period } = planDetails();

  const transactionId =
    $('transactionId').value.trim();

  if (!['monthly', 'yearly'].includes(plan)) {
    return notify('Invalid payment plan.', true);
  }

  if (!validPeriod(period)) {
    return notify('Invalid payment period.', true);
  }

  if (
    transactionId.length < 6 ||
    transactionId.length > 100
  ) {
    return notify(
      'Enter valid UPI transaction ID.',
      true
    );
  }

  const keys = paymentMonthKeys(plan, period);

  if (!historyLoaded || historyError) {
    return notify(
      'Payment history is not ready. Try again later.',
      true
    );
  }

  const member = currentMemberData;

  if (!isActiveMember(member)) {
    return notify('Membership not active.', true);
  }

  const paidSet = new Set(
    collectPaidMonths(member, historicalPayments)
  );

  const alreadyPaid = keys.filter(
    key => paidSet.has(key)
  );

  if (alreadyPaid.length) {
    return notify(
      'Payment already recorded for: ' +
      alreadyPaid.join(', ') +
      '. Contact admin before paying again.',
      true
    );
  }

  const periodLabel = plan === 'yearly'
    ? `${periodYear(period)} Jan-Dec`
    : period;

  if (!confirm(
    `Submit ₹${amount} for ${periodLabel} ` +
    'as Pending? Submit only after paying.'
  )) return;

  const button = $('submitPayment');
  button.disabled = true;

  try {
    const freshMember = (
      await get(
        ref(db, `members/${memberNumber}`)
      )
    ).val();

    if (
      !isActiveMember(freshMember) ||
      freshMember.uid !== current.uid
    ) {
      throw new Error(
        'Membership is no longer active.'
      );
    }

    const freshHistory = (
      await get(
        ref(db, `paymentHistory/${memberNumber}`)
      )
    ).val() || {};

    const freshPaid = new Set(
      collectPaidMonths(freshMember, freshHistory)
    );

    if (keys.some(key => freshPaid.has(key))) {
      throw new Error(
        'Some months are already paid. Contact admin.'
      );
    }

    const requestRef = push(
      ref(db, 'paymentRequests')
    );

    await set(requestRef, {
      uid: current.uid,
      memberNumber,
      plan,
      amount,
      period,
      transactionId,
      status: 'pending',
      createdAt: Date.now()
    });

    $('transactionId').value = '';

    notify(
      'Submitted for admin verification.'
    );

  } catch (error) {
    notify(
      'Submission failed: ' + error.message,
      true
    );
  } finally {
    button.disabled = false;
  }
};

// ===================================================
// ADMIN PAYMENT REQUESTS
// ===================================================

function renderAdminPayments() {
  const container = $('adminPaymentList');
  container.replaceChildren();

  const pending = Object.entries(payments)
    .filter(([, request]) =>
      request.status === 'pending'
    )
    .sort(
      (a, b) =>
        (a[1].createdAt || 0) -
        (b[1].createdAt || 0)
    );

  if (!pending.length) {
    container.textContent =
      'No pending payment submissions.';
    return;
  }

  for (const [id, request] of pending) {
    const box = document.createElement('div');
    box.className = 'panel';

    const info = document.createElement('p');

    info.textContent =
      `#${request.memberNumber} — ` +
      `${memberList[request.memberNumber]?.name || ''}` +
      ` | ₹${request.amount}` +
      ` | ${request.plan} ${request.period}` +
      ` | UPI Ref: ${request.transactionId}`;

    box.append(
      info,
      makeButton(
        'Approve after bank verification',
        () => verifyPayment(id, request, true)
      ),
      document.createTextNode(' '),
      makeButton(
        'Reject',
        () => verifyPayment(id, request, false),
        'secondary'
      )
    );

    container.append(box);
  }
}

// ===================================================
// PAYMENT VERIFICATION HELPERS
// ===================================================

function recordedMonthsForRequest(member, id) {
  return Object.entries(
    member?.payments || {}
  )
    .filter(([, record]) =>
      record?.requestId === id &&
      record?.status === 'paid'
    )
    .map(([period]) => period)
    .sort();
}

function samePeriods(a, b) {
  if (a.length !== b.length) return false;

  const x = [...a].sort();
  const y = [...b].sort();

  return x.every((value, index) =>
    value === y[index]
  );
}

// ===================================================
// PAYMENT VERIFICATION
//
// Existing two-stage approval is preserved.
// Server-side atomic approval is still required
// for stronger concurrency guarantees.
// ===================================================

async function verifyPayment(id, request, accept) {
  if (
    !isAdmin() ||
    request.status !== 'pending' ||
    paymentBusy
  ) return;

  const question = accept
    ? `Have you verified ₹${request.amount} ` +
      `in the bank statement? Approve ` +
      `#${request.memberNumber}, ${request.period}?`
    : `Reject payment request for ` +
      `#${request.memberNumber}?`;

  if (!confirm(question)) return;

  paymentBusy = true;

  try {
    const requestRef =
      ref(db, `paymentRequests/${id}`);

    const fresh = (
      await get(requestRef)
    ).val();

    if (
      !fresh ||
      fresh.status !== 'pending'
    ) {
      throw new Error(
        'Request is no longer pending.'
      );
    }

    if (!accept) {
      const number = String(fresh.memberNumber);

      const member = (
        await get(ref(db, `members/${number}`))
      ).val();

      const recorded =
        recordedMonthsForRequest(member, id);

      if (recorded.length) {
        throw new Error(
          'Payment is already recorded. ' +
          'Manual reconciliation required.'
        );
      }

      const result = await runTransaction(
        requestRef,
        existing => {
          if (
            !existing ||
            existing.status !== 'pending'
          ) return;

          return {
            ...existing,
            status: 'rejected',
            reviewedAt: Date.now(),
            reviewedBy: current.uid
          };
        },
        { applyLocally: false }
      );

      if (!result.committed) {
        throw new Error(
          'Request already reviewed.'
        );
      }

      notify('Payment rejected.');
      return;
    }

    if (
      !['monthly', 'yearly'].includes(
        fresh.plan
      )
    ) {
      throw new Error('Invalid payment plan.');
    }

    const expectedAmount =
      fresh.plan === 'yearly'
        ? YEARLY_FEE
        : MONTHLY_FEE;

    if (fresh.amount !== expectedAmount) {
      throw new Error(
        'Invalid payment amount.'
      );
    }

    const keys = paymentMonthKeys(
      fresh.plan,
      fresh.period
    );

    const number = String(fresh.memberNumber);

    const memberRef =
      ref(db, `members/${number}`);

    const memberSnapshot = await get(memberRef);
    const currentMember = memberSnapshot.val();

    if (
      !isActiveMember(currentMember) ||
      currentMember.uid !== fresh.uid
    ) {
      throw new Error(
        'Member inactive, locked, archived ' +
        'or account mismatch.'
      );
    }

    const alreadyRecorded =
      recordedMonthsForRequest(
        currentMember,
        id
      );

    if (alreadyRecorded.length) {
      if (!samePeriods(alreadyRecorded, keys)) {
        throw new Error(
          'Partial payment records do not match. ' +
          'Manual reconciliation required.'
        );
      }

      const recovery = await runTransaction(
        requestRef,
        existing => {
          if (
            !existing ||
            existing.status !== 'pending'
          ) return;

          return {
            ...existing,
            status: 'approved',
            reviewedAt: Date.now(),
            reviewedBy: current.uid,
            recovered: true
          };
        },
        { applyLocally: false }
      );

      if (!recovery.committed) {
        throw new Error(
          'Recovery status changed. Review manually.'
        );
      }

      notify(
        'Existing paid months verified. ' +
        'Pending request reconciled.'
      );

      return;
    }

    const oldHistory = (
      await get(
        ref(db, `paymentHistory/${number}`)
      )
    ).val() || {};

    const verifiedAt = Date.now();
    const reviewer = current.uid;

    const result = await runTransaction(
      memberRef,
      member => {
        if (
          !isActiveMember(member) ||
          member.uid !== fresh.uid
        ) {
          return;
        }

        const alreadyPaid = keys.some(key => {
          const [year, month] =
            key.split('-').map(Number);

          return (
            member.payments?.[key]?.status === 'paid' ||
            isHistoricalPaid(
              oldHistory,
              year,
              month
            )
          );
        });

        if (alreadyPaid) return;

        const updated = {
          ...member,
          payments: {
            ...(member.payments || {})
          }
        };

        for (const key of keys) {
          updated.payments[key] = {
            status: 'paid',
            amount: MONTHLY_FEE,
            transactionId: fresh.transactionId,
            requestId: id,
            verifiedAt,
            verifiedBy: reviewer
          };
        }

        return updated;
      },
      { applyLocally: false }
    );

    if (!result.committed) {
      throw new Error(
        'Payment could not be recorded. ' +
        'Check member status and paid months.'
      );
    }

    try {
      const completion = await runTransaction(
        requestRef,
        existing => {
          if (
            !existing ||
            existing.status !== 'pending'
          ) return;

          return {
            ...existing,
            status: 'approved',
            reviewedAt: verifiedAt,
            reviewedBy: reviewer
          };
        },
        { applyLocally: false }
      );

      if (!completion.committed) {
        throw new Error(
          'Request status changed.'
        );
      }

    } catch (error) {
      throw new Error(
        'Paid months may already be recorded, ' +
        'but request status was not completed. ' +
        'Review the same request before further action. ' +
        error.message
      );
    }

    notify(
      'Payment approved and recorded.'
    );

  } catch (error) {
    notify(
      'Payment review needs attention: ' +
      error.message,
      true
    );
  } finally {
    paymentBusy = false;
  }
}

// ===================================================
// MEMBER PAYMENT SUBMISSION HISTORY
// ===================================================

function renderMyPayments(data) {
  const entries = Object.values(data)
    .sort(
      (a, b) =>
        (b.createdAt || 0) -
        (a.createdAt || 0)
    );

  if (!entries.length) {
    $('myPaymentList').textContent =
      'No payment submissions yet.';
    return;
  }

  $('myPaymentList').innerHTML =
    `<table>
      <thead>
        <tr>
          <th>Period</th>
          <th>Amount</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${entries.map(payment =>
          `<tr>
            <td>
              ${escapeHTML(payment.period)}
              (${escapeHTML(payment.plan)})
            </td>
            <td>₹${Number(payment.amount) || 0}</td>
            <td>${escapeHTML(payment.status)}</td>
          </tr>`
        ).join('')}
      </tbody>
    </table>`;
}

// ===================================================
// 2027 IMPORT STATUS
// ===================================================

// Import is deliberately not automatic.
// PDF marks must be reviewed first.
// Existing 2024-2026 records must remain intact.

if ($('importStatusText')) {
  $('importStatusText').textContent =
    '2027 PDF import is pending validation.';
}

// ===================================================
// END OF TFC APP.JS VERSION 75.5
// ===================================================
