
/*
 TFC BANDIYOD — ACCOUNTS v85.0

 Database:
   accounts/entries
   accounts/audit
   accounts/publicMembershipIncome

 Admin:
   Add, Edit, Soft Delete, View Audit

 Approved Members:
   Read-only Accounts

 Opening Balance:
   Existing ₹221914 record preserved.
   Never edit or delete opening balance.

 Membership Income:
   Read from membership-income.js published data.
   Never manually add membership fees here.

 Final Balance:
   Opening Balance
   + Other Income
   + Automatic Membership Income
   - Expenses
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
  update,
  runTransaction
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js";

import { firebaseConfig } from "./firebase-config.js";

const app = getApps()[0] || initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

const START_DATE = "2026-11-08";
const MAX_AMOUNT = 10000000;

const PUBLIC_INCOME_PATH =
  "accounts/publicMembershipIncome";

const $ = id => document.getElementById(id);

let user = null;
let admin = false;
let approved = false;
let generation = 0;
let busy = false;
let editing = null;

let entries = {};
let audits = {};
let membershipData = null;
let membershipLoaded = false;
let membershipError = "";

let unsubscribers = [];

const money = n =>
  "₹" + Number(n || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

const safe = v =>
  String(v ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));

function today() {
  const d = new Date();

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
    [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, "0"),
      String(d.getDate()).padStart(2, "0")
    ].join("-") === value;
}

function message(text, error = false) {
  const el = $("accMessage");

  if (!el) return;

  el.textContent = text;
  el.className = error ? "error" : "ok";
}

/*
 Recognize the actual opening balance record.

 The existing database record has:
 Date: 2026-11-08
 Amount: 221914
 Category: Last committee balance
 Particulars: Opening balance

 Older supported labels are retained.
*/

function opening(item) {
  if (!item) return false;

  if (item.isOpeningBalance === true) {
    return true;
  }

  if (
    item.type !== "income" ||
    item.date !== START_DATE ||
    Number(item.amount) !== 221914
  ) {
    return false;
  }

  const category = String(
    item.category || ""
  ).trim().toLowerCase();

  const particulars = String(
    item.particulars || ""
  ).trim().toLowerCase();

  return (
    (
      category === "last committee balance" &&
      particulars === "opening balance"
    ) ||
    (
      category === "last balance" &&
      particulars === "last year balance"
    )
  );
}

function buildUI() {
  if (!$("admin") || !$("member")) return;

  if (!$("accountsPanel")) {
    const panel = document.createElement("section");

    panel.id = "accountsPanel";
    panel.className = "panel hide";

    panel.innerHTML = `
      <h2>TFC Accounts</h2>

      <p class="muted">
        Accounts from 08-11-2026
      </p>

      <div class="grid">
        <div class="stat">
          <span>Opening Balance</span>
          <strong id="accOpening">—</strong>
        </div>

        <div class="stat">
          <span>Other Income</span>
          <strong id="accOtherIncome">—</strong>
        </div>

        <div class="stat">
          <span>Membership Income</span>
          <strong id="accMembershipIncome">—</strong>
        </div>

        <div class="stat">
          <span>Expenses</span>
          <strong id="accExpenses">—</strong>
        </div>

        <div class="stat">
          <span>Final Balance</span>
          <strong id="accBalance">—</strong>
        </div>
      </div>

      <p id="accMembershipStatus"
         class="muted"
         role="status">
        Loading verified membership income...
      </p>

      <h3 id="accFormTitle">
        Add Income / Expense
      </h3>

      <form id="accForm">
        <label for="accType">Type</label>

        <select id="accType">
          <option value="income">Other Income</option>
          <option value="expense">Expense</option>
        </select>

        <label for="accDate">Date</label>

        <input id="accDate"
          type="date"
          min="${START_DATE}"
          required>

        <label for="accCategory">Category</label>

        <input id="accCategory"
          maxlength="80"
          required>

        <label for="accParticulars">
          Particulars
        </label>

        <input id="accParticulars"
          maxlength="500"
          required>

        <label for="accAmount">Amount</label>

        <input id="accAmount"
          type="number"
          min="0.01"
          max="${MAX_AMOUNT}"
          step="0.01"
          required>

        <label for="accMethod">Method</label>

        <select id="accMethod">
          <option value="cash">Cash</option>
          <option value="upi">UPI</option>
          <option value="bank">Bank</option>
          <option value="other">Other</option>
        </select>

        <div id="accReasonBox" hidden>
          <label for="accReason">
            Reason for Edit
          </label>

          <textarea id="accReason"
            maxlength="500"></textarea>
        </div>

        <div class="form-actions">
          <button id="accSave" type="submit">
            Save Transaction
          </button>

          <button id="accCancelEdit"
            type="button"
            class="secondary"
            hidden>
            Cancel Edit
          </button>
        </div>
      </form>

      <p id="accMessage" role="status"></p>

      <h3>Accounts History</h3>

      <label for="accYear">Select Year</label>

      <select id="accYear">
        <option value="all">All Years</option>
      </select>

      <p class="muted">
        Year selection filters transaction history.
        Final Balance always includes all recorded years.
        Automatic membership collections are shown
        separately below.
      </p>

      <div id="accTable" class="scroll"></div>

      <h3>Admin Audit History</h3>

      <div id="accAuditTable" class="scroll"></div>
    `;

    $("admin").append(panel);
  }

  if (!$("memberAccountsPanel")) {
    const panel = document.createElement("section");

    panel.id = "memberAccountsPanel";
    panel.className = "panel hide";

    panel.innerHTML = `
      <h2>TFC Accounts</h2>

      <p class="muted">
        Read-only accounts
      </p>

      <div class="grid">
        <div class="stat">
          <span>Opening Balance</span>
          <strong id="memberAccOpening">—</strong>
        </div>

        <div class="stat">
          <span>Other Income</span>
          <strong id="memberAccIncome">—</strong>
        </div>

        <div class="stat">
          <span>Membership Income</span>
          <strong id="memberAccMembershipIncome">—</strong>
        </div>

        <div class="stat">
          <span>Expenses</span>
          <strong id="memberAccExpenses">—</strong>
        </div>

        <div class="stat">
          <span>Final Balance</span>
          <strong id="memberAccBalance">—</strong>
        </div>
      </div>

      <p id="memberAccMembershipStatus"
         class="muted"
         role="status">
        Loading verified membership income...
      </p>

      <h3>Accounts History</h3>

      <div id="memberAccTable"
        class="scroll"></div>
    `;

    $("member").append(panel);
  }

  $("accDate").value = today();

  $("accForm").addEventListener(
    "submit",
    saveTransaction
  );

  $("accCancelEdit").onclick = resetForm;
  $("accYear").onchange = render;

  $("accTable").addEventListener(
    "click",
    event => {
      const b = event.target.closest(
        "button[data-action]"
      );

      if (!b || !admin || busy) return;

      const id = b.dataset.id;

      if (b.dataset.action === "edit") {
        editTransaction(id);
      }

      if (b.dataset.action === "delete") {
        deleteTransaction(id);
      }
    }
  );

  const tabs = $("tabMembers")?.parentElement;

  if (tabs && !$("tabAccounts")) {
    const b = document.createElement("button");

    b.id = "tabAccounts";
    b.type = "button";
    b.className = "secondary";
    b.textContent = "Accounts";

    tabs.append(b);

    b.onclick = () => {
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
        $(id)?.classList.add("hide");
      });

      $("accountsPanel").classList.remove("hide");
    };

    tabs.addEventListener(
      "click",
      event => {
        if (
          event.target.closest("button") !== b
        ) {
          $("accountsPanel").classList.add("hide");
        }
      }
    );
  }
}

function rows() {
  return Object.entries(entries)
    .filter(([, item]) =>
      item &&
      item.deleted !== true &&
      ["income", "expense"].includes(item.type) &&
      validDate(item.date) &&
      Number(item.amount) > 0
    )
    .map(([id, item]) => ({
      ...item,
      id,
      amount: Number(item.amount),
      opening: opening(item)
    }));
}

/*
 Public membership income is the only source
 for the automatic membership total.

 No membership payment is written into
 accounts/entries by this file.
*/

function membershipSummary() {
  if (!membershipLoaded || membershipError) {
    return {
      ready: false,
      amount: 0,
      count: 0
    };
  }

  if (!membershipData) {
    return {
      ready: false,
      amount: 0,
      count: 0
    };
  }

  const records = Object.values(
    membershipData.entries || {}
  );

  let total = 0;

  for (const item of records) {
    if (
      !item ||
      !["Cash", "UPI"].includes(item.method) ||
      !validDate(item.date)
    ) {
      return {
        ready: false,
        amount: 0,
        count: 0
      };
    }

    const amount = Number(item.amount);

    if (
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      return {
        ready: false,
        amount: 0,
        count: 0
      };
    }

    total += amount;
  }

  return {
    ready: true,
    amount: total,
    count: records.length
  };
}

function tableHTML(items, actions) {
  if (!items.length) {
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
        ${items.map(item => `
          <tr>
            <td>${safe(item.date)}</td>

            <td>${safe(
              item.opening
                ? "Opening"
                : item.type
            )}</td>

            <td>${safe(item.category)}</td>

            <td>${safe(item.particulars)}</td>

            <td>${money(item.amount)}</td>

            <td>${safe(item.method)}</td>

            ${actions ? `
              <td>
                ${item.opening
                  ? `<span class="muted">
                       Protected
                     </span>`
                  : `
                    <button type="button"
                      data-action="edit"
                      data-id="${safe(item.id)}">
                      Edit
                    </button>

                    <button type="button"
                      class="danger"
                      data-action="delete"
                      data-id="${safe(item.id)}">
                      Delete
                    </button>
                  `
                }
              </td>
            ` : ""}
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function render() {
  const all = rows();

  const openingRows = all.filter(
    item => item.opening
  );

  const normalRows = all.filter(
    item => !item.opening
  );

  const openingAmount = openingRows.reduce(
    (sum, item) =>
      sum + (
        item.type === "income"
          ? item.amount
          : 0
      ),
    0
  );

  const allOtherIncome = normalRows
    .filter(item => item.type === "income")
    .reduce(
      (sum, item) => sum + item.amount,
      0
    );

  const allExpenses = normalRows
    .filter(item => item.type === "expense")
    .reduce(
      (sum, item) => sum + item.amount,
      0
    );

  const membership = membershipSummary();

  const finalBalance = membership.ready
    ? openingAmount +
      allOtherIncome +
      membership.amount -
      allExpenses
    : null;

  const put = (id, value) => {
    if (!$(id)) return;

    $(id).textContent =
      value === null ? "—" : money(value);
  };

  /*
   Admin summary:
   All years, not selected-year totals.
  */

  put("accOpening", openingAmount);
  put("accOtherIncome", allOtherIncome);
  put("accExpenses", allExpenses);

  put(
    "accMembershipIncome",
    membership.ready
      ? membership.amount
      : null
  );

  put("accBalance", finalBalance);

  /*
   Member summary:
   Same totals as admin.
  */

  put("memberAccOpening", openingAmount);
  put("memberAccIncome", allOtherIncome);
  put("memberAccExpenses", allExpenses);

  put(
    "memberAccMembershipIncome",
    membership.ready
      ? membership.amount
      : null
  );

  put("memberAccBalance", finalBalance);

  const statusText = membershipError
    ? "Membership income read failed: " +
      membershipError
    : !membershipLoaded
      ? "Loading verified membership income..."
      : !membership.ready
        ? "Membership income unavailable. Final balance cannot be confirmed."
        : `${membership.count} verified collection(s) included in Final Balance.`;

  for (const id of [
    "accMembershipStatus",
    "memberAccMembershipStatus"
  ]) {
    const element = $(id);

    if (!element) continue;

    element.textContent = statusText;

    element.className =
      membershipError || (
        membershipLoaded && !membership.ready
      )
        ? "error"
        : "muted";
  }

  /*
   Admin history year filter.
   Does not change the Final Balance.
  */

  const years = [
    ...new Set(
      normalRows.map(
        item => item.date.slice(0, 4)
      )
    )
  ].sort().reverse();

  const select = $("accYear");
  let year = "all";

  if (select) {
    const old = select.value;

    select.replaceChildren(
      new Option("All Years", "all"),
      ...years.map(
        y => new Option(y, y)
      )
    );

    select.value = years.includes(old)
      ? old
      : "all";

    year = select.value;
  }

  const selected = normalRows.filter(
    item =>
      year === "all" ||
      item.date.startsWith(year)
  );

  if ($("accTable")) {
    $("accTable").innerHTML = tableHTML(
      [...openingRows, ...selected]
        .sort(
          (a, b) =>
            b.date.localeCompare(a.date)
        ),
      true
    );
  }

  if ($("memberAccTable")) {
    $("memberAccTable").innerHTML = tableHTML(
      [...all].sort(
        (a, b) =>
          b.date.localeCompare(a.date)
      ),
      false
    );
  }

  if ($("accAuditTable")) {
    const events = Object.entries(audits)
      .sort(
        (a, b) =>
          (b[1]?.at || 0) -
          (a[1]?.at || 0)
      );

    $("accAuditTable").innerHTML =
      events.length
        ? `
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Action</th>
                <th>Reason</th>
                <th>Admin</th>
              </tr>
            </thead>

            <tbody>
              ${events.map(([, e]) => `
                <tr>
                  <td>${safe(
                    e.at
                      ? new Date(
                          e.at
                        ).toLocaleString("en-IN")
                      : ""
                  )}</td>

                  <td>${safe(e.action)}</td>
                  <td>${safe(e.reason)}</td>
                  <td>${safe(e.adminUid)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        `
        : "<p>No audit events yet.</p>";
  }
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

function validate(data) {
  if (!["income", "expense"].includes(data.type)) {
    throw Error("Invalid transaction type.");
  }

  if (
    !validDate(data.date) ||
    data.date < START_DATE
  ) {
    throw Error("Invalid transaction date.");
  }

  if (
    data.category.length < 2 ||
    data.category.length > 80
  ) {
    throw Error("Invalid category.");
  }

  const category = data.category.toLowerCase();

  if (
    category === "membership fee" ||
    category === "membership income" ||
    category === "automatic membership income"
  ) {
    throw Error(
      "Membership fees are automatically recorded. Do not add them manually."
    );
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
    data.amount > MAX_AMOUNT
  ) {
    throw Error("Invalid amount.");
  }

  if (
    !["cash", "upi", "bank", "other"]
      .includes(data.method)
  ) {
    throw Error("Invalid payment method.");
  }

  if (opening(data)) {
    throw Error(
      "Opening balance already exists and cannot be added again."
    );
  }
}

function resetForm() {
  editing = null;

  if (!$("accForm")) return;

  $("accForm").reset();
  $("accDate").value = today();
  $("accReason").value = "";
  $("accReasonBox").hidden = true;
  $("accCancelEdit").hidden = true;

  $("accFormTitle").textContent =
    "Add Income / Expense";

  $("accSave").textContent =
    "Save Transaction";
}

function editTransaction(id) {
  const item = entries[id];

  if (!item || item.deleted === true) {
    return message(
      "Transaction unavailable.",
      true
    );
  }

  if (opening(item)) {
    return message(
      "Opening balance is protected and cannot be edited.",
      true
    );
  }

  editing = id;

  $("accType").value = item.type;
  $("accDate").value = item.date;
  $("accCategory").value = item.category || "";

  $("accParticulars").value =
    item.particulars || "";

  $("accAmount").value = item.amount;

  $("accMethod").value =
    item.method || "other";

  $("accReasonBox").hidden = false;
  $("accCancelEdit").hidden = false;

  $("accFormTitle").textContent =
    "Edit Transaction";

  $("accSave").textContent =
    "Update Transaction";

  message(
    "Enter changes and an edit reason."
  );

  $("accForm").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

async function saveTransaction(event) {
  event.preventDefault();

  if (!admin || !user || busy) return;

  const data = formData();
  const reason = $("accReason").value.trim();
  const target = editing;
  const uid = user.uid;

  try {
    validate(data);

    if (target) {
      const original = entries[target];

      if (!original || original.deleted === true) {
        throw Error("Transaction unavailable.");
      }

      if (opening(original)) {
        throw Error(
          "Opening balance cannot be edited."
        );
      }

      if (
        reason.length < 5 ||
        reason.length > 500
      ) {
        throw Error(
          "Edit reason must contain 5–500 characters."
        );
      }
    }
  } catch (e) {
    return message(e.message, true);
  }

  if (!confirm(
    `${target ? "Update" : "Save"} transaction?\n` +
    `Amount: ${money(data.amount)}\n` +
    `Particulars: ${data.particulars}`
  )) return;

  busy = true;
  $("accSave").disabled = true;
  message("Saving...");

  try {
    if (auth.currentUser?.uid !== uid) {
      throw Error("Login session changed.");
    }

    if (!target) {
      const entryRef = push(
        ref(db, "accounts/entries")
      );

      const auditRef = push(
        ref(db, "accounts/audit")
      );

      const now = Date.now();

      await update(ref(db), {
        [`accounts/entries/${entryRef.key}`]: {
          ...data,
          createdAt: now,
          createdBy: uid
        },

        [`accounts/audit/${auditRef.key}`]: {
          entryId: entryRef.key,
          action: "create",
          reason: "New transaction",
          adminUid: uid,
          at: now
        }
      });

    } else {
      const entryRef = ref(
        db,
        `accounts/entries/${target}`
      );

      const auditRef = push(
        ref(db, "accounts/audit")
      );

      const now = Date.now();

      const result = await runTransaction(
        entryRef,
        old => {
          if (
            !old ||
            old.deleted === true ||
            opening(old)
          ) {
            return;
          }

          return {
            ...old,
            ...data,
            updatedAt: now,
            updatedBy: uid,
            revision:
              Number(old.revision || 0) + 1
          };
        },
        { applyLocally: false }
      );

      if (!result.committed) {
        throw Error(
          "Transaction changed or unavailable."
        );
      }

      await update(ref(db), {
        [`accounts/audit/${auditRef.key}`]: {
          entryId: target,
          action: "edit",
          reason,
          adminUid: uid,
          at: now
        }
      });
    }

    resetForm();

    message(
      "Transaction saved successfully."
    );

  } catch (e) {
    message(
      "Save failed: " + e.message,
      true
    );

  } finally {
    busy = false;
    $("accSave").disabled = false;
  }
}

async function deleteTransaction(id) {
  if (!admin || !user || busy) return;

  const item = entries[id];

  if (!item || item.deleted === true) {
    return message(
      "Transaction unavailable.",
      true
    );
  }

  if (opening(item)) {
    return message(
      "Opening balance is protected and cannot be deleted.",
      true
    );
  }

  const input = prompt(
    "Reason for soft delete:"
  );

  if (input === null) return;

  const reason = input.trim();

  if (
    reason.length < 5 ||
    reason.length > 500
  ) {
    return message(
      "Reason must contain 5–500 characters.",
      true
    );
  }

  if (!confirm(
    `Soft delete transaction of ${money(item.amount)}?\n` +
    "Original record will remain stored."
  )) return;

  busy = true;
  message("Deleting...");

  try {
    const uid = user.uid;
    const now = Date.now();

    const result = await runTransaction(
      ref(db, `accounts/entries/${id}`),
      old => {
        if (
          !old ||
          old.deleted === true ||
          opening(old)
        ) {
          return;
        }

        return {
          ...old,
          deleted: true,
          deletedAt: now,
          deletedBy: uid,
          deleteReason: reason,
          revision:
            Number(old.revision || 0) + 1
        };
      },
      { applyLocally: false }
    );

    if (!result.committed) {
      throw Error(
        "Transaction changed or unavailable."
      );
    }

    const auditRef = push(
      ref(db, "accounts/audit")
    );

    await update(ref(db), {
      [`accounts/audit/${auditRef.key}`]: {
        entryId: id,
        action: "delete",
        reason,
        adminUid: uid,
        at: now
      }
    });

    if (editing === id) resetForm();

    message(
      "Transaction soft-deleted. Audit saved."
    );

  } catch (e) {
    message(
      "Delete failed: " + e.message,
      true
    );

  } finally {
    busy = false;
  }
}

function stopListening() {
  unsubscribers.forEach(fn => {
    try {
      fn();
    } catch (_) {}
  });

  unsubscribers = [];

  entries = {};
  audits = {};

  membershipData = null;
  membershipLoaded = false;
  membershipError = "";
}

onAuthStateChanged(
  auth,
  async account => {
    const id = ++generation;

    stopListening();

    user = account;
    admin = false;
    approved = false;

    resetForm();

    $("accountsPanel")
      ?.classList.add("hide");

    $("memberAccountsPanel")
      ?.classList.add("hide");

    render();

    if (!account) return;

    try {
      const a = await get(
        ref(db, `admins/${account.uid}`)
      );

      if (id !== generation) return;

      admin = a.val() === true;

      if (!admin) {
        const u = await get(
          ref(db, `users/${account.uid}`)
        );

        if (id !== generation) return;

        approved =
          u.val()?.status === "approved";
      }

      if (!admin && !approved) return;

      if (approved && !admin) {
        $("memberAccountsPanel")
          ?.classList.remove("hide");
      }

      unsubscribers.push(
        onValue(
          ref(db, "accounts/entries"),
          snapshot => {
            if (id !== generation) return;

            entries = snapshot.val() || {};
            render();
          },
          error => {
            if (id !== generation) return;

            message(
              "Accounts read failed: " +
              error.message,
              true
            );
          }
        )
      );

      /*
       Automatic membership income listener.

       Admin and approved members read the
       same published Firebase records.
      */

      unsubscribers.push(
        onValue(
          ref(db, PUBLIC_INCOME_PATH),
          snapshot => {
            if (id !== generation) return;

            membershipData = snapshot.val();
            membershipLoaded = true;
            membershipError = "";

            render();
          },
          error => {
            if (id !== generation) return;

            membershipLoaded = true;
            membershipData = null;
            membershipError = error.message;

            render();
          }
        )
      );

      if (admin) {
        unsubscribers.push(
          onValue(
            ref(db, "accounts/audit"),
            snapshot => {
              if (id !== generation) return;

              audits = snapshot.val() || {};
              render();
            },
            error => {
              if (id !== generation) return;

              message(
                "Audit read failed: " +
                error.message,
                true
              );
            }
          )
        );
      }

    } catch (e) {
      if (id !== generation) return;

      message(
        "Accounts error: " + e.message,
        true
      );
    }
  }
);

buildUI();
render();

/* END TFC ACCOUNTS v85.0 */
