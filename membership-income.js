
/*
 TFC BANDIYOD
 MEMBERSHIP INCOME — VERSION 84.0

 Automatic verified membership collections.

 Cash and UPI payments:
 - Counted once
 - Historical PDF records excluded
 - 2026-11-08 onward
 - Monthly ₹50
 - Yearly ₹600

 Admin:
 - Detailed collection report

 Approved members:
 - Read-only collection report

 No database writes.
 No existing payment records modified.
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
  onValue
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js";

import { firebaseConfig } from "./firebase-config.js";

const app = getApps()[0] || initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

const START_AT = Date.parse("2026-11-08T00:00:00+05:30");
const MONTHLY_FEE = 50;
const YEARLY_FEE = 600;

const $ = id => document.getElementById(id);

let currentUid = null;
let admin = false;
let generation = 0;

let members = {};
let requests = {};
let corrections = {};

let loaded = {
  members: false,
  requests: false,
  corrections: false
};

let listeners = [];

const money = amount =>
  "₹" + Number(amount || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

const safe = value =>
  String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));

function validPeriod(period) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(period));
}

function validTimestamp(value) {
  const n = Number(value);

  return Number.isFinite(n) &&
    n >= START_AT &&
    n <= Date.now() + 300000;
}

function localDate(timestamp) {
  const d = new Date(Number(timestamp));

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(d);

  const value = key =>
    parts.find(part => part.type === key)?.value || "";

  return `${value("year")}-${value("month")}-${value("day")}`;
}

function paymentMonths(plan, period) {
  if (!validPeriod(period)) return [];

  if (plan === "monthly") return [period];

  if (plan === "yearly") {
    const year = period.slice(0, 4);

    return Array.from(
      { length: 12 },
      (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`
    );
  }

  return [];
}

function isCancelled(number, period) {
  return corrections?.[String(number)]?.[period]?.state === "cancelled";
}

function buildSection(parent, id, prefix, heading) {
  if (!parent || $(id)) return;

  const section = document.createElement("section");
  section.id = id;
  section.className = "panel";

  section.innerHTML = `
    <h3>${heading}</h3>

    <p class="muted">
      Verified Cash and UPI membership collections
      from 08-11-2026 onward.
      Historical PDF payments are excluded.
    </p>

    <label for="${prefix}Year">Collection Year</label>

    <select id="${prefix}Year">
      <option value="all">All Years</option>
    </select>

    <div class="grid">
      <div class="stat">
        <span>Total Membership Income</span>
        <strong id="${prefix}Total">₹0</strong>
      </div>

      <div class="stat">
        <span>Cash</span>
        <strong id="${prefix}Cash">₹0</strong>
      </div>

      <div class="stat">
        <span>UPI</span>
        <strong id="${prefix}Upi">₹0</strong>
      </div>
    </div>

    <p id="${prefix}Status">Loading...</p>

    <div id="${prefix}History" class="scroll"></div>

    <p class="muted">
      Collection totals are not bank reconciliation.
      Cancelled payments may require separate
      refund or adjustment entries.
    </p>
  `;

  parent.append(section);

  $(`${prefix}Year`).onchange = render;
}

function setupUI() {
  if (admin) {
    buildSection(
      $("accountsPanel"),
      "automaticMembershipIncome",
      "automaticIncome",
      "Automatic Membership Income"
    );
  }

  buildSection(
    $("memberAccountsPanel"),
    "memberMembershipIncome",
    "memberIncome",
    "Membership Income"
  );
}

function collectCash() {
  const groups = new Map();

  for (const [number, member] of Object.entries(members)) {
    for (const [period, payment] of Object.entries(
      member?.payments || {}
    )) {
      if (
        !validPeriod(period) ||
        payment?.status !== "paid" ||
        payment?.method !== "cash" ||
        !validTimestamp(payment.verifiedAt) ||
        isCancelled(number, period)
      ) continue;

      if (Number(payment.amount) !== MONTHLY_FEE) continue;

      const key = [
        number,
        payment.verifiedAt,
        payment.verifiedBy || "",
        payment.plan || "",
        payment.receivedDate || ""
      ].join("|");

      if (!groups.has(key)) {
        groups.set(key, {
          memberNumber: number,
          memberName: member.name || "Member",
          method: "Cash",
          date: localDate(payment.verifiedAt),
          amount: 0,
          periods: [],
          timestamp: Number(payment.verifiedAt)
        });
      }

      const group = groups.get(key);

      group.amount += MONTHLY_FEE;
      group.periods.push(period);
    }
  }

  return [...groups.values()];
}

function collectUPI() {
  const result = [];

  for (const [requestId, request] of Object.entries(requests)) {
    if (
      request?.status !== "approved" ||
      !validTimestamp(request.reviewedAt)
    ) continue;

    const number = String(request.memberNumber || "");
    const member = members[number];

    if (!member) continue;

    const periods = paymentMonths(
      request.plan,
      request.period
    );

    const amount = request.plan === "yearly"
      ? YEARLY_FEE
      : MONTHLY_FEE;

    if (
      !periods.length ||
      Number(request.amount) !== amount
    ) continue;

    const verified = periods.every(period => {
      const payment = member.payments?.[period];

      return payment?.status === "paid" &&
        payment.requestId === requestId &&
        validTimestamp(payment.verifiedAt);
    });

    if (!verified) continue;

    result.push({
      memberNumber: number,
      memberName: member.name || "Member",
      method: "UPI",
      date: localDate(request.reviewedAt),
      amount,
      periods,
      timestamp: Number(request.reviewedAt),
      cancelledPeriods: periods.filter(
        period => isCancelled(number, period)
      )
    });
  }

  return result;
}

function collectEntries() {
  return [
    ...collectCash(),
    ...collectUPI()
  ].sort((a, b) => b.timestamp - a.timestamp);
}

function fillYearSelect(select, entries) {
  if (!select) return "all";

  const previous = select.value || "all";

  const years = [
    ...new Set(entries.map(entry => entry.date.slice(0, 4)))
  ].sort().reverse();

  select.replaceChildren(
    new Option("All Years", "all"),
    ...years.map(year => new Option(year, year))
  );

  select.value = years.includes(previous) ? previous : "all";

  return select.value;
}

function renderReport(prefix, entries) {
  const select = $(`${prefix}Year`);
  const history = $(`${prefix}History`);
  const status = $(`${prefix}Status`);

  if (!select || !history || !status) return;

  if (
    !loaded.members ||
    !loaded.requests ||
    !loaded.corrections
  ) {
    status.textContent = "Loading verified collections...";
    return;
  }

  const year = fillYearSelect(select, entries);

  const filtered = entries.filter(entry =>
    year === "all" || entry.date.startsWith(year)
  );

  const cash = filtered
    .filter(entry => entry.method === "Cash")
    .reduce((sum, entry) => sum + entry.amount, 0);

  const upi = filtered
    .filter(entry => entry.method === "UPI")
    .reduce((sum, entry) => sum + entry.amount, 0);

  $(`${prefix}Cash`).textContent = money(cash);
  $(`${prefix}Upi`).textContent = money(upi);
  $(`${prefix}Total`).textContent = money(cash + upi);

  status.textContent =
    `${filtered.length} verified collection(s)`;

  if (!filtered.length) {
    history.textContent =
      "No verified collections for this period.";
    return;
  }

  history.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Member</th>
          <th>Method</th>
          <th>Payment Period</th>
          <th>Amount</th>
          <th>Correction</th>
        </tr>
      </thead>

      <tbody>
        ${filtered.map(entry => `
          <tr>
            <td>${safe(entry.date)}</td>
            <td>
              #${safe(entry.memberNumber)}
              ${safe(entry.memberName)}
            </td>
            <td>${safe(entry.method)}</td>
            <td>${safe(entry.periods.join(", "))}</td>
            <td>${money(entry.amount)}</td>
            <td>
              ${entry.cancelledPeriods?.length
                ? safe(
                    "Review: " +
                    entry.cancelledPeriods.join(", ")
                  )
                : "—"}
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function render() {
  setupUI();

  if (!admin) return;

  const entries = collectEntries();

  renderReport("automaticIncome", entries);

  // Member report must be supplied through a
  // separate privacy-safe Firebase summary.
  // Never expose the entire members/paymentRequests
  // database to approved members.
}

function stopListening() {
  listeners.forEach(unsubscribe => {
    try {
      unsubscribe();
    } catch (_) {}
  });

  listeners = [];

  members = {};
  requests = {};
  corrections = {};

  loaded = {
    members: false,
    requests: false,
    corrections: false
  };
}

onAuthStateChanged(auth, async account => {
  const id = ++generation;

  stopListening();

  currentUid = account?.uid || null;
  admin = false;

  if (!account) return;

  try {
    const snapshot = await get(
      ref(db, `admins/${account.uid}`)
    );

    if (
      id !== generation ||
      auth.currentUser?.uid !== account.uid
    ) return;

    admin = snapshot.val() === true;

    setupUI();

    if (!admin) {
      const status = $("memberIncomeStatus");

      if (status) {
        status.textContent =
          "Membership income summary will appear " +
          "after secure member-readable summary setup.";
      }

      return;
    }

    const listen = (path, key, setter) => {
      listeners.push(
        onValue(
          ref(db, path),
          snapshot => {
            if (id !== generation) return;

            setter(snapshot.val() || {});
            loaded[key] = true;
            render();
          },
          error => {
            const status = $("automaticIncomeStatus");

            if (status) {
              status.textContent =
                `${key} read failed: ${error.message}`;
            }
          }
        )
      );
    };

    listen(
      "members",
      "members",
      value => { members = value; }
    );

    listen(
      "paymentRequests",
      "requests",
      value => { requests = value; }
    );

    listen(
      "paymentCorrections",
      "corrections",
      value => { corrections = value; }
    );

  } catch (error) {
    console.error("Membership income:", error);
  }
});

setupUI();

/* END MEMBERSHIP INCOME v84.0 */
