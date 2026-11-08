
/* TFC BANDIYOD - ACCOUNTS v83.3
   Membership reconciliation + manual ledger
   Historical PDF amounts are estimates, not bank cash flow.
   Existing payment records are never modified.
*/

import { initializeApp, getApps } from
  "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";

import { getAuth, onAuthStateChanged } from
  "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

import {
  getDatabase, ref, get, onValue, push, set,
  serverTimestamp
} from
  "https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js";

import { firebaseConfig } from "./firebase-config.js";

const app = getApps().length
  ? getApps()[0]
  : initializeApp(firebaseConfig);

const auth = getAuth(app);
const db = getDatabase(app);

const $ = id => document.getElementById(id);
const FEE = 50;

let user = null;
let admin = false;
let approved = false;
let entries = {};
let members = {};
let histories = {};
let corrections = {};

let loaded = {
  entries: false,
  members: false,
  histories: false,
  corrections: false
};

let unsubscribers = [];
let generation = 0;
let saving = false;

const esc = value =>
  String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);

const money = value =>
  "₹" + Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

function today() {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0")
  ].join("-");
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + "T00:00:00");
  return !isNaN(d) &&
    d.getFullYear() === Number(value.slice(0, 4)) &&
    d.getMonth() + 1 === Number(value.slice(5, 7)) &&
    d.getDate() === Number(value.slice(8, 10));
}

function validPeriod(p) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(p);
}

function stat(id, value) {
  if ($(id)) $(id).textContent = money(value);
}

function status(message) {
  if ($("accMessage")) {
    $("accMessage").textContent = message;
  }
}

function setup() {
  const adminRoot = $("admin");
  const memberRoot = $("member");

  if (!adminRoot || !memberRoot) return;

  if (!$("accountsPanel")) {
    const panel = document.createElement("div");
    panel.id = "accountsPanel";
    panel.className = "panel hide";

    panel.innerHTML = `
      <h2>TFC Accounts v83.3</h2>
      <p class="muted">
        Membership income includes effective paid months.
        Historical PDF amounts are estimated at ₹50/month,
        not verified cash receipts.
      </p>

      <div class="grid">
        <div class="stat">
          <span>Membership Income</span>
          <strong id="accMembership">₹0</strong>
        </div>
        <div class="stat">
          <span>Other Income</span>
          <strong id="accIncome">₹0</strong>
        </div>
        <div class="stat">
          <span>Expenses</span>
          <strong id="accExpense">₹0</strong>
        </div>
        <div class="stat">
          <span>Calculated Balance</span>
          <strong id="accBalance">₹0</strong>
        </div>
      </div>

      <p id="accSummaryNote" class="muted"></p>

      <h3>Add Income / Expense</h3>

      <form id="accForm">
        <label>Type</label>
        <select id="accType" required>
          <option value="income">Other Income</option>
          <option value="expense">Expense</option>
        </select>

        <label>Date</label>
        <input id="accDate" type="date" required>

        <label>Category</label>
        <input id="accCategory" maxlength="80"
          placeholder="Donation, Office, Travel" required>

        <label>Particulars</label>
        <input id="accParticulars" maxlength="500"
          placeholder="Transaction details" required>

        <label>Amount (₹)</label>
        <input id="accAmount" type="number"
          min="0.01" max="10000000"
          step="0.01" required>

        <label>Payment Method</label>
        <select id="accMethod" required>
          <option value="cash">Cash</option>
          <option value="upi">UPI</option>
          <option value="bank">Bank</option>
          <option value="other">Other</option>
        </select>

        <p>
          <button id="accSave" type="submit">
            Save Transaction
          </button>
        </p>
      </form>

      <p id="accMessage" role="status"></p>

      <h3>Transaction History</h3>
      <label>Filter by Year</label>
      <select id="accYear">
        <option value="all">All Years</option>
      </select>

      <div id="accTable" class="scroll"></div>
    `;

    adminRoot.appendChild(panel);
  }

  if (!$("memberAccountsPanel")) {
    const panel = document.createElement("div");
    panel.id = "memberAccountsPanel";
    panel.className = "panel hide";

    panel.innerHTML = `
      <h2>TFC Accounts - Transparency</h2>
      <p class="muted">
        Read-only income and expense ledger.
        Membership totals require a secure shared summary.
      </p>

      <div class="grid">
        <div class="stat">
          <span>Other Income</span>
          <strong id="memberAccIncome">₹0</strong>
        </div>
        <div class="stat">
          <span>Expenses</span>
          <strong id="memberAccExpense">₹0</strong>
        </div>
        <div class="stat">
          <span>Net Manual Entries</span>
          <strong id="memberAccBalance">₹0</strong>
        </div>
      </div>

      <h3>Income and Expense Ledger</h3>
      <div id="memberAccTable" class="scroll"></div>
    `;

    memberRoot.appendChild(panel);
  }

  $("accDate").value = today();
  $("accForm").addEventListener("submit", saveEntry);
  $("accYear").addEventListener("change", render);

  const tabBar = $("tabMembers")?.parentElement;

  if (tabBar && !$("tabAccounts")) {
    const tab = document.createElement("button");
    tab.id = "tabAccounts";
    tab.type = "button";
    tab.className = "secondary";
    tab.textContent = "Accounts";
    tabBar.appendChild(tab);

    tab.addEventListener("click", () => {
      if (!admin) return;

      [
        "requestsPanel",
        "membersPanel",
        "paymentsPanel",
        "addMemberPanel",
        "archivedMembersPanel",
        "memberPhotosPanel",
        "cashPanel",
        "correctionPanel"
      ].forEach(id => $(id)?.classList.add("hide"));

      $("accountsPanel").classList.remove("hide");

      tabBar.querySelectorAll("button").forEach(b =>
        b.classList.add("secondary")
      );

      tab.classList.remove("secondary");
    });

    tabBar.addEventListener("click", event => {
      const clicked = event.target.closest("button");
      if (clicked && clicked !== tab) {
        $("accountsPanel")?.classList.add("hide");
        tab.classList.add("secondary");
      }
    });
  }
}

function showAccess() {
  $("memberAccountsPanel")?.classList.toggle(
    "hide", !user || admin || !approved
  );

  if (!admin) {
    $("accountsPanel")?.classList.add("hide");
  }
}

/* Membership calculation:
   one member + one month = one counted fee.
   Original PDF and member payment duplicates collapse.
   Cancelled months are excluded.
*/

function historicalPaid(record) {
  return record === "marked_paid" ||
    (record && typeof record === "object" &&
      ["marked_paid", "paid"].includes(record.status));
}

function membershipRows() {
  const rows = [];

  for (const [number, member] of Object.entries(members)) {
    const periods = new Set();
    const history = histories[number] || {};
    const memberCorrections = corrections[number] || {};

    for (const [year, months] of Object.entries(
      history.months || {}
    )) {
      if (!/^\d{4}$/.test(year) || !months) continue;

      for (const [month, record] of Object.entries(months)) {
        const period = `${year}-${month.padStart(2, "0")}`;

        if (validPeriod(period) && historicalPaid(record)) {
          periods.add(period);
        }
      }
    }

    for (const [period, payment] of Object.entries(
      member?.payments || {}
    )) {
      if (validPeriod(period) && payment?.status === "paid") {
        periods.add(period);
      }
    }

    for (const period of periods) {
      if (memberCorrections[period]?.state === "cancelled") {
        continue;
      }

      rows.push({
        memberNumber: number,
        period,
        amount: FEE
      });
    }
  }

  return rows;
}

function manualRows() {
  return Object.entries(entries)
    .filter(([, item]) => item && typeof item === "object")
    .map(([id, item]) => ({ id, ...item }))
    .sort((a, b) =>
      String(b.date || "").localeCompare(String(a.date || "")) ||
      Number(b.createdAt || 0) - Number(a.createdAt || 0)
    );
}

function transactionTable(items) {
  if (!items.length) {
    return '<p class="muted">No transactions recorded.</p>';
  }

  return `
    <table>
      <thead>
        <tr>
          <th>Date / Period</th>
          <th>Type</th>
          <th>Category</th>
          <th>Particulars</th>
          <th>Amount</th>
          <th>Method</th>
        </tr>
      </thead>
      <tbody>
        ${items.map(item => `
          <tr>
            <td>${esc(item.date || item.period)}</td>
            <td>${esc(item.type)}</td>
            <td>${esc(item.category)}</td>
            <td>${esc(item.particulars)}</td>
            <td>${money(item.amount)}</td>
            <td>${esc(item.method)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function render() {
  const manual = manualRows();

  const membershipReady = admin &&
    loaded.members &&
    loaded.histories &&
    loaded.corrections;

  const membership = membershipReady
    ? membershipRows()
    : [];

  const years = new Set();

  for (const item of manual) {
    const y = String(item.date || "").slice(0, 4);
    if (/^\d{4}$/.test(y)) years.add(y);
  }

  for (const item of membership) {
    years.add(item.period.slice(0, 4));
  }

  const yearSelect = $("accYear");
  let selectedYear = "all";

  if (yearSelect) {
    const previous = yearSelect.value;

    const sortedYears = [...years].sort().reverse();

    yearSelect.innerHTML =
      '<option value="all">All Years</option>' +
      sortedYears.map(y =>
        `<option value="${y}">${y}</option>`
      ).join("");

    yearSelect.value = sortedYears.includes(previous)
      ? previous
      : "all";

    selectedYear = yearSelect.value;
  }

  const filteredManual = manual.filter(item =>
    selectedYear === "all" ||
    String(item.date || "").startsWith(selectedYear)
  );

  const filteredMembership = membership.filter(item =>
    selectedYear === "all" ||
    item.period.startsWith(selectedYear)
  );

  let income = 0;
  let expense = 0;

  for (const item of filteredManual) {
    const amount = Number(item.amount);

    if (!Number.isFinite(amount) || amount <= 0) continue;

    if (item.type === "income") income += amount;
    if (item.type === "expense") expense += amount;
  }

  const membershipIncome = filteredMembership.reduce(
    (sum, item) => sum + item.amount, 0
  );

  stat("accMembership", membershipIncome);
  stat("accIncome", income);
  stat("accExpense", expense);

  if ($("accBalance")) {
    $("accBalance").textContent = membershipReady
      ? money(membershipIncome + income - expense)
      : "Loading / Unavailable";
  }

  const note = $("accSummaryNote");

  if (note) {
    note.textContent = membershipReady
      ? `${filteredMembership.length} effective paid member-months. ` +
        `This is a calculated ledger balance, not a verified bank balance.`
      : "Membership data is loading or access is unavailable. " +
        "Do not use the displayed totals as final accounts.";
  }

  // Members see manual entries only until a secure
  // server-generated membership summary is available.
  const memberIncome = manual.reduce((sum, item) =>
    sum + (item.type === "income" &&
      Number.isFinite(Number(item.amount))
      ? Math.max(0, Number(item.amount)) : 0), 0);

  const memberExpense = manual.reduce((sum, item) =>
    sum + (item.type === "expense" &&
      Number.isFinite(Number(item.amount))
      ? Math.max(0, Number(item.amount)) : 0), 0);

  stat("memberAccIncome", memberIncome);
  stat("memberAccExpense", memberExpense);
  stat("memberAccBalance", memberIncome - memberExpense);

  const rows = [
    ...filteredMembership.map(item => ({
      date: item.period,
      type: "income",
      category: "Membership Fee",
      particulars: `Member #${item.memberNumber} - Paid Month`,
      amount: item.amount,
      method: "Recorded"
    })),
    ...filteredManual
  ].sort((a, b) =>
    String(b.date || "").localeCompare(String(a.date || ""))
  );

  if ($("accTable")) {
    $("accTable").innerHTML = membershipReady
      ? transactionTable(rows)
      : transactionTable(filteredManual);
  }

  if ($("memberAccTable")) {
    $("memberAccTable").innerHTML = transactionTable(manual);
  }
}

async function saveEntry(event) {
  event.preventDefault();

  if (!user || !admin || saving) return;

  const sessionUid = user.uid;
  const type = $("accType").value;
  const date = $("accDate").value;
  const category = $("accCategory").value.trim();
  const particulars = $("accParticulars").value.trim();
  const amount = Number($("accAmount").value);
  const method = $("accMethod").value;

  const valid =
    ["income", "expense"].includes(type) &&
    validDate(date) &&
    category.length >= 2 &&
    category.length <= 80 &&
    !/membership|member\s*fee|subscription/i.test(category) &&
    particulars.length >= 3 &&
    particulars.length <= 500 &&
    Number.isFinite(amount) &&
    amount > 0 &&
    amount <= 10000000 &&
    Math.round(amount * 100) === amount * 100 &&
    ["cash", "upi", "bank", "other"].includes(method);

  if (!valid) {
    status("Please check the transaction details. Membership fees must use the payment system.");
    return;
  }

  if (!confirm(
    `Save ${type} of ${money(amount)}?\n` +
    "This entry cannot be edited or deleted from this panel."
  )) return;

  saving = true;
  $("accSave").disabled = true;
  status("Saving...");

  try {
    if (auth.currentUser?.uid !== sessionUid) {
      throw Error("Login session changed.");
    }

    const entryRef = push(ref(db, "accounts/entries"));

    await set(entryRef, {
      type,
      date,
      category,
      particulars,
      amount,
      method,
      createdAt: serverTimestamp(),
      createdBy: sessionUid
    });

    status("Transaction saved. ID: " + entryRef.key);

    $("accForm").reset();
    $("accDate").value = today();

  } catch (error) {
    console.error(error);
    status("Save failed: " + (error.code || error.message));

  } finally {
    saving = false;
    $("accSave").disabled = false;
  }
}

function stopListening() {
  for (const unsubscribe of unsubscribers) {
    try { unsubscribe(); } catch (_) {}
  }

  unsubscribers = [];

  entries = {};
  members = {};
  histories = {};
  corrections = {};

  loaded = {
    entries: false,
    members: false,
    histories: false,
    corrections: false
  };

  render();
}

function listen(path, assign, loadedKey, authId) {
  const unsubscribe = onValue(
    ref(db, path),
    snapshot => {
      if (authId !== generation) return;

      assign(snapshot.val() || {});
      loaded[loadedKey] = true;
      render();
    },
    error => {
      if (authId !== generation) return;

      loaded[loadedKey] = false;
      console.error("Accounts read:", path, error);
      status("Read failed at " + path + ": " + error.message);
      render();
    }
  );

  unsubscribers.push(unsubscribe);
}

onAuthStateChanged(auth, async account => {
  const authId = ++generation;

  stopListening();

  user = account;
  admin = false;
  approved = false;

  if (!account) {
    showAccess();
    return;
  }

  try {
    const adminSnap = await get(
      ref(db, "admins/" + account.uid)
    );

    if (authId !== generation) return;

    admin = adminSnap.val() === true;

    if (!admin) {
      const userSnap = await get(
        ref(db, "users/" + account.uid)
      );

      if (authId !== generation) return;

      approved = userSnap.val()?.status === "approved";
    }

    showAccess();

    if (!admin && !approved) return;

    listen(
      "accounts/entries",
      value => { entries = value; },
      "entries",
      authId
    );

    if (admin) {
      listen(
        "members",
        value => { members = value; },
        "members",
        authId
      );

      listen(
        "paymentHistory",
        value => { histories = value; },
        "histories",
        authId
      );

      listen(
        "paymentCorrections",
        value => { corrections = value; },
        "corrections",
        authId
      );
    }

  } catch (error) {
    console.error("Accounts authentication:", error);
    status("Accounts access failed: " + error.message);
    showAccess();
  }
});

setup();
render();
