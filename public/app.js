const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const esc = (x) =>
  String(x ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let state,
  selected,
  missionFilter,
  editVersion,
  busy = false,
  toastTimer;
async function api(url, data) {
  const r = await fetch(
    url,
    data === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
  );
  const value = await r.json();
  if (!r.ok) throw new Error(value.error?.message || "Request failed");
  return value;
}
function toast(text) {
  $("#toast").textContent = text;
  $("#toast").classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.add("hidden"), 5500);
}
async function action(fn) {
  if (busy) return;
  busy = true;
  try {
    await fn();
    await refresh();
  } catch (e) {
    toast(e.message);
  } finally {
    busy = false;
  }
}
const names = (id) =>
  state?.sources.shelters.find((s) => s.id === id)?.name ||
  state?.sources.inventory.find((s) => s.id === id)?.name ||
  id;
const active = (o) => ["reserved", "departed", "completed"].includes(o.status);
const status = (s) => `<span class="status ${esc(s)}">${esc(s)}</span>`;
function map() {
  const coords = {
    "depot-west": [140, 220],
    "depot-east": [750, 230],
    "junction-west": [300, 240],
    "junction-east": [605, 260],
    north: [430, 110],
    east: [770, 360],
    south: [460, 380],
    west: [170, 360],
  };
  const order = state.orders.find((o) => o.id === selected);
  const used = new Set(
    (order && active(order)
      ? [order]
      : state.orders.filter((o) => o.status === "reserved")
    ).flatMap((o) => o.routeIds),
  );
  let svg = `<defs><pattern id="grid" width="35" height="35" patternUnits="userSpaceOnUse"><path d="M35 0H0V35" fill="none" stroke="#dfe5d6" stroke-width=".5"/></pattern><pattern id="trees" width="13" height="13" patternUnits="userSpaceOnUse"><circle cx="4" cy="4" r="1" fill="#bbc9ac"/></pattern></defs><rect width="900" height="470" fill="#eef1e7"/><rect width="900" height="470" fill="url(#grid)"/><path d="M-20 35 Q130 10 190 75 T370 20 L350 170 Q190 130 100 200 L0 160Z" fill="#e0e7d6"/><path d="M-20 35 Q130 10 190 75 T370 20 L350 170 Q190 130 100 200 L0 160Z" fill="url(#trees)"/><path d="M620 0 Q660 95 800 92 T950 190 L900 0Z" fill="#e2e8d9"/><path d="M0 410 Q130 380 310 440 L360 470 H0Z" fill="#e2e8d9"/><path d="M455 -30 C400 40 510 65 500 150 S465 270 520 320 S560 400 530 500" fill="none" stroke="#fff" stroke-width="32"/><path d="M455 -30 C400 40 510 65 500 150 S465 270 520 320 S560 400 530 500" fill="none" stroke="#c9dfe0" stroke-width="24"/><text x="527" y="205" fill="#83a8ab" font-size="8" letter-spacing="3" transform="rotate(80 527 205)">KARYA RIVER</text><g stroke="#e0e4d9" stroke-width="2" fill="none"><path d="M40 140L230 190 250 60M80 300L350 330 390 200M570 70L680 150 850 120M650 420L680 320 860 280"/><path d="M60 150L85 260 250 290M320 430L340 380M560 140L650 190 840 210"/></g>`;
  for (const road of state.sources.roads) {
    const a = coords[road.from],
      b = coords[road.to];
    if (!a || !b) continue;
    const d = road.id === "bypass" ? `M${a} Q260 35 ${b}` : `M${a} L${b}`;
    const color = !road.open
      ? "#d47e5c"
      : used.has(road.id)
        ? "#70974e"
        : "#b1bea4";
    svg += `<path d="${d}" fill="none" stroke="#fff" stroke-width="9"/><path d="${d}" fill="none" stroke="${color}" stroke-width="${used.has(road.id) ? 4 : 3}" ${road.open ? "" : 'stroke-dasharray="7 6"'}/>`;
    if (road.id === "bridge") {
      const x = (a[0] + b[0]) / 2,
        y = (a[1] + b[1]) / 2;
      svg += `<rect x="${x - 50}" y="${y - 15}" width="105" height="19" rx="3" fill="${road.open ? "#fff" : "#fae7dc"}" stroke="${road.open ? "#d5dfc9" : "#e5af93"}"/><text x="${x + 2}" y="${y - 2}" font-size="7" font-family="monospace" text-anchor="middle" fill="${road.open ? "#7f9270" : "#ae6a49"}">${road.open ? "CENDANA BRIDGE" : "BRIDGE CLOSED"}</text>`;
    }
  }
  for (const [id, [x, y]] of Object.entries(coords)) {
    if (id.startsWith("junction")) {
      svg += `<circle cx="${x}" cy="${y}" r="4" fill="#fff" stroke="#9bab8b" stroke-width="2"/>`;
      continue;
    }
    const depot = id.startsWith("depot");
    const label = names(id);
    const pledged = state.orders
      .filter((o) => o.shelterId === id && active(o))
      .reduce((n, o) => n + o.kits, 0);
    svg += `<g><circle cx="${x}" cy="${y}" r="${depot ? 22 : 19}" fill="${depot ? "#243f2d" : "#fff"}" stroke="${depot ? "#243f2d" : "#a1b48a"}" stroke-width="2"/>${depot ? `<path d="M${x - 9} ${y + 7}V${y - 5}L${x} ${y - 11}L${x + 9} ${y - 5}V${y + 7}Z" fill="none" stroke="#d9efb9" stroke-width="1.4"/><path d="M${x - 3} ${y + 7}V${y}H${x + 3}V${y + 7}" fill="none" stroke="#d9efb9"/>` : `<path d="M${x - 7} ${y + 7}V${y - 5}H${x + 7}V${y + 7}M${x - 10} ${y + 7}H${x + 10}M${x} ${y - 10}V${y - 1}M${x - 4} ${y - 6}H${x + 4}" fill="none" stroke="#7a9161" stroke-width="1.4"/>`}<rect x="${x - 67}" y="${y + 26}" width="134" height="31" rx="3" fill="#f9faf5" fill-opacity=".94"/><text x="${x}" y="${y + 39}" text-anchor="middle" font-size="10" fill="#53664a">${esc(label)}</text><text x="${x}" y="${y + 50}" text-anchor="middle" font-size="7" font-family="monospace" fill="#95a082">${depot ? state.sources.inventory.find((d) => d.id === id).stock + " KITS IN STOCK" : pledged + " KITS COMMITTED"}</text></g>`;
  }
  $("#district-map").innerHTML = svg;
}
function render() {
  const expanded = new Set(
    $$("#trace details[open]").map((x) => x.dataset.trace),
  );
  const scrollTop = $("#trace").scrollTop;
  $("#mode").textContent =
    state.mode === "live"
      ? "LIVE · ZETARIS + NIGHTSHIFT"
      : "SAMPLE · DETERMINISTIC POLICY";
  $("#kits").textContent = state.orders
    .filter(active)
    .reduce((n, o) => n + o.kits, 0);
  $("#protected").textContent = state.orders.filter(
    (o) => o.status === "reserved",
  ).length;
  $("#attention").textContent =
    state.orders.filter((o) => o.status === "held").length +
    state.missions.filter((m) => ["blocked", "partial"].includes(m.status))
      .length;
  $("#roads-open").textContent =
    state.sources.roads.filter((r) => r.open).length +
    " / " +
    state.sources.roads.length;
  const running = state.running.length;
  $("#run-status").classList.toggle("hidden", !running);
  $("#run-status").textContent = running
    ? `${running} mission${running > 1 ? "s" : ""} under investigation. Agents are checking evidence and allocation options. Existing valid orders stay reserved.`
    : "";
  const roadSelect = $("#incident-road"),
    previous = roadSelect.value;
  roadSelect.innerHTML = state.sources.roads
    .map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`)
    .join("");
  roadSelect.value = previous || "bridge";
  roadSummary();
  const orders = state.orders.filter(
    (o) => $("#order-filter").value === "all" || o.status !== "cancelled",
  );
  $("#order-count").textContent = orders.length;
  if (!orders.some((o) => o.id === selected)) selected = orders[0]?.id;
  $("#orders").innerHTML = orders.length
    ? orders
        .map(
          (o) =>
            `<button class="order ${o.id === selected ? "selected" : ""}" data-order="${esc(o.id)}"><div class="order-head"><strong>${esc(names(o.shelterId))}</strong>${status(o.status)}</div><div class="order-route">${esc(names(o.depotId))} → ${esc(o.shelterId.toUpperCase())} <span class="sep">/</span> ${esc(o.vehicleId)}</div><div class="order-bottom"><span><b>${o.kits}</b> relief kits <span class="sep">·</span> ${o.minutes} min travel</span><span>${o.evidence.length} evidence links ↗</span></div></button>`,
        )
        .join("")
    : `<div class="empty"><div class="empty-icon">◇</div><b>No reservation to select yet.</b>${state.missions.some((m) => m.status === "blocked") ? "A mission is blocked. See Mission activity below for the failure. Create a new mission if its arrival deadline has passed." : "Create a mission and wait for reservations. Then select a shelter's reservation card here to inspect its road dependencies."}</div>`;
  evidence();
  map();
  $("#missions").innerHTML =
    state.missions
      .map(
        (m) =>
          `<div class="mission-chip"><button class="textbutton" data-mission="${esc(m.id)}">${m.demands.reduce((n, d) => n + d.kits, 0)} kits / ${m.demands.length} shelter${m.demands.length > 1 ? "s" : ""} ${status(m.status)}</button><small>${esc(m.reason)}</small>${["blocked", "partial"].includes(m.status) ? `<button class="textbutton" data-retry="${esc(m.id)}">Retry investigation ↻</button>` : ""}${!["cancelled", "planning", "queued"].includes(m.status) ? ` <button class="textbutton" data-cancel="${esc(m.id)}">Cancel unreleased</button>` : ""}</div>`,
      )
      .join("") ||
    '<span class="subtle">No missions yet. Start one above.</span>';
  const traces = state.traces
    .filter(
      (t) =>
        !missionFilter ||
        t.traceId === missionFilter ||
        t.traceId === "source-events",
    )
    .slice(-45)
    .reverse();
  $("#trace").innerHTML = traces
    .map(
      (t) =>
        `<div class="trace-item"><time>${new Date(t.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time><strong>${esc(t.agent)}</strong><details data-trace="${esc(t.id)}" ${expanded.has(t.id) ? "open" : ""}><summary>${esc(t.action.replaceAll("_", " "))}${t.target ? " → " + esc(t.target) : ""}${t.detail?.table ? " / " + esc(t.detail.table) : ""}${t.action === "reject" ? " · proposal returned for revision" : ""}</summary><pre>${esc(JSON.stringify(t.detail, null, 2))}</pre></details></div>`,
    )
    .join("");
  $("#trace").scrollTop = scrollTop;
  $("#updated").textContent =
    "Synced " +
    new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
}
function evidence() {
  const o = state.orders.find((x) => x.id === selected);
  if (!o) {
    $("#evidence").innerHTML =
      '<div class="empty"><div class="empty-icon">⌘</div><b>Nothing is taken on trust.</b>Every order links to versioned source records and the checks that permitted it.</div>';
    return;
  }
  const changed = o.evidence.filter(
    (e) =>
      state.sources[e.table].find((r) => r.id === e.id)?.version !== e.version,
  );
  $("#evidence").innerHTML =
    `<h3 class="evidence-title">${o.kits} kits → ${esc(names(o.shelterId))}</h3><p>${esc(o.reason)}</p>${changed.length ? `<p class="orange-text">${changed.length} supporting record(s) changed.${o.status === "departed" ? " Operator intervention required; this departed vehicle was not rolled back." : ""}</p>` : ""}<div class="checklist">${o.checks.map((c) => `<span>✓ ${esc(c)}</span>`).join("")}</div>${o.evidence.map((e) => `<div class="evidence-row"><div><b>${esc(e.table)} / ${esc(e.id)}</b><small>${esc(e.source)}<br>${esc(e.hash)}</small></div><span>v${e.version}</span></div>`).join("")}<p>Reservation ${esc(o.id.slice(-12))}<br>Arrive before ${new Date(o.deadlineAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}${o.supersedes ? "<br>Replaces " + esc(o.supersedes.slice(-12)) : ""}</p><div class="evidence-actions">${o.status === "reserved" ? `<button class="button primary" data-release="${esc(o.id)}">Recheck & release →</button>` : ""}${o.status === "departed" ? `<button class="button primary" data-complete="${esc(o.id)}">Record simulated delivery ✓</button>` : ""}</div>`;
}
function roadSummary() {
  if (!state) return;
  const r = state.sources.roads.find((r) => r.id === $("#incident-road").value);
  if (!r) return;
  $("#road-summary").textContent =
    `${r.open ? "OPEN" : "CLOSED"} · ${r.minutes} MIN · SOURCE VERSION ${r.version}`;
  $("#toggle-road").textContent =
    (r.open ? "Close road" : "Reopen road") + " ↗";
}
async function refresh() {
  try {
    state = await api("/api/state");
    $("#connection-error").classList.add("hidden");
    render();
  } catch (e) {
    $("#connection-error").textContent =
      "Cannot reach the application. Showing the last received state. " +
      e.message;
    $("#connection-error").classList.remove("hidden");
  }
}
$("#new-mission").onclick = () => {
  if (!state) return;
  $("#demand-fields").innerHTML = state.sources.shelters
    .map(
      (s) =>
        `<div><label for="demand-${s.id}">${esc(s.name)}</label><input id="demand-${s.id}" name="${s.id}" type="number" min="0" max="10000" step="1" value="${s.demand}" required></div>`,
    )
    .join("");
  $("#mission-dialog").showModal();
};
$$(".close-dialog").forEach(
  (b) => (b.onclick = () => b.closest("dialog").close()),
);
$("#mission-form").onsubmit = (e) => {
  e.preventDefault();
  action(async () => {
    const demands = $$("#demand-fields input")
      .filter((x) => Number(x.value) > 0)
      .map((x) => ({ shelterId: x.name, kits: Number(x.value) }));
    const m = await api("/api/missions", {
      demands,
      deadlineMinutes: Number($("#deadline").value),
      idempotencyKey: crypto.randomUUID(),
    });
    missionFilter = m.id;
    $("#mission-dialog").close();
    toast("Mission accepted. The evidence investigation has started.");
  });
};
$("#incident-road").onchange = roadSummary;
$("#order-filter").onchange = () => render();
$("#toggle-road").onclick = () =>
  action(async () => {
    const r = state.sources.roads.find(
      (r) => r.id === $("#incident-road").value,
    );
    await api("/api/events", {
      eventId: crypto.randomUUID(),
      table: "roads",
      id: r.id,
      expectedVersion: r.version,
      patch: { open: !r.open },
    });
    toast(
      r.open
        ? "Road closed. Affected unreleased orders are held for repair."
        : "Road reopened. New evidence is available to the agents.",
    );
  });
$("#orders").onclick = (e) => {
  const target = e.target.closest("[data-order]");
  if (target) {
    selected = target.dataset.order;
    render();
  }
};
$("#evidence").onclick = (e) => {
  for (const key of ["release", "complete"]) {
    const b = e.target.closest(`[data-${key}]`);
    if (b)
      action(async () => {
        await api(`/api/orders/${b.dataset[key]}/${key}`, {});
        toast(
          key === "release"
            ? "Rechecked and released into the simulator."
            : "Synthetic delivery receipt recorded.",
        );
      });
  }
};
$("#missions").onclick = (e) => {
  const m = e.target.closest("[data-mission]");
  if (m) {
    missionFilter =
      missionFilter === m.dataset.mission ? undefined : m.dataset.mission;
    render();
  }
  for (const key of ["retry", "cancel"]) {
    const b = e.target.closest(`[data-${key}]`);
    if (b)
      action(async () => {
        await api(`/api/missions/${b.dataset[key]}/${key}`, {});
        toast(
          key === "retry"
            ? "Investigation restarted."
            : "Unreleased reservations cancelled.",
        );
      });
  }
};
function sourceRecords() {
  const table = $("#source-table").value;
  $("#source-record").innerHTML = state.sources[table]
    .map(
      (r) =>
        `<option value="${esc(r.id)}">${esc(r.name)} / ${esc(r.id)}</option>`,
    )
    .join("");
  sourceFields();
}
function sourceFields() {
  const table = $("#source-table").value;
  const r = state.sources[table].find(
    (x) => x.id === $("#source-record").value,
  );
  editVersion = r.version;
  const fields = {
    inventory: ["stock"],
    shelters: ["demand"],
    fleet: ["available", "capacity"],
    roads: ["open", "minutes"],
    maintenance: ["hold"],
  }[table];
  $("#source-fields").innerHTML =
    fields
      .map(
        (k) =>
          `<label for="field-${k}">${k.toUpperCase()}</label>${typeof r[k] === "boolean" ? `<select id="field-${k}" data-field="${k}" data-boolean="true"><option value="true" ${r[k] ? "selected" : ""}>True</option><option value="false" ${r[k] ? "" : "selected"}>False</option></select>` : `<input id="field-${k}" data-field="${k}" type="number" min="${["stock", "demand"].includes(k) ? 0 : 1}" max="10000" step="1" value="${r[k]}" required>`}`,
      )
      .join("") +
    `<p class="subtle">Editing version ${r.version}. Conflicting edits are rejected.</p>`;
}
$("#edit-source").onclick = () => {
  sourceRecords();
  $("#source-dialog").showModal();
};
$("#source-table").onchange = sourceRecords;
$("#source-record").onchange = sourceFields;
$("#source-form").onsubmit = (e) => {
  e.preventDefault();
  action(async () => {
    const patch = Object.fromEntries(
      $$("#source-fields [data-field]").map((el) => [
        el.dataset.field,
        el.dataset.boolean ? el.value === "true" : Number(el.value),
      ]),
    );
    await api("/api/events", {
      eventId: crypto.randomUUID(),
      table: $("#source-table").value,
      id: $("#source-record").value,
      expectedVersion: editVersion,
      patch,
    });
    $("#source-dialog").close();
    toast("Source updated. Commitments are being rechecked.");
  });
};
$("#export").onclick = () => {
  if (!state) return;
  const blob = new Blob(
    [
      JSON.stringify(
        { exportedAt: new Date().toISOString(), ...state },
        null,
        2,
      ),
    ],
    { type: "application/json" },
  );
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "aftershock-evidence.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
setInterval(() => {
  $("#clock").textContent =
    new Date().toLocaleDateString([], { day: "2-digit", month: "short" }) +
    " / " +
    new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}, 1000);
refresh();
setInterval(refresh, 2500);
