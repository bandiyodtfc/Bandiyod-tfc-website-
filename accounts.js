
/*
 TFC BANDIYOD - ACCOUNTS v83.6

 Starting date: 2026-11-08

 Features:
 - Opening Balance
 - New Membership Income
 - Other Income
 - Expenses
 - Closing Balance
 - Today's New Income
 - Admin Add / Edit / Soft Delete
 - Audit History
 - Member Read Only

 IMPORTANT:
 Firebase Rules update is required
 before Edit/Delete will work.

 Historical PDF payments are excluded.
 Existing membership payment records are preserved.
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
let saving = false;
let editingId = null;
let authVersion = 0;

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

const $ = id => document.getElementById(id);

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

function money(value) {
  return "₹" + Number(value || 0).toLocaleString(
    "en-IN",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }
  );
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

function setText(id, value) {
  if ($(id)) $(id).textContent = value;
}

function message(value) {
  setText("accMessage", value);
}

function isOpeningBalance(item) {
  return (
    item &&
    item.type === "income" &&
    (
      item.isOpeningBalance === true ||
      (
        item.date === START_DATE &&
        Number(item.amount) === 221914 &&
        String(item.category || "")
          .trim().toLowerCase() === "last balance" &&
        String(item.particulars || "")
          .trim().toLowerCase() === "last year balance"
      )
    )
  );
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

      <h3 id="accFormTitle">Add Income / Expense</h3>

      <form id="accForm">
        <label>Type</label>
        <select id="accType" required>
          <option value="income">Other Income</option>
          <option value="expense">Expense</option>
        </select>

        <label>Date</label>
        <input id="accDate" type="date"
          min="2026-11-08" required>

        <label>Category</label>
        <input id="accCategory"
          maxlength="80" required>

        <label>Particulars</label>
        <input id="accParticulars"
          maxlength="500" required>

        <label>Amount</label>
        <input id="accAmount" type="number"
          min="0.01" max="10000000"
          step="0.01" required>

        <label>Method</label>
        <select id="accMethod">
          <option value="cash">Cash</option>
          <option value="upi">UPI</option>
          <option value="bank">Bank</option>
          <option value="other">Other</option>
        </select>

        <div id="accEditReasonBox" hidden>
          <label>Reason for Edit</label>
          <textarea id="accEditReason"
            maxlength="500"
            placeholder="Reason for changing this record"></textarea>
        </div>

        <button id="accSave" type="submit">
          Save Transaction
        </button>

        <button id="accCancelEdit"
          type="button" hidden>
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
      <p>Records from 08-11-2026</p>

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
        Membership Income and final Closing Balance
        will be available after the secure
        member summary is enabled.
      </p>

      <h3>Income / Expense History</h3>
      <div id="memberAccTable" class="scroll"></div>
    `;

    memberRoot.appendChild(panel);
  }

  $("accDate").value = localDate();

  $("accForm").onsubmit = saveEntry;
  $("accCancelEdit").onclick = resetForm;
  $("accYear").onchange = render;

  $("accTable").addEventListener("click", async event => {
    const button = event.target.closest("button[data-action]");
    if (!button || !isAdmin) return;

    const id = button.dataset.id;

    if (button.dataset.action === "edit") {
      startEdit(id);
    }

    if (button.dataset.action === "delete") {
      await softDelete(id);
    }
  });

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
      ].forEach(id => $(id)?.classList.add("hide"));

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
    !currentUser || isAdmin || !isApproved
  );
}

function manualRows() {
  return Object.entries(entries)
    .filter(([, item]) =>
      item &&
      item.deleted !== true &&
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
      method: item.method || "",
      opening: isOpeningBalance(item),
      manual: true
    }));
}

function membershipRows() {
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
    (total, row) =>
      total + (
        row.type === type
          ? Number(row.amount) || 0
          : 0
      ),
    0
  );
}

function tableHTML(rows, admin = false) {
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
          ${admin ? "<th>Actions</th>" : ""}
        </tr>
      </thead>
      <tbody>
        ${rows.map(row => `
          <tr>
            <td>${escapeHTML(row.date)}</td>
            <td>${escapeHTML(
              row.opening ? "Opening" : row.type
            )}</td>
            <td>${escapeHTML(row.category)}</td>
            <td>${escapeHTML(row.particulars)}</td>
            <td>${money(row.amount)}</td>
            <td>${escapeHTML(row.method)}</td>

            ${admin ? `
              <td>
                ${row.manual ? `
                  <button type="button"
                    data-action="edit"
                    data-id="${escapeHTML(row.id)}">
                    Edit
                  </button>

                  <button type="button"
                    data-action="delete"
                    data-id="${escapeHTML(row.id)}">
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
        id,
        eventId,
        ...event
      });
    }
  }

  events.sort((a, b) => Number(b.at || 0) - Number(a.at || 0));

  if (!events.length) {
    return "<p>No Edit/Delete audit records yet.</p>";
  }

  return `
    <table>
      <thead>
        <tr>
          <th>Time</th>
          <th>Action</th>
          <th>Admin UID</th>
          <th>Reason</th>
          <th>Previous</th>
          <th>Updated</th>
        </tr>
      </thead>
      <tbody>
        ${events.map(event => `
          <tr>
            <td>${escapeHTML(
              event.at
                ? new Date(event.at).toLocaleString("en-IN")
                : ""
            )}</td>

            <td>${escapeHTML(event.action)}</td>
            <td>${escapeHTML(event.adminUid)}</td>
            <td>${escapeHTML(event.reason)}</td>

            <td>
              <pre>${escapeHTML(
                JSON.stringify(event.before || {}, null, 2)
              )}</pre>
            </td>

            <td>
              <pre>${escapeHTML(
                JSON.stringify(event.after || {}, null, 2)
              )}</pre>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function render() {
  const manual = manualRows();

  const openingRows = manual.filter(r => r.opening);
  const regularManual = manual.filter(r => !r.opening);

  const openingBalance = sum(openingRows, "income");

  const membershipReady =
    isAdmin &&
    loaded.members &&
    loaded.corrections &&
    loaded.requests;

  const membership = membershipReady
    ? membershipRows()
    : [];

  const allRows = [
    ...openingRows,
    ...regularManual,
    ...membership
  ];

  const yearSelect = $("accYear");
  let selectedYear = "all";

  if (yearSelect) {
    const previous = yearSelect.value;

    const years = [...new Set(
      allRows.map(r => r.date.slice(0, 4))
    )].sort().reverse();

    yearSelect.replaceChildren(
      new Option("All Years", "all"),
      ...years.map(y => new Option(y, y))
    );

    yearSelect.value = years.includes(previous)
      ? previous
      : "all";

    selectedYear = yearSelect.value;
  }

  const filterYear = row =>
    selectedYear === "all" ||
    row.date.startsWith(selectedYear);

  const filteredManual = regularManual.filter(filterYear);
  const filteredMembership = membership.filter(filterYear);

  const otherIncome = sum(filteredManual, "income");
  const expenses = sum(filteredManual, "expense");
  const membershipIncome = sum(filteredMembership, "income");

  const closingBalance =
    openingBalance +
    otherIncome +
    membershipIncome -
    expenses;

  const todayIncome = sum(
    [...regularManual, ...membership].filter(
      r => r.date === localDate()
    ),
    "income"
  );

  setText("accOpening", money(openingBalance));
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
      ? money(closingBalance)
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
      ? "Opening Balance is separate from new income. Closing Balance is a calculated ledger balance, not a verified bank balance."
      : "Membership data loading or unavailable. Closing Balance is not final."
  );

  const adminRows = [
    ...openingRows,
    ...filteredManual,
    ...filteredMembership
  ].sort((a, b) => b.date.localeCompare(a.date));

  if ($("accTable")) {
    $("accTable").innerHTML = tableHTML(
      membershipReady
        ? adminRows
        : [...openingRows, ...filteredManual],
      true
    );
  }

  if ($("accAuditTable")) {
    $("accAuditTable").innerHTML = auditHTML();
  }

  const memberIncome = sum(regularManual, "income");
  const memberExpenses = sum(regularManual, "expense");

  setText("memberAccOpening", money(openingBalance));
  setText("memberAccIncome", money(memberIncome));
  setText("memberAccExpenses", money(memberExpenses));

  setText(
    "memberAccBalance",
    money(openingBalance + memberIncome - memberExpenses)
  );

  if ($("memberAccTable")) {
    $("memberAccTable").innerHTML = tableHTML(
      [...openingRows, ...regularManual].sort(
        (a, b) => b.date.localeCompare(a.date)
      )
    );
  }
}

function snapshotFields(item) {
  return {
    type: item.type,
    date: item.date,
    category: item.category,
    particulars: item.particulars,
    amount: item.amount,
    method: item.method,
    isOpeningBalance: isOpeningBalance(item)
  };
}

function resetForm() {
  editingId = null;

  $("accForm").reset();
  $("accDate").value = localDate();

  $("accEditReasonBox").hidden = true;
  $("accEditReason").value = "";

  $("accCancelEdit").hidden = true;

  setText("accFormTitle", "Add Income / Expense");
  setText("accSave", "Save Transaction");

  message("");
}

function startEdit(id) {
  if (!isAdmin || saving) return;

  const item = entries[id];

  if (!item || item.deleted === true) {
    message("Record unavailable.");
    return;
  }

  editingId = id;

  $("accType").value = item.type;
  $("accDate").value = item.date;
  $("accCategory").value = item.category;
  $("accParticulars").value = item.particulars;
  $("accAmount").value = item.amount;
  $("accMethod").value = item.method;

  $("accEditReasonBox").hidden = false;
  $("accCancelEdit").hidden = false;

  setText("accFormTitle", "Edit Transaction");
  setText("accSave", "Update Transaction");

  $("accForm").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function validateEntry(data) {
  if (
    !["income", "expense"].includes(data.type) ||
    !validDate(data.date) ||
    data.date < START_DATE ||
    data.category.length < 2 ||
    data.category.length > 80 ||
    /membership|member\s*fee|subscription/i.test(
      data.category
    ) ||
    data.particulars.length < 3 ||
    data.particulars.length > 500 ||
    !Number.isFinite(data.amount) ||
    data.amount <= 0 ||
    data.amount > 10000000 ||
    Math.abs(
      data.amount * 100 -
      Math.round(data.amount * 100)
    ) > 0.000001 ||
    !["cash", "upi", "bank", "other"].includes(
      data.method
    )
  ) {
    throw Error("Invalid transaction details.");
  }
}

async function saveEntry(event) {
  event.preventDefault();

  if (!currentUser || !isAdmin || saving) return;

  const uid = currentUser.uid;

  const data = {
    type: $("accType").value,
    date: $("accDate").value,
    category: $("accCategory").value.trim(),
    particulars: $("accParticulars").value.trim(),
    amount: Number($("accAmount").value),
    method: $("accMethod").value
  };

  try {
    validateEntry(data);
  } catch (error) {
    message(error.message);
    return;
  }

  const reason = $("accEditReason").value.trim();
  const targetId = editingId;

  if (targetId && (reason.length < 5 || reason.length > 500)) {
    message("Edit reason must contain 5 to 500 characters.");
    return;
  }

  if (!confirm(
    `${targetId ? "Update" : "Save"} transaction?\n\n` +
    `Amount: ${money(data.amount)}\n` +
    `Particulars: ${data.particulars}`
  )) return;

  saving = true;
  $("accSave").disabled = true;

  try {
    if (auth.currentUser?.uid !== uid) {
      throw Error("Login session changed.");
    }

    if (targetId) {
      const entryRef = ref(db, "accounts/entries/" + targetId);

      const auditId = push(
        ref(db, "accounts/entries/" + targetId + "/audit")
      ).key;

      const actionTime = Date.now();

      const result = await runTransaction(
        entryRef,
        current => {
          if (!current || current.deleted === true) {
            return;
          }

          const before = snapshotFields(current);

          const opening = isOpeningBalance(current);

          const after = {
            ...data,
            isOpeningBalance: opening
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
        { applyLocally: false }
      );

      if (!result.committed) {
        throw Error("Edit cancelled or record unavailable.");
      }

      message("Transaction updated. Audit recorded.");

    } else {
      const entryRef = push(ref(db, "accounts/entries"));

      await set(entryRef, {
        ...data,
        createdAt: serverTimestamp(),
        createdBy: uid
      });

      message("Transaction saved.");
    }

    resetForm();

  } catch (error) {
    message("Save failed: " + error.message);

  } finally {
    saving = false;
    $("accSave").disabled = false;
  }
}

async function softDelete(id) {
  if (!isAdmin || !currentUser || saving) return;

  const item = entries[id];

  if (!item || item.deleted === true) {
    message("Record unavailable.");
    return;
  }

  const reason = prompt(
    "Reason for deleting this transaction (minimum 5 characters):"
  );

  if (reason === null) return;

  const cleanReason = reason.trim();

  if (
    cleanReason.length < 5 ||
    cleanReason.length > 500
  ) {
    message("Delete reason must contain 5 to 500 characters.");
    return;
  }

  if (!confirm(
    "Soft Delete this transaction?\n\n" +
    "Amount: " + money(item.amount) + "\n" +
    "The original record will remain in Firebase."
  )) return;

  saving = true;

  const uid = currentUser.uid;

  try {
    if (auth.currentUser?.uid !== uid) {
      throw Error("Login session changed.");
    }

    const entryRef = ref(db, "accounts/entries/" + id);

    const auditId = push(
      ref(db, "accounts/entries/" + id + "/audit")
    ).key;

    const actionTime = Date.now();

    const result = await runTransaction(
      entryRef,
      current => {
        if (!current || current.deleted === true) {
          return;
        }

        const before = snapshotFields(current);

        return {
          ...current,
          deleted: true,
          deletedAt: actionTime,
          deletedBy: uid,
          deleteReason: cleanReason,
          revision: Number(current.revision || 0) + 1,
          audit: {
            ...(current.audit || {}),
            [auditId]: {
              action: "delete",
              reason: cleanReason,
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
      { applyLocally: false }
    );

    if (!result.committed) {
      throw Error("Delete cancelled or record unavailable.");
    }

    if (editingId === id) resetForm();

    message("Transaction soft-deleted. Audit recorded.");

  } catch (error) {
    message("Delete failed: " + error.message);

  } finally {
    saving = false;
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

  currentUser = account;
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

/* END TFC ACCOUNTS v83.6 */
