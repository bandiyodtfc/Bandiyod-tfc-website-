
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { getDatabase, ref, get, set, update, onValue, push, query, orderByChild, equalTo } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js';
import { firebaseConfig } from './firebase-config.js';

const $ = id => document.getElementById(id);
const show = (id, yes) => $(id).classList.toggle('hide', !yes);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
}[c]));

const notify = (message, error = false) => {
  $('msg').textContent = message;
  $('msg').className = error ? 'error' : 'ok';
};

const dict = {
  en: {
    welcome:'Welcome to TFC Bandiyod',
    loginText:'Members can sign in with Google. New accounts require admin approval.',
    signIn:'Continue with Google',
    pending:'Membership approval pending',
    pendingText:'Your Google account needs approval from the TFC admin.',
    memberNumber:'Membership number',
    request:'Request approval',
    due:'Outstanding dues',
    paid:'Paid months',
    fee:'Membership fee',
    history:'Payment history',
    month:'Month',
    status:'Status',
    pay:'Pay membership fee',
    admin:'Admin dashboard'
  },
  ml: {
    welcome:'TFC ബണ്ടിയോടിലേക്ക് സ്വാഗതം',
    loginText:'Google ഉപയോഗിച്ച് പ്രവേശിക്കാം. പുതിയ അംഗങ്ങൾക്ക് അഡ്മിൻ അനുമതി ആവശ്യമാണ്.',
    signIn:'Google ഉപയോഗിച്ച് പ്രവേശിക്കുക',
    pending:'അംഗത്വ അനുമതി കാത്തിരിക്കുന്നു',
    pendingText:'നിങ്ങളുടെ Google അക്കൗണ്ടിന് അഡ്മിൻ അനുമതി ആവശ്യമാണ്.',
    memberNumber:'അംഗ നമ്പർ',
    request:'അനുമതി അഭ്യർത്ഥിക്കുക',
    due:'കുടിശ്ശിക',
    paid:'അടച്ച മാസങ്ങൾ',
    fee:'അംഗത്വ ഫീസ്',
    history:'പേയ്മെന്റ് ചരിത്രം',
    month:'മാസം',
    status:'നില',
    pay:'അംഗത്വ ഫീസ് അടയ്ക്കുക',
    admin:'അഡ്മിൻ ഡാഷ്ബോർഡ്'
  }
};

$('lang').onchange = () => {
  document.querySelectorAll('[data-t]').forEach(e => {
    e.textContent = dict[$('lang').value][e.dataset.t];
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

const stopListeners = () => {
  unsubscribers.forEach(f => f());
  unsubscribers = [];
  payments = {};
  historicalPayments = {};
  currentMemberData = null;
  historyLoaded = false;
  historyError = false;
};

const isAdmin = () => !!current && admin;

const today = new Date();
$('paymentPeriod').value =
  `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`;

if (!firebaseConfig.databaseURL ||
    firebaseConfig.databaseURL.startsWith('REPLACE_')) {

  notify('Setup needed: add Firebase web configuration in firebase-config.js', true);
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

    ['pending','member','admin'].forEach(id => show(id,false));

    if (!user) return;

    try {

      admin = (await get(ref(db, `admins/${user.uid}`))).val() === true;

      if (admin) {
        show('admin',true);
        loadAdmin();
        return;
      }

      const record =
        (await get(ref(db, `users/${user.uid}`))).val();

      if (record?.status === 'approved' && record.memberNumber) {

        const number = String(record.memberNumber);
        const m =
          (await get(ref(db, `members/${number}`))).val();

        if (m) {

          memberNumber = Number(number);
          currentMemberData = m;

          show('member',true);
          renderMember(m);

          unsubscribers.push(
            onValue(ref(db, `members/${number}`), s => {
              if (s.exists()) {
                currentMemberData = s.val();
                renderMember(currentMemberData);
              }
            }, e => notify(e.message,true))
          );

          // Read the imported 2024-2026 historical payments.
          unsubscribers.push(
            onValue(ref(db, `paymentHistory/${number}`), s => {
              historicalPayments = s.val() || {};
              historyLoaded = true;
              historyError = false;

              if (currentMemberData) {
                renderMember(currentMemberData);
              }
            }, e => {
              historyLoaded = true;
              historyError = true;
              notify('Historical payment access: ' + e.message, true);

              if (currentMemberData) {
                renderMember(currentMemberData);
              }
            })
          );

          unsubscribers.push(
            onValue(
              query(
                ref(db,'paymentRequests'),
                orderByChild('uid'),
                equalTo(user.uid)
              ),
              s => renderMyPayments(s.val() || {}),
              e => notify('Payment history: ' + e.message,true)
            )
          );

          updateUpiLink();
          return;
        }
      }

      show('pending',true);
      $('claimNumber').value = record?.requestedNumber || '';

    } catch(e) {
      notify('Database access error: ' + e.message,true);
    }
  });
}

$('signIn').onclick = async () => {
  try {
    await signInWithPopup(auth,new GoogleAuthProvider());
  } catch(e) {
    notify('Google Login Error: ' + e.message,true);
  }
};

$('logout').onclick = () => signOut(auth);

$('requestApproval').onclick = async () => {

  const n = Number($('claimNumber').value);

  if (!Number.isInteger(n) || n < 1) {
    return notify('Enter valid member number',true);
  }

  try {
    await set(ref(db,`requests/${current.uid}`),{
      uid:current.uid,
      email:current.email || '',
      name:current.displayName || '',
      requestedNumber:n,
      createdAt:Date.now(),
      status:'pending'
    });

    notify('Approval request submitted.');

  } catch(e) {
    notify(e.message,true);
  }
};

// Check a historical month from the PDF import.
function isHistoricalPaid(history, year, month) {

  if (year < 2024 || year > 2026) return false;

  const key = String(month).padStart(2,'0');
  const value = history?.months?.[String(year)]?.[key];

  return value === 'marked_paid' ||
    (value !== null &&
     typeof value === 'object' &&
     (value.status === 'marked_paid' ||
      value.status === 'paid'));
}

function renderMember(m) {

  $('memberTitle').textContent = m.name || 'Member';
  $('memberMeta').textContent =
    'Member #' + (m.number || memberNumber);

  const history = m.payments || {};
  let paid = 0;
  const rows = [];
  const end = new Date();

  for (let y = 2024; y <= end.getFullYear(); y++) {
    for (let month = 1; month <= 12; month++) {

      if (y === end.getFullYear() &&
          month > end.getMonth()+1) continue;

      const key =
        `${y}-${String(month).padStart(2,'0')}`;

      const newStatus = history[key]?.status || 'unverified';
      const oldPaid =
        isHistoricalPaid(historicalPayments,y,month);

      let status;

      if (newStatus === 'paid' || oldPaid) {
        status = 'Paid';
        paid++;
      } else if (newStatus === 'pending') {
        status = 'Pending';
      } else if (!historyLoaded && y <= 2026) {
        status = 'Loading';
      } else if (historyError && y <= 2026) {
        status = 'History unavailable';
      } else {
        status = 'Not verified';
      }

      rows.push(
        `<tr><td>${escapeHTML(key)}</td>` +
        `<td>${escapeHTML(status)}</td></tr>`
      );
    }
  }

  $('paidCount').textContent =
    historyLoaded ? String(paid) : 'Loading';

  // Unmarked PDF months are not confirmed arrears.
  $('dueAmount').textContent = 'Not verified';

  $('historyBody').innerHTML = rows.join('');
}

function loadAdmin() {

  unsubscribers.push(
    onValue(ref(db,'requests'), s => {

      const data = s.val() || {};
      $('requestsList').replaceChildren();

      for (const [uid,r] of Object.entries(data)) {

        if (r.status !== 'pending') continue;

        const box = document.createElement('div');
        box.className = 'panel';

        const p = document.createElement('p');
        p.textContent =
          `${r.name||''} (${r.email||''}) — requested #${r.requestedNumber}`;

        const b = document.createElement('button');
        b.textContent = 'Approve';
        b.onclick = () => approve(uid,r);

        box.append(p,b);
        $('requestsList').append(box);
      }

    },e => notify(e.message,true))
  );

  unsubscribers.push(
    onValue(ref(db,'members'),s => {
      memberList = s.val() || {};
      renderAdminMembers();
    },e => notify(e.message,true))
  );

  unsubscribers.push(
    onValue(ref(db,'paymentRequests'),s => {
      payments = s.val() || {};
      renderAdminPayments();
    },e => notify(e.message,true))
  );
}

async function approve(uid,r) {

  const m = memberList[r.requestedNumber];

  if (!m) {
    return notify('Member number not found in imported records',true);
  }

  if (m.status === 'suspended') {
    return notify('Suspended member: cannot approve',true);
  }

  if (m.uid && m.uid !== uid) {
    return notify('This member is already linked to another account',true);
  }

  if (!confirm(
    `Approve ${r.email} as member #${r.requestedNumber} (${m.name})?`
  )) return;

  try {

    await update(ref(db),{
      [`members/${r.requestedNumber}/uid`]:uid,
      [`users/${uid}`]:{
        status:'approved',
        memberNumber:r.requestedNumber,
        email:r.email
      },
      [`requests/${uid}/status`]:'approved'
    });

    notify('Approved');

  } catch(e) {
    notify(e.message,true);
  }
}

function renderAdminMembers() {

  const q = ($('search').value || '').toLowerCase();

  const rows = Object.entries(memberList)
    .filter(([id,m]) =>
      `${id} ${m.name}`.toLowerCase().includes(q))
    .slice(0,300)
    .map(([id,m]) =>
      `<tr><td>${escapeHTML(id)}</td>` +
      `<td>${escapeHTML(m.name)}</td>` +
      `<td>${m.uid?'Linked':'Not linked'}</td>` +
      `<td>${escapeHTML(m.status||'active')}</td></tr>`
    );

  $('membersList').innerHTML =
    `<table><thead><tr><th>#</th><th>Name</th>` +
    `<th>Login</th><th>Status</th></tr></thead>` +
    `<tbody>${rows.join('')}</tbody></table>`;
}

$('search').oninput = renderAdminMembers;

function tab(which) {
  ['requests','members','payments'].forEach(x =>
    show(x+'Panel',x===which));
}

$('tabRequests').onclick = () => tab('requests');
$('tabMembers').onclick = () => tab('members');
$('tabPayments').onclick = () => tab('payments');

// Existing UPI settings preserved.
const UPI_ID = 'waheedwahi84-1@oksbi';
const UPI_NAME = 'Waheed Wahi';

function planDetails() {

  const plan = $('paymentPlan').value;
  const amount = plan === 'yearly' ? 600 : 50;
  const period = $('paymentPeriod').value;

  return {plan,amount,period};
}

function updateUpiLink() {

  const {plan,amount,period} = planDetails();

  const params = new URLSearchParams({
    pa:UPI_ID,
    pn:UPI_NAME,
    am:String(amount),
    cu:'INR',
    tn:`TFC ${memberNumber||''} ${plan} ${period}`
  });

  $('upiPayLink').href = `upi://pay?${params.toString()}`;
  $('upiPayLink').textContent =
    `Open UPI app — ₹${amount}`;
}

$('paymentPlan').onchange = updateUpiLink;
$('paymentPeriod').onchange = updateUpiLink;

updateUpiLink();

$('submitPayment').onclick = async () => {

  if (!current || !memberNumber || admin) {
    return notify('Member login required',true);
  }

  const {plan,amount,period} = planDetails();
  const transactionId = $('transactionId').value.trim();

  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    return notify('Select a valid payment month/year',true);
  }

  if (transactionId.length < 6 || transactionId.length > 100) {
    return notify('Enter a valid UPI transaction ID (at least 6 characters)',true);
  }

  if (!confirm(
    `Submit ₹${amount} for ${period} as Pending? Please submit only after paying.`
  )) return;

  $('submitPayment').disabled = true;

  try {

    const id = push(ref(db,'paymentRequests')).key;

    await set(ref(db,`paymentRequests/${id}`),{
      uid:current.uid,
      memberNumber,
      plan,
      amount,
      period,
      transactionId,
      status:'pending',
      createdAt:Date.now()
    });

    $('transactionId').value = '';
    notify('Submitted for admin verification.');

  } catch(e) {
    notify('Submission failed: ' + e.message,true);
  } finally {
    $('submitPayment').disabled = false;
  }
};

function renderAdminPayments() {

  const container = $('adminPaymentList');
  container.replaceChildren();

  const pending = Object.entries(payments)
    .filter(([,p]) => p.status === 'pending')
    .sort((a,b) =>
      (a[1].createdAt||0)-(b[1].createdAt||0));

  if (!pending.length) {
    container.textContent =
      'No pending payment submissions.';
    return;
  }

  for (const [id,p] of pending) {

    const box = document.createElement('div');
    box.className = 'panel';

    const info = document.createElement('p');
    info.textContent =
      `#${p.memberNumber} — ${memberList[p.memberNumber]?.name||''}` +
      ` | ₹${p.amount} | ${p.plan} ${p.period}` +
      ` | UPI Ref: ${p.transactionId}`;

    const approveButton = document.createElement('button');
    approveButton.textContent =
      'Approve after bank verification';
    approveButton.onclick =
      () => verifyPayment(id,p,true);

    const rejectButton = document.createElement('button');
    rejectButton.className = 'secondary';
    rejectButton.textContent = 'Reject';
    rejectButton.onclick =
      () => verifyPayment(id,p,false);

    box.append(
      info,
      approveButton,
      document.createTextNode(' '),
      rejectButton
    );

    container.append(box);
  }
}

async function verifyPayment(id,p,accept) {

  if (!isAdmin() || p.status !== 'pending') return;

  if (!confirm(
    accept
      ? `Have you verified ₹${p.amount} in the bank statement? Approve #${p.memberNumber}, ${p.period}?`
      : `Reject payment request for #${p.memberNumber}?`
  )) return;

  try {

    const fresh =
      (await get(ref(db,`paymentRequests/${id}`))).val();

    if (!fresh || fresh.status !== 'pending') {
      return notify('This request is no longer pending.',true);
    }

    if (!accept) {

      await update(ref(db,`paymentRequests/${id}`),{
        status:'rejected',
        reviewedAt:Date.now(),
        reviewedBy:current.uid
      });

      notify('Payment rejected.');
      return;
    }

    const memberSnapshot =
      await get(ref(db,`members/${p.memberNumber}`));

    const member = memberSnapshot.val();

    if (!member) {
      return notify('Member not found',true);
    }

    const start = new Date(`${p.period}-01T00:00:00`);

    if (Number.isNaN(start.getTime())) {
      return notify('Invalid payment period',true);
    }

    const keys = [];

    for (let i=0; i<(p.plan==='yearly'?12:1); i++) {

      const d = new Date(
        start.getFullYear(),
        start.getMonth()+i,
        1
      );

      keys.push(
        `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
      );
    }

    // Read the correct member's historical records.
    const oldHistory =
      (await get(ref(db,`paymentHistory/${p.memberNumber}`))).val() || {};

    const duplicate = keys.some(key => {

      const [year,month] = key.split('-').map(Number);

      return member.payments?.[key]?.status === 'paid' ||
        isHistoricalPaid(oldHistory,year,month);
    });

    if (duplicate) {
      return notify(
        'Some months are already paid in current or historical records. Review before approving.',
        true
      );
    }

    const changes = {};

    for (const key of keys) {

      changes[`members/${p.memberNumber}/payments/${key}`] = {
        status:'paid',
        amount:50,
        transactionId:p.transactionId,
        requestId:id,
        verifiedAt:Date.now(),
        verifiedBy:current.uid
      };
    }

    changes[`paymentRequests/${id}/status`] = 'approved';
    changes[`paymentRequests/${id}/reviewedAt`] = Date.now();
    changes[`paymentRequests/${id}/reviewedBy`] = current.uid;

    await update(ref(db),changes);

    notify('Payment approved and months marked Paid.');

  } catch(e) {
    notify('Payment review failed: ' + e.message,true);
  }
}

function renderMyPayments(data) {

  const entries = Object.values(data)
    .sort((a,b) =>
      (b.createdAt||0)-(a.createdAt||0));

  $('myPaymentList').innerHTML = entries.length
    ? `<table><thead><tr><th>Period</th><th>Amount</th><th>Status</th></tr></thead><tbody>${
        entries.map(p =>
          `<tr><td>${escapeHTML(p.period)} (${escapeHTML(p.plan)})</td>` +
          `<td>₹${Number(p.amount)||0}</td>` +
          `<td>${escapeHTML(p.status)}</td></tr>`
        ).join('')
      }</tbody></table>`
    : 'No payment submissions yet.';
}
