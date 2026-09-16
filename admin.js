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
const loginForm = $("loginForm");
const loginError = $("loginError");
const userEmail = $("userEmail");
const logoutBtn = $("logoutBtn");

// ===== Auth =====
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.hidden = true;
  const { error } = await sb.auth.signInWithPassword({
    email: $("email").value.trim(),
    password: $("password").value,
  });
  if (error) {
    loginError.textContent = error.message;
    loginError.hidden = false;
    return;
  }
  checkSession();
});

logoutBtn.addEventListener("click", async () => {
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

function showApp(user) {
  loginView.hidden = true;
  appView.hidden = false;
  userEmail.textContent = user.email;
  loadClients();
  loadProjects();
}

// ===== Tabs =====
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    $(tab.dataset.tab + "Panel").classList.add("active");
  });
});

// ===== Clients =====
let clients = [];
const clientsList = $("clientsList");

async function loadClients() {
  const { data, error } = await sb.from("clients").select("*").order("created_at", { ascending: false });
  if (error) return console.error(error);
  clients = data || [];
  renderClients();
}

function renderClients() {
  if (!clients.length) {
    clientsList.innerHTML = `<p class="empty">No clients yet. Add your first one.</p>`;
    return;
  }
  clientsList.innerHTML = clients.map((c) => `
    <div class="card-item">
      <h3>${esc(c.name)}</h3>
      <div class="card-meta">
        ${c.company ? `<span>${esc(c.company)}</span>` : ""}
        ${c.email ? `<span><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></span>` : ""}
        ${c.phone ? `<span>${esc(c.phone)}</span>` : ""}
      </div>
      <span class="badge ${c.status}">${label(c.status)}</span>
      ${c.notes ? `<p class="card-meta" style="margin-top:10px">${esc(c.notes)}</p>` : ""}
      <div class="card-actions">
        <button class="btn btn-ghost btn-sm" data-edit-client="${c.id}">Edit</button>
        <button class="btn btn-ghost btn-sm" data-del-client="${c.id}">Delete</button>
      </div>
    </div>`).join("");
}

clientsList.addEventListener("click", async (e) => {
  const editId = e.target.dataset.editClient;
  const delId = e.target.dataset.delClient;
  if (editId) openClientModal(clients.find((c) => c.id === editId));
  if (delId) {
    if (!confirm("Delete this client and their projects?")) return;
    const { error } = await sb.from("clients").delete().eq("id", delId);
    if (error) return alert(error.message);
    loadClients(); loadProjects();
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
    status: $("cStatus").value,
    notes: $("cNotes").value.trim() || null,
  };
  const { error } = id
    ? await sb.from("clients").update(payload).eq("id", id)
    : await sb.from("clients").insert(payload);
  if (error) return alert(error.message);
  $("clientModal").hidden = true;
  loadClients();
});

// ===== Projects =====
let projects = [];
const projectsList = $("projectsList");

async function loadProjects() {
  const { data, error } = await sb.from("projects").select("*, clients(name)").order("created_at", { ascending: false });
  if (error) return console.error(error);
  projects = data || [];
  renderProjects();
}

function renderProjects() {
  if (!projects.length) {
    projectsList.innerHTML = `<p class="empty">No projects yet. Add your first one.</p>`;
    return;
  }
  projectsList.innerHTML = projects.map((p) => `
    <div class="card-item">
      <h3>${esc(p.title)}</h3>
      <div class="card-meta">
        <span>${p.clients ? esc(p.clients.name) : "No client"}</span>
        ${p.type ? `<span>${label(p.type)}</span>` : ""}
        ${p.budget ? `<span>£${Number(p.budget).toLocaleString()}</span>` : ""}
        ${p.due_date ? `<span>Due ${p.due_date}</span>` : ""}
      </div>
      <span class="badge ${p.status}">${label(p.status)}</span>
      ${p.brief ? `<p class="card-meta" style="margin-top:10px">${esc(p.brief)}</p>` : ""}
      <div class="card-actions">
        <button class="btn btn-ghost btn-sm" data-edit-project="${p.id}">Edit</button>
        <button class="btn btn-ghost btn-sm" data-del-project="${p.id}">Delete</button>
      </div>
    </div>`).join("");
}

projectsList.addEventListener("click", async (e) => {
  const editId = e.target.dataset.editProject;
  const delId = e.target.dataset.delProject;
  if (editId) openProjectModal(projects.find((p) => p.id === editId));
  if (delId) {
    if (!confirm("Delete this project?")) return;
    const { error } = await sb.from("projects").delete().eq("id", delId);
    if (error) return alert(error.message);
    loadProjects();
  }
});

$("addProjectBtn").addEventListener("click", () => openProjectModal());

function openProjectModal(p = null) {
  $("projectModalTitle").textContent = p ? "Edit project" : "Add project";
  $("projectId").value = p?.id || "";
  $("pTitle").value = p?.title || "";
  $("pType").value = p?.type || "";
  $("pStatus").value = p?.status || "planning";
  $("pBudget").value = p?.budget || "";
  $("pDue").value = p?.due_date || "";
  $("pBrief").value = p?.brief || "";
  // populate client dropdown
  const sel = $("pClient");
  sel.innerHTML = `<option value="">—</option>` +
    clients.map((c) => `<option value="${c.id}" ${p?.client_id === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("");
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
  loadProjects();
});

// ===== Modal close =====
document.querySelectorAll("[data-close]").forEach((b) =>
  b.addEventListener("click", () => {
    $("clientModal").hidden = true;
    $("projectModal").hidden = true;
  })
);
document.querySelectorAll(".modal").forEach((m) =>
  m.addEventListener("click", (e) => { if (e.target === m) m.hidden = true; })
);

// ===== Helpers =====
function esc(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, (ch) => "&#" + ch.charCodeAt(0) + ";");
}
function label(s) {
  return (s || "").replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

// ===== Init =====
checkSession();
