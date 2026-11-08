
/*
 TFC BANDIYOD
 MEMBERSHIP INCOME — VERSION 85.0

 Compatible with:
 app.js v82.0
 accounts.js v84.0
 index.html v84.0

 Admin:
 - Verified cash and UPI collections
 - Detailed collection history
 - Historical PDF records excluded
 - From 2026-11-08
 - No changes to payment records

 Members:
 - Read-only public summary
 - No access to private members database
 - No access to private payment requests

 Important:
 Public summary must be created by a trusted
 server-side process or securely validated
 admin publishing workflow.

 This module does not publish financial data.
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

const START_AT = Date.parse(
  "2026-11-08T00:00:00+05:30"
);

const MONTHLY_FEE = 50;
const YEARLY_FEE = 600;

const PUBLIC_PATH =
  "accounts/publicMembershipIncome";

const $ = id => document.getElementById(id);

let admin = false;
let generation = 0;

let members = {};
let requests = {};
let corrections = {};

let publicSummary = null;

let loaded = {
  members: false,
  requests: false,
  corrections: false
};

let listeners = [];
let loadError = "";

const money = amount =>
  "₹" + Number(amount || 0).toLocaleString(
    "en-IN",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }
  );

const safe = value =>
  String(value ?? "").replace(
    /[&<>"']/g,
    character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[character])
  );

function validPeriod(period) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(
    String(period)
  );
}

function validTimestamp(value) {
  const timestamp = Number(value);

  return Number.isFinite(timestamp) &&
    timestamp >= START_AT &&
    timestamp <= Date.now() + 300000;
}

function localDate(timestamp) {
  const date = new Date(Number(timestamp));

  const parts = new Intl.DateTimeFormat(
    "en-GB",
    {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }
  ).formatToParts(date);

  const value = type =>
    parts.find(part => part.type === type)
      ?.value || "";

  return (
    value("year") + "-" +
    value("month") + "-" +
    value("day")
  );
}

function paymentMonths(plan, period) {
  if (!validPeriod(period)) return [];

  if (plan === "monthly") {
    return [period];
  }

  if (plan === "yearly") {
    const year = period.slice(0, 4);

    return Array.from(
      { length: 12 },
      (_, index) =>
        year + "-" +
        String(index + 1).padStart(2, "0")
    );
  }

  return [];
}

function isCancelled(number, period) {
  return corrections?.[String(number)]
    ?.[period]?.state === "cancelled";
}

function buildSection(
  parent,
  id,
  prefix,
  heading
) {
  if (!parent || $(id)) return;

  const section =
    document.createElement("section");

  section.id = id;
  section.className = "panel";

  section.innerHTML = `
    <h3>${heading}</h3>

    <p class="muted">
      Verified Cash and UPI membership collections
      from 08-11-2026 onward.
      Historical PDF payments are excluded.
    </p>

    <label for="${prefix}Year">
      Collection Year
    </label>

    <select id="${prefix}Year">
      <option value="all">All Years</option>
    </select>

    <div class="grid">

      <div class="stat">
        <span>Total Membership Income</span>
        <strong id="${prefix}Total">₹0.00</strong>
      </div>

      <div class="stat">
        <span>Cash</span>
        <strong id="${prefix}Cash">₹0.00</strong>
      </div>

      <div class="stat">
        <span>UPI</span>
        <strong id="${prefix}Upi">₹0.00</strong>
      </div>

    </div>

    <p id="${prefix}Status" role="status">
      Loading...
    </p>

    <div id="${prefix}History" class="scroll">
    </div>

    <p class="muted">
      Collection totals are not bank reconciliation.
      Cancelled payments may require separate
      refund or adjustment entries.
    </p>
  `;

  parent.append(section);

  const select = $(`${prefix}Year`);

  if (select) {
    select.addEventListener(
      "change",
      render
    );
  }
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

  for (
    const [number, member]
    of Object.entries(members)
  ) {
    for (
      const [period, payment]
      of Object.entries(
        member?.payments || {}
      )
    ) {
      if (
        !validPeriod(period) ||
        payment?.status !== "paid" ||
        payment?.method !== "cash" ||
        !validTimestamp(payment.verifiedAt) ||
        isCancelled(number, period) ||
        Number(payment.amount) !== MONTHLY_FEE
      ) {
        continue;
      }

      const key = [
        number,
        payment.verifiedAt,
        payment.verifiedBy || "",
        payment.plan || "",
        payment.receivedDate || ""
      ].join("|");

      if (!groups.has(key)) {
        groups.set(key, {
          id: key,
          memberNumber: number,
          memberName:
            member.name || "Member",
          method: "Cash",
          date: localDate(
            payment.verifiedAt
          ),
          amount: 0,
          periods: [],
          timestamp:
            Number(payment.verifiedAt),
          cancelledPeriods: []
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

  for (
    const [requestId, request]
    of Object.entries(requests)
  ) {
    if (
      request?.status !== "approved" ||
      !validTimestamp(request.reviewedAt)
    ) {
      continue;
    }

    const number = String(
      request.memberNumber || ""
    );

    const member = members[number];

    if (!member) continue;

    const periods = paymentMonths(
      request.plan,
      request.period
    );

    const amount =
      request.plan === "yearly"
        ? YEARLY_FEE
        : MONTHLY_FEE;

    if (
      !periods.length ||
      Number(request.amount) !== amount
    ) {
      continue;
    }

    const verified = periods.every(
      period => {
        const payment =
          member.payments?.[period];

        return (
          payment?.status === "paid" &&
          payment.requestId === requestId &&
          validTimestamp(
            payment.verifiedAt
          )
        );
      }
    );

    if (!verified) continue;

    result.push({
      id: requestId,
      memberNumber: number,
      memberName:
        member.name || "Member",
      method: "UPI",
      date: localDate(
        request.reviewedAt
      ),
      amount,
      periods,
      timestamp:
        Number(request.reviewedAt),
      cancelledPeriods:
        periods.filter(
          period =>
            isCancelled(number, period)
        )
    });
  }

  return result;
}

function collectEntries() {
  return [
    ...collectCash(),
    ...collectUPI()
  ].sort(
    (a, b) =>
      b.timestamp - a.timestamp
  );
}

function fillYearSelect(
  select,
  entries
) {
  if (!select) return "all";

  const previous =
    select.value || "all";

  const years = [
    ...new Set(
      entries.map(
        entry =>
          String(entry.date).slice(0, 4)
      )
    )
  ].filter(
    year => /^\d{4}$/.test(year)
  ).sort().reverse();

  select.replaceChildren(
    new Option(
      "All Years",
      "all"
    ),
    ...years.map(
      year =>
        new Option(year, year)
    )
  );

  select.value =
    years.includes(previous)
      ? previous
      : "all";

  return select.value;
}

function renderReport(
  prefix,
  entries,
  options = {}
) {
  const select =
    $(`${prefix}Year`);

  const history =
    $(`${prefix}History`);

  const status =
    $(`${prefix}Status`);

  if (
    !select ||
    !history ||
    !status
  ) {
    return;
  }

  const year = fillYearSelect(
    select,
    entries
  );

  const filtered =
    entries.filter(
      entry =>
        year === "all" ||
        String(entry.date).startsWith(year)
    );

  const cash =
    filtered
      .filter(
        entry =>
          entry.method === "Cash"
      )
      .reduce(
        (sum, entry) =>
          sum + Number(entry.amount || 0),
        0
      );

  const upi =
    filtered
      .filter(
        entry =>
          entry.method === "UPI"
      )
      .reduce(
        (sum, entry) =>
          sum + Number(entry.amount || 0),
        0
      );

  $(`${prefix}Cash`).textContent =
    money(cash);

  $(`${prefix}Upi`).textContent =
    money(upi);

  $(`${prefix}Total`).textContent =
    money(cash + upi);

  status.textContent =
    options.status ||
    `${filtered.length} verified collection(s)`;

  if (!filtered.length) {
    history.textContent =
      "No verified collections for this period.";
    return;
  }

  const showMember =
    options.showMember !== false;

  history.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Date</th>
          ${showMember ? "<th>Member</th>" : ""}
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

            ${showMember ? `
              <td>
                #${safe(entry.memberNumber)}
                ${safe(entry.memberName)}
              </td>
            ` : ""}

            <td>${safe(entry.method)}</td>

            <td>
              ${safe(
                (entry.periods || [])
                  .join(", ")
              )}
            </td>

            <td>
              ${money(entry.amount)}
            </td>

            <td>
              ${
                entry.cancelledPeriods?.length
                  ? safe(
                      "Review: " +
                      entry.cancelledPeriods
                        .join(", ")
                    )
                  : "—"
              }
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderAdmin() {
  if (!admin) return;

  if (
    !loaded.members ||
    !loaded.requests ||
    !loaded.corrections
  ) {
    const status =
      $("automaticIncomeStatus");

    if (status) {
      status.textContent =
        loadError ||
        "Loading verified collections...";
    }

    return;
  }

  const entries =
    collectEntries();

  renderReport(
    "automaticIncome",
    entries
  );
}

function normalizePublicSummary(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return null;
  }

  const rawEntries =
    Array.isArray(value.entries)
      ? value.entries
      : value.entries &&
        typeof value.entries === "object"
        ? Object.values(value.entries)
        : [];

  const entries = [];

  for (const item of rawEntries) {
    if (
      !item ||
      typeof item !== "object" ||
      !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(
        String(item.date || "")
      ) ||
      !["Cash", "UPI"].includes(
        item.method
      )
    ) {
      continue;
    }

    const amount =
      Number(item.amount);

    if (
      !Number.isFinite(amount) ||
      amount <= 0 ||
      amount > 100000000
    ) {
      continue;
    }

    entries.push({
      date: item.date,
      method: item.method,
      amount,
      periods: Array.isArray(
        item.periods
      )
        ? item.periods
            .filter(validPeriod)
            .slice(0, 12)
        : [],
      cancelledPeriods: [],
      timestamp:
        Number(item.timestamp || 0)
    });
  }

  entries.sort(
    (a, b) =>
      b.date.localeCompare(a.date)
  );

  return {
    entries,
    updatedAt:
      Number(value.updatedAt || 0)
  };
}

function renderMember() {
  if (admin) return;

  const status =
    $("memberIncomeStatus");

  if (!status) return;

  if (!publicSummary) {
    status.textContent =
      "Verified membership income summary " +
      "has not been published yet.";

    return;
  }

  const entries =
    publicSummary.entries;

  const updatedAt =
    publicSummary.updatedAt;

  const updatedText =
    Number.isFinite(updatedAt) &&
    updatedAt > 0
      ? " | Updated: " +
        new Date(updatedAt)
          .toLocaleString(
            "en-IN",
            {
              timeZone:
                "Asia/Kolkata"
            }
          )
      : "";

  renderReport(
    "memberIncome",
    entries,
    {
      showMember: false,
      status:
        `${entries.length} published collection(s)` +
        updatedText
    }
  );
}

function render() {
  setupUI();

  if (admin) {
    renderAdmin();
  } else {
    renderMember();
  }
}

function stopListening() {
  for (const unsubscribe of listeners) {
    try {
      unsubscribe();
    } catch (_) {}
  }

  listeners = [];

  members = {};
  requests = {};
  corrections = {};
  publicSummary = null;
  loadError = "";

  loaded = {
    members: false,
    requests: false,
    corrections: false
  };
}

function listenAdmin(
  path,
  key,
  setter,
  id
) {
  const unsubscribe = onValue(
    ref(db, path),
    snapshot => {
      if (id !== generation) return;

      setter(snapshot.val() || {});
      loaded[key] = true;
      loadError = "";

      render();
    },
    error => {
      if (id !== generation) return;

      loadError =
        `${key} read failed: ${error.message}`;

      const status =
        $("automaticIncomeStatus");

      if (status) {
        status.textContent =
          loadError;
      }
    }
  );

  listeners.push(unsubscribe);
}

function listenMember(id) {
  const unsubscribe = onValue(
    ref(db, PUBLIC_PATH),
    snapshot => {
      if (id !== generation) return;

      publicSummary =
        normalizePublicSummary(
          snapshot.val()
        );

      renderMember();
    },
    error => {
      if (id !== generation) return;

      const status =
        $("memberIncomeStatus");

      if (status) {
        status.textContent =
          "Public membership income unavailable: " +
          error.message;
      }
    }
  );

  listeners.push(unsubscribe);
}

onAuthStateChanged(
  auth,
  async account => {
    const id = ++generation;

    stopListening();

    admin = false;

    if (!account) return;

    try {
      const snapshot = await get(
        ref(
          db,
          `admins/${account.uid}`
        )
      );

      if (
        id !== generation ||
        auth.currentUser?.uid !==
          account.uid
      ) {
        return;
      }

      admin =
        snapshot.val() === true;

      setupUI();

      if (admin) {
        listenAdmin(
          "members",
          "members",
          value => {
            members = value;
          },
          id
        );

        listenAdmin(
          "paymentRequests",
          "requests",
          value => {
            requests = value;
          },
          id
        );

        listenAdmin(
          "paymentCorrections",
          "corrections",
          value => {
            corrections = value;
          },
          id
        );
      } else {
        const userSnapshot =
          await get(
            ref(
              db,
              `users/${account.uid}`
            )
          );

        if (
          id !== generation ||
          auth.currentUser?.uid !==
            account.uid
        ) {
          return;
        }

        if (
          userSnapshot.val()?.status ===
          "approved"
        ) {
          listenMember(id);
        }
      }

      render();
    } catch (error) {
      if (id !== generation) return;

      console.error(
        "Membership income:",
        error
      );

      const status = admin
        ? $("automaticIncomeStatus")
        : $("memberIncomeStatus");

      if (status) {
        status.textContent =
          "Unable to load membership income: " +
          error.message;
      }
    }
  }
);

setupUI();

/* END MEMBERSHIP INCOME v85.0 */
