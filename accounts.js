
/*
 TFC BANDIYOD ACCOUNTS v83.4
 START DATE: 2026-11-08

 - No historical PDF income
 - New cash receipts from start date
 - New approved UPI receipts from start date
 - Cancelled member-months excluded
 - Manual income and expenses from start date
 - No changes to existing payment records
 - Member ledger is read-only
 - Admin can add manual entries
*/

import {
  initializeApp,
  getApps
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

import {
  getDatabase,
  ref,
  get,
  onValue,
  push,
  set,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js";

import { firebaseConfig } from "./firebase-config.js";

const app = getApps().length
  ? getApps()[0]
  : initializeApp(firebaseConfig);

const auth = getAuth(app);
const db = getDatabase(app);

const START_DATE = "2026-11-08";
const MONTHLY_FEE = 50;

const $ = id => document.getElementById(id);

let user = null;
let isAdmin = false;
let isApproved = false;

let entries = {};
let members = {};
let corrections = {};
let paymentRequests = {};

let loaded = {
  entries: false,
  members: false,
  corrections: false,
  requests: false
};

let listeners = [];
let authVersion = 0;
let saving = false;

function localDate(ms = Date.now()) {
  const d = new Date(ms);

  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0")
  ].join("-");
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const d = new Date(value + "T00:00:00");

  return !isNaN(d) &&
    d.getFullYear() === Number(value.slice(0, 4)) &&
    d.getMonth() + 1 === Number(value.slice(5, 7)) &&
    d.getDate() === Number(value.slice(8, 10));
}

function escapeHTML(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[c])
  );
}

function money(value) {
  return "₹" + Number(value || 0).toLocaleString(
    "en-IN",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }
  );
}

function setText(id, value) {
  if ($(id)) $(id).textContent = value;
}

function message(value) {
  setText("accMessage", value);
}

function createUI() {
  const adminRoot = $("admin");
  const memberRoot = $("member");

  if (!adminRoot || !memberRoot) return;

  if (!$("accountsPanel")) {
    const panel = document.createElement("div");

    panel.id = "accountsPanel";
    panel.className = "panel hide";

    panel.innerHTML = `
      <h2>TFC Accounts</h2>

      <p>
        Accounts Starting Date:
        <strong>08-11-2026</strong>
      </p>

      <div class="grid">
        <div class="stat">
          <span>Membership Income</span>
          <strong id="accMembership">₹0</strong>
        </div>

        <div class="stat">
          <span>Other Income</span>
          <strong id="accOtherIncome">₹0</strong>
        </div>

        <div class="stat">
          <span>Expenses</span>
          <strong id="accExpenses">₹0</strong>
        </div>

        <div class="stat">
          <span>Balance</span>
          <strong id="accBalance">₹0</strong>
        </div>

        <div class="stat">
          <span>Today's Income</span>
          <strong id="accTodayIncome">₹0</strong>
        </div>
      </div>

      <p id="accStatus" class="muted"></p>

      <h3>Add Income / Expense</h3>

      <form id="accForm">

        <label>Type</label>
        <select id="accType" required>
          <option value="income">Other Income</option>
          <option value="expense">Expense</option>
        </select>

        <label>Date</label>
        <input
          id="accDate"
          type="date"
          min="2026-11-08"
          required
        >

        <label>Category</label>
        <input
          id="accCategory"
          maxlength="80"
          placeholder="Donation / Office / Other"
          required
        >

        <label>Particulars</label>
        <input
          id="accParticulars"
          maxlength="500"
          placeholder="Enter details"
          required
        >

        <label>Amount</label>
        <input
          id="accAmount"
          type="number"
          min="0.01"
          max="10000000"
          step="0.01"
          required
        >

        <label>Method</label>
        <select id="accMethod">
          <option value="cash">Cash</option>
          <option value="upi">UPI</option>
          <option value="bank">Bank</option>
          <option value="other">Other</option>
        </select>

        <button id="accSave" type="submit">
          Save Transaction
        </button>
      </form>

      <p id="accMessage" role="status"></p>

      <h3>Income / Expense History</h3>

      <label>Year</label>
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
      <h2>TFC Accounts</h2>

      <p>
        Records from 08-11-2026
      </p>

      <div class="grid">
        <div class="stat">
          <span>Other Income</span>
          <strong id="memberAccIncome">₹0</strong>
        </div>

        <div class="stat">
          <span>Expenses</span>
          <strong id="memberAccExpenses">₹0</strong>
        </div>

        <div class="stat">
          <span>Net Manual Entries</span>
          <strong id="memberAccBalance">₹0</strong>
        </div>
      </div>

      <p class="muted">
        Membership income is available in the admin
        reconciliation report. A secure member-wide
        membership summary is not yet enabled.
      </p>

      <h3>Income / Expense History</h3>

      <div id="memberAccTable" class="scroll"></div>
    `;

    memberRoot.appendChild(panel);
  }

  $("accDate").value = localDate();
  $("accForm").onsubmit = saveManualEntry;
  $("accYear").onchange = render;

  const tabs = $("tabMembers")?.parentElement;

  if (tabs && !$("tabAccounts")) {
    const tab = document.createElement("button");

    tab.id = "tabAccounts";
    tab.type = "button";
    tab.className = "secondary";
    tab.textContent = "Accounts";

    tabs.appendChild(tab);

    tab.onclick = () => {
      if (!isAdmin) return;

      [
        "requestsPanel",
        "membersPanel",
        "paymentsPanel",
        "addMemberPanel",
        "archivedMembersPanel",
        "memberPhotosPanel",
        "cashPanel",
        "correctionPanel"
      ].forEach(id => {
        $(id)?.classList.add("hide");
      });

      $("accountsPanel").classList.remove("hide");
    };

    tabs.addEventListener("click", event => {
      const clicked = event.target.closest("button");

      if (clicked && clicked !== tab) {
        $("accountsPanel")?.classList.add("hide");
      }
    });
  }
}

function accessUI() {
  $("accountsPanel")?.classList.add("hide");

  $("memberAccountsPanel")?.classList.toggle(
    "hide",
    !user || isAdmin || !isApproved
  );
}

function manualRows() {
  return Object.entries(entries)
    .filter(([, item]) =>
      item &&
      validDate(item.date) &&
      item.date >= START_DATE &&
      ["income", "expense"].includes(item.type) &&
      Number.isFinite(Number(item.amount)) &&
      Number(item.amount) > 0
    )
    .map(([id, item]) => ({
      id,
      date: item.date,
      type: item.type,
      category: item.category || "",
      particulars: item.particulars || "",
      amount: Number(item.amount),
      method: item.method || ""
    }));
}

/*
 Membership payment sources:

 Cash:
 members/{number}/payments/{period}
 method: cash
 receivedDate: YYYY-MM-DD

 UPI:
 members/{number}/payments/{period}
 requestId: paymentRequests ID
 verifiedAt: timestamp

 Only approved UPI requests count.
 Each paid month is counted once.
 Historical PDF records are not included.
*/

function membershipRows() {
  const rows = [];

  for (const [number, member] of Object.entries(members)) {
    const memberCorrections = corrections[number] || {};

    for (const [period, payment] of Object.entries(
      member?.payments || {}
    )) {
      if (
        !/^\d{4}-(0[1-9]|1[0-2])$/.test(period) ||
        payment?.status !== "paid"
      ) continue;

      if (
        memberCorrections[period]?.state === "cancelled"
      ) continue;

      let date = "";
      let method = "";
      let verified = false;

      if (payment.method === "cash") {
        date = payment.receivedDate || "";

        verified =
          validDate(date) &&
          date >= START_DATE &&
          Number(payment.verifiedAt) > 0 &&
          localDate(Number(payment.verifiedAt)) >= START_DATE;

        method = "Cash";
      } else if (payment.requestId) {
        const request = paymentRequests[payment.requestId];

        if (
          request?.status === "approved" &&
          String(request.memberNumber) === String(number) &&
          Number(request.reviewedAt) > 0 &&
          Number(payment.verifiedAt) > 0
        ) {
          date = localDate(Number(request.reviewedAt));

          verified =
            date >= START_DATE &&
            localDate(Number(payment.verifiedAt)) >= START_DATE;

          method = "UPI";
        }
      }

      if (!verified) continue;

      rows.push({
        date,
        period,
        type: "income",
        category: "Membership Fee",
        particulars: "Membership Fee - " + period,
        amount: MONTHLY_FEE,
        method,
        source: "membership"
      });
    }
  }

  return rows;
}

function tableHTML(rows) {
  if (!rows.length) {
    return "<p>No records available.</p>";
  }

  return `
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Type</th>
          <th>Category</th>
          <th>Particulars</th>
          <th>Amount</th>
          <th>Method</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(row => `
          <tr>
            <td>${escapeHTML(row.date)}</td>
            <td>${escapeHTML(row.type)}</td>
            <td>${escapeHTML(row.category)}</td>
            <td>${escapeHTML(row.particulars)}</td>
            <td>${money(row.amount)}</td>
            <td>${escapeHTML(row.method)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function sum(rows, type) {
  return rows.reduce(
    (total, row) =>
      total + (
        row.type === type
          ? Number(row.amount) || 0
          : 0
      ),
    0
  );
}

function render() {
  const manual = manualRows();

  const membershipReady =
    isAdmin &&
    loaded.members &&
    loaded.corrections &&
    loaded.requests;

  const membership = membershipReady
    ? membershipRows()
    : [];

  const allRows = [
    ...membership,
    ...manual
  ];

  const yearSelect = $("accYear");
  let selectedYear = "all";

  if (yearSelect) {
    const old = yearSelect.value;

    const years = [...new Set(
      allRows.map(r => r.date.slice(0, 4))
    )].sort().reverse();

    yearSelect.replaceChildren(
      new Option("All Years", "all"),
      ...years.map(y => new Option(y, y))
    );

    yearSelect.value = years.includes(old)
      ? old
      : "all";

    selectedYear = yearSelect.value;
  }

  const filterYear = row =>
    selectedYear === "all" ||
    row.date.startsWith(selectedYear);

  const filteredManual = manual.filter(filterYear);
  const filteredMembership = membership.filter(filterYear);

  const otherIncome = sum(filteredManual, "income");
  const expenses = sum(filteredManual, "expense");
  const membershipIncome = sum(filteredMembership, "income");

  const combined = [
    ...filteredManual,
    ...filteredMembership
  ].sort((a, b) => b.date.localeCompare(a.date));

  const todayIncome = sum(
    combined.filter(r => r.date === localDate()),
    "income"
  );

  setText("accOtherIncome", money(otherIncome));
  setText("accExpenses", money(expenses));

  setText(
    "accMembership",
    membershipReady
      ? money(membershipIncome)
      : "Loading / Unavailable"
  );

  setText(
    "accBalance",
    membershipReady
      ? money(membershipIncome + otherIncome - expenses)
      : "Loading / Unavailable"
  );

  setText(
    "accTodayIncome",
    membershipReady
      ? money(todayIncome)
      : "Loading / Unavailable"
  );

  setText(
    "accStatus",
    membershipReady
      ? "Accounts from 08-11-2026. Historical PDF payments excluded. Balance is a calculated ledger balance, not a verified bank balance."
      : "Membership records are loading or unavailable. Totals are not final."
  );

  if ($("accTable")) {
    $("accTable").innerHTML = membershipReady
      ? tableHTML(combined)
      : tableHTML(filteredManual);
  }

  const memberIncome = sum(manual, "income");
  const memberExpenses = sum(manual, "expense");

  setText("memberAccIncome", money(memberIncome));
  setText("memberAccExpenses", money(memberExpenses));

  setText(
    "memberAccBalance",
    money(memberIncome - memberExpenses)
  );

  if ($("memberAccTable")) {
    $("memberAccTable").innerHTML = tableHTML(
      [...manual].sort(
        (a, b) => b.date.localeCompare(a.date)
      )
    );
  }
}

async function saveManualEntry(event) {
  event.preventDefault();

  if (!user || !isAdmin || saving) return;

  const uid = user.uid;

  const type = $("accType").value;
  const date = $("accDate").value;
  const category = $("accCategory").value.trim();
  const particulars = $("accParticulars").value.trim();
  const amount = Number($("accAmount").value);
  const method = $("accMethod").value;

  if (
    !["income", "expense"].includes(type) ||
    !validDate(date) ||
    date < START_DATE ||
    category.length < 2 ||
    category.length > 80 ||
    /membership|member\s*fee|subscription/i.test(category) ||
    particulars.length < 3 ||
    particulars.length > 500 ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    amount > 10000000 ||
    Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001 ||
    !["cash", "upi", "bank", "other"].includes(method)
  ) {
    message("Check transaction details. Membership fees must use the payment system.");
    return;
  }

  if (!confirm(
    `Save transaction?\n\n` +
    `Type: ${type}\n` +
    `Date: ${date}\n` +
    `Amount: ${money(amount)}\n` +
    `Particulars: ${particulars}`
  )) return;

  saving = true;
  $("accSave").disabled = true;

  try {
    if (auth.currentUser?.uid !== uid) {
      throw Error("Login session changed.");
    }

    const newRef = push(ref(db, "accounts/entries"));

    await set(newRef, {
      type,
      date,
      category,
      particulars,
      amount,
      method,
      createdAt: serverTimestamp(),
      createdBy: uid
    });

    message("Transaction saved successfully.");

    $("accForm").reset();
    $("accDate").value = localDate();

  } catch (error) {
    message("Save failed: " + error.message);

  } finally {
    saving = false;
    $("accSave").disabled = false;
  }
}

function clearListeners() {
  for (const stop of listeners) {
    try {
      stop();
    } catch (_) {}
  }

  listeners = [];

  entries = {};
  members = {};
  corrections = {};
  paymentRequests = {};

  loaded = {
    entries: false,
    members: false,
    corrections: false,
    requests: false
  };
}

function listen(path, key, callback, version) {
  const stop = onValue(
    ref(db, path),
    snapshot => {
      if (version !== authVersion) return;

      callback(snapshot.val() || {});
      loaded[key] = true;

      render();
    },
    error => {
      if (version !== authVersion) return;

      loaded[key] = false;
      console.error("Accounts:", path, error);

      message(
        "Unable to read " + path + ": " + error.message
      );

      render();
    }
  );

  listeners.push(stop);
}

onAuthStateChanged(auth, async account => {
  const version = ++authVersion;

  clearListeners();

  user = account;
  isAdmin = false;
  isApproved = false;

  accessUI();
  render();

  if (!account) return;

  try {
    const adminSnap = await get(
      ref(db, "admins/" + account.uid)
    );

    if (version !== authVersion) return;

    isAdmin = adminSnap.val() === true;

    if (!isAdmin) {
      const userSnap = await get(
        ref(db, "users/" + account.uid)
      );

      if (version !== authVersion) return;

      isApproved =
        userSnap.val()?.status === "approved";
    }

    accessUI();

    if (!isAdmin && !isApproved) return;

    listen(
      "accounts/entries",
      "entries",
      value => { entries = value; },
      version
    );

    if (isAdmin) {
      listen(
        "members",
        "members",
        value => { members = value; },
        version
      );

      listen(
        "paymentCorrections",
        "corrections",
        value => { corrections = value; },
        version
      );

      listen(
        "paymentRequests",
        "requests",
        value => { paymentRequests = value; },
        version
      );
    }

  } catch (error) {
    console.error(error);
    message("Accounts login error: " + error.message);
  }
});

createUI();
render();

/* END - TFC ACCOUNTS v83.4 */
