const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const express = require("express");
const { Pool } = require("pg");

const app = express();
const port = process.env.PORT || 10000;
const adminPassword = process.env.ADMIN_PASSWORD || "1234";
const dataFile = path.join(__dirname, "data", "reports.json");
const collectorsFile = path.join(__dirname, "data", "collectors.json");
const databaseUrl = process.env.DATABASE_URL || "";
const defaultCollectors = [
  "Felipe Pico",
  "Carlos Gomez",
  "Franco Nicolas Encina",
  "Gustavo Gimenez",
  "Maria Jose Lobos",
  "Maryuri Lopez",
  "Matias Martinez",
  "Walter Martinez",
  "Mariana Quinteros",
  "Alejandro Balberdi",
  "Alejandro Gamarra",
  "Mario Veron",
  "Resquin Alejandra",
  "Rodrigo Galeano",
  "Damian Alvarez",
  "Enrique Sibilla",
  "Nilson Lopez",
];

function databaseSslConfig(url) {
  if (!url || url.includes("localhost") || url.includes("127.0.0.1")) return false;
  if (url.includes(".render.com") || url.includes("sslmode=require")) {
    return { rejectUnauthorized: false };
  }
  return false;
}

const pool = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
      ssl: databaseSslConfig(databaseUrl),
      max: 1,
      connectionTimeoutMillis: 10000,
    })
  : null;

app.use(express.json({ limit: "2mb" }));
app.use(express.static(__dirname));

function calculate(cash, transfer, expenses) {
  const total = cash + transfer;
  const net = total - expenses;
  return { total, net };
}

function numberFrom(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function cleanReport(input) {
  const cash = numberFrom(input.cash);
  const transfer = numberFrom(input.transfer);
  const expenses = numberFrom(input.expenses);
  const { total, net } = calculate(cash, transfer, expenses);

  return {
    collector: String(input.collector || "").trim(),
    cash,
    transfer,
    expenses,
    expenseDetail: String(input.expenseDetail || "").trim(),
    notes: String(input.notes || "").trim(),
    total,
    net,
  };
}

function isAdmin(request) {
  return request.get("x-admin-password") === adminPassword;
}

function requireAdmin(request, response, next) {
  if (isAdmin(request)) return next();
  return response.status(401).json({ error: "No autorizado" });
}

async function ensureDatabase() {
  if (pool) {
    await pool.query(`
      create table if not exists reports (
        id text primary key,
        created_at timestamptz not null default now(),
        updated_at timestamptz,
        collector text not null,
        cash numeric not null default 0,
        transfer numeric not null default 0,
        expenses numeric not null default 0,
        expense_detail text not null default '',
        notes text not null default '',
        total numeric not null default 0,
        net numeric not null default 0
      )
    `);
    await pool.query(`
      create table if not exists collectors (
        id text primary key,
        name text not null unique,
        position integer not null default 0,
        created_at timestamptz not null default now(),
        updated_at timestamptz
      )
    `);
    const result = await pool.query("select count(*)::int as count from collectors");
    if (!result.rows[0]?.count) {
      for (const [index, name] of defaultCollectors.entries()) {
        await pool.query(
          "insert into collectors (id, name, position) values ($1, $2, $3)",
          [crypto.randomUUID(), name, index],
        );
      }
    }
    return;
  }

  await fs.mkdir(path.dirname(dataFile), { recursive: true });
  try {
    await fs.access(dataFile);
  } catch {
    await fs.writeFile(dataFile, "[]");
  }
  try {
    await fs.access(collectorsFile);
  } catch {
    await fs.writeFile(collectorsFile, JSON.stringify(defaultCollectors, null, 2));
  }
}

function rowToReport(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    collector: row.collector,
    cash: numberFrom(row.cash),
    transfer: numberFrom(row.transfer),
    expenses: numberFrom(row.expenses),
    expenseDetail: row.expense_detail,
    notes: row.notes,
    total: numberFrom(row.total),
    net: numberFrom(row.net),
  };
}

async function readReports() {
  if (pool) {
    const result = await pool.query("select * from reports order by created_at desc");
    return result.rows.map(rowToReport);
  }

  const raw = await fs.readFile(dataFile, "utf8");
  return JSON.parse(raw || "[]");
}

async function writeReports(reports) {
  await fs.writeFile(dataFile, JSON.stringify(reports, null, 2));
}

function cleanCollectorName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

async function readCollectors() {
  if (pool) {
    const result = await pool.query("select id, name from collectors order by position asc, name asc");
    return result.rows;
  }

  const raw = await fs.readFile(collectorsFile, "utf8");
  return JSON.parse(raw || "[]").map((name, index) => ({ id: String(index), name }));
}

async function writeCollectorNames(names) {
  await fs.writeFile(collectorsFile, JSON.stringify(names, null, 2));
}

app.post("/api/admin/check", requireAdmin, (request, response) => {
  response.json({ ok: true });
});

app.get("/api/collectors", async (request, response) => {
  response.json({ collectors: await readCollectors() });
});

app.post("/api/collectors", requireAdmin, async (request, response) => {
  const name = cleanCollectorName(request.body?.name);
  if (!name) return response.status(400).json({ error: "El nombre es obligatorio" });

  if (pool) {
    try {
      const positionResult = await pool.query("select coalesce(max(position), -1) + 1 as position from collectors");
      const result = await pool.query(
        "insert into collectors (id, name, position) values ($1, $2, $3) returning id, name",
        [crypto.randomUUID(), name, Number(positionResult.rows[0]?.position || 0)],
      );
      return response.status(201).json({ collector: result.rows[0] });
    } catch (error) {
      if (error.code === "23505") return response.status(409).json({ error: "Ese cobrador ya existe" });
      throw error;
    }
  }

  const collectors = await readCollectors();
  if (collectors.some((collector) => collector.name.toLowerCase() === name.toLowerCase())) {
    return response.status(409).json({ error: "Ese cobrador ya existe" });
  }
  const names = [...collectors.map((collector) => collector.name), name];
  await writeCollectorNames(names);
  response.status(201).json({ collector: { id: String(names.length - 1), name } });
});

app.patch("/api/collectors/:id", requireAdmin, async (request, response) => {
  const name = cleanCollectorName(request.body?.name);
  if (!name) return response.status(400).json({ error: "El nombre es obligatorio" });

  if (pool) {
    try {
      const result = await pool.query(
        "update collectors set name = $2, updated_at = now() where id = $1 returning id, name",
        [request.params.id, name],
      );
      if (!result.rows[0]) return response.status(404).json({ error: "No encontrado" });
      return response.json({ collector: result.rows[0] });
    } catch (error) {
      if (error.code === "23505") return response.status(409).json({ error: "Ese cobrador ya existe" });
      throw error;
    }
  }

  const collectors = await readCollectors();
  const index = Number(request.params.id);
  if (!Number.isInteger(index) || !collectors[index]) return response.status(404).json({ error: "No encontrado" });
  if (collectors.some((collector, itemIndex) => itemIndex !== index && collector.name.toLowerCase() === name.toLowerCase())) {
    return response.status(409).json({ error: "Ese cobrador ya existe" });
  }
  const names = collectors.map((collector) => collector.name);
  names[index] = name;
  await writeCollectorNames(names);
  response.json({ collector: { id: String(index), name } });
});

app.delete("/api/collectors/:id", requireAdmin, async (request, response) => {
  if (pool) {
    await pool.query("delete from collectors where id = $1", [request.params.id]);
    return response.json({ ok: true });
  }

  const collectors = await readCollectors();
  const index = Number(request.params.id);
  if (!Number.isInteger(index) || !collectors[index]) return response.status(404).json({ error: "No encontrado" });
  await writeCollectorNames(collectors.filter((collector, itemIndex) => itemIndex !== index).map((collector) => collector.name));
  response.json({ ok: true });
});

app.get("/api/reports", requireAdmin, async (request, response) => {
  response.json({ reports: await readReports() });
});

app.post("/api/reports", async (request, response) => {
  const report = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...cleanReport(request.body || {}),
  };

  if (pool) {
    await pool.query(
      `
        insert into reports
          (id, created_at, collector, cash, transfer, expenses, expense_detail, notes, total, net)
        values
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        report.id,
        report.createdAt,
        report.collector,
        report.cash,
        report.transfer,
        report.expenses,
        report.expenseDetail,
        report.notes,
        report.total,
        report.net,
      ],
    );
  } else {
    const reports = await readReports();
    reports.unshift(report);
    await writeReports(reports);
  }

  response.status(201).json({ report });
});

app.post("/api/reports/import", requireAdmin, async (request, response) => {
  const imported = Array.isArray(request.body.reports)
    ? request.body.reports.map((item) => ({
        id: crypto.randomUUID(),
        createdAt: item.createdAt || new Date().toISOString(),
        ...cleanReport(item),
      }))
    : [];

  if (!imported.length) return response.status(400).json({ error: "No hay reportes para importar" });

  if (pool) {
    for (const report of imported) {
      await pool.query(
        `
          insert into reports
            (id, created_at, collector, cash, transfer, expenses, expense_detail, notes, total, net)
          values
            ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        [
          report.id,
          report.createdAt,
          report.collector,
          report.cash,
          report.transfer,
          report.expenses,
          report.expenseDetail,
          report.notes,
          report.total,
          report.net,
        ],
      );
    }
  } else {
    const reports = await readReports();
    await writeReports([...imported, ...reports]);
  }

  response.status(201).json({ imported: imported.length });
});

app.patch("/api/reports/:id", requireAdmin, async (request, response) => {
  const updated = cleanReport(request.body || {});
  const updatedAt = new Date().toISOString();

  if (pool) {
    const result = await pool.query(
      `
        update reports
        set collector = $2,
            cash = $3,
            transfer = $4,
            expenses = $5,
            expense_detail = $6,
            notes = $7,
            total = $8,
            net = $9,
            updated_at = $10
        where id = $1
        returning *
      `,
      [
        request.params.id,
        updated.collector,
        updated.cash,
        updated.transfer,
        updated.expenses,
        updated.expenseDetail,
        updated.notes,
        updated.total,
        updated.net,
        updatedAt,
      ],
    );
    if (!result.rows[0]) return response.status(404).json({ error: "No encontrado" });
    return response.json({ report: rowToReport(result.rows[0]) });
  }

  let reports = await readReports();
  let found = false;
  reports = reports.map((report) => {
    if (report.id !== request.params.id) return report;
    found = true;
    return { ...report, ...updated, updatedAt };
  });
  if (!found) return response.status(404).json({ error: "No encontrado" });
  await writeReports(reports);
  response.json({ report: reports.find((report) => report.id === request.params.id) });
});

app.delete("/api/reports/:id", requireAdmin, async (request, response) => {
  if (pool) {
    await pool.query("delete from reports where id = $1", [request.params.id]);
    return response.json({ ok: true });
  }

  const reports = await readReports();
  await writeReports(reports.filter((report) => report.id !== request.params.id));
  response.json({ ok: true });
});

app.delete("/api/reports", requireAdmin, async (request, response) => {
  if (pool) {
    await pool.query("delete from reports");
    return response.json({ ok: true });
  }

  await writeReports([]);
  response.json({ ok: true });
});

app.get("*", (request, response) => {
  response.sendFile(path.join(__dirname, "index.html"));
});

ensureDatabase()
  .then(() => {
    app.listen(port, () => {
      console.log(`Reportes online en puerto ${port}`);
    });
  })
  .catch((error) => {
    console.error("No se pudo iniciar la app", error);
    process.exit(1);
  });
