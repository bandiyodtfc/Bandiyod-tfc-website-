
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';

import {
  getAuth, GoogleAuthProvider, signInWithPopup,
  onAuthStateChanged, signOut
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';

import {
  getDatabase, ref, get, set, update, onValue,
  push, query, orderByChild, equalTo, runTransaction
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js';

import { firebaseConfig } from './firebase-config.js';

const $ = id => document.getElementById(id);

const show = (id, yes) => {
  const el = $(id);
  if (el) el.classList.toggle('hide', !yes);
};

const escapeHTML = value =>
  String(value ?? '').replace(
    /[&<>"']/g,
    c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c])
  );

const notify = (message, error = false) => {
  $('msg').textContent = message;
  $('msg').className = error ? 'error' : 'ok';
};

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

$('lang').onchange = () => {
  document.querySelectorAll('[data-t]').forEach(e => {
    e.textContent =
      dict[$('lang').value]?.[e.dataset.t] ??
      e.textContent;
  });
};

let auth, db, current;
let admin = false;
let memberList = {};
let memberNumber = null;
let payments = {};
let unsubscribers = [];

let historicalPayments = {};
let currentMemberData = null;
let historyLoaded = false;
let historyError = false;

let adminHistoryCache = {};
let adminHistoryLoaded = false;
let selectedAdminMember = null;

let archivedMembers = {};
let selectedArchiveId = null;
let paymentRequestsLoaded = false;
let membersLoaded = false;
let archiveLoaded = false;
let archiveBusy = false;

const stopListeners = () => {
  unsubscribers.forEach(f => f());
  unsubscribers = [];

  payments = {};
  historicalPayments = {};
  currentMemberData = null;
  historyLoaded = false;
  historyError = false;

  adminHistoryCache = {};
  adminHistoryLoaded = false;
  selectedAdminMember = null;

  memberList = {};
  archivedMembers = {};
  selectedArchiveId = null;

  paymentRequestsLoaded = false;
  membersLoaded = false;
  archiveLoaded = false;
  archiveBusy = false;
};

const isAdmin = () => !!current && admin;

function localDateString() {
  const d = new Date();

  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0')
  ].join('-');
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const d = new Date(value + 'T00:00:00');

  return !Number.isNaN(d.getTime()) &&
    d.getFullYear() === Number(value.slice(0, 4)) &&
    d.getMonth() + 1 === Number(value.slice(5, 7)) &&
    d.getDate() === Number(value.slice(8, 10));
}

function validPhone(value) {
  return !value ||
    /^[0-9+\s()-]{7,15}$/.test(value);
}

function isActiveMember(m) {
  return !!m &&
    !['inactive', 'suspended', 'archived']
      .includes(m.status);
}

$('paymentPeriod').value =
  `${new Date().getFullYear()}-${String(
    new Date().getMonth() + 1
  ).padStart(2, '0')}`;

$('newMemberDate').value = localDateString();

function isHistoricalPaid(history, year, month) {
  if (year < 2024) return false;

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

function collectPaidMonths(member, oldHistory) {
  const paid = new Set();

  for (const year of Object.keys(
    oldHistory?.months || {}
  )) {
    if (!/^\d{4}$/.test(year)) continue;

    for (let m = 1; m <= 12; m++) {
      if (isHistoricalPaid(oldHistory, Number(year), m)) {
        paid.add(
          `${year}-${String(m).padStart(2, '0')}`
        );
      }
    }
  }

  for (const [period, record] of Object.entries(
    member?.payments || {}
  )) {
    if (record?.status === 'paid') {
      paid.add(period);
    }
  }

  return [...paid].sort();
}

function historyPeriods(member, paidMonths) {
  const now = new Date();

  const last =
    `${now.getFullYear()}-${String(
      now.getMonth() + 1
    ).padStart(2, '0')}`;

  let first =
    member?.joiningDate?.slice(0, 7) || '2024-01';

  if (paidMonths[0] && paidMonths[0] < first) {
    first = paidMonths[0];
  }

  if (first > last) return [];

  const result = [];
  const startYear = Number(first.slice(0, 4));

  for (
    let year = startYear;
    year <= now.getFullYear();
    year++
  ) {
    for (let month = 1; month <= 12; month++) {
      const p =
        `${year}-${String(month).padStart(2, '0')}`;

      if (p >= first && p <= last) {
        result.push(p);
      }
    }
  }

  return result;
}

// FIREBASE INITIALIZATION

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

  onAuthStateChanged(auth, async user => {
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
      admin = (
        await get(ref(db, `admins/${user.uid}`))
      ).val() === true;

      if (admin) {
        show('admin', true);
        loadAdmin();
        return;
      }

      const record = (
        await get(ref(db, `users/${user.uid}`))
      ).val();

      if (
        record?.status === 'approved' &&
        record.memberNumber
      ) {
        const number = String(record.memberNumber);

        const member = (
          await get(ref(db, `members/${number}`))
        ).val();

        if (
          isActiveMember(member) &&
          member.uid === user.uid
        ) {
          memberNumber = Number(number);
          currentMemberData = member;

          show('member', true);
          renderMember(member);

          unsubscribers.push(
            onValue(
              ref(db, `members/${number}`),
              s => {
                const updated = s.val();

                if (
                  !isActiveMember(updated) ||
                  updated.uid !== user.uid
                ) {
                  show('member', false);
                  show('pending', true);

                  notify(
                    'Membership access is not active.',
                    true
                  );
                  return;
                }

                currentMemberData = updated;
                renderMember(updated);
              },
              e => notify(e.message, true)
            )
          );

          unsubscribers.push(
            onValue(
              ref(db, `paymentHistory/${number}`),
              s => {
                historicalPayments = s.val() || {};
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

          unsubscribers.push(
            onValue(
              query(
                ref(db, 'paymentRequests'),
                orderByChild('uid'),
                equalTo(user.uid)
              ),
              s => renderMyPayments(s.val() || {}),
              e => notify(e.message, true)
            )
          );

          updateUpiLink();
          return;
        }
      }

      show('pending', true);

      $('claimNumber').value =
        record?.requestedNumber || '';

    } catch (e) {
      notify('Database error: ' + e.message, true);
    }
  });
}

// LOGIN AND APPROVAL

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

$('requestApproval').onclick = async () => {
  const n = Number($('claimNumber').value);

  if (!Number.isSafeInteger(n) || n < 1) {
    return notify('Enter valid member number', true);
  }

  try {
    await set(ref(db, `requests/${current.uid}`), {
      uid: current.uid,
      email: current.email || '',
      name: current.displayName || '',
      requestedNumber: n,
      createdAt: Date.now(),
      status: 'pending'
    });

    notify('Approval request submitted.');
  } catch (e) {
    notify(e.message, true);
  }
};

// MEMBER DASHBOARD

function renderMember(m) {
  if (!m) return;

  $('memberTitle').textContent = m.name || 'Member';

  $('memberMeta').textContent =
    'Member #' + (m.number || memberNumber);

  const paid = collectPaidMonths(
    m,
    historicalPayments
  );

  const paidSet = new Set(paid);
  const rows = [];

  for (const period of historyPeriods(m, paid)) {
    const year = Number(period.slice(0, 4));

    let status = 'Not verified';

    if (paidSet.has(period)) {
      status = 'Paid';
    } else if (
      m.payments?.[period]?.status === 'pending'
    ) {
      status = 'Pending';
    } else if (!historyLoaded && year <= 2027) {
      status = 'Loading';
    } else if (historyError && year <= 2027) {
      status = 'History unavailable';
    }

    rows.push(
      `<tr><td>${escapeHTML(period)}</td>` +
      `<td>${escapeHTML(status)}</td></tr>`
    );
  }

  $('paidCount').textContent =
    !historyLoaded
      ? 'Loading'
      : historyError
        ? 'Unavailable'
        : String(paid.length);

  $('dueAmount').textContent = 'Not verified';
  $('historyBody').innerHTML = rows.join('');
}

// ADMIN DATA LISTENERS

function loadAdmin() {
  unsubscribers.push(
    onValue(
      ref(db, 'requests'),
      s => {
        const data = s.val() || {};
        $('requestsList').replaceChildren();

        let count = 0;

        for (const [uid, r] of Object.entries(data)) {
          if (r.status !== 'pending') continue;

          count++;

          const box = document.createElement('div');
          box.className = 'panel';

          const p = document.createElement('p');
          p.textContent =
            `${r.name || ''} (${r.email || ''}) — ` +
            `requested #${r.requestedNumber}`;

          const b = makeButton(
            'Approve',
            () => approve(uid, r)
          );

          box.append(p, b);
          $('requestsList').append(box);
        }

        if (!count) {
          $('requestsList').textContent =
            'No pending approval requests.';
        }
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

        if (selectedAdminMember !== null) {
          renderAdminPaymentHistory(
            selectedAdminMember
          );
        }

        updateArchiveButton();
      },
      e => notify(e.message, true)
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
      },
      e => notify(e.message, true)
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
      },
      e => {
        adminHistoryLoaded = false;

        notify(
          'Admin history error: ' + e.message,
          true
        );

        updateArchiveButton();
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

        notify(
          'Archive loading error: ' + e.message,
          true
        );

        updateArchiveButton();
      }
    )
  );
}

// APPROVE MEMBER

async function approve(uid, r) {
  if (!isAdmin()) return;

  const m = memberList[r.requestedNumber];

  if (!m) {
    return notify('Member not found', true);
  }

  if (!isActiveMember(m)) {
    return notify('Member is not active', true);
  }

  if (m.uid && m.uid !== uid) {
    return notify(
      'Already linked to another account',
      true
    );
  }

  if (!confirm(
    `Approve ${r.email} as member ` +
    `#${r.requestedNumber} (${m.name})?`
  )) return;

  try {
    await update(ref(db), {
      [`members/${r.requestedNumber}/uid`]: uid,
      [`users/${uid}`]: {
        status: 'approved',
        memberNumber: r.requestedNumber,
        email: r.email
      },
      [`requests/${uid}/status`]: 'approved'
    });

    notify('Approved');
  } catch (e) {
    notify(e.message, true);
  }
}

function makeButton(text, handler, css = '') {
  const button = document.createElement('button');

  button.textContent = text;

  if (css) {
    button.className = css;
  }

  button.onclick = handler;

  return button;
}

// ADMIN MEMBERS TABLE

function renderAdminMembers() {
  const container = $('membersList');
  container.replaceChildren();

  const searchText =
    ($('search').value || '').toLowerCase();

  const members = Object.entries(memberList)
    .filter(([id, m]) =>
      `${id} ${m?.name || ''}`
        .toLowerCase()
        .includes(searchText)
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
    header.appendChild(th);
  });

  thead.appendChild(header);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');

  for (const [number, member] of members) {
    const tr = document.createElement('tr');

    const paidMonths = adminHistoryLoaded
      ? collectPaidMonths(
          member,
          adminHistoryCache[number] || {}
        )
      : [];

    const cells = [
      number,
      member?.name || '',
      member?.uid ? 'Linked' : 'Not linked',
      member?.status || 'active',
      adminHistoryLoaded
        ? String(paidMonths.length)
        : 'Loading',
      adminHistoryLoaded
        ? `₹${paidMonths.length * 50}`
        : 'Loading'
    ];

    for (const value of cells) {
      const td = document.createElement('td');
      td.textContent = value;
      tr.appendChild(td);
    }

    const action = document.createElement('td');

    const historyButton = makeButton(
      'View History',
      () => renderAdminPaymentHistory(number)
    );

    historyButton.disabled = !adminHistoryLoaded;

    action.appendChild(historyButton);
    action.appendChild(document.createTextNode(' '));

    const editButton = makeButton(
      'Edit',
      () => openEditMember(number),
      'secondary'
    );

    editButton.disabled =
      member?.status === 'archived';

    action.appendChild(editButton);
    action.appendChild(document.createTextNode(' '));

    const archiveButton = makeButton(
      member?.status === 'archived'
        ? 'Archived'
        : 'Archive',
      () => openArchiveMember(number),
      'danger'
    );

    archiveButton.disabled =
      member?.status === 'archived';

    action.appendChild(archiveButton);

    tr.appendChild(action);
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  container.appendChild(table);
}

// HISTORY TABLE

function renderHistoryTable(
  member,
  oldHistory,
  target
) {
  const paidMonths = collectPaidMonths(
    member,
    oldHistory
  );

  const paidSet = new Set(paidMonths);

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const header = document.createElement('tr');

  ['Month', 'Status'].forEach(value => {
    const th = document.createElement('th');
    th.textContent = value;
    header.appendChild(th);
  });

  thead.appendChild(header);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');

  for (const period of historyPeriods(
    member,
    paidMonths
  )) {
    const paid = paidSet.has(period);

    const tr = document.createElement('tr');
    const tdMonth = document.createElement('td');
    const tdStatus = document.createElement('td');

    tdMonth.textContent = period;

    tdStatus.textContent = paid
      ? 'Paid'
      : member.payments?.[period]?.status === 'pending'
        ? 'Pending'
        : 'Not verified';

    tdStatus.className = paid
      ? 'history-paid'
      : 'history-unverified';

    tr.append(tdMonth, tdStatus);
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  $(target).replaceChildren(table);

  return paidMonths.length;
}

function renderAdminPaymentHistory(number) {
  if (!isAdmin() || !adminHistoryLoaded) return;

  const member = memberList[String(number)];

  if (!member) return;

  selectedAdminMember = String(number);

  const oldHistory =
    adminHistoryCache[String(number)] || {};

  $('adminHistoryTitle').textContent =
    `#${number} — ${member.name || 'Member'}`;

  const count = renderHistoryTable(
    member,
    oldHistory,
    'adminHistoryTable'
  );

  $('adminHistorySummary').textContent =
    `Paid months: ${count} | ` +
    `Recorded paid amount: ₹${count * 50}`;

  show('adminMemberHistory', true);
}

$('search').oninput = renderAdminMembers;

// ADMIN TABS

function tab(which) {
  [
    'requests',
    'members',
    'payments',
    'addMember',
    'archivedMembers'
  ].forEach(x => show(x + 'Panel', x === which));
}

$('tabRequests').onclick = () => tab('requests');
$('tabMembers').onclick = () => tab('members');
$('tabPayments').onclick = () => tab('payments');
$('tabAddMember').onclick = () => tab('addMember');

$('tabArchivedMembers').onclick = () => {
  tab('archivedMembers');
  renderArchivedMembers();
};

// ADD MEMBER

$('addMemberForm').onsubmit = async event => {
  event.preventDefault();

  if (!isAdmin()) {
    return notify('Admin access required.', true);
  }

  const number = Number($('newMemberNumber').value);
  const name = $('newMemberName').value.trim();
  const phone = $('newMemberPhone').value.trim();
  const joiningDate = $('newMemberDate').value;
  const status = $('newMemberStatus').value;

  if (!Number.isSafeInteger(number) || number < 1) {
    return notify('Invalid member number.', true);
  }

  if (!name || name.length > 100) {
    return notify('Enter a valid member name.', true);
  }

  if (!validPhone(phone)) {
    return notify('Invalid phone number.', true);
  }

  if (!validDate(joiningDate)) {
    return notify('Invalid joining date.', true);
  }

  if (!['active', 'inactive'].includes(status)) {
    return notify('Invalid membership status.', true);
  }

  const button = $('saveNewMember');
  button.disabled = true;

  try {
    const memberRef = ref(db, `members/${number}`);

    const result = await runTransaction(
      memberRef,
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
      return notify(
        'Member number already exists. ' +
        'It cannot be reused yet.',
        true
      );
    }

    $('addMemberForm').reset();
    $('newMemberDate').value = localDateString();

    notify(
      `Member #${number} added successfully.`
    );

    tab('members');
  } catch (e) {
    notify('Save failed: ' + e.message, true);
  } finally {
    button.disabled = false;
  }
};

// EDIT MEMBER

function openEditMember(number) {
  if (!isAdmin()) return;

  const member = memberList[String(number)];

  if (!member || member.status === 'archived') {
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

  const number = $('editMemberNumber').value;
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
      m => {
        if (!m || m.status === 'archived') {
          return;
        }

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
      return notify(
        'Member changed or is archived.',
        true
      );
    }

    show('editMemberPanel', false);

    notify(
      `Member #${number} updated successfully.`
    );
  } catch (e) {
    notify('Edit failed: ' + e.message, true);
  } finally {
    button.disabled = false;
  }
};

// ARCHIVE MEMBER
// STEP 72.8C
//
// Archive pre-check only.
// Final archive database write is LOCKED.
// Member numbers are permanently reserved.
// No payment records are deleted.
//
// Step 72.8D must provide concurrency protection
// before real archiving can be enabled.

function openArchiveMember(number) {
  if (!isAdmin()) return;

  const m = memberList[String(number)];

  if (!m || m.status === 'archived') {
    return notify(
      'Member already archived.',
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

$('cancelArchiveMember').onclick = () => {
  show('archiveMemberPanel', false);
};

$('archiveMemberForm').onsubmit = async event => {
  event.preventDefault();

  if (!isAdmin() || archiveBusy) return;

  const number = String(
    $('archiveMemberNumber').value
  );

  const reason = $('archiveMemberReason').value;

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
      'Wait until all records finish loading.',
      true
    );
  }

  archiveBusy = true;
  updateArchiveButton();

  try {
    const member = (
      await get(ref(db, `members/${number}`))
    ).val();

    if (
      !member ||
      member.status === 'archived'
    ) {
      throw new Error(
        'Member missing or already archived.'
      );
    }

    // Read historical payment records.
    const history = (
      await get(ref(db, `paymentHistory/${number}`))
    ).val() || {};

    // Read all payment requests.
    const requests = (
      await get(ref(db, 'paymentRequests'))
    ).val() || {};

    // Find requests belonging to this member.
    const related = Object.entries(requests)
      .filter(([, p]) =>
        String(p.memberNumber) === number
      );

    // STEP 72.8C SAFETY CHECK
    const pending = related.filter(
      ([, p]) => p.status === 'pending'
    );

    if (pending.length > 0) {
      throw new Error(
        `Cannot archive #${number}: ` +
        `${pending.length} pending payment ` +
        `request(s). Review them first.`
      );
    }

    const count = collectPaidMonths(
      member,
      history
    ).length;

    // IMPORTANT:
    // No database archive write is performed here.
    // Concurrency-safe archive is not yet deployed.

    notify(
      `Archive pre-check passed for #${number}: ` +
      `${count} paid months; ` +
      `no pending requests. ` +
      `Final archive is LOCKED until ` +
      `Step 72.8D concurrency protection ` +
      `is installed.`,
      true
    );

  } catch (e) {
    notify(
      'Archive pre-check stopped: ' +
      e.message,
      true
    );
  } finally {
    archiveBusy = false;
    updateArchiveButton();
  }
};

function updateArchiveButton() {
  $('confirmArchiveMember').disabled =
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

new MutationObserver(
  updateArchiveButton
).observe(
  $('archiveMemberPanel'),
  {
    attributes: true,
    attributeFilter: ['class']
  }
);

// ARCHIVED MEMBERS

function renderArchivedMembers() {
  const container = $('archivedMembersList');
  container.replaceChildren();

  const search =
    ($('archivedMembersSearch').value || '')
      .toLowerCase();

  const entries = Object.entries(archivedMembers)
    .filter(([id, r]) =>
      [
        id,
        r.originalNumber,
        r.member?.name,
        r.reason
      ].join(' ').toLowerCase().includes(search)
    )
    .sort((a, b) =>
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
  const head = document.createElement('tr');

  [
    'Old #',
    'Name',
    'Reason',
    'Archived Date',
    'History'
  ].forEach(v => {
    const th = document.createElement('th');
    th.textContent = v;
    head.appendChild(th);
  });

  thead.appendChild(head);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');

  for (const [id, r] of entries) {
    const tr = document.createElement('tr');

    const values = [
      r.originalNumber,
      r.member?.name || '',
      r.reason || '',
      r.archivedAt
        ? new Date(r.archivedAt)
            .toLocaleDateString('en-IN')
        : ''
    ];

    values.forEach(v => {
      const td = document.createElement('td');
      td.textContent = v;
      tr.appendChild(td);
    });

    const action = document.createElement('td');

    action.appendChild(
      makeButton(
        'View History',
        () => renderArchivedHistory(id)
      )
    );

    tr.appendChild(action);
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  container.appendChild(table);
}

function renderArchivedHistory(id) {
  if (!isAdmin()) return;

  const r = archivedMembers[id];
  if (!r) return;

  selectedArchiveId = id;

  const member = r.member || {};
  const oldHistory = r.paymentHistory || {};

  $('archivedHistoryTitle').textContent =
    `#${r.originalNumber} — ` +
    `${member.name || 'Former Member'}`;

  const count = renderHistoryTable(
    member,
    oldHistory,
    'archivedHistoryTable'
  );

  $('archivedHistorySummary').textContent =
    `Paid months: ${count} | ` +
    `Recorded paid amount: ₹${count * 50} | ` +
    `Reason: ${r.reason || 'Not specified'} | ` +
    'Member number reserved';

  show('archivedMemberHistory', true);

  $('archivedMemberHistory').scrollIntoView({
    behavior: 'smooth',
    block: 'start'
  });
}

$('archivedMembersSearch').oninput =
  renderArchivedMembers;

// UPI PAYMENT

const UPI_ID = 'waheedwahi84-1@oksbi';
const UPI_NAME = 'Waheed Wahi';

function planDetails() {
  const plan = $('paymentPlan').value;

  return {
    plan,
    amount: plan === 'yearly' ? 600 : 50,
    period: $('paymentPeriod').value
  };
}

function updateUpiLink() {
  const {
    plan,
    amount,
    period
  } = planDetails();

  const params = new URLSearchParams({
    pa: UPI_ID,
    pn: UPI_NAME,
    am: String(amount),
    cu: 'INR',
    tn: `TFC ${memberNumber || ''} ${plan} ${period}`
  });

  $('upiPayLink').href =
    `upi://pay?${params.toString()}`;

  $('upiPayLink').textContent =
    `Open UPI app — ₹${amount}`;
}

$('paymentPlan').onchange = updateUpiLink;
$('paymentPeriod').onchange = updateUpiLink;

updateUpiLink();

// MEMBER PAYMENT SUBMISSION

$('submitPayment').onclick = async () => {
  if (!current || !memberNumber || admin) {
    return notify(
      'Member login required',
      true
    );
  }

  const {
    plan,
    amount,
    period
  } = planDetails();

  const transactionId =
    $('transactionId').value.trim();

  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    return notify(
      'Select a valid payment month/year',
      true
    );
  }

  if (
    transactionId.length < 6 ||
    transactionId.length > 100
  ) {
    return notify(
      'Enter valid UPI transaction ID',
      true
    );
  }

  if (!confirm(
    `Submit ₹${amount} for ${period} ` +
    `as Pending? Please submit only after paying.`
  )) return;

  $('submitPayment').disabled = true;

  try {
    const member = (
      await get(
        ref(db, `members/${memberNumber}`)
      )
    ).val();

    if (
      !isActiveMember(member) ||
      member.uid !== current.uid
    ) {
      throw new Error(
        'Membership is no longer active.'
      );
    }

    const id =
      push(ref(db, 'paymentRequests')).key;

    await set(
      ref(db, `paymentRequests/${id}`),
      {
        uid: current.uid,
        memberNumber,
        plan,
        amount,
        period,
        transactionId,
        status: 'pending',
        createdAt: Date.now()
      }
    );

    $('transactionId').value = '';

    notify(
      'Submitted for admin verification.'
    );

  } catch (e) {
    notify(
      'Submission failed: ' + e.message,
      true
    );
  } finally {
    $('submitPayment').disabled = false;
  }
};

// ADMIN PAYMENT REQUESTS

function renderAdminPayments() {
  const container = $('adminPaymentList');
  container.replaceChildren();

  const pending = Object.entries(payments)
    .filter(([, p]) => p.status === 'pending')
    .sort((a, b) =>
      (a[1].createdAt || 0) -
      (b[1].createdAt || 0)
    );

  if (!pending.length) {
    container.textContent =
      'No pending payment submissions.';
    return;
  }

  for (const [id, p] of pending) {
    const box = document.createElement('div');
    box.className = 'panel';

    const info = document.createElement('p');

    info.textContent =
      `#${p.memberNumber} — ` +
      `${memberList[p.memberNumber]?.name || ''}` +
      ` | ₹${p.amount}` +
      ` | ${p.plan} ${p.period}` +
      ` | UPI Ref: ${p.transactionId}`;

    const approveButton = makeButton(
      'Approve after bank verification',
      () => verifyPayment(id, p, true)
    );

    const rejectButton = makeButton(
      'Reject',
      () => verifyPayment(id, p, false),
      'secondary'
    );

    box.append(
      info,
      approveButton,
      document.createTextNode(' '),
      rejectButton
    );

    container.append(box);
  }
}

// ADMIN PAYMENT VERIFICATION

async function verifyPayment(id, p, accept) {
  if (!isAdmin() || p.status !== 'pending') {
    return;
  }

  if (!confirm(
    accept
      ? `Have you verified ₹${p.amount} in ` +
        `the bank statement? Approve ` +
        `#${p.memberNumber}, ${p.period}?`
      : `Reject payment request for ` +
        `#${p.memberNumber}?`
  )) return;

  try {
    const fresh = (
      await get(ref(db, `paymentRequests/${id}`))
    ).val();

    if (!fresh || fresh.status !== 'pending') {
      return notify(
        'Request is no longer pending.',
        true
      );
    }

    if (!accept) {
      await update(
        ref(db, `paymentRequests/${id}`),
        {
          status: 'rejected',
          reviewedAt: Date.now(),
          reviewedBy: current.uid
        }
      );

      notify('Payment rejected.');
      return;
    }

    const member = (
      await get(
        ref(db, `members/${fresh.memberNumber}`)
      )
    ).val();

    if (
      !isActiveMember(member) ||
      member.uid !== fresh.uid
    ) {
      return notify(
        'Member account mismatch or inactive. ' +
        'Review request.',
        true
      );
    }

    const start = new Date(
      `${fresh.period}-01T00:00:00`
    );

    if (Number.isNaN(start.getTime())) {
      return notify(
        'Invalid payment period',
        true
      );
    }

    const keys = [];

    for (
      let i = 0;
      i < (fresh.plan === 'yearly' ? 12 : 1);
      i++
    ) {
      const d = new Date(
        start.getFullYear(),
        start.getMonth() + i,
        1
      );

      keys.push(
        `${d.getFullYear()}-${String(
          d.getMonth() + 1
        ).padStart(2, '0')}`
      );
    }

    const oldHistory = (
      await get(
        ref(
          db,
          `paymentHistory/${fresh.memberNumber}`
        )
      )
    ).val() || {};

    const duplicate = keys.some(key => {
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

    if (duplicate) {
      return notify(
        'Some months are already paid. ' +
        'Review historical records.',
        true
      );
    }

    const changes = {};
    const verifiedAt = Date.now();

    for (const key of keys) {
      changes[
        `members/${fresh.memberNumber}/payments/${key}`
      ] = {
        status: 'paid',
        amount: 50,
        transactionId: fresh.transactionId,
        requestId: id,
        verifiedAt,
        verifiedBy: current.uid
      };
    }

    changes[
      `paymentRequests/${id}/status`
    ] = 'approved';

    changes[
      `paymentRequests/${id}/reviewedAt`
    ] = verifiedAt;

    changes[
      `paymentRequests/${id}/reviewedBy`
    ] = current.uid;

    await update(ref(db), changes);

    notify(
      'Payment approved and months marked Paid.'
    );

  } catch (e) {
    notify(
      'Payment review failed: ' +
      e.message,
      true
    );
  }
}

// MEMBER PAYMENT HISTORY

function renderMyPayments(data) {
  const entries = Object.values(data)
    .sort((a, b) =>
      (b.createdAt || 0) -
      (a.createdAt || 0)
    );

  $('myPaymentList').innerHTML =
    entries.length
      ? `<table>
          <thead>
            <tr>
              <th>Period</th>
              <th>Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${entries.map(p =>
              `<tr>
                <td>${escapeHTML(p.period)} (${escapeHTML(p.plan)})</td>
                <td>₹${Number(p.amount) || 0}</td>
                <td>${escapeHTML(p.status)}</td>
              </tr>`
            ).join('')}
          </tbody>
        </table>`
      : 'No payment submissions yet.';
}
