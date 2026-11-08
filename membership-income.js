
/*
 TFC BANDIYOD
 MEMBERSHIP INCOME v86.0

 Compatible:
 app.js v82.0
 accounts.js v84.0

 Admin:
 Verified Cash / UPI collections.
 Publishes privacy-safe member summary.

 Members:
 Read-only published collections.

 Historical PDF records excluded.
 Collection start: 08-11-2026.

 No existing payment records are modified.
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
  set
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js";

import { firebaseConfig } from "./firebase-config.js";

const app = getApps()[0] || initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

const START_AT = Date.parse("2026-11-08T00:00:00+05:30");
const PUBLIC_PATH = "accounts/publicMembershipIncome";

const $ = id => document.getElementById(id);

let admin = false;
let generation = 0;
let members = {};
let requests = {};
let corrections = {};
let publicData = null;
let unsubs = [];
let publishing = false;
let publishedSignature = "";
let loaded = {
  members: false,
  requests: false,
  corrections: false
};

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

function validPeriod(p) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(p));
}

function validTime(t) {
  const n = Number(t);
  return Number.isFinite(n) &&
    n >= START_AT &&
    n <= Date.now() + 300000;
}

function localDate(t) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(Number(t)));
}

function periodsFor(plan, period) {
  if (!validPeriod(period)) return [];

  if (plan === "monthly") return [period];

  if (plan === "yearly") {
    const year = period.slice(0, 4);
    return Array.from({ length: 12 }, (_, i) =>
      year + "-" + String(i + 1).padStart(2, "0")
    );
  }

  return [];
}

function cancelled(number, period) {
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
      Verified membership collections from 08-11-2026.
      Historical PDF payments excluded.
    </p>

    <label for="${prefix}Year">Collection Year</label>
    <select id="${prefix}Year">
      <option value="all">All Years</option>
    </select>

    <div class="grid">
      <div class="stat">
        <span>Total Membership Income</span>
        <strong id="${prefix}Total">—</strong>
      </div>
      <div class="stat">
        <span>Cash</span>
        <strong id="${prefix}Cash">—</strong>
      </div>
      <div class="stat">
        <span>UPI</span>
        <strong id="${prefix}Upi">—</strong>
      </div>
    </div>

    <p id="${prefix}Status" role="status">Loading...</p>
    <div id="${prefix}History" class="scroll"></div>

    <p class="muted">
      Payment corrections and refunds require financial
      reconciliation. This report is not a bank statement.
    </p>
  `;

  parent.append(section);
  $(`${prefix}Year`).addEventListener("change", render);
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
    for (const [period, payment] of Object.entries(member?.payments || {})) {
      if (
        !validPeriod(period) ||
        payment?.status !== "paid" ||
        payment.method !== "cash" ||
        Number(payment.amount) !== 50 ||
        !validTime(payment.verifiedAt) ||
        cancelled(number, period)
      ) continue;

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
          memberName: member.name || "Member",
          method: "Cash",
          date: localDate(payment.verifiedAt),
          amount: 0,
          periods: [],
          timestamp: Number(payment.verifiedAt),
          cancelledPeriods: []
        });
      }

      const group = groups.get(key);
      group.amount += 50;
      group.periods.push(period);
    }
  }

  return [...groups.values()];
}

function collectUPI() {
  const result = [];

  for (const [id, request] of Object.entries(requests)) {
    if (
      request?.status !== "approved" ||
      !validTime(request.reviewedAt)
    ) continue;

    const number = String(request.memberNumber || "");
    const member = members[number];
    if (!member) continue;

    const periods = periodsFor(request.plan, request.period);
    const amount = request.plan === "yearly" ? 600 : 50;

    if (!periods.length || Number(request.amount) !== amount) {
      continue;
    }

    const verified = periods.every(period => {
      const payment = member.payments?.[period];

      return payment?.status === "paid" &&
        payment.requestId === id &&
        validTime(payment.verifiedAt);
    });

    if (!verified) continue;

    result.push({
      id,
      memberNumber: number,
      memberName: member.name || "Member",
      method: "UPI",
      date: localDate(request.reviewedAt),
      amount,
      periods,
      timestamp: Number(request.reviewedAt),
      cancelledPeriods: periods.filter(p => cancelled(number, p))
    });
  }

  return result;
}

function collections() {
  return [...collectCash(), ...collectUPI()]
    .sort((a, b) => b.timestamp - a.timestamp);
}

function fillYears(select, entries) {
  const old = select.value || "all";
  const years = [...new Set(entries.map(e => e.date.slice(0, 4)))]
    .sort().reverse();

  select.replaceChildren(
    new Option("All Years", "all"),
    ...years.map(y => new Option(y, y))
  );

  select.value = years.includes(old) ? old : "all";
  return select.value;
}

function renderReport(prefix, entries, isPublic = false) {
  const select = $(`${prefix}Year`);
  const history = $(`${prefix}History`);
  const status = $(`${prefix}Status`);

  if (!select || !history || !status) return;

  const year = fillYears(select, entries);
  const filtered = entries.filter(e =>
    year === "all" || e.date.startsWith(year)
  );

  const cash = filtered
    .filter(e => e.method === "Cash")
    .reduce((sum, e) => sum + Number(e.amount), 0);

  const upi = filtered
    .filter(e => e.method === "UPI")
    .reduce((sum, e) => sum + Number(e.amount), 0);

  $(`${prefix}Cash`).textContent = money(cash);
  $(`${prefix}Upi`).textContent = money(upi);
  $(`${prefix}Total`).textContent = money(cash + upi);

  status.textContent =
    `${filtered.length} verified collection(s)` +
    (isPublic && publicData?.updatedAt
      ? " | Last published: " +
        new Date(publicData.updatedAt).toLocaleString("en-IN")
      : "");

  if (!filtered.length) {
    history.textContent = "No verified collections.";
    return;
  }

  history.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Date</th>
          ${isPublic ? "" : "<th>Member</th>"}
          <th>Method</th>
          <th>Period</th>
          <th>Amount</th>
          <th>Correction</th>
        </tr>
      </thead>
      <tbody>
        ${filtered.map(e => `
          <tr>
            <td>${safe(e.date)}</td>
            ${isPublic ? "" : `
              <td>#${safe(e.memberNumber)} ${safe(e.memberName)}</td>
            `}
            <td>${safe(e.method)}</td>
            <td>${safe((e.periods || []).join(", "))}</td>
            <td>${money(e.amount)}</td>
            <td>${safe(
              e.cancelledPeriods?.length
                ? "Review: " + e.cancelledPeriods.join(", ")
                : "—"
            )}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function publicEntries(entries) {
  const result = {};

  entries.forEach((e, i) => {
    result["collection_" + String(i + 1).padStart(6, "0")] = {
      date: e.date,
      method: e.method,
      amount: e.amount,
      periods: e.periods,
      timestamp: e.timestamp
    };
  });

  return result;
}

async function publishSummary(entries, id) {
  if (!admin || publishing || id !== generation) return;
  if (!Object.values(loaded).every(Boolean)) return;

  const publicRows = publicEntries(entries);
  const signature = JSON.stringify(publicRows);

  if (signature === publishedSignature) return;

  publishing = true;

  try {
    const uid = auth.currentUser?.uid;
    if (!uid || id !== generation) return;

    await set(ref(db, PUBLIC_PATH), {
      entries: publicRows,
      updatedAt: Date.now(),
      publishedBy: uid
    });

    if (id === generation) {
      publishedSignature = signature;
    }
  } catch (error) {
    const status = $("automaticIncomeStatus");
    if (status) {
      status.textContent =
        "Member summary publish failed: " + error.message;
    }
  } finally {
    publishing = false;
  }
}

function render() {
  setupUI();

  if (admin) {
    if (!Object.values(loaded).every(Boolean)) return;

    const entries = collections();
    renderReport("automaticIncome", entries);

    publishSummary(entries, generation);
  } else {
    if (!publicData) {
      const status = $("memberIncomeStatus");
      if (status) {
        status.textContent =
          "Membership income summary not published yet.";
      }
      return;
    }

    const entries = Object.values(publicData.entries || {});
    renderReport("memberIncome", entries, true);
  }
}

function stopListening() {
  unsubs.forEach(fn => {
    try { fn(); } catch (_) {}
  });

  unsubs = [];
  members = {};
  requests = {};
  corrections = {};
  publicData = null;
  publishing = false;
  publishedSignature = "";

  loaded = {
    members: false,
    requests: false,
    corrections: false
  };
}

onAuthStateChanged(auth, async account => {
  const id = ++generation;
  stopListening();
  admin = false;

  if (!account) return;

  try {
    const adminSnap = await get(ref(db, `admins/${account.uid}`));

    if (id !== generation) return;

    admin = adminSnap.val() === true;
    setupUI();

    if (admin) {
      const listen = (path, key, setter) => {
        unsubs.push(onValue(
          ref(db, path),
          snapshot => {
            if (id !== generation) return;

            setter(snapshot.val() || {});
            loaded[key] = true;
            render();
          },
          error => {
            const status = $("automaticIncomeStatus");
            if (status && id === generation) {
              status.textContent = error.message;
            }
          }
        ));
      };

      listen("members", "members", v => { members = v; });
      listen("paymentRequests", "requests", v => { requests = v; });
      listen("paymentCorrections", "corrections", v => {
        corrections = v;
      });

    } else {
      const userSnap = await get(ref(db, `users/${account.uid}`));
      if (id !== generation) return;

      if (userSnap.val()?.status !== "approved") return;

      unsubs.push(onValue(
        ref(db, PUBLIC_PATH),
        snapshot => {
          if (id !== generation) return;
          publicData = snapshot.val();
          render();
        },
        error => {
          const status = $("memberIncomeStatus");
          if (status && id === generation) {
            status.textContent = error.message;
          }
        }
      ));
    }

  } catch (error) {
    console.error("Membership income:", error);
  }
});

setupUI();

/* END v86.0 */
