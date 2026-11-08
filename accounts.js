
/*
 TFC BANDIYOD
 ACCOUNTS v83.8

 Admin:
 - Opening Balance
 - Membership Income
 - Other Income
 - Expenses
 - Add Transaction
 - Edit Transaction
 - Soft Delete
 - Audit History

 Members:
 - Read Only Accounts

 Fixes:
 - Form submit validation
 - Edit button
 - Delete button
 - Clear error messages
 - Transaction confirmation
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
  runTransaction,
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

let currentUser = null;
let isAdmin = false;
let isApproved = false;
let session = 0;
let busy = false;
let editId = null;

let entries = {};
let members = {};
let corrections = {};
let requests = {};

let loaded = {
  entries: false,
  members: false,
  corrections: false,
  requests: false
};

let listeners = [];

const $ = id => document.getElementById(id);

function localDate(timestamp = Date.now()) {
  const d = new Date(timestamp);

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

  return !Number.isNaN(d.getTime()) &&
    localDate(d.getTime()) === value;
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

function safe(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[character])
  );
}

function setText(id, value) {
  if ($(id)) $(id).textContent = value;
}

function message(value) {
  setText("accMessage", value);
}

function isOpeningBalance(item) {
  if (!item) return false;

  if (item.isOpeningBalance === true) return true;

  return (
    item.type === "income" &&
    item.date === START_DATE &&
    Number(item.amount) === 221914 &&
    String(item.category || "").toLowerCase() ===
      "last balance" &&
    String(item.particulars || "").toLowerCase() ===
      "last year balance"
  );
}

function buildUI() {
  const adminRoot = $("admin");
  const memberRoot = $("member");

  if (!adminRoot || !memberRoot) {
    console.error("Accounts root not found");
    return;
  }

  if (!$("accountsPanel")) {
    const panel = document.createElement("div");

    panel.id = "accountsPanel";
    panel.className = "panel hide";

    panel.innerHTML = `
      <h2>TFC Accounts</h2>
      <p>Accounts from 08-11-2026</p>

      <div class="grid">
        <div class="stat">
          <span>Opening Balance</span>
          <strong id="accOpening">₹0</strong>
        </div>

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
          <span>Closing Balance</span>
          <strong id="accBalance">₹0</strong>
        </div>

        <div class="stat">
          <span>Today's New Income</span>
          <strong id="accTodayIncome">₹0</strong>
        </div>
      </div>

      <p id="accStatus"></p>

      <h3 id="accFormTitle">
        Add Income / Expense
      </h3>

      <form id="accForm" novalidate>

        <label>Type</label>
        <select id="accType">
          <option value="income">Other Income</option>
          <option value="expense">Expense</option>
        </select>

        <label>Date</label>
        <input
          id="accDate"
          type="date"
          min="2026-11-08"
        >

        <label>Category</label>
        <input
          id="accCategory"
          maxlength="80"
        >

        <label>Particulars</label>
        <input
          id="accParticulars"
          maxlength="500"
        >

        <label>Amount</label>
        <input
          id="accAmount"
          type="number"
          min="0.01"
          max="10000000"
          step="0.01"
        >

        <label>Method</label>
        <select id="accMethod">
          <option value="cash">Cash</option>
          <option value="upi">UPI</option>
          <option value="bank">Bank</option>
          <option value="other">Other</option>
        </select>

        <div id="accReasonBox" hidden>
          <label>Reason for Edit</label>
          <textarea
            id="accReason"
            maxlength="500"
            placeholder="Reason for change"
          ></textarea>
        </div>

        <button
          id="accSave"
          type="submit"
        >
          Save Transaction
        </button>

        <button
          id="accCancelEdit"
          type="button"
          hidden
        >
          Cancel Edit
        </button>

      </form>

      <p id="accMessage" role="status"></p>

      <h3>Accounts History</h3>

      <label>Year</label>
      <select id="accYear">
        <option value="all">All Years</option>
      </select>

      <div id="accTable" class="scroll"></div>

      <h3>Admin Audit History</h3>
      <div id="accAuditTable" class="scroll"></div>
    `;

    adminRoot.appendChild(panel);
  }

  if (!$("memberAccountsPanel")) {
    const panel = document.createElement("div");

    panel.id = "memberAccountsPanel";
    panel.className = "panel hide";

    panel.innerHTML = `
      <h2>TFC Accounts</h2>

      <div class="grid">
        <div class="stat">
          <span>Opening Balance</span>
          <strong id="memberAccOpening">₹0</strong>
        </div>

        <div class="stat">
          <span>Other Income</span>
          <strong id="memberAccIncome">₹0</strong>
        </div>

        <div class="stat">
          <span>Expenses</span>
          <strong id="memberAccExpenses">₹0</strong>
        </div>

        <div class="stat">
          <span>Balance Before Membership Income</span>
          <strong id="memberAccBalance">₹0</strong>
        </div>
      </div>

      <p>
        Membership Income is excluded from this
        member-side balance until a secure shared
        summary is available.
      </p>

      <h3>Income / Expense History</h3>

      <div
        id="memberAccTable"
        class="scroll"
      ></div>
    `;

    memberRoot.appendChild(panel);
  }

  $("accDate").value = localDate();

  $("accForm").addEventListener(
    "submit",
    saveTransaction
  );

  $("accSave").addEventListener(
    "click",
    event => {
      if (busy) return;

      event.preventDefault();
      saveTransaction(event);
    }
  );

  $("accCancelEdit").addEventListener(
    "click",
    resetForm
  );

  $("accYear").addEventListener(
    "change",
    render
  );

  $("accTable").addEventListener(
    "click",
    event => {
      const button = event.target.closest(
        "button[data-action]"
      );

      if (!button || !isAdmin || busy) return;

      const id = button.dataset.id;

      if (button.dataset.action === "edit") {
        editTransaction(id);
      }

      if (button.dataset.action === "delete") {
        deleteTransaction(id);
      }
    }
  );

  const tabs = $("tabMembers")?.parentElement;

  if (tabs && !$("tabAccounts")) {
    const button = document.createElement("button");

    button.id = "tabAccounts";
    button.type = "button";
    button.className = "secondary";
    button.textContent = "Accounts";

    tabs.appendChild(button);

    button.onclick = () => {
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

      $("accountsPanel")?.classList.remove("hide");
    };

    tabs.addEventListener(
      "click",
      event => {
        const clicked = event.target.closest("button");

        if (clicked && clicked !== button) {
          $("accountsPanel")?.classList.add("hide");
        }
      }
    );
  }
}

function accessUI() {
  $("accountsPanel")?.classList.add("hide");

  $("memberAccountsPanel")?.classList.toggle(
    "hide",
    !currentUser || isAdmin || !isApproved
  );
}

function getManualRows() {
  return Object.entries(entries)
    .filter(([, item]) =>
      item &&
      item.deleted !== true &&
      validDate(item.date) &&
      item.date >= START_DATE &&
      ["income", "expense"].includes(item.type) &&
      Number(item.amount) > 0
    )
    .map(([id, item]) => ({
      id,
      date: item.date,
      type: item.type,
      category: item.category || "",
      particulars: item.particulars || "",
      amount: Number(item.amount),
      method: item.method || "",
      opening: isOpeningBalance(item),
      manual: true
    }));
}

function getMembershipRows() {
  const rows = [];

  for (const [number, member] of Object.entries(members)) {
    const memberCorrections = corrections[number] || {};

    for (const [period, payment] of Object.entries(
      member?.payments || {}
    )) {
      if (
        !/^\d{4}-(0[1-9]|1[0-2])$/.test(period) ||
        payment?.status !== "paid" ||
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
        const request = requests[payment.requestId];

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
        type: "income",
        category: "Membership Fee",
        particulars: "Membership Fee - " + period,
        amount: MONTHLY_FEE,
        method,
        opening: false,
        manual: false
      });
    }
  }

  return rows;
}

function sum(rows, type) {
  return rows.reduce(
    (value, row) =>
      value + (row.type === type ? row.amount : 0),
    0
  );
}

function tableHTML(rows, actions) {
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
          ${actions ? "<th>Actions</th>" : ""}
        </tr>
      </thead>

      <tbody>
        ${rows.map(row => `
          <tr>
            <td>${safe(row.date)}</td>
            <td>${safe(
              row.opening ? "Opening" : row.type
            )}</td>
            <td>${safe(row.category)}</td>
            <td>${safe(row.particulars)}</td>
            <td>${money(row.amount)}</td>
            <td>${safe(row.method)}</td>

            ${actions ? `
              <td>
                ${row.manual ? `
                  <button
                    type="button"
                    data-action="edit"
                    data-id="${safe(row.id)}"
                  >
                    Edit
                  </button>

                  <button
                    type="button"
                    data-action="delete"
                    data-id="${safe(row.id)}"
                  >
                    Delete
                  </button>
                ` : "Payment Record"}
              </td>
            ` : ""}
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function auditHTML() {
  const events = [];

  for (const [id, item] of Object.entries(entries)) {
    for (const [eventId, event] of Object.entries(
      item?.audit || {}
    )) {
      events.push({
        entryId: id,
        eventId,
        ...event
      });
    }
  }

  events.sort(
    (a, b) => Number(b.at || 0) - Number(a.at || 0)
  );

  if (!events.length) {
    return "<p>No audit events yet.</p>";
  }

  return `
    <table>
      <thead>
        <tr>
          <th>Time</th>
          <th>Action</th>
          <th>Reason</th>
          <th>Admin</th>
          <th>Before</th>
          <th>After</th>
        </tr>
      </thead>

      <tbody>
        ${events.map(event => `
          <tr>
            <td>${safe(
              event.at
                ? new Date(event.at).toLocaleString("en-IN")
                : ""
            )}</td>
            <td>${safe(event.action)}</td>
            <td>${safe(event.reason)}</td>
            <td>${safe(event.adminUid)}</td>
            <td><pre>${safe(
              JSON.stringify(event.before || {}, null, 2)
            )}</pre></td>
            <td><pre>${safe(
              JSON.stringify(event.after || {}, null, 2)
            )}</pre></td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function render() {
  const manual = getManualRows();

  const openingRows = manual.filter(
    row => row.opening
  );

  const normalRows = manual.filter(
    row => !row.opening
  );

  const openingAmount = sum(openingRows, "income");

  const membershipReady =
    isAdmin &&
    loaded.members &&
    loaded.corrections &&
    loaded.requests;

  const membership = membershipReady
    ? getMembershipRows()
    : [];

  const allRows = [...manual, ...membership];

  let year = "all";

  if ($("accYear")) {
    const previous = $("accYear").value;

    const years = [...new Set(
      allRows.map(row => row.date.slice(0, 4))
    )].sort().reverse();

    $("accYear").replaceChildren(
      new Option("All Years", "all"),
      ...years.map(y => new Option(y, y))
    );

    $("accYear").value = years.includes(previous)
      ? previous
      : "all";

    year = $("accYear").value;
  }

  const inYear = row =>
    year === "all" || row.date.startsWith(year);

  const selectedNormal = normalRows.filter(inYear);
  const selectedMembership = membership.filter(inYear);

  const otherIncome = sum(selectedNormal, "income");
  const expenses = sum(selectedNormal, "expense");

  const membershipIncome = sum(
    selectedMembership,
    "income"
  );

  const balance =
    openingAmount +
    otherIncome +
    membershipIncome -
    expenses;

  const todayIncome = sum(
    [...normalRows, ...membership].filter(
      row => row.date === localDate()
    ),
    "income"
  );

  setText("accOpening", money(openingAmount));
  setText("accOtherIncome", money(otherIncome));
  setText("accExpenses", money(expenses));

  setText(
    "accMembership",
    membershipReady
      ? money(membershipIncome)
      : "Loading"
  );

  setText(
    "accBalance",
    membershipReady
      ? money(balance)
      : "Loading"
  );

  setText(
    "accTodayIncome",
    membershipReady
      ? money(todayIncome)
      : "Loading"
  );

  setText(
    "accStatus",
    membershipReady
      ? "Opening Balance is separate from new income."
      : "Membership records loading."
  );

  const adminRows = [
    ...openingRows,
    ...selectedNormal,
    ...selectedMembership
  ].sort(
    (a, b) => b.date.localeCompare(a.date)
  );

  if ($("accTable")) {
    $("accTable").innerHTML = tableHTML(
      membershipReady
        ? adminRows
        : [...openingRows, ...selectedNormal],
      true
    );
  }

  if ($("accAuditTable")) {
    $("accAuditTable").innerHTML = auditHTML();
  }

  const memberIncome = sum(normalRows, "income");
  const memberExpenses = sum(normalRows, "expense");

  setText("memberAccOpening", money(openingAmount));
  setText("memberAccIncome", money(memberIncome));
  setText("memberAccExpenses", money(memberExpenses));

  setText(
    "memberAccBalance",
    money(
      openingAmount +
      memberIncome -
      memberExpenses
    )
  );

  if ($("memberAccTable")) {
    $("memberAccTable").innerHTML = tableHTML(
      [...openingRows, ...normalRows].sort(
        (a, b) => b.date.localeCompare(a.date)
      ),
      false
    );
  }
}

function recordFields(item) {
  return {
    type: item.type,
    date: item.date,
    category: item.category,
    particulars: item.particulars,
    amount: Number(item.amount),
    method: item.method,
    isOpeningBalance: isOpeningBalance(item)
  };
}

function resetForm() {
  editId = null;

  if (!$("accForm")) return;

  $("accForm").reset();
  $("accDate").value = localDate();

  $("accReasonBox").hidden = true;
  $("accReason").value = "";
  $("accCancelEdit").hidden = true;

  setText(
    "accFormTitle",
    "Add Income / Expense"
  );

  setText("accSave", "Save Transaction");
}

function editTransaction(id) {
  if (!isAdmin || busy) return;

  const item = entries[id];

  if (!item || item.deleted === true) {
    message("Record unavailable.");
    return;
  }

  editId = id;

  $("accType").value = item.type;
  $("accDate").value = item.date;
  $("accCategory").value = item.category || "";
  $("accParticulars").value = item.particulars || "";
  $("accAmount").value = item.amount;
  $("accMethod").value = item.method || "other";

  $("accReasonBox").hidden = false;
  $("accCancelEdit").hidden = false;

  setText("accFormTitle", "Edit Transaction");
  setText("accSave", "Update Transaction");

  message("Edit the details and enter a reason.");

  $("accForm").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function formData() {
  return {
    type: $("accType").value,
    date: $("accDate").value,
    category: $("accCategory").value.trim(),
    particulars: $("accParticulars").value.trim(),
    amount: Number($("accAmount").value),
    method: $("accMethod").value
  };
}

function validateTransaction(data) {
  if (!["income", "expense"].includes(data.type)) {
    throw Error("Select a valid transaction type.");
  }

  if (!validDate(data.date) || data.date < START_DATE) {
    throw Error("Select a valid date.");
  }

  if (
    data.category.length < 2 ||
    data.category.length > 80 ||
    data.category === "Membership Fee"
  ) {
    throw Error("Category must contain 2–80 characters.");
  }

  if (
    data.particulars.length < 3 ||
    data.particulars.length > 500
  ) {
    throw Error(
      "Particulars must contain 3–500 characters."
    );
  }

  if (
    !Number.isFinite(data.amount) ||
    data.amount <= 0 ||
    data.amount > 10000000
  ) {
    throw Error("Enter a valid amount.");
  }

  if (
    !["cash", "upi", "bank", "other"].includes(
      data.method
    )
  ) {
    throw Error("Select a valid payment method.");
  }
}

async function saveTransaction(event) {
  event.preventDefault();

  if (busy) {
    message("Please wait. Transaction is processing.");
    return;
  }

  if (!isAdmin || !currentUser) {
    message("Admin access required.");
    return;
  }

  const uid = currentUser.uid;
  const target = editId;
  const data = formData();
  const reason = $("accReason").value.trim();

  try {
    validateTransaction(data);

    if (
      target &&
      (reason.length < 5 || reason.length > 500)
    ) {
      throw Error(
        "Edit reason must contain 5–500 characters."
      );
    }

  } catch (error) {
    message(error.message);
    return;
  }

  const confirmed = confirm(
    `${target ? "Update" : "Save"} transaction?\n\n` +
    `Amount: ${money(data.amount)}\n` +
    `Particulars: ${data.particulars}`
  );

  if (!confirmed) {
    message("Transaction cancelled.");
    return;
  }

  busy = true;
  $("accSave").disabled = true;

  message("Processing transaction...");

  try {
    if (auth.currentUser?.uid !== uid) {
      throw Error("Login session changed.");
    }

    if (!target) {
      const newRef = push(
        ref(db, "accounts/entries")
      );

      await set(newRef, {
        ...data,
        createdAt: serverTimestamp(),
        createdBy: uid
      });

      resetForm();
      message("Transaction saved successfully.");

    } else {
      const entryRef = ref(
        db,
        "accounts/entries/" + target
      );

      const auditId = push(
        ref(
          db,
          "accounts/entries/" + target + "/audit"
        )
      ).key;

      const actionTime = Date.now();

      const result = await runTransaction(
        entryRef,
        current => {
          if (!current || current.deleted === true) {
            return;
          }

          const before = recordFields(current);

          const after = {
            ...data,
            isOpeningBalance: before.isOpeningBalance
          };

          return {
            ...current,
            ...after,
            updatedAt: actionTime,
            updatedBy: uid,
            revision: Number(current.revision || 0) + 1,
            audit: {
              ...(current.audit || {}),
              [auditId]: {
                action: "edit",
                reason,
                adminUid: uid,
                at: actionTime,
                before,
                after
              }
            }
          };
        },
        {
          applyLocally: false
        }
      );

      if (!result.committed) {
        throw Error(
          "Record unavailable or update cancelled."
        );
      }

      resetForm();
      message(
        "Transaction updated successfully. Audit saved."
      );
    }

  } catch (error) {
    console.error("Accounts save error:", error);

    message(
      "Transaction failed: " + error.message
    );

  } finally {
    busy = false;
    $("accSave").disabled = false;
  }
}

async function deleteTransaction(id) {
  if (!isAdmin || !currentUser || busy) return;

  const item = entries[id];

  if (!item || item.deleted === true) {
    message("Record unavailable.");
    return;
  }

  const answer = prompt(
    "Enter reason for deleting this transaction:"
  );

  if (answer === null) {
    message("Delete cancelled.");
    return;
  }

  const reason = answer.trim();

  if (reason.length < 5 || reason.length > 500) {
    message(
      "Delete reason must contain 5–500 characters."
    );
    return;
  }

  if (!confirm(
    "Soft Delete this transaction?\n\n" +
    "Amount: " + money(item.amount) + "\n" +
    "Original record will remain in Firebase."
  )) {
    message("Delete cancelled.");
    return;
  }

  busy = true;

  const uid = currentUser.uid;

  message("Processing soft delete...");

  try {
    if (auth.currentUser?.uid !== uid) {
      throw Error("Login session changed.");
    }

    const entryRef = ref(
      db,
      "accounts/entries/" + id
    );

    const auditId = push(
      ref(
        db,
        "accounts/entries/" + id + "/audit"
      )
    ).key;

    const actionTime = Date.now();

    const result = await runTransaction(
      entryRef,
      current => {
        if (!current || current.deleted === true) {
          return;
        }

        const before = recordFields(current);

        return {
          ...current,
          deleted: true,
          deletedAt: actionTime,
          deletedBy: uid,
          deleteReason: reason,
          revision: Number(current.revision || 0) + 1,
          audit: {
            ...(current.audit || {}),
            [auditId]: {
              action: "delete",
              reason,
              adminUid: uid,
              at: actionTime,
              before,
              after: {
                ...before,
                deleted: true
              }
            }
          }
        };
      },
      {
        applyLocally: false
      }
    );

    if (!result.committed) {
      throw Error(
        "Record unavailable or delete cancelled."
      );
    }

    if (editId === id) resetForm();

    message(
      "Transaction soft-deleted. Audit saved."
    );

  } catch (error) {
    console.error("Accounts delete error:", error);

    message(
      "Delete failed: " + error.message
    );

  } finally {
    busy = false;
  }
}

function stopListeners() {
  for (const stop of listeners) {
    try {
      stop();
    } catch (_) {}
  }

  listeners = [];

  entries = {};
  members = {};
  corrections = {};
  requests = {};

  loaded = {
    entries: false,
    members: false,
    corrections: false,
    requests: false
  };
}

function listen(path, key, callback, currentSession) {
  const stop = onValue(
    ref(db, path),
    snapshot => {
      if (currentSession !== session) return;

      callback(snapshot.val() || {});
      loaded[key] = true;
      render();
    },
    error => {
      if (currentSession !== session) return;

      loaded[key] = false;

      console.error(
        "Accounts read failed:",
        path,
        error
      );

      message(
        "Database read failed: " +
        path +
        " - " +
        error.message
      );

      render();
    }
  );

  listeners.push(stop);
}

onAuthStateChanged(auth, async account => {
  const currentSession = ++session;

  stopListeners();

  currentUser = account;
  isAdmin = false;
  isApproved = false;

  resetForm();
  accessUI();
  render();

  if (!account) return;

  try {
    const adminSnapshot = await get(
      ref(db, "admins/" + account.uid)
    );

    if (currentSession !== session) return;

    isAdmin = adminSnapshot.val() === true;

    if (!isAdmin) {
      const userSnapshot = await get(
        ref(db, "users/" + account.uid)
      );

      if (currentSession !== session) return;

      isApproved =
        userSnapshot.val()?.status === "approved";
    }

    accessUI();

    if (!isAdmin && !isApproved) return;

    listen(
      "accounts/entries",
      "entries",
      value => {
        entries = value;
      },
      currentSession
    );

    if (isAdmin) {
      listen(
        "members",
        "members",
        value => {
          members = value;
        },
        currentSession
      );

      listen(
        "paymentCorrections",
        "corrections",
        value => {
          corrections = value;
        },
        currentSession
      );

      listen(
        "paymentRequests",
        "requests",
        value => {
          requests = value;
        },
        currentSession
      );
    }

  } catch (error) {
    console.error("Accounts login error:", error);

    message(
      "Accounts login error: " + error.message
    );
  }
});

buildUI();
render();

/* END TFC ACCOUNTS v83.8 */
