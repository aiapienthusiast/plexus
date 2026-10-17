/**
 * Deterministic short-name derivation for model display names.
 *
 * Produces a compact, human-readable label (e.g. `Sonnet 5.5`, `DS 4.1 F`,
 * `GPT 6.1 Sol Pro`) from any of the three naming dialects Plexus ingests:
 * OpenRouter (`Vendor: Name …`), models.dev (bare names, hyphen/space mix,
 * `(latest)` tags), and OAuth/pi-ai sources (often bare kebab-case ids).
 *
 * Pure string operations only: no randomness, no dates, no locale dependence.
 * The same input always yields the same output. Collisions are possible for
 * near-identical models (e.g. dated snapshots sharing a display name) — the
 * explicit `short_name` metadata override exists for those cases.
 */

const MISTRAL_DISTINCT_FAMILIES = new Set([
  'codestral',
  'devstral',
  'ministral',
  'mixtral',
  'voxtral',
  'magistral',
  'saba',
  'nemo',
  'pixtral',
  'leanstral',
]);

/** Parenthetical content that is always dropped (case-insensitive). */
const DROPPED_PARENS = new Set(['latest', 'batch', 'free']);

/** Pure date/number parentheticals, e.g. `(2024-05-13)`, `(0902)`, `(08-2024)`. */
const DATE_PARENS = /^[\d\s\-/.,:]+$/;

/** Trailing build-date tokens, e.g. `0423`, `0731`, `1017`. */
const TRAILING_DATE_TOKEN = /^\d{3,4}$/;

/** Rest tokens contain a version signal (any digit). */
const HAS_DIGIT = /\d/;

/** Looks like a slug/id rather than a display name (`muse-spark-1.2`).
 * Display names contain spaces or mixed case; slugs don't. */
function looksLikeSlug(value: string): boolean {
  if (value.includes(' ')) return false;
  return /[/._]/.test(value) || (value === value.toLowerCase() && value.includes('-'));
}

const SLUG_ACRONYMS: Record<string, string> = {
  gpt: 'GPT',
  glm: 'GLM',
  chatgpt: 'ChatGPT',
  oss: 'OSS',
  api: 'API',
  ai: 'AI',
  llm: 'LLM',
  tts: 'TTS',
};

/** Humanize a slug/id segment: `muse-spark-1.2` → `Muse Spark 1.2`.
 *
 * Handles OpenRouter (`provider/model`), models.dev (`provider.model`), and
 * bare ids. Dots inside versions (`3.1`) are preserved: only a leading
 * dot-separated provider token (alpha word, remainder still slug-like) is
 * stripped.
 */
function humanizeSlug(value: string): string {
  let segment = value.split('/').at(-1) ?? value;
  const dotParts = segment.split('.');
  if (
    dotParts.length > 1 &&
    /^[a-z]+$/i.test(dotParts[0]!) &&
    /[-\d]/.test(dotParts.slice(1).join('.'))
  ) {
    segment = dotParts.slice(1).join('.');
  }
  return segment
    .split(/[-_]+/)
    .filter(Boolean)
    .map((token) => `${token[0]?.toUpperCase()}${token.slice(1)}`)
    .map((token) => {
      const acronym = SLUG_ACRONYMS[token.toLowerCase()];
      if (acronym) return acronym;
      // Size tokens: `120b` → `120B`, `a95b` → `A95B`, `2.4t` → `2.4T`.
      if (/^(\d[\d.]*[a-z]{1,2}|[a-z]\d+[a-z]{1,2})$/i.test(token)) {
        return token.toUpperCase();
      }
      return token;
    })
    .join(' ');
}

/** Does the token list contain technical image-model signal? */
function hasTechnicalImageSignal(tokens: string[]): boolean {
  const joined = tokens.join(' ').toLowerCase();
  return /\d/.test(joined) && /(gemini|gpt|image|flash|pro|claude|opus|sonnet|haiku)/.test(joined);
}

/**
 * Derive a short display name from a full model name.
 *
 * @param name Full display name (catalog `name`, possibly vendor-prefixed).
 * @param modelId Optional model id hint. Used when `name` is missing (or is
 *   itself a slug, as with Muse OAuth) and to reconstruct technical names for
 *   brand-only labels like models.dev's bare `Nano Banana 2`.
 * @returns The derived short name, or `undefined` when both inputs are blank.
 */
export function deriveShortName(name?: string, modelId?: string): string | undefined {
  const trimmedName = (name ?? '').trim();
  const trimmedId = (modelId ?? '').trim();

  let working = trimmedName;
  if (!working && trimmedId) {
    working = humanizeSlug(trimmedId);
  } else if (working && looksLikeSlug(working)) {
    // Slug-style name (Muse OAuth `name === id`, lowercase catalog names
    // like `o4-mini`): humanize before shortening.
    working = humanizeSlug(working);
  }
  if (!working) return undefined;

  // Strip `:batch` / ` (batch)` / ` (free)` suffixes.
  working = working
    .replace(/:batch\s*$/i, '')
    .replace(/\s*\((batch|free)\)\s*$/i, '')
    .trim();
  if (!working) return trimmedName;

  // Strip a leading `Vendor: ` prefix (OpenRouter dialect), remembering it.
  let vendor = '';
  const colonIdx = working.indexOf(':');
  if (colonIdx > 0) {
    const remainder = working.slice(colonIdx + 1).trim();
    if (remainder) {
      vendor = working.slice(0, colonIdx).trim();
      working = remainder;
    }
  }
  const vendorIsDeepSeek = /deepseek/i.test(vendor);

  // Nano Banana: prefer the technical `(Gemini … Image)` name when present.
  const bananaMatch = working.match(/^(nano\s+banana[^()]*)\(([^()]*)\)\s*$/i);
  if (bananaMatch) {
    const inner = bananaMatch[2]!.trim();
    const innerTokens = inner.split(/[\s\-_]+/).filter(Boolean);
    working = hasTechnicalImageSignal(innerTokens) ? inner : bananaMatch[1]!.trim();
  } else if (/^nano\s+banana\b/i.test(working) && !working.includes('(') && trimmedId) {
    // Brand-only label (models.dev dialect): reconstruct from the model id.
    const idTokens = humanizeSlug(trimmedId)
      .split(/[\s\-_]+/)
      .filter(Boolean);
    working = hasTechnicalImageSignal(idTokens) ? idTokens.join(' ') : working;
  }

  // Parenthetical triage.
  working = working
    .replace(/\(([^()]*)\)/g, (match, content: string) => {
      const inner = (content as string).trim();
      if (DROPPED_PARENS.has(inner.toLowerCase())) return '';
      if (DATE_PARENS.test(inner)) return '';
      if (/^\s*thinking\s*$/i.test(inner)) return '';
      if (/non[-\s]?reasoning/i.test(inner)) return '(NR)';
      if (/reasoning/i.test(inner)) return '(R)';
      return match;
    })
    .replace(/\s+/g, ' ')
    .trim();
  if (!working) return trimmedName;

  // DeepSeek: fold the (possibly duplicated) vendor word into `DS`.
  // models.dev names carry no `Vendor: ` prefix, so match the word too.
  const isDeepSeek = vendorIsDeepSeek || /^deepseek\s+/i.test(working);
  if (isDeepSeek) {
    working = working.replace(/^deepseek\s+/i, '');
    working = `DS ${working}`;
  }

  // Token-level normalization.
  let tokens = working.split(/[\s\-_]+/).filter(Boolean);
  tokens = tokens.filter((token) => !/^(thinking|instruct)$/i.test(token));
  tokens = tokens.map((token) => {
    if (/^flash$/i.test(token)) return 'F';
    if (/^nano$/i.test(token)) return 'Nano';
    if (isDeepSeek && /^pro$/i.test(token)) return 'P';
    if (isDeepSeek && /^v(\d.*)$/i.test(token)) return token.replace(/^v(\d.*)$/i, '$1');
    return token;
  });

  // Drop trailing build-date tokens when another version-like token exists,
  // and floating `Latest` tags (`chatgpt-image-latest`).
  let changed = true;
  while (changed && tokens.length > 1) {
    changed = false;
    const last = tokens.at(-1)!;
    if (/^latest$/i.test(last)) {
      tokens = tokens.slice(0, -1);
      changed = true;
    } else if (
      TRAILING_DATE_TOKEN.test(last) &&
      tokens.slice(0, -1).some((t) => HAS_DIGIT.test(t))
    ) {
      tokens = tokens.slice(0, -1);
      changed = true;
    }
  }

  // Family compaction.
  if (tokens.length > 1 && /^claude$/i.test(tokens[0]!)) tokens = tokens.slice(1);
  if (tokens.length > 1 && /^muse$/i.test(tokens[0]!)) tokens = tokens.slice(1);
  if (
    tokens.length > 2 &&
    /^open$/i.test(tokens[0]!) &&
    /^mistral$/i.test(tokens[1]!) &&
    tokens[2] &&
    MISTRAL_DISTINCT_FAMILIES.has(tokens[2].toLowerCase())
  ) {
    tokens = tokens.slice(2);
  } else if (
    tokens.length > 1 &&
    /^mistral$/i.test(tokens[0]!) &&
    tokens[1] &&
    MISTRAL_DISTINCT_FAMILIES.has(tokens[1].toLowerCase())
  ) {
    tokens = tokens.slice(1);
  }
  // Brand-only Banana fallback (no technical name available anywhere).
  if (tokens.length > 1 && /^nano$/i.test(tokens[0]!) && /^banana/i.test(tokens[1]!)) {
    tokens = ['Banana', ...tokens.slice(2)];
  }

  const result = tokens.join(' ').replace(/\s+/g, ' ').trim();
  return result || trimmedName;
}
