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

// TFC BANDIYOD MEMBER PORTAL
// STEP 72.8P
// COMPLETE APP.JS
//
// IMPORTANT:
// Archive write remains disabled until
// compatible Firebase Rules are deployed
// and concurrency testing is completed.
//
// Existing historical records are preserved.
// Archived member numbers are never reused.

const ARCHIVE_WRITE_ENABLED = false;

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
  const el = $('msg');
  if (!el) return;

  el.textContent = message;
  el.className = error ? 'error' : 'ok';
};

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
    document.querySelectorAll('[data-t]').forEach(e => {
      e.textContent =
        dict[$('lang').value]?.[e.dataset.t] ??
        e.textContent;
    });
  };
}

let auth;
let db;
let current = null;
let admin = false;

let memberNumber = null;
let memberList = {};
let payments = {};
let historicalPayments = {};
let currentMemberData = null;

let unsubscribers = [];

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
let paymentBusy = false;

const isAdmin = () => !!current && admin;

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
    !['archiving', 'archived']
      .includes(member.status);
}

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

function validPeriod(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(
    String(value || '')
  );
}

function stopListeners() {
  unsubscribers.forEach(unsubscribe => {
    try {
      unsubscribe();
    } catch (_) {}
  });

  unsubscribers = [];

  memberList = {};
  payments = {};
  historicalPayments = {};
  currentMemberData = null;

  historyLoaded = false;
  historyError = false;

  adminHistoryCache = {};
  adminHistoryLoaded = false;
  selectedAdminMember = null;

  archivedMembers = {};
  selectedArchiveId = null;

  paymentRequestsLoaded = false;
  membersLoaded = false;
  archiveLoaded = false;
  archiveBusy = false;
  paymentBusy = false;
}

// HISTORICAL PAYMENTS

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
  const now = new Date();

  const last =
    `${now.getFullYear()}-${String(
      now.getMonth() + 1
    ).padStart(2, '0')}`;

  let first =
    member?.joiningDate?.slice(0, 7) ||
    '2024-01';

  if (!validPeriod(first)) {
    first = '2024-01';
  }

  if (paidMonths[0] && paidMonths[0] < first) {
    first = paidMonths[0];
  }

  if (first > last) return [];

  const result = [];

  for (
    let year = Number(first.slice(0, 4));
    year <= now.getFullYear();
    year++
  ) {
    for (let month = 1; month <= 12; month++) {
      const period =
        `${year}-${String(month).padStart(2, '0')}`;

      if (period >= first && period <= last) {
        result.push(period);
      }
    }
  }

  return result;
}

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
    const tr = document.createElement('tr');

    const tdMonth = document.createElement('td');
    const tdStatus = document.createElement('td');

    const paid = paidSet.has(period);

    tdMonth.textContent = period;

    tdStatus.textContent = paid
      ? 'Paid'
      : member?.payments?.[period]?.status === 'pending'
        ? 'Pending'
        : 'Not verified';

    tdStatus.className = paid
      ? 'history-paid'
      : 'history-unverified';

    tr.append(tdMonth, tdStatus);
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);

  const container = $(target);
  if (container) {
    container.replaceChildren(table);
  }

  return paidMonths.length;
}

// INITIAL VALUES

if ($('paymentPeriod')) {
  $('paymentPeriod').value =
    `${new Date().getFullYear()}-${String(
      new Date().getMonth() + 1
    ).padStart(2, '0')}`;
}

if ($('newMemberDate')) {
  $('newMemberDate').value = localDateString();
}

// FIREBASE

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
        const number = String(
          record.memberNumber
        );

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

          unsubscribers.push(
            onValue(
              ref(db, `members/${number}`),
              snapshot => {
                const updated = snapshot.val();

                if (
                  !isActiveMember(updated) ||
                  updated.uid !== user.uid
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

                currentMemberData = updated;
                renderMember(updated);
              },
              error => notify(
                error.message,
                true
              )
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
                equalTo(user.uid)
              ),
              snapshot => {
                renderMyPayments(
                  snapshot.val() || {}
                );
              },
              error => notify(
                error.message,
                true
              )
            )
          );

          updateUpiLink();
          return;
        }
      }

      show('pending', true);

      $('claimNumber').value =
        record?.requestedNumber || '';

    } catch (error) {
      notify(
        'Database error: ' + error.message,
        true
      );
    }
  });
}

// LOGIN

$('signIn').onclick = async () => {
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
};

$('logout').onclick = () => signOut(auth);

// MEMBER APPROVAL REQUEST

$('requestApproval').onclick = async () => {
  if (!current || admin) return;

  const number = Number(
    $('claimNumber').value
  );

  if (
    !Number.isSafeInteger(number) ||
    number < 1
  ) {
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

// MEMBER DASHBOARD

function renderMember(member) {
  if (!member) return;

  $('memberTitle').textContent =
    member.name || 'Member';

  $('memberMeta').textContent =
    'Member #' +
    (member.number || memberNumber);

  const paid = collectPaidMonths(
    member,
    historicalPayments
  );

  const paidSet = new Set(paid);
  const rows = [];

  for (const period of historyPeriods(
    member,
    paid
  )) {
    const year = Number(
      period.slice(0, 4)
    );

    let status = 'Not verified';

    if (paidSet.has(period)) {
      status = 'Paid';
    } else if (
      member.payments?.[period]?.status === 'pending'
    ) {
      status = 'Pending';
    } else if (
      !historyLoaded &&
      year <= 2027
    ) {
      status = 'Loading';
    } else if (
      historyError &&
      year <= 2027
    ) {
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

  // Outstanding dues require verified
  // historical membership start dates.

  $('dueAmount').textContent =
    'Not verified';

  $('historyBody').innerHTML =
    rows.join('');
}

// BUTTON HELPER

function makeButton(text, handler, css = '') {
  const button =
    document.createElement('button');

  button.textContent = text;

  if (css) button.className = css;

  button.onclick = handler;

  return button;
}

// ADMIN LISTENERS

function loadAdmin() {
  unsubscribers.push(
    onValue(
      ref(db, 'requests'),
      snapshot => {
        const data = snapshot.val() || {};

        $('requestsList').replaceChildren();

        let count = 0;

        for (const [uid, request] of Object.entries(
          data
        )) {
          if (request.status !== 'pending') {
            continue;
          }

          count++;

          const box =
            document.createElement('div');

          box.className = 'panel';

          const p =
            document.createElement('p');

          p.textContent =
            `${request.name || ''} ` +
            `(${request.email || ''}) — ` +
            `requested #${request.requestedNumber}`;

          box.append(
            p,
            makeButton(
              'Approve',
              () => approve(uid, request)
            )
          );

          $('requestsList').append(box);
        }

        if (!count) {
          $('requestsList').textContent =
            'No pending approval requests.';
        }
      },
      error => notify(
        error.message,
        true
      )
    )
  );

  unsubscribers.push(
    onValue(
      ref(db, 'members'),
      snapshot => {
        memberList = snapshot.val() || {};
        membersLoaded = true;

        renderAdminMembers();

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
        adminHistoryCache =
          snapshot.val() || {};

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

        notify(
          'Admin history error: ' +
          error.message,
          true
        );

        updateArchiveButton();
      }
    )
  );

  unsubscribers.push(
    onValue(
      ref(db, 'archivedMembers'),
      snapshot => {
        archivedMembers =
          snapshot.val() || {};

        archiveLoaded = true;

        renderArchivedMembers();
        updateArchiveButton();
      },
      error => {
        archiveLoaded = false;

        notify(
          'Archive loading error: ' +
          error.message,
          true
        );

        updateArchiveButton();
      }
    )
  );
}

// APPROVE MEMBER

async function approve(uid, request) {
  if (!isAdmin()) return;

  const number = String(
    request.requestedNumber
  );

  const member = memberList[number];

  if (!isActiveMember(member)) {
    return notify(
      'Member is not active.',
      true
    );
  }

  if (
    member.uid &&
    member.uid !== uid
  ) {
    return notify(
      'Already linked to another account.',
      true
    );
  }

  if (!confirm(
    `Approve ${request.email} as ` +
    `member #${number} (${member.name})?`
  )) return;

  try {
    // Recheck the member before linking.
    // The final security boundary must also
    // be enforced by Firebase Rules.

    const freshMember = (
      await get(ref(db, `members/${number}`))
    ).val();

    if (
      !isActiveMember(freshMember) ||
      (
        freshMember.uid &&
        freshMember.uid !== uid
      )
    ) {
      throw new Error(
        'Member status or account changed.'
      );
    }

    const freshRequest = (
      await get(ref(db, `requests/${uid}`))
    ).val();

    if (
      freshRequest?.status !== 'pending' ||
      String(freshRequest.requestedNumber) !== number
    ) {
      throw new Error(
        'Approval request changed.'
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

    notify('Approved.');

  } catch (error) {
    notify(error.message, true);
  }
}

// ADMIN MEMBERS TABLE

function renderAdminMembers() {
  const container = $('membersList');
  container.replaceChildren();

  const searchText =
    ($('search').value || '')
      .toLowerCase();

  const entries = Object.entries(memberList)
    .filter(([id, member]) =>
      `${id} ${member?.name || ''}`
        .toLowerCase()
        .includes(searchText)
    )
    .sort(
      (a, b) =>
        Number(a[0]) - Number(b[0])
    )
    .slice(0, 300);

  const table =
    document.createElement('table');

  const thead =
    document.createElement('thead');

  const header =
    document.createElement('tr');

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

  const tbody =
    document.createElement('tbody');

  for (const [number, member] of entries) {
    const tr =
      document.createElement('tr');

    const paidMonths = adminHistoryLoaded
      ? collectPaidMonths(
          member,
          adminHistoryCache[number] || {}
        )
      : [];

    const cells = [
      number,
      member?.name || '',
      member?.uid
        ? 'Linked'
        : 'Not linked',
      member?.status || 'active',
      adminHistoryLoaded
        ? String(paidMonths.length)
        : 'Loading',
      adminHistoryLoaded
        ? `₹${paidMonths.length * 50}`
        : 'Loading'
    ];

    for (const value of cells) {
      const td =
        document.createElement('td');

      td.textContent = value;
      tr.appendChild(td);
    }

    const actions =
      document.createElement('td');

    const historyButton = makeButton(
      'View History',
      () => renderAdminPaymentHistory(number)
    );

    historyButton.disabled =
      !adminHistoryLoaded;

    actions.append(historyButton);
    actions.append(
      document.createTextNode(' ')
    );

    const editButton = makeButton(
      'Edit',
      () => openEditMember(number),
      'secondary'
    );

    editButton.disabled =
      !canEditMember(member);

    actions.append(editButton);
    actions.append(
      document.createTextNode(' ')
    );

    const archiveButton = makeButton(
      member?.status === 'archived'
        ? 'Archived'
        : 'Archive',
      () => openArchiveMember(number),
      'danger'
    );

    archiveButton.disabled =
      !canEditMember(member);

    actions.append(archiveButton);

    tr.append(actions);
    tbody.append(tr);
  }

  table.append(tbody);
  container.append(table);
}

// ADMIN PAYMENT HISTORY

function renderAdminPaymentHistory(number) {
  if (!isAdmin() || !adminHistoryLoaded) {
    return;
  }

  const member =
    memberList[String(number)];

  if (!member) return;

  selectedAdminMember =
    String(number);

  const history =
    adminHistoryCache[String(number)] || {};

  $('adminHistoryTitle').textContent =
    `#${number} — ` +
    `${member.name || 'Member'}`;

  const count = renderHistoryTable(
    member,
    history,
    'adminHistoryTable'
  );

  $('adminHistorySummary').textContent =
    `Paid months: ${count} | ` +
    `Recorded paid amount: ₹${count * 50}`;

  show('adminMemberHistory', true);
}

$('search').oninput =
  renderAdminMembers;

// ADMIN TABS

function tab(which) {
  [
    'requests',
    'members',
    'payments',
    'addMember',
    'archivedMembers'
  ].forEach(name => {
    show(
      name + 'Panel',
      name === which
    );
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

// ADD MEMBER

$('addMemberForm').onsubmit = async event => {
  event.preventDefault();

  if (!isAdmin()) {
    return notify(
      'Admin access required.',
      true
    );
  }

  const number = Number(
    $('newMemberNumber').value
  );

  const name =
    $('newMemberName').value.trim();

  const phone =
    $('newMemberPhone').value.trim();

  const joiningDate =
    $('newMemberDate').value;

  const status =
    $('newMemberStatus').value;

  if (
    !Number.isSafeInteger(number) ||
    number < 1
  ) {
    return notify(
      'Invalid member number.',
      true
    );
  }

  if (!name || name.length > 100) {
    return notify(
      'Invalid member name.',
      true
    );
  }

  if (!validPhone(phone)) {
    return notify(
      'Invalid phone number.',
      true
    );
  }

  if (!validDate(joiningDate)) {
    return notify(
      'Invalid joining date.',
      true
    );
  }

  if (!['active', 'inactive'].includes(status)) {
    return notify(
      'Invalid membership status.',
      true
    );
  }

  const button = $('saveNewMember');
  button.disabled = true;

  try {
    // A number is permanently reserved
    // when its member record exists.

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
        'Member number already exists. ' +
        'It cannot be reused.'
      );
    }

    $('addMemberForm').reset();

    $('newMemberDate').value =
      localDateString();

    notify(
      `Member #${number} added successfully.`
    );

    tab('members');

  } catch (error) {
    notify(
      'Save failed: ' + error.message,
      true
    );
  } finally {
    button.disabled = false;
  }
};

// EDIT MEMBER

function openEditMember(number) {
  if (!isAdmin()) return;

  const member =
    memberList[String(number)];

  if (!canEditMember(member)) {
    return notify(
      'Member cannot be edited.',
      true
    );
  }

  show('archiveMemberPanel', false);
  show('adminMemberHistory', false);

  $('editMemberNumber').value =
    number;

  $('editMemberName').value =
    member.name || '';

  $('editMemberPhone').value =
    member.phone || '';

  $('editMemberDate').value =
    member.joiningDate ||
    localDateString();

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
    return notify(
      'Admin access required.',
      true
    );
  }

  const number =
    $('editMemberNumber').value;

  const name =
    $('editMemberName').value.trim();

  const phone =
    $('editMemberPhone').value.trim();

  const joiningDate =
    $('editMemberDate').value;

  const status =
    $('editMemberStatus').value;

  if (!name || name.length > 100) {
    return notify('Invalid name.', true);
  }

  if (!validPhone(phone)) {
    return notify(
      'Invalid phone number.',
      true
    );
  }

  if (!validDate(joiningDate)) {
    return notify(
      'Invalid joining date.',
      true
    );
  }

  if (!['active', 'inactive'].includes(status)) {
    return notify(
      'Invalid status.',
      true
    );
  }

  const button =
    $('saveEditMember');

  button.disabled = true;

  try {
    const result = await runTransaction(
      ref(db, `members/${number}`),
      member => {
        if (!canEditMember(member)) {
          return;
        }

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
    notify(
      'Edit failed: ' + error.message,
      true
    );
  } finally {
    button.disabled = false;
  }
};

// ARCHIVE MEMBER
//
// Non-destructive design:
// 1. Verify records.
// 2. Reject unresolved payments.
// 3. Lock member via transaction.
// 4. Recheck payment requests.
// 5. Preserve archived snapshot.
// 6. Finalize archived status.
//
// The write feature remains disabled
// until Firebase Rules and race conditions
// have been verified.

function openArchiveMember(number) {
  if (!isAdmin()) return;

  const member =
    memberList[String(number)];

  if (!canEditMember(member)) {
    return notify(
      'Member cannot be archived.',
      true
    );
  }

  show('editMemberPanel', false);
  show('adminMemberHistory', false);

  $('archiveMemberNumber').value =
    number;

  $('archiveMemberSummary').textContent =
    `#${number} — ` +
    `${member.name || 'Member'}`;

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

function archiveRequestsFor(number, data) {
  return Object.entries(data || {})
    .filter(([, request]) =>
      String(request.memberNumber) ===
      String(number)
    );
}

function unresolvedArchiveRequests(number, data) {
  return archiveRequestsFor(number, data)
    .filter(([, request]) =>
      !['approved', 'rejected']
        .includes(request.status)
    );
}

async function archiveMemberSafely(event) {
  event.preventDefault();

  if (!isAdmin() || archiveBusy) return;

  const number = String(
    $('archiveMemberNumber').value
  ).trim();

  const reason =
    $('archiveMemberReason').value;

  const notes =
    $('archiveMemberNotes').value.trim();

  if (!/^[1-9]\d*$/.test(number)) {
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
      'Wait until all records finish loading.',
      true
    );
  }

  archiveBusy = true;
  updateArchiveButton();

  try {
    const memberRef =
      ref(db, `members/${number}`);

    const member = (
      await get(memberRef)
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
      await get(
        ref(db, 'paymentRequests')
      )
    ).val() || {};

    const unresolved =
      unresolvedArchiveRequests(
        number,
        requests
      );

    if (unresolved.length) {
      throw new Error(
        `${unresolved.length} unresolved payment ` +
        'request(s). Review them first.'
      );
    }

    const existingArchive = (
      await get(
        ref(db, `archivedMembers/${number}`)
      )
    ).val();

    if (existingArchive) {
      throw new Error(
        'Archive record already exists. ' +
        'Manual review required.'
      );
    }

    const paidCount =
      collectPaidMonths(
        member,
        history
      ).length;

    // Archive pre-check can be used now.
    // No database write occurs while locked.

    if (!ARCHIVE_WRITE_ENABLED) {
      notify(
        `Archive pre-check passed for ` +
        `#${number}. ${paidCount} paid months. ` +
        `No unresolved payment requests. ` +
        `Final Archive remains LOCKED ` +
        `until Firebase Rules are updated.`,
        true
      );
      return;
    }

    const confirmed = confirm(
      `ARCHIVE MEMBER\n\n` +
      `#${number} — ${member.name || ''}\n` +
      `Paid months: ${paidCount}\n` +
      `Reason: ${reason}\n\n` +
      `Historical records will be preserved.\n` +
      `Member number cannot be reused.\n\n` +
      `Continue?`
    );

    if (!confirmed) return;

    const lockedAt = Date.now();

    const lockResult = await runTransaction(
      memberRef,
      existing => {
        if (!canEditMember(existing)) {
          return;
        }

        return {
          ...existing,
          status: 'archiving',
          archiveLockAt: lockedAt,
          archiveLockBy: current.uid
        };
      },
      { applyLocally: false }
    );

    if (!lockResult.committed) {
      throw new Error(
        'Archive lock failed.'
      );
    }

    // Read the committed member state.

    const lockedMember = (
      await get(memberRef)
    ).val();

    if (
      !lockedMember ||
      lockedMember.status !== 'archiving' ||
      lockedMember.archiveLockAt !== lockedAt ||
      lockedMember.archiveLockBy !== current.uid
    ) {
      throw new Error(
        'Archive lock verification failed. ' +
        'Manual review required.'
      );
    }

    const latestRequests = (
      await get(
        ref(db, 'paymentRequests')
      )
    ).val() || {};

    const remaining =
      unresolvedArchiveRequests(
        number,
        latestRequests
      );

    if (remaining.length) {
      throw new Error(
        'Payment request changed during archive. ' +
        'Member remains locked. ' +
        'Manual review required.'
      );
    }

    const latestHistory = (
      await get(
        ref(db, `paymentHistory/${number}`)
      )
    ).val() || {};

    const archivedAt = Date.now();

    const archiveRecord = {
      originalNumber: Number(number),
      member: {
        ...lockedMember,
        status: 'archived',
        archivedAt,
        archivedBy: current.uid
      },
      paymentHistory: latestHistory,
      reason,
      notes,
      archivedAt,
      archivedBy: current.uid,
      paidMonthsAtArchive:
        collectPaidMonths(
          lockedMember,
          latestHistory
        ).length
    };

    // Multi-location update:
    // Original records are not deleted.

    await update(ref(db), {
      [`archivedMembers/${number}`]:
        archiveRecord,

      [`members/${number}/status`]:
        'archived',

      [`members/${number}/archivedAt`]:
        archivedAt,

      [`members/${number}/archivedBy`]:
        current.uid
    });

    show('archiveMemberPanel', false);

    notify(
      `Member #${number} archived. ` +
      'Historical records preserved.'
    );

  } catch (error) {
    notify(
      'Archive stopped: ' +
      error.message +
      ' Check member status before retrying.',
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
  const button =
    $('confirmArchiveMember');

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
  const container =
    $('archivedMembersList');

  container.replaceChildren();

  const search =
    ($('archivedMembersSearch').value || '')
      .toLowerCase();

  const entries =
    Object.entries(archivedMembers)
      .filter(([id, record]) =>
        [
          id,
          record.originalNumber,
          record.member?.name,
          record.reason
        ]
          .join(' ')
          .toLowerCase()
          .includes(search)
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

  const table =
    document.createElement('table');

  const thead =
    document.createElement('thead');

  const header =
    document.createElement('tr');

  [
    'Old #',
    'Name',
    'Reason',
    'Archived Date',
    'History'
  ].forEach(label => {
    const th = document.createElement('th');
    th.textContent = label;
    header.appendChild(th);
  });

  thead.appendChild(header);
  table.appendChild(thead);

  const tbody =
    document.createElement('tbody');

  for (const [id, record] of entries) {
    const tr =
      document.createElement('tr');

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
      const td =
        document.createElement('td');

      td.textContent = value;
      tr.appendChild(td);
    }

    const actions =
      document.createElement('td');

    actions.appendChild(
      makeButton(
        'View History',
        () => renderArchivedHistory(id)
      )
    );

    tr.append(actions);
    tbody.append(tr);
  }

  table.append(tbody);
  container.append(table);
}

function renderArchivedHistory(id) {
  if (!isAdmin()) return;

  const record =
    archivedMembers[id];

  if (!record) return;

  selectedArchiveId = id;

  const member =
    record.member || {};

  const history =
    record.paymentHistory || {};

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
    `Recorded paid amount: ₹${count * 50} | ` +
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

// UPI PAYMENT

const UPI_ID =
  'waheedwahi84-1@oksbi';

const UPI_NAME =
  'Waheed Wahi';

function planDetails() {
  const plan =
    $('paymentPlan').value;

  return {
    plan,
    amount:
      plan === 'yearly'
        ? 600
        : 50,
    period:
      $('paymentPeriod').value
  };
}

function updateUpiLink() {
  const {
    plan,
    amount,
    period
  } = planDetails();

  const params =
    new URLSearchParams({
      pa: UPI_ID,
      pn: UPI_NAME,
      am: String(amount),
      cu: 'INR',
      tn:
        `TFC ${memberNumber || ''} ` +
        `${plan} ${period}`
    });

  $('upiPayLink').href =
    `upi://pay?${params.toString()}`;

  $('upiPayLink').textContent =
    `Open UPI app — ₹${amount}`;
}

$('paymentPlan').onchange =
  updateUpiLink;

$('paymentPeriod').onchange =
  updateUpiLink;

updateUpiLink();

// MEMBER PAYMENT SUBMISSION

$('submitPayment').onclick = async () => {
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

  const {
    plan,
    amount,
    period
  } = planDetails();

  const transactionId =
    $('transactionId').value.trim();

  if (!['monthly', 'yearly'].includes(plan)) {
    return notify(
      'Invalid payment plan.',
      true
    );
  }

  if (!validPeriod(period)) {
    return notify(
      'Select valid payment period.',
      true
    );
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

  if (!confirm(
    `Submit ₹${amount} for ${period} ` +
    `as Pending? Submit only after paying.`
  )) return;

  const button = $('submitPayment');
  button.disabled = true;

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
      push(
        ref(db, 'paymentRequests')
      ).key;

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

  } catch (error) {
    notify(
      'Submission failed: ' +
      error.message,
      true
    );
  } finally {
    button.disabled = false;
  }
};

// ADMIN PAYMENT REQUESTS

function renderAdminPayments() {
  const container =
    $('adminPaymentList');

  container.replaceChildren();

  const pending =
    Object.entries(payments)
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
    const box =
      document.createElement('div');

    box.className = 'panel';

    const info =
      document.createElement('p');

    info.textContent =
      `#${request.memberNumber} — ` +
      `${
        memberList[request.memberNumber]?.name ||
        ''
      } | ₹${request.amount}` +
      ` | ${request.plan} ${request.period}` +
      ` | UPI Ref: ${request.transactionId}`;

    const approveButton = makeButton(
      'Approve after bank verification',
      () => verifyPayment(
        id,
        request,
        true
      )
    );

    const rejectButton = makeButton(
      'Reject',
      () => verifyPayment(
        id,
        request,
        false
      ),
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

// PAYMENT VERIFICATION
//
// Member payment records use a transaction.
// The request status update is separate.
//
// Therefore partial completion is possible.
// Request IDs are stored in payment records
// to help detect and recover from failures.

function paymentMonthKeys(plan, period) {
  if (!validPeriod(period)) {
    throw new Error(
      'Invalid payment period.'
    );
  }

  if (!['monthly', 'yearly'].includes(plan)) {
    throw new Error(
      'Invalid payment plan.'
    );
  }

  const [year, month] =
    period.split('-').map(Number);

  const count =
    plan === 'yearly' ? 12 : 1;

  const keys = [];

  for (let i = 0; i < count; i++) {
    const d = new Date(
      year,
      month - 1 + i,
      1
    );

    keys.push(
      `${d.getFullYear()}-${String(
        d.getMonth() + 1
      ).padStart(2, '0')}`
    );
  }

  return keys;
}

async function verifyPayment(id, request, accept) {
  if (
    !isAdmin() ||
    request.status !== 'pending' ||
    paymentBusy
  ) {
    return;
  }

  if (!confirm(
    accept
      ? `Have you verified ₹${request.amount} ` +
        `in the bank statement? Approve ` +
        `#${request.memberNumber}, ` +
        `${request.period}?`
      : `Reject payment request for ` +
        `#${request.memberNumber}?`
  )) return;

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

    // REJECTION

    if (!accept) {
      const result = await runTransaction(
        requestRef,
        existing => {
          if (
            !existing ||
            existing.status !== 'pending'
          ) {
            return;
          }

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

    // APPROVAL VALIDATION

    if (
      fresh.amount !== (
        fresh.plan === 'yearly'
          ? 600
          : 50
      ) ||
      !['monthly', 'yearly']
        .includes(fresh.plan)
    ) {
      throw new Error(
        'Invalid payment amount or plan.'
      );
    }

    const keys = paymentMonthKeys(
      fresh.plan,
      fresh.period
    );

    const number =
      String(fresh.memberNumber);

    const oldHistory = (
      await get(
        ref(db, `paymentHistory/${number}`)
      )
    ).val() || {};

    const memberRef =
      ref(db, `members/${number}`);

    const verifiedAt = Date.now();
    const reviewer = current.uid;

    // TRANSACTION GUARD

    const result = await runTransaction(
      memberRef,
      member => {
        if (
          !isActiveMember(member) ||
          member.uid !== fresh.uid
        ) {
          return;
        }

        const alreadyPaid =
          keys.some(key => {
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
            amount: 50,
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
      throw new Error(
        'Payment could not be recorded. ' +
        'Member may be inactive, locked, ' +
        'archived, or months already paid. ' +
        'Review before retrying.'
      );
    }

    // STATUS UPDATE
    // Separate from the member transaction.

    try {
      await update(requestRef, {
        status: 'approved',
        reviewedAt: verifiedAt,
        reviewedBy: reviewer
      });
    } catch (error) {
      throw new Error(
        'Paid months may already be recorded, ' +
        'but request status update failed. ' +
        'Do NOT approve again. ' +
        `Check request ${id}. ` +
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

// MEMBER PAYMENT REQUEST HISTORY

function renderMyPayments(data) {
  const entries =
    Object.values(data)
      .sort(
        (a, b) =>
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
