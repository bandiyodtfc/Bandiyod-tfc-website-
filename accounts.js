
/* TFC BANDIYOD - ACCOUNTS v83.2 */

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";

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
  set
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js";

import { firebaseConfig } from "./firebase-config.js";

const app = getApps().length
  ? getApps()[0]
  : initializeApp(firebaseConfig);

const auth = getAuth(app);
const db = getDatabase(app);

const $ = id => document.getElementById(id);

let user = null;
let admin = false;
let approved = false;
let entries = {};
let unsubscribe = null;
let saving = false;
let authGeneration = 0;

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);
}

function money(value) {
  return "₹" + Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function today() {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0")
  ].join("-");
}

function setup() {
  const adminRoot = $("admin");
  const memberRoot = $("member");

  if (!adminRoot || !memberRoot) return;

  const adminPanel = document.createElement("div");
  adminPanel.id = "accountsPanel";
  adminPanel.className = "panel hide";

  adminPanel.innerHTML = `
    <h2>TFC Accounts</h2>
    <p class="muted">
      Manual income and expense records.
      Membership collections are not included yet.
    </p>

    <div class="grid">
      <div class="stat">
        <span>Other Income</span>
        <strong id="accIncome">₹0</strong>
      </div>
      <div class="stat">
        <span>Expenses</span>
        <strong id="accExpense">₹0</strong>
      </div>
      <div class="stat">
        <span>Net Manual Entries</span>
        <strong id="accBalance">₹0</strong>
      </div>
    </div>

    <h3>Add Transaction</h3>

    <form id="accForm">
      <label>Type</label>
      <select id="accType" required>
        <option value="income">Income</option>
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
        min="0.01" max="10000000" step="0.01" required>

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

  adminRoot.appendChild(adminPanel);

  const memberPanel = document.createElement("div");
  memberPanel.id = "memberAccountsPanel";
  memberPanel.className = "panel hide";

  memberPanel.innerHTML = `
    <h2>TFC Accounts - Transparency</h2>

    <p class="muted">
      Read-only manual income and expense ledger.
      Membership collections are not included yet.
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

  memberRoot.appendChild(memberPanel);

  $("accDate").value = today();
  $("accForm").addEventListener("submit", saveEntry);
  $("accYear").addEventListener("change", render);

  const tab = document.createElement("button");
  tab.id = "tabAccounts";
  tab.type = "button";
  tab.className = "secondary";
  tab.textContent = "Accounts";

  const tabBar = $("tabMembers")?.parentElement;

  if (tabBar) {
    tabBar.appendChild(tab);

    tab.addEventListener("click", () => {
      adminRoot.querySelectorAll(":scope > .panel").forEach(p => {
        if (p.id !== "accountsPanel" &&
            !p.contains(tabBar)) {
          p.classList.add("hide");
        }
      });

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

      tabBar.querySelectorAll("button").forEach(b => {
        b.classList.add("secondary");
      });

      tab.classList.remove("secondary");
    });

    tabBar.addEventListener("click", event => {
      const clicked = event.target.closest("button");

      if (clicked && clicked !== tab) {
        $("accountsPanel").classList.add("hide");
        tab.classList.add("secondary");
      }
    });
  }
}

function showAccess() {
  $("memberAccountsPanel")?.classList.toggle(
    "hide",
    !user || admin || !approved
  );

  if (!admin) {
    $("accountsPanel")?.classList.add("hide");
  }
}

function allEntries() {
  return Object.entries(entries)
    .map(([id, item]) => ({ id, ...item }))
    .sort((a, b) =>
      String(b.date).localeCompare(String(a.date)) ||
      Number(b.createdAt || 0) - Number(a.createdAt || 0)
    );
}

function table(items) {
  if (!items.length) {
    return '<p class="muted">No transactions recorded.</p>';
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
        ${items.map(item => `
          <tr>
            <td>${esc(item.date)}</td>
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
  const all = allEntries();

  const years = [...new Set(
    all.map(item => String(item.date || "").slice(0, 4))
      .filter(y => /^\d{4}$/.test(y))
  )].sort().reverse();

  const yearSelect = $("accYear");

  if (yearSelect) {
    const selected = yearSelect.value;

    yearSelect.innerHTML =
      '<option value="all">All Years</option>' +
      years.map(y =>
        `<option value="${y}">${y}</option>`
      ).join("");

    yearSelect.value = years.includes(selected)
      ? selected
      : "all";
  }

  let income = 0;
  let expense = 0;

  all.forEach(item => {
    const amount = Number(item.amount);

    if (!Number.isFinite(amount)) return;

    if (item.type === "income") income += amount;
    if (item.type === "expense") expense += amount;
  });

  const balance = income - expense;

  [
    ["accIncome", income],
    ["accExpense", expense],
    ["accBalance", balance],
    ["memberAccIncome", income],
    ["memberAccExpense", expense],
    ["memberAccBalance", balance]
  ].forEach(([id, value]) => {
    if ($(id)) $(id).textContent = money(value);
  });

  const selectedYear = $("accYear")?.value || "all";

  const filtered = selectedYear === "all"
    ? all
    : all.filter(item =>
        String(item.date).startsWith(selectedYear)
      );

  if ($("accTable")) {
    $("accTable").innerHTML = table(filtered);
  }

  if ($("memberAccTable")) {
    $("memberAccTable").innerHTML = table(all);
  }
}

async function saveEntry(event) {
  event.preventDefault();

  if (!user || !admin || saving) return;

  const type = $("accType").value;
  const date = $("accDate").value;
  const category = $("accCategory").value.trim();
  const particulars = $("accParticulars").value.trim();
  const amount = Number($("accAmount").value);
  const method = $("accMethod").value;

  const valid =
    ["income", "expense"].includes(type) &&
    /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date) &&
    category.length >= 2 &&
    category.length <= 80 &&
    category !== "Membership Fee" &&
    particulars.length >= 3 &&
    particulars.length <= 500 &&
    Number.isFinite(amount) &&
    amount > 0 &&
    amount <= 10000000 &&
    ["cash", "upi", "bank", "other"].includes(method);

  if (!valid) {
    $("accMessage").textContent =
      "Please check the transaction details.";
    return;
  }

  if (!confirm(
    `Save ${type} of ${money(amount)}?\n` +
    "This entry cannot be edited or deleted."
  )) return;

  saving = true;
  $("accSave").disabled = true;
  $("accMessage").textContent = "Saving...";

  try {
    const entryRef = push(ref(db, "accounts/entries"));

    await set(entryRef, {
      type,
      date,
      category,
      particulars,
      amount,
      method,
      createdAt: Date.now(),
      createdBy: user.uid
    });

    $("accMessage").textContent =
      "Transaction saved. ID: " + entryRef.key;

    $("accForm").reset();
    $("accDate").value = today();

  } catch (error) {
    console.error(error);

    $("accMessage").textContent =
      "Save failed: " + (error.code || error.message);
  } finally {
    saving = false;
    $("accSave").disabled = false;
  }
}

function stopListening() {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }

  entries = {};
  render();
}

onAuthStateChanged(auth, async account => {
  const generation = ++authGeneration;

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

    if (generation !== authGeneration) return;

    admin = adminSnap.val() === true;

    if (!admin) {
      const userSnap = await get(
        ref(db, "users/" + account.uid)
      );

      if (generation !== authGeneration) return;

      approved = userSnap.val()?.status === "approved";
    }

    showAccess();

    if (!admin && !approved) return;

    unsubscribe = onValue(
      ref(db, "accounts/entries"),
      snapshot => {
        if (generation !== authGeneration) return;

        entries = snapshot.val() || {};
        render();
      },
      error => {
        console.error(error);

        if ($("accMessage")) {
          $("accMessage").textContent =
            "Accounts read failed: " + error.message;
        }
      }
    );

  } catch (error) {
    console.error("Accounts authentication:", error);
    showAccess();
  }
});

setup();
render();
