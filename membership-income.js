
/*
 TFC BANDIYOD
 MEMBERSHIP INCOME v88.0

 Supports:
 - Cash payments
 - Approved UPI monthly payments
 - Approved UPI yearly payments
 - Approved UPI automatic multi-month payments
 - Payment corrections
 - Duplicate prevention
 - Public membership income
 - Automatic Firebase publication

 Historical PDF payments excluded.
 Original payment records unchanged.
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

const START_AT = Date.parse(
  "2026-11-08T00:00:00+05:30"
);

const PUBLIC_PATH = "accounts/publicMembershipIncome";
const FEE = 50;

const $ = id => document.getElementById(id);

let admin = false;
let generation = 0;

let members = {};
let requests = {};
let corrections = {};
let publicData = null;

let unsubs = [];
let publishing = false;
let publishPending = false;
let publishedSignature = "";
let publishError = "";
let publishStatus = "";

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

const safe = value =>
  String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));

function validPeriod(period) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(
    String(period)
  );
}

function validTime(value) {
  const n = Number(value);

  return Number.isFinite(n) &&
    n >= START_AT &&
    n <= Date.now() + 300000;
}

function localDate(timestamp) {
  const parts = new Intl.DateTimeFormat(
    "en-GB",
    {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }
  ).formatToParts(new Date(Number(timestamp)));

  const part = type =>
    parts.find(p => p.type === type)?.value || "";

  return [
    part("year"),
    part("month"),
    part("day")
  ].join("-");
}

function cancelled(number, period) {
  return corrections?.[String(number)]?.[period]
    ?.state === "cancelled";
}

function periodsFor(plan, period) {
  if (!validPeriod(period)) return [];

  if (plan === "monthly") {
    return [period];
  }

  if (plan === "yearly") {
    const year = period.slice(0, 4);

    return Array.from(
      { length: 12 },
      (_, i) =>
        year + "-" +
        String(i + 1).padStart(2, "0")
    );
  }

  return [];
}

// VERSION 88.0
// Supports automatic multi-month payment requests.

function incomeRequestPeriods(request) {
  if (
    !request ||
    typeof request !== "object"
  ) {
    return [];
  }

  if (request.plan === "auto") {
    const map = request.months;

    if (
      !map ||
      typeof map !== "object" ||
      Array.isArray(map)
    ) {
      return [];
    }

    const periods = Object.keys(map).sort();

    if (
      !periods.length ||
      periods.length > 12 ||
      periods.length !== Number(request.monthCount) ||
      periods.some(
        p =>
          !validPeriod(p) ||
          map[p] !== true
      ) ||
      request.period !== periods[0] ||
      Number(request.amount) !==
        periods.length * FEE
    ) {
      return [];
    }

    return periods;
  }

  return periodsFor(
    request.plan,
    request.period
  );
}

function buildSection(parent, id, prefix, heading) {
  if (!parent || $(id)) return;

  const section = document.createElement("section");

  section.id = id;
  section.className = "panel";

  section.innerHTML = `
    <h3>${heading}</h3>

    <p class="muted">
      Verified membership collections from
      08-11-2026.
      Historical PDF payments excluded.
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

    <p id="${prefix}Status" role="status">
      Loading...
    </p>

    <div id="${prefix}History" class="scroll"></div>
  `;

  parent.append(section);

  $(`${prefix}Year`).addEventListener(
    "change",
    render
  );
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

// CASH COLLECTIONS

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
        Number(payment.amount) !== FEE ||
        !validTime(payment.verifiedAt) ||
        cancelled(number, period)
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

      group.amount += FEE;
      group.periods.push(period);
    }
  }

  return [...groups.values()];
}

// UPI COLLECTIONS — VERSION 88.0

function collectUPI() {
  const result = [];

  for (const [id, request] of Object.entries(requests)) {
    if (
      request?.status !== "approved" ||
      !validTime(request.reviewedAt)
    ) {
      continue;
    }

    const number = String(
      request.memberNumber || ""
    );

    const member = members[number];

    if (!member) continue;

    const periods = incomeRequestPeriods(request);

    if (
      !periods.length ||
      Number(request.amount) !==
        periods.length * FEE
    ) {
      continue;
    }

    // Every month must be verified and linked
    // to the same approved payment request.

    const verified = periods.every(period => {
      const payment = member.payments?.[period];

      return (
        payment?.status === "paid" &&
        payment.requestId === id &&
        validTime(payment.verifiedAt) &&
        Number(payment.amount) === FEE &&
        (
          payment.method === "upi" ||
          !payment.method
        )
      );
    });

    if (!verified) continue;

    const cancelledList = periods.filter(
      period => cancelled(number, period)
    );

    const activePeriods = periods.filter(
      period => !cancelled(number, period)
    );

    if (!activePeriods.length) continue;

    result.push({
      id,
      memberNumber: number,
      memberName: member.name || "Member",
      method: "UPI",
      date: localDate(request.reviewedAt),
      amount: activePeriods.length * FEE,
      periods: activePeriods,
      timestamp: Number(request.reviewedAt),
      cancelledPeriods: cancelledList
    });
  }

  return result;
}

function collections() {
  return [
    ...collectCash(),
    ...collectUPI()
  ].sort(
    (a, b) => b.timestamp - a.timestamp
  );
}

function fillYears(select, entries) {
  const old = select.value || "all";

  const years = [
    ...new Set(
      entries.map(e => String(e.date).slice(0, 4))
    )
  ].sort().reverse();

  select.replaceChildren(
    new Option("All Years", "all"),
    ...years.map(y => new Option(y, y))
  );

  select.value = years.includes(old)
    ? old
    : "all";

  return select.value;
}

function renderReport(prefix, entries, isPublic = false) {
  const select = $(`${prefix}Year`);
  const history = $(`${prefix}History`);
  const status = $(`${prefix}Status`);

  if (!select || !history || !status) return;

  const year = fillYears(select, entries);

  const filtered = entries.filter(e =>
    year === "all" ||
    String(e.date).startsWith(year)
  );

  const cash = filtered
    .filter(e => e.method === "Cash")
    .reduce(
      (sum, e) => sum + Number(e.amount || 0),
      0
    );

  const upi = filtered
    .filter(e => e.method === "UPI")
    .reduce(
      (sum, e) => sum + Number(e.amount || 0),
      0
    );

  $(`${prefix}Cash`).textContent = money(cash);
  $(`${prefix}Upi`).textContent = money(upi);
  $(`${prefix}Total`).textContent = money(cash + upi);

  const countText =
    `${filtered.length} verified collection(s)`;

  if (isPublic) {
    status.textContent =
      countText +
      (
        publicData?.updatedAt
          ? " | Last published: " +
            new Date(publicData.updatedAt)
              .toLocaleString("en-IN", {
                timeZone: "Asia/Kolkata"
              })
          : ""
      );
  } else {
    status.textContent =
      countText + " | " +
      (
        publishError ||
        publishStatus ||
        "Preparing publication..."
      );
  }

  if (!filtered.length) {
    history.textContent =
      "No verified collections.";

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
              <td>
                #${safe(e.memberNumber)}
                ${safe(e.memberName)}
              </td>
            `}

            <td>${safe(e.method)}</td>

            <td>${safe(
              (e.periods || []).join(", ")
            )}</td>

            <td>${money(e.amount)}</td>

            <td>${safe(
              e.cancelledPeriods?.length
                ? "Review: " +
                  e.cancelledPeriods.join(", ")
                : "—"
            )}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

// PUBLIC DATA

function publicEntries(entries) {
  const result = {};

  for (const entry of entries) {
    const source = String(entry.id);

    let hash = 2166136261;

    for (let i = 0; i < source.length; i++) {
      hash ^= source.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }

    const key =
      "collection_" + (hash >>> 0).toString(16);

    result[key] = {
      date: entry.date,
      method: entry.method,
      amount: entry.amount,
      periods: entry.periods,
      timestamp: entry.timestamp
    };
  }

  return result;
}

function updateAdminStatus(text, error = false) {
  publishError = error ? text : "";
  publishStatus = error ? "" : text;

  const status = $("automaticIncomeStatus");

  if (status) {
    const count = collections().length;

    status.textContent =
      `${count} verified collection(s) | ${text}`;

    status.className = error ? "error" : "ok";
  }
}

// AUTOMATIC FIREBASE PUBLICATION

async function publishSummary(entries, id) {
  if (!admin || id !== generation) return;

  if (!Object.values(loaded).every(Boolean)) return;

  const publicRows = publicEntries(entries);
  const signature = JSON.stringify(publicRows);

  if (publishing) {
    publishPending = true;
    return;
  }

  if (signature === publishedSignature) return;

  publishing = true;
  publishPending = false;

  try {
    const uid = auth.currentUser?.uid;

    if (!uid || id !== generation) return;

    updateAdminStatus(
      "Publishing to Firebase..."
    );

    if (!Object.keys(publicRows).length) {
      updateAdminStatus(
        "No verified collections to publish."
      );
      return;
    }

    await set(ref(db, PUBLIC_PATH), {
      entries: publicRows,
      updatedAt: Date.now(),
      publishedBy: uid
    });

    if (id === generation) {
      publishedSignature = signature;

      updateAdminStatus(
        "Published successfully to Firebase."
      );
    }

  } catch (error) {
    if (id === generation) {
      updateAdminStatus(
        "Publish failed: " + error.message,
        true
      );
    }

    console.error(
      "Membership income publish failed:",
      error
    );

  } finally {
    publishing = false;

    if (
      id === generation &&
      publishPending
    ) {
      publishPending = false;
      render();
    }
  }
}

// RENDER

function render() {
  setupUI();

  if (admin) {
    if (!Object.values(loaded).every(Boolean)) {
      updateAdminStatus(
        "Loading membership payment records..."
      );
      return;
    }

    const entries = collections();

    renderReport(
      "automaticIncome",
      entries
    );

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

    const entries = Object.values(
      publicData.entries || {}
    );

    renderReport(
      "memberIncome",
      entries,
      true
    );
  }
}

// LISTENER CLEANUP

function stopListening() {
  unsubs.forEach(fn => {
    try {
      fn();
    } catch (_) {}
  });

  unsubs = [];

  members = {};
  requests = {};
  corrections = {};
  publicData = null;

  publishing = false;
  publishPending = false;
  publishedSignature = "";
  publishError = "";
  publishStatus = "";

  loaded = {
    members: false,
    requests: false,
    corrections: false
  };
}

// AUTHENTICATION AND LIVE DATA

onAuthStateChanged(auth, async account => {
  const id = ++generation;

  stopListening();
  admin = false;

  if (!account) return;

  try {
    const adminSnap = await get(
      ref(db, `admins/${account.uid}`)
    );

    if (id !== generation) return;

    admin = adminSnap.val() === true;

    setupUI();

    if (admin) {
      const listen = (path, key, setter) => {
        unsubs.push(
          onValue(
            ref(db, path),
            snapshot => {
              if (id !== generation) return;

              setter(snapshot.val() || {});
              loaded[key] = true;

              render();
            },
            error => {
              if (id !== generation) return;

              updateAdminStatus(
                `${path} read failed: ${error.message}`,
                true
              );
            }
          )
        );
      };

      listen(
        "members",
        "members",
        value => {
          members = value;
        }
      );

      listen(
        "paymentRequests",
        "requests",
        value => {
          requests = value;
        }
      );

      listen(
        "paymentCorrections",
        "corrections",
        value => {
          corrections = value;
        }
      );

    } else {
      const userSnap = await get(
        ref(db, `users/${account.uid}`)
      );

      if (id !== generation) return;

      if (
        userSnap.val()?.status !== "approved"
      ) return;

      unsubs.push(
        onValue(
          ref(db, PUBLIC_PATH),
          snapshot => {
            if (id !== generation) return;

            publicData = snapshot.val();
            render();
          },
          error => {
            if (id !== generation) return;

            const status = $("memberIncomeStatus");

            if (status) {
              status.textContent =
                "Membership income read failed: " +
                error.message;

              status.className = "error";
            }
          }
        )
      );
    }

  } catch (error) {
    console.error(
      "Membership income initialization:",
      error
    );

    if (id === generation && admin) {
      updateAdminStatus(
        "Initialization failed: " + error.message,
        true
      );
    }
  }
});

setupUI();

console.info(
  "TFC Bandiyod Membership Income v88.0 loaded."
);

/* END MEMBERSHIP INCOME v88.0 */
