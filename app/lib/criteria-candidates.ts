import {
  DICTIONARY_VERSION,
  findNumberPatterns,
  scanDictionary,
  type DictionaryCategory,
  type DictionaryGroup,
  type DictionaryMatch,
  type NumberMatch,
} from "./criteria-dictionary";
import type { PdfStructureBlock } from "./pdf-structure";

export const CANDIDATE_SELECTOR_VERSION = "candidate-selector-v1";

export type CandidateSignal =
  | "OBLIGATION_TERM"
  | "PROHIBITION_TERM"
  | "MIN_MAX_PATTERN"
  | "NUMBER_UNIT_PATTERN"
  | "LANGUAGE_TEMPLATE_TERM"
  | "HEADING_CONTENT_TERM"
  | "CATEGORY_TERM"
  | "TECHNICAL_TERM"
  | "TABLE_RULE_ROW"
  | "NUMBERED_REQUIREMENT"
  | "EXCEPTION_OR_NEGATION"
  | "PHYSICAL_STAGE_TERM"
  | "EXTERNAL_EVIDENCE_TERM";

export type CriteriaCandidate = {
  block: PdfStructureBlock;
  selected: true;
  signals: CandidateSignal[];
  dictionaryMatches: DictionaryMatch[];
  numberMatches: NumberMatch[];
  selectionReason: string;
  contextBefore: string;
  contextAfter: string;
  dictionaryVersion: string;
  selectorVersion: string;
};

export type UnselectedCriteriaBlock = {
  block: PdfStructureBlock;
  selected: false;
  status: "OTOMATIK_TARAMADA_ADAY_SECILMEDI";
  signals: CandidateSignal[];
  dictionaryMatches: DictionaryMatch[];
  numberMatches: NumberMatch[];
  selectionReason: string;
  dictionaryVersion: string;
  selectorVersion: string;
};

export type CandidateSelection = {
  candidates: CriteriaCandidate[];
  unselected: UnselectedCriteriaBlock[];
  diagnostics: {
    totalBlocks: number;
    selectedBlocks: number;
    unselectedBlocks: number;
    dictionaryVersion: string;
    selectorVersion: string;
  };
};

const CATEGORY_SIGNAL: Partial<Record<DictionaryCategory, CandidateSignal>> = {
  obligation: "OBLIGATION_TERM",
  prohibition: "PROHIBITION_TERM",
  limit: "MIN_MAX_PATTERN",
  language_template: "LANGUAGE_TEMPLATE_TERM",
  heading_content: "HEADING_CONTENT_TERM",
  category: "CATEGORY_TERM",
  technical: "TECHNICAL_TERM",
  negation: "EXCEPTION_OR_NEGATION",
  physical_stage: "PHYSICAL_STAGE_TERM",
  external_evidence: "EXTERNAL_EVIDENCE_TERM",
};

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function signalsFor(block: PdfStructureBlock, matches: DictionaryMatch[], numbers: NumberMatch[]): CandidateSignal[] {
  const signals = matches.flatMap((match) => CATEGORY_SIGNAL[match.category] ? [CATEGORY_SIGNAL[match.category]!] : []);
  if (matches.some((match) => match.negated)) signals.push("EXCEPTION_OR_NEGATION");
  if (numbers.some((match) => ["sayi_birim", "yuzde", "aralik", "sayfa_adet", "tarih_sure"].includes(match.kind))) {
    signals.push("NUMBER_UNIT_PATTERN");
  }
  if (block.blockType === "TABLE_ROW") signals.push("TABLE_RULE_ROW");
  if (block.blockType === "NUMBERED_CLAUSE" || block.clauseNumber) signals.push("NUMBERED_REQUIREMENT");
  return unique(signals);
}

function has(matches: DictionaryMatch[], category: DictionaryCategory, onlyPositive = false): boolean {
  return matches.some((match) => match.category === category && (!onlyPositive || !match.negated));
}

function selectionDecision(block: PdfStructureBlock, matches: DictionaryMatch[], numbers: NumberMatch[]): { selected: boolean; reason: string } {
  const obligation = has(matches, "obligation", true);
  const prohibition = has(matches, "prohibition");
  const limit = has(matches, "limit", true);
  const language = has(matches, "language_template");
  const heading = has(matches, "heading_content");
  const category = has(matches, "category");
  const technical = has(matches, "technical");
  const meaningfulNumber = numbers.some((match) => match.kind !== "sayi");
  const explicitRule = obligation || prohibition || limit;

  if (explicitRule) return { selected: true, reason: "Açık zorunluluk, yasak veya sınır ifadesi bulundu." };
  if (meaningfulNumber && technical) return { selected: true, reason: "Teknik terim ile sayısal değer/birim birlikte bulundu." };
  if (language && (meaningfulNumber || heading)) return { selected: true, reason: "Dil/şablon terimi bir biçim veya içerik sinyaliyle birlikte bulundu." };
  if (heading && /rapor(?:da|un|u)?\s|yer al|icer/i.test(block.normalizedText)) {
    return { selected: true, reason: "Raporun başlık veya içerik yapısına ilişkin ifade bulundu." };
  }
  if (category && /uygun|kapsam|beklenen|ait|yonelik/i.test(block.normalizedText)) {
    return { selected: true, reason: "Projenin yarışma kapsamına uygunluğuna ilişkin ifade bulundu." };
  }
  if ((block.blockType === "TABLE_ROW" || Boolean(block.clauseNumber)) && meaningfulNumber && (technical || language)) {
    return { selected: true, reason: "Yapısal kural satırında ölçülebilir bir gereksinim bulundu." };
  }
  return { selected: false, reason: "Kriter adaylığı için yeterli ve açıklanabilir sinyal birleşimi bulunmadı." };
}

export function selectCriteriaCandidates(
  blocks: readonly PdfStructureBlock[],
  extraGroups: readonly DictionaryGroup[] = [],
): CandidateSelection {
  const candidates: CriteriaCandidate[] = [];
  const unselected: UnselectedCriteriaBlock[] = [];
  blocks.forEach((block, index) => {
    const dictionaryMatches = scanDictionary(block.normalizedText, extraGroups);
    const numberMatches = findNumberPatterns(block.normalizedText);
    const signals = signalsFor(block, dictionaryMatches, numberMatches);
    const decision = selectionDecision(block, dictionaryMatches, numberMatches);
    if (decision.selected) {
      candidates.push({
        block,
        selected: true,
        signals,
        dictionaryMatches,
        numberMatches,
        selectionReason: decision.reason,
        contextBefore: blocks[index - 1]?.pageNumber === block.pageNumber ? blocks[index - 1].originalText : "",
        contextAfter: blocks[index + 1]?.pageNumber === block.pageNumber ? blocks[index + 1].originalText : "",
        dictionaryVersion: DICTIONARY_VERSION,
        selectorVersion: CANDIDATE_SELECTOR_VERSION,
      });
    } else {
      unselected.push({
        block,
        selected: false,
        status: "OTOMATIK_TARAMADA_ADAY_SECILMEDI",
        signals,
        dictionaryMatches,
        numberMatches,
        selectionReason: decision.reason,
        dictionaryVersion: DICTIONARY_VERSION,
        selectorVersion: CANDIDATE_SELECTOR_VERSION,
      });
    }
  });
  return {
    candidates,
    unselected,
    diagnostics: {
      totalBlocks: blocks.length,
      selectedBlocks: candidates.length,
      unselectedBlocks: unselected.length,
      dictionaryVersion: DICTIONARY_VERSION,
      selectorVersion: CANDIDATE_SELECTOR_VERSION,
    },
  };
}

export function formatCandidatesForLlm(candidates: readonly CriteriaCandidate[]): string {
  return candidates.map((candidate, index) => {
    const matches = candidate.dictionaryMatches.map((match) => `${match.entryId}: ${match.text}${match.negated ? " [OLUMSUZLANMIS]" : ""}`);
    const numbers = candidate.numberMatches.filter((match) => match.kind !== "sayi").map((match) => `${match.kind}: ${match.text}`);
    return [
      `ADAY ${index + 1}`,
      `sourceId: ${candidate.block.sourceId}`,
      `page: ${candidate.block.pageNumber}`,
      `section: ${candidate.block.sectionTitle || "(başlık yok)"}`,
      `subsection: ${candidate.block.subsectionTitle || "(alt başlık yok)"}`,
      `clause: ${candidate.block.clauseNumber ?? "(madde numarası yok)"}`,
      `type: ${candidate.block.blockType}`,
      `text: ${candidate.block.originalText}`,
      candidate.contextBefore ? `contextBefore: ${candidate.contextBefore}` : "",
      candidate.contextAfter ? `contextAfter: ${candidate.contextAfter}` : "",
      `selectionReason: ${candidate.selectionReason}`,
      `signals: ${candidate.signals.join(", ") || "yok"}`,
      `matches: ${[...matches, ...numbers].join(" | ") || "yok"}`,
    ].filter(Boolean).join("\n");
  }).join("\n\n---\n\n");
}
