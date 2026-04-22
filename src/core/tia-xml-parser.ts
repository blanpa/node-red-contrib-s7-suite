/**
 * Parser for TIA Portal PLC tag table XML exports.
 *
 * TIA Portal (V13+) replaces the old STEP 7 V5 .cfg format. A tag table is
 * exported via "PLC tags → <table> → Export" and produces an XML file that
 * describes `SW.Tags.PlcTagTable` containers with nested `SW.Tags.PlcTag`
 * and `SW.Tags.PlcUserConstant` records. Each tag has an `AttributeList`
 * (Name, DataTypeName, LogicalAddress) and, optionally, a multilingual
 * `Comment` block.
 *
 * TIA-XML is verbose but structurally deterministic — we parse it with a
 * targeted regex+state-machine extractor instead of adding an XML dependency.
 */

export interface TiaTagTable {
  name: string;
  tagCount: number;
}

export interface TiaTag {
  name: string;
  /** IEC-style address, e.g. "I0.0", "MW20", "DB1.DBW2". Empty for symbolic-only tags. */
  address: string;
  /** TIA data type name as exported, e.g. "Bool", "Int", "Real", "Word", "DInt". */
  dataTypeName: string;
  comment: string;
  /** Tag-table name for grouping / display. */
  source: string;
  /** True for SW.Tags.PlcUserConstant (a symbolic constant, not an address). */
  isConstant?: boolean;
  /** Raw constant value, only set when isConstant === true. */
  value?: string;
}

export interface TiaParseResult {
  /** TIA Portal engineering version if present in the file header. */
  engineeringVersion?: string;
  tables: TiaTagTable[];
  tags: TiaTag[];
  warnings: string[];
}

const TABLE_RE = /<SW\.Tags\.PlcTagTable\b[^>]*>([\s\S]*?)<\/SW\.Tags\.PlcTagTable>/g;
const TAG_RE = /<SW\.Tags\.(PlcTag|PlcUserConstant)\b[^>]*>([\s\S]*?)<\/SW\.Tags\.\1>/g;
const ATTR_LIST_RE = /<AttributeList\b[^>]*>([\s\S]*?)<\/AttributeList>/;
const NAME_RE = /<Name\b[^>]*>([\s\S]*?)<\/Name>/;
const DATA_TYPE_RE = /<DataTypeName\b[^>]*>([\s\S]*?)<\/DataTypeName>/;
const ADDRESS_RE = /<LogicalAddress\b[^>]*>([\s\S]*?)<\/LogicalAddress>/;
const VALUE_RE = /<Value\b[^>]*>([\s\S]*?)<\/Value>/;
const COMMENT_BLOCK_RE = /<MultilingualText\b[^>]*CompositionName="Comment"[^>]*>([\s\S]*?)<\/MultilingualText>/;
const COMMENT_ITEM_RE = /<MultilingualTextItem\b[^>]*>([\s\S]*?)<\/MultilingualTextItem>/g;
const CULTURE_RE = /<Culture\b[^>]*>([\s\S]*?)<\/Culture>/;
const TEXT_RE = /<Text\b[^>]*>([\s\S]*?)<\/Text>/;
const ENGINEERING_RE = /<Engineering\b[^>]*\bversion\s*=\s*"([^"]+)"/;

/** Locale order when several translations of a comment are present. */
const PREFERRED_CULTURES = ['de-DE', 'en-US', 'en-GB', 'fr-FR', 'it-IT'];

/** Parses a TIA Portal tag-table XML export into a flat tag list. */
export function parseTiaXml(content: string): TiaParseResult {
  const warnings: string[] = [];
  const result: TiaParseResult = { tables: [], tags: [], warnings };

  const engMatch = content.match(ENGINEERING_RE);
  if (engMatch) result.engineeringVersion = engMatch[1];

  // Strip root-level tables first. If no table wrapper is present, fall back to
  // treating the whole document as a single unnamed table — some hand-edited
  // exports omit the wrapper.
  const matches = Array.from(content.matchAll(TABLE_RE));
  if (matches.length === 0) {
    const tableBody = content;
    const { tags } = extractTags(tableBody, '(root)', warnings);
    if (tags.length > 0) {
      result.tables.push({ name: '(root)', tagCount: tags.length });
      result.tags.push(...tags);
    }
    return result;
  }

  for (const m of matches) {
    const tableBody = m[1];
    const attrBlock = tableBody.match(ATTR_LIST_RE);
    const nameMatch = attrBlock && attrBlock[1].match(NAME_RE);
    const tableName = nameMatch ? decodeXmlText(nameMatch[1]) : '(unnamed table)';
    const { tags } = extractTags(tableBody, tableName, warnings);
    result.tables.push({ name: tableName, tagCount: tags.length });
    result.tags.push(...tags);
  }

  return result;
}

function extractTags(body: string, tableName: string, warnings: string[]): { tags: TiaTag[] } {
  const tags: TiaTag[] = [];
  for (const m of body.matchAll(TAG_RE)) {
    const kind = m[1];
    const recordBody = m[2];
    const tag = extractSingleTag(recordBody, kind === 'PlcUserConstant', tableName, warnings);
    if (tag) tags.push(tag);
  }
  return { tags };
}

function extractSingleTag(
  recordBody: string,
  isConstant: boolean,
  tableName: string,
  warnings: string[],
): TiaTag | null {
  const attrBlock = recordBody.match(ATTR_LIST_RE);
  if (!attrBlock) return null;
  const attrs = attrBlock[1];
  const nameMatch = attrs.match(NAME_RE);
  if (!nameMatch) return null;
  const name = decodeXmlText(nameMatch[1]);

  const dataTypeMatch = attrs.match(DATA_TYPE_RE);
  const dataTypeName = dataTypeMatch ? decodeXmlText(dataTypeMatch[1]) : '';

  let address = '';
  let value: string | undefined;
  if (isConstant) {
    const vm = attrs.match(VALUE_RE);
    if (vm) value = decodeXmlText(vm[1]);
  } else {
    const addrMatch = attrs.match(ADDRESS_RE);
    if (addrMatch) address = decodeXmlText(addrMatch[1]).replace(/^%/, '');
  }

  const comment = extractComment(recordBody);
  if (!address && !isConstant) {
    warnings.push(`Tag "${name}" in "${tableName}" has no LogicalAddress — skipping`);
    return null;
  }

  const tag: TiaTag = {
    name,
    address,
    dataTypeName,
    comment,
    source: tableName,
  };
  if (isConstant) {
    tag.isConstant = true;
    if (value !== undefined) tag.value = value;
  }
  return tag;
}

function extractComment(recordBody: string): string {
  const block = recordBody.match(COMMENT_BLOCK_RE);
  if (!block) return '';
  const items = Array.from(block[1].matchAll(COMMENT_ITEM_RE));
  if (items.length === 0) return '';

  const translations: Record<string, string> = {};
  for (const it of items) {
    const body = it[1];
    const culture = body.match(CULTURE_RE);
    const text = body.match(TEXT_RE);
    if (culture && text) {
      translations[culture[1].trim()] = decodeXmlText(text[1]);
    }
  }

  for (const pref of PREFERRED_CULTURES) {
    if (translations[pref]) return translations[pref];
  }
  const first = Object.values(translations)[0];
  return first || '';
}

function decodeXmlText(raw: string): string {
  return raw
    .trim()
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}
