const LEGACY_DB_NAME = "class-companion-db";

const STATUS = [
  ["unmarked", "未点名"],
  ["called", "已点名"],
  ["leave", "请假"],
  ["late", "迟到"],
  ["absent", "缺席"],
  ["answered", "已回答"],
  ["correct", "回答正确"],
  ["wrong", "回答错误"],
];

const handledStatuses = new Set(["called", "leave", "late", "absent", "answered", "correct", "wrong"]);
const $ = (selector) => document.querySelector(selector);
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const nowIso = () => new Date().toISOString();
const fmt = (iso) => iso ? new Date(iso).toLocaleString("zh-CN", { hour12: false }) : "";
const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (s) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[s]));

let state = {
  view: "home",
  classes: [],
  students: [],
  sessions: [],
  activeClassId: null,
  activeSession: null,
  selectedHistory: null,
  filter: "all",
  query: "",
  modal: null,
  toast: "",
};
let saveQueue = Promise.resolve();

async function loadData() {
  const response = await fetch("./api/data", { cache: "no-store" });
  if (!response.ok) throw new Error("数据文件读取失败");
  const data = await response.json();
  const classes = Array.isArray(data.classes) ? data.classes : [];
  const students = Array.isArray(data.students) ? data.students : [];
  const sessions = Array.isArray(data.sessions) ? data.sessions : [];
  state.classes = classes.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  state.students = students.sort(compareStudents);
  state.sessions = sessions.sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || ""));
}

async function migrateLegacyBrowserDataIfNeeded() {
  if (state.classes.length || state.students.length || state.sessions.length || !("indexedDB" in window)) return;
  const legacy = await readLegacyIndexedDb().catch(() => null);
  if (!legacy) return;
  if (!legacy.classes.length && !legacy.students.length && !legacy.sessions.length) return;
  state.classes = legacy.classes.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  state.students = legacy.students.sort(compareStudents);
  state.sessions = legacy.sessions.sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || ""));
  await saveData();
}

function readLegacyIndexedDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LEGACY_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const legacyDb = request.result;
      if (!legacyDb.objectStoreNames.contains("classes")) legacyDb.createObjectStore("classes", { keyPath: "id" });
      if (!legacyDb.objectStoreNames.contains("students")) legacyDb.createObjectStore("students", { keyPath: "id" });
      if (!legacyDb.objectStoreNames.contains("sessions")) legacyDb.createObjectStore("sessions", { keyPath: "id" });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const legacyDb = request.result;
      const stores = ["classes", "students", "sessions"];
      const result = { classes: [], students: [], sessions: [] };
      const transaction = legacyDb.transaction(stores, "readonly");
      stores.forEach((store) => {
        const read = transaction.objectStore(store).getAll();
        read.onsuccess = () => { result[store] = read.result || []; };
      });
      transaction.oncomplete = () => {
        legacyDb.close();
        resolve(result);
      };
      transaction.onerror = () => {
        legacyDb.close();
        reject(transaction.error);
      };
    };
  });
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
  await saveData();
  return value;
}

async function del(store, id) {
  state[store] = state[store].filter((item) => item.id !== id);
  await saveData();
}

function compareStudents(a, b) {
  const byOrder = (a.order ?? 0) - (b.order ?? 0);
  if (byOrder) return byOrder;
  return (a.name || "").localeCompare(b.name || "", "zh-Hans-CN");
}

function classStudents(classId = state.activeClassId) {
  return state.students.filter((student) => student.classId === classId).sort(compareStudents);
}

function classSessions(classId = state.activeClassId) {
  return state.sessions.filter((session) => session.classId === classId).sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || ""));
}

function draftSession(classId) {
  return state.sessions.find((session) => session.classId === classId && session.status === "draft");
}

function statusLabel(key) {
  return STATUS.find(([id]) => id === key)?.[1] || "未点名";
}

function showToast(message) {
  state.toast = message;
  render();
  setTimeout(() => {
    if (state.toast === message) {
      state.toast = "";
      render();
    }
  }, 2200);
}

function render() {
  const app = $("#app");
  app.innerHTML = `
    <div class="app-shell">
      ${renderTopbar()}
      ${state.view === "home" ? renderHome() : ""}
      ${state.view === "class" ? renderClass() : ""}
      ${state.view === "session" ? renderSession() : ""}
      ${state.view === "history" ? renderHistory() : ""}
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
          <h1>班级小管家</h1>
          <p>离线保存，多班级点名与统计</p>
        </div>
      </div>
      <div class="toolbar">
        <button class="btn ghost" data-action="backup">导出备份</button>
        <button class="btn ghost" data-action="restore">恢复备份</button>
        <button class="btn primary" data-action="new-class">新建班级</button>
        <input class="hidden-file" id="restore-file" type="file" accept="application/json" />
      </div>
    </header>
  `;
}

function renderHome() {
  const cards = state.classes.map((klass) => {
    const students = classStudents(klass.id);
    const draft = draftSession(klass.id);
    return `
      <article class="class-card">
        <div>
          <h3>${escapeHtml(klass.name)}</h3>
          <div class="meta">${escapeHtml(klass.course || "未填写课程")} · ${students.length} 名学生 · ${draft ? "有未结束点名" : "暂无进行中点名"}</div>
          ${klass.note ? `<div class="meta">${escapeHtml(klass.note)}</div>` : ""}
        </div>
        <div class="card-actions">
          ${draft ? `<button class="btn primary small" data-action="continue-session" data-id="${klass.id}">继续</button>` : ""}
          <button class="btn small" data-action="open-class" data-id="${klass.id}">管理</button>
          <button class="btn small" data-action="start-session" data-id="${klass.id}">开始点名</button>
        </div>
      </article>
    `;
  }).join("");

  return `
    <main class="main-grid">
      <section class="panel">
        <div class="panel-header">
          <h2>班级列表</h2>
          <span class="meta">${state.classes.length} 个班级</span>
        </div>
        <div class="panel-body">
          <div class="class-list">${cards || renderEmpty("还没有班级", "先新建一个班级，再导入名单。")}</div>
        </div>
      </section>
      <aside class="side-stack">
        ${renderTodayBox()}
        <section class="panel">
          <div class="panel-header"><h3>小提示</h3></div>
          <div class="panel-body meta">数据保存在当前浏览器。建议定期导出备份 JSON，换设备或清缓存前先备份。</div>
        </section>
      </aside>
    </main>
  `;
}

function renderTodayBox() {
  const today = new Date().toISOString().slice(0, 10);
  const todaySessions = state.sessions.filter((session) => session.startedAt?.slice(0, 10) === today && session.status === "saved");
  return `
    <section class="panel">
      <div class="panel-header"><h3>今日</h3></div>
      <div class="panel-body">
        <div class="stats-row">
          <div class="stat"><b>${todaySessions.length}</b><span>已保存点名</span></div>
          <div class="stat"><b>${state.sessions.filter((s) => s.status === "draft").length}</b><span>未结束</span></div>
        </div>
      </div>
    </section>
  `;
}

function renderClass() {
  const klass = state.classes.find((item) => item.id === state.activeClassId);
  if (!klass) return "";
  const students = classStudents();
  const histories = classSessions().filter((session) => session.status === "saved");
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
            <button class="btn primary small" data-action="start-session" data-id="${klass.id}">开始点名</button>
          </div>
        </div>
        <div class="panel-body">
          <div class="toolbar" style="justify-content:flex-start;margin-bottom:12px">
            <button class="btn small" data-action="add-student">新增学生</button>
            <button class="btn small" data-action="import-students">导入名单</button>
            <button class="btn small" data-action="export-roster">导出名单</button>
            <button class="btn danger small" data-action="clear-students">清空名单</button>
          </div>
          <div class="student-list">${students.map(renderStudentManageCard).join("") || renderEmpty("名单为空", "支持 Excel、CSV 或直接粘贴名单。")}</div>
        </div>
      </section>
      <aside class="side-stack">
        ${renderStatsPanel(klass.id)}
        <section class="panel">
          <div class="panel-header">
            <h3>历史记录</h3>
            <button class="btn small" data-action="open-history">查看全部</button>
          </div>
          <div class="panel-body history-list">
            ${histories.slice(0, 4).map(renderHistoryCard).join("") || `<div class="meta">暂无历史记录。</div>`}
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

function renderStudentManageCard(student) {
  return `
    <article class="student-card" draggable="true" data-student-id="${student.id}">
      <div class="drag-handle" title="拖拽排序">☰</div>
      <div class="student-main">
        <h3>${escapeHtml(student.name)}</h3>
        <div class="meta">学号：${escapeHtml(student.studentNo || "未填写")}</div>
      </div>
      <div class="card-actions">
        <button class="btn small" data-action="edit-student" data-id="${student.id}">编辑</button>
        <button class="btn danger small" data-action="delete-student" data-id="${student.id}">删除</button>
      </div>
    </article>
  `;
}

function renderSession() {
  const klass = state.classes.find((item) => item.id === state.activeClassId);
  const session = state.activeSession;
  if (!klass || !session) return "";
  const rows = session.records.map((record) => ({ ...record, student: state.students.find((student) => student.id === record.studentId) })).filter((row) => row.student);
  const filtered = rows.filter((row) => {
    const text = `${row.student.name} ${row.student.studentNo || ""}`.toLowerCase();
    const statusOk = state.filter === "all" || row.status === state.filter;
    return statusOk && text.includes(state.query.toLowerCase());
  });
  return `
    <main class="panel">
      <div class="panel-header">
        <div>
          <h2>${escapeHtml(klass.name)} · 点名中</h2>
          <div class="meta">${escapeHtml(klass.course || "未填写课程")} · 开始时间 ${fmt(session.startedAt)} · 当前筛选 ${state.filter === "all" ? "全部" : statusLabel(state.filter)}</div>
        </div>
        <div class="card-actions">
          <button class="btn small" data-action="random-pick">随机抽人</button>
          <button class="btn small" data-action="undo" ${session.undo ? "" : "disabled"}>撤销</button>
          <button class="btn danger small" data-action="reset-session">重置</button>
          <button class="btn primary small" data-action="save-session">结束并保存</button>
          <button class="btn ghost small" data-action="discard-session">放弃</button>
        </div>
      </div>
      <div class="panel-body session-head">
        ${renderSessionStats(session)}
        <div class="two-cols">
          <input data-role="search" value="${escapeHtml(state.query)}" placeholder="搜索姓名或学号" />
          <select data-role="filter">${[`<option value="all">全部状态</option>`, ...STATUS.map(([id, label]) => `<option value="${id}" ${state.filter === id ? "selected" : ""}>${label}</option>`)].join("")}</select>
        </div>
        <div class="student-list">${filtered.map(renderSessionStudentCard).join("") || renderEmpty("没有匹配学生", "换个搜索词或筛选条件试试。")}</div>
      </div>
    </main>
  `;
}

function renderSessionStats(session) {
  const total = session.records.length;
  const handled = session.records.filter((r) => handledStatuses.has(r.status)).length;
  const unmarked = session.records.filter((r) => r.status === "unmarked").length;
  return `
    <div class="stats-row">
      <div class="stat"><b>${handled}</b><span>已处理</span></div>
      <div class="stat"><b>${total}</b><span>总人数</span></div>
      <div class="stat"><b>${unmarked}</b><span>未点名</span></div>
      <div class="stat"><b>${session.records.filter((r) => r.status === "absent").length}</b><span>缺席</span></div>
      <div class="stat"><b>${session.records.filter((r) => r.status === "correct").length}/${session.records.filter((r) => r.status === "wrong").length}</b><span>对 / 错</span></div>
    </div>
    <div class="filters">${["all", ...STATUS.map(([id]) => id)].map((id) => `<button class="chip ${state.filter === id ? "active" : ""}" data-action="set-filter" data-id="${id}">${id === "all" ? "全部" : statusLabel(id)}</button>`).join("")}</div>
  `;
}

function renderSessionStudentCard(row) {
  return `
    <article class="student-card" data-action="mark-student" data-id="${row.student.id}">
      <div></div>
      <div class="student-main">
        <h3>${escapeHtml(row.student.name)}</h3>
        <div class="meta">学号：${escapeHtml(row.student.studentNo || "未填写")}${row.note ? ` · 备注：${escapeHtml(row.note)}` : ""}</div>
      </div>
      <span class="status-pill status-${row.status}">${statusLabel(row.status)}</span>
    </article>
  `;
}

function renderHistory() {
  const klass = state.classes.find((item) => item.id === state.activeClassId);
  if (!klass) return "";
  const histories = classSessions().filter((session) => session.status === "saved");
  return `
    <main class="main-grid">
      <section class="panel">
        <div class="panel-header">
          <h2>${escapeHtml(klass.name)} · 历史记录</h2>
          <div class="card-actions">
            <button class="btn small" data-action="export-history-all">导出全部历史</button>
            <button class="btn small" data-action="open-class" data-id="${klass.id}">返回班级</button>
          </div>
        </div>
        <div class="panel-body history-list">
          ${histories.map(renderHistoryCard).join("") || renderEmpty("暂无历史", "保存一次点名后会出现在这里。")}
        </div>
      </section>
      <aside class="side-stack">
        ${renderStatsPanel(klass.id)}
      </aside>
    </main>
  `;
}

function renderHistoryCard(session) {
  const klass = state.classes.find((item) => item.id === session.classId);
  const unmarked = session.records.filter((r) => r.status === "unmarked").length;
  return `
    <article class="history-card">
      <h3>${escapeHtml(klass?.name || "班级")} · ${fmt(session.startedAt)}</h3>
      <div class="meta">结束：${fmt(session.endedAt)} · 未点名 ${unmarked} 人${session.updatedAt ? ` · 最后修改 ${fmt(session.updatedAt)}` : ""}</div>
      <div class="card-actions">
        <button class="btn small" data-action="edit-history" data-id="${session.id}">查看/编辑</button>
        <button class="btn small" data-action="export-history" data-id="${session.id}">导出</button>
        <button class="btn danger small" data-action="delete-history" data-id="${session.id}">删除</button>
      </div>
    </article>
  `;
}

function renderStatsPanel(classId) {
  const saved = state.sessions.filter((session) => session.classId === classId && session.status === "saved");
  const totals = Object.fromEntries(STATUS.map(([id]) => [id, 0]));
  saved.forEach((session) => session.records.forEach((record) => totals[record.status] = (totals[record.status] || 0) + 1));
  return `
    <section class="panel">
      <div class="panel-header"><h3>统计</h3><span class="meta">${saved.length} 次点名</span></div>
      <div class="panel-body">
        <div class="stats-row">
          <div class="stat"><b>${totals.called + totals.answered + totals.correct + totals.wrong}</b><span>叫到/回答</span></div>
          <div class="stat"><b>${totals.absent}</b><span>缺席</span></div>
          <div class="stat"><b>${totals.late}</b><span>迟到</span></div>
          <div class="stat"><b>${totals.leave}</b><span>请假</span></div>
        </div>
        <button class="btn small" style="margin-top:10px" data-action="student-stats">学生详情统计</button>
      </div>
    </section>
  `;
}

function renderEmpty(title, body) {
  return `<div class="empty"><div><strong>${title}</strong><span>${body}</span></div></div>`;
}

function renderModal() {
  const modal = state.modal;
  const body = {
    class: renderClassModal,
    student: renderStudentModal,
    import: renderImportModal,
    mark: renderMarkModal,
    random: renderRandomModal,
    historyEdit: renderHistoryEditModal,
    studentStats: renderStudentStatsModal,
  }[modal.type]?.() || "";
  return `<div class="modal-backdrop" data-action="close-modal"><section class="modal" onclick="event.stopPropagation()">${body}</section></div>`;
}

function renderClassModal() {
  const klass = state.modal.klass || {};
  return `
    <div class="panel-header"><h3>${klass.id ? "编辑班级" : "新建班级"}</h3><button class="btn ghost small" data-action="close-modal">关闭</button></div>
    <form class="panel-body form-grid" data-form="class">
      <label>班级名称<input name="name" required value="${escapeHtml(klass.name || "")}" placeholder="例如：高一 1 班" /></label>
      <label>课程名称<input name="course" value="${escapeHtml(klass.course || "")}" placeholder="例如：语文" /></label>
      <label>老师备注<textarea name="note" placeholder="可选">${escapeHtml(klass.note || "")}</textarea></label>
      <button class="btn primary" type="submit">保存</button>
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
      <div class="notice">支持 CSV、TXT、粘贴名单，以及常见 .xlsx。列名可用“姓名/名字/name”和“学号/座号/id”；无表头时默认第一列姓名、第二列学号。</div>
      <label>选择文件<input id="import-file" type="file" accept=".xlsx,.csv,.txt,text/csv,text/plain" /></label>
      <label>或粘贴名单<textarea id="paste-roster" placeholder="姓名,学号&#10;张三,001&#10;李四,002"></textarea></label>
      <button class="btn primary" data-action="run-import">导入到当前班级</button>
    </div>
  `;
}

function renderMarkModal() {
  const row = state.modal.row;
  const student = state.students.find((item) => item.id === row.studentId);
  return `
    <div class="panel-header"><h3>${escapeHtml(student?.name || "学生")}</h3><button class="btn ghost small" data-action="close-modal">关闭</button></div>
    <div class="panel-body form-grid">
      <div class="status-grid">${STATUS.filter(([id]) => id !== "unmarked").map(([id, label]) => `<button class="btn ${row.status === id ? "primary" : ""}" data-action="apply-status" data-id="${id}">${label}</button>`).join("")}</div>
      <button class="btn ghost" data-action="apply-status" data-id="unmarked">改回未点名</button>
      <label>备注<textarea id="mark-note">${escapeHtml(row.note || "")}</textarea></label>
      <button class="btn primary" data-action="save-note-only">保存备注</button>
    </div>
  `;
}

function renderRandomModal() {
  const student = state.modal.student;
  return `
    <div class="panel-header"><h3>随机抽到</h3><button class="btn ghost small" data-action="close-modal">关闭</button></div>
    <div class="panel-body form-grid" style="text-align:center">
      <div style="font-size:34px;font-weight:850">${escapeHtml(student.name)}</div>
      <div class="meta">学号：${escapeHtml(student.studentNo || "未填写")}</div>
      <div class="card-actions" style="justify-content:center">
        <button class="btn" data-action="random-pick">换一个</button>
        <button class="btn primary" data-action="mark-student" data-id="${student.id}">标记状态</button>
        <button class="btn ghost" data-action="close-modal">关闭</button>
      </div>
    </div>
  `;
}

function renderHistoryEditModal() {
  const session = state.modal.session;
  return `
    <div class="panel-header"><h3>编辑历史 · ${fmt(session.startedAt)}</h3><button class="btn ghost small" data-action="close-modal">关闭</button></div>
    <div class="panel-body form-grid">
      ${session.records.map((record, index) => {
        const student = state.students.find((item) => item.id === record.studentId) || { name: record.nameSnapshot, studentNo: record.noSnapshot };
        return `
          <div class="class-card">
            <div>
              <h3>${escapeHtml(student.name)}</h3>
              <div class="meta">学号：${escapeHtml(student.studentNo || record.noSnapshot || "未填写")}</div>
            </div>
            <div class="form-grid">
              <select data-history-status="${index}">${STATUS.map(([id, label]) => `<option value="${id}" ${record.status === id ? "selected" : ""}>${label}</option>`).join("")}</select>
              <input data-history-note="${index}" value="${escapeHtml(record.note || "")}" placeholder="备注" />
            </div>
          </div>
        `;
      }).join("")}
      <button class="btn primary" data-action="save-history-edit">保存修改</button>
    </div>
  `;
}

function renderStudentStatsModal() {
  const classId = state.activeClassId;
  const rows = classStudents(classId).map((student) => {
    const stats = Object.fromEntries(STATUS.map(([id]) => [id, 0]));
    state.sessions.filter((s) => s.classId === classId && s.status === "saved").forEach((session) => {
      const record = session.records.find((r) => r.studentId === student.id);
      if (record) stats[record.status] += 1;
    });
    return { student, stats };
  });
  return `
    <div class="panel-header"><h3>学生详情统计</h3><button class="btn ghost small" data-action="close-modal">关闭</button></div>
    <div class="panel-body history-list">
      ${rows.map(({ student, stats }) => `
        <div class="class-card">
          <div><h3>${escapeHtml(student.name)}</h3><div class="meta">学号：${escapeHtml(student.studentNo || "未填写")}</div></div>
          <div class="meta">叫到 ${stats.called + stats.answered + stats.correct + stats.wrong} · 缺席 ${stats.absent} · 迟到 ${stats.late} · 请假 ${stats.leave} · 对/错 ${stats.correct}/${stats.wrong}</div>
        </div>
      `).join("") || renderEmpty("暂无学生", "导入名单后会生成统计。")}
    </div>
  `;
}

function bindEvents() {
  document.querySelectorAll("[data-action]").forEach((el) => el.addEventListener("click", handleAction));
  document.querySelectorAll("form[data-form]").forEach((form) => form.addEventListener("submit", handleForm));
  const search = document.querySelector("[data-role='search']");
  if (search) search.addEventListener("input", (event) => { state.query = event.target.value; render(); });
  const filter = document.querySelector("[data-role='filter']");
  if (filter) filter.addEventListener("change", (event) => { state.filter = event.target.value; render(); });
  bindDragSort();
  const restore = $("#restore-file");
  if (restore) restore.addEventListener("change", restoreBackup);
}

async function handleAction(event) {
  const action = event.currentTarget.dataset.action;
  const id = event.currentTarget.dataset.id;
  if (action === "home") { state.view = "home"; state.activeClassId = null; render(); }
  if (action === "new-class") { state.modal = { type: "class" }; render(); }
  if (action === "edit-class") { state.modal = { type: "class", klass: state.classes.find((k) => k.id === state.activeClassId) }; render(); }
  if (action === "open-class") { state.activeClassId = id; state.view = "class"; state.modal = null; render(); }
  if (action === "close-modal") { state.modal = null; render(); }
  if (action === "add-student") { state.modal = { type: "student" }; render(); }
  if (action === "edit-student") { state.modal = { type: "student", student: state.students.find((s) => s.id === id) }; render(); }
  if (action === "delete-student") await deleteStudent(id);
  if (action === "clear-students") await clearStudents();
  if (action === "delete-class") await deleteClass();
  if (action === "import-students") { state.modal = { type: "import" }; render(); }
  if (action === "run-import") await importStudents();
  if (action === "export-roster") exportRoster();
  if (action === "start-session") await startSession(id || state.activeClassId);
  if (action === "continue-session") await continueSession(id);
  if (action === "mark-student") openMarkModal(id);
  if (action === "apply-status") await applyStatus(id);
  if (action === "save-note-only") await saveNoteOnly();
  if (action === "set-filter") { state.filter = id; render(); }
  if (action === "undo") await undo();
  if (action === "reset-session") await resetSession();
  if (action === "save-session") await saveSession();
  if (action === "discard-session") await discardSession();
  if (action === "random-pick") randomPick();
  if (action === "open-history") { state.view = "history"; render(); }
  if (action === "edit-history") openHistoryEdit(id);
  if (action === "save-history-edit") await saveHistoryEdit();
  if (action === "delete-history") await deleteHistory(id);
  if (action === "export-history") exportHistory(id);
  if (action === "export-history-all") exportAllHistory();
  if (action === "student-stats") { state.modal = { type: "studentStats" }; render(); }
  if (action === "backup") exportBackup();
  if (action === "restore") $("#restore-file")?.click();
}

async function handleForm(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget).entries());
  if (event.currentTarget.dataset.form === "class") await saveClass(data);
  if (event.currentTarget.dataset.form === "student") await saveStudent(data);
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
  await loadData();
  state.activeClassId = klass.id;
  state.view = "class";
  state.modal = null;
  showToast("班级已保存");
}

async function saveStudent(data) {
  const existing = state.modal.student;
  const studentNo = data.studentNo.trim();
  if (studentNo && state.students.some((s) => s.classId === state.activeClassId && s.studentNo === studentNo && s.id !== existing?.id)) {
    alert("这个学号已经存在，请检查后再保存。");
    return;
  }
  if (state.students.some((s) => s.classId === state.activeClassId && s.name === data.name.trim() && s.id !== existing?.id)) {
    if (!confirm("这个姓名已经存在，仍然保存吗？")) return;
  }
  const student = {
    id: existing?.id || uid(),
    classId: state.activeClassId,
    name: data.name.trim(),
    studentNo,
    order: existing?.order ?? classStudents().length,
    createdAt: existing?.createdAt || nowIso(),
    updatedAt: nowIso(),
  };
  await put("students", student);
  await loadData();
  state.modal = null;
  showToast("学生已保存");
}

async function deleteStudent(id) {
  if (!confirm("确定删除这个学生吗？历史记录会保留当时的姓名快照。")) return;
  await del("students", id);
  await loadData();
  render();
}

async function clearStudents() {
  if (!confirm("确定清空当前班级名单吗？这个操作不会删除历史记录。")) return;
  await Promise.all(classStudents().map((s) => del("students", s.id)));
  await loadData();
  render();
}

async function deleteClass() {
  if (!confirm("确定删除这个班级吗？名单和历史记录也会一起删除。")) return;
  const classId = state.activeClassId;
  await Promise.all([
    ...state.students.filter((s) => s.classId === classId).map((s) => del("students", s.id)),
    ...state.sessions.filter((s) => s.classId === classId).map((s) => del("sessions", s.id)),
    del("classes", classId),
  ]);
  await loadData();
  state.view = "home";
  state.activeClassId = null;
  render();
}

async function importStudents() {
  const file = $("#import-file")?.files?.[0];
  const pasted = $("#paste-roster")?.value?.trim();
  try {
    const rows = file ? await parseRosterFile(file) : parseTextRows(pasted || "");
    if (!rows.length) {
      alert("没有读到可导入的名单。");
      return;
    }
    let added = 0;
    let skipped = 0;
    const existingNos = new Set(classStudents().map((s) => s.studentNo).filter(Boolean));
    for (const row of rows) {
      const name = String(row.name || "").trim();
      const studentNo = String(row.studentNo || "").trim();
      if (!name || (studentNo && existingNos.has(studentNo))) {
        skipped += 1;
        continue;
      }
      await put("students", {
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
    }
    await loadData();
    state.modal = null;
    showToast(`导入 ${added} 人，跳过 ${skipped} 人`);
  } catch (error) {
    alert(`导入失败：${error.message}`);
  }
}

async function parseRosterFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx")) return parseXlsx(await file.arrayBuffer());
  return parseTextRows(await file.text());
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
    else if (!quoted && /[,\t，]/.test(ch)) { parts.push(current.trim()); current = ""; }
    else current += ch;
  }
  parts.push(current.trim());
  return parts;
}

function normalizeRows(rows) {
  const header = rows[0].map((cell) => String(cell).trim().toLowerCase());
  const nameKeys = ["姓名", "名字", "name"];
  const noKeys = ["学号", "座号", "id", "studentno", "student no"];
  const hasHeader = header.some((h) => nameKeys.includes(h) || noKeys.includes(h));
  const nameIndex = hasHeader ? header.findIndex((h) => nameKeys.includes(h)) : 0;
  const noIndex = hasHeader ? header.findIndex((h) => noKeys.includes(h)) : 1;
  return rows.slice(hasHeader ? 1 : 0).map((row) => ({
    name: row[nameIndex] || "",
    studentNo: noIndex >= 0 ? row[noIndex] || "" : "",
  })).filter((row) => row.name);
}

async function parseXlsx(buffer) {
  const entries = await unzip(buffer);
  const workbook = parseXml(entries["xl/workbook.xml"]);
  const rels = parseXml(entries["xl/_rels/workbook.xml.rels"]);
  const sheetNode = workbook.querySelector("sheet");
  if (!sheetNode) return [];
  const rid = sheetNode.getAttribute("r:id");
  const rel = [...rels.querySelectorAll("Relationship")].find((node) => node.getAttribute("Id") === rid);
  const sheetPath = `xl/${rel?.getAttribute("Target") || "worksheets/sheet1.xml"}`.replace("xl//", "xl/");
  const shared = entries["xl/sharedStrings.xml"] ? [...parseXml(entries["xl/sharedStrings.xml"]).querySelectorAll("si")].map((si) => [...si.querySelectorAll("t")].map((t) => t.textContent).join("")) : [];
  const sheet = parseXml(entries[sheetPath]);
  const table = [...sheet.querySelectorAll("row")].map((row) => [...row.querySelectorAll("c")].map((cell) => {
    const v = cell.querySelector("v")?.textContent || "";
    return cell.getAttribute("t") === "s" ? shared[Number(v)] || "" : v;
  }));
  return normalizeRows(table);
}

function parseXml(text) {
  return new DOMParser().parseFromString(text, "application/xml");
}

async function unzip(buffer) {
  if (!("DecompressionStream" in window)) throw new Error("当前浏览器不支持直接读取 xlsx，请另存为 CSV 后导入。");
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const entries = {};
  for (let i = 0; i < bytes.length - 4; i += 1) {
    if (view.getUint32(i, true) !== 0x04034b50) continue;
    const method = view.getUint16(i + 8, true);
    const compressedSize = view.getUint32(i + 18, true);
    const fileNameLength = view.getUint16(i + 26, true);
    const extraLength = view.getUint16(i + 28, true);
    const nameStart = i + 30;
    const dataStart = nameStart + fileNameLength + extraLength;
    const name = new TextDecoder().decode(bytes.slice(nameStart, nameStart + fileNameLength));
    const data = bytes.slice(dataStart, dataStart + compressedSize);
    if (!name.endsWith("/")) {
      entries[name] = method === 0 ? new TextDecoder().decode(data) : await inflateRaw(data);
    }
    i = dataStart + compressedSize - 1;
  }
  return entries;
}

async function inflateRaw(data) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return await new Response(stream).text();
}

async function startSession(classId) {
  if (!classStudents(classId).length) {
    alert("这个班级还没有学生，请先导入或新增名单。");
    return;
  }
  const existing = draftSession(classId);
  if (existing) {
    await continueSession(classId);
    return;
  }
  const students = classStudents(classId);
  const session = {
    id: uid(),
    classId,
    status: "draft",
    startedAt: nowIso(),
    endedAt: "",
    updatedAt: "",
    undo: null,
    records: students.map((student) => ({
      studentId: student.id,
      nameSnapshot: student.name,
      noSnapshot: student.studentNo,
      status: "unmarked",
      note: "",
      markedAt: "",
    })),
  };
  await put("sessions", session);
  await loadData();
  state.activeClassId = classId;
  state.activeSession = session;
  state.view = "session";
  state.filter = "all";
  state.query = "";
  render();
}

async function continueSession(classId) {
  state.activeClassId = classId;
  state.activeSession = draftSession(classId);
  state.view = "session";
  render();
}

function openMarkModal(studentId) {
  const row = state.activeSession.records.find((record) => record.studentId === studentId);
  state.modal = { type: "mark", row: { ...row } };
  render();
}

async function applyStatus(status) {
  const note = $("#mark-note")?.value || "";
  const row = state.modal.row;
  const session = structuredClone(state.activeSession);
  const index = session.records.findIndex((record) => record.studentId === row.studentId);
  session.undo = structuredClone(session.records[index]);
  session.records[index] = { ...session.records[index], status, note, markedAt: status === "unmarked" ? "" : nowIso() };
  session.updatedAt = nowIso();
  await persistActiveSession(session);
  state.modal = null;
  showToast("已更新状态");
}

async function saveNoteOnly() {
  const row = state.modal.row;
  const session = structuredClone(state.activeSession);
  const index = session.records.findIndex((record) => record.studentId === row.studentId);
  session.undo = structuredClone(session.records[index]);
  session.records[index].note = $("#mark-note")?.value || "";
  session.updatedAt = nowIso();
  await persistActiveSession(session);
  state.modal = null;
  showToast("备注已保存");
}

async function persistActiveSession(session) {
  state.activeSession = session;
  await put("sessions", session);
  await loadData();
  state.activeSession = state.sessions.find((item) => item.id === session.id);
}

async function undo() {
  if (!state.activeSession?.undo) return;
  const session = structuredClone(state.activeSession);
  const index = session.records.findIndex((record) => record.studentId === session.undo.studentId);
  session.records[index] = session.undo;
  session.undo = null;
  session.updatedAt = nowIso();
  await persistActiveSession(session);
  showToast("已撤销最近一步");
}

async function resetSession() {
  if (!confirm("确定重置本次点名吗？所有状态会恢复为未点名。")) return;
  const session = structuredClone(state.activeSession);
  session.undo = null;
  session.updatedAt = nowIso();
  session.records = session.records.map((record) => ({ ...record, status: "unmarked", note: "", markedAt: "" }));
  await persistActiveSession(session);
  render();
}

async function saveSession() {
  const unmarked = state.activeSession.records.filter((record) => record.status === "unmarked").length;
  if (unmarked && !confirm(`还有 ${unmarked} 人未点名，仍然保存吗？`)) return;
  const session = { ...state.activeSession, status: "saved", endedAt: nowIso(), updatedAt: nowIso(), undo: null };
  await put("sessions", session);
  await loadData();
  state.activeSession = null;
  state.view = "class";
  showToast("点名记录已保存");
}

async function discardSession() {
  if (!confirm("确定放弃本次点名吗？未保存记录会被删除。")) return;
  await del("sessions", state.activeSession.id);
  await loadData();
  state.activeSession = null;
  state.view = "class";
  render();
}

function randomPick() {
  const candidates = state.activeSession.records
    .filter((record) => state.filter === "all" ? record.status === "unmarked" : record.status === state.filter)
    .map((record) => state.students.find((student) => student.id === record.studentId))
    .filter(Boolean);
  if (!candidates.length) {
    alert("当前范围里没有可抽取的学生。");
    return;
  }
  const student = candidates[Math.floor(Math.random() * candidates.length)];
  state.modal = { type: "random", student };
  render();
}

function openHistoryEdit(id) {
  state.modal = { type: "historyEdit", session: structuredClone(state.sessions.find((session) => session.id === id)) };
  render();
}

async function saveHistoryEdit() {
  const session = structuredClone(state.modal.session);
  session.records = session.records.map((record, index) => ({
    ...record,
    status: document.querySelector(`[data-history-status="${index}"]`).value,
    note: document.querySelector(`[data-history-note="${index}"]`).value,
  }));
  session.updatedAt = nowIso();
  await put("sessions", session);
  await loadData();
  state.modal = null;
  showToast("历史记录已更新");
}

async function deleteHistory(id) {
  if (!confirm("确定删除这条历史记录吗？")) return;
  await del("sessions", id);
  await loadData();
  render();
}

function exportRoster() {
  const rows = [["姓名", "学号"], ...classStudents().map((s) => [s.name, s.studentNo || ""])];
  downloadCsv(rows, "班级名单.csv");
}

function exportHistory(id) {
  const session = state.sessions.find((s) => s.id === id);
  downloadCsv(historyRows([session]), `点名历史-${session.startedAt.slice(0, 10)}.csv`);
}

function exportAllHistory() {
  downloadCsv(historyRows(classSessions().filter((s) => s.status === "saved")), "全部点名历史.csv");
}

function historyRows(sessions) {
  return [["班级", "开始时间", "结束时间", "姓名", "学号", "状态", "备注"], ...sessions.flatMap((session) => {
    const klass = state.classes.find((k) => k.id === session.classId);
    return session.records.map((record) => [klass?.name || "", fmt(session.startedAt), fmt(session.endedAt), record.nameSnapshot, record.noSnapshot, statusLabel(record.status), record.note || ""]);
  })];
}

function downloadCsv(rows, filename) {
  const text = "\ufeff" + rows.map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, "\"\"")}"`).join(",")).join("\n");
  downloadBlob(text, filename, "text/csv;charset=utf-8");
}

function exportBackup() {
  const payload = JSON.stringify({
    app: "班级小管家",
    exportedAt: nowIso(),
    classes: state.classes,
    students: state.students,
    sessions: state.sessions,
  }, null, 2);
  downloadBlob(payload, `班级小管家备份-${new Date().toISOString().slice(0, 10)}.json`, "application/json");
}

async function restoreBackup(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!confirm("恢复备份会合并导入数据，ID 相同的内容会被覆盖。继续吗？")) return;
  const data = JSON.parse(await file.text());
  for (const klass of data.classes || []) await put("classes", klass);
  for (const student of data.students || []) await put("students", student);
  for (const session of data.sessions || []) await put("sessions", session);
  await loadData();
  state.view = "home";
  render();
  showToast("备份已恢复");
}

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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
      const from = students.findIndex((s) => s.id === dragId);
      const to = students.findIndex((s) => s.id === targetId);
      const [moved] = students.splice(from, 1);
      students.splice(to, 0, moved);
      await Promise.all(students.map((student, order) => put("students", { ...student, order, updatedAt: nowIso() })));
      await loadData();
      render();
    });
  });
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

try {
  await loadData();
  await migrateLegacyBrowserDataIfNeeded();
  render();
} catch (error) {
  document.querySelector("#app").innerHTML = `
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
