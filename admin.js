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
let settings = null;
let schemaMissing = false;

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
  const [c, p, inv, ex, st] = await Promise.all([
    sb.from("clients").select("*").order("created_at", { ascending: false }),
    sb.from("projects").select("*, clients(name)").order("created_at", { ascending: false }),
    sb.from("invoices").select("*, clients(name,company), invoice_items(*), payments(*)").order("created_at", { ascending: false }),
    sb.from("expenses").select("*, clients(name)").order("incurred_on", { ascending: false }),
    sb.from("settings").select("*").eq("id", 1).maybeSingle(),
  ]);

  // detect missing CRM tables (old schema)
  schemaMissing = [inv, ex, st].some((r) => r.error && r.error.code === "42P01");
  $("schemaBanner").hidden = !schemaMissing;

  if (c.error) console.error(c.error); else clients = c.data || [];
  if (p.error) console.error(p.error); else projects = p.data || [];
  invoices = inv.error ? [] : inv.data || [];
  expenses = ex.error ? [] : ex.data || [];
  settings = st.data || null;

  invoices.forEach((i) => {
    (i.invoice_items || []).sort((a, b) => a.sort - b.sort);
  });

  renderDashboard();
  renderClients();
  renderProjects();
  renderInvoices();
  renderExpenses();
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
  `;

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

function switchTab(tab) {
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
  $(tab + "Panel").classList.add("active");
}

// ===== Clients =====
function renderClients() {
  const list = $("clientsList");
  if (!clients.length) {
    list.innerHTML = `<p class="empty">No clients yet. Add your first one.</p>`;
    return;
  }
  list.innerHTML = clients.map((c) => {
    const projCount = projects.filter((p) => p.client_id === c.id).length;
    const owed = invoices
      .filter((i) => i.client_id === c.id)
      .reduce((s, i) => {
        const ds = displayStatus(i);
        return ["sent", "overdue"].includes(ds) ? s + invoiceTotals(i).balance : s;
      }, 0);
    return `<div class="card-item">
      <h3>${esc(c.name)}</h3>
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
  const editId = e.target.dataset.editClient;
  const delId = e.target.dataset.delClient;
  const invId = e.target.dataset.invClient;
  if (editId) openClientModal(clients.find((c) => c.id === editId));
  if (invId) openInvoiceModal(null, invId);
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

// ===== Projects =====
function renderProjects() {
  const list = $("projectsList");
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
        <button class="btn btn-ghost btn-sm" data-edit-project="${p.id}">Edit</button>
        <button class="btn btn-ghost btn-sm" data-del-project="${p.id}">Delete</button>
      </div>
    </div>`).join("");
}

$("projectsList").addEventListener("click", async (e) => {
  const editId = e.target.dataset.editProject;
  const delId = e.target.dataset.delProject;
  if (editId) openProjectModal(projects.find((p) => p.id === editId));
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

// ===== Invoices =====
function renderInvoices() {
  const list = $("invoicesList");
  if (schemaMissing) {
    list.innerHTML = `<p class="empty">Invoices need the updated schema — see the banner above.</p>`;
    return;
  }
  if (!invoices.length) {
    list.innerHTML = `<p class="empty">No invoices yet. Create your first one.</p>`;
    return;
  }
  list.innerHTML = `<div class="table-wrap"><table class="data">
    <tr><th>Invoice</th><th>Client</th><th>Issued</th><th>Due</th><th>Status</th><th class="right">Total</th><th class="right">Balance</th><th></th></tr>
    ${invoices.map((inv) => {
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
  if (editId) openInvoiceModal(invoices.find((i) => i.id === editId));
  if (payId) openPaymentModal(payId);
  if (delId) {
    if (!confirm("Delete this invoice and its payments?")) return;
    const { error } = await sb.from("invoices").delete().eq("id", delId);
    if (error) return alert(error.message);
    loadAll();
  }
});

$("addInvoiceBtn").addEventListener("click", () => openInvoiceModal());

// --- line items editor ---
let editorItems = [];

function renderItemRows() {
  const list = $("itemsList");
  list.innerHTML = `
    <div class="item-row" style="color:var(--muted);font-size:0.72rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase">
      <span>Description</span><span>Qty</span><span>Rate</span><span style="text-align:right">Amount</span><span></span>
    </div>` +
    editorItems.map((it, idx) => `
      <div class="item-row">
        <input type="text" data-item-desc="${idx}" value="${esc(it.description)}" placeholder="Service or deliverable" />
        <input type="number" data-item-qty="${idx}" value="${it.qty}" min="0" step="0.5" />
        <input type="number" data-item-rate="${idx}" value="${it.rate}" min="0" step="0.01" />
        <span class="item-amount">${money(it.qty * it.rate)}</span>
        <button type="button" class="item-del" data-item-del="${idx}" title="Remove">×</button>
      </div>`).join("");
  updateInvoiceTotals();
}

function updateInvoiceTotals() {
  const subtotal = editorItems.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.rate) || 0), 0);
  const vatRate = Number($("iVat").value) || 0;
  const vat = subtotal * vatRate / 100;
  $("invoiceTotals").innerHTML = `
    <div class="t-row"><span>Subtotal</span><span>${money(subtotal)}</span></div>
    ${vatRate ? `<div class="t-row"><span>VAT (${vatRate}%)</span><span>${money(vat)}</span></div>` : ""}
    <div class="t-row total"><span>Total</span><span>${money(subtotal + vat)}</span></div>`;
}

$("itemsList").addEventListener("input", (e) => {
  const d = e.target.dataset;
  if (d.itemDesc !== undefined) editorItems[d.itemDesc].description = e.target.value;
  if (d.itemQty !== undefined) editorItems[d.itemQty].qty = Number(e.target.value);
  if (d.itemRate !== undefined) editorItems[d.itemRate].rate = Number(e.target.value);
  const row = e.target.closest(".item-row");
  if (row) {
    const idx = d.itemQty ?? d.itemRate ?? d.itemDesc;
    row.querySelector(".item-amount").textContent = money((editorItems[idx].qty || 0) * (editorItems[idx].rate || 0));
  }
  updateInvoiceTotals();
});

$("itemsList").addEventListener("click", (e) => {
  const idx = e.target.dataset.itemDel;
  if (idx === undefined) return;
  editorItems.splice(Number(idx), 1);
  renderItemRows();
});

$("addItemBtn").addEventListener("click", () => {
  editorItems.push({ description: "", qty: 1, rate: 0 });
  renderItemRows();
});

$("iVat").addEventListener("input", updateInvoiceTotals);

$("iClient").addEventListener("change", () => {
  // re-filter project dropdown to selected client
  const cid = $("iClient").value;
  const current = $("iProject").value;
  $("iProject").innerHTML = `<option value="">—</option>` +
    projects.filter((p) => !cid || p.client_id === cid)
      .map((p) => `<option value="${p.id}" ${current === p.id ? "selected" : ""}>${esc(p.title)}</option>`).join("");
});

function openInvoiceModal(inv = null, prefillClientId = null) {
  if (schemaMissing) return alert("Run the updated schema.sql in Supabase first — see the banner.");
  $("invoiceModalTitle").textContent = inv ? `Invoice ${inv.invoice_number}` : "New invoice";
  $("invoiceId").value = inv?.id || "";
  $("iClient").innerHTML = clientOptions(inv?.client_id || prefillClientId);
  $("iClient").dispatchEvent(new Event("change"));
  $("iProject").value = inv?.project_id || "";
  $("iIssue").value = inv?.issue_date || todayISO();
  const terms = settings?.payment_terms_days ?? 14;
  $("iDue").value = inv?.due_date || addDays($("iIssue").value, terms);
  $("iVat").value = inv ? Number(inv.vat_rate) : (settings?.vat_rate ?? 0);
  $("iStatus").value = inv?.status || "draft";
  $("iNotes").value = inv?.notes || "";

  editorItems = inv
    ? (inv.invoice_items || []).map((it) => ({ description: it.description, qty: it.qty, rate: it.rate }))
    : [{ description: "", qty: 1, rate: 0 }];
  if (!editorItems.length) editorItems.push({ description: "", qty: 1, rate: 0 });
  renderItemRows();

  // payments block only for saved invoices
  $("paymentsBlock").hidden = !inv;
  $("printInvoiceBtn").hidden = !inv;
  if (inv) renderPaymentsList(inv);

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

  const items = editorItems
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
    if (t.balance <= 0.005 && fresh.status !== "paid") {
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

// ===== Invoice print =====
$("printInvoiceBtn").addEventListener("click", () => {
  const inv = invoices.find((i) => i.id === $("invoiceId").value);
  if (inv) printInvoice(inv);
});

function printInvoice(inv) {
  const t = invoiceTotals(inv);
  const client = inv.clients || {};
  const s = settings || {};
  const ds = displayStatus(inv);

  const itemRows = (inv.invoice_items || []).map((it) => `
    <tr><td>${esc(it.description)}</td><td class="right">${it.qty}</td><td class="right">${money(it.rate)}</td><td class="right">${money(it.qty * it.rate)}</td></tr>`).join("");

  const payRows = t.paid > 0
    ? `<tr class="vat-row"><td>Paid</td><td class="right">−${money(t.paid)}</td></tr>
       <tr class="total-row"><td>${t.balance > 0 ? "Balance Due" : "Total"}</td><td class="right">${money(Math.max(t.balance, 0))}</td></tr>`
    : `<tr class="total-row"><td>Total Due</td><td class="right">${money(t.total)}</td></tr>`;

  const bankBlock = (s.bank_name || s.account_number) ? `
    <div class="payment">
      <h3>Payment Details</h3>
      ${s.bank_name ? `<p><strong>Bank:</strong> ${esc(s.bank_name)}</p>` : ""}
      <p><strong>Name:</strong> ${esc(s.account_name || "Gedker Ltd")}</p>
      ${s.sort_code ? `<p><strong>Sort Code:</strong> ${esc(s.sort_code)}</p>` : ""}
      ${s.account_number ? `<p><strong>Account:</strong> ${esc(s.account_number)}</p>` : ""}
      <p><strong>Reference:</strong> ${esc(inv.invoice_number)}</p>
    </div>` : "";

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(inv.invoice_number)} · WIZZZ</title>
<link href="https://fonts.googleapis.com/css2?family=Metamorphous&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:"Space Grotesk",sans-serif; color:#0a0604; background:#fff; padding:40px 60px; max-width:800px; margin:0 auto; line-height:1.6; }
  .letterhead { display:flex; align-items:center; justify-content:space-between; padding-bottom:24px; border-bottom:3px solid; border-image:linear-gradient(90deg,#ffb347,#ff8a00,#ff4d00,#d6141f) 1; margin-bottom:32px; }
  .letterhead-logo { font-family:"Metamorphous",serif; font-size:36px; letter-spacing:4px; background:linear-gradient(90deg,#ffb347,#ff8a00,#ff4d00,#d6141f); -webkit-background-clip:text; background-clip:text; color:transparent; }
  .letterhead-meta { text-align:right; font-size:12px; color:#666; }
  .invoice-title { font-family:"Metamorphous",serif; font-size:28px; color:#ff4d00; margin-bottom:24px; }
  .stamp { float:right; font-family:"Metamorphous",serif; font-size:20px; color:${ds === "paid" ? "#1d9e57" : "#d6141f"}; border:2px solid currentColor; padding:4px 14px; border-radius:8px; transform:rotate(-4deg); }
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
${["paid", "void"].includes(ds) ? `<div class="stamp">${ds.toUpperCase()}</div>` : ""}
<div class="invoice-title">INVOICE</div>
<div class="parties">
  <div class="party"><div class="party-label">From</div><strong>WIZZZ</strong><br>A trading name of Gedker Ltd<br>hello@wizzz.co.uk<br>wizzz.co.uk</div>
  <div class="party"><div class="party-label">Bill To</div><strong>${esc(client.name || "—")}</strong><br>${esc(client.company || "")}<br>${esc(client.address || "").replace(/\n/g, "<br>")}<br>${esc(client.email || "")}</div>
  </div>
<div class="invoice-meta">
  <div><strong>Invoice No.</strong><span>${esc(inv.invoice_number)}</span></div>
  <div><strong>Issue Date</strong><span>${fmtDate(inv.issue_date)}</span></div>
  <div><strong>Due Date</strong><span>${fmtDate(inv.due_date)}</span></div>
</div>
<table>
  <tr><th>Description</th><th class="right">Qty</th><th class="right">Rate</th><th class="right">Amount</th></tr>
  ${itemRows}
</table>
<table class="totals">
  <tr class="subtotal-row"><td>Subtotal</td><td class="right">${money(t.subtotal)}</td></tr>
  ${Number(inv.vat_rate) ? `<tr class="vat-row"><td>VAT (${Number(inv.vat_rate)}%)</td><td class="right">${money(t.vat)}</td></tr>` : ""}
  ${payRows}
</table>
${bankBlock}
<div class="notes">${esc(inv.notes || s.invoice_notes || `Payment due within ${s.payment_terms_days ?? 14} days of issue date. Please include the invoice number as payment reference. Made with fire by WIZZZ.`)}</div>
<div class="footer">WIZZZ · A trading name of Gedker Ltd · hello@wizzz.co.uk · wizzz.co.uk</div>
</body></html>`;

  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) return alert("Popup blocked — allow popups to print invoices.");
  win.document.write(html);
  win.document.close();
  win.onload = () => win.print();
  setTimeout(() => win.print(), 600);
}

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

// ===== Settings =====
function renderSettings() {
  const s = settings || {};
  $("sPrefix").value = s.invoice_prefix ?? "INV-";
  $("sNextNum").value = s.next_invoice_number ?? 1;
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
  if (e.key === "Escape") document.querySelectorAll(".modal").forEach((m) => m.hidden = true);
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
