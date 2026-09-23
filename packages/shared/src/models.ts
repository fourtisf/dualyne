import type { Tier } from "./tiers";

/**
 * Display metadata and the launch mapping for every Refract model id.
 * The database `models` table is seeded from this list; after that the daily job keeps
 * prices, context length and the upstream name in sync with OpenRouter's catalog.
 * OpenRouter ids change often: `pnpm --filter @refract/api models:resolve` prints the newest
 * id for each family so the mapping can be updated.
 */
export interface ModelDef {
  id: string;
  name: string;
  /** Name in the Compare model menus, e.g. "OpenAI GPT". */
  menuName: string;
  provider: string;
  /** Colour of the provider swatch in the catalog table. */
  providerColor: string;
  bestFor: string;
  /** 1–4 speed bars in the catalog table. */
  speed: number;
  minTier: Tier;
  sortOrder: number;
  openrouterId: string;
  /** Family prefix used to find newer versions in OpenRouter's catalog. */
  openrouterFamily: string;
  /** Human name of the upstream model, e.g. "Claude Haiku 4.5". */
  upstreamName: string;
  /** USD per token, as OpenRouter reports it. Estimates until the daily sync runs. */
  promptPrice: string;
  completionPrice: string;
  contextLength: number;
}

export const MODEL_DEFS: readonly ModelDef[] = [
  {
    id: "claude-swift",
    name: "Claude Swift",
    menuName: "Claude Swift",
    provider: "Anthropic",
    providerColor: "#D4A27F",
    bestFor: "Quick answers, chat, summaries",
    speed: 4,
    minTier: "explorer",
    sortOrder: 10,
    openrouterId: "anthropic/claude-haiku-4.5",
    openrouterFamily: "anthropic/claude-haiku",
    upstreamName: "Claude Haiku 4.5",
    promptPrice: "0.000001",
    completionPrice: "0.000005",
    contextLength: 200000,
  },
  {
    id: "claude-balanced",
    name: "Claude Balanced",
    menuName: "Claude Balanced",
    provider: "Anthropic",
    providerColor: "#D4A27F",
    bestFor: "Writing, analysis, everyday coding",
    speed: 3,
    minTier: "holder",
    sortOrder: 20,
    openrouterId: "anthropic/claude-sonnet-4.5",
    openrouterFamily: "anthropic/claude-sonnet",
    upstreamName: "Claude Sonnet 4.5",
    promptPrice: "0.000003",
    completionPrice: "0.000015",
    contextLength: 200000,
  },
  {
    id: "claude-deep",
    name: "Claude Deep",
    menuName: "Claude Deep",
    provider: "Anthropic",
    providerColor: "#D4A27F",
    bestFor: "Hard reasoning, long documents",
    speed: 2,
    minTier: "holder",
    sortOrder: 30,
    openrouterId: "anthropic/claude-opus-4.5",
    openrouterFamily: "anthropic/claude-opus",
    upstreamName: "Claude Opus 4.5",
    promptPrice: "0.000005",
    completionPrice: "0.000025",
    contextLength: 200000,
  },
  {
    id: "gpt",
    name: "GPT",
    menuName: "OpenAI GPT",
    provider: "OpenAI",
    providerColor: "#74AA9C",
    bestFor: "General purpose, tool use",
    speed: 3,
    minTier: "holder",
    sortOrder: 40,
    openrouterId: "openai/gpt-5",
    openrouterFamily: "openai/gpt-",
    upstreamName: "GPT-5",
    promptPrice: "0.00000125",
    completionPrice: "0.00001",
    contextLength: 400000,
  },
  {
    id: "gemini",
    name: "Gemini",
    menuName: "Google Gemini",
    provider: "Google",
    providerColor: "#60A5FA",
    bestFor: "Long context, images",
    speed: 3,
    minTier: "holder",
    sortOrder: 50,
    openrouterId: "google/gemini-2.5-pro",
    openrouterFamily: "google/gemini-",
    upstreamName: "Gemini 2.5 Pro",
    promptPrice: "0.00000125",
    completionPrice: "0.00001",
    contextLength: 1048576,
  },
  {
    id: "llama",
    name: "Llama",
    menuName: "Meta Llama",
    provider: "Meta",
    providerColor: "#818CF8",
    bestFor: "Open weights, low cost",
    speed: 4,
    minTier: "explorer",
    sortOrder: 60,
    openrouterId: "meta-llama/llama-3.3-70b-instruct",
    openrouterFamily: "meta-llama/llama-",
    upstreamName: "Llama 3.3 70B Instruct",
    promptPrice: "0.00000013",
    completionPrice: "0.0000004",
    contextLength: 131072,
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    menuName: "DeepSeek",
    provider: "DeepSeek",
    providerColor: "#38BDF8",
    bestFor: "Math, code, budget reasoning",
    speed: 2,
    minTier: "explorer",
    sortOrder: 70,
    openrouterId: "deepseek/deepseek-chat-v3.1",
    openrouterFamily: "deepseek/deepseek-",
    upstreamName: "DeepSeek V3.1",
    promptPrice: "0.0000003",
    completionPrice: "0.0000012",
    contextLength: 163840,
  },
  {
    id: "mistral",
    name: "Mistral",
    menuName: "Mistral",
    provider: "Mistral",
    providerColor: "#FB923C",
    bestFor: "Fast multilingual, low cost",
    speed: 4,
    minTier: "explorer",
    sortOrder: 80,
    openrouterId: "mistralai/mistral-small-3.2-24b-instruct",
    openrouterFamily: "mistralai/mistral-small",
    upstreamName: "Mistral Small 3.2",
    promptPrice: "0.0000001",
    completionPrice: "0.0000003",
    contextLength: 131072,
  },
];

/** Public catalog row as served by GET /internal/catalog. */
export interface CatalogModel {
  id: string;
  name: string;
  menuName: string;
  provider: string;
  providerColor: string;
  bestFor: string;
  speed: number;
  minTier: Tier;
  upstreamName: string;
  /** USD per 1M tokens, null when unknown. */
  inputPerMTok: number | null;
  outputPerMTok: number | null;
  contextLength: number | null;
  live: boolean;
}

/** Static fallback used by the website if the API cannot be reached (for example during `next build`). */
export const STATIC_CATALOG: CatalogModel[] = MODEL_DEFS.map((m) => ({
  id: m.id,
  name: m.name,
  menuName: m.menuName,
  provider: m.provider,
  providerColor: m.providerColor,
  bestFor: m.bestFor,
  speed: m.speed,
  minTier: m.minTier,
  upstreamName: m.upstreamName,
  inputPerMTok: null,
  outputPerMTok: null,
  contextLength: null,
  live: true,
}));

export const MODEL_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
