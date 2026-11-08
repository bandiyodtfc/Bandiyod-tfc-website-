/*
 TFC BANDIYOD
 ACCOUNTS v83.7

 Opening Balance
 Membership Income
 Other Income
 Expenses
 Admin Add / Edit / Soft Delete
 Audit History
 Member Read Only

 Compatible with current accounts rules.
 Audit security hardening still required.
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

let user = null;
let admin = false;
let approved = false;
let authSequence = 0;
let busy = false;
let editId = null;

let entries = {};
let members = {};
let corrections = {};
let requests = {};

let ready = {
  entries: false,
  members: false,
  corrections: false,
  requests: false
};

let unsubscribers = [];

const el = id => document.getElementById(id);

function today(timestamp = Date.now()) {
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
    today(d.getTime()) === value;
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

function text(id, value) {
  if (el(id)) el(id).textContent = value;
}

function notice(value) {
  text("accMessage", value);
}

function opening(item) {
  if (!item) return false;

  if (item.isOpeningBalance === true) {
    return true;
  }

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

function createUI() {
  const adminRoot = el("admin");
  const memberRoot = el("member");

  if (!adminRoot || !memberRoot) {
    console.error("Accounts dashboard roots missing");
    return;
  }

  if (!el("accountsPanel")) {
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
          required
        >

        <label>Particulars</label>
        <input
          id="accParticulars"
          maxlength="500"
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

        <div id="accReasonBox" hidden>
          <label>Reason for Edit</label>
          <textarea
            id="accReason"
            maxlength="500"
            placeholder="Reason for change"
          ></textarea>
        </div>

        <button id="accSave" type="submit">
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

  if (!el("memberAccountsPanel")) {
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
        Membership Income summary is not yet
        available in the member view.
      </p>

      <h3>Income / Expense History</h3>
      <div id="memberAccTable" class="scroll"></div>
    `;

    memberRoot.appendChild(panel);
  }

  el("accDate").value = today();

  el("accForm").onsubmit = saveEntry;
  el("accCancelEdit").onclick = resetForm;
  el("accYear").onchange = render;

  el("accTable").addEventListener(
    "click",
    event => {
      const button = event.target.closest(
        "button[data-action]"
      );

      if (!button || !admin || busy) return;

      const id = button.dataset.id;

      if (button.dataset.action === "edit") {
        startEdit(id);
      }

      if (button.dataset.action === "delete") {
        softDelete(id);
      }
    }
  );

  const tabContainer = el("tabMembers")?.parentElement;

  if (tabContainer && !el("tabAccounts")) {
    const button = document.createElement("button");

    button.id = "tabAccounts";
    button.type = "button";
    button.className = "secondary";
    button.textContent = "Accounts";

    tabContainer.appendChild(button);

    button.onclick = () => {
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
      ].forEach(id => {
        el(id)?.classList.add("hide");
      });

      el("accountsPanel")?.classList.remove("hide");
    };

    tabContainer.addEventListener(
      "click",
      event => {
        const clicked = event.target.closest("button");

        if (clicked && clicked !== button) {
          el("accountsPanel")?.classList.add("hide");
        }
      }
    );
  }
}

function showAccess() {
  el("accountsPanel")?.classList.add("hide");

  el("memberAccountsPanel")?.classList.toggle(
    "hide",
    !user || admin || !approved
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
      opening: opening(item),
      manual: true
    }));
}

function membershipRows() {
  const result = [];

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
          today(Number(payment.verifiedAt)) >= START_DATE;

        method = "Cash";

      } else if (payment.requestId) {
        const request = requests[payment.requestId];

        if (
          request?.status === "approved" &&
          String(request.memberNumber) === String(number) &&
          Number(request.reviewedAt) > 0 &&
          Number(payment.verifiedAt) > 0
        ) {
          date = today(Number(request.reviewedAt));

          verified =
            date >= START_DATE &&
            today(Number(payment.verifiedAt)) >= START_DATE;

          method = "UPI";
        }
      }

      if (!verified) continue;

      result.push({
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

  return result;
}

function total(rows, type) {
  return rows.reduce(
    (sum, row) =>
      sum + (row.type === type ? row.amount : 0),
    0
  );
}

function tableHTML(rows, canEdit) {
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
          ${canEdit ? "<th>Actions</th>" : ""}
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

            ${canEdit ? `
              <td>
                ${row.manual ? `
                  <button
                    type="button"
                    data-action="edit"
                    data-id="${escapeHTML(row.id)}"
                  >Edit</button>

                  <button
                    type="button"
                    data-action="delete"
                    data-id="${escapeHTML(row.id)}"
                  >Delete</button>
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
            <td>${escapeHTML(
              event.at
                ? new Date(event.at).toLocaleString("en-IN")
                : ""
            )}</td>
            <td>${escapeHTML(event.action)}</td>
            <td>${escapeHTML(event.reason)}</td>
            <td>${escapeHTML(event.adminUid)}</td>
            <td><pre>${escapeHTML(
              JSON.stringify(event.before || {}, null, 2)
            )}</pre></td>
            <td><pre>${escapeHTML(
              JSON.stringify(event.after || {}, null, 2)
            )}</pre></td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function render() {
  const manual = manualRows();

  const openingRows = manual.filter(r => r.opening);
  const otherRows = manual.filter(r => !r.opening);

  const openingAmount = total(openingRows, "income");

  const membershipReady =
    admin &&
    ready.members &&
    ready.corrections &&
    ready.requests;

  const membership = membershipReady
    ? membershipRows()
    : [];

  const all = [...manual, ...membership];

  let year = "all";

  if (el("accYear")) {
    const previous = el("accYear").value;

    const years = [...new Set(
      all.map(r => r.date.slice(0, 4))
    )].sort().reverse();

    el("accYear").replaceChildren(
      new Option("All Years", "all"),
      ...years.map(y => new Option(y, y))
    );

    el("accYear").value = years.includes(previous)
      ? previous
      : "all";

    year = el("accYear").value;
  }

  const filter = row =>
    year === "all" || row.date.startsWith(year);

  const filteredManual = otherRows.filter(filter);
  const filteredMembership = membership.filter(filter);

  const otherIncome = total(filteredManual, "income");
  const expenses = total(filteredManual, "expense");
  const membershipIncome = total(
    filteredMembership,
    "income"
  );

  const closing =
    openingAmount +
    membershipIncome +
    otherIncome -
    expenses;

  const todayIncome = total(
    [...otherRows, ...membership].filter(
      row => row.date === today()
    ),
    "income"
  );

  text("accOpening", money(openingAmount));
  text("accOtherIncome", money(otherIncome));
  text("accExpenses", money(expenses));

  text(
    "accMembership",
    membershipReady
      ? money(membershipIncome)
      : "Loading"
  );

  text(
    "accBalance",
    membershipReady
      ? money(closing)
      : "Loading"
  );

  text(
    "accTodayIncome",
    membershipReady
      ? money(todayIncome)
      : "Loading"
  );

  text(
    "accStatus",
    membershipReady
      ? "Opening Balance is separate from new income. Closing Balance is calculated from recorded transactions."
      : "Membership records loading. Final balance unavailable."
  );

  const adminRows = [
    ...openingRows,
    ...filteredManual,
    ...filteredMembership
  ].sort((a, b) => b.date.localeCompare(a.date));

  if (el("accTable")) {
    el("accTable").innerHTML = tableHTML(
      membershipReady
        ? adminRows
        : [...openingRows, ...filteredManual],
      true
    );
  }

  if (el("accAuditTable")) {
    el("accAuditTable").innerHTML = auditHTML();
  }

  const memberIncome = total(otherRows, "income");
  const memberExpenses = total(otherRows, "expense");

  text("memberAccOpening", money(openingAmount));
  text("memberAccIncome", money(memberIncome));
  text("memberAccExpenses", money(memberExpenses));

  text(
    "memberAccBalance",
    money(openingAmount + memberIncome - memberExpenses)
  );

  if (el("memberAccTable")) {
    el("memberAccTable").innerHTML = tableHTML(
      [...openingRows, ...otherRows].sort(
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
    isOpeningBalance: opening(item)
  };
}

function resetForm() {
  editId = null;

  el("accForm").reset();
  el("accDate").value = today();

  el("accReasonBox").hidden = true;
  el("accReason").value = "";
  el("accCancelEdit").hidden = true;

  text("accFormTitle", "Add Income / Expense");
  text("accSave", "Save Transaction");
}

function startEdit(id) {
  if (!admin || busy) return;

  const item = entries[id];

  if (!item || item.deleted === true) {
    notice("Record unavailable.");
    return;
  }

  editId = id;

  el("accType").value = item.type;
  el("accDate").value = item.date;
  el("accCategory").value = item.category;
  el("accParticulars").value = item.particulars;
  el("accAmount").value = item.amount;
  el("accMethod").value = item.method;

  el("accReasonBox").hidden = false;
  el("accCancelEdit").hidden = false;

  text("accFormTitle", "Edit Transaction");
  text("accSave", "Update Transaction");

  el("accForm").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function validate(data) {
  if (
    !["income", "expense"].includes(data.type) ||
    !validDate(data.date) ||
    data.date < START_DATE ||
    data.category.length < 2 ||
    data.category.length > 80 ||
    data.category === "Membership Fee" ||
    data.particulars.length < 3 ||
    data.particulars.length > 500 ||
    !Number.isFinite(data.amount) ||
    data.amount <= 0 ||
    data.amount > 10000000 ||
    Math.round(data.amount * 100) !==
      data.amount * 100 &&
      Math.abs(
        Math.round(data.amount * 100) -
        data.amount * 100
      ) > 0.000001 ||
    !["cash", "upi", "bank", "other"].includes(
      data.method
    )
  ) {
    throw Error("Invalid transaction details.");
  }
}

function getFormData() {
  return {
    type: el("accType").value,
    date: el("accDate").value,
    category: el("accCategory").value.trim(),
    particulars: el("accParticulars").value.trim(),
    amount: Number(el("accAmount").value),
    method: el("accMethod").value
  };
}

async function saveEntry(event) {
  event.preventDefault();

  if (!admin || !user || busy) return;

  const uid = user.uid;
  const target = editId;
  const data = getFormData();
  const reason = el("accReason").value.trim();

  try {
    validate(data);

    if (
      target &&
      (reason.length < 5 || reason.length > 500)
    ) {
      throw Error("Edit reason must be 5–500 characters.");
    }
  } catch (error) {
    notice(error.message);
    return;
  }

  if (!confirm(
    `${target ? "Update" : "Save"} transaction?\n` +
    `Amount: ${money(data.amount)}\n` +
    `Particulars: ${data.particulars}`
  )) return;

  busy = true;
  el("accSave").disabled = true;

  try {
    if (auth.currentUser?.uid !== uid) {
      throw Error("Login session changed.");
    }

    if (!target) {
      const newRef = push(ref(db, "accounts/entries"));

      await set(newRef, {
        ...data,
        createdAt: serverTimestamp(),
        createdBy: uid
      });

      resetForm();
      notice("Transaction saved successfully.");

    } else {
      const entryRef = ref(
        db,
        "accounts/entries/" + target
      );

      const auditId = push(
        ref(db, "accounts/entries/" + target + "/audit")
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
        { applyLocally: false }
      );

      if (!result.committed) {
        throw Error("Record unavailable or edit cancelled.");
      }

      resetForm();
      notice("Transaction updated. Audit event saved.");
    }

  } catch (error) {
    notice("Save failed: " + error.message);

  } finally {
    busy = false;
    el("accSave").disabled = false;
  }
}

async function softDelete(id) {
  if (!admin || !user || busy) return;

  const item = entries[id];

  if (!item || item.deleted === true) {
    notice("Record unavailable.");
    return;
  }

  const answer = prompt(
    "Reason for Soft Delete (minimum 5 characters):"
  );

  if (answer === null) return;

  const reason = answer.trim();

  if (reason.length < 5 || reason.length > 500) {
    notice("Reason must be 5–500 characters.");
    return;
  }

  if (!confirm(
    "Soft Delete this transaction?\n\n" +
    "Amount: " + money(item.amount) + "\n" +
    "The original record will remain in Firebase."
  )) return;

  busy = true;

  const uid = user.uid;

  try {
    if (auth.currentUser?.uid !== uid) {
      throw Error("Login session changed.");
    }

    const entryRef = ref(
      db,
      "accounts/entries/" + id
    );

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
      { applyLocally: false }
    );

    if (!result.committed) {
      throw Error("Record unavailable or delete cancelled.");
    }

    if (editId === id) resetForm();

    notice("Transaction soft-deleted. Audit saved.");

  } catch (error) {
    notice("Delete failed: " + error.message);

  } finally {
    busy = false;
  }
}

function stopListeners() {
  for (const stop of unsubscribers) {
    try {
      stop();
    } catch (_) {}
  }

  unsubscribers = [];

  entries = {};
  members = {};
  corrections = {};
  requests = {};

  ready = {
    entries: false,
    members: false,
    corrections: false,
    requests: false
  };
}

function listen(path, key, callback, sequence) {
  const stop = onValue(
    ref(db, path),
    snapshot => {
      if (sequence !== authSequence) return;

      callback(snapshot.val() || {});
      ready[key] = true;
      render();
    },
    error => {
      if (sequence !== authSequence) return;

      ready[key] = false;

      console.error("Accounts read failed:", path, error);

      notice(
        "Database read failed: " +
        path +
        " - " +
        error.message
      );

      render();
    }
  );

  unsubscribers.push(stop);
}

onAuthStateChanged(auth, async account => {
  const sequence = ++authSequence;

  stopListeners();

  user = account;
  admin = false;
  approved = false;

  resetForm();
  showAccess();
  render();

  if (!account) return;

  try {
    const adminSnapshot = await get(
      ref(db, "admins/" + account.uid)
    );

    if (sequence !== authSequence) return;

    admin = adminSnapshot.val() === true;

    if (!admin) {
      const userSnapshot = await get(
        ref(db, "users/" + account.uid)
      );

      if (sequence !== authSequence) return;

      approved =
        userSnapshot.val()?.status === "approved";
    }

    showAccess();

    if (!admin && !approved) return;

    listen(
      "accounts/entries",
      "entries",
      value => { entries = value; },
      sequence
    );

    if (admin) {
      listen(
        "members",
        "members",
        value => { members = value; },
        sequence
      );

      listen(
        "paymentCorrections",
        "corrections",
        value => { corrections = value; },
        sequence
      );

      listen(
        "paymentRequests",
        "requests",
        value => { requests = value; },
        sequence
      );
    }

  } catch (error) {
    console.error(error);
    notice("Accounts login error: " + error.message);
  }
});

createUI();
render();

/* END TFC ACCOUNTS v83.7 */
