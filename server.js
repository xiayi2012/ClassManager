const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const dataDir = path.join(root, "data");
const dataFile = path.join(dataDir, "app-data.json");
const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || "0.0.0.0";
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
};

const emptyData = {
  classes: [],
  students: [],
  sessions: [],
};

function ensureDataFile() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dataFile)) {
    fs.writeFileSync(dataFile, JSON.stringify(emptyData, null, 2), "utf8");
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 20 * 1024 * 1024) {
        reject(new Error("请求体过大"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function normalizeData(data) {
  return {
    classes: Array.isArray(data.classes) ? data.classes : [],
    students: Array.isArray(data.students) ? data.students : [],
    sessions: Array.isArray(data.sessions) ? data.sessions : [],
    savedAt: new Date().toISOString(),
  };
}

async function handleApi(req, res) {
  ensureDataFile();

  if (req.method === "GET") {
    fs.readFile(dataFile, "utf8", (error, content) => {
      if (error) {
        sendJson(res, 500, { error: "读取数据文件失败" });
        return;
      }
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(content);
    });
    return;
  }

  if (req.method === "PUT") {
    try {
      const body = await readBody(req);
      const data = normalizeData(JSON.parse(body || "{}"));
      const tempFile = `${dataFile}.tmp`;
      fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), "utf8");
      fs.renameSync(tempFile, dataFile);
      sendJson(res, 200, { ok: true, savedAt: data.savedAt });
    } catch (error) {
      sendJson(res, 400, { error: error.message || "保存数据失败" });
    }
    return;
  }

  sendJson(res, 405, { error: "Method not allowed" });
}

function handleStatic(req, res) {
  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  const safePath = path.normalize(urlPath === "/" ? "/index.html" : urlPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(root, safePath);

  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const headers = { "Content-Type": types[path.extname(filePath)] || "application/octet-stream" };
    if (path.basename(filePath) === "sw.js") headers["Cache-Control"] = "no-cache";
    res.writeHead(200, headers);
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if ((req.url || "").startsWith("/api/data")) {
    handleApi(req, res);
    return;
  }
  handleStatic(req, res);
});

server.listen(port, host, () => {
  ensureDataFile();
  console.log(`班级小管家已启动：http://localhost:${port}`);
  console.log(`数据文件：${dataFile}`);
});
