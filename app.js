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

// TFC BANDIYOD PORTAL VERSION 82.0
// Admin Cash Payment enabled.
// Admin Cancel / Restore Paid Tick enabled.
// Correction records preserve original payments.
// Historical PDF payment records are not overwritten.
// Archive writes and photo uploads remain disabled.
//
// IMPORTANT:
// The current Firebase correction rules permit admins to
// rewrite prior correction events. For tamper-proof auditing,
// a server-enforced append-only audit is still required.
// Concurrent cross-path payment changes are not fully locked.

const ARCHIVE_WRITE_ENABLED = false;
const CASH_WRITE_ENABLED = true;
const PAYMENT_V76_ENABLED = true;
const PAYMENT_CORRECTION_ENABLED = true;

const MONTHLY_FEE = 50;
const YEARLY_FEE = 600;

const UPI_ID = 'waheedwahi84-1@oksbi';
const UPI_NAME = 'MOOSA WAHEED M B';

const $ = id => document.getElementById(id);

const show = (id, yes) => {
  if ($(id)) {
    $(id).classList.toggle('hide', !yes);
  }
};

const notify = (message, error = false) => {
  if ($('msg')) {
    $('msg').textContent = message;
    $('msg').className = error ? 'error' : 'ok';
  }
};

const safe = value =>
  String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));

const button = (label, fn, css = '') => {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.className = css;
  b.onclick = fn;
  return b;
};

const today = () => {
  const d = new Date();

  return (
    `${d.getFullYear()}-` +
    `${String(d.getMonth() + 1).padStart(2, '0')}-` +
    `${String(d.getDate()).padStart(2, '0')}`
  );
};

const currentPeriod = () => today().slice(0, 7);

const validPeriod = s =>
  /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s || ''));

const validDate = s => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) {
    return false;
  }

  const d = new Date(s + 'T00:00:00');

  return !isNaN(d) &&
    d.getFullYear() === +s.slice(0, 4) &&
    d.getMonth() + 1 === +s.slice(5, 7) &&
    d.getDate() === +s.slice(8, 10);
};

const validPhone = s =>
  !s || /^[0-9+\s()-]{7,15}$/.test(s);

const validMemberMobile = s =>
  /^[0-9]{10}$/.test(String(s || ''));

const validNumber = n =>
  Number.isSafeInteger(Number(n)) &&
  +n >= 1 &&
  +n <= 99999;

const active = m =>
  !!m &&
  ![
    'inactive',
    'suspended',
    'archiving',
    'archived'
  ].includes(m.status);

const editable = m =>
  !!m &&
  !['archiving', 'archived'].includes(m.status);

const dict = {
  en: {
    welcome: 'Welcome to TFC Bandiyod',
    loginText: 'Members can sign in with Google. New accounts require admin approval.',
    signIn: 'Continue with Google',
    pending: 'Membership approval pending',
    pendingText: 'Your Google account needs approval from the TFC admin.',
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
    loginText: 'Google ഉപയോഗിച്ച് പ്രവേശിക്കാം. പുതിയ അംഗങ്ങൾക്ക് അഡ്മിൻ അനുമതി ആവശ്യമാണ്.',
    signIn: 'Google ഉപയോഗിച്ച് പ്രവേശിക്കുക',
    pending: 'അംഗത്വ അനുമതി കാത്തിരിക്കുന്നു',
    pendingText: 'നിങ്ങളുടെ Google അക്കൗണ്ടിന് അഡ്മിൻ അനുമതി ആവശ്യമാണ്.',
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
    document.querySelectorAll('[data-t]').forEach(el => {
      const t = dict[$('lang').value]?.[el.dataset.t];

      if (t) el.textContent = t;
    });
  };
}

// APPLICATION STATE

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
let requestsCache = {};

let paymentCorrections = {};
let adminCorrections = {};

let historyLoaded = false;
let historyError = false;

let membersLoaded = false;
let adminHistoryLoaded = false;
let paymentRequestsLoaded = false;
let archiveLoaded = false;

let correctionsLoaded = false;
let correctionsError = false;
let adminCorrectionsLoaded = false;

let selectedAdminMember = null;

let paymentBusy = false;
let approvalBusy = false;
let archiveBusy = false;
let phoneBusy = false;
let cashBusy = false;
let correctionBusy = false;

let unsubscribers = [];
let authGeneration = 0;

const isAdmin = () => !!current && admin;

function stopListeners() {
  unsubscribers.forEach(fn => {
    try {
      fn();
    } catch (_) {}
  });

  unsubscribers = [];

  memberList = {};
  payments = {};
  historicalPayments = {};
  currentMemberData = null;

  archivedMembers = {};
  adminHistoryCache = {};
  requestsCache = {};

  paymentCorrections = {};
  adminCorrections = {};

  historyLoaded = false;
  historyError = false;

  membersLoaded = false;
  adminHistoryLoaded = false;
  paymentRequestsLoaded = false;
  archiveLoaded = false;

  correctionsLoaded = false;
  correctionsError = false;
  adminCorrectionsLoaded = false;

  selectedAdminMember = null;

  paymentBusy = false;
  approvalBusy = false;
  archiveBusy = false;
  phoneBusy = false;
  cashBusy = false;
  correctionBusy = false;

  show('memberPhonePanel', false);
  show('cashPanel', false);
  show('correctionPanel', false);
}

// PAYMENT HISTORY HELPERS

function isHistoricalPaid(history, year, month) {
  if (year < 2024) return false;

  const v = history?.months?.[String(year)]?.[
    String(month).padStart(2, '0')
  ];

  return v === 'marked_paid' ||
    (
      v &&
      typeof v === 'object' &&
      ['marked_paid', 'paid'].includes(v.status)
    );
}

function originalPaidMonths(member, history) {
  const out = new Set();

  for (const year of Object.keys(history?.months || {})) {
    if (!/^\d{4}$/.test(year)) continue;

    for (let m = 1; m <= 12; m++) {
      if (isHistoricalPaid(history, +year, m)) {
        out.add(
          `${year}-${String(m).padStart(2, '0')}`
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
      out.add(period);
    }
  }

  return [...out].sort();
}

function correctionsForMember(number) {
  if (isAdmin()) {
    return adminCorrections[String(number)] || {};
  }

  if (
    memberNumber !== null &&
    String(memberNumber) === String(number)
  ) {
    return paymentCorrections;
  }

  return {};
}

function paidMonths(
  member,
  history,
  corrections = undefined
) {
  const original = originalPaidMonths(member, history);

  const records = corrections === undefined
    ? correctionsForMember(member?.number)
    : corrections;

  return original.filter(
    period => records?.[period]?.state !== 'cancelled'
  );
}

function cancelledPeriods(corrections, periods) {
  return periods.filter(
    period => corrections?.[period]?.state === 'cancelled'
  );
}

function historyPeriods(
  member,
  paid,
  yearFilter = 'all'
) {
  let first =
    member?.joiningDate?.slice(0, 7) || '2024-01';

  if (!validPeriod(first)) first = '2024-01';

  if (paid[0] && paid[0] < first) {
    first = paid[0];
  }

  const last =
    paid.length &&
    paid[paid.length - 1] > currentPeriod()
      ? paid[paid.length - 1]
      : currentPeriod();

  const result = [];

  for (
    let y = +first.slice(0, 4);
    y <= +last.slice(0, 4);
    y++
  ) {
    if (
      yearFilter !== 'all' &&
      String(y) !== String(yearFilter)
    ) continue;

    for (let m = 1; m <= 12; m++) {
      const p =
        `${y}-${String(m).padStart(2, '0')}`;

      if (p >= first && p <= last) {
        result.push(p);
      }
    }
  }

  if (
    yearFilter !== 'all' &&
    /^\d{4}$/.test(String(yearFilter)) &&
    !result.length &&
    +yearFilter >= 2027
  ) {
    for (let m = 1; m <= 12; m++) {
      result.push(
        `${yearFilter}-${String(m).padStart(2, '0')}`
      );
    }
  }

  return result;
}

function fillYears(id, member, history) {
  const select = $(id);
  if (!select) return;

  const old = select.value || 'all';

  const paid = paidMonths(member, history);

  let first = Math.min(
    2024,
    Number(member?.joiningDate?.slice(0, 4)) || 2024
  );

  if (paid.length) {
    first = Math.min(
      first,
      +paid[0].slice(0, 4)
    );
  }

  const end = Math.max(
    new Date().getFullYear() + 5,
    2028,
    ...paid.map(p => +p.slice(0, 4))
  );

  select.replaceChildren(
    new Option('All Years', 'all')
  );

  for (let y = first; y <= end; y++) {
    select.add(
      new Option(String(y), String(y))
    );
  }

  select.value =
    [...select.options].some(o => o.value === old)
      ? old
      : 'all';
}

function renderHistoryTable(
  member,
  history,
  target,
  year = 'all',
  corrections = undefined
) {
  const paid = paidMonths(
    member,
    history,
    corrections
  );

  const paidSet = new Set(paid);

  const correctionData =
    corrections === undefined
      ? correctionsForMember(member?.number)
      : corrections;

  const table = document.createElement('table');

  table.innerHTML =
    '<thead><tr><th>Month</th><th>Status</th></tr></thead>';

  const body = document.createElement('tbody');

  for (const period of historyPeriods(
    member,
    paid,
    year
  )) {
    const row = document.createElement('tr');

    const a = document.createElement('td');
    const b = document.createElement('td');

    a.textContent = period;

    const isPaid = paidSet.has(period);

    const cancelled =
      correctionData?.[period]?.state === 'cancelled';

    b.textContent = isPaid
      ? 'Paid'
      : cancelled
        ? 'Cancelled / Not Paid'
        : 'Not verified';

    b.className = isPaid
      ? 'history-paid'
      : 'history-unverified';

    row.append(a, b);
    body.append(row);
  }

  table.append(body);

  $(target)?.replaceChildren(table);

  return paid.filter(
    p => year === 'all' ||
      p.startsWith(year + '-')
  ).length;
}

// FIREBASE INITIALIZATION

if ($('paymentPeriod')) {
  $('paymentPeriod').value = currentPeriod();
}

if ($('newMemberDate')) {
  $('newMemberDate').value = today();
}

if (
  !firebaseConfig.databaseURL ||
  firebaseConfig.databaseURL.startsWith('REPLACE_')
) {
  notify(
    'Firebase configuration missing.',
    true
  );

  if ($('signIn')) {
    $('signIn').disabled = true;
  }

} else {
  const app = initializeApp(firebaseConfig);

  auth = getAuth(app);
  db = getDatabase(app);

  onAuthStateChanged(
    auth,
    handleAuthChange
  );
}

// AUTHENTICATION

async function handleAuthChange(user) {
  const generation = ++authGeneration;

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
    const a = await get(
      ref(db, `admins/${user.uid}`)
    );

    if (
      generation !== authGeneration ||
      auth.currentUser?.uid !== user.uid
    ) return;

    admin = a.val() === true;

    if (admin) {
      show('admin', true);

      tab('requests');
      loadAdmin();

      return;
    }

    const u = (
      await get(
        ref(db, `users/${user.uid}`)
      )
    ).val();

    if (
      generation !== authGeneration ||
      auth.currentUser?.uid !== user.uid
    ) return;

    if (
      u?.status === 'approved' &&
      u.memberNumber
    ) {
      const number = String(u.memberNumber);

      const m = (
        await get(
          ref(db, `members/${number}`)
        )
      ).val();

      if (
        generation !== authGeneration ||
        auth.currentUser?.uid !== user.uid
      ) return;

      if (
        active(m) &&
        m.uid === user.uid
      ) {
        memberNumber = +number;
        currentMemberData = m;

        show('member', true);

        renderMember(m);
        loadMemberListeners(number, user.uid);
        updateUpiLink();

        return;
      }
    }

    show('pending', true);

    if ($('claimNumber')) {
      $('claimNumber').value =
        u?.requestedNumber || '';
    }

  } catch (e) {
    notify(
      'Database error: ' + e.message,
      true
    );
  }
}

$('signIn').onclick = async () => {
  try {
    await signInWithPopup(
      auth,
      new GoogleAuthProvider()
    );

  } catch (e) {
    notify(
      'Login error: ' + e.message,
      true
    );
  }
};

$('logout').onclick = () => signOut(auth);

// MEMBER APPROVAL REQUEST

$('requestApproval').onclick = async () => {
  if (!current || admin) return;

  const number = +$('claimNumber').value;

  if (!validNumber(number)) {
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

  } catch (e) {
    notify(e.message, true);
  }
};

// MEMBER DATA LISTENERS

function loadMemberListeners(number, uid) {
  unsubscribers.push(
    onValue(
      ref(db, `members/${number}`),
      snap => {
        const m = snap.val();

        if (!active(m) || m.uid !== uid) {
          currentMemberData = null;

          show('member', false);
          show('memberPhonePanel', false);
          show('pending', true);

          notify(
            'Membership access is not active.',
            true
          );

          return;
        }

        currentMemberData = m;
        renderMember(m);
      },
      e => {
        show('member', false);
        show('memberPhonePanel', false);
        notify(e.message, true);
      }
    )
  );

  unsubscribers.push(
    onValue(
      ref(db, `paymentHistory/${number}`),
      snap => {
        historicalPayments = snap.val() || {};

        historyLoaded = true;
        historyError = false;

        renderMember(currentMemberData);
      },
      e => {
        historyLoaded = true;
        historyError = true;

        notify(
          'Historical payment error: ' +
          e.message,
          true
        );

        renderMember(currentMemberData);
      }
    )
  );

  // VERSION 82.0 MEMBER CORRECTIONS

  unsubscribers.push(
    onValue(
      ref(db, `paymentCorrections/${number}`),
      snap => {
        paymentCorrections = snap.val() || {};

        correctionsLoaded = true;
        correctionsError = false;

        renderMember(currentMemberData);
      },
      e => {
        correctionsLoaded = false;
        correctionsError = true;

        notify(
          'Payment correction error: ' +
          e.message,
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
      snap => renderMyPayments(
        snap.val() || {}
      ),
      e => notify(e.message, true)
    )
  );
}

// MEMBER MOBILE PROFILE

function setupMemberPhoneProfile() {
  const meta = $('memberMeta');

  if (!meta || $('memberPhonePanel')) return;

  const panel = document.createElement('div');

  panel.id = 'memberPhonePanel';
  panel.className = 'panel';

  const title = document.createElement('h3');
  title.textContent = 'Mobile Number';

  const numberText = document.createElement('p');

  numberText.id = 'memberPhoneDisplay';
  numberText.textContent = 'Not Added';

  const editButton = button(
    'Add / Change Mobile Number',
    async () => {
      if (
        !current ||
        admin ||
        !memberNumber ||
        !currentMemberData ||
        phoneBusy
      ) return;

      const uid = current.uid;
      const number = String(memberNumber);

      const oldPhone = String(
        currentMemberData.phone || ''
      );

      const input = prompt(
        'Enter your 10-digit mobile number:',
        oldPhone
      );

      if (input === null) return;

      const phone = input.trim();

      if (!validMemberMobile(phone)) {
        notify(
          'Enter a valid 10-digit mobile number.',
          true
        );

        return;
      }

      if (phone === oldPhone) {
        notify('Mobile number unchanged.');
        return;
      }

      if (!confirm(
        `Save mobile number ${phone}?`
      )) return;

      phoneBusy = true;
      editButton.disabled = true;

      try {
        if (
          auth.currentUser?.uid !== uid ||
          memberNumber === null ||
          String(memberNumber) !== number
        ) {
          throw Error('Login session changed.');
        }

        const fresh = (
          await get(
            ref(db, `members/${number}`)
          )
        ).val();

        if (
          !fresh ||
          fresh.uid !== uid ||
          fresh.status !== 'active'
        ) {
          throw Error(
            'Active membership required to edit mobile number.'
          );
        }

        await set(
          ref(db, `members/${number}/phone`),
          phone
        );

        notify(
          'Mobile number updated successfully.'
        );

      } catch (e) {
        notify(
          'Mobile update failed: ' +
          e.message,
          true
        );

      } finally {
        phoneBusy = false;
        editButton.disabled = false;
      }
    },
    'secondary'
  );

  editButton.id = 'editMemberOwnPhone';

  panel.append(
    title,
    numberText,
    editButton
  );

  meta.insertAdjacentElement(
    'afterend',
    panel
  );

  show('memberPhonePanel', false);
}

function refreshMemberPhoneProfile(member) {
  setupMemberPhoneProfile();

  const display = $('memberPhoneDisplay');
  const editButton = $('editMemberOwnPhone');

  if (!display || !member) return;

  const phone = String(
    member.phone || ''
  ).trim();

  display.textContent =
    phone || 'Not Added';

  if (editButton) {
    editButton.disabled =
      phoneBusy ||
      !current ||
      admin ||
      member.status !== 'active';
  }

  show('memberPhonePanel', true);
}

// MEMBER DASHBOARD

function renderMember(m) {
  if (!m) return;

  $('memberTitle').textContent =
    m.name || 'Member';

  $('memberMeta').textContent =
    'Member #' +
    (m.number || memberNumber);

  refreshMemberPhoneProfile(m);

  const ready =
    historyLoaded &&
    !historyError &&
    correctionsLoaded &&
    !correctionsError;

  const paid = ready
    ? paidMonths(
        m,
        historicalPayments,
        paymentCorrections
      )
    : [];

  const setPaid = new Set(paid);

  fillYears(
    'memberHistoryYear',
    m,
    historicalPayments
  );

  const year =
    $('memberHistoryYear')?.value || 'all';

  $('historyBody').innerHTML =
    historyPeriods(m, paid, year)
      .map(p => {
        const isPaid = setPaid.has(p);

        const cancelled =
          paymentCorrections?.[p]?.state ===
          'cancelled';

        const status = !ready
          ? 'Loading / Unavailable'
          : isPaid
            ? 'Paid'
            : cancelled
              ? 'Cancelled / Not Paid'
              : 'Not verified';

        return (
          `<tr>` +
          `<td>${safe(p)}</td>` +
          `<td class="${isPaid ? 'history-paid' : 'history-unverified'}">` +
          `${safe(status)}` +
          `</td>` +
          `</tr>`
        );
      })
      .join('');

  $('paidCount').textContent =
    !ready
      ? 'Loading / Unavailable'
      : String(paid.length);

  $('dueAmount').textContent =
    'Not verified';
}

$('memberHistoryYear').onchange =
  () => renderMember(currentMemberData);

// ADMIN DATA LISTENERS

function loadAdmin() {
  unsubscribers.push(
    onValue(
      ref(db, 'requests'),
      s => {
        requestsCache = s.val() || {};

        renderApprovalRequests(
          requestsCache
        );
      },
      e => notify(e.message, true)
    )
  );

  unsubscribers.push(
    onValue(
      ref(db, 'members'),
      s => {
        memberList = s.val() || {};
        membersLoaded = true;

        renderAdminMembers();
        renderApprovalRequests(requestsCache);
        renderPhotoMembers();

        if (selectedAdminMember !== null) {
          renderAdminPaymentHistory(
            selectedAdminMember
          );
        }

        updateArchiveButton();
        refreshCashMember();
        refreshCorrectionPanel();
      },
      e => {
        membersLoaded = false;

        notify(e.message, true);

        updateArchiveButton();
        refreshCashMember();
        refreshCorrectionPanel();
      }
    )
  );

  unsubscribers.push(
    onValue(
      ref(db, 'paymentRequests'),
      s => {
        payments = s.val() || {};
        paymentRequestsLoaded = true;

        renderAdminPayments();
        updateArchiveButton();
        refreshCashMember();
        refreshCorrectionPanel();
      },
      e => {
        paymentRequestsLoaded = false;

        notify(e.message, true);

        updateArchiveButton();
        refreshCashMember();
        refreshCorrectionPanel();
      }
    )
  );

  unsubscribers.push(
    onValue(
      ref(db, 'paymentHistory'),
      s => {
        adminHistoryCache = s.val() || {};
        adminHistoryLoaded = true;

        renderAdminMembers();

        if (selectedAdminMember !== null) {
          renderAdminPaymentHistory(
            selectedAdminMember
          );
        }

        updateArchiveButton();
        refreshCashMember();
        refreshCorrectionPanel();
      },
      e => {
        adminHistoryLoaded = false;

        notify(e.message, true);

        updateArchiveButton();
        refreshCashMember();
        refreshCorrectionPanel();
      }
    )
  );

  // VERSION 82.0 ADMIN CORRECTIONS

  unsubscribers.push(
    onValue(
      ref(db, 'paymentCorrections'),
      s => {
        adminCorrections = s.val() || {};
        adminCorrectionsLoaded = true;

        renderAdminMembers();
        refreshCashMember();
        refreshCorrectionPanel();

        if (selectedAdminMember !== null) {
          renderAdminPaymentHistory(
            selectedAdminMember
          );
        }
      },
      e => {
        adminCorrectionsLoaded = false;

        notify(
          'Corrections loading failed: ' +
          e.message,
          true
        );

        refreshCashMember();
        refreshCorrectionPanel();
      }
    )
  );

  unsubscribers.push(
    onValue(
      ref(db, 'archivedMembers'),
      s => {
        archivedMembers = s.val() || {};
        archiveLoaded = true;

        renderArchivedMembers();
        updateArchiveButton();
      },
      e => {
        archiveLoaded = false;

        notify(e.message, true);
        updateArchiveButton();
      }
    )
  );
}

// APPROVAL MANAGEMENT

function renderApprovalRequests(data) {
  const root = $('requestsList');
  if (!root) return;

  root.replaceChildren();

  let count = 0;

  for (const [uid, r] of Object.entries(
    data || {}
  )) {
    if (r?.status !== 'pending') continue;

    count++;

    const box = document.createElement('div');
    box.className = 'panel';

    const info = document.createElement('p');

    info.textContent =
      `${r.name || 'Unknown'} ` +
      `(${r.email || ''}) — ` +
      `Requested #${r.requestedNumber}`;

    const m = memberList[
      String(r.requestedNumber)
    ];

    const detail = document.createElement('p');

    detail.textContent = !membersLoaded
      ? 'Loading member record...'
      : m
        ? (
          `Member record: ${m.name || 'Unknown'} | ` +
          `Status: ${m.status || 'active'} | ` +
          `${m.uid ? 'Already linked' : 'Not linked'}`
        )
        : 'Requested membership number not found.';

    const approveBtn = button(
      'Approve',
      () => approve(
        uid,
        r,
        r.requestedNumber
      )
    );

    const changeBtn = button(
      'Change Number & Approve',
      () => {
        const input = prompt(
          'Enter correct Membership Number:',
          String(r.requestedNumber)
        );

        if (input === null) return;

        const number = input.trim();

        if (!/^[1-9]\d{0,4}$/.test(number)) {
          notify(
            'Invalid membership number.',
            true
          );

          return;
        }

        approve(
          uid,
          r,
          Number(number)
        );
      },
      'secondary'
    );

    const rejectBtn = button(
      'Reject',
      () => rejectApproval(uid, r),
      'danger'
    );

    approveBtn.disabled =
      !membersLoaded || approvalBusy;

    changeBtn.disabled =
      !membersLoaded || approvalBusy;

    rejectBtn.disabled = approvalBusy;

    box.append(
      info,
      detail,
      approveBtn,
      document.createTextNode(' '),
      changeBtn,
      document.createTextNode(' '),
      rejectBtn
    );

    root.append(box);
  }

  if (!count) {
    root.textContent =
      'No pending approval requests.';
  }
}

async function approve(
  uid,
  request,
  selectedNumber
) {
  if (!isAdmin() || approvalBusy) return;

  const number = String(selectedNumber);

  if (!validNumber(number)) {
    return notify(
      'Invalid member number.',
      true
    );
  }

  approvalBusy = true;
  renderApprovalRequests(requestsCache);

  try {
    const fresh = (
      await get(
        ref(db, `requests/${uid}`)
      )
    ).val();

    if (
      !fresh ||
      fresh.status !== 'pending' ||
      fresh.uid !== uid ||
      String(fresh.requestedNumber) !==
        String(request.requestedNumber)
    ) {
      throw Error(
        'Approval request changed.'
      );
    }

    const member = (
      await get(
        ref(db, `members/${number}`)
      )
    ).val();

    if (!active(member)) {
      throw Error(
        'Member is inactive or does not exist.'
      );
    }

    if (
      member.uid &&
      member.uid !== uid
    ) {
      throw Error(
        'Member already linked to another Gmail.'
      );
    }

    const existingUser = (
      await get(
        ref(db, `users/${uid}`)
      )
    ).val();

    if (
      existingUser?.status === 'approved' &&
      String(existingUser.memberNumber) !== number
    ) {
      throw Error(
        'This Gmail is already approved for another member.'
      );
    }

    const message =
      `Google account: ${fresh.email || uid}\n` +
      `Requested number: #${fresh.requestedNumber}\n` +
      `Approved number: #${number}\n` +
      `Member name: ${member.name || 'Unknown'}\n\n` +
      'Have you verified this member identity?';

    if (!confirm(message)) return;

    await update(ref(db), {
      [`members/${number}/uid`]: uid,

      [`users/${uid}`]: {
        status: 'approved',
        memberNumber: Number(number),
        email: fresh.email || ''
      },

      [`requests/${uid}/status`]: 'approved',
      [`requests/${uid}/approvedNumber`]:
        Number(number),
      [`requests/${uid}/reviewedAt`]:
        Date.now(),
      [`requests/${uid}/reviewedBy`]:
        current.uid
    });

    notify(
      `Member #${number} approved successfully.`
    );

  } catch (e) {
    notify(
      'Approval failed: ' + e.message,
      true
    );

  } finally {
    approvalBusy = false;

    renderApprovalRequests(
      requestsCache
    );
  }
}

async function rejectApproval(uid, request) {
  if (!isAdmin() || approvalBusy) return;

  if (!confirm(
    `Reject approval request from ${request.email || uid}?`
  )) return;

  approvalBusy = true;
  renderApprovalRequests(requestsCache);

  try {
    const requestRef = ref(
      db,
      `requests/${uid}`
    );

    const result = await runTransaction(
      requestRef,
      r => {
        if (
          !r ||
          r.status !== 'pending' ||
          r.uid !== uid ||
          String(r.requestedNumber) !==
            String(request.requestedNumber)
        ) return;

        return {
          ...r,
          status: 'rejected',
          reviewedAt: Date.now(),
          reviewedBy: current.uid
        };
      },
      { applyLocally: false }
    );

    if (!result.committed) {
      throw Error(
        'Request already changed or reviewed.'
      );
    }

    notify(
      'Approval request rejected.'
    );

  } catch (e) {
    notify(
      'Reject failed: ' + e.message,
      true
    );

  } finally {
    approvalBusy = false;

    renderApprovalRequests(
      requestsCache
    );
  }
}

// ADMIN MEMBER MANAGEMENT

function renderAdminMembers() {
  const root = $('membersList');
  if (!root) return;

  root.replaceChildren();

  const search =
    ($('search')?.value || '').toLowerCase();

  const entries = Object.entries(memberList)
    .filter(([id, m]) =>
      `${id} ${m?.name || ''} ${m?.phone || ''}`
        .toLowerCase()
        .includes(search)
    )
    .sort((a, b) => +a[0] - +b[0])
    .slice(0, 300);

  const table = document.createElement('table');

  table.innerHTML =
    '<thead><tr>' +
    '<th>#</th>' +
    '<th>Name</th>' +
    '<th>Mobile</th>' +
    '<th>Login</th>' +
    '<th>Status</th>' +
    '<th>Paid Months</th>' +
    '<th>Paid Amount</th>' +
    '<th>Actions</th>' +
    '</tr></thead>';

  const body = document.createElement('tbody');

  const ready =
    adminHistoryLoaded &&
    adminCorrectionsLoaded;

  for (const [number, m] of entries) {
    const row = document.createElement('tr');

    const paid = ready
      ? paidMonths(
          m,
          adminHistoryCache[number] || {},
          adminCorrections[number] || {}
        )
      : [];

    for (const v of [
      number,
      m?.name || '',
      m?.phone || 'Not Added',
      m?.uid ? 'Linked' : 'Not linked',
      m?.status || 'active',
      ready ? String(paid.length) : 'Loading',
      ready
        ? `₹${paid.length * MONTHLY_FEE}`
        : 'Loading'
    ]) {
      const cell = document.createElement('td');

      cell.textContent = v;
      row.append(cell);
    }

    const actions = document.createElement('td');

    const h = button(
      'View History',
      () => renderAdminPaymentHistory(number)
    );

    h.disabled = !ready;

    const e = button(
      'Edit',
      () => openEditMember(number),
      'secondary'
    );

    e.disabled = !editable(m);

    const c = button(
      'Cash Payment',
      () => openCashForMember(number),
      'secondary'
    );

    c.disabled = !active(m);

    const correction = button(
      'Cancel / Restore',
      () => openCorrectionForMember(number),
      'secondary'
    );

    correction.disabled = !ready;

    const a = button(
      'Archive',
      () => openArchiveMember(number),
      'danger'
    );

    a.disabled = !editable(m);

    actions.append(
      h,
      document.createTextNode(' '),
      e,
      document.createTextNode(' '),
      c,
      document.createTextNode(' '),
      correction,
      document.createTextNode(' '),
      a
    );

    row.append(actions);
    body.append(row);
  }

  table.append(body);
  root.append(table);
}

$('search').oninput = renderAdminMembers;

function renderAdminPaymentHistory(number) {
  if (
    !isAdmin() ||
    !adminHistoryLoaded ||
    !adminCorrectionsLoaded
  ) return;

  const m = memberList[String(number)];
  if (!m) return;

  selectedAdminMember = String(number);

  const history =
    adminHistoryCache[String(number)] || {};

  const corrections =
    adminCorrections[String(number)] || {};

  $('adminHistoryTitle').textContent =
    `#${number} — ${m.name || 'Member'}`;

  fillYears(
    'adminHistoryYear',
    m,
    history
  );

  const year =
    $('adminHistoryYear').value;

  const count = renderHistoryTable(
    m,
    history,
    'adminHistoryTable',
    year,
    corrections
  );

  $('adminHistorySummary').textContent =
    `Paid months: ${count} | ` +
    `Recorded paid amount: ₹${count * MONTHLY_FEE}`;

  show('adminMemberHistory', true);
}

$('adminHistoryYear').onchange = () => {
  if (selectedAdminMember !== null) {
    renderAdminPaymentHistory(
      selectedAdminMember
    );
  }
};

// ADMIN TABS

function tab(which) {
  for (const name of [
    'requests',
    'members',
    'payments',
    'addMember',
    'archivedMembers',
    'memberPhotos',
    'cash',
    'correction'
  ]) {
    show(
      name === 'correction'
        ? 'correctionPanel'
        : `${name}Panel`,
      name === which
    );
  }
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

$('tabMemberPhotos').onclick = () => {
  tab('memberPhotos');
  renderPhotoMembers();
};

// PHOTOS — DISABLED

function renderPhotoMembers() {
  const root = $('photoMembersList');
  if (!root) return;

  root.replaceChildren();

  const search =
    ($('photoMemberSearch')?.value || '')
      .toLowerCase();

  const matches = Object.entries(memberList)
    .filter(([n, m]) =>
      `${n} ${m?.name || ''}`
        .toLowerCase()
        .includes(search)
    )
    .sort((a, b) => +a[0] - +b[0])
    .slice(0, 300);

  const table = document.createElement('table');

  table.innerHTML =
    '<thead><tr><th>#</th><th>Name</th><th>Photo</th></tr></thead>';

  const body = document.createElement('tbody');

  for (const [n, m] of matches) {
    const row = document.createElement('tr');

    for (const v of [
      n,
      m?.name || '',
      'Upload coming soon'
    ]) {
      const cell = document.createElement('td');

      cell.textContent = v;
      row.append(cell);
    }

    body.append(row);
  }

  table.append(body);
  root.append(table);
}

$('photoMemberSearch').oninput =
  renderPhotoMembers;

// ADD MEMBER

$('addMemberForm').onsubmit = async event => {
  event.preventDefault();

  if (!isAdmin()) {
    return notify(
      'Admin access required.',
      true
    );
  }

  const number =
    +$('newMemberNumber').value;

  const name =
    $('newMemberName').value.trim();

  const phone =
    $('newMemberPhone').value.trim();

  const joiningDate =
    $('newMemberDate').value;

  const status =
    $('newMemberStatus').value;

  if (
    !validNumber(number) ||
    !name ||
    name.length > 100 ||
    !validPhone(phone) ||
    !validDate(joiningDate) ||
    !['active', 'inactive'].includes(status)
  ) {
    return notify(
      'Check member details.',
      true
    );
  }

  const b = $('saveNewMember');
  b.disabled = true;

  try {
    if (
      (
        await get(
          ref(db, `archivedMembers/${number}`)
        )
      ).exists()
    ) {
      throw Error(
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
      throw Error(
        'Member number already exists.'
      );
    }

    $('addMemberForm').reset();

    $('newMemberDate').value = today();

    notify(
      `Member #${number} added successfully.`
    );

    tab('members');

  } catch (e) {
    notify(
      'Save failed: ' + e.message,
      true
    );

  } finally {
    b.disabled = false;
  }
};

// EDIT MEMBER — ADMIN

function openEditMember(number) {
  if (!isAdmin()) return;

  const m = memberList[String(number)];

  if (!editable(m)) {
    return notify(
      'Member cannot be edited.',
      true
    );
  }

  show('archiveMemberPanel', false);
  show('adminMemberHistory', false);

  $('editMemberNumber').value = number;
  $('editMemberName').value = m.name || '';
  $('editMemberPhone').value = m.phone || '';

  $('editMemberDate').value =
    m.joiningDate || today();

  $('editMemberStatus').value =
    m.status === 'inactive'
      ? 'inactive'
      : 'active';

  show('editMemberPanel', true);

  $('editMemberPanel').scrollIntoView({
    behavior: 'smooth',
    block: 'start'
  });
}

$('cancelEditMember').onclick =
  () => show('editMemberPanel', false);

$('editMemberForm').onsubmit = async event => {
  event.preventDefault();

  if (!isAdmin()) {
    return notify(
      'Admin access required.',
      true
    );
  }

  const number =
    String($('editMemberNumber').value);

  const name =
    $('editMemberName').value.trim();

  const phone =
    $('editMemberPhone').value.trim();

  const joiningDate =
    $('editMemberDate').value;

  const status =
    $('editMemberStatus').value;

  if (
    !name ||
    name.length > 100 ||
    !validPhone(phone) ||
    !validDate(joiningDate) ||
    !['active', 'inactive'].includes(status)
  ) {
    return notify(
      'Check member details.',
      true
    );
  }

  const b = $('saveEditMember');
  b.disabled = true;

  try {
    const result = await runTransaction(
      ref(db, `members/${number}`),
      m => {
        if (!editable(m)) return;

        return {
          ...m,
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
      throw Error(
        'Member changed or archived.'
      );
    }

    show('editMemberPanel', false);

    notify(
      `Member #${number} updated successfully.`
    );

  } catch (e) {
    notify(
      'Edit failed: ' + e.message,
      true
    );

  } finally {
    b.disabled = false;
  }
};

// ARCHIVE — READ ONLY

function openArchiveMember(number) {
  if (!isAdmin()) return;

  const m = memberList[String(number)];

  if (!editable(m)) {
    return notify(
      'Member cannot be archived.',
      true
    );
  }

  show('editMemberPanel', false);
  show('adminMemberHistory', false);

  $('archiveMemberNumber').value = number;

  $('archiveMemberSummary').textContent =
    `#${number} — ${m.name || 'Member'}`;

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

$('cancelArchiveMember').onclick =
  () => show('archiveMemberPanel', false);

const requestsForMember = (number, data) =>
  Object.entries(data || {})
    .filter(([, r]) =>
      String(r.memberNumber) === String(number)
    );

const unresolvedRequests = (number, data) =>
  requestsForMember(number, data)
    .filter(([, r]) =>
      !['approved', 'rejected'].includes(r.status)
    );

function findPartialPaymentRequests(
  number,
  m,
  requests
) {
  return requestsForMember(number, requests)
    .filter(([id, r]) =>
      Object.values(m?.payments || {}).some(p =>
        p?.requestId === id &&
        p?.status === 'paid'
      ) &&
      r.status !== 'approved'
    )
    .map(([id]) => id);
}

async function archiveMemberSafely(event) {
  event.preventDefault();

  if (!isAdmin() || archiveBusy) return;

  const number = String(
    $('archiveMemberNumber').value
  ).trim();

  const reason =
    $('archiveMemberReason').value;

  if (
    !validNumber(number) ||
    ![
      'resigned',
      'inactive',
      'deceased',
      'duplicate',
      'other'
    ].includes(reason) ||
    !$('archiveMemberConfirm').checked
  ) {
    return notify(
      'Check archive details.',
      true
    );
  }

  if (
    !membersLoaded ||
    !adminHistoryLoaded ||
    !paymentRequestsLoaded ||
    !archiveLoaded ||
    !adminCorrectionsLoaded
  ) {
    return notify(
      'Wait until database loading completes.',
      true
    );
  }

  archiveBusy = true;
  updateArchiveButton();

  try {
    const m = (
      await get(
        ref(db, `members/${number}`)
      )
    ).val();

    if (!editable(m)) {
      throw Error(
        'Member missing, archived or locked.'
      );
    }

    const history = (
      await get(
        ref(db, `paymentHistory/${number}`)
      )
    ).val() || {};

    const requests = (
      await get(
        ref(db, 'paymentRequests')
      )
    ).val() || {};

    const unresolved =
      unresolvedRequests(number, requests);

    if (unresolved.length) {
      throw Error(
        `${unresolved.length} unresolved payment request(s).`
      );
    }

    if (
      findPartialPaymentRequests(
        number,
        m,
        requests
      ).length
    ) {
      throw Error(
        'Partial payment approval detected.'
      );
    }

    if (
      (
        await get(
          ref(db, `archivedMembers/${number}`)
        )
      ).exists()
    ) {
      throw Error(
        'Archive record already exists.'
      );
    }

    const corrections = (
      await get(
        ref(db, `paymentCorrections/${number}`)
      )
    ).val() || {};

    const count = paidMonths(
      m,
      history,
      corrections
    ).length;

    if (!ARCHIVE_WRITE_ENABLED) {
      notify(
        `Archive pre-check passed for #${number}: ` +
        `${count} paid months. ` +
        `Final Archive remains LOCKED.`
      );

      return;
    }

    throw Error(
      'Final Archive requires a secure server-side workflow.'
    );

  } catch (e) {
    notify(
      'Archive stopped: ' + e.message,
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
  const b = $('confirmArchiveMember');

  if (b) {
    b.disabled =
      archiveBusy ||
      !isAdmin() ||
      !membersLoaded ||
      !adminHistoryLoaded ||
      !paymentRequestsLoaded ||
      !archiveLoaded ||
      !adminCorrectionsLoaded ||
      !$('archiveMemberConfirm').checked;
  }
}

$('archiveMemberConfirm').onchange =
  updateArchiveButton;

function renderArchivedMembers() {
  const root = $('archivedMembersList');
  if (!root) return;

  root.replaceChildren();

  const search =
    ($('archivedMembersSearch').value || '')
      .toLowerCase();

  const entries = Object.entries(
    archivedMembers
  )
    .filter(([id, r]) =>
      [
        id,
        r.originalNumber,
        r.member?.name,
        r.reason
      ]
        .join(' ')
        .toLowerCase()
        .includes(search)
    )
    .sort((a, b) =>
      (b[1].archivedAt || 0) -
      (a[1].archivedAt || 0)
    );

  if (!entries.length) {
    root.textContent =
      'No archived members found.';

    return;
  }

  const table = document.createElement('table');

  table.innerHTML =
    '<thead><tr>' +
    '<th>Old #</th>' +
    '<th>Name</th>' +
    '<th>Reason</th>' +
    '<th>Archived Date</th>' +
    '<th>History</th>' +
    '</tr></thead>';

  const body = document.createElement('tbody');

  for (const [id, r] of entries) {
    const row = document.createElement('tr');

    for (const v of [
      r.originalNumber,
      r.member?.name || '',
      r.reason || '',
      r.archivedAt
        ? new Date(r.archivedAt)
            .toLocaleDateString('en-IN')
        : ''
    ]) {
      const c = document.createElement('td');

      c.textContent = v;
      row.append(c);
    }

    const a = document.createElement('td');

    a.append(
      button(
        'View History',
        () => renderArchivedHistory(id)
      )
    );

    row.append(a);
    body.append(row);
  }

  table.append(body);
  root.append(table);
}

function renderArchivedHistory(id) {
  if (!isAdmin()) return;

  const r = archivedMembers[id];
  if (!r) return;

  const m = r.member || {};
  const history = r.paymentHistory || {};

  $('archivedHistoryTitle').textContent =
    `#${r.originalNumber} — ` +
    `${m.name || 'Former Member'}`;

  const count = renderHistoryTable(
    m,
    history,
    'archivedHistoryTable',
    'all',
    r.paymentCorrections || {}
  );

  $('archivedHistorySummary').textContent =
    `Paid months: ${count} | ` +
    `Recorded paid amount: ₹${count * MONTHLY_FEE} | ` +
    `Reason: ${r.reason || 'Not specified'} | ` +
    `Member number reserved`;

  show('archivedMemberHistory', true);

  $('archivedMemberHistory').scrollIntoView({
    behavior: 'smooth',
    block: 'start'
  });
}

$('archivedMembersSearch').oninput =
  renderArchivedMembers;

// PAYMENT MANAGEMENT

function planDetails() {
  const plan = $('paymentPlan').value;

  return {
    plan,
    amount:
      plan === 'yearly'
        ? YEARLY_FEE
        : MONTHLY_FEE,
    period: $('paymentPeriod').value
  };
}

function paymentMonthKeys(plan, period) {
  if (
    !validPeriod(period) ||
    !['monthly', 'yearly'].includes(plan)
  ) {
    throw Error(
      'Invalid payment plan or period.'
    );
  }

  if (plan === 'monthly') {
    return [period];
  }

  const year = period.slice(0, 4);

  return Array.from(
    { length: 12 },
    (_, i) =>
      `${year}-${String(i + 1).padStart(2, '0')}`
  );
}

function updateUpiLink() {
  const { amount } = planDetails();

  const params = new URLSearchParams({
    pa: UPI_ID,
    pn: UPI_NAME,
    cu: 'INR'
  });

  $('upiPayLink').href =
    `upi://pay?${params.toString()}`;

  $('upiPayLink').textContent =
    `Open UPI app — Enter ₹${amount}`;
}

$('paymentPlan').onchange = updateUpiLink;
$('paymentPeriod').onchange = updateUpiLink;

updateUpiLink();

// MEMBER PAYMENT SUBMISSION

$('submitPayment').onclick = async () => {
  if (!PAYMENT_V76_ENABLED) {
    return notify(
      'Payment temporarily unavailable during upgrade.',
      true
    );
  }

  if (
    !current ||
    !memberNumber ||
    admin
  ) {
    return notify(
      'Member login required.',
      true
    );
  }

  if (paymentBusy) return;

  const { plan, amount, period } =
    planDetails();

  const transactionId =
    $('transactionId').value.trim();

  if (
    !['monthly', 'yearly'].includes(plan) ||
    !validPeriod(period) ||
    !/^[A-Za-z0-9-]{6,100}$/.test(transactionId)
  ) {
    return notify(
      'Check payment details and transaction reference.',
      true
    );
  }

  if (
    !historyLoaded ||
    historyError ||
    !correctionsLoaded ||
    correctionsError
  ) {
    return notify(
      'Payment history or corrections not ready.',
      true
    );
  }

  const keys = paymentMonthKeys(
    plan,
    period
  );

  if (
    cancelledPeriods(
      paymentCorrections,
      keys
    ).length
  ) {
    return notify(
      'A selected month has a cancelled payment record. Contact admin for reconciliation.',
      true
    );
  }

  if (!confirm(
    `Submit ₹${amount} for ` +
    `${plan === 'yearly' ? period.slice(0, 4) : period} ` +
    `as Pending? Submit only after paying.`
  )) return;

  paymentBusy = true;

  const b = $('submitPayment');
  b.disabled = true;

  try {
    const uid = current.uid;
    const number = String(memberNumber);

    const m = (
      await get(
        ref(db, `members/${number}`)
      )
    ).val();

    if (
      !active(m) ||
      m.status !== 'active' ||
      m.uid !== uid
    ) {
      throw Error(
        'Membership must have active status.'
      );
    }

    const history = (
      await get(
        ref(db, `paymentHistory/${number}`)
      )
    ).val() || {};

    const corrections = (
      await get(
        ref(db, `paymentCorrections/${number}`)
      )
    ).val() || {};

    if (
      cancelledPeriods(corrections, keys).length
    ) {
      throw Error(
        'Cancelled months require admin reconciliation.'
      );
    }

    const paid = new Set(
      originalPaidMonths(m, history)
    );

    if (keys.some(p => paid.has(p))) {
      throw Error(
        'One or more selected months already have payment records. Contact admin.'
      );
    }

    const existing = (
      await get(
        query(
          ref(db, 'paymentRequests'),
          orderByChild('uid'),
          equalTo(uid)
        )
      )
    ).val() || {};

    if (
      Object.values(existing).some(r =>
        String(r.transactionId || '')
          .toLowerCase() ===
        transactionId.toLowerCase()
      )
    ) {
      throw Error(
        'This transaction reference was already submitted.'
      );
    }

    if (
      Object.values(existing).some(r => {
        if (
          r.status !== 'pending' ||
          String(r.memberNumber) !== number
        ) return false;

        try {
          return paymentMonthKeys(
            r.plan,
            r.period
          ).some(p => keys.includes(p));

        } catch {
          return false;
        }
      })
    ) {
      throw Error(
        'A pending request already covers this period.'
      );
    }

    const requestRef = push(
      ref(db, 'paymentRequests')
    );

    await set(requestRef, {
      uid,
      memberNumber: Number(number),
      plan,
      amount,
      period,
      transactionId,
      status: 'pending',
      createdAt: Date.now()
    });

    $('transactionId').value = '';

    notify(
      'Submitted for admin verification. This is not proof of payment.'
    );

  } catch (e) {
    notify(
      'Submission failed: ' + e.message,
      true
    );

  } finally {
    paymentBusy = false;
    b.disabled = !PAYMENT_V76_ENABLED;
  }
};

if (!PAYMENT_V76_ENABLED) {
  const paymentButton = $('submitPayment');

  if (paymentButton) {
    paymentButton.disabled = true;

    paymentButton.textContent =
      'Payment Temporarily Unavailable';
  }
}

// ADMIN PAYMENT REQUESTS

function renderAdminPayments() {
  const root = $('adminPaymentList');
  if (!root) return;

  root.replaceChildren();

  const entries = Object.entries(payments)
    .filter(([, r]) =>
      r.status === 'pending'
    )
    .sort((a, b) =>
      (a[1].createdAt || 0) -
      (b[1].createdAt || 0)
    );

  if (!entries.length) {
    root.textContent =
      'No pending payment submissions.';

    return;
  }

  for (const [id, r] of entries) {
    const box = document.createElement('div');
    const info = document.createElement('p');

    box.className = 'panel';

    info.textContent =
      `#${r.memberNumber} — ` +
      `${memberList[r.memberNumber]?.name || ''} | ` +
      `₹${r.amount} | ` +
      `${r.plan} ${r.period} | ` +
      `UPI Ref: ${r.transactionId}`;

    box.append(
      info,
      button(
        'Approve after bank verification',
        () => verifyPayment(id, r, true)
      ),
      document.createTextNode(' '),
      button(
        'Reject',
        () => verifyPayment(id, r, false),
        'secondary'
      )
    );

    root.append(box);
  }
}

function recordedMonthsForRequest(m, id) {
  return Object.entries(m?.payments || {})
    .filter(([, r]) =>
      r?.requestId === id &&
      r?.status === 'paid'
    )
    .map(([p]) => p)
    .sort();
}

function samePeriods(a, b) {
  const x = [...a].sort();
  const y = [...b].sort();

  return x.length === y.length &&
    x.every((p, i) => p === y[i]);
}

// ADMIN PAYMENT VERIFICATION

async function verifyPayment(
  id,
  request,
  accept
) {
  if (
    !isAdmin() ||
    request.status !== 'pending' ||
    paymentBusy
  ) return;

  if (!confirm(
    accept
      ? (
        `Have you verified ₹${request.amount} ` +
        `in the bank statement? ` +
        `Approve #${request.memberNumber}, ` +
        `${request.period}?`
      )
      : (
        `Reject payment request for ` +
        `#${request.memberNumber}?`
      )
  )) return;

  paymentBusy = true;

  try {
    const requestRef = ref(
      db,
      `paymentRequests/${id}`
    );

    const fresh = (
      await get(requestRef)
    ).val();

    if (
      !fresh ||
      fresh.status !== 'pending'
    ) {
      throw Error(
        'Request is no longer pending.'
      );
    }

    const number =
      String(fresh.memberNumber);

    const memberRef = ref(
      db,
      `members/${number}`
    );

    const m = (
      await get(memberRef)
    ).val();

    if (!accept) {
      if (
        recordedMonthsForRequest(m, id).length
      ) {
        throw Error(
          'Payment already recorded. Manual reconciliation required.'
        );
      }

      const result = await runTransaction(
        requestRef,
        r => {
          if (
            !r ||
            r.status !== 'pending'
          ) return;

          return {
            ...r,
            status: 'rejected',
            reviewedAt: Date.now(),
            reviewedBy: current.uid
          };
        },
        { applyLocally: false }
      );

      if (!result.committed) {
        throw Error(
          'Request already reviewed.'
        );
      }

      notify('Payment rejected.');
      return;
    }

    if (
      !['monthly', 'yearly'].includes(
        fresh.plan
      ) ||
      fresh.amount !== (
        fresh.plan === 'yearly'
          ? YEARLY_FEE
          : MONTHLY_FEE
      )
    ) {
      throw Error(
        'Invalid payment amount or plan.'
      );
    }

    const keys = paymentMonthKeys(
      fresh.plan,
      fresh.period
    );

    if (
      !active(m) ||
      m.uid !== fresh.uid
    ) {
      throw Error(
        'Member inactive or account mismatch.'
      );
    }

    const corrections = (
      await get(
        ref(db, `paymentCorrections/${number}`)
      )
    ).val() || {};

    if (
      cancelledPeriods(corrections, keys).length
    ) {
      throw Error(
        'A selected month is cancelled. Restore or reconcile the record before approval.'
      );
    }

    const recorded =
      recordedMonthsForRequest(m, id);

    if (recorded.length) {
      if (!samePeriods(recorded, keys)) {
        throw Error(
          'Partial payment records do not match. Manual reconciliation required.'
        );
      }

      const recovery = await runTransaction(
        requestRef,
        r => {
          if (
            !r ||
            r.status !== 'pending'
          ) return;

          return {
            ...r,
            status: 'approved',
            reviewedAt: Date.now(),
            reviewedBy: current.uid,
            recovered: true
          };
        },
        { applyLocally: false }
      );

      if (!recovery.committed) {
        throw Error(
          'Recovery status changed.'
        );
      }

      notify(
        'Existing paid months reconciled.'
      );

      return;
    }

    const history = (
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
          !active(member) ||
          member.uid !== fresh.uid
        ) return;

        if (
          keys.some(key =>
            member.payments?.[key]?.status ===
              'paid' ||
            isHistoricalPaid(
              history,
              +key.slice(0, 4),
              +key.slice(5, 7)
            )
          )
        ) return;

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
            transactionId:
              fresh.transactionId,
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
      throw Error(
        'Payment not recorded. Check existing paid months.'
      );
    }

    try {
      const done = await runTransaction(
        requestRef,
        r => {
          if (
            !r ||
            r.status !== 'pending'
          ) return;

          return {
            ...r,
            status: 'approved',
            reviewedAt: verifiedAt,
            reviewedBy: reviewer
          };
        },
        { applyLocally: false }
      );

      if (!done.committed) {
        throw Error(
          'Request status changed.'
        );
      }

    } catch (e) {
      throw Error(
        'Paid months may be recorded but request status was not completed. ' +
        'Review the same request. ' +
        e.message
      );
    }

    notify(
      'Payment approved and recorded.'
    );

  } catch (e) {
    notify(
      'Payment review needs attention: ' +
      e.message,
      true
    );

  } finally {
    paymentBusy = false;
  }
}

// MEMBER PAYMENT REQUEST HISTORY

function renderMyPayments(data) {
  const entries = Object.values(data)
    .sort((a, b) =>
      (b.createdAt || 0) -
      (a.createdAt || 0)
    );

  if (!entries.length) {
    $('myPaymentList').textContent =
      'No payment submissions yet.';

    return;
  }

  $('myPaymentList').innerHTML =
    `<table>` +
    `<thead><tr>` +
    `<th>Period</th>` +
    `<th>Amount</th>` +
    `<th>Status</th>` +
    `</tr></thead>` +
    `<tbody>` +
    entries.map(r =>
      `<tr>` +
      `<td>${safe(r.period)} (${safe(r.plan)})</td>` +
      `<td>₹${Number(r.amount) || 0}</td>` +
      `<td>${safe(r.status)}</td>` +
      `</tr>`
    ).join('') +
    `</tbody></table>`;
}

// ADMIN CASH PAYMENT

function setupCashPayments() {
  const tabs =
    $('tabMembers')?.parentElement;

  const adminSection = $('admin');

  if (
    !tabs ||
    !adminSection ||
    $('tabCash')
  ) return;

  const tabButton = button(
    'Cash Payment',
    () => {
      tab('cash');
      refreshCashMember();
    },
    'secondary'
  );

  tabButton.id = 'tabCash';
  tabs.append(tabButton);

  const panel = document.createElement('div');

  panel.id = 'cashPanel';
  panel.className = 'panel hide';

  panel.innerHTML = `
    <h2>Record Cash Payment</h2>

    <p class="notice">
      Admin only. Record cash only after receiving it.
    </p>

    <label for="cashMemberNumber">
      Member Number
    </label>

    <input
      id="cashMemberNumber"
      type="number"
      min="1"
      max="99999"
    >

    <p id="cashMemberInfo"></p>

    <label for="cashPlan">
      Payment Type
    </label>

    <select id="cashPlan">
      <option value="monthly">
        Monthly — ₹50 per month
      </option>
      <option value="yearly">
        Yearly — ₹600
      </option>
    </select>

    <label for="cashYear">
      Payment Year
    </label>

    <input
      id="cashYear"
      type="number"
      min="2024"
      max="9999"
    >

    <div id="cashMonthsBox">
      <label>Select Paid Months</label>
      <div id="cashMonths" class="grid"></div>
    </div>

    <label for="cashDate">
      Cash Received Date
    </label>

    <input id="cashDate" type="date">

    <h3 id="cashTotal">Total: ₹0</h3>

    <p id="cashWarning" class="muted"></p>

    <button
      id="saveCash"
      type="button"
      disabled
    >
      Save Cash Payment & Mark Paid
    </button>
  `;

  adminSection.append(panel);

  $('cashYear').value =
    new Date().getFullYear();

  $('cashDate').value = today();

  const monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr',
    'May', 'Jun', 'Jul', 'Aug',
    'Sep', 'Oct', 'Nov', 'Dec'
  ];

  monthNames.forEach((name, index) => {
    const label =
      document.createElement('label');

    label.className = 'flex';

    const checkbox =
      document.createElement('input');

    checkbox.type = 'checkbox';
    checkbox.className = 'cash-month';

    checkbox.value =
      String(index + 1).padStart(2, '0');

    checkbox.style.width = 'auto';

    label.append(
      checkbox,
      document.createTextNode(name)
    );

    $('cashMonths').append(label);

    checkbox.onchange =
      refreshCashMember;
  });

  $('cashMemberNumber').oninput =
    refreshCashMember;

  $('cashYear').oninput =
    refreshCashMember;

  $('cashPlan').onchange =
    refreshCashMember;

  $('saveCash').onclick =
    saveCashPayment;
}

function openCashForMember(number) {
  if (!isAdmin()) return;

  tab('cash');

  $('cashMemberNumber').value = number;

  refreshCashMember();

  $('cashPanel').scrollIntoView({
    behavior: 'smooth',
    block: 'start'
  });
}

function selectedCashPeriods() {
  const year =
    String($('cashYear').value);

  const plan =
    $('cashPlan').value;

  if (
    !/^\d{4}$/.test(year) ||
    Number(year) < 2024
  ) {
    throw Error(
      'Select a valid year from 2024 onward.'
    );
  }

  if (plan === 'yearly') {
    return Array.from(
      { length: 12 },
      (_, i) =>
        `${year}-${String(i + 1).padStart(2, '0')}`
    );
  }

  if (plan !== 'monthly') {
    throw Error(
      'Invalid payment plan.'
    );
  }

  return [
    ...document.querySelectorAll(
      '.cash-month:checked'
    )
  ]
    .map(el => `${year}-${el.value}`)
    .sort();
}

function refreshCashMember() {
  if (!$('cashPanel')) return;

  const number =
    String(+$('cashMemberNumber').value);

  const member = memberList[number];

  $('cashMemberInfo').textContent =
    member
      ? (
        `#${number} — ` +
        `${member.name || 'Member'} ` +
        `(${member.status || 'active'})`
      )
      : 'Select an existing member.';

  const yearly =
    $('cashPlan').value === 'yearly';

  show('cashMonthsBox', !yearly);

  let keys = [];
  let periodError = '';

  try {
    keys = selectedCashPeriods();
  } catch (e) {
    periodError = e.message;
  }

  const amount =
    keys.length * MONTHLY_FEE;

  $('cashTotal').textContent =
    `Total: ₹${amount}`;

  const history =
    adminHistoryCache[number] || {};

  const corrections =
    adminCorrections[number] || {};

  const original = new Set(
    originalPaidMonths(member, history)
  );

  const duplicates =
    keys.filter(k => original.has(k));

  const cancelled = cancelledPeriods(
    corrections,
    keys
  );

  const pending = Object.values(payments)
    .some(r => {
      if (
        r?.status !== 'pending' ||
        String(r.memberNumber) !== number
      ) return false;

      try {
        return paymentMonthKeys(
          r.plan,
          r.period
        ).some(k => keys.includes(k));

      } catch {
        return true;
      }
    });

  const ready =
    membersLoaded &&
    adminHistoryLoaded &&
    paymentRequestsLoaded &&
    adminCorrectionsLoaded;

  $('cashWarning').textContent =
    periodError
      ? periodError
      : !ready
        ? 'Loading payment records. Please wait.'
        : cancelled.length
          ? (
            'Cancelled payment record: ' +
            cancelled.join(', ') +
            '. Contact admin for reconciliation.'
          )
          : duplicates.length
            ? `Already recorded: ${duplicates.join(', ')}`
            : pending
              ? 'A pending UPI request overlaps these months.'
              : !CASH_WRITE_ENABLED
                ? 'Cash saving is locked.'
                : 'Ready to record cash payment. Verify cash was received before saving.';

  $('saveCash').disabled =
    !CASH_WRITE_ENABLED ||
    cashBusy ||
    !isAdmin() ||
    !ready ||
    !member ||
    !active(member) ||
    !keys.length ||
    !!periodError ||
    !!duplicates.length ||
    !!cancelled.length ||
    pending;
}

// CASH PAYMENT SAVE

async function saveCashPayment() {
  if (
    !CASH_WRITE_ENABLED ||
    !isAdmin() ||
    cashBusy
  ) return;

  const adminUid = current.uid;

  const number =
    String(+$('cashMemberNumber').value);

  const plan =
    $('cashPlan').value;

  const receivedDate =
    $('cashDate').value;

  try {
    const keys =
      selectedCashPeriods();

    if (
      !validNumber(number) ||
      !keys.length
    ) {
      throw Error(
        'Select a valid member and month.'
      );
    }

    if (!validDate(receivedDate)) {
      throw Error(
        'Invalid cash received date.'
      );
    }

    if (
      !membersLoaded ||
      !adminHistoryLoaded ||
      !paymentRequestsLoaded ||
      !adminCorrectionsLoaded
    ) {
      throw Error(
        'Wait for database loading.'
      );
    }

    const memberRef = ref(
      db,
      `members/${number}`
    );

    const freshMember = (
      await get(memberRef)
    ).val();

    if (
      !freshMember ||
      freshMember.status !== 'active'
    ) {
      throw Error(
        'Active member required.'
      );
    }

    const history = (
      await get(
        ref(db, `paymentHistory/${number}`)
      )
    ).val() || {};

    const corrections = (
      await get(
        ref(db, `paymentCorrections/${number}`)
      )
    ).val() || {};

    if (
      cancelledPeriods(
        corrections,
        keys
      ).length
    ) {
      throw Error(
        'Cancelled payment records must be reconciled first.'
      );
    }

    const paid = new Set(
      originalPaidMonths(
        freshMember,
        history
      )
    );

    if (keys.some(k => paid.has(k))) {
      throw Error(
        'Already recorded month selected.'
      );
    }

    const requests = (
      await get(
        ref(db, 'paymentRequests')
      )
    ).val() || {};

    const overlaps =
      Object.values(requests).some(r => {
        if (
          r?.status !== 'pending' ||
          String(r.memberNumber) !== number
        ) return false;

        try {
          return paymentMonthKeys(
            r.plan,
            r.period
          ).some(k => keys.includes(k));

        } catch {
          return true;
        }
      });

    if (overlaps) {
      throw Error(
        'Pending UPI request overlaps these months.'
      );
    }

    const amount =
      keys.length * MONTHLY_FEE;

    if (!confirm(
      `Confirm CASH RECEIVED?\n\n` +
      `Member: #${number} — ${freshMember.name}\n` +
      `Type: ${plan}\n` +
      `Months: ${keys.join(', ')}\n` +
      `Amount: ₹${amount}\n` +
      `Received: ${receivedDate}\n\n` +
      `Save and mark Paid?`
    )) return;

    cashBusy = true;
    refreshCashMember();

    const recordedAt = Date.now();

    const result = await runTransaction(
      memberRef,
      member => {
        if (
          !member ||
          member.status !== 'active'
        ) return;

        const existing =
          member.payments || {};

        if (
          keys.some(k =>
            existing[k] != null ||
            isHistoricalPaid(
              history,
              +k.slice(0, 4),
              +k.slice(5, 7)
            )
          )
        ) return;

        const next = {
          ...member,
          payments: {
            ...existing
          }
        };

        for (const period of keys) {
          next.payments[period] = {
            status: 'paid',
            amount: MONTHLY_FEE,
            method: 'cash',
            plan,
            receivedDate,
            verifiedAt: recordedAt,
            verifiedBy: adminUid,

            audit: {
              action:
                'cash_payment_recorded',
              recordedBy: adminUid,
              recordedAt,
              memberNumber:
                Number(number),
              period
            }
          };
        }

        return next;
      },
      { applyLocally: false }
    );

    if (!result.committed) {
      throw Error(
        'Payment conflict. Refresh and check history.'
      );
    }

    notify(
      `Cash payment saved successfully: ` +
      `Member #${number}, ₹${amount}.`
    );

    document.querySelectorAll(
      '.cash-month'
    ).forEach(el => {
      el.checked = false;
    });

  } catch (e) {
    notify(
      'Cash payment failed: ' +
      e.message,
      true
    );

  } finally {
    cashBusy = false;
    refreshCashMember();
  }
}

// VERSION 82.0
// ADMIN CANCEL / RESTORE PAID TICK

function setupPaymentCorrections() {
  const tabs =
    $('tabMembers')?.parentElement;

  const adminSection =
    $('admin');

  if (
    !tabs ||
    !adminSection ||
    $('tabCorrection')
  ) return;

  const tabButton = button(
    'Cancel / Restore Paid',
    () => {
      tab('correction');
      refreshCorrectionPanel();
    },
    'secondary'
  );

  tabButton.id = 'tabCorrection';

  tabs.append(tabButton);

  const panel = document.createElement('div');

  panel.id = 'correctionPanel';
  panel.className = 'panel hide';

  panel.innerHTML = `
    <h2>Cancel / Restore Paid Tick</h2>

    <p class="notice">
      Admin only. Original payment records will not be deleted.
      Every correction requires a reason.
    </p>

    <label for="correctionMemberNumber">
      Member Number
    </label>

    <input
      id="correctionMemberNumber"
      type="number"
      min="1"
      max="99999"
    >

    <p id="correctionMemberInfo"></p>

    <label for="correctionYear">
      Payment Year
    </label>

    <input
      id="correctionYear"
      type="number"
      min="2024"
      max="9999"
    >

    <label for="correctionMonth">
      Payment Month
    </label>

    <select id="correctionMonth">
      <option value="01">January</option>
      <option value="02">February</option>
      <option value="03">March</option>
      <option value="04">April</option>
      <option value="05">May</option>
      <option value="06">June</option>
      <option value="07">July</option>
      <option value="08">August</option>
      <option value="09">September</option>
      <option value="10">October</option>
      <option value="11">November</option>
      <option value="12">December</option>
    </select>

    <p id="correctionCurrentStatus"></p>

    <label for="correctionReason">
      Reason for Correction
    </label>

    <textarea
      id="correctionReason"
      rows="3"
      maxlength="500"
      placeholder="Enter a clear reason (minimum 5 characters)"
    ></textarea>

    <p id="correctionWarning" class="muted"></p>

    <button
      id="cancelPaidTick"
      type="button"
      class="danger"
      disabled
    >
      Cancel Paid Tick
    </button>

    <button
      id="restorePaidTick"
      type="button"
      class="secondary"
      disabled
    >
      Restore Paid Tick
    </button>

    <h3>Correction Audit History</h3>

    <div id="correctionAuditHistory"></div>
  `;

  adminSection.append(panel);

  $('correctionYear').value =
    new Date().getFullYear();

  $('correctionMonth').value =
    String(
      new Date().getMonth() + 1
    ).padStart(2, '0');

  $('correctionMemberNumber').oninput =
    refreshCorrectionPanel;

  $('correctionYear').oninput =
    refreshCorrectionPanel;

  $('correctionMonth').onchange =
    refreshCorrectionPanel;

  $('correctionReason').oninput =
    refreshCorrectionPanel;

  $('cancelPaidTick').onclick =
    () => correctPaidTick('cancel');

  $('restorePaidTick').onclick =
    () => correctPaidTick('restore');
}

function openCorrectionForMember(
  number,
  period = null
) {
  if (!isAdmin()) return;

  tab('correction');

  $('correctionMemberNumber').value =
    number;

  if (period && validPeriod(period)) {
    $('correctionYear').value =
      period.slice(0, 4);

    $('correctionMonth').value =
      period.slice(5, 7);
  }

  $('correctionReason').value = '';

  refreshCorrectionPanel();

  $('correctionPanel').scrollIntoView({
    behavior: 'smooth',
    block: 'start'
  });
}

function selectedCorrectionPeriod() {
  const year =
    String($('correctionYear')?.value || '');

  const month =
    String($('correctionMonth')?.value || '');

  const period = `${year}-${month}`;

  if (
    !validPeriod(period) ||
    Number(year) < 2024
  ) {
    throw Error(
      'Select a valid payment month from 2024 onward.'
    );
  }

  return period;
}

function correctionOriginalSource(
  member,
  history,
  period
) {
  const sources = [];

  if (
    member?.payments?.[period]?.status === 'paid'
  ) {
    const payment =
      member.payments[period];

    sources.push(
      payment.method === 'cash'
        ? 'Cash Payment'
        : payment.requestId
          ? 'UPI Payment'
          : 'Recorded Payment'
    );
  }

  if (
    isHistoricalPaid(
      history,
      +period.slice(0, 4),
      +period.slice(5, 7)
    )
  ) {
    sources.push(
      'Historical / PDF Payment'
    );
  }

  return sources;
}

function pendingRequestsForPeriod(
  number,
  period,
  data
) {
  return Object.entries(data || {})
    .filter(([, r]) => {
      if (
        r?.status !== 'pending' ||
        String(r.memberNumber) !==
          String(number)
      ) return false;

      try {
        return paymentMonthKeys(
          r.plan,
          r.period
        ).includes(period);

      } catch {
        return true;
      }
    });
}

function renderCorrectionAudit(
  number,
  period
) {
  const root =
    $('correctionAuditHistory');

  if (!root) return;

  root.replaceChildren();

  const record =
    adminCorrections?.[number]?.[period];

  if (!record) {
    root.textContent =
      'No correction history for this month.';

    return;
  }

  const events = Object.entries(
    record.events || {}
  ).sort(
    (a, b) =>
      (b[1]?.at || 0) -
      (a[1]?.at || 0)
  );

  if (!events.length) {
    root.textContent =
      'No audit events available.';

    return;
  }

  const table =
    document.createElement('table');

  table.innerHTML =
    '<thead><tr>' +
    '<th>Action</th>' +
    '<th>Date / Time</th>' +
    '<th>Reason</th>' +
    '<th>Admin UID</th>' +
    '</tr></thead>';

  const body =
    document.createElement('tbody');

  for (const [, event] of events) {
    const row =
      document.createElement('tr');

    const date =
      Number.isFinite(event.at)
        ? new Date(event.at)
            .toLocaleString('en-IN')
        : '';

    for (const value of [
      event.action || '',
      date,
      event.reason || '',
      event.adminUid || ''
    ]) {
      const cell =
        document.createElement('td');

      cell.textContent = value;
      row.append(cell);
    }

    body.append(row);
  }

  table.append(body);
  root.append(table);
}

function refreshCorrectionPanel() {
  if (!$('correctionPanel')) return;

  const number = String(
    +$('correctionMemberNumber').value
  );

  const member =
    memberList[number];

  const info =
    $('correctionMemberInfo');

  const status =
    $('correctionCurrentStatus');

  const warning =
    $('correctionWarning');

  const cancelButton =
    $('cancelPaidTick');

  const restoreButton =
    $('restorePaidTick');

  cancelButton.disabled = true;
  restoreButton.disabled = true;

  info.textContent = member
    ? (
      `#${number} — ` +
      `${member.name || 'Member'} ` +
      `(${member.status || 'active'})`
    )
    : 'Select an existing member.';

  let period;

  try {
    period = selectedCorrectionPeriod();

  } catch (e) {
    status.textContent = '';
    warning.textContent = e.message;

    $('correctionAuditHistory')
      .replaceChildren();

    return;
  }

  const ready =
    isAdmin() &&
    membersLoaded &&
    adminHistoryLoaded &&
    adminCorrectionsLoaded &&
    paymentRequestsLoaded;

  if (!ready) {
    status.textContent =
      'Loading payment records...';

    warning.textContent =
      'Wait for all records to load.';

    $('correctionAuditHistory')
      .replaceChildren();

    return;
  }

  if (!member) {
    status.textContent =
      'Member not found.';

    warning.textContent = '';

    $('correctionAuditHistory')
      .replaceChildren();

    return;
  }

  const history =
    adminHistoryCache[number] || {};

  const corrections =
    adminCorrections[number] || {};

  const sources = correctionOriginalSource(
    member,
    history,
    period
  );

  const hasOriginal =
    sources.length > 0;

  const record =
    corrections[period];

  const isCancelled =
    record?.state === 'cancelled';

  const effectivePaid =
    hasOriginal && !isCancelled;

  const pending =
    pendingRequestsForPeriod(
      number,
      period,
      payments
    );

  status.textContent =
    `Month: ${period} | ` +
    `Current Status: ${
      isCancelled
        ? 'CANCELLED / NOT PAID'
        : effectivePaid
          ? 'PAID'
          : 'NOT VERIFIED'
    } | ` +
    `Original Source: ${
      sources.length
        ? sources.join(' + ')
        : 'None'
    }`;

  renderCorrectionAudit(
    number,
    period
  );

  const reason =
    $('correctionReason').value.trim();

  const reasonValid =
    reason.length >= 5 &&
    reason.length <= 500;

  if (!hasOriginal) {
    warning.textContent =
      'No original paid record exists. Cancellation and restoration are not available.';

    return;
  }

  if (pending.length) {
    warning.textContent =
      'A pending UPI request overlaps this month. Review the request before changing payment status.';

    return;
  }

  if (!reasonValid) {
    warning.textContent =
      'Enter a reason of 5–500 characters.';

    return;
  }

  if (correctionBusy) {
    warning.textContent =
      'Saving correction...';

    return;
  }

  warning.textContent =
    'Original payment data will remain unchanged.';

  cancelButton.disabled =
    !PAYMENT_CORRECTION_ENABLED ||
    isCancelled;

  restoreButton.disabled =
    !PAYMENT_CORRECTION_ENABLED ||
    !isCancelled;
}

// CANCEL / RESTORE SAVE

async function correctPaidTick(action) {
  if (
    !PAYMENT_CORRECTION_ENABLED ||
    !isAdmin() ||
    correctionBusy
  ) return;

  if (
    action !== 'cancel' &&
    action !== 'restore'
  ) return;

  const adminUid = current.uid;

  const number = String(
    +$('correctionMemberNumber').value
  );

  const reason =
    $('correctionReason').value.trim();

  let period;

  try {
    period = selectedCorrectionPeriod();

    if (!validNumber(number)) {
      throw Error(
        'Invalid member number.'
      );
    }

    if (
      reason.length < 5 ||
      reason.length > 500
    ) {
      throw Error(
        'Reason must contain 5–500 characters.'
      );
    }

    if (
      !membersLoaded ||
      !adminHistoryLoaded ||
      !adminCorrectionsLoaded ||
      !paymentRequestsLoaded
    ) {
      throw Error(
        'Payment records are not ready.'
      );
    }

    const member = (
      await get(
        ref(db, `members/${number}`)
      )
    ).val();

    if (!member) {
      throw Error(
        'Member not found.'
      );
    }

    const history = (
      await get(
        ref(db, `paymentHistory/${number}`)
      )
    ).val() || {};

    const sources = correctionOriginalSource(
      member,
      history,
      period
    );

    if (!sources.length) {
      throw Error(
        'No original paid record exists for this month.'
      );
    }

    const allRequests = (
      await get(
        ref(db, 'paymentRequests')
      )
    ).val() || {};

    const pending =
      pendingRequestsForPeriod(
        number,
        period,
        allRequests
      );

    if (pending.length) {
      throw Error(
        'A pending UPI request overlaps this month. Resolve it first.'
      );
    }

    const correctionRef = ref(
      db,
      `paymentCorrections/${number}/${period}`
    );

    const oldCorrection = (
      await get(correctionRef)
    ).val();

    const oldState =
      oldCorrection?.state || 'restored';

    const targetState =
      action === 'cancel'
        ? 'cancelled'
        : 'restored';

    if (oldState === targetState) {
      throw Error(
        `This month is already ${targetState}.`
      );
    }

    const message =
      `${action.toUpperCase()} PAID TICK?\n\n` +
      `Member: #${number} — ${member.name}\n` +
      `Month: ${period}\n` +
      `Source: ${sources.join(', ')}\n` +
      `Reason: ${reason}\n\n` +
      `Original payment records will be preserved.\n` +
      `Continue?`;

    if (!confirm(message)) return;

    correctionBusy = true;
    refreshCorrectionPanel();

    const timestamp = Date.now();

    const eventId = push(
      ref(db, 'paymentCorrections')
    ).key;

    if (!eventId) {
      throw Error(
        'Could not create correction event ID.'
      );
    }

    const result = await runTransaction(
      correctionRef,
      existing => {
        const currentState =
          existing?.state || 'restored';

        if (
          currentState === targetState
        ) return;

        return {
          ...(existing || {}),

          state: targetState,

          updatedAt: timestamp,
          updatedBy: adminUid,

          events: {
            ...(existing?.events || {}),

            [eventId]: {
              action,
              reason,
              adminUid,
              at: timestamp
            }
          }
        };
      },
      { applyLocally: false }
    );

    if (!result.committed) {
      throw Error(
        'Correction was already changed. Refresh and check the current status.'
      );
    }

    $('correctionReason').value = '';

    notify(
      `Member #${number} — ${period}: ` +
      `Paid Tick successfully ${targetState}.`
    );

    const freshCorrection = (
      await get(correctionRef)
    ).val();

    adminCorrections[number] = {
      ...(adminCorrections[number] || {}),
      [period]: freshCorrection
    };

    refreshCorrectionPanel();
    renderAdminMembers();

    if (
      selectedAdminMember === number
    ) {
      renderAdminPaymentHistory(number);
    }

    refreshCashMember();

  } catch (e) {
    notify(
      'Payment correction failed: ' +
      e.message,
      true
    );

  } finally {
    correctionBusy = false;
    refreshCorrectionPanel();
  }
}

// INITIALIZE DYNAMIC UI

setupMemberPhoneProfile();
setupCashPayments();
setupPaymentCorrections();

// VERSION 82.0 SUMMARY
//
// 1. Member Google login retained.
// 2. Admin membership approval retained.
// 3. Member profile/mobile editing retained.
// 4. Historical 2024–2027 payments retained.
// 5. Future payment years remain dynamic.
// 6. Member and admin histories use effective paid status.
// 7. Admin Cash Payment Save retained.
// 8. UPI submission and verification retained.
// 9. Admin Cancel Paid Tick added.
// 10. Admin Restore Paid Tick added.
// 11. Correction reason and event history added.
// 12. Original Cash / UPI / PDF records preserved.
// 13. Cancelled months excluded from effective paid totals.
// 14. New payments against cancelled months blocked in UI.
// 15. Archive writes disabled.
// 16. Photo uploads disabled.
//
// SECURITY LIMITATIONS
//
// Correction events are not server-enforced immutable under
// the currently published Firebase Rules.
//
// Concurrent writes across paymentRequests, members,
// paymentHistory and paymentCorrections are not covered by
// a single atomic transaction.
//
// This version must be tested with a test member before
// use on real financial records.
//
// END OF TFC BANDIYOD PORTAL VERSION 82.0

// ============================================================
// TFC BANDIYOD — v88.0 AUTO MONTH PAYMENT UPGRADE
//
// ADD THIS CODE AT THE VERY END OF EXISTING app.js v82.0
//
// Preserves existing login, members, admin, cash,
// correction, archive and history functions.
//
// IMPORTANT: Requires matching Firebase Rules update.
// Do not enable live payments until Rules are updated.
// ============================================================

const AUTO_PAYMENT_MIN = 50;
const AUTO_PAYMENT_MAX = 600;
const AUTO_PAYMENT_FIRST = '2024-01';

let autoMemberRequests = {};
let autoRequestsReady = false;
let autoRequestsError = false;
let autoSubmitting = false;

function autoNextMonth(period) {
  if (!validPeriod(period)) {
    throw Error('Invalid month.');
  }

  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));

  if (year >= 9999 && month === 12) {
    throw Error('Maximum payment year reached.');
  }

  return month === 12
    ? `${year + 1}-01`
    : `${year}-${String(month + 1).padStart(2, '0')}`;
}

function autoFirstMonth(member) {
  const joined = String(
    member?.joiningDate || ''
  ).slice(0, 7);

  if (
    validPeriod(joined) &&
    joined > AUTO_PAYMENT_FIRST
  ) {
    return joined;
  }

  return AUTO_PAYMENT_FIRST;
}

function autoReadAmount() {
  const input = $('autoPaymentAmount');

  const amount = Number(input?.value);

  if (
    !Number.isInteger(amount) ||
    amount < AUTO_PAYMENT_MIN ||
    amount > AUTO_PAYMENT_MAX ||
    amount % MONTHLY_FEE !== 0
  ) {
    throw Error(
      'Enter ₹50–₹600 in multiples of ₹50.'
    );
  }

  return amount;
}

// Support both existing monthly/yearly requests
// and new automatic requests.

function autoRequestMonths(request) {
  if (!request || typeof request !== 'object') {
    throw Error('Invalid payment request.');
  }

  if (request.plan !== 'auto') {
    return paymentMonthKeys(
      request.plan,
      request.period
    );
  }

  const months = request.months;

  if (
    !months ||
    typeof months !== 'object' ||
    Array.isArray(months)
  ) {
    throw Error('Payment month data missing.');
  }

  const periods = Object.keys(months).sort();

  if (
    !periods.length ||
    periods.length > 12 ||
    periods.length !== request.monthCount ||
    request.amount !== periods.length * MONTHLY_FEE ||
    request.period !== periods[0] ||
    periods.some(
      period =>
        !validPeriod(period) ||
        months[period] !== true
    )
  ) {
    throw Error('Invalid automatic payment months.');
  }

  return periods;
}

function autoSelectMonths(
  member,
  history,
  corrections,
  requests,
  memberNo,
  count
) {
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 12
  ) {
    throw Error('Invalid number of months.');
  }

  const paid = new Set(
    originalPaidMonths(member, history)
  );

  const reserved = new Set();

  for (const request of Object.values(requests || {})) {
    if (
      request?.status !== 'pending' ||
      String(request.memberNumber) !==
        String(memberNo)
    ) {
      continue;
    }

    // Fail closed if a pending request is malformed.
    for (const period of autoRequestMonths(request)) {
      reserved.add(period);
    }
  }

  const result = [];
  let period = autoFirstMonth(member);

  for (
    let index = 0;
    index < 1200 && result.length < count;
    index++
  ) {
    const cancelled =
      corrections?.[period]?.state === 'cancelled';

    if (
      !paid.has(period) &&
      !reserved.has(period) &&
      !cancelled
    ) {
      result.push(period);
    }

    period = autoNextMonth(period);
  }

  if (result.length !== count) {
    throw Error(
      'Not enough available payment months.'
    );
  }

  return result;
}

// ------------------------------------------------------------
// MEMBER PAYMENT FORM
// Reuse the existing payment area.
// ------------------------------------------------------------

function setupAutoPaymentForm() {
  if ($('autoPaymentAmount')) return;

  const oldPlan = $('paymentPlan');
  const oldPeriod = $('paymentPeriod');

  const anchor = oldPlan || oldPeriod;

  if (!anchor) {
    notify(
      'Payment form elements not found in index.html.',
      true
    );
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.id = 'autoPaymentControls';

  const title = document.createElement('h3');
  title.textContent = 'Automatic Month Selection';

  const label = document.createElement('label');
  label.htmlFor = 'autoPaymentAmount';
  label.textContent = 'Payment Amount (₹)';

  const input = document.createElement('input');
  input.id = 'autoPaymentAmount';
  input.type = 'number';
  input.min = '50';
  input.max = '600';
  input.step = '50';
  input.value = '50';
  input.inputMode = 'numeric';

  const previewTitle = document.createElement('p');
  previewTitle.textContent = 'Selected Months:';

  const preview = document.createElement('p');
  preview.id = 'autoPaymentMonths';
  preview.textContent = 'Loading payment records...';

  const explanation = document.createElement('p');
  explanation.className = 'muted';
  explanation.textContent =
    '₹50 = 1 month, ₹100 = 2 months, ' +
    '₹300 = 6 months, ₹600 = 12 months. ' +
    'Months are selected automatically.';

  wrapper.append(
    title,
    label,
    input,
    previewTitle,
    preview,
    explanation
  );

  anchor.parentElement.insertBefore(
    wrapper,
    anchor
  );

  // Hide old controls without deleting them.
  // Their existing HTML can be cleaned up later.
  if (oldPlan) {
    oldPlan.style.display = 'none';

    const label = document.querySelector(
      'label[for="paymentPlan"]'
    );

    if (label) label.style.display = 'none';
  }

  if (oldPeriod) {
    oldPeriod.style.display = 'none';

    const label = document.querySelector(
      'label[for="paymentPeriod"]'
    );

    if (label) label.style.display = 'none';
  }

  input.addEventListener(
    'input',
    autoRefreshPreview
  );

  autoRefreshPreview();
}

function autoRefreshPreview() {
  const target = $('autoPaymentMonths');

  if (!target) return;

  try {
    const amount = autoReadAmount();
    const count = amount / MONTHLY_FEE;

    const link = $('upiPayLink');

    if (link) {
      const params = new URLSearchParams({
        pa: UPI_ID,
        pn: UPI_NAME,
        cu: 'INR'
      });

      link.href = `upi://pay?${params}`;
      link.textContent =
        `Open UPI app — Enter ₹${amount}`;
    }

    if ($('displayPaymentAmount')) {
      $('displayPaymentAmount').textContent =
        `₹${amount}`;
    }

    if (
      !current ||
      admin ||
      !memberNumber ||
      !currentMemberData
    ) {
      target.textContent =
        'Member login required.';
      return;
    }

    if (
      !historyLoaded ||
      historyError ||
      !correctionsLoaded ||
      correctionsError ||
      !autoRequestsReady ||
      autoRequestsError
    ) {
      target.textContent =
        'Loading payment records...';
      return;
    }

    const months = autoSelectMonths(
      currentMemberData,
      historicalPayments,
      paymentCorrections,
      autoMemberRequests,
      memberNumber,
      count
    );

    target.textContent =
      months.join(', ');

  } catch (error) {
    target.textContent = error.message;

    if ($('upiPayLink')) {
      $('upiPayLink').removeAttribute('href');
    }
  }
}

// Keep original member rendering and refresh preview.

const originalRenderMemberV82 = renderMember;

renderMember = function(member) {
  originalRenderMemberV82(member);
  autoRefreshPreview();
};

// Keep original payment history rendering.

const originalRenderMyPaymentsV82 =
  renderMyPayments;

renderMyPayments = function(data) {
  autoMemberRequests = data || {};
  autoRequestsReady = true;
  autoRequestsError = false;

  originalRenderMyPaymentsV82(data);

  // Replace the request history table with one that
  // shows all selected months for automatic requests.
  const root = $('myPaymentList');

  if (root) {
    const entries = Object.values(data || {})
      .sort(
        (a, b) =>
          (b.createdAt || 0) -
          (a.createdAt || 0)
      );

    if (entries.length) {
      const table = document.createElement('table');

      table.innerHTML =
        '<thead><tr>' +
        '<th>Months</th>' +
        '<th>Amount</th>' +
        '<th>Status</th>' +
        '</tr></thead>';

      const body = document.createElement('tbody');

      for (const request of entries) {
        const row = document.createElement('tr');

        let monthsText;

        try {
          monthsText =
            autoRequestMonths(request).join(', ');
        } catch (_) {
          monthsText = 'Invalid payment months';
        }

        for (const value of [
          monthsText,
          `₹${request.amount}`,
          request.status || ''
        ]) {
          const cell = document.createElement('td');
          cell.textContent = value;
          row.append(cell);
        }

        body.append(row);
      }

      table.append(body);
      root.replaceChildren(table);
    }
  }

  autoRefreshPreview();
};

// ------------------------------------------------------------
// MEMBER SUBMISSION
// ------------------------------------------------------------

async function autoSubmitPayment() {
  if (
    !PAYMENT_V76_ENABLED ||
    !current ||
    admin ||
    !memberNumber ||
    autoSubmitting ||
    paymentBusy
  ) {
    return;
  }

  const transactionId =
    $('transactionId')?.value.trim() || '';

  if (
    !/^[A-Za-z0-9-]{6,100}$/.test(transactionId)
  ) {
    return notify(
      'Enter a valid UPI transaction reference.',
      true
    );
  }

  if (
    !historyLoaded ||
    historyError ||
    !correctionsLoaded ||
    correctionsError ||
    !autoRequestsReady ||
    autoRequestsError
  ) {
    return notify(
      'Payment records are not ready.',
      true
    );
  }

  let amount;

  try {
    amount = autoReadAmount();
  } catch (error) {
    return notify(error.message, true);
  }

  const buttonElement = $('submitPayment');

  autoSubmitting = true;
  paymentBusy = true;

  buttonElement.disabled = true;

  try {
    const uid = current.uid;
    const number = String(memberNumber);
    const count = amount / MONTHLY_FEE;

    const member = (
      await get(
        ref(db, `members/${number}`)
      )
    ).val();

    if (
      !member ||
      member.status !== 'active' ||
      member.uid !== uid
    ) {
      throw Error('Active membership required.');
    }

    const history = (
      await get(
        ref(db, `paymentHistory/${number}`)
      )
    ).val() || {};

    const corrections = (
      await get(
        ref(db, `paymentCorrections/${number}`)
      )
    ).val() || {};

    const requests = (
      await get(
        query(
          ref(db, 'paymentRequests'),
          orderByChild('uid'),
          equalTo(uid)
        )
      )
    ).val() || {};

    if (
      Object.values(requests).some(request =>
        String(request.transactionId || '')
          .toLowerCase() ===
        transactionId.toLowerCase()
      )
    ) {
      throw Error(
        'Transaction reference already submitted.'
      );
    }

    const months = autoSelectMonths(
      member,
      history,
      corrections,
      requests,
      number,
      count
    );

    const confirmed = confirm(
      `Submit payment for verification?\n\n` +
      `Member: #${number}\n` +
      `Amount: ₹${amount}\n` +
      `Months: ${months.join(', ')}\n` +
      `UPI Ref: ${transactionId}\n\n` +
      `Submit only after completing payment.`
    );

    if (!confirmed) return;

    const monthMap = {};

    for (const period of months) {
      monthMap[period] = true;
    }

    await set(
      push(ref(db, 'paymentRequests')),
      {
        uid,
        memberNumber: Number(number),
        plan: 'auto',
        amount,
        period: months[0],
        monthCount: count,
        months: monthMap,
        transactionId,
        status: 'pending',
        createdAt: Date.now()
      }
    );

    $('transactionId').value = '';

    notify(
      'Payment submitted for admin verification. ' +
      'Paid ticks will appear only after approval.'
    );

  } catch (error) {
    notify(
      'Payment submission failed: ' +
      error.message,
      true
    );

  } finally {
    autoSubmitting = false;
    paymentBusy = false;
    buttonElement.disabled = false;

    autoRefreshPreview();
  }
}

// Replace old submit handler.

if ($('submitPayment')) {
  $('submitPayment').onclick = autoSubmitPayment;
}

// ------------------------------------------------------------
// ADMIN PAYMENT LIST
// ------------------------------------------------------------

renderAdminPayments = function() {
  const root = $('adminPaymentList');

  if (!root) return;

  root.replaceChildren();

  const entries = Object.entries(payments)
    .filter(([, request]) =>
      request?.status === 'pending'
    )
    .sort(
      (a, b) =>
        (a[1].createdAt || 0) -
        (b[1].createdAt || 0)
    );

  if (!entries.length) {
    root.textContent =
      'No pending payment submissions.';
    return;
  }

  for (const [id, request] of entries) {
    const panel = document.createElement('div');
    panel.className = 'panel';

    const info = document.createElement('p');

    let monthsText;

    try {
      monthsText =
        autoRequestMonths(request).join(', ');
    } catch (_) {
      monthsText = 'INVALID MONTHS';
    }

    info.textContent =
      `#${request.memberNumber} — ` +
      `${memberList[request.memberNumber]?.name || ''} | ` +
      `₹${request.amount} | ` +
      `Months: ${monthsText} | ` +
      `UPI Ref: ${request.transactionId}`;

    panel.append(
      info,
      button(
        'Approve after bank verification',
        () => verifyPayment(id, request, true)
      ),
      document.createTextNode(' '),
      button(
        'Reject',
        () => verifyPayment(id, request, false),
        'secondary'
      )
    );

    root.append(panel);
  }
};

// ------------------------------------------------------------
// ADMIN VERIFICATION
// ------------------------------------------------------------

verifyPayment = async function(
  id,
  request,
  accept
) {
  if (
    !isAdmin() ||
    paymentBusy ||
    request.status !== 'pending'
  ) return;

  const confirmed = confirm(
    accept
      ? (
        `BANK VERIFICATION REQUIRED\n\n` +
        `Member: #${request.memberNumber}\n` +
        `Amount: ₹${request.amount}\n` +
        `Transaction: ${request.transactionId}\n\n` +
        `Have you confirmed receipt in the bank?`
      )
      : (
        `Reject payment request for ` +
        `member #${request.memberNumber}?`
      )
  );

  if (!confirmed) return;

  paymentBusy = true;

  try {
    const requestRef = ref(
      db,
      `paymentRequests/${id}`
    );

    const fresh = (
      await get(requestRef)
    ).val();

    if (
      !fresh ||
      fresh.status !== 'pending'
    ) {
      throw Error('Request already reviewed.');
    }

    const number = String(fresh.memberNumber);
    const memberRef = ref(
      db,
      `members/${number}`
    );

    const member = (
      await get(memberRef)
    ).val();

    const recorded =
      recordedMonthsForRequest(member, id);

    if (!accept) {
      if (recorded.length) {
        throw Error(
          'Paid records already exist. ' +
          'Manual reconciliation required.'
        );
      }

      const result = await runTransaction(
        requestRef,
        value => {
          if (
            !value ||
            value.status !== 'pending'
          ) return;

          return {
            ...value,
            status: 'rejected',
            reviewedAt: Date.now(),
            reviewedBy: current.uid
          };
        },
        { applyLocally: false }
      );

      if (!result.committed) {
        throw Error('Request changed.');
      }

      notify('Payment rejected.');
      return;
    }

    const months = autoRequestMonths(fresh);

    if (
      !member ||
      member.status !== 'active' ||
      member.uid !== fresh.uid
    ) {
      throw Error(
        'Member inactive or account mismatch.'
      );
    }

    if (
      fresh.plan === 'auto' &&
      months.some(
        period =>
          period < autoFirstMonth(member)
      )
    ) {
      throw Error(
        'Payment period is before joining month.'
      );
    }

    if (
      fresh.amount !==
      months.length * MONTHLY_FEE
    ) {
      throw Error(
        'Amount does not match payment months.'
      );
    }

    const history = (
      await get(
        ref(db, `paymentHistory/${number}`)
      )
    ).val() || {};

    const corrections = (
      await get(
        ref(db, `paymentCorrections/${number}`)
      )
    ).val() || {};

    if (
      cancelledPeriods(corrections, months).length
    ) {
      throw Error(
        'Cancelled month requires reconciliation.'
      );
    }

    if (recorded.length) {
      if (!samePeriods(recorded, months)) {
        throw Error(
          'Partial payment mismatch. ' +
          'Manual reconciliation required.'
        );
      }

      const recovery = await runTransaction(
        requestRef,
        value => {
          if (
            !value ||
            value.status !== 'pending'
          ) return;

          return {
            ...value,
            status: 'approved',
            reviewedAt: Date.now(),
            reviewedBy: current.uid,
            recovered: true
          };
        },
        { applyLocally: false }
      );

      if (!recovery.committed) {
        throw Error('Recovery failed.');
      }

      notify('Payment record reconciled.');
      return;
    }

    const verifiedAt = Date.now();
    const reviewer = current.uid;

    const result = await runTransaction(
      memberRef,
      value => {
        if (
          !value ||
          value.status !== 'active' ||
          value.uid !== fresh.uid
        ) return;

        const existing = value.payments || {};

        if (
          months.some(period =>
            existing[period] != null ||
            isHistoricalPaid(
              history,
              Number(period.slice(0, 4)),
              Number(period.slice(5, 7))
            )
          )
        ) {
          return;
        }

        const next = {
          ...value,
          payments: {
            ...existing
          }
        };

        for (const period of months) {
          next.payments[period] = {
            status: 'paid',
            amount: MONTHLY_FEE,
            method: 'upi',
            transactionId:
              fresh.transactionId,
            requestId: id,
            verifiedAt,
            verifiedBy: reviewer
          };
        }

        return next;
      },
      { applyLocally: false }
    );

    if (!result.committed) {
      throw Error(
        'Paid month conflict. ' +
        'Check Cash and Historical records.'
      );
    }

    const completed = await runTransaction(
      requestRef,
      value => {
        if (
          !value ||
          value.status !== 'pending'
        ) return;

        return {
          ...value,
          status: 'approved',
          reviewedAt: verifiedAt,
          reviewedBy: reviewer
        };
      },
      { applyLocally: false }
    );

    if (!completed.committed) {
      throw Error(
        'Paid months may be recorded but ' +
        'request status is incomplete. ' +
        'Review the same request again.'
      );
    }

    notify(
      'Payment approved. Paid months recorded.'
    );

  } catch (error) {
    notify(
      'Payment verification needs attention: ' +
      error.message,
      true
    );

  } finally {
    paymentBusy = false;
  }
};

// ------------------------------------------------------------
// ADMIN CASH AND CORRECTION SAFETY
// Check automatic pending requests before cash/correction.
// ------------------------------------------------------------

async function autoCheckPendingOverlap(
  number,
  periods
) {
  const all = (
    await get(ref(db, 'paymentRequests'))
  ).val() || {};

  for (const request of Object.values(all)) {
    if (
      request?.status !== 'pending' ||
      String(request.memberNumber) !==
        String(number)
    ) {
      continue;
    }

    const requested = autoRequestMonths(request);

    if (
      requested.some(
        period => periods.includes(period)
      )
    ) {
      throw Error(
        'Pending UPI request overlaps: ' +
        requested.filter(
          period => periods.includes(period)
        ).join(', ')
      );
    }
  }
}

const originalSaveCashV82 = saveCashPayment;

saveCashPayment = async function() {
  try {
    const number = String(
      Number($('cashMemberNumber')?.value)
    );

    const periods = selectedCashPeriods();

    await autoCheckPendingOverlap(
      number,
      periods
    );

    return await originalSaveCashV82();

  } catch (error) {
    notify(
      'Cash payment blocked: ' +
      error.message,
      true
    );
  }
};

if ($('saveCash')) {
  $('saveCash').onclick = saveCashPayment;
}

const originalCorrectPaidV82 =
  correctPaidTick;

correctPaidTick = async function(action) {
  try {
    const number = String(
      Number($('correctionMemberNumber')?.value)
    );

    const period = selectedCorrectionPeriod();

    await autoCheckPendingOverlap(
      number,
      [period]
    );

    return await originalCorrectPaidV82(action);

  } catch (error) {
    notify(
      'Correction blocked: ' +
      error.message,
      true
    );
  }
};

if ($('cancelPaidTick')) {
  $('cancelPaidTick').onclick =
    () => correctPaidTick('cancel');
}

if ($('restorePaidTick')) {
  $('restorePaidTick').onclick =
    () => correctPaidTick('restore');
}

// ------------------------------------------------------------
// LISTENER AND SESSION REFRESH
// ------------------------------------------------------------

const originalStopListenersV82 = stopListeners;

stopListeners = function() {
  originalStopListenersV82();

  autoMemberRequests = {};
  autoRequestsReady = false;
  autoRequestsError = false;
  autoSubmitting = false;

  autoRefreshPreview();
};

// Rebind member listener after each member login.
// Existing v82 listener already calls renderMyPayments,
// so the wrapped function receives live request updates.

// ------------------------------------------------------------
// INITIALIZE
// ------------------------------------------------------------

setupAutoPaymentForm();

if ($('submitPayment')) {
  $('submitPayment').onclick =
    autoSubmitPayment;
}

autoRefreshPreview();

console.info(
  'TFC Bandiyod v88.0 Auto Payment Upgrade loaded.'
);

// ============================================================
// END OF v88.0 AUTO MONTH PAYMENT UPGRADE
// ============================================================

/*
 TFC BANDIYOD — v88.1
 Automatic Month Preview Fix

 Fix:
 - Refresh selected months when amount changes.
 - Recalculate after member payment data loads.
 - Keep existing admin, cash and correction features.
*/

function initializeAutoPaymentV881() {
  const amountInput = document.getElementById(
    'autoPaymentAmount'
  );

  if (!amountInput) {
    console.error(
      'v88.1: Payment amount input not found.'
    );
    return;
  }

  // Avoid registering the same listener twice.
  if (amountInput.dataset.autoV881 === 'ready') {
    return;
  }

  amountInput.dataset.autoV881 = 'ready';

  amountInput.addEventListener(
    'input',
    () => {
      autoRefreshPreview();
    }
  );

  amountInput.addEventListener(
    'change',
    () => {
      autoRefreshPreview();
    }
  );

  autoRefreshPreview();

  console.info(
    'TFC Bandiyod v88.1 Auto Preview Fix loaded.'
  );
}

initializeAutoPaymentV881();

