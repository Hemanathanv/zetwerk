import cors from "cors";
import express from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

type OcrTypeConfig = {
  id: string;
  label: string;
  script: string;
};

const OCR_TYPES: OcrTypeConfig[] = [
  { id: "entry_summary", label: "Entry Summary", script: "entry_summary.py" },
  {
    id: "entry_summary_tariff_lines",
    label: "Entry Summary Tariff Lines",
    script: "entry_summary_tariff_lines.py",
  },
  {
    id: "steel_supplier_declaration",
    label: "Steel Supplier Declaration",
    script: "ssd.py",
  },
  { id: "shipping_bill", label: "Shipping Bill", script: "shipping_bill.py" },
  {
    id: "delivery_deduction_sheet",
    label: "Delivery Deduction Sheet",
    script: "dds.py",
  },
  { id: "ocean_freight", label: "Ocean Freight", script: "ocean_freight.py" },
  { id: "packing_list", label: "Packing List", script: "packing_list.py" },
  { id: "sales_invoices", label: "Sales Invoices", script: "sales_invoice.py" },
  { id: "bill_of_lading", label: "Bill of Lading", script: "bill_of_lading.py" },
  {
    id: "freight_forwarder_bill",
    label: "Freight Forwarder Bill",
    script: "freight_forward.py",
  },
  { id: "cha", label: "CHA", script: "cha.py" },
  {
    id: "us_cargo_release_order",
    label: "US Cargo Release Order",
    script: "us_cargo_release.py",
  },
  {
    id: "us_customs_release_order",
    label: "US Customs Release Order",
    script: "us_custom_release.py",
  },
  {
    id: "us_delivery_order",
    label: "US Delivery Order",
    script: "us_delivery_order.py",
  },
  {
    id: "us_packing_list",
    label: "US Packing List",
    script: "us_packing_list.py",
  },
];

const OCR_TYPE_BY_ID = new Map(OCR_TYPES.map((item) => [item.id, item]));

const APP_PORT = Number.parseInt(process.env.BACKEND_PORT ?? "8000", 10);
const ROOT_DIR = process.cwd();
const UPLOAD_DIR = path.resolve(ROOT_DIR, "data", "uploads");
const OUTPUT_DIR = path.resolve(ROOT_DIR, "data", "frontend_ocr_output");
const PYTHON_EXECUTABLE =
  (process.env.OCR_PYTHON_EXECUTABLE ?? "").trim() || "python";
const METRICS_PREFIX = "OCR_METRICS_JSON: ";

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

function sanitizeName(input: string): string {
  const parsed = path.parse(input || "");
  const base = (parsed.name || "document").replace(/[^a-zA-Z0-9._-]+/g, "_");
  return `${base}.pdf`;
}

function tail(input: string, maxChars = 4000): string {
  if (input.length <= maxChars) return input;
  return input.slice(input.length - maxChars);
}

function parseMetrics(stdout: string): Record<string, unknown> | null {
  const lines = stdout.split(/\r?\n/).reverse();
  for (const line of lines) {
    if (!line.startsWith(METRICS_PREFIX)) continue;
    const payload = line.slice(METRICS_PREFIX.length).trim();
    try {
      const parsed = JSON.parse(payload);
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function runOcrScript(
  ocrConfig: OcrTypeConfig,
  inputPdfPath: string,
  outputXlsxPath: string,
): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
  elapsedMs: number;
}> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const childEnv = {
      ...process.env,
      OPENROUTER_X_TITLE: ocrConfig.label,
      OCR_RUN_TITLE: ocrConfig.label,
    };
    const child = spawn(
      PYTHON_EXECUTABLE,
      [ocrConfig.script, "--input", inputPdfPath, "--output", outputXlsxPath],
      {
        cwd: ROOT_DIR,
        env: childEnv,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      resolve({
        code,
        stdout,
        stderr,
        elapsedMs: Date.now() - startedAt,
      });
    });

    child.on("error", (err) => {
      stderr += `\nFailed to start OCR process: ${String(err)}`;
      resolve({
        code: -1,
        stdout,
        stderr,
        elapsedMs: Date.now() - startedAt,
      });
    });
  });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const timestamp = Date.now();
    cb(null, `${timestamp}_${sanitizeName(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: Number.parseInt(
      process.env.OCR_UPLOAD_MAX_BYTES ?? `${25 * 1024 * 1024}`,
      10,
    ),
  },
  fileFilter: (_req, file, cb) => {
    const isPdfMime = file.mimetype === "application/pdf";
    const isPdfExt = file.originalname.toLowerCase().endsWith(".pdf");
    if (!isPdfMime && !isPdfExt) {
      cb(new Error("Only PDF files are allowed."));
      return;
    }
    cb(null, true);
  },
});

const app = express();

app.use(
  cors({
    origin: true,
  }),
);
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "ocr-backend", timestamp: new Date().toISOString() });
});

app.get("/api/ocr/types", (_req, res) => {
  res.json({
    ok: true,
    types: OCR_TYPES.map((item) => ({ id: item.id, label: item.label })),
  });
});

app.use("/api/ocr/outputs", express.static(OUTPUT_DIR));

app.post("/api/ocr/run", upload.single("file"), async (req, res) => {
  const uploaded = req.file;
  const ocrType = String(req.body?.ocrType ?? "").trim();
  const ocrConfig = OCR_TYPE_BY_ID.get(ocrType);

  if (!uploaded) {
    res.status(400).json({ ok: false, error: "Missing file upload (field: file)." });
    return;
  }
  if (!ocrConfig) {
    res.status(400).json({ ok: false, error: "Invalid ocrType." });
    return;
  }

  const sourceStem = path
    .parse(uploaded.originalname || "document.pdf")
    .name.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const outputFileName = `${Date.now()}_${ocrType}_${sourceStem}_ocr_output.xlsx`;
  const outputPath = path.resolve(OUTPUT_DIR, outputFileName);

  const result = await runOcrScript(ocrConfig, uploaded.path, outputPath);
  const metrics = parseMetrics(result.stdout);
  const outputExists = fs.existsSync(outputPath);

  if (result.code !== 0 || !outputExists) {
    res.status(500).json({
      ok: false,
      error: "OCR script execution failed.",
      ocrType,
      script: ocrConfig.script,
      processExitCode: result.code,
      outputExpectedAt: outputPath,
      stdoutTail: tail(result.stdout),
      stderrTail: tail(result.stderr),
    });
    return;
  }

  res.json({
    ok: true,
    ocrType,
    ocrLabel: ocrConfig.label,
    script: ocrConfig.script,
    elapsedMs: result.elapsedMs,
    inputFile: {
      name: uploaded.originalname,
      storedPath: uploaded.path,
      sizeBytes: uploaded.size,
    },
    outputFile: {
      name: outputFileName,
      path: outputPath,
      url: `/api/ocr/outputs/${encodeURIComponent(outputFileName)}`,
    },
    metrics,
    stdoutTail: tail(result.stdout, 1500),
  });
});

app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    res.status(400).json({ ok: false, error: err.message || "Request failed." });
  },
);

app.listen(APP_PORT, () => {
  console.log(
    `[ocr-backend] listening on http://localhost:${APP_PORT} (python=${PYTHON_EXECUTABLE})`,
  );
});
