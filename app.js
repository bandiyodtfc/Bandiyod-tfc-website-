
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { getDatabase, ref, get, set, update, onValue, push, query, orderByChild, equalTo, runTransaction } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js';
import { firebaseConfig } from './firebase-config.js';

// TFC BANDIYOD PORTAL VERSION 81.0
// Admin Cash Payment Save enabled.
// Cash audit details are stored inside each payment record.
// Archive and photo uploads remain disabled.

const ARCHIVE_WRITE_ENABLED = false;
const CASH_WRITE_ENABLED = true;
const MONTHLY_FEE = 50;
const YEARLY_FEE = 600;
const UPI_ID = 'waheedwahi84-1@oksbi';
const UPI_NAME = 'MOOSA WAHEED M B';
const PAYMENT_V76_ENABLED = true;

const $ = id => document.getElementById(id);

const show = (id, yes) => {
  if ($(id)) $(id).classList.toggle('hide', !yes);
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
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const currentPeriod = () => today().slice(0, 7);

const validPeriod = s =>
  /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s || ''));

const validDate = s => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
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
  +n >= 1 && +n <= 99999;

const active = m => !!m &&
  !['inactive', 'suspended', 'archiving', 'archived']
    .includes(m.status);

const editable = m => !!m &&
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

$('lang').onchange = () =>
  document.querySelectorAll('[data-t]').forEach(el => {
    const t = dict[$('lang').value]?.[el.dataset.t];
    if (t) el.textContent = t;
  });

let auth, db, current = null;
let admin = false;
let memberNumber = null;

let memberList = {};
let payments = {};
let historicalPayments = {};
let currentMemberData = null;

let archivedMembers = {};
let adminHistoryCache = {};
let requestsCache = {};

let historyLoaded = false;
let historyError = false;
let membersLoaded = false;
let adminHistoryLoaded = false;
let paymentRequestsLoaded = false;
let archiveLoaded = false;

let selectedAdminMember = null;

let paymentBusy = false;
let approvalBusy = false;
let archiveBusy = false;
let phoneBusy = false;
let cashBusy = false;

let unsubscribers = [];

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

  historyLoaded = false;
  historyError = false;
  membersLoaded = false;
  adminHistoryLoaded = false;
  paymentRequestsLoaded = false;
  archiveLoaded = false;

  selectedAdminMember = null;

  paymentBusy = false;
  approvalBusy = false;
  archiveBusy = false;
  phoneBusy = false;
  cashBusy = false;

  show('memberPhonePanel', false);
  show('cashPanel', false);
}

// PAYMENT HISTORY HELPERS

function isHistoricalPaid(history, year, month) {
  if (year < 2024) return false;

  const v = history?.months?.[String(year)]?.[
    String(month).padStart(2, '0')
  ];

  return v === 'marked_paid' ||
    (v && typeof v === 'object' &&
      ['marked_paid', 'paid'].includes(v.status));
}

function paidMonths(member, history) {
  const out = new Set();

  for (const year of Object.keys(history?.months || {})) {
    if (!/^\d{4}$/.test(year)) continue;

    for (let m = 1; m <= 12; m++) {
      if (isHistoricalPaid(history, +year, m)) {
        out.add(`${year}-${String(m).padStart(2, '0')}`);
      }
    }
  }

  for (const [p, r] of Object.entries(member?.payments || {})) {
    if (validPeriod(p) && r?.status === 'paid') {
      out.add(p);
    }
  }

  return [...out].sort();
}

function historyPeriods(member, paid, yearFilter = 'all') {
  let first = member?.joiningDate?.slice(0, 7) || '2024-01';

  if (!validPeriod(first)) first = '2024-01';
  if (paid[0] && paid[0] < first) first = paid[0];

  const last =
    paid.length && paid[paid.length - 1] > currentPeriod()
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
      const p = `${y}-${String(m).padStart(2, '0')}`;

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
      result.push(`${yearFilter}-${String(m).padStart(2, '0')}`);
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
    first = Math.min(first, +paid[0].slice(0, 4));
  }

  const end = Math.max(
    new Date().getFullYear() + 5,
    2028,
    ...paid.map(p => +p.slice(0, 4))
  );

  select.replaceChildren(new Option('All Years', 'all'));

  for (let y = first; y <= end; y++) {
    select.add(new Option(String(y), String(y)));
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
  year = 'all'
) {
  const paid = paidMonths(member, history);
  const paidSet = new Set(paid);

  const table = document.createElement('table');

  table.innerHTML =
    '<thead><tr><th>Month</th><th>Status</th></tr></thead>';

  const body = document.createElement('tbody');

  for (const p of historyPeriods(member, paid, year)) {
    const row = document.createElement('tr');
    const a = document.createElement('td');
    const b = document.createElement('td');

    a.textContent = p;
    b.textContent = paidSet.has(p) ? 'Paid' : 'Not verified';
    b.className = paidSet.has(p)
      ? 'history-paid'
      : 'history-unverified';

    row.append(a, b);
    body.append(row);
  }

  table.append(body);
  $(target)?.replaceChildren(table);

  return paid.filter(p =>
    year === 'all' || p.startsWith(year + '-')
  ).length;
}

// FIREBASE INITIALIZATION

$('paymentPeriod').value = currentPeriod();
$('newMemberDate').value = today();

if (
  !firebaseConfig.databaseURL ||
  firebaseConfig.databaseURL.startsWith('REPLACE_')
) {
  notify('Firebase configuration missing.', true);
  $('signIn').disabled = true;
} else {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getDatabase(app);

  onAuthStateChanged(auth, handleAuthChange);
}

// AUTHENTICATION

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
    const a = await get(ref(db, `admins/${user.uid}`));

    if (auth.currentUser?.uid !== user.uid) return;

    admin = a.val() === true;

    if (admin) {
      show('admin', true);
      tab('requests');
      loadAdmin();
      return;
    }

    const u = (
      await get(ref(db, `users/${user.uid}`))
    ).val();

    if (u?.status === 'approved' && u.memberNumber) {
      const number = String(u.memberNumber);

      const m = (
        await get(ref(db, `members/${number}`))
      ).val();

      if (auth.currentUser?.uid !== user.uid) return;

      if (active(m) && m.uid === user.uid) {
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
    $('claimNumber').value = u?.requestedNumber || '';

  } catch (e) {
    notify('Database error: ' + e.message, true);
  }
}

$('signIn').onclick = async () => {
  try {
    await signInWithPopup(
      auth,
      new GoogleAuthProvider()
    );
  } catch (e) {
    notify('Login error: ' + e.message, true);
  }
};

$('logout').onclick = () => signOut(auth);

// MEMBER APPROVAL REQUEST

$('requestApproval').onclick = async () => {
  if (!current || admin) return;

  const number = +$('claimNumber').value;

  if (!validNumber(number)) {
    return notify('Enter valid member number.', true);
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

          notify('Membership access is not active.', true);
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
          'Historical payment error: ' + e.message,
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
      snap => renderMyPayments(snap.val() || {}),
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
      const oldPhone = String(currentMemberData.phone || '');

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

      if (!confirm(`Save mobile number ${phone}?`)) return;

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
          await get(ref(db, `members/${number}`))
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

        notify('Mobile number updated successfully.');

      } catch (e) {
        notify(
          'Mobile update failed: ' + e.message,
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

  panel.append(title, numberText, editButton);
  meta.insertAdjacentElement('afterend', panel);

  show('memberPhonePanel', false);
}

function refreshMemberPhoneProfile(member) {
  setupMemberPhoneProfile();

  const display = $('memberPhoneDisplay');
  const editButton = $('editMemberOwnPhone');

  if (!display || !member) return;

  const phone = String(member.phone || '').trim();

  display.textContent = phone || 'Not Added';

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

  $('memberTitle').textContent = m.name || 'Member';

  $('memberMeta').textContent =
    'Member #' + (m.number || memberNumber);

  refreshMemberPhoneProfile(m);

  const paid = paidMonths(m, historicalPayments);
  const setPaid = new Set(paid);

  fillYears(
    'memberHistoryYear',
    m,
    historicalPayments
  );

  const year = $('memberHistoryYear')?.value || 'all';

  $('historyBody').innerHTML =
    historyPeriods(m, paid, year).map(p => {
      const y = +p.slice(0, 4);

      const status = setPaid.has(p)
        ? 'Paid'
        : !historyLoaded && y <= 2027
          ? 'Loading'
          : historyError && y <= 2027
            ? 'History unavailable'
            : 'Not verified';

      return `<tr><td>${safe(p)}</td><td class="${setPaid.has(p) ? 'history-paid' : 'history-unverified'}">${safe(status)}</td></tr>`;
    }).join('');

  $('paidCount').textContent =
    !historyLoaded
      ? 'Loading'
      : historyError
        ? 'Unavailable'
        : String(paid.length);

  $('dueAmount').textContent = 'Not verified';
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
        renderApprovalRequests(requestsCache);
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
          renderAdminPaymentHistory(selectedAdminMember);
        }

        updateArchiveButton();
        refreshCashMember();
      },
      e => {
        membersLoaded = false;
        notify(e.message, true);
        updateArchiveButton();
        refreshCashMember();
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
      },
      e => {
        paymentRequestsLoaded = false;
        notify(e.message, true);
        updateArchiveButton();
        refreshCashMember();
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
          renderAdminPaymentHistory(selectedAdminMember);
        }

        updateArchiveButton();
        refreshCashMember();
      },
      e => {
        adminHistoryLoaded = false;
        notify(e.message, true);
        updateArchiveButton();
        refreshCashMember();
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

  for (const [uid, r] of Object.entries(data || {})) {
    if (r?.status !== 'pending') continue;

    count++;

    const box = document.createElement('div');
    box.className = 'panel';

    const info = document.createElement('p');

    info.textContent =
      `${r.name || 'Unknown'} (${r.email || ''}) — Requested #${r.requestedNumber}`;

    const m = memberList[String(r.requestedNumber)];

    const detail = document.createElement('p');

    detail.textContent = !membersLoaded
      ? 'Loading member record...'
      : m
        ? `Member record: ${m.name || 'Unknown'} | Status: ${m.status || 'active'} | ${m.uid ? 'Already linked' : 'Not linked'}`
        : 'Requested membership number not found.';

    const approveBtn = button(
      'Approve',
      () => approve(uid, r, r.requestedNumber)
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
          notify('Invalid membership number.', true);
          return;
        }

        approve(uid, r, Number(number));
      },
      'secondary'
    );

    const rejectBtn = button(
      'Reject',
      () => rejectApproval(uid, r),
      'danger'
    );

    approveBtn.disabled = !membersLoaded || approvalBusy;
    changeBtn.disabled = !membersLoaded || approvalBusy;
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
    root.textContent = 'No pending approval requests.';
  }
}

async function approve(uid, request, selectedNumber) {
  if (!isAdmin() || approvalBusy) return;

  const number = String(selectedNumber);

  if (!validNumber(number)) {
    return notify('Invalid member number.', true);
  }

  approvalBusy = true;
  renderApprovalRequests(requestsCache);

  try {
    const fresh = (
      await get(ref(db, `requests/${uid}`))
    ).val();

    if (
      !fresh ||
      fresh.status !== 'pending' ||
      fresh.uid !== uid ||
      String(fresh.requestedNumber) !==
        String(request.requestedNumber)
    ) {
      throw Error('Approval request changed.');
    }

    const member = (
      await get(ref(db, `members/${number}`))
    ).val();

    if (!active(member)) {
      throw Error(
        'Member is inactive or does not exist.'
      );
    }

    if (member.uid && member.uid !== uid) {
      throw Error(
        'Member already linked to another Gmail.'
      );
    }

    const existingUser = (
      await get(ref(db, `users/${uid}`))
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
      [`requests/${uid}/approvedNumber`]: Number(number),
      [`requests/${uid}/reviewedAt`]: Date.now(),
      [`requests/${uid}/reviewedBy`]: current.uid
    });

    notify(`Member #${number} approved successfully.`);

  } catch (e) {
    notify('Approval failed: ' + e.message, true);

  } finally {
    approvalBusy = false;
    renderApprovalRequests(requestsCache);
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
    const requestRef = ref(db, `requests/${uid}`);

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

    notify('Approval request rejected.');

  } catch (e) {
    notify('Reject failed: ' + e.message, true);

  } finally {
    approvalBusy = false;
    renderApprovalRequests(requestsCache);
  }
}

// ADMIN MEMBER MANAGEMENT

function renderAdminMembers() {
  const root = $('membersList');
  if (!root) return;

  root.replaceChildren();

  const search = ($('search').value || '').toLowerCase();

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
    '<thead><tr><th>#</th><th>Name</th><th>Mobile</th><th>Login</th><th>Status</th><th>Paid Months</th><th>Paid Amount</th><th>Actions</th></tr></thead>';

  const body = document.createElement('tbody');

  for (const [number, m] of entries) {
    const row = document.createElement('tr');

    const paid = adminHistoryLoaded
      ? paidMonths(m, adminHistoryCache[number] || {})
      : [];

    for (const v of [
      number,
      m?.name || '',
      m?.phone || 'Not Added',
      m?.uid ? 'Linked' : 'Not linked',
      m?.status || 'active',
      adminHistoryLoaded ? String(paid.length) : 'Loading',
      adminHistoryLoaded
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

    h.disabled = !adminHistoryLoaded;

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
  if (!isAdmin() || !adminHistoryLoaded) return;

  const m = memberList[String(number)];
  if (!m) return;

  selectedAdminMember = String(number);

  const history = adminHistoryCache[String(number)] || {};

  $('adminHistoryTitle').textContent =
    `#${number} — ${m.name || 'Member'}`;

  fillYears('adminHistoryYear', m, history);

  const year = $('adminHistoryYear').value;

  const count = renderHistoryTable(
    m,
    history,
    'adminHistoryTable',
    year
  );

  $('adminHistorySummary').textContent =
    `Paid months: ${count} | Recorded paid amount: ₹${count * MONTHLY_FEE}`;

  show('adminMemberHistory', true);
}

$('adminHistoryYear').onchange = () => {
  if (selectedAdminMember !== null) {
    renderAdminPaymentHistory(selectedAdminMember);
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
    'cash'
  ]) {
    show(`${name}Panel`, name === which);
  }
}

$('tabRequests').onclick = () => tab('requests');
$('tabMembers').onclick = () => tab('members');
$('tabPayments').onclick = () => tab('payments');
$('tabAddMember').onclick = () => tab('addMember');

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
    ($('photoMemberSearch')?.value || '').toLowerCase();

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

$('photoMemberSearch').oninput = renderPhotoMembers;

// ADD MEMBER

$('addMemberForm').onsubmit = async event => {
  event.preventDefault();

  if (!isAdmin()) {
    return notify('Admin access required.', true);
  }

  const number = +$('newMemberNumber').value;
  const name = $('newMemberName').value.trim();
  const phone = $('newMemberPhone').value.trim();
  const joiningDate = $('newMemberDate').value;
  const status = $('newMemberStatus').value;

  if (
    !validNumber(number) ||
    !name ||
    name.length > 100 ||
    !validPhone(phone) ||
    !validDate(joiningDate) ||
    !['active', 'inactive'].includes(status)
  ) {
    return notify('Check member details.', true);
  }

  const b = $('saveNewMember');
  b.disabled = true;

  try {
    if (
      (
        await get(ref(db, `archivedMembers/${number}`))
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
      throw Error('Member number already exists.');
    }

    $('addMemberForm').reset();
    $('newMemberDate').value = today();

    notify(`Member #${number} added successfully.`);
    tab('members');

  } catch (e) {
    notify('Save failed: ' + e.message, true);

  } finally {
    b.disabled = false;
  }
};

// EDIT MEMBER — ADMIN

function openEditMember(number) {
  if (!isAdmin()) return;

  const m = memberList[String(number)];

  if (!editable(m)) {
    return notify('Member cannot be edited.', true);
  }

  show('archiveMemberPanel', false);
  show('adminMemberHistory', false);

  $('editMemberNumber').value = number;
  $('editMemberName').value = m.name || '';
  $('editMemberPhone').value = m.phone || '';
  $('editMemberDate').value = m.joiningDate || today();

  $('editMemberStatus').value =
    m.status === 'inactive' ? 'inactive' : 'active';

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
    return notify('Admin access required.', true);
  }

  const number = String($('editMemberNumber').value);
  const name = $('editMemberName').value.trim();
  const phone = $('editMemberPhone').value.trim();
  const joiningDate = $('editMemberDate').value;
  const status = $('editMemberStatus').value;

  if (
    !name ||
    name.length > 100 ||
    !validPhone(phone) ||
    !validDate(joiningDate) ||
    !['active', 'inactive'].includes(status)
  ) {
    return notify('Check member details.', true);
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
      throw Error('Member changed or archived.');
    }

    show('editMemberPanel', false);

    notify(`Member #${number} updated successfully.`);

  } catch (e) {
    notify('Edit failed: ' + e.message, true);

  } finally {
    b.disabled = false;
  }
};

// ARCHIVE — READ ONLY

function openArchiveMember(number) {
  if (!isAdmin()) return;

  const m = memberList[String(number)];

  if (!editable(m)) {
    return notify('Member cannot be archived.', true);
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

function findPartialPaymentRequests(number, m, requests) {
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

  const reason = $('archiveMemberReason').value;

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
    return notify('Check archive details.', true);
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
    const m = (
      await get(ref(db, `members/${number}`))
    ).val();

    if (!editable(m)) {
      throw Error(
        'Member missing, archived or locked.'
      );
    }

    const history = (
      await get(ref(db, `paymentHistory/${number}`))
    ).val() || {};

    const requests = (
      await get(ref(db, 'paymentRequests'))
    ).val() || {};

    const unresolved = unresolvedRequests(number, requests);

    if (unresolved.length) {
      throw Error(
        `${unresolved.length} unresolved payment request(s).`
      );
    }

    if (
      findPartialPaymentRequests(number, m, requests).length
    ) {
      throw Error(
        'Partial payment approval detected.'
      );
    }

    if (
      (
        await get(ref(db, `archivedMembers/${number}`))
      ).exists()
    ) {
      throw Error('Archive record already exists.');
    }

    const count = paidMonths(m, history).length;

    if (!ARCHIVE_WRITE_ENABLED) {
      notify(
        `Archive pre-check passed for #${number}: ${count} paid months. Final Archive remains LOCKED.`
      );
      return;
    }

    throw Error(
      'Final Archive requires a secure server-side workflow.'
    );

  } catch (e) {
    notify('Archive stopped: ' + e.message, true);

  } finally {
    archiveBusy = false;
    updateArchiveButton();
  }
}

$('archiveMemberForm').onsubmit = archiveMemberSafely;

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
    ($('archivedMembersSearch').value || '').toLowerCase();

  const entries = Object.entries(archivedMembers)
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
    root.textContent = 'No archived members found.';
    return;
  }

  const table = document.createElement('table');

  table.innerHTML =
    '<thead><tr><th>Old #</th><th>Name</th><th>Reason</th><th>Archived Date</th><th>History</th></tr></thead>';

  const body = document.createElement('tbody');

  for (const [id, r] of entries) {
    const row = document.createElement('tr');

    for (const v of [
      r.originalNumber,
      r.member?.name || '',
      r.reason || '',
      r.archivedAt
        ? new Date(r.archivedAt).toLocaleDateString('en-IN')
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
    `#${r.originalNumber} — ${m.name || 'Former Member'}`;

  const count = renderHistoryTable(
    m,
    history,
    'archivedHistoryTable'
  );

  $('archivedHistorySummary').textContent =
    `Paid months: ${count} | Recorded paid amount: ₹${count * MONTHLY_FEE} | Reason: ${r.reason || 'Not specified'} | Member number reserved`;

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

  if (plan === 'monthly') return [period];

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

  if (!current || !memberNumber || admin) {
    return notify('Member login required.', true);
  }

  if (paymentBusy) return;

  const { plan, amount, period } = planDetails();

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

  if (!historyLoaded || historyError) {
    return notify(
      'Payment history not ready.',
      true
    );
  }

  if (!confirm(
    `Submit ₹${amount} for ${plan === 'yearly' ? period.slice(0, 4) : period} as Pending? Submit only after paying.`
  )) return;

  paymentBusy = true;

  const b = $('submitPayment');
  b.disabled = true;

  try {
    const m = (
      await get(ref(db, `members/${memberNumber}`))
    ).val();

    if (
      !active(m) ||
      m.status !== 'active' ||
      m.uid !== current.uid
    ) {
      throw Error(
        'Membership must have active status.'
      );
    }

    const history = (
      await get(ref(db, `paymentHistory/${memberNumber}`))
    ).val() || {};

    const paid = new Set(paidMonths(m, history));

    const keys = paymentMonthKeys(plan, period);

    if (keys.some(p => paid.has(p))) {
      throw Error(
        'One or more selected months are already paid. Contact admin.'
      );
    }

    const existing = (
      await get(
        query(
          ref(db, 'paymentRequests'),
          orderByChild('uid'),
          equalTo(current.uid)
        )
      )
    ).val() || {};

    if (
      Object.values(existing).some(r =>
        String(r.transactionId || '').toLowerCase() ===
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
          String(r.memberNumber) !==
            String(memberNumber)
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

    const requestRef = push(ref(db, 'paymentRequests'));

    await set(requestRef, {
      uid: current.uid,
      memberNumber: Number(memberNumber),
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
    notify('Submission failed: ' + e.message, true);

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
    .filter(([, r]) => r.status === 'pending')
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
      `#${r.memberNumber} — ${memberList[r.memberNumber]?.name || ''} | ₹${r.amount} | ${r.plan} ${r.period} | UPI Ref: ${r.transactionId}`;

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
  return a.length === b.length &&
    [...a].sort().every(
      (p, i) => p === [...b].sort()[i]
    );
}

// ADMIN PAYMENT VERIFICATION

async function verifyPayment(id, request, accept) {
  if (
    !isAdmin() ||
    request.status !== 'pending' ||
    paymentBusy
  ) return;

  if (!confirm(
    accept
      ? `Have you verified ₹${request.amount} in the bank statement? Approve #${request.memberNumber}, ${request.period}?`
      : `Reject payment request for #${request.memberNumber}?`
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

    if (!fresh || fresh.status !== 'pending') {
      throw Error('Request is no longer pending.');
    }

    const number = String(fresh.memberNumber);
    const memberRef = ref(db, `members/${number}`);

    const m = (
      await get(memberRef)
    ).val();

    if (!accept) {
      if (recordedMonthsForRequest(m, id).length) {
        throw Error(
          'Payment already recorded. Manual reconciliation required.'
        );
      }

      const result = await runTransaction(
        requestRef,
        r => {
          if (!r || r.status !== 'pending') return;

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
        throw Error('Request already reviewed.');
      }

      notify('Payment rejected.');
      return;
    }

    if (
      !['monthly', 'yearly'].includes(fresh.plan) ||
      fresh.amount !== (
        fresh.plan === 'yearly'
          ? YEARLY_FEE
          : MONTHLY_FEE
      )
    ) {
      throw Error('Invalid payment amount or plan.');
    }

    const keys = paymentMonthKeys(
      fresh.plan,
      fresh.period
    );

    if (!active(m) || m.uid !== fresh.uid) {
      throw Error(
        'Member inactive or account mismatch.'
      );
    }

    const recorded = recordedMonthsForRequest(m, id);

    if (recorded.length) {
      if (!samePeriods(recorded, keys)) {
        throw Error(
          'Partial payment records do not match. Manual reconciliation required.'
        );
      }

      const recovery = await runTransaction(
        requestRef,
        r => {
          if (!r || r.status !== 'pending') return;

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
        throw Error('Recovery status changed.');
      }

      notify('Existing paid months reconciled.');
      return;
    }

    const history = (
      await get(ref(db, `paymentHistory/${number}`))
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
            member.payments?.[key]?.status === 'paid' ||
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
      throw Error(
        'Payment not recorded. Check existing paid months.'
      );
    }

    try {
      const done = await runTransaction(
        requestRef,
        r => {
          if (!r || r.status !== 'pending') return;

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
        throw Error('Request status changed.');
      }

    } catch (e) {
      throw Error(
        'Paid months may be recorded but request status was not completed. Review the same request. ' +
        e.message
      );
    }

    notify('Payment approved and recorded.');

  } catch (e) {
    notify(
      'Payment review needs attention: ' + e.message,
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
    `<table><thead><tr><th>Period</th><th>Amount</th><th>Status</th></tr></thead><tbody>${
      entries.map(r =>
        `<tr><td>${safe(r.period)} (${safe(r.plan)})</td><td>₹${Number(r.amount) || 0}</td><td>${safe(r.status)}</td></tr>`
      ).join('')
    }</tbody></table>`;
}

// VERSION 81.0 — ADMIN CASH PAYMENT

function setupCashPayments() {
  const tabs = $('tabMembers')?.parentElement;
  const adminSection = $('admin');

  if (!tabs || !adminSection || $('tabCash')) return;

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

  $('cashYear').value = new Date().getFullYear();
  $('cashDate').value = today();

  const monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr',
    'May', 'Jun', 'Jul', 'Aug',
    'Sep', 'Oct', 'Nov', 'Dec'
  ];

  monthNames.forEach((name, index) => {
    const label = document.createElement('label');
    label.className = 'flex';

    const checkbox = document.createElement('input');
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
    checkbox.onchange = refreshCashMember;
  });

  $('cashMemberNumber').oninput = refreshCashMember;
  $('cashYear').oninput = refreshCashMember;
  $('cashPlan').onchange = refreshCashMember;
  $('saveCash').onclick = saveCashPayment;
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
  const year = String($('cashYear').value);
  const plan = $('cashPlan').value;

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
    throw Error('Invalid payment plan.');
  }

  return [
    ...document.querySelectorAll('.cash-month:checked')
  ].map(el => `${year}-${el.value}`).sort();
}

// DUPLICATE PAYMENT WARNING PRIORITY

function refreshCashMember() {
  if (!$('cashPanel')) return;

  const number = String(+$('cashMemberNumber').value);
  const member = memberList[number];

  $('cashMemberInfo').textContent = member
    ? `#${number} — ${member.name || 'Member'} (${member.status || 'active'})`
    : 'Select an existing member.';

  const yearly = $('cashPlan').value === 'yearly';

  show('cashMonthsBox', !yearly);

  let keys = [];
  let periodError = '';

  try {
    keys = selectedCashPeriods();
  } catch (e) {
    periodError = e.message;
  }

  const amount = keys.length * MONTHLY_FEE;

  $('cashTotal').textContent =
    `Total: ₹${amount}`;

  const history = adminHistoryCache[number] || {};
  const paid = new Set(paidMonths(member, history));

  const duplicates = keys.filter(k => paid.has(k));

  const pending = Object.values(payments).some(r => {
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

  $('cashWarning').textContent =
    periodError
      ? periodError
      : !membersLoaded ||
        !adminHistoryLoaded ||
        !paymentRequestsLoaded
        ? 'Loading payment records. Please wait.'
        : duplicates.length
          ? `Already Paid: ${duplicates.join(', ')}`
          : pending
            ? 'A pending UPI request overlaps these months.'
            : !CASH_WRITE_ENABLED
              ? 'Cash saving is locked.'
              : 'Ready to record cash payment. Verify cash was received before saving.';

  $('saveCash').disabled =
    !CASH_WRITE_ENABLED ||
    cashBusy ||
    !isAdmin() ||
    !membersLoaded ||
    !adminHistoryLoaded ||
    !paymentRequestsLoaded ||
    !member ||
    !active(member) ||
    !keys.length ||
    !!periodError ||
    !!duplicates.length ||
    pending;
}

// VERSION 81.0 — CASH PAYMENT SAVE

async function saveCashPayment() {
  if (!CASH_WRITE_ENABLED || !isAdmin() || cashBusy) return;

  const adminUid = current.uid;
  const number = String(+$('cashMemberNumber').value);
  const plan = $('cashPlan').value;
  const receivedDate = $('cashDate').value;

  try {
    const keys = selectedCashPeriods();

    if (!validNumber(number) || !keys.length) {
      throw Error('Select a valid member and month.');
    }

    if (!validDate(receivedDate)) {
      throw Error('Invalid cash received date.');
    }

    if (
      !membersLoaded ||
      !adminHistoryLoaded ||
      !paymentRequestsLoaded
    ) {
      throw Error('Wait for database loading.');
    }

    const memberRef = ref(db, `members/${number}`);

    const freshMember = (await get(memberRef)).val();

    if (!freshMember || freshMember.status !== 'active') {
      throw Error('Active member required.');
    }

    const history = (
      await get(ref(db, `paymentHistory/${number}`))
    ).val() || {};

    const paid = new Set(paidMonths(freshMember, history));

    if (keys.some(k => paid.has(k))) {
      throw Error('Already Paid month selected.');
    }

    const requests = (
      await get(ref(db, 'paymentRequests'))
    ).val() || {};

    const overlaps = Object.values(requests).some(r => {
      if (
        r?.status !== 'pending' ||
        String(r.memberNumber) !== number
      ) return false;

      try {
        return paymentMonthKeys(r.plan, r.period)
          .some(k => keys.includes(k));
      } catch {
        return true;
      }
    });

    if (overlaps) {
      throw Error(
        'Pending UPI request overlaps these months.'
      );
    }

    const amount = keys.length * MONTHLY_FEE;

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
        if (!member || member.status !== 'active') return;

        const existing = member.payments || {};

        if (keys.some(k =>
          existing[k] != null ||
          isHistoricalPaid(
            history,
            +k.slice(0, 4),
            +k.slice(5, 7)
          )
        )) return;

        const next = {
          ...member,
          payments: { ...existing }
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
              action: 'cash_payment_recorded',
              recordedBy: adminUid,
              recordedAt,
              memberNumber: Number(number),
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
      `Cash payment saved successfully: Member #${number}, ₹${amount}.`
    );

    document.querySelectorAll('.cash-month')
      .forEach(el => {
        el.checked = false;
      });

  } catch (e) {
    notify(
      'Cash payment failed: ' + e.message,
      true
    );

  } finally {
    cashBusy = false;
    refreshCashMember();
  }
}

// INITIALIZE DYNAMIC UI

setupMemberPhoneProfile();
setupCashPayments();

// Existing 2024–2027 historical data is not overwritten.
// Archive writes disabled.
// Photo uploads disabled.
// Cash payments are recorded with embedded audit details.
// Separate cashAudit records are not created.
// Cross-path concurrent UPI and historical changes are not
// transactionally locked; production reconciliation is required.

// END OF TFC BANDIYOD PORTAL VERSION 81.0
