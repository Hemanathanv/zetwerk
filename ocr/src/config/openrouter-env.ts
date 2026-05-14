/**
 * OpenRouter settings: read from process.env after dotenv is loaded in each script entrypoint.
 * Default values match `.env.example` — change behavior in `.env.local`, not here.
 */

import process from "node:process";

const DEFAULTS = {
  OPENROUTER_API_URL: "https://openrouter.ai/api/v1/chat/completions",
  OPENROUTER_MODEL_FLASH: "google/gemini-3.1-flash-lite-preview",
  OPENROUTER_MODEL_PRO: "google/gemini-3.1-pro-preview",
  OPENROUTER_PDF_ENGINE: "native",
  OPENROUTER_TEMPERATURE: 0.1,
  /** Large JSON (flat 261 fields or structured Parts I–V). Override lower in .env if needed. */
  OPENROUTER_MAX_TOKENS: 131072,
  /** discover-schema / remap-missing-fields. */
  OPENROUTER_MAX_TOKENS_FLASH: 16384,
  MIN_TOKENS_PRO: 4096,
  MIN_TOKENS_FLASH: 256,
  /** Flash / discover — keep bounded. */
  MAX_TOKENS_CAP_FLASH: 65536,
  /** Pro / large structured Shipping Bill JSON; raise via OPENROUTER_MAX_TOKENS_CAP if provider allows. */
  MAX_TOKENS_CAP_PRO: 131072,
} as const;

function envString(key: string, fallback: string): string {
  const v = process.env[key]?.trim();
  return v && v.length > 0 ? v : fallback;
}

function envNumber(key: string, fallback: number): number {
  const v = process.env[key]?.trim();
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/** Strip internal whitespace in model ids (avoids tab-corrupted .env). */
export function normalizeOpenRouterModelId(raw: string): string {
  return raw.replace(/\s+/g, "").trim();
}

export function getOpenRouterChatCompletionsUrl(): string {
  return envString("OPENROUTER_API_URL", DEFAULTS.OPENROUTER_API_URL);
}

export function getOpenRouterApiKey(): string | undefined {
  const k = process.env.OPENROUTER_API_KEY?.trim();
  return k && k.length > 0 ? k : undefined;
}

export function requireOpenRouterApiKey(): string {
  const k = getOpenRouterApiKey();
  if (!k) throw new Error("Missing OPENROUTER_API_KEY (.env.local or .env)");
  return k;
}

export interface OpenRouterPdfCallOptions {
  model: string;
  pdfEngine: string;
  temperature: number;
  maxTokens: number;
}

/** discover-schema.ts, remap-missing-fields.ts */
export function getOpenRouterFlashPdfOptions(): OpenRouterPdfCallOptions {
  const maxParsed = parseInt(
    envString(
      "OPENROUTER_MAX_TOKENS_FLASH",
      String(DEFAULTS.OPENROUTER_MAX_TOKENS_FLASH),
    ),
    10,
  );
  const maxTokens = clampInt(
    Number.isFinite(maxParsed) ? maxParsed : DEFAULTS.OPENROUTER_MAX_TOKENS_FLASH,
    DEFAULTS.MIN_TOKENS_FLASH,
    DEFAULTS.MAX_TOKENS_CAP_FLASH,
  );
  return {
    model: normalizeOpenRouterModelId(
      envString("OPENROUTER_MODEL_FLASH", DEFAULTS.OPENROUTER_MODEL_FLASH),
    ),
    pdfEngine: normalizeOpenRouterModelId(
      envString("OPENROUTER_PDF_ENGINE", DEFAULTS.OPENROUTER_PDF_ENGINE),
    ),
    temperature: envNumber(
      "OPENROUTER_TEMPERATURE",
      DEFAULTS.OPENROUTER_TEMPERATURE,
    ),
    maxTokens,
  };
}

function proMaxTokensCap(): number {
  const raw = process.env.OPENROUTER_MAX_TOKENS_CAP?.trim();
  if (raw) {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n >= DEFAULTS.MIN_TOKENS_PRO)
      return Math.min(n, 200000);
  }
  return DEFAULTS.MAX_TOKENS_CAP_PRO;
}

/** OpenRouter unified reasoning control (Gemini / OpenAI-style models). */
export type OpenRouterReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

/**
 * Fragment to spread into chat/completions POST body.
 * Use `omit` to leave default provider behavior (no `reasoning` key).
 */
export function openRouterReasoningRequestFragment(
  effort: OpenRouterReasoningEffort | "omit",
): { reasoning: { effort: OpenRouterReasoningEffort } } | Record<string, never> {
  if (effort === "omit") return {};
  return { reasoning: { effort } };
}

/** Read OPENROUTER_REASONING_EFFORT from env (omit | none | minimal | low | medium | high | xhigh). */
export function parseOpenRouterReasoningEffortFromEnv():
  | OpenRouterReasoningEffort
  | "omit"
  | undefined {
  const v = process.env.OPENROUTER_REASONING_EFFORT?.trim().toLowerCase();
  if (!v) return undefined;
  if (v === "omit" || v === "off" || v === "false") return "omit";
  const allowed: OpenRouterReasoningEffort[] = [
    "none",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
  ];
  if (allowed.includes(v as OpenRouterReasoningEffort))
    return v as OpenRouterReasoningEffort;
  return undefined;
}

/** Pro PDF extractors in `Final/` (shipping bill, sales invoices). */
export function getOpenRouterProPdfOptions(): OpenRouterPdfCallOptions {
  const cap = proMaxTokensCap();
  const maxParsed = parseInt(
    envString("OPENROUTER_MAX_TOKENS", String(DEFAULTS.OPENROUTER_MAX_TOKENS)),
    10,
  );
  const maxTokens = clampInt(
    Number.isFinite(maxParsed) ? maxParsed : DEFAULTS.OPENROUTER_MAX_TOKENS,
    DEFAULTS.MIN_TOKENS_PRO,
    cap,
  );
  return {
    model: normalizeOpenRouterModelId(
      envString("OPENROUTER_MODEL_PRO", DEFAULTS.OPENROUTER_MODEL_PRO),
    ),
    pdfEngine: normalizeOpenRouterModelId(
      envString("OPENROUTER_PDF_ENGINE", DEFAULTS.OPENROUTER_PDF_ENGINE),
    ),
    temperature: envNumber(
      "OPENROUTER_TEMPERATURE",
      DEFAULTS.OPENROUTER_TEMPERATURE,
    ),
    maxTokens,
  };
}
