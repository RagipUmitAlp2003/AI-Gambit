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
import type { UnselectedBlocksReview } from "./types";
import { normalizeForSearch } from "./turkish-text";

export const CANDIDATE_SELECTOR_VERSION = "candidate-selector-v4-local-context-hints";

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
  /** Yalnızca anlam bağlamıdır; bu metinden başka sayfaya alıntı bağlanamaz. */
  listContext?: string;
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
  const reportContext = /\b(?:rapor|pdf|dosya|tyr|ktr|on tasarim|kritik tasarim)\w*\b/i.test(block.normalizedText)
    || /\b(?:rapor|pdf|tyr|ktr|on tasarim|kritik tasarim)\w*\b/i.test(normalizeForSearch(block.sectionTitle ?? ""));

  if (language && (explicitRule || meaningfulNumber || reportContext || heading)) {
    return { selected: true, reason: "Raporun dil, dosya veya şablon düzenine ilişkin sinyal bulundu." };
  }
  if (heading && (explicitRule || reportContext || ["HEADING", "LIST_ITEM", "NUMBERED_CLAUSE"].includes(block.blockType))) {
    return { selected: true, reason: "Raporun başlık veya içerik yapısına ilişkin ifade bulundu." };
  }
  if (category && /uygun|kapsam|beklenen|ait|yonelik|amac|cozulmesi|hedef problem/i.test(block.normalizedText)
    && block.originalText.length > 40) {
    return { selected: true, reason: "Projenin yarışma kapsamına uygunluğuna ilişkin ifade bulundu." };
  }
  // Dördüncü aşama (criteria_evidence): teknik/fiziksel kurallar da aday olur.
  // Aday seçimi kapsam kararı DEĞİLDİR; fiziksel veya haricî ifadeler silinmez,
  // sinyalleriyle birlikte LLM kapsam kararına taşınır.
  if (explicitRule) return { selected: true, reason: "Açık zorunluluk, yasak veya sınır ifadesi bulundu." };
  if (technical && /beklen(?:ir|mektedir)|bulundur|saglama|sahip ol|tavsiye|oneril|istege bagli|opsiyonel/.test(block.normalizedText)) {
    return { selected: true, reason: "Teknik özellik için beklenti veya isteğe bağlı gereksinim bulundu." };
  }
  if (meaningfulNumber && technical) return { selected: true, reason: "Teknik terim ile sayısal değer/birim birlikte bulundu." };
  if ((block.blockType === "TABLE_ROW" || Boolean(block.clauseNumber)) && meaningfulNumber && (technical || language)) {
    return { selected: true, reason: "Yapısal kural satırında ölçülebilir bir gereksinim bulundu." };
  }
  return { selected: false, reason: "Kriter adaylığı için yeterli ve açıklanabilir sinyal birleşimi bulunmadı." };
}

/** Listedeki kısa maddeler kendi başlarına zorunluluk fiili taşımayabilir. */
function reportListContext(blocks: readonly PdfStructureBlock[], index: number): string {
  const current = blocks[index];
  if (current.originalText.length > 240) return "";
  for (let previous = index - 1; previous >= Math.max(0, index - 16); previous -= 1) {
    const item = blocks[previous];
    if (item.pageNumber !== current.pageNumber) break;
    const value = item.normalizedText;
    if (/[:：]\s*$/.test(item.originalText)
      && /\b(?:rapor|pdf|ktr|tyr)\w*\b/.test(value)
      && /icer|bulun|yer al|bolum|baslik/.test(value)) {
      return item.originalText;
    }
    if (item.originalText.length > 240
      || !["LIST_ITEM", "HEADING", "TABLE_ROW", "NUMBERED_CLAUSE"].includes(item.blockType)) break;
  }
  return "";
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
    const listContext = reportListContext(blocks, index);
    const decision = listContext
      ? { selected: true, reason: "Rapor içerik listesinin alt maddesi; liste girişinin bağlamı korundu." }
      : selectionDecision(block, dictionaryMatches, numberMatches);
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
        ...(listContext ? { listContext } : {}),
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

/** İnceleme özetine alınan en fazla blok sayısı; üstü `omittedCount` ile açıkça bildirilir. */
export const UNSELECTED_REVIEW_BLOCK_LIMIT = 2000;
/** Özetteki tek blok metninin karakter tavanı; kesinti blok üstünde `textTruncated` ile işaretlenir. */
export const UNSELECTED_REVIEW_TEXT_LIMIT = 600;

/**
 * Seçilmeyen blokların yönetici inceleme özeti (Spec §8: hiçbir blok sessizce
 * kapsam dışı sayılmaz; karar insanda kalır).
 *
 * Özet BİLEREK hiçbir sinyal filtresi uygulamaz: sözlük dışı bir ifadeyle
 * yazılmış bağlayıcı kural tam da hiç sinyal almadığı için seçilmemiştir;
 * özeti sinyale göre süzmek onu yeniden görünmez kılardı. Belge sırası
 * korunur ve kesintiler sessiz değildir — metin kısaltması blok üstünde
 * `textTruncated`, liste tavanı `omittedCount` ile taşınır; ikisi de arayüzde
 * gösterilir. Tam iz her durumda R2 denetim kaydındadır.
 */
export function summarizeUnselectedBlocks(
  unselected: readonly UnselectedCriteriaBlock[],
  limit = UNSELECTED_REVIEW_BLOCK_LIMIT,
): UnselectedBlocksReview {
  const blocks = unselected.slice(0, limit).map((item) => ({
    sourceId: item.block.sourceId,
    page: item.block.pageNumber,
    sectionTitle: item.block.sectionTitle,
    blockType: item.block.blockType,
    text: item.block.originalText.slice(0, UNSELECTED_REVIEW_TEXT_LIMIT),
    textTruncated: item.block.originalText.length > UNSELECTED_REVIEW_TEXT_LIMIT,
    reason: item.selectionReason,
  }));
  return {
    totalCount: unselected.length,
    listedCount: blocks.length,
    omittedCount: unselected.length - blocks.length,
    blocks,
  };
}

export function formatCandidatesForLlm(candidates: readonly CriteriaCandidate[]): string {
  return candidates.map((candidate, index) => {
    const matches = candidate.dictionaryMatches.map((match) => `${match.entryId}: ${match.text}${match.negated ? " [OLUMSUZLANMIS]" : ""}`);
    const numbers = candidate.numberMatches.filter((match) => match.kind !== "sayi").map((match) => `${match.kind}: ${match.text}`);
    // Bunlar ELEME KAPISI DEĞİLDİR: aday, alıntı ve sinyaller eksiksiz gider.
    // Uzun girdide genel talimatın unutulmaması için ilgili metnin yanında
    // yoruma dair uyarı verilir; kapsam kararını yine LLM verir.
    const text = candidate.block.normalizedText;
    const interpretationHints: string[] = [];
    if (/sayfa/.test(text) && /dahil/.test(text) && /kapak|icindekiler|referans/.test(text)) {
      interpretationHints.push("Sayfa hesabına dahil edilen parçalar listeleniyor. Bu liste tek başına zorunlu rapor başlığı/içeriği değildir; ayrıca açık bir içerik yükümlülüğü yoksa yalnızca sayfa sınırını çıkar.");
    }
    if (/asama|parkur|yarisma|gorev/.test(text)
      && /gosterecek|gerceklestiril|tespit edecek|olculecek|olculmesi/.test(text)) {
      interpretationHints.push("Bu adayda yarışmada yapılacak/gösterilecek/ölçülecek eylemler var. Bu eylemlerden tasarım yükümlülüğü türetme. Ayrı ve açık bir tasarım sınırı yoksa KAPSAM_DISI; sistemin özne olması yeterli değildir.");
    }
    return [
      `ADAY ${index + 1}`,
      `sourceId: ${candidate.block.sourceId}`,
      `page: ${candidate.block.pageNumber}`,
      `section: ${candidate.block.sectionTitle || "(başlık yok)"}`,
      `subsection: ${candidate.block.subsectionTitle || "(alt başlık yok)"}`,
      `clause: ${candidate.block.clauseNumber ?? "(madde numarası yok)"}`,
      `type: ${candidate.block.blockType}`,
      `text: ${candidate.block.originalText}`,
      interpretationHints.length ? `interpretationHints (talimat; kaynak alıntısı değil): ${interpretationHints.join(" ")}` : "",
      candidate.listContext ? `listContext (yalnızca yorumlama için, alıntı için değil): ${candidate.listContext}` : "",
      candidate.contextBefore ? `contextBefore: ${candidate.contextBefore}` : "",
      candidate.contextAfter ? `contextAfter: ${candidate.contextAfter}` : "",
      `selectionReason: ${candidate.selectionReason}`,
      `signals: ${candidate.signals.join(", ") || "yok"}`,
      `matches: ${[...matches, ...numbers].join(" | ") || "yok"}`,
    ].filter(Boolean).join("\n");
  }).join("\n\n---\n\n");
}
