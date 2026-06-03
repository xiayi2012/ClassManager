const APP_NAME = "班级点名小助手";

const $ = (selector) => document.querySelector(selector);
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const nowIso = () => new Date().toISOString();
const fmt = (iso) => iso ? new Date(iso).toLocaleString("zh-CN", { hour12: false }) : "";
const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (s) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#39;",
}[s]));

let state = {
  view: "home",
  classes: [],
  students: [],
  sessions: [],
  activeClassId: null,
  activeSessionId: null,
  activeStudentId: null,
  query: "",
  sessionFilter: "uncalled",
  modal: null,
  toast: "",
};

let saveQueue = Promise.resolve();

async function loadData() {
  const response = await fetch("./api/data", { cache: "no-store" });
  if (!response.ok) throw new Error("数据文件读取失败");
  const data = await response.json();
  state.classes = Array.isArray(data.classes) ? data.classes : [];
  state.students = Array.isArray(data.students) ? data.students : [];
  state.sessions = Array.isArray(data.sessions) ? data.sessions : [];
  normalizeSessions();
  sortData();
}

function normalizeSessions() {
  state.sessions = state.sessions.map((session) => ({
    name: session.name || `${classById(session.classId)?.name || "班级"} 点名`,
    status: session.status || "draft",
    startedAt: session.startedAt || nowIso(),
    updatedAt: session.updatedAt || session.startedAt || nowIso(),
    ...session,
    records: Array.isArray(session.records) ? session.records.map((record) => ({
      status: record.status === "called" ? "called" : "uncalled",
      calledAt: record.calledAt || "",
      ...record,
    })) : [],
  }));
}

function sortData() {
  state.classes.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  state.students.sort(compareStudents);
  state.sessions.sort((a, b) => (b.updatedAt || b.startedAt || "").localeCompare(a.updatedAt || a.startedAt || ""));
}

async function saveData() {
  saveQueue = saveQueue.catch(() => {}).then(async () => {
    const response = await fetch("./api/data", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        classes: state.classes,
        students: state.students,
        sessions: state.sessions,
      }),
    });
    if (!response.ok) throw new Error("数据文件保存失败");
  });
  return saveQueue;
}

async function put(store, value) {
  const list = state[store];
  const index = list.findIndex((item) => item.id === value.id);
  if (index >= 0) list[index] = value;
  else list.push(value);
  sortData();
  await saveData();
  return value;
}

async function del(store, id) {
  state[store] = state[store].filter((item) => item.id !== id);
  await saveData();
}

function compareStudents(a, b) {
  const order = (a.order ?? 0) - (b.order ?? 0);
  if (order) return order;
  return (a.name || "").localeCompare(b.name || "", "zh-Hans-CN");
}

function classById(id) {
  return state.classes.find((item) => item.id === id);
}

function classStudents(classId = state.activeClassId) {
  return state.students.filter((student) => student.classId === classId).sort(compareStudents);
}

function activeSession() {
  return state.sessions.find((session) => session.id === state.activeSessionId);
}

function sessionClass(session = activeSession()) {
  return session ? classById(session.classId) : null;
}

function showToast(message) {
  state.toast = message;
  render();
  setTimeout(() => {
    if (state.toast === message) {
      state.toast = "";
      render();
    }
  }, 2000);
}

function render() {
  $("#app").innerHTML = `
    <div class="app-shell">
      ${renderTopbar()}
      ${state.view === "home" ? renderHome() : ""}
      ${state.view === "records" ? renderRecords() : ""}
      ${state.view === "classes" ? renderClasses() : ""}
      ${state.view === "class" ? renderClass() : ""}
      ${state.view === "classEditor" ? renderClassEditor() : ""}
      ${state.view === "studentEditor" ? renderStudentEditor() : ""}
      ${state.view === "rollcall" ? renderRollcall() : ""}
      ${state.view === "profile" ? renderProfile() : ""}
      ${renderBottomNav()}
      ${state.modal ? renderModal() : ""}
      ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ""}
    </div>
  `;
  bindEvents();
}

function renderTopbar() {
  return `
    <header class="topbar">
      <div class="brand" role="button" data-action="home">
        <div class="brand-mark">点</div>
        <div>
          <h1>${APP_NAME}</h1>
          <p>名单管理、点名记录、自动保存</p>
        </div>
      </div>
    </header>
  `;
}

function renderHome() {
  const totalStudents = state.students.length;
  const totalSessions = state.sessions.length;
  const latest = state.sessions[0];
  return `
    <main class="main-grid home-grid">
      <section class="panel">
        <div class="panel-header">
          <h2>首页</h2>
        </div>
        <div class="panel-body form-grid">
          <div class="native-summary">
            <div><b>${state.classes.length}</b><span>班级</span></div>
            <div><b>${totalStudents}</b><span>学生</span></div>
            <div><b>${totalSessions}</b><span>点名</span></div>
          </div>
          <button class="btn primary home-action" data-action="new-rollcall">新建点名</button>
          ${latest ? `
            <article class="history-card clickable-card" data-action="open-rollcall" data-id="${latest.id}">
              <h3>最近点名：${escapeHtml(latest.name || "未命名点名")}</h3>
              <div class="meta">${fmt(latest.updatedAt || latest.startedAt)}</div>
            </article>
          ` : `<div class="notice">先到班级列表创建班级和名单，再新建点名。</div>`}
        </div>
      </section>
    </main>
  `;
}

function renderRecords() {
  return `
    <main class="main-grid home-grid">
      <section class="panel">
        <div class="panel-header">
          <h2>点名记录</h2>
          <button class="btn primary compact-cta" data-action="new-rollcall">新建点名</button>
        </div>
        <div class="panel-body">
          <div class="history-list">
            ${state.sessions.map(renderSessionCard).join("") || renderEmpty("暂无点名记录", "先新建班级和名单，再新建点名。")}
          </div>
        </div>
      </section>
    </main>
  `;
}

function renderProfile() {
  return `
    <main class="panel">
      <div class="panel-header"><h2>我的</h2></div>
      <div class="panel-body form-grid">
        <div class="native-profile">
          <div class="brand-mark">点</div>
          <div>
            <h3>${APP_NAME}</h3>
            <div class="meta">数据保存在服务器文件 data/app-data.json</div>
          </div>
        </div>
        <div class="notice">当前版本专注班级名单和课堂点名。后续可以继续加账号、导出、权限等功能。</div>
      </div>
    </main>
  `;
}

function renderBottomNav() {
  const active = (view) => state.view === view ? "active" : "";
  return `
    <nav class="bottom-nav" aria-label="主导航">
      <button class="${active("home")}" data-action="home"><span>⌂</span><b>首页</b></button>
      <button class="${active("records")}" data-action="open-records"><span>≡</span><b>点名记录</b></button>
      <button class="nav-create" data-action="new-rollcall"><span>＋</span><b>新建点名</b></button>
      <button class="${active("classes") || active("classEditor") || active("studentEditor")}" data-action="open-classes"><span>▦</span><b>班级列表</b></button>
      <button class="${active("profile")}" data-action="open-profile"><span>○</span><b>我的</b></button>
    </nav>
  `;
}

function renderClasses() {
  return `
    <main class="panel">
      <div class="panel-header">
        <h2>班级列表</h2>
        <div class="card-actions">
          <button class="btn ghost small" data-action="home">返回点名</button>
          <button class="btn primary compact-cta" data-action="new-class">新建班级</button>
        </div>
      </div>
      <div class="panel-body">
        <div class="class-list">
          ${state.classes.map(renderClassAdminCard).join("") || renderEmpty("还没有班级", "点击“新建班级”创建第一个班级。")}
        </div>
      </div>
    </main>
  `;
}

function renderClassAdminCard(klass) {
  const count = classStudents(klass.id).length;
  const rollcallCount = state.sessions.filter((session) => session.classId === klass.id).length;
  return `
    <article class="class-card clickable-card" data-action="edit-class-list" data-id="${klass.id}">
      <div>
        <h3>${escapeHtml(klass.name)}</h3>
        <div class="meta">${escapeHtml(klass.course || "未填写课程")} · ${count} 名学生 · ${rollcallCount} 条点名</div>
        ${klass.note ? `<div class="meta">${escapeHtml(klass.note)}</div>` : ""}
      </div>
    </article>
  `;
}

function renderClassCard(klass) {
  const count = classStudents(klass.id).length;
  return `
    <article class="class-card">
      <div>
        <h3>${escapeHtml(klass.name)}</h3>
        <div class="meta">${escapeHtml(klass.course || "未填写课程")} · ${count} 名学生</div>
        ${klass.note ? `<div class="meta">${escapeHtml(klass.note)}</div>` : ""}
      </div>
      <div class="card-actions">
        <button class="btn small" data-action="open-class" data-id="${klass.id}">管理名单</button>
        <button class="btn primary small" data-action="new-rollcall-for-class" data-id="${klass.id}">新建点名</button>
      </div>
    </article>
  `;
}

function renderSessionCard(session) {
  const klass = classById(session.classId);
  const total = session.records.length;
  const called = session.records.filter((record) => record.status === "called").length;
  return `
    <article class="history-card clickable-card" data-action="open-rollcall" data-id="${session.id}">
      <h3>${escapeHtml(session.name || "未命名点名")}</h3>
      <div class="meta">${escapeHtml(klass?.name || "班级已删除")} · ${called}/${total} 已点 · ${fmt(session.updatedAt || session.startedAt)}</div>
    </article>
  `;
}

function renderClass() {
  return renderClassEditor();
}

function renderClassEditor() {
  const klass = classById(state.activeClassId);
  const isNew = !klass;
  const current = klass || { name: "", course: "", note: "" };
  const students = classStudents();
  return `
    <main class="panel editor-panel">
      <div class="panel-header">
        <h2>${isNew ? "新建班级" : "编辑班级"}</h2>
      </div>
      <div class="panel-body form-grid editor-body">
        <form class="form-grid" data-form="class-editor">
          <label>班级名称<input name="name" required value="${escapeHtml(current.name || "")}" placeholder="例如：高一 1 班" /></label>
          <label>课程名称<input name="course" value="${escapeHtml(current.course || "")}" placeholder="可选" /></label>
        </form>
        ${isNew ? `<div class="notice">保存班级后可以继续管理学生名单。</div>` : `
          <section>
            <div class="panel-header inline-header">
              <h3>学生名单</h3>
              <div class="card-actions">
                <button class="btn small" data-action="add-student">新增学生</button>
                <button class="btn small" data-action="import-students">导入名单</button>
              </div>
            </div>
            <div class="student-list">
              ${students.map(renderStudentCard).join("") || renderEmpty("名单为空", "可以导入名单，或手动新增学生。")}
            </div>
          </section>
          <section class="danger-zone">
            <button class="btn danger small" data-action="clear-students">清空名单</button>
            <button class="btn danger small" data-action="delete-class">删除班级</button>
          </section>
        `}
        <div class="editor-actions">
          <button class="btn ghost" data-action="open-classes">返回</button>
          <button class="btn primary" data-action="save-class-editor">保存</button>
        </div>
      </div>
    </main>
  `;
}

function renderOldClass() {
  const klass = classById(state.activeClassId);
  if (!klass) return "";
  const students = classStudents();
  return `
    <main class="main-grid">
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2>${escapeHtml(klass.name)}</h2>
            <div class="meta">${escapeHtml(klass.course || "未填写课程")} · ${students.length} 名学生</div>
          </div>
          <div class="card-actions">
            <button class="btn small" data-action="edit-class">编辑班级</button>
            <button class="btn primary small" data-action="new-rollcall-for-class" data-id="${klass.id}">新建点名</button>
          </div>
        </div>
        <div class="panel-body">
          <div class="toolbar" style="justify-content:flex-start;margin-bottom:12px">
            <button class="btn small" data-action="add-student">新增学生</button>
            <button class="btn small" data-action="import-students">导入名单</button>
            <button class="btn danger small" data-action="clear-students">清空名单</button>
          </div>
          <div class="two-cols" style="margin-bottom:12px">
            <input data-role="student-search" value="${escapeHtml(state.query)}" placeholder="搜索姓名或学号" />
          </div>
          <div class="student-list">
            ${students.filter(matchStudentQuery).map(renderStudentCard).join("") || renderEmpty("名单为空", "可以导入名单，或手动新增学生。")}
          </div>
        </div>
      </section>
      <aside class="side-stack">
        <section class="panel">
          <div class="panel-header"><h3>本班点名</h3></div>
          <div class="panel-body history-list">
            ${state.sessions.filter((session) => session.classId === klass.id).slice(0, 8).map(renderSessionCard).join("") || `<div class="meta">暂无点名记录。</div>`}
          </div>
        </section>
        <section class="panel">
          <div class="panel-header"><h3>危险操作</h3></div>
          <div class="panel-body"><button class="btn danger" data-action="delete-class">删除班级</button></div>
        </section>
      </aside>
    </main>
  `;
}

function matchStudentQuery(student) {
  const query = state.query.trim().toLowerCase();
  if (!query) return true;
  return `${student.name} ${student.studentNo || ""}`.toLowerCase().includes(query);
}

function renderStudentCard(student) {
  return `
    <article class="student-card clickable-card" draggable="true" data-student-id="${student.id}" data-action="edit-student" data-id="${student.id}">
      <div class="drag-handle" title="拖拽排序">☰</div>
      <div class="student-main">
        <h3>${escapeHtml(student.name)}</h3>
        <div class="meta">学号：${escapeHtml(student.studentNo || "未填写")}</div>
      </div>
    </article>
  `;
}

function renderStudentEditor() {
  const student = state.students.find((item) => item.id === state.activeStudentId);
  const isNew = !student;
  const current = student || { name: "", studentNo: "" };
  return `
    <main class="panel editor-panel">
      <div class="panel-header">
        <h2>${isNew ? "新增学生" : "编辑学生"}</h2>
      </div>
      <div class="panel-body form-grid editor-body">
        <form class="form-grid" data-form="student-editor">
          <label>姓名<input name="name" required value="${escapeHtml(current.name || "")}" /></label>
          <label>学号<input name="studentNo" value="${escapeHtml(current.studentNo || "")}" /></label>
        </form>
        ${isNew ? "" : `<section class="danger-zone"><button class="btn danger small" data-action="delete-student-editor">删除学生</button></section>`}
        <div class="editor-actions">
          <button class="btn ghost" data-action="open-class" data-id="${state.activeClassId}">返回</button>
          <button class="btn primary" data-action="save-student-editor">保存</button>
        </div>
      </div>
    </main>
  `;
}

function renderRollcall() {
  const session = activeSession();
  const klass = sessionClass(session);
  if (!session || !klass) return "";

  const rows = session.records
    .map((record) => ({ ...record, student: state.students.find((student) => student.id === record.studentId) }))
    .filter((row) => row.student)
    .filter((row) => state.sessionFilter === "all" || row.status === "uncalled");

  const total = session.records.length;
  const called = session.records.filter((record) => record.status === "called").length;
  const uncalled = total - called;

  return `
    <main class="panel rollcall-panel">
      <div class="panel-header">
        <div>
          <h2>${escapeHtml(session.name)}</h2>
          <div class="meta">${escapeHtml(klass.name)} · 自动保存</div>
        </div>
      </div>
      <div class="panel-body session-head compact-session">
        <div class="mini-stats">
          <span><b>${uncalled}</b> 未点</span>
          <span><b>${called}</b> 已点</span>
          <span><b>${total}</b> 总数</span>
        </div>
        <div class="filters rollcall-tabs">
          <button class="chip ${state.sessionFilter === "uncalled" ? "active" : ""}" data-action="filter-uncalled">未点名</button>
          <button class="chip ${state.sessionFilter === "all" ? "active" : ""}" data-action="filter-all">全部名单</button>
        </div>
        <div class="student-list rollcall-list">
          ${rows.map(renderRollcallStudent).join("") || renderEmpty("当前没有学生", state.sessionFilter === "uncalled" ? "未点名名单已经清空。" : "没有匹配的学生。")}
        </div>
        <div class="rollcall-actions">
          <button class="btn ghost" data-action="open-class" data-id="${klass.id}">返回班级</button>
          <button class="btn primary" data-action="save-rollcall">保存</button>
        </div>
      </div>
    </main>
  `;
}

function renderRollcallStudent(row) {
  const pillClass = row.status === "called" ? "status-called" : "status-unmarked";
  const label = row.status === "called" ? `已点名 · ${fmt(row.calledAt)}` : "点击名字后从未点名列表消失";
  return `
    <article class="student-card rollcall-student" data-action="${row.status === "called" ? "undo-call" : "call-student"}" data-id="${row.studentId}">
      <div class="student-main">
        <h3>${escapeHtml(row.student.name)}</h3>
        <div class="meta">学号：${escapeHtml(row.student.studentNo || "未填写")}</div>
      </div>
      <span class="status-pill ${pillClass}">${row.status === "called" ? "已点" : "未点"}</span>
    </article>
  `;
}

function renderEmpty(title, body) {
  return `<div class="empty"><div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(body)}</span></div></div>`;
}

function renderModal() {
  const body = {
    class: renderClassModal,
    student: renderStudentModal,
    import: renderImportModal,
    rollcall: renderRollcallModal,
  }[state.modal.type]?.() || "";
  return `<div class="modal-backdrop" data-action="close-modal"><section class="modal" onclick="event.stopPropagation()">${body}</section></div>`;
}

function renderClassModal() {
  const klass = state.modal.klass || {};
  return `
    <div class="panel-header"><h3>${klass.id ? "编辑班级" : "新建班级"}</h3><button class="btn ghost small" data-action="close-modal">关闭</button></div>
    <form class="panel-body form-grid" data-form="class">
      <label>班级名称<input name="name" required value="${escapeHtml(klass.name || "")}" placeholder="例如：高一 1 班" /></label>
      <label>课程名称<input name="course" value="${escapeHtml(klass.course || "")}" placeholder="可选" /></label>
      <label>备注<textarea name="note" placeholder="可选">${escapeHtml(klass.note || "")}</textarea></label>
      <button class="btn primary" type="submit">保存并进入班级</button>
    </form>
  `;
}

function renderStudentModal() {
  const student = state.modal.student || {};
  return `
    <div class="panel-header"><h3>${student.id ? "编辑学生" : "新增学生"}</h3><button class="btn ghost small" data-action="close-modal">关闭</button></div>
    <form class="panel-body form-grid" data-form="student">
      <label>姓名<input name="name" required value="${escapeHtml(student.name || "")}" /></label>
      <label>学号<input name="studentNo" value="${escapeHtml(student.studentNo || "")}" /></label>
      <button class="btn primary" type="submit">保存</button>
    </form>
  `;
}

function renderImportModal() {
  return `
    <div class="panel-header"><h3>导入名单</h3><button class="btn ghost small" data-action="close-modal">关闭</button></div>
    <div class="panel-body form-grid">
      <div class="notice">支持 CSV、TXT 或直接粘贴。列名可用“姓名/名字/name”和“学号/座号/id”；无表头时默认第一列姓名、第二列学号。</div>
      <label>选择文件<input id="import-file" type="file" accept=".csv,.txt,text/csv,text/plain" /></label>
      <label>或粘贴名单<textarea id="paste-roster" placeholder="姓名,学号&#10;张三,001&#10;李四,002"></textarea></label>
      <button class="btn primary" data-action="run-import">导入到当前班级</button>
    </div>
  `;
}

function renderRollcallModal() {
  const presetClassId = state.modal.classId || state.activeClassId || "";
  return `
    <div class="panel-header"><h3>新建点名</h3><button class="btn ghost small" data-action="close-modal">关闭</button></div>
    <form class="panel-body form-grid" data-form="rollcall">
      <label>点名名称<input name="name" required placeholder="例如：第 3 周课堂点名" /></label>
      <label>选择班级
        <select name="classId" required>
          <option value="">请选择班级</option>
          ${state.classes.map((klass) => `<option value="${klass.id}" ${klass.id === presetClassId ? "selected" : ""}>${escapeHtml(klass.name)}</option>`).join("")}
        </select>
      </label>
      <button class="btn primary" type="submit">开始点名</button>
    </form>
  `;
}

function bindEvents() {
  document.querySelectorAll("[data-action]").forEach((el) => el.addEventListener("click", handleAction));
  document.querySelectorAll("form[data-form]").forEach((form) => form.addEventListener("submit", handleForm));

  const studentSearch = document.querySelector("[data-role='student-search']");
  if (studentSearch) studentSearch.addEventListener("input", (event) => {
    state.query = event.target.value;
    render();
  });

  bindDragSort();
}

async function handleAction(event) {
  const action = event.currentTarget.dataset.action;
  const id = event.currentTarget.dataset.id;

  if (action === "home") goHome();
  if (action === "open-records") openRecords();
  if (action === "open-profile") openProfile();
  if (action === "open-classes") openClasses();
  if (action === "new-class") openClassEditor(null);
  if (action === "edit-class") openClassEditor(state.activeClassId);
  if (action === "edit-class-list") openClassEditor(id);
  if (action === "open-class") openClass(id);
  if (action === "close-modal") { state.modal = null; render(); }
  if (action === "add-student") openStudentEditor(null);
  if (action === "edit-student") openStudentEditor(id);
  if (action === "delete-student") await deleteStudent(id);
  if (action === "delete-student-editor") await deleteStudentFromEditor();
  if (action === "clear-students") await clearStudents();
  if (action === "delete-class") await deleteClass();
  if (action === "delete-class-list") await deleteClassById(id, "classes");
  if (action === "import-students") { state.modal = { type: "import" }; render(); }
  if (action === "run-import") await importStudents();
  if (action === "new-rollcall") { state.modal = { type: "rollcall" }; render(); }
  if (action === "new-rollcall-for-class") { state.modal = { type: "rollcall", classId: id }; render(); }
  if (action === "open-rollcall") openRollcall(id);
  if (action === "delete-rollcall") await deleteRollcall(id);
  if (action === "call-student") await setStudentCalled(id, true);
  if (action === "undo-call") await setStudentCalled(id, false);
  if (action === "filter-uncalled") { state.sessionFilter = "uncalled"; render(); }
  if (action === "filter-all") { state.sessionFilter = "all"; render(); }
  if (action === "save-rollcall") await saveRollcall();
  if (action === "save-class-editor") await saveClassEditor();
  if (action === "save-student-editor") await saveStudentEditor();
}

async function handleForm(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget).entries());
  if (event.currentTarget.dataset.form === "class") await saveClass(data);
  if (event.currentTarget.dataset.form === "student") await saveStudent(data);
  if (event.currentTarget.dataset.form === "rollcall") await createRollcall(data);
  if (event.currentTarget.dataset.form === "class-editor") await saveClassEditor();
  if (event.currentTarget.dataset.form === "student-editor") await saveStudentEditor();
}

function goHome() {
  state.view = "home";
  state.activeClassId = null;
  state.activeSessionId = null;
  state.activeStudentId = null;
  state.query = "";
  state.modal = null;
  render();
}

function openRecords() {
  state.view = "records";
  state.activeClassId = null;
  state.activeSessionId = null;
  state.activeStudentId = null;
  state.query = "";
  state.modal = null;
  render();
}

function openProfile() {
  state.view = "profile";
  state.activeClassId = null;
  state.activeSessionId = null;
  state.activeStudentId = null;
  state.query = "";
  state.modal = null;
  render();
}

function openClasses() {
  state.view = "classes";
  state.activeClassId = null;
  state.activeSessionId = null;
  state.query = "";
  state.modal = null;
  render();
}

function openClass(id) {
  state.activeClassId = id;
  state.activeSessionId = null;
  state.activeStudentId = null;
  state.query = "";
  state.view = "classEditor";
  state.modal = null;
  render();
}

function openClassEditor(id) {
  state.activeClassId = id;
  state.activeSessionId = null;
  state.activeStudentId = null;
  state.query = "";
  state.view = "classEditor";
  state.modal = null;
  render();
}

function openStudentEditor(id) {
  state.activeStudentId = id;
  state.view = "studentEditor";
  state.modal = null;
  render();
}

function openRollcall(id) {
  const session = state.sessions.find((item) => item.id === id);
  if (!session) return;
  state.activeSessionId = id;
  state.activeClassId = session.classId;
  state.query = "";
  state.sessionFilter = "uncalled";
  state.view = "rollcall";
  state.modal = null;
  render();
}

async function saveClass(data) {
  const existing = state.modal.klass;
  const klass = {
    id: existing?.id || uid(),
    name: data.name.trim(),
    course: data.course.trim(),
    note: data.note.trim(),
    createdAt: existing?.createdAt || nowIso(),
    updatedAt: nowIso(),
  };
  await put("classes", klass);
  if (state.modal.returnView === "classes") {
    state.modal = null;
    openClasses();
  } else {
    openClass(klass.id);
  }
  showToast("班级已保存");
}

async function saveClassEditor() {
  const form = document.querySelector("[data-form='class-editor']");
  if (!form) return;
  if (!form.reportValidity()) return;
  const data = Object.fromEntries(new FormData(form).entries());
  const existing = classById(state.activeClassId);
  const klass = {
    id: existing?.id || uid(),
    name: data.name.trim(),
    course: data.course.trim(),
    note: existing?.note || "",
    createdAt: existing?.createdAt || nowIso(),
    updatedAt: nowIso(),
  };
  await put("classes", klass);
  state.activeClassId = klass.id;
  state.view = "classEditor";
  render();
  showToast("班级已保存");
}

async function saveStudent(data) {
  const existing = state.modal.student;
  const name = data.name.trim();
  const studentNo = data.studentNo.trim();
  if (studentNo && state.students.some((student) => student.classId === state.activeClassId && student.studentNo === studentNo && student.id !== existing?.id)) {
    alert("这个学号已经存在，请检查后再保存。");
    return;
  }
  const student = {
    id: existing?.id || uid(),
    classId: state.activeClassId,
    name,
    studentNo,
    order: existing?.order ?? classStudents().length,
    createdAt: existing?.createdAt || nowIso(),
    updatedAt: nowIso(),
  };
  await put("students", student);
  await touchClass(state.activeClassId);
  state.modal = null;
  render();
  showToast("学生已保存");
}

async function saveStudentEditor() {
  const form = document.querySelector("[data-form='student-editor']");
  if (!form) return;
  if (!form.reportValidity()) return;
  const data = Object.fromEntries(new FormData(form).entries());
  const existing = state.students.find((student) => student.id === state.activeStudentId);
  const name = data.name.trim();
  const studentNo = data.studentNo.trim();
  if (studentNo && state.students.some((student) => student.classId === state.activeClassId && student.studentNo === studentNo && student.id !== existing?.id)) {
    alert("这个学号已经存在，请检查后再保存。");
    return;
  }
  const student = {
    id: existing?.id || uid(),
    classId: state.activeClassId,
    name,
    studentNo,
    order: existing?.order ?? classStudents().length,
    createdAt: existing?.createdAt || nowIso(),
    updatedAt: nowIso(),
  };
  await put("students", student);
  await touchClass(state.activeClassId);
  state.activeStudentId = null;
  state.view = "classEditor";
  render();
  showToast("学生已保存");
}

async function deleteStudent(id) {
  if (!confirm("确定删除这个学生吗？已有点名记录会保留当时的姓名。")) return;
  await del("students", id);
  await touchClass(state.activeClassId);
  render();
}

async function deleteStudentFromEditor() {
  if (!state.activeStudentId) return;
  if (!confirm("确定删除这个学生吗？已有点名记录会保留当时的姓名。")) return;
  await del("students", state.activeStudentId);
  await touchClass(state.activeClassId);
  state.activeStudentId = null;
  state.view = "classEditor";
  render();
}

async function clearStudents() {
  if (!confirm("确定清空当前班级名单吗？已有点名记录不会删除。")) return;
  state.students = state.students.filter((student) => student.classId !== state.activeClassId);
  await saveData();
  await touchClass(state.activeClassId);
  render();
}

async function deleteClass() {
  await deleteClassById(state.activeClassId, "home");
}

async function deleteClassById(classId, returnView = "home") {
  if (!confirm("确定删除这个班级吗？学生名单和这个班级的点名记录都会删除。")) return;
  state.students = state.students.filter((student) => student.classId !== classId);
  state.sessions = state.sessions.filter((session) => session.classId !== classId);
  state.classes = state.classes.filter((klass) => klass.id !== classId);
  await saveData();
  if (returnView === "classes") openClasses();
  else goHome();
}

async function touchClass(classId) {
  const klass = classById(classId);
  if (!klass) return;
  klass.updatedAt = nowIso();
  await saveData();
}

async function importStudents() {
  const file = $("#import-file")?.files?.[0];
  const pasted = $("#paste-roster")?.value?.trim();
  const text = file ? await file.text() : pasted;
  const rows = parseTextRows(text || "");
  if (!rows.length) {
    alert("没有读到可导入的名单。");
    return;
  }

  const existingNos = new Set(classStudents().map((student) => student.studentNo).filter(Boolean));
  let added = 0;
  let skipped = 0;
  rows.forEach((row) => {
    const name = String(row.name || "").trim();
    const studentNo = String(row.studentNo || "").trim();
    if (!name || (studentNo && existingNos.has(studentNo))) {
      skipped += 1;
      return;
    }
    state.students.push({
      id: uid(),
      classId: state.activeClassId,
      name,
      studentNo,
      order: classStudents().length + added,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    if (studentNo) existingNos.add(studentNo);
    added += 1;
  });
  await saveData();
  await touchClass(state.activeClassId);
  state.modal = null;
  render();
  showToast(`导入 ${added} 人，跳过 ${skipped} 人`);
}

function parseTextRows(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  const rows = lines.map(splitRow);
  return normalizeRows(rows);
}

function splitRow(line) {
  const parts = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "\"") quoted = !quoted;
    else if (!quoted && /[,\t，]/.test(ch)) {
      parts.push(current.trim());
      current = "";
    } else current += ch;
  }
  parts.push(current.trim());
  return parts;
}

function normalizeRows(rows) {
  const header = rows[0].map((cell) => String(cell).trim().toLowerCase());
  const nameKeys = ["姓名", "名字", "name"];
  const noKeys = ["学号", "座号", "id", "studentno", "student no"];
  const hasHeader = header.some((cell) => nameKeys.includes(cell) || noKeys.includes(cell));
  const nameIndex = hasHeader ? header.findIndex((cell) => nameKeys.includes(cell)) : 0;
  const noIndex = hasHeader ? header.findIndex((cell) => noKeys.includes(cell)) : 1;
  return rows.slice(hasHeader ? 1 : 0).map((row) => ({
    name: row[nameIndex] || "",
    studentNo: noIndex >= 0 ? row[noIndex] || "" : "",
  })).filter((row) => row.name);
}

async function createRollcall(data) {
  const classId = data.classId;
  const students = classStudents(classId);
  if (!students.length) {
    alert("这个班级还没有学生，请先导入或新增学生。");
    return;
  }
  const session = {
    id: uid(),
    classId,
    name: data.name.trim(),
    status: "draft",
    startedAt: nowIso(),
    updatedAt: nowIso(),
    records: students.map((student) => ({
      studentId: student.id,
      nameSnapshot: student.name,
      noSnapshot: student.studentNo,
      status: "uncalled",
      calledAt: "",
    })),
  };
  await put("sessions", session);
  openRollcall(session.id);
  showToast("点名已创建");
}

async function setStudentCalled(studentId, called) {
  const session = activeSession();
  if (!session) return;
  const record = session.records.find((item) => item.studentId === studentId);
  if (!record) return;
  record.status = called ? "called" : "uncalled";
  record.calledAt = called ? nowIso() : "";
  session.updatedAt = nowIso();
  await saveData();
  render();
  showToast(called ? "已点名" : "已恢复为未点名");
}

async function saveRollcall() {
  const session = activeSession();
  if (!session) return;
  session.updatedAt = nowIso();
  await saveData();
  showToast("点名已保存");
}

async function deleteRollcall(id) {
  if (!confirm("确定删除这条点名记录吗？")) return;
  await del("sessions", id);
  if (state.activeSessionId === id) goHome();
  else render();
}

function bindDragSort() {
  let dragId = null;
  document.querySelectorAll(".student-card[draggable='true']").forEach((card) => {
    card.addEventListener("dragstart", () => { dragId = card.dataset.studentId; });
    card.addEventListener("dragover", (event) => event.preventDefault());
    card.addEventListener("drop", async () => {
      const targetId = card.dataset.studentId;
      if (!dragId || dragId === targetId) return;
      const students = classStudents();
      const from = students.findIndex((student) => student.id === dragId);
      const to = students.findIndex((student) => student.id === targetId);
      const [moved] = students.splice(from, 1);
      students.splice(to, 0, moved);
      students.forEach((student, order) => {
        student.order = order;
        student.updatedAt = nowIso();
      });
      await saveData();
      render();
    });
  });
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

try {
  await loadData();
  render();
} catch (error) {
  $("#app").innerHTML = `
    <div class="app-shell">
      <section class="panel">
        <div class="panel-header"><h2>数据服务未连接</h2></div>
        <div class="panel-body">
          <p>请确认已经通过 <code>npm run dev</code> 或服务器上的 Node 服务启动应用。</p>
          <p class="meta">${escapeHtml(error.message)}</p>
        </div>
      </section>
    </div>
  `;
}
