import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.6";

// anon key is safe to expose; RLS protects the data (only authenticated users)
const SUPABASE_URL = "https://mphfclfaotvpdywconld.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1waGZjbGZhb3R2cGR5d2NvbmxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1MDY1ODgsImV4cCI6MjEwNTA4MjU4OH0.3Fdn3yvHYjADvEbbPWzHXIrIL23acAbW_F5XYfCxm7Y";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { persistSession: true, autoRefreshToken: true },
});

// ===== Elements =====
const $ = (id) => document.getElementById(id);
const loginView = $("login");
const appView = $("app");

// ===== State =====
let clients = [];
let projects = [];
let invoices = [];
let expenses = [];
let quotes = [];
let activities = [];
let tasks = [];
let settings = null;
let schemaMissing = false;
let clientQuery = "";
let invoiceQuery = "";
let invoiceStatusFilter = "";
let pendingExpenseIds = [];

// ===== Auth =====
$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("loginError").hidden = true;
  const { error } = await sb.auth.signInWithPassword({
    email: $("email").value.trim(),
    password: $("password").value,
  });
  if (error) {
    $("loginError").textContent = error.message;
    $("loginError").hidden = false;
    return;
  }
  checkSession();
});

$("logoutBtn").addEventListener("click", async () => {
  await sb.auth.signOut();
  showLogin();
});

async function checkSession() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) showApp(session.user);
  else showLogin();
}

function showLogin() {
  loginView.hidden = false;
  appView.hidden = true;
}

async function showApp(user) {
  loginView.hidden = true;
  appView.hidden = false;
  $("userEmail").textContent = user.email;
  await loadAll();
}

// ===== Nav =====
document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    $(btn.dataset.tab + "Panel").classList.add("active");
  });
});

// ===== Loaders =====
async function loadAll() {
  const [c, p, inv, ex, st, q, act, tk] = await Promise.all([
    sb.from("clients").select("*").order("created_at", { ascending: false }),
    sb.from("projects").select("*, clients(name)").order("created_at", { ascending: false }),
    sb.from("invoices").select("*, clients(name,company,email,address), invoice_items(*), payments(*)").order("created_at", { ascending: false }),
    sb.from("expenses").select("*, clients(name)").order("incurred_on", { ascending: false }),
    sb.from("settings").select("*").eq("id", 1).maybeSingle(),
    sb.from("quotes").select("*, clients(name,company,email,address), quote_items(*)").order("created_at", { ascending: false }),
    sb.from("activities").select("*").order("created_at", { ascending: false }),
    sb.from("tasks").select("*, clients(name)").order("due_date", { ascending: true }),
  ]);

  // detect missing CRM tables (old schema)
  schemaMissing = [inv, ex, st, q, act, tk].some((r) => r.error && r.error.code === "42P01");
  $("schemaBanner").hidden = !schemaMissing;

  if (c.error) console.error(c.error); else clients = c.data || [];
  if (p.error) console.error(p.error); else projects = p.data || [];
  invoices = inv.error ? [] : inv.data || [];
  expenses = ex.error ? [] : ex.data || [];
  quotes = q.error ? [] : q.data || [];
  activities = act.error ? [] : act.data || [];
  tasks = tk.error ? [] : tk.data || [];
  settings = st.data || null;

  // bootstrap the settings row if it's missing, so invoice numbering always increments
  if (!st.error && !settings) {
    const { data } = await sb.from("settings").upsert({ id: 1 }).select().single();
    settings = data || null;
  }

  invoices.forEach((i) => (i.invoice_items || []).sort((a, b) => a.sort - b.sort));
  quotes.forEach((q) => (q.quote_items || []).sort((a, b) => a.sort - b.sort));

  renderDashboard();
  renderClients();
  renderProjects();
  renderQuotes();
  renderInvoices();
  renderExpenses();
  renderTasks();
  renderSettings();
}

// ===== Invoice helpers =====
function invoiceTotals(inv) {
  const subtotal = (inv.invoice_items || []).reduce((s, it) => s + it.qty * it.rate, 0);
  const vat = subtotal * (Number(inv.vat_rate) || 0) / 100;
  const total = subtotal + vat;
  const paid = (inv.payments || []).reduce((s, p) => s + Number(p.amount), 0);
  return { subtotal, vat, total, paid, balance: total - paid };
}

function displayStatus(inv) {
  const { balance } = invoiceTotals(inv);
  if (inv.status === "sent" && balance > 0 && inv.due_date && inv.due_date < todayISO()) return "overdue";
  return inv.status;
}

function nextInvoiceNumber() {
  const prefix = settings?.invoice_prefix ?? "INV-";
  const n = settings?.next_invoice_number ?? 1;
  return prefix + String(n).padStart(4, "0");
}

function nextQuoteNumber() {
  const prefix = settings?.quote_prefix ?? "Q-";
  const n = settings?.next_quote_number ?? 1;
  return prefix + String(n).padStart(4, "0");
}

function itemsTotals(items, vatRate) {
  const subtotal = (items || []).reduce((s, it) => s + it.qty * it.rate, 0);
  const vat = subtotal * (Number(vatRate) || 0) / 100;
  return { subtotal, vat, total: subtotal + vat };
}

function quoteDisplayStatus(q) {
  if (q.status === "sent" && q.valid_until && q.valid_until < todayISO()) return "expired";
  return q.status;
}

// ===== Toast =====
let toastTimer = null;
function notify(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2500);
}

// ===== Dashboard =====
function renderDashboard() {
  const month = todayISO().slice(0, 7);
  let outstanding = 0, overdueCount = 0, collectedMonth = 0, expensesMonth = 0;

  invoices.forEach((inv) => {
    const t = invoiceTotals(inv);
    const ds = displayStatus(inv);
    if ((ds === "sent" || ds === "overdue") && t.balance > 0) outstanding += t.balance;
    if (ds === "overdue") overdueCount++;
    (inv.payments || []).forEach((p) => {
      if ((p.paid_on || "").startsWith(month)) collectedMonth += Number(p.amount);
    });
  });
  expenses.forEach((e) => {
    if ((e.incurred_on || "").startsWith(month)) expensesMonth += Number(e.amount);
  });

  const activeClients = clients.filter((c) => c.status === "active").length;
  const activeProjects = projects.filter((p) => p.status !== "done").length;

  $("statCards").innerHTML = `
    <div class="stat-card"><div class="stat-label">Outstanding</div><div class="stat-value fire">${money(outstanding)}</div><div class="stat-sub">unpaid invoices</div></div>
    <div class="stat-card"><div class="stat-label">Overdue</div><div class="stat-value">${overdueCount}</div><div class="stat-sub">past due date</div></div>
    <div class="stat-card"><div class="stat-label">Collected</div><div class="stat-value">${money(collectedMonth)}</div><div class="stat-sub">this month</div></div>
    <div class="stat-card"><div class="stat-label">Active clients</div><div class="stat-value">${activeClients}</div><div class="stat-sub">of ${clients.length} total</div></div>
    <div class="stat-card"><div class="stat-label">Active projects</div><div class="stat-value">${activeProjects}</div><div class="stat-sub">in progress / review</div></div>
    <div class="stat-card"><div class="stat-label">Expenses</div><div class="stat-value">${money(expensesMonth)}</div><div class="stat-sub">this month</div></div>
    <div class="stat-card"><div class="stat-label">Profit</div><div class="stat-value">${money(collectedMonth - expensesMonth)}</div><div class="stat-sub">collected − expenses, this month</div></div>
  `;

  // revenue chart — payments collected per month, last 6 months
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleDateString("en-GB", { month: "short" }),
      sum: 0,
    });
  }
  invoices.forEach((inv) => (inv.payments || []).forEach((p) => {
    const m = months.find((mm) => mm.key === (p.paid_on || "").slice(0, 7));
    if (m) m.sum += Number(p.amount);
  }));
  const maxSum = Math.max(...months.map((m) => m.sum), 1);
  $("revChart").innerHTML = months.map((m) => `
    <div class="rev-col">
      <span class="rev-val">${m.sum ? money(m.sum) : ""}</span>
      <div class="rev-bar" style="height:${Math.max((m.sum / maxSum) * 100, 3)}%"></div>
      <span class="rev-label">${m.label}</span>
    </div>`).join("");

  // tasks due
  const openTasks = tasks.filter((t) => !t.done).slice(0, 6);
  $("dashTasks").innerHTML = openTasks.length
    ? openTasks.map((t) => taskRow(t)).join("")
    : `<p class="empty">Nothing due. All clear.</p>`;

  const dueList = invoices
    .filter((i) => ["sent", "overdue"].includes(displayStatus(i)) && invoiceTotals(i).balance > 0)
    .sort((a, b) => (a.due_date || "9999").localeCompare(b.due_date || "9999"))
    .slice(0, 8);

  $("dashOutstanding").innerHTML = dueList.length
    ? dueList.map((inv) => {
        const t = invoiceTotals(inv);
        const ds = displayStatus(inv);
        return `<div class="list-row">
          <div class="grow">
            <button class="link-btn" data-open-invoice="${inv.id}">${esc(inv.invoice_number)}</button>
            <div class="sub">${esc(inv.clients?.name || "—")} · due ${fmtDate(inv.due_date)}</div>
          </div>
          <span class="badge ${ds}">${label(ds)}</span>
          <span class="amount">${money(t.balance)}</span>
        </div>`;
      }).join("")
    : `<p class="empty">Nothing outstanding. Nice.</p>`;

  const activeProjs = projects.filter((p) => p.status !== "done").slice(0, 8);
  $("dashProjects").innerHTML = activeProjs.length
    ? activeProjs.map((p) => `<div class="list-row">
        <div class="grow">
          ${esc(p.title)}
          <div class="sub">${esc(p.clients?.name || "No client")}${p.due_date ? " · due " + fmtDate(p.due_date) : ""}</div>
        </div>
        <span class="badge ${p.status}">${label(p.status)}</span>
      </div>`).join("")
    : `<p class="empty">No active projects.</p>`;
}

$("dashOutstanding").addEventListener("click", (e) => {
  const id = e.target.dataset.openInvoice;
  if (!id) return;
  switchTab("invoices");
  openInvoiceModal(invoices.find((i) => i.id === id));
});

$("dashTasks").addEventListener("change", (e) => {
  const id = e.target.dataset.taskToggle;
  if (id) toggleTask(id, e.target.checked);
});
$("dashTasks").addEventListener("click", async (e) => {
  const editId = e.target.dataset.editTask;
  const delId = e.target.dataset.delTask;
  if (editId) { switchTab("tasks"); openTaskModal(tasks.find((t) => t.id === editId)); }
  if (delId) {
    const { error } = await sb.from("tasks").delete().eq("id", delId);
    if (error) return alert(error.message);
    loadAll();
  }
});

function switchTab(tab) {
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
  $(tab + "Panel").classList.add("active");
}

// ===== Clients =====
$("clientSearch").addEventListener("input", (e) => {
  clientQuery = e.target.value.trim().toLowerCase();
  renderClients();
});

function renderClients() {
  const list = $("clientsList");
  const filtered = clientQuery
    ? clients.filter((c) => [c.name, c.company, c.email].some((v) => (v || "").toLowerCase().includes(clientQuery)))
    : clients;
  if (!filtered.length) {
    list.innerHTML = `<p class="empty">${clients.length ? "No clients match your search." : "No clients yet. Add your first one."}</p>`;
    return;
  }
  list.innerHTML = filtered.map((c) => {
    const projCount = projects.filter((p) => p.client_id === c.id).length;
    const owed = invoices
      .filter((i) => i.client_id === c.id)
      .reduce((s, i) => {
        const ds = displayStatus(i);
        return ["sent", "overdue"].includes(ds) ? s + invoiceTotals(i).balance : s;
      }, 0);
    return `<div class="card-item">
      <h3><button class="link-btn name-link" data-view-client="${c.id}">${esc(c.name)}</button></h3>
      <div class="card-meta">
        ${c.company ? `<span>${esc(c.company)}</span>` : ""}
        ${c.email ? `<span><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></span>` : ""}
        ${c.phone ? `<span>${esc(c.phone)}</span>` : ""}
        <span>${projCount} project${projCount === 1 ? "" : "s"}${owed > 0 ? ` · <strong style="color:var(--flame)">${money(owed)} owed</strong>` : ""}</span>
      </div>
      <span class="badge ${c.status}">${label(c.status)}</span>
      ${c.notes ? `<p class="card-meta" style="margin-top:10px">${esc(c.notes)}</p>` : ""}
      <div class="card-actions">
        <button class="btn btn-ghost btn-sm" data-inv-client="${c.id}">+ Invoice</button>
        <button class="btn btn-ghost btn-sm" data-edit-client="${c.id}">Edit</button>
        <button class="btn btn-ghost btn-sm" data-del-client="${c.id}">Delete</button>
      </div>
    </div>`;
  }).join("");
}

$("clientsList").addEventListener("click", async (e) => {
  const viewId = e.target.dataset.viewClient;
  const editId = e.target.dataset.editClient;
  const delId = e.target.dataset.delClient;
  const invId = e.target.dataset.invClient;
  if (viewId) openClientDetail(viewId);
  if (editId) openClientModal(clients.find((c) => c.id === editId));
  if (invId) openInvoiceModal(null, { clientId: invId });
  if (delId) {
    if (!confirm("Delete this client and their projects?")) return;
    const { error } = await sb.from("clients").delete().eq("id", delId);
    if (error) return alert(error.message);
    loadAll();
  }
});

$("addClientBtn").addEventListener("click", () => openClientModal());

function openClientModal(c = null) {
  $("clientModalTitle").textContent = c ? "Edit client" : "Add client";
  $("clientId").value = c?.id || "";
  $("cName").value = c?.name || "";
  $("cCompany").value = c?.company || "";
  $("cEmail").value = c?.email || "";
  $("cPhone").value = c?.phone || "";
  $("cAddress").value = c?.address || "";
  $("cStatus").value = c?.status || "active";
  $("cNotes").value = c?.notes || "";
  $("clientModal").hidden = false;
}

$("clientForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("clientId").value;
  const payload = {
    name: $("cName").value.trim(),
    company: $("cCompany").value.trim() || null,
    email: $("cEmail").value.trim() || null,
    phone: $("cPhone").value.trim() || null,
    address: $("cAddress").value.trim() || null,
    status: $("cStatus").value,
    notes: $("cNotes").value.trim() || null,
  };
  const { error } = id
    ? await sb.from("clients").update(payload).eq("id", id)
    : await sb.from("clients").insert(payload);
  if (error) return alert(error.message);
  $("clientModal").hidden = true;
  loadAll();
});

// ===== Client detail =====
function openClientDetail(id) {
  const c = clients.find((x) => x.id === id);
  if (!c) return;
  $("cdName").textContent = c.name;
  const metaParts = [];
  if (c.company) metaParts.push(esc(c.company));
  if (c.email) metaParts.push(`<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`);
  if (c.phone) metaParts.push(esc(c.phone));
  if (c.address) metaParts.push(esc(c.address).replace(/\n/g, ", "));
  if (c.notes) metaParts.push(esc(c.notes));
  $("cdMeta").innerHTML = metaParts.map((v) => `<span>${v}</span>`).join("");
  $("cdBadge").innerHTML = `<span class="badge ${c.status}">${label(c.status)}</span>`;

  const cProjects = projects.filter((p) => p.client_id === id);
  const cInvoices = invoices.filter((i) => i.client_id === id);
  const invoiced = cInvoices.reduce((s, i) => s + invoiceTotals(i).total, 0);
  const owed = cInvoices.reduce((s, i) => ["sent", "overdue"].includes(displayStatus(i)) ? s + invoiceTotals(i).balance : s, 0);

  $("cdStats").innerHTML = `
    <div class="stat-card"><div class="stat-label">Projects</div><div class="stat-value">${cProjects.length}</div></div>
    <div class="stat-card"><div class="stat-label">Invoiced</div><div class="stat-value">${money(invoiced)}</div></div>
    <div class="stat-card"><div class="stat-label">Outstanding</div><div class="stat-value fire">${money(owed)}</div></div>`;

  $("cdProjects").innerHTML = cProjects.length
    ? cProjects.map((p) => `<div class="list-row"><div class="grow">${esc(p.title)}<div class="sub">${p.due_date ? "Due " + fmtDate(p.due_date) : "No due date"}</div></div><span class="badge ${p.status}">${label(p.status)}</span></div>`).join("")
    : `<p class="empty" style="padding:14px 0">No projects.</p>`;

  $("cdInvoices").innerHTML = cInvoices.length
    ? cInvoices.map((inv) => {
        const t = invoiceTotals(inv), ds = displayStatus(inv);
        return `<div class="list-row"><div class="grow"><button class="link-btn" data-cd-invoice="${inv.id}">${esc(inv.invoice_number)}</button><div class="sub">${fmtDate(inv.issue_date)}</div></div><span class="badge ${ds}">${label(ds)}</span><span class="amount">${money(t.balance > 0 ? t.balance : t.total)}</span></div>`;
      }).join("")
    : `<p class="empty" style="padding:14px 0">No invoices.</p>`;

  renderClientActivity(id);
  $("actClientId").value = id;
  $("cdEditBtn").onclick = () => { $("clientDetailModal").hidden = true; openClientModal(c); };
  $("clientDetailModal").hidden = false;
}

function renderClientActivity(clientId) {
  const items = activities.filter((a) => a.client_id === clientId);
  $("cdActivity").innerHTML = items.length
    ? items.map((a) => `<div class="timeline-item">
        <span class="timeline-type">${label(a.type)}</span>
        <span class="timeline-body">${esc(a.body)}</span>
        <span class="timeline-date">${fmtDate((a.created_at || "").slice(0, 10))}</span>
      </div>`).join("")
    : `<p class="empty" style="padding:14px 0">No activity logged yet.</p>`;
}

$("cdInvoices").addEventListener("click", (e) => {
  const id = e.target.dataset.cdInvoice;
  if (!id) return;
  $("clientDetailModal").hidden = true;
  switchTab("invoices");
  openInvoiceModal(invoices.find((i) => i.id === id));
});

$("activityForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (schemaMissing) return alert("Run the updated schema.sql in Supabase first — see the banner.");
  const clientId = $("actClientId").value;
  const { error } = await sb.from("activities").insert({
    client_id: clientId,
    type: $("actType").value,
    body: $("actBody").value.trim(),
  });
  if (error) return alert(error.message);
  $("actBody").value = "";
  const { data } = await sb.from("activities").select("*").eq("client_id", clientId).order("created_at", { ascending: false });
  activities = [...activities.filter((a) => a.client_id !== clientId), ...(data || [])];
  renderClientActivity(clientId);
});

// ===== Projects =====
let projView = "grid";
const PROJ_STATUSES = ["planning", "in_progress", "review", "done"];

$("viewGridBtn").addEventListener("click", () => setProjView("grid"));
$("viewBoardBtn").addEventListener("click", () => setProjView("board"));

function setProjView(v) {
  projView = v;
  $("viewGridBtn").classList.toggle("active", v === "grid");
  $("viewBoardBtn").classList.toggle("active", v === "board");
  renderProjects();
}

function renderProjects() {
  const list = $("projectsList");
  const board = $("projectsBoard");
  list.hidden = projView !== "grid";
  board.hidden = projView !== "board";
  if (projView === "board") return renderProjectsBoard();
  if (!projects.length) {
    list.innerHTML = `<p class="empty">No projects yet. Add your first one.</p>`;
    return;
  }
  list.innerHTML = projects.map((p) => `
    <div class="card-item">
      <h3>${esc(p.title)}</h3>
      <div class="card-meta">
        <span>${p.clients ? esc(p.clients.name) : "No client"}</span>
        ${p.type ? `<span>${label(p.type)}</span>` : ""}
        ${p.budget ? `<span>${money(p.budget)}</span>` : ""}
        ${p.due_date ? `<span>Due ${fmtDate(p.due_date)}</span>` : ""}
      </div>
      <span class="badge ${p.status}">${label(p.status)}</span>
      ${p.brief ? `<p class="card-meta" style="margin-top:10px">${esc(p.brief)}</p>` : ""}
      <div class="card-actions">
        ${p.client_id ? `<button class="btn btn-ghost btn-sm" data-inv-project="${p.id}">+ Invoice</button>` : ""}
        <button class="btn btn-ghost btn-sm" data-edit-project="${p.id}">Edit</button>
        <button class="btn btn-ghost btn-sm" data-del-project="${p.id}">Delete</button>
      </div>
    </div>`).join("");
}

$("projectsList").addEventListener("click", async (e) => {
  const editId = e.target.dataset.editProject;
  const delId = e.target.dataset.delProject;
  const invId = e.target.dataset.invProject;
  if (editId) openProjectModal(projects.find((p) => p.id === editId));
  if (invId) {
    const p = projects.find((x) => x.id === invId);
    openInvoiceModal(null, {
      clientId: p.client_id,
      projectId: p.id,
      items: [{ description: p.title, qty: 1, rate: Number(p.budget) || 0 }],
    });
  }
  if (delId) {
    if (!confirm("Delete this project?")) return;
    const { error } = await sb.from("projects").delete().eq("id", delId);
    if (error) return alert(error.message);
    loadAll();
  }
});

$("addProjectBtn").addEventListener("click", () => openProjectModal());

function clientOptions(selectedId) {
  return `<option value="">—</option>` +
    clients.map((c) => `<option value="${c.id}" ${selectedId === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("");
}

function openProjectModal(p = null) {
  $("projectModalTitle").textContent = p ? "Edit project" : "Add project";
  $("projectId").value = p?.id || "";
  $("pTitle").value = p?.title || "";
  $("pType").value = p?.type || "";
  $("pStatus").value = p?.status || "planning";
  $("pBudget").value = p?.budget || "";
  $("pDue").value = p?.due_date || "";
  $("pBrief").value = p?.brief || "";
  $("pClient").innerHTML = clientOptions(p?.client_id);
  $("projectModal").hidden = false;
}

$("projectForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("projectId").value;
  const payload = {
    title: $("pTitle").value.trim(),
    client_id: $("pClient").value || null,
    type: $("pType").value || null,
    status: $("pStatus").value,
    budget: $("pBudget").value ? Number($("pBudget").value) : null,
    due_date: $("pDue").value || null,
    brief: $("pBrief").value.trim() || null,
  };
  const { error } = id
    ? await sb.from("projects").update(payload).eq("id", id)
    : await sb.from("projects").insert(payload);
  if (error) return alert(error.message);
  $("projectModal").hidden = true;
  loadAll();
});

// --- kanban board ---
function renderProjectsBoard() {
  const board = $("projectsBoard");
  board.innerHTML = PROJ_STATUSES.map((status) => {
    const cards = projects.filter((p) => p.status === status);
    return `<div class="kanban-col" data-col="${status}">
      <div class="kanban-col-title"><span>${label(status)}</span><span>${cards.length}</span></div>
      ${cards.map((p) => `<div class="kanban-card" draggable="true" data-proj-id="${p.id}">
        ${esc(p.title)}
        <div class="kc-client">${esc(p.clients?.name || "No client")}</div>
        ${p.due_date ? `<div class="kc-due">Due ${fmtDate(p.due_date)}</div>` : ""}
      </div>`).join("")}
    </div>`;
  }).join("");
}

let dragProjId = null;
$("projectsBoard").addEventListener("dragstart", (e) => {
  dragProjId = e.target.closest(".kanban-card")?.dataset.projId || null;
});
$("projectsBoard").addEventListener("dragover", (e) => {
  const col = e.target.closest(".kanban-col");
  if (!col) return;
  e.preventDefault();
  document.querySelectorAll(".kanban-col").forEach((c) => c.classList.toggle("drag-over", c === col));
});
$("projectsBoard").addEventListener("dragleave", (e) => {
  if (e.target.classList?.contains("kanban-col")) e.target.classList.remove("drag-over");
});
$("projectsBoard").addEventListener("drop", async (e) => {
  const col = e.target.closest(".kanban-col");
  document.querySelectorAll(".kanban-col").forEach((c) => c.classList.remove("drag-over"));
  if (!col || !dragProjId) return;
  e.preventDefault();
  const p = projects.find((x) => x.id === dragProjId);
  if (!p || p.status === col.dataset.col) return;
  const { error } = await sb.from("projects").update({ status: col.dataset.col }).eq("id", p.id);
  if (error) return alert(error.message);
  notify(`${p.title} → ${label(col.dataset.col)}`);
  loadAll();
});

// ===== Quotes =====
function renderQuotes() {
  const list = $("quotesList");
  if (schemaMissing) {
    list.innerHTML = `<p class="empty">Quotes need the updated schema — see the banner above.</p>`;
    return;
  }
  if (!quotes.length) {
    list.innerHTML = `<p class="empty">No quotes yet. Create your first one.</p>`;
    return;
  }
  list.innerHTML = `<div class="table-wrap"><table class="data">
    <tr><th>Quote</th><th>Client</th><th>Issued</th><th>Valid until</th><th>Status</th><th class="right">Total</th><th></th></tr>
    ${quotes.map((q) => {
      const t = itemsTotals(q.quote_items, q.vat_rate);
      const ds = quoteDisplayStatus(q);
      return `<tr>
        <td><button class="link-btn" data-edit-quote="${q.id}">${esc(q.quote_number)}</button></td>
        <td>${esc(q.clients?.name || "—")}</td>
        <td>${fmtDate(q.issue_date)}</td>
        <td>${fmtDate(q.valid_until)}</td>
        <td><span class="badge ${ds}">${label(ds)}</span></td>
        <td class="right money">${money(t.total)}</td>
        <td><div class="row-actions">
          <button class="btn btn-ghost btn-sm" data-edit-quote="${q.id}">Edit</button>
          <button class="btn btn-danger btn-sm" data-del-quote="${q.id}">Delete</button>
        </div></td>
      </tr>`;
    }).join("")}
  </table></div>`;
}

$("quotesList").addEventListener("click", async (e) => {
  const editId = e.target.dataset.editQuote;
  const delId = e.target.dataset.delQuote;
  if (editId) openQuoteModal(quotes.find((q) => q.id === editId));
  if (delId) {
    if (!confirm("Delete this quote?")) return;
    const { error } = await sb.from("quotes").delete().eq("id", delId);
    if (error) return alert(error.message);
    loadAll();
  }
});

$("addQuoteBtn").addEventListener("click", () => openQuoteModal());

$("qClient").addEventListener("change", () => {
  const cid = $("qClient").value;
  const current = $("qProject").value;
  $("qProject").innerHTML = `<option value="">—</option>` +
    projects.filter((p) => !cid || p.client_id === cid)
      .map((p) => `<option value="${p.id}" ${current === p.id ? "selected" : ""}>${esc(p.title)}</option>`).join("");
});

function openQuoteModal(q = null, prefillClientId = null) {
  if (schemaMissing) return alert("Run the updated schema.sql in Supabase first — see the banner.");
  $("quoteModalTitle").textContent = q ? `Quote ${q.quote_number}` : "New quote";
  $("quoteId").value = q?.id || "";
  $("qClient").innerHTML = clientOptions(q?.client_id || prefillClientId);
  $("qClient").dispatchEvent(new Event("change"));
  $("qProject").value = q?.project_id || "";
  $("qIssue").value = q?.issue_date || todayISO();
  $("qValid").value = q?.valid_until || addDays($("qIssue").value, 30);
  $("qVat").value = q ? Number(q.vat_rate) : (settings?.vat_rate ?? 0);
  $("qStatus").value = q?.status || "draft";
  $("qNotes").value = q?.notes || "";

  quoteEditor.items = q
    ? (q.quote_items || []).map((it) => ({ description: it.description, qty: it.qty, rate: it.rate }))
    : [{ description: "", qty: 1, rate: 0 }];
  if (!quoteEditor.items.length) quoteEditor.items.push({ description: "", qty: 1, rate: 0 });
  quoteEditor.render();

  $("printQuoteBtn").hidden = !q;
  $("emailQuoteBtn").hidden = !q || !q?.clients?.email;
  $("convertQuoteBtn").hidden = !q || q.status === "accepted";
  $("quoteModal").hidden = false;
}

$("quoteForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("quoteId").value;
  const payload = {
    client_id: $("qClient").value || null,
    project_id: $("qProject").value || null,
    issue_date: $("qIssue").value,
    valid_until: $("qValid").value || null,
    vat_rate: Number($("qVat").value) || 0,
    status: $("qStatus").value,
    notes: $("qNotes").value.trim() || null,
  };

  let quoteId = id;
  if (!id) {
    payload.quote_number = nextQuoteNumber();
    const { data, error } = await sb.from("quotes").insert(payload).select("id").single();
    if (error) return alert(error.message);
    quoteId = data.id;
    if (settings) {
      await sb.from("settings").update({ next_quote_number: (settings.next_quote_number || 1) + 1 }).eq("id", 1);
      settings.next_quote_number++;
    }
  } else {
    const { error } = await sb.from("quotes").update(payload).eq("id", id);
    if (error) return alert(error.message);
    await sb.from("quote_items").delete().eq("quote_id", id);
  }

  const items = quoteEditor.items
    .filter((it) => it.description.trim() || Number(it.rate) > 0)
    .map((it, i) => ({
      quote_id: quoteId,
      description: it.description.trim() || "Item",
      qty: Number(it.qty) || 0,
      rate: Number(it.rate) || 0,
      sort: i,
    }));
  if (items.length) {
    const { error } = await sb.from("quote_items").insert(items);
    if (error) return alert(error.message);
  }

  $("quoteModal").hidden = true;
  loadAll();
});

// turn an accepted quote into a draft invoice, copying line items
$("convertQuoteBtn").addEventListener("click", async () => {
  const q = quotes.find((x) => x.id === $("quoteId").value);
  if (!q) return;
  if (!confirm(`Convert ${q.quote_number} to an invoice?`)) return;
  const num = nextInvoiceNumber();
  const { data: inv, error } = await sb.from("invoices").insert({
    invoice_number: num,
    client_id: q.client_id,
    project_id: q.project_id,
    status: "draft",
    issue_date: todayISO(),
    due_date: addDays(todayISO(), settings?.payment_terms_days ?? 14),
    vat_rate: q.vat_rate,
    notes: q.notes,
  }).select("id").single();
  if (error) return alert(error.message);

  const items = (q.quote_items || []).map((it, i) => ({
    invoice_id: inv.id, description: it.description, qty: it.qty, rate: it.rate, sort: i,
  }));
  if (items.length) {
    const { error: ie } = await sb.from("invoice_items").insert(items);
    if (ie) return alert(ie.message);
  }
  await sb.from("quotes").update({ status: "accepted" }).eq("id", q.id);
  if (settings) {
    await sb.from("settings").update({ next_invoice_number: (settings.next_invoice_number || 1) + 1 }).eq("id", 1);
    settings.next_invoice_number++;
  }
  $("quoteModal").hidden = true;
  await loadAll();
  switchTab("invoices");
  openInvoiceModal(invoices.find((i) => i.id === inv.id));
});

// ===== Invoices =====
$("invoiceSearch").addEventListener("input", (e) => {
  invoiceQuery = e.target.value.trim().toLowerCase();
  renderInvoices();
});
$("invoiceStatusFilter").addEventListener("change", (e) => {
  invoiceStatusFilter = e.target.value;
  renderInvoices();
});

function renderInvoices() {
  const list = $("invoicesList");
  if (schemaMissing) {
    list.innerHTML = `<p class="empty">Invoices need the updated schema — see the banner above.</p>`;
    return;
  }
  const filtered = invoices.filter((inv) => {
    if (invoiceStatusFilter && displayStatus(inv) !== invoiceStatusFilter) return false;
    if (invoiceQuery && ![inv.invoice_number, inv.clients?.name].some((v) => (v || "").toLowerCase().includes(invoiceQuery))) return false;
    return true;
  });
  if (!filtered.length) {
    list.innerHTML = `<p class="empty">${invoices.length ? "No invoices match your filters." : "No invoices yet. Create your first one."}</p>`;
    return;
  }
  list.innerHTML = `<div class="table-wrap"><table class="data">
    <tr><th>Invoice</th><th>Client</th><th>Issued</th><th>Due</th><th>Status</th><th class="right">Total</th><th class="right">Balance</th><th></th></tr>
    ${filtered.map((inv) => {
      const t = invoiceTotals(inv);
      const ds = displayStatus(inv);
      return `<tr>
        <td><button class="link-btn" data-edit-invoice="${inv.id}">${esc(inv.invoice_number)}</button></td>
        <td>${esc(inv.clients?.name || "—")}</td>
        <td>${fmtDate(inv.issue_date)}</td>
        <td>${fmtDate(inv.due_date)}</td>
        <td><span class="badge ${ds}">${label(ds)}</span></td>
        <td class="right money">${money(t.total)}</td>
        <td class="right money">${t.balance > 0 ? money(t.balance) : "—"}</td>
        <td><div class="row-actions">
          ${ds === "overdue" ? `<button class="btn btn-ghost btn-sm" data-chase-invoice="${inv.id}">Chase</button>` : ""}
          ${t.balance > 0 && inv.status !== "void" ? `<button class="btn btn-ghost btn-sm" data-pay-invoice="${inv.id}">Payment</button>` : ""}
          <button class="btn btn-ghost btn-sm" data-edit-invoice="${inv.id}">Edit</button>
          <button class="btn btn-danger btn-sm" data-del-invoice="${inv.id}">Delete</button>
        </div></td>
      </tr>`;
    }).join("")}
  </table></div>`;
}

$("invoicesList").addEventListener("click", async (e) => {
  const editId = e.target.dataset.editInvoice;
  const delId = e.target.dataset.delInvoice;
  const payId = e.target.dataset.payInvoice;
  const chaseId = e.target.dataset.chaseInvoice;
  if (editId) openInvoiceModal(invoices.find((i) => i.id === editId));
  if (payId) openPaymentModal(payId);
  if (chaseId) {
    const inv = invoices.find((i) => i.id === chaseId);
    const { error } = await sb.from("tasks").insert({
      title: `Chase ${inv.invoice_number} — ${inv.clients?.name || "client"}`,
      due_date: addDays(todayISO(), 2),
      client_id: inv.client_id,
    });
    if (error) return alert(error.message);
    notify(`Chase task added for ${inv.invoice_number}`);
    loadAll();
  }
  if (delId) {
    if (!confirm("Delete this invoice and its payments?")) return;
    const { error } = await sb.from("invoices").delete().eq("id", delId);
    if (error) return alert(error.message);
    loadAll();
  }
});

$("addInvoiceBtn").addEventListener("click", () => openInvoiceModal());

// --- line items editor (shared by invoices & quotes) ---
function createItemsEditor(listEl, totalsEl, vatEl) {
  let items = [];
  const header = `
    <div class="item-row" style="color:var(--muted);font-size:0.72rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase">
      <span>Description</span><span>Qty</span><span>Rate</span><span style="text-align:right">Amount</span><span></span>
    </div>`;

  function totals() {
    const subtotal = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.rate) || 0), 0);
    const vatRate = Number(vatEl.value) || 0;
    const vat = subtotal * vatRate / 100;
    totalsEl.innerHTML = `
      <div class="t-row"><span>Subtotal</span><span>${money(subtotal)}</span></div>
      ${vatRate ? `<div class="t-row"><span>VAT (${vatRate}%)</span><span>${money(vat)}</span></div>` : ""}
      <div class="t-row total"><span>Total</span><span>${money(subtotal + vat)}</span></div>`;
  }

  function render() {
    listEl.innerHTML = header + items.map((it, idx) => `
      <div class="item-row">
        <input type="text" data-item-desc="${idx}" value="${esc(it.description)}" placeholder="Service or deliverable" />
        <input type="number" data-item-qty="${idx}" value="${it.qty}" min="0" step="0.5" />
        <input type="number" data-item-rate="${idx}" value="${it.rate}" min="0" step="0.01" />
        <span class="item-amount">${money(it.qty * it.rate)}</span>
        <button type="button" class="item-del" data-item-del="${idx}" title="Remove">×</button>
      </div>`).join("");
    totals();
  }

  listEl.addEventListener("input", (e) => {
    const d = e.target.dataset;
    if (d.itemDesc !== undefined) items[d.itemDesc].description = e.target.value;
    if (d.itemQty !== undefined) items[d.itemQty].qty = Number(e.target.value);
    if (d.itemRate !== undefined) items[d.itemRate].rate = Number(e.target.value);
    const idx = d.itemQty ?? d.itemRate ?? d.itemDesc;
    if (idx !== undefined) {
      const row = e.target.closest(".item-row");
      if (row) row.querySelector(".item-amount").textContent = money((items[idx].qty || 0) * (items[idx].rate || 0));
    }
    totals();
  });

  listEl.addEventListener("click", (e) => {
    const idx = e.target.dataset.itemDel;
    if (idx === undefined) return;
    items.splice(Number(idx), 1);
    render();
  });

  vatEl.addEventListener("input", totals);

  return {
    get items() { return items; },
    set items(v) { items = v; },
    render,
    add() { items.push({ description: "", qty: 1, rate: 0 }); render(); },
  };
}

const invEditor = createItemsEditor($("itemsList"), $("invoiceTotals"), $("iVat"));
const quoteEditor = createItemsEditor($("qItemsList"), $("quoteTotals"), $("qVat"));
$("addItemBtn").addEventListener("click", () => invEditor.add());
$("qAddItemBtn").addEventListener("click", () => quoteEditor.add());

// keep due date in step with issue date on new invoices
$("iIssue").addEventListener("change", () => {
  if ($("invoiceId").value) return; // only for new invoices
  $("iDue").value = addDays($("iIssue").value, settings?.payment_terms_days ?? 14);
});

// same for quote validity on new quotes
$("qIssue").addEventListener("change", () => {
  if ($("quoteId").value) return;
  $("qValid").value = addDays($("qIssue").value, 30);
});

$("iClient").addEventListener("change", () => {
  // re-filter project dropdown to selected client
  const cid = $("iClient").value;
  const current = $("iProject").value;
  $("iProject").innerHTML = `<option value="">—</option>` +
    projects.filter((p) => !cid || p.client_id === cid)
      .map((p) => `<option value="${p.id}" ${current === p.id ? "selected" : ""}>${esc(p.title)}</option>`).join("");
  refreshBillableHint();
});

// offer to pull uninvoiced billable expenses into a new invoice
function refreshBillableHint() {
  const hint = $("billableHint");
  pendingExpenseIds = [];
  const cid = $("iClient").value;
  if ($("invoiceId").value || !cid) { hint.hidden = true; return; }
  const billable = expenses.filter((e) => e.client_id === cid && e.billable && !e.invoiced);
  if (!billable.length) { hint.hidden = true; return; }
  const total = billable.reduce((s, e) => s + Number(e.amount), 0);
  hint.innerHTML = `<span>${billable.length} uninvoiced billable expense${billable.length === 1 ? "" : "s"} — ${money(total)}</span>
    <button type="button" class="btn btn-ghost btn-sm" id="importBillableBtn">Import as line items</button>`;
  hint.hidden = false;
  $("importBillableBtn").addEventListener("click", () => {
    billable.forEach((e) => invEditor.items.push({
      description: e.description || e.vendor || "Expense",
      qty: 1,
      rate: Number(e.amount),
    }));
    pendingExpenseIds = billable.map((e) => e.id);
    invEditor.render();
    hint.hidden = true;
  });
}

function openInvoiceModal(inv = null, prefill = null) {
  if (schemaMissing) return alert("Run the updated schema.sql in Supabase first — see the banner.");
  $("invoiceModalTitle").textContent = inv ? `Invoice ${inv.invoice_number}` : "New invoice";
  $("invoiceId").value = inv?.id || "";
  $("iClient").innerHTML = clientOptions(inv?.client_id || prefill?.clientId);
  $("iClient").dispatchEvent(new Event("change"));
  $("iProject").value = inv?.project_id || prefill?.projectId || "";
  $("iIssue").value = inv?.issue_date || todayISO();
  const terms = settings?.payment_terms_days ?? 14;
  $("iDue").value = inv?.due_date || addDays($("iIssue").value, terms);
  $("iVat").value = inv ? Number(inv.vat_rate) : (settings?.vat_rate ?? 0);
  $("iStatus").value = inv?.status || "draft";
  $("iNotes").value = inv?.notes || "";

  invEditor.items = inv
    ? (inv.invoice_items || []).map((it) => ({ description: it.description, qty: it.qty, rate: it.rate }))
    : (prefill?.items?.length ? prefill.items : [{ description: "", qty: 1, rate: 0 }]);
  if (!invEditor.items.length) invEditor.items.push({ description: "", qty: 1, rate: 0 });
  invEditor.render();

  // payments block only for saved invoices
  $("paymentsBlock").hidden = !inv;
  $("printInvoiceBtn").hidden = !inv;
  $("dupInvoiceBtn").hidden = !inv;
  $("emailInvoiceBtn").hidden = !inv || !inv?.clients?.email;
  if (inv) renderPaymentsList(inv);

  refreshBillableHint();
  $("invoiceModal").hidden = false;
}

function renderPaymentsList(inv) {
  const pays = inv.payments || [];
  const t = invoiceTotals(inv);
  $("paymentsList").innerHTML =
    (pays.length
      ? pays.map((p) => `<div class="list-row">
          <div class="grow">${money(p.amount)} <span class="sub">· ${fmtDate(p.paid_on)} · ${label(p.method || "payment")}${p.note ? " · " + esc(p.note) : ""}</span></div>
          <button class="btn btn-danger btn-sm" data-del-payment="${p.id}">Remove</button>
        </div>`).join("")
      : `<p class="empty" style="padding:14px 0">No payments recorded.</p>`) +
    `<div class="list-row" style="border-style:dashed"><div class="grow sub">Balance due</div><span class="amount">${money(t.balance)}</span></div>`;
}

$("paymentsList").addEventListener("click", async (e) => {
  const id = e.target.dataset.delPayment;
  if (!id) return;
  if (!confirm("Remove this payment?")) return;
  const { error } = await sb.from("payments").delete().eq("id", id);
  if (error) return alert(error.message);
  const invId = $("invoiceId").value;
  // reopen the invoice if it was marked paid but now has a balance again
  const { data: fresh } = await sb.from("invoices").select("*, invoice_items(*), payments(*)").eq("id", invId).single();
  if (fresh && fresh.status === "paid" && invoiceTotals(fresh).balance > 0.005) {
    await sb.from("invoices").update({ status: "sent" }).eq("id", invId);
  }
  await loadAll();
  const inv = invoices.find((i) => i.id === invId);
  if (inv) renderPaymentsList(inv);
});

$("addPaymentBtn").addEventListener("click", () => openPaymentModal($("invoiceId").value));

$("invoiceForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("invoiceId").value;
  const isNew = !id;
  const payload = {
    client_id: $("iClient").value || null,
    project_id: $("iProject").value || null,
    issue_date: $("iIssue").value,
    due_date: $("iDue").value || null,
    vat_rate: Number($("iVat").value) || 0,
    status: $("iStatus").value,
    notes: $("iNotes").value.trim() || null,
  };

  let invoiceId = id;
  if (isNew) {
    payload.invoice_number = nextInvoiceNumber();
    const { data, error } = await sb.from("invoices").insert(payload).select("id").single();
    if (error) return alert(error.message);
    invoiceId = data.id;
    // bump invoice counter
    if (settings) {
      await sb.from("settings").update({ next_invoice_number: (settings.next_invoice_number || 1) + 1 }).eq("id", 1);
      settings.next_invoice_number++;
    }
  } else {
    const { error } = await sb.from("invoices").update(payload).eq("id", id);
    if (error) return alert(error.message);
    await sb.from("invoice_items").delete().eq("invoice_id", id);
  }

  const items = invEditor.items
    .filter((it) => it.description.trim() || Number(it.rate) > 0)
    .map((it, i) => ({
      invoice_id: invoiceId,
      description: it.description.trim() || "Item",
      qty: Number(it.qty) || 0,
      rate: Number(it.rate) || 0,
      sort: i,
    }));
  if (items.length) {
    const { error } = await sb.from("invoice_items").insert(items);
    if (error) return alert(error.message);
  }

  // mark imported billable expenses as invoiced
  if (pendingExpenseIds.length) {
    await sb.from("expenses").update({ invoiced: true }).in("id", pendingExpenseIds);
    pendingExpenseIds = [];
  }

  $("invoiceModal").hidden = true;
  loadAll();
});

// ===== Payments =====
function openPaymentModal(invoiceId) {
  const inv = invoices.find((i) => i.id === invoiceId);
  if (!inv) return;
  const t = invoiceTotals(inv);
  $("payInvoiceId").value = invoiceId;
  $("payAmount").value = t.balance > 0 ? t.balance.toFixed(2) : "";
  $("payDate").value = todayISO();
  $("payMethod").value = "bank";
  $("payNote").value = "";
  $("paymentModal").hidden = false;
}

$("paymentForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const invoiceId = $("payInvoiceId").value;
  const { error } = await sb.from("payments").insert({
    invoice_id: invoiceId,
    amount: Number($("payAmount").value),
    paid_on: $("payDate").value,
    method: $("payMethod").value,
    note: $("payNote").value.trim() || null,
  });
  if (error) return alert(error.message);

  // auto-mark paid when balance covered
  const { data: fresh } = await sb.from("invoices").select("*, invoice_items(*), payments(*)").eq("id", invoiceId).single();
  if (fresh) {
    const t = invoiceTotals(fresh);
    if (t.balance <= 0.005 && fresh.status !== "paid" && fresh.status !== "void") {
      await sb.from("invoices").update({ status: "paid" }).eq("id", invoiceId);
    }
  }
  $("paymentModal").hidden = true;
  await loadAll();
  // refresh payments list if invoice modal still open
  if (!$("invoiceModal").hidden && $("invoiceId").value === invoiceId) {
    const inv = invoices.find((i) => i.id === invoiceId);
    if (inv) renderPaymentsList(inv);
  }
});

// ===== Print (invoices & quotes) =====
$("printInvoiceBtn").addEventListener("click", () => {
  const inv = invoices.find((i) => i.id === $("invoiceId").value);
  if (inv) printDocument(inv, "invoice");
});

$("printQuoteBtn").addEventListener("click", () => {
  const q = quotes.find((x) => x.id === $("quoteId").value);
  if (q) printDocument(q, "quote");
});

function printDocument(doc, kind) {
  const isQuote = kind === "quote";
  const number = isQuote ? doc.quote_number : doc.invoice_number;
  const items = isQuote ? doc.quote_items : doc.invoice_items;
  const t = itemsTotals(items, doc.vat_rate);
  const paid = isQuote ? 0 : (doc.payments || []).reduce((s, p) => s + Number(p.amount), 0);
  const balance = t.total - paid;
  const client = doc.clients || {};
  const s = settings || {};
  const ds = isQuote ? quoteDisplayStatus(doc) : displayStatus(doc);

  const itemRows = (items || []).map((it) => `
    <tr><td>${esc(it.description)}</td><td class="right">${it.qty}</td><td class="right">${money(it.rate)}</td><td class="right">${money(it.qty * it.rate)}</td></tr>`).join("");

  const payRows = isQuote
    ? `<tr class="total-row"><td>Total</td><td class="right">${money(t.total)}</td></tr>`
    : paid > 0
      ? `<tr class="vat-row"><td>Paid</td><td class="right">−${money(paid)}</td></tr>
         <tr class="total-row"><td>${balance > 0 ? "Balance Due" : "Total"}</td><td class="right">${money(Math.max(balance, 0))}</td></tr>`
      : `<tr class="total-row"><td>Total Due</td><td class="right">${money(t.total)}</td></tr>`;

  const bankBlock = !isQuote && (s.bank_name || s.account_number) ? `
    <div class="payment">
      <h3>Payment Details</h3>
      ${s.bank_name ? `<p><strong>Bank:</strong> ${esc(s.bank_name)}</p>` : ""}
      <p><strong>Name:</strong> ${esc(s.account_name || "Gedker Ltd")}</p>
      ${s.sort_code ? `<p><strong>Sort Code:</strong> ${esc(s.sort_code)}</p>` : ""}
      ${s.account_number ? `<p><strong>Account:</strong> ${esc(s.account_number)}</p>` : ""}
      <p><strong>Reference:</strong> ${esc(number)}</p>
    </div>` : "";

  const stampStatuses = isQuote ? ["accepted", "declined"] : ["paid", "void"];
  const stampColor = { paid: "#1d9e57", accepted: "#1d9e57", void: "#d6141f", declined: "#d6141f" }[ds] || "#d6141f";

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(number)} · WIZZZ</title>
<link href="https://fonts.googleapis.com/css2?family=Metamorphous&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:"Space Grotesk",sans-serif; color:#0a0604; background:#fff; padding:40px 60px; max-width:800px; margin:0 auto; line-height:1.6; }
  .letterhead { display:flex; align-items:center; justify-content:space-between; padding-bottom:24px; border-bottom:3px solid; border-image:linear-gradient(90deg,#ffb347,#ff8a00,#ff4d00,#d6141f) 1; margin-bottom:32px; }
  .letterhead-logo { font-family:"Metamorphous",serif; font-size:36px; letter-spacing:4px; background:linear-gradient(90deg,#ffb347,#ff8a00,#ff4d00,#d6141f); -webkit-background-clip:text; background-clip:text; color:transparent; }
  .letterhead-meta { text-align:right; font-size:12px; color:#666; }
  .invoice-title { font-family:"Metamorphous",serif; font-size:28px; color:#ff4d00; margin-bottom:24px; }
  .stamp { float:right; font-family:"Metamorphous",serif; font-size:20px; color:${stampColor}; border:2px solid currentColor; padding:4px 14px; border-radius:8px; transform:rotate(-4deg); }
  .parties { display:flex; justify-content:space-between; margin-bottom:32px; font-size:13px; }
  .party-label { font-family:"Metamorphous",serif; font-size:11px; color:#ff4d00; text-transform:uppercase; letter-spacing:1px; margin-bottom:4px; }
  .invoice-meta { display:flex; gap:40px; margin-bottom:32px; font-size:13px; padding:16px 20px; background:#fff7f2; border-left:3px solid #ff4d00; }
  .invoice-meta strong { display:block; font-size:11px; text-transform:uppercase; letter-spacing:1px; color:#999; font-weight:600; }
  .invoice-meta span { font-size:15px; font-weight:600; }
  table { width:100%; border-collapse:collapse; font-size:13px; margin-bottom:24px; }
  th { text-align:left; padding:12px; border-bottom:2px solid #ff4d00; font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:1px; }
  th.right, td.right { text-align:right; }
  td { padding:14px 12px; border-bottom:1px solid #eee; }
  .totals { width:280px; margin-left:auto; font-size:14px; }
  .totals td { padding:8px 12px; border:none; }
  .totals .subtotal-row td { border-top:1px solid #eee; }
  .totals .vat-row td { color:#666; }
  .totals .total-row td { border-top:2px solid #ff4d00; border-bottom:2px solid #ff4d00; font-family:"Metamorphous",serif; font-size:18px; padding:14px 12px; }
  .payment { margin-top:40px; padding:20px; background:#fff7f2; border-left:3px solid #ff4d00; font-size:13px; }
  .payment h3 { font-family:"Metamorphous",serif; font-size:14px; color:#ff4d00; margin-bottom:8px; }
  .payment p { margin-bottom:4px; }
  .notes { margin-top:24px; font-size:12px; color:#999; line-height:1.7; white-space:pre-line; }
  .footer { margin-top:48px; padding-top:16px; border-top:1px solid #eee; font-size:11px; color:#999; text-align:center; }
  @media print { body { padding:30px 40px; } }
</style></head><body>
<div class="letterhead">
  <div class="letterhead-logo">WIZZZ</div>
  <div class="letterhead-meta">hello@wizzz.co.uk<br>wizzz.co.uk<br>A trading name of Gedker Ltd</div>
</div>
${stampStatuses.includes(ds) ? `<div class="stamp">${ds.toUpperCase()}</div>` : ""}
<div class="invoice-title">${kind.toUpperCase()}</div>
<div class="parties">
  <div class="party"><div class="party-label">From</div><strong>WIZZZ</strong><br>A trading name of Gedker Ltd<br>hello@wizzz.co.uk<br>wizzz.co.uk</div>
  <div class="party"><div class="party-label">Bill To</div><strong>${esc(client.name || "—")}</strong><br>${esc(client.company || "")}<br>${esc(client.address || "").replace(/\n/g, "<br>")}<br>${esc(client.email || "")}</div>
  </div>
<div class="invoice-meta">
  <div><strong>${isQuote ? "Quote No." : "Invoice No."}</strong><span>${esc(number)}</span></div>
  <div><strong>Issue Date</strong><span>${fmtDate(doc.issue_date)}</span></div>
  <div><strong>${isQuote ? "Valid Until" : "Due Date"}</strong><span>${fmtDate(isQuote ? doc.valid_until : doc.due_date)}</span></div>
</div>
<table>
  <tr><th>Description</th><th class="right">Qty</th><th class="right">Rate</th><th class="right">Amount</th></tr>
  ${itemRows}
</table>
<table class="totals">
  <tr class="subtotal-row"><td>Subtotal</td><td class="right">${money(t.subtotal)}</td></tr>
  ${Number(doc.vat_rate) ? `<tr class="vat-row"><td>VAT (${Number(doc.vat_rate)}%)</td><td class="right">${money(t.vat)}</td></tr>` : ""}
  ${payRows}
</table>
${bankBlock}
<div class="notes">${esc(doc.notes || (isQuote
    ? `This quote is valid until ${fmtDate(doc.valid_until)}. Prices exclude VAT unless shown above. Made with fire by WIZZZ.`
    : s.invoice_notes || `Payment due within ${s.payment_terms_days ?? 14} days of issue date. Please include the invoice number as payment reference. Made with fire by WIZZZ.`))}</div>
<div class="footer">WIZZZ · A trading name of Gedker Ltd · hello@wizzz.co.uk · wizzz.co.uk</div>
</body></html>`;

  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) return alert("Popup blocked — allow popups to print invoices.");
  win.document.write(html);
  win.document.close();
  let printed = false;
  const doPrint = () => { if (!printed) { printed = true; win.print(); } };
  win.onload = doPrint;
  setTimeout(doPrint, 600);
}

// ===== Email invoice / quote =====
function emailDoc(doc, kind) {
  const isQuote = kind === "quote";
  const number = isQuote ? doc.quote_number : doc.invoice_number;
  const items = isQuote ? doc.quote_items : doc.invoice_items;
  const t = itemsTotals(items, doc.vat_rate);
  const client = doc.clients || {};
  const s = settings || {};
  const dateLine = isQuote
    ? `valid until ${fmtDate(doc.valid_until)}`
    : `due ${fmtDate(doc.due_date)}`;
  const bank = (!isQuote && (s.bank_name || s.account_number))
    ? `\n\nPayment details:\nBank: ${s.bank_name || ""}\nName: ${s.account_name || "Gedker Ltd"}\nSort code: ${s.sort_code || ""}\nAccount: ${s.account_number || ""}\nReference: ${number}`
    : "";
  const subject = `${isQuote ? "Quote" : "Invoice"} ${number} from WIZZZ`;
  const body = `Hi ${client.name || "there"},\n\nPlease find ${isQuote ? "quote" : "invoice"} ${number} attached — ${money(t.total)}, ${dateLine}.${bank}\n\nThanks,\nWIZZZ\nhello@wizzz.co.uk · wizzz.co.uk`;
  window.location.href = `mailto:${client.email || ""}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

$("emailInvoiceBtn").addEventListener("click", () => {
  const inv = invoices.find((i) => i.id === $("invoiceId").value);
  if (inv) emailDoc(inv, "invoice");
});
$("emailQuoteBtn").addEventListener("click", () => {
  const q = quotes.find((x) => x.id === $("quoteId").value);
  if (q) emailDoc(q, "quote");
});

// ===== Duplicate invoice (retainers) =====
$("dupInvoiceBtn").addEventListener("click", () => {
  const inv = invoices.find((i) => i.id === $("invoiceId").value);
  if (!inv) return;
  $("invoiceModal").hidden = true;
  openInvoiceModal(null, {
    clientId: inv.client_id,
    projectId: inv.project_id,
    items: (inv.invoice_items || []).map((it) => ({ description: it.description, qty: it.qty, rate: it.rate })),
  });
  // carry over VAT + notes
  $("iVat").value = Number(inv.vat_rate);
  $("iNotes").value = inv.notes || "";
  invEditor.render();
  notify("Invoice duplicated — save to create it");
});

// ===== Client statement =====
$("cdStatementBtn").addEventListener("click", () => {
  const c = clients.find((x) => x.id === $("actClientId").value);
  if (c) printStatement(c);
});

function printStatement(client) {
  const cInvoices = invoices
    .filter((i) => i.client_id === client.id)
    .sort((a, b) => (a.issue_date || "").localeCompare(b.issue_date || ""));
  let totInv = 0, totPaid = 0;
  const rows = cInvoices.map((inv) => {
    const t = invoiceTotals(inv);
    totInv += t.total; totPaid += t.paid;
    return `<tr>
      <td>${esc(inv.invoice_number)}</td><td>${fmtDate(inv.issue_date)}</td><td>${fmtDate(inv.due_date)}</td>
      <td>${label(displayStatus(inv))}</td>
      <td class="right">${money(t.total)}</td><td class="right">${money(t.paid)}</td><td class="right">${money(Math.max(t.balance, 0))}</td>
    </tr>`;
  }).join("");
  const outstanding = totInv - totPaid;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Statement · ${esc(client.name)} · WIZZZ</title>
<link href="https://fonts.googleapis.com/css2?family=Metamorphous&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:"Space Grotesk",sans-serif; color:#0a0604; background:#fff; padding:40px 60px; max-width:800px; margin:0 auto; line-height:1.6; }
  .letterhead { display:flex; align-items:center; justify-content:space-between; padding-bottom:24px; border-bottom:3px solid; border-image:linear-gradient(90deg,#ffb347,#ff8a00,#ff4d00,#d6141f) 1; margin-bottom:32px; }
  .letterhead-logo { font-family:"Metamorphous",serif; font-size:36px; letter-spacing:4px; background:linear-gradient(90deg,#ffb347,#ff8a00,#ff4d00,#d6141f); -webkit-background-clip:text; background-clip:text; color:transparent; }
  .letterhead-meta { text-align:right; font-size:12px; color:#666; }
  .doc-title { font-family:"Metamorphous",serif; font-size:28px; color:#ff4d00; margin-bottom:8px; }
  .sub { color:#666; font-size:13px; margin-bottom:32px; }
  table { width:100%; border-collapse:collapse; font-size:13px; margin-bottom:24px; }
  th { text-align:left; padding:12px; border-bottom:2px solid #ff4d00; font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:1px; }
  th.right, td.right { text-align:right; }
  td { padding:12px; border-bottom:1px solid #eee; }
  .totals { width:280px; margin-left:auto; font-size:14px; }
  .totals td { padding:8px 12px; border:none; }
  .totals .total-row td { border-top:2px solid #ff4d00; border-bottom:2px solid #ff4d00; font-family:"Metamorphous",serif; font-size:18px; padding:14px 12px; }
  .footer { margin-top:48px; padding-top:16px; border-top:1px solid #eee; font-size:11px; color:#999; text-align:center; }
  @media print { body { padding:30px 40px; } }
</style></head><body>
<div class="letterhead">
  <div class="letterhead-logo">WIZZZ</div>
  <div class="letterhead-meta">hello@wizzz.co.uk<br>wizzz.co.uk<br>A trading name of Gedker Ltd</div>
</div>
<div class="doc-title">STATEMENT</div>
<div class="sub">${esc(client.name)}${client.company ? " · " + esc(client.company) : ""} · as at ${fmtDate(todayISO())}</div>
<table>
  <tr><th>Invoice</th><th>Issued</th><th>Due</th><th>Status</th><th class="right">Total</th><th class="right">Paid</th><th class="right">Balance</th></tr>
  ${rows || `<tr><td colspan="7" style="color:#999">No invoices on record.</td></tr>`}
</table>
<table class="totals">
  <tr><td>Total invoiced</td><td class="right">${money(totInv)}</td></tr>
  <tr><td>Total paid</td><td class="right">${money(totPaid)}</td></tr>
  <tr class="total-row"><td>Outstanding</td><td class="right">${money(outstanding)}</td></tr>
</table>
<div class="footer">WIZZZ · A trading name of Gedker Ltd · hello@wizzz.co.uk · wizzz.co.uk</div>
</body></html>`;

  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) return alert("Popup blocked — allow popups to print statements.");
  win.document.write(html);
  win.document.close();
  let printed = false;
  const doPrint = () => { if (!printed) { printed = true; win.print(); } };
  win.onload = doPrint;
  setTimeout(doPrint, 600);
}

// ===== Full backup =====
$("backupBtn").addEventListener("click", () => {
  const data = {
    exported_at: new Date().toISOString(),
    clients, projects, invoices, quotes, expenses, tasks, activities, settings,
  };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  a.download = `wizzz-backup-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  notify("Backup downloaded");
});

// ===== Expenses =====
function renderExpenses() {
  const list = $("expensesList");
  if (schemaMissing) {
    list.innerHTML = `<p class="empty">Expenses need the updated schema — see the banner above.</p>`;
    return;
  }
  if (!expenses.length) {
    list.innerHTML = `<p class="empty">No expenses yet.</p>`;
    return;
  }
  const total = expenses.reduce((s, e) => s + Number(e.amount), 0);
  list.innerHTML = `<div class="table-wrap"><table class="data">
    <tr><th>Date</th><th>Vendor</th><th>Description</th><th>Category</th><th>Billable</th><th class="right">Amount</th><th></th></tr>
    ${expenses.map((e) => `<tr>
      <td>${fmtDate(e.incurred_on)}</td>
      <td>${esc(e.vendor || "—")}</td>
      <td>${esc(e.description || "—")}</td>
      <td>${label(e.category || "other")}</td>
      <td>${e.billable ? esc(e.clients?.name || "Yes") : "—"}</td>
      <td class="right money">${money(e.amount)}</td>
      <td><div class="row-actions">
        <button class="btn btn-ghost btn-sm" data-edit-expense="${e.id}">Edit</button>
        <button class="btn btn-danger btn-sm" data-del-expense="${e.id}">Delete</button>
      </div></td>
    </tr>`).join("")}
    <tr><td colspan="5" style="font-weight:700">Total</td><td class="right money">${money(total)}</td><td></td></tr>
  </table></div>`;
}

$("expensesList").addEventListener("click", async (e) => {
  const editId = e.target.dataset.editExpense;
  const delId = e.target.dataset.delExpense;
  if (editId) openExpenseModal(expenses.find((x) => x.id === editId));
  if (delId) {
    if (!confirm("Delete this expense?")) return;
    const { error } = await sb.from("expenses").delete().eq("id", delId);
    if (error) return alert(error.message);
    loadAll();
  }
});

$("addExpenseBtn").addEventListener("click", () => openExpenseModal());

function openExpenseModal(x = null) {
  if (schemaMissing) return alert("Run the updated schema.sql in Supabase first — see the banner.");
  $("expenseModalTitle").textContent = x ? "Edit expense" : "Add expense";
  $("expenseId").value = x?.id || "";
  $("eDate").value = x?.incurred_on || todayISO();
  $("eCategory").value = x?.category || "software";
  $("eVendor").value = x?.vendor || "";
  $("eDesc").value = x?.description || "";
  $("eAmount").value = x?.amount ?? "";
  $("eBillable").checked = !!x?.billable;
  $("eClient").innerHTML = clientOptions(x?.client_id);
  $("expenseModal").hidden = false;
}

$("expenseForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("expenseId").value;
  const payload = {
    incurred_on: $("eDate").value,
    category: $("eCategory").value,
    vendor: $("eVendor").value.trim() || null,
    description: $("eDesc").value.trim() || null,
    amount: Number($("eAmount").value),
    billable: $("eBillable").checked,
    client_id: $("eBillable").checked ? ($("eClient").value || null) : null,
  };
  const { error } = id
    ? await sb.from("expenses").update(payload).eq("id", id)
    : await sb.from("expenses").insert(payload);
  if (error) return alert(error.message);
  $("expenseModal").hidden = true;
  loadAll();
});

// ===== Tasks =====
function taskRow(t) {
  const overdue = !t.done && t.due_date && t.due_date < todayISO();
  return `<div class="list-row">
    <input type="checkbox" class="task-check" data-task-toggle="${t.id}" ${t.done ? "checked" : ""} />
    <div class="grow">
      <button class="link-btn ${t.done ? "task-done" : ""}" data-edit-task="${t.id}">${esc(t.title)}</button>
      <div class="sub">${[t.clients?.name, t.due_date ? "Due " + fmtDate(t.due_date) : null].filter(Boolean).join(" · ")}</div>
    </div>
    ${overdue ? `<span class="badge overdue">Overdue</span>` : ""}
    <button class="btn btn-danger btn-sm" data-del-task="${t.id}">Delete</button>
  </div>`;
}

function renderTasks() {
  const list = $("tasksList");
  if (schemaMissing) {
    list.innerHTML = `<p class="empty">Tasks need the updated schema — see the banner above.</p>`;
    return;
  }
  if (!tasks.length) {
    list.innerHTML = `<p class="empty">No tasks. Add a follow-up so nothing slips.</p>`;
    return;
  }
  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);
  list.innerHTML =
    open.map(taskRow).join("") +
    (done.length ? `<h4 class="section-title">Done</h4>` + done.map(taskRow).join("") : "");
}

$("tasksList").addEventListener("change", (e) => {
  const id = e.target.dataset.taskToggle;
  if (id) toggleTask(id, e.target.checked);
});
$("tasksList").addEventListener("click", async (e) => {
  const editId = e.target.dataset.editTask;
  const delId = e.target.dataset.delTask;
  if (editId) openTaskModal(tasks.find((t) => t.id === editId));
  if (delId) {
    const { error } = await sb.from("tasks").delete().eq("id", delId);
    if (error) return alert(error.message);
    loadAll();
  }
});

async function toggleTask(id, done) {
  const { error } = await sb.from("tasks").update({ done }).eq("id", id);
  if (error) return alert(error.message);
  loadAll();
}

$("addTaskBtn").addEventListener("click", () => openTaskModal());

function openTaskModal(t = null, prefillClientId = null) {
  if (schemaMissing) return alert("Run the updated schema.sql in Supabase first — see the banner.");
  $("taskModalTitle").textContent = t ? "Edit task" : "Add task";
  $("taskId").value = t?.id || "";
  $("tTitle").value = t?.title || "";
  $("tDue").value = t?.due_date || "";
  $("tClient").innerHTML = clientOptions(t?.client_id || prefillClientId);
  $("taskModal").hidden = false;
}

$("taskForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("taskId").value;
  const payload = {
    title: $("tTitle").value.trim(),
    due_date: $("tDue").value || null,
    client_id: $("tClient").value || null,
  };
  const { error } = id
    ? await sb.from("tasks").update(payload).eq("id", id)
    : await sb.from("tasks").insert(payload);
  if (error) return alert(error.message);
  $("taskModal").hidden = true;
  loadAll();
});

// ===== CSV export =====
function exportCSV(filename, headers, rows) {
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [headers.map(q).join(","), ...rows.map((r) => r.map(q).join(","))].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

$("exportClientsBtn").addEventListener("click", () =>
  exportCSV("clients.csv",
    ["Name", "Company", "Email", "Phone", "Address", "Status", "Created"],
    clients.map((c) => [c.name, c.company, c.email, c.phone, c.address, c.status, (c.created_at || "").slice(0, 10)]))
);

$("exportInvoicesBtn").addEventListener("click", () =>
  exportCSV("invoices.csv",
    ["Number", "Client", "Issued", "Due", "Status", "Subtotal", "VAT", "Total", "Paid", "Balance"],
    invoices.map((inv) => {
      const t = invoiceTotals(inv);
      return [inv.invoice_number, inv.clients?.name, inv.issue_date, inv.due_date, displayStatus(inv),
        t.subtotal.toFixed(2), t.vat.toFixed(2), t.total.toFixed(2), t.paid.toFixed(2), t.balance.toFixed(2)];
    }))
);

$("exportExpensesBtn").addEventListener("click", () =>
  exportCSV("expenses.csv",
    ["Date", "Vendor", "Description", "Category", "Amount", "Billable", "Invoiced", "Client"],
    expenses.map((e) => [e.incurred_on, e.vendor, e.description, e.category, Number(e.amount).toFixed(2),
      e.billable ? "yes" : "no", e.invoiced ? "yes" : "no", e.clients?.name]))
);

// ===== Settings =====
function renderSettings() {
  const s = settings || {};
  $("sPrefix").value = s.invoice_prefix ?? "INV-";
  $("sNextNum").value = s.next_invoice_number ?? 1;
  $("sQPrefix").value = s.quote_prefix ?? "Q-";
  $("sQNext").value = s.next_quote_number ?? 1;
  $("sTerms").value = s.payment_terms_days ?? 14;
  $("sVat").value = s.vat_rate ?? 20;
  $("sBank").value = s.bank_name || "";
  $("sAccName").value = s.account_name || "Gedker Ltd";
  $("sSort").value = s.sort_code || "";
  $("sAccNum").value = s.account_number || "";
  $("sNotes").value = s.invoice_notes || "";
}

$("settingsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (schemaMissing) return alert("Run the updated schema.sql in Supabase first — see the banner.");
  const payload = {
    id: 1,
    invoice_prefix: $("sPrefix").value.trim() || "INV-",
    next_invoice_number: Number($("sNextNum").value) || 1,
    quote_prefix: $("sQPrefix").value.trim() || "Q-",
    next_quote_number: Number($("sQNext").value) || 1,
    payment_terms_days: Number($("sTerms").value) || 14,
    vat_rate: Number($("sVat").value) || 0,
    bank_name: $("sBank").value.trim() || null,
    account_name: $("sAccName").value.trim() || null,
    sort_code: $("sSort").value.trim() || null,
    account_number: $("sAccNum").value.trim() || null,
    invoice_notes: $("sNotes").value.trim() || null,
  };
  const { error } = await sb.from("settings").upsert(payload);
  if (error) return alert(error.message);
  settings = payload;
  $("settingsSaved").hidden = false;
  setTimeout(() => { $("settingsSaved").hidden = true; }, 2500);
});

// ===== Modal close =====
document.querySelectorAll("[data-close]").forEach((b) =>
  b.addEventListener("click", () => b.closest(".modal").hidden = true)
);
document.querySelectorAll(".modal").forEach((m) =>
  m.addEventListener("click", (e) => { if (e.target === m) m.hidden = true; })
);
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const open = [...document.querySelectorAll(".modal")].filter((m) => !m.hidden);
  if (open.length) open[open.length - 1].hidden = true; // close only the topmost modal
});

// ===== Helpers =====
function esc(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, (ch) => "&#" + ch.charCodeAt(0) + ";");
}
function label(s) {
  return (s || "").replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}
const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
function money(n) {
  return gbp.format(Number(n) || 0);
}
function fmtDate(d) {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function addDays(iso, days) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ===== Init =====
checkSession();
