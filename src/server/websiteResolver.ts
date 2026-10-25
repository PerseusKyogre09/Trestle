import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { readiness } from "../domain/engine";
import type { Action, Case } from "../domain/types";

export type WebsiteSelection = {
  actionId: string;
  actionTitle: string;
  url: string;
  allowedDomain: string;
  institution: string | null;
  source: "persisted_tinyfish_research" | "verified_issuer_directory" | "official_reporting_directory" | "explicit_test_mode" | "development_custom_url";
  reason: string;
};

export type WebsiteResolution =
  | { kind: "selected"; selection: WebsiteSelection }
  | { kind: "clarification"; message: string; actionId: string; actionTitle: string }
  | { kind: "unavailable"; message: string; actionId: string | null; actionTitle: string | null };

// Exact institution aliases and public support pages verified against the institution's own domain.
// Never infer an issuer from card type, location, or an unrelated case detail.
const issuerDirectory = [
  { name: "HDFC Bank", aliases: ["hdfc", "hdfc bank"], domain: "hdfc.bank.in", url: "https://www.hdfc.bank.in/credit-cards/block-loststolen-card" },
  { name: "ICICI Bank", aliases: ["icici", "icici bank"], domain: "icici.bank.in", url: "https://www.icici.bank.in/personal-banking/cards/credit-card/block-credit-card" },
  { name: "State Bank of India", aliases: ["state bank of india", "sbi bank"], domain: "sbi.bank.in", url: "https://sbi.bank.in/web/faq-s/faq-atm-services" },
  { name: "SBI Card", aliases: ["sbi card", "sbi cards"], domain: "sbicard.com", url: "https://www.sbicard.com/en/faq/lost-stolen-reissue-replace-cards.page" },
  { name: "Axis Bank", aliases: ["axis", "axis bank"], domain: "axis.bank.in", url: "https://www.axis.bank.in/cards/credit-card" },
] as const;

// Indian banks have migrated their public sites to RBI's .bank.in namespace.
// Permit only these verified migration redirects for sessions created before
// the resolver directory was updated; never broaden this to arbitrary banks.
const officialMigrationAliases: Record<string, string[]> = {
  "sbi.co.in": ["sbi.bank.in"],
  "hdfcbank.com": ["hdfc.bank.in"],
  "axisbank.com": ["axis.bank.in"],
};

function isSafePublicHttps(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname || url.port) return null;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || /^\d+(\.\d+){3}$/.test(host) || host.includes(":")) return null;
    return url;
  } catch {
    return null;
  }
}

function firstEligibleAction(actions: Action[]): Action | null {
  const ordered = [...actions].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || a.createdAt.localeCompare(b.createdAt));
  const ready = new Map(readiness(ordered).map((item) => [item.id, item]));
  return ordered.find((action) => !["completed", "failed"].includes(action.status)
    && ready.get(action.id)?.ready) ?? null;
}

function matchingIssuer(text: string): (typeof issuerDirectory)[number] | null | "ambiguous" {
  const normalized = text.toLowerCase();
  if (/(^|[^a-z0-9])sbi([^a-z0-9]|$)/.test(normalized)) {
    if (/\bcredit\b/.test(normalized)) return issuerDirectory.find((item) => item.name === "SBI Card")!;
    if (/\b(debit|atm)\b/.test(normalized)) return issuerDirectory.find((item) => item.name === "State Bank of India")!;
    return "ambiguous";
  }
  const matches = issuerDirectory.filter((issuer) => issuer.aliases.some((alias) =>
    new RegExp(`(^|[^a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i").test(normalized)
  ));
  if (matches.length > 1) return "ambiguous";
  return matches[0] ?? null;
}

function officialPageRelevance(url: string, action: Action, researchAction: Action): number {
  const parsed = isSafePublicHttps(url);
  if (!parsed) return Number.NEGATIVE_INFINITY;
  let pathname = parsed.pathname;
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    // Malformed escapes do not make a verified URL unsafe; score its raw path.
  }
  const page = `${parsed.hostname} ${pathname}`.toLowerCase();
  const context = `${action.title} ${action.description}`.toLowerCase();
  const researchContext = `${researchAction.title} ${researchAction.description}`.toLowerCase();
  const stopWords = new Set(["this", "that", "with", "from", "your", "their", "about", "official", "public", "guidance", "requirements", "records", "following", "relevant", "current", "step", "review", "prepare", "find", "research", "and", "the", "for"]);
  const terms = [...new Set(context.match(/[a-z]{4,}/g) ?? [])].filter((term) => !stopWords.has(term));
  const matches = terms.filter((term) => page.includes(term));
  // A URL must have at least one page/path term tied to the active step.
  // A source from an unrelated ancestor research action is not enough.
  if (matches.length === 0) return Number.NEGATIVE_INFINITY;
  const researchTerms = [...new Set(researchContext.match(/[a-z]{4,}/g) ?? [])].filter((term) => !stopWords.has(term));
  let score = matches.reduce((total, term) => total + (parsed.pathname.toLowerCase().includes(term) ? 3 : 1), 0);
  score += researchTerms.filter((term) => page.includes(term)).length * 0.25;
  const pathSegments = parsed.pathname.split("/").filter(Boolean);
  score += Math.min(pathSegments.length, 5) * 0.2;
  if (pathSegments.length === 0) score -= 2;
  return score;
}

function persistedOfficialSource(actions: Action[], action: Action): { url: string; domain: string } | null {
  const byId = new Map(actions.map((item) => [item.id, item]));
  const ancestors = new Set<string>();
  const visit = (current: Action) => {
    for (const dependency of current.dependencies) {
      if (ancestors.has(dependency)) continue;
      ancestors.add(dependency);
      const parent = byId.get(dependency);
      if (parent) visit(parent);
    }
  };
  visit(action);
  const ordered = [action, ...actions.filter((item) => ancestors.has(item.id)).sort((a, b) => (b.sequence ?? 0) - (a.sequence ?? 0))];
  for (const candidate of ordered) {
    for (const attempt of [...(candidate.executionAttempts ?? [])].reverse()) {
      if (attempt.status !== "succeeded" || attempt.isSimulated || !attempt.resultDetails) continue;
      try {
        const details = JSON.parse(attempt.resultDetails) as { officialSourceUrls?: unknown };
        const urls = Array.isArray(details.officialSourceUrls) ? details.officialSourceUrls : [];
        const safe = urls
          .filter((value): value is string => typeof value === "string" && isSafePublicHttps(value) !== null)
          .map((url) => ({ url, relevance: officialPageRelevance(url, action, candidate) }))
          .filter((item) => Number.isFinite(item.relevance))
          .sort((left, right) => right.relevance - left.relevance)[0]?.url;
        if (safe) {
          const parsed = isSafePublicHttps(safe)!;
          return { url: safe, domain: parsed.hostname.toLowerCase() };
        }
      } catch {
        // Ignore malformed persisted provider details; never infer a source from them.
      }
    }
  }
  return null;
}

export function resolveCaseWebsite(input: {
  caseItem: Pick<Case, "title" | "description" | "originalInput" | "actions">;
  institution?: string;
}): WebsiteResolution {
  const action = firstEligibleAction(input.caseItem.actions);
  if (!action) return { kind: "unavailable", message: "There is no eligible unfinished action in this case. Complete its prerequisites or review the workflow status.", actionId: null, actionTitle: null };

  if (input.caseItem.actions.some((item) => item.id === "classify-reporting-route")) {
    const classification = input.caseItem.actions.find((item) => item.id === "classify-reporting-route")?.evidence
      .find((item) => item.kind === "user_provided")?.note.toLowerCase() ?? "";
    const route = classification.includes("ordinary unsolicited")
      ? { url: "https://trai.gov.in/complain-or-report-against-ucc", domain: "trai.gov.in", name: "Telecom Regulatory Authority of India", reason: "The user classified this as ordinary unsolicited commercial communication. This official TRAI page explains the difference between a complaint and a report and routes both through the user's telecom provider; a number alone does not prove wrongdoing." }
      : classification.includes("suspected cybercrime")
      ? { url: "https://cybercrime.gov.in/webform/cyber_suspect.aspx", domain: "cybercrime.gov.in", name: "National Cyber Crime Reporting Portal", reason: "The user described an attempted cybercrime or impersonation. Report Suspect accepts identifiers connected to attempted cybercrime; it is not a finding that the identifier committed an offense." }
      : classification.includes("money lost")
      ? { url: "https://cybercrime.gov.in/", domain: "cybercrime.gov.in", name: "National Cyber Crime Reporting Portal", reason: "The user reports financial loss. The portal directs victims to report immediately; 1930 is the national cyber-fraud helpline. This is separate from the Report Suspect repository." }
      : null;
    if (!route) return {
      kind: "clarification",
      actionId: action.id,
      actionTitle: action.title,
      message: "First classify what happened: ordinary unwanted promotion, a suspected impersonation/phishing attempt, or money already lost. TRESTLE will then select the appropriate official route; it will not infer wrongdoing from the number alone.",
    };
    return { kind: "selected", selection: {
      actionId: action.id, actionTitle: action.title, url: route.url,
      allowedDomain: route.domain, institution: route.name,
      source: "official_reporting_directory", reason: route.reason,
    } };
  }

  const actionText = `${action.title} ${action.description}`.toLowerCase();
  const caseText = `${input.caseItem.title} ${input.caseItem.description} ${input.caseItem.originalInput}`;
  const institutionText = input.institution?.trim() || caseText;
  const issuerMentioned = /credit\s*card|debit\s*card|bank|card issuer/i.test(`${actionText} ${caseText}`);
  if (issuerMentioned) {
    const issuer = matchingIssuer(institutionText);
    if (issuer === null || issuer === "ambiguous") {
      return {
        kind: "clarification",
        actionId: action.id,
        actionTitle: action.title,
        message: issuer === "ambiguous"
          ? "More than one bank appears in this case. Enter the specific card-issuing bank before opening its site."
          : "Which bank issued the lost card? Enter its name so TRESTLE can open the bank's verified public website. Do not enter card numbers, passwords, or OTPs.",
      };
    }
    return {
      kind: "selected",
      selection: {
        actionId: action.id,
        actionTitle: action.title,
        url: issuer.url,
        allowedDomain: issuer.domain,
        institution: issuer.name,
        source: "verified_issuer_directory",
        reason: `This is ${issuer.name}'s public card-support page, selected for the current action “${action.title}”. Public browsing only; account access and card blocking remain user-controlled.`,
      },
    };
  }

  const source = persistedOfficialSource(input.caseItem.actions, action);
  if (source) {
    return {
      kind: "selected",
      selection: {
        actionId: action.id,
        actionTitle: action.title,
        url: source.url,
        allowedDomain: source.domain,
        institution: null,
        source: "persisted_tinyfish_research",
        reason: `Selected from a non-simulated TinyFish official-source result associated with this workflow. It supports “${action.title}”; the page content remains untrusted and the action's own success criteria still apply.`,
      },
    };
  }
  return {
    kind: "unavailable",
    actionId: action.id,
    actionTitle: action.title,
    message: `The current action is “${action.title}”, but this case has no persisted verified official source for it yet. Run its approved public research first; TRESTLE will not guess a website.`,
  };
}

export function isAllowedCaseNavigation(raw: string, allowedDomain: string): boolean {
  const url = isSafePublicHttps(raw);
  if (!url) return false;
  const host = url.hostname.toLowerCase();
  const domains = [allowedDomain.toLowerCase(), ...(officialMigrationAliases[allowedDomain.toLowerCase()] ?? [])];
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function isPublicIpAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const octets = address.split(".").map(Number);
    const [a, b, c] = octets;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 168 || (b === 0 && c === 0) || (b === 88 && c === 99))) return false;
    if (a === 198 && (b === 18 || b === 19 || b === 51)) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  if (version !== 6) return false;
  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    const ipv4Part = normalized.slice("::ffff:".length);
    if (isIP(ipv4Part) === 4) return isPublicIpAddress(ipv4Part);
    return false;
  }
  const firstHextet = Number.parseInt(normalized.split(":")[0] || "0", 16);
  // Only global-unicast IPv6 (2000::/3) is allowed; exclude documentation space.
  return firstHextet >= 0x2000 && firstHextet <= 0x3fff && !normalized.startsWith("2001:db8:");
}

// Navigation is checked once before Page.navigate and again when Chromium's
// Document request is intercepted. Re-resolving between those two checks can
// turn a transient DNS failure into ERR_BLOCKED_BY_CLIENT after the first
// check already accepted the same public host. Cache only positive public
// resolutions briefly; redirects to a different host still get checked.
const publicHostCache = new Map<string, { expiresAt: number; addresses: string[] }>();
const publicHostCacheTtlMs = 30_000;

export async function isSafeDevelopmentUrl(raw: string): Promise<URL | null> {
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !url.hostname) return null;
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (!hostname.includes(".") || /\.(localhost|local|internal|intranet|lan|home|home\.arpa|test|example|invalid)$/.test(hostname)) return null;
    if (isIP(hostname) !== 0) return null;
    const cached = publicHostCache.get(hostname);
    let addresses = cached && cached.expiresAt > Date.now() ? cached.addresses : null;
    if (!addresses) {
      const resolved = await lookup(hostname, { all: true, verbatim: true });
      addresses = resolved.map(({ address }) => address);
      if (addresses.length > 0 && addresses.every(isPublicIpAddress)) {
        publicHostCache.set(hostname, { addresses, expiresAt: Date.now() + publicHostCacheTtlMs });
      }
    }
    if (addresses.length === 0 || addresses.some((address) => !isPublicIpAddress(address))) return null;
    return url;
  } catch {
    return null;
  }
}

export async function isAllowedNavigation(raw: string, allowedDomain: string): Promise<boolean> {
  if (allowedDomain === "*") return (await isSafeDevelopmentUrl(raw)) !== null;
  return isAllowedCaseNavigation(raw, allowedDomain);
}
