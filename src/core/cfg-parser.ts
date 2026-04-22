/**
 * Parser for Siemens STEP 7 V5.x hardware configuration exports (.cfg).
 *
 * STEP 7 Manager exports the full hardware configuration of a station via
 * "Station → Export…". The resulting text file describes the CPU, all racks,
 * Profibus/Profinet subsystems, remote I/O couplers (ET200/WAGO) and the
 * symbolic I/O table — including modules that live behind Profibus couplers,
 * which a live snap7 browse cannot discover.
 *
 * The parser turns such a file into a flat tag list ready for bulk import
 * into the read/browse nodes. See test-assets/prod.cfg for a real sample.
 */
import { S7DataType } from '../types/s7-address';

export interface CfgStation {
  type: string;
  name: string;
}

export interface CfgAddressRange {
  byteOffset: number;
  byteLength: number;
}

export interface CfgSymbol {
  /** Raw area letter from the SYMBOL line: I = input, O = output. */
  area: 'I' | 'O';
  /** Offset relative to the module's start — bit for digital, byte for analog. */
  relativeOffset: number;
  name: string;
  comment: string;
}

export type CfgModuleKind = 'digital' | 'analog' | 'mixed' | 'coupler' | 'cpu' | 'cp' | 'other';

export interface CfgModule {
  /** Raw location id, e.g. "DPSUBSYSTEM 1, DPADDRESS 10, SLOT 7". */
  location: string;
  /** Human-readable path, e.g. "Hauptschrank (DP 10) / Slot 7". */
  path: string;
  /** Parent location id, for grouping slots under their coupler. */
  parent?: string;
  /** Module order number / GSD file name. */
  moduleType: string;
  /** Secondary label from the cfg ("8DE", "6AX", "DP", …). */
  moduleSubtype?: string;
  kind: CfgModuleKind;
  in?: CfgAddressRange;
  out?: CfgAddressRange;
  symbols: CfgSymbol[];
}

export interface CfgTag {
  name: string;
  comment: string;
  /** S7 process-image area letter (I or Q). */
  area: 'I' | 'Q';
  byteOffset: number;
  /** Only set for BOOL tags. */
  bitOffset?: number;
  dataType: Extract<S7DataType, 'BOOL' | 'WORD' | 'DWORD' | 'BYTE'>;
  /** nodes7-style address string, e.g. "I0.3", "IW272". */
  address: string;
  /** Module path for context / tooltips. */
  source: string;
}

export interface CfgParseResult {
  station?: CfgStation;
  step7Version?: string;
  modules: CfgModule[];
  tags: CfgTag[];
  warnings: string[];
}

/** Parses a STEP 7 v5 hardware configuration export. Input is latin1/utf8 decoded text. */
export function parseCfg(content: string): CfgParseResult {
  const result: CfgParseResult = { modules: [], tags: [], warnings: [] };

  // Normalise line endings and split. We deliberately keep leading whitespace —
  // it is a reliable signal for nested BEGIN blocks (ADDRESS lines are indented).
  const lines = content.replace(/\r\n/g, '\n').split('\n');

  let current: CfgModule | null = null;
  let pendingAddress: 'IN' | 'OUT' | null = null;
  let lastDpSlave: CfgModule | null = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '');
    const stripped = line.trimStart();

    // --- File metadata ---
    if (stripped.startsWith('#STEP7_VERSION')) {
      result.step7Version = stripped.substring('#STEP7_VERSION'.length).trim().replace(/^"|"$/g, '');
      continue;
    }

    // --- STATION <type> , "<name>" ---
    const stationMatch = stripped.match(/^STATION\s+(\S+)\s*,\s*"([^"]*)"\s*$/);
    if (stationMatch) {
      result.station = { type: stationMatch[1], name: stationMatch[2] };
      current = null;
      pendingAddress = null;
      continue;
    }

    // --- DPSUBSYSTEM <id>, DPADDRESS <a>, SLOT <s>, "<type>", "<subtype>" ---
    const dpSlotMatch = stripped.match(
      /^DPSUBSYSTEM\s+(\d+)\s*,\s*DPADDRESS\s+(\d+)\s*,\s*SLOT\s+(\d+)\s*,\s*"([^"]*)"\s*,\s*"([^"]*)"/,
    );
    if (dpSlotMatch) {
      const [, sysId, dpAddr, slot, moduleType, subtype] = dpSlotMatch;
      const parent = `DPSUBSYSTEM ${sysId}, DPADDRESS ${dpAddr}`;
      const parentName = lastDpSlave && lastDpSlave.location === parent
        ? lastDpSlave.path
        : `DP ${sysId}/${dpAddr}`;
      current = {
        location: `DPSUBSYSTEM ${sysId}, DPADDRESS ${dpAddr}, SLOT ${slot}`,
        path: `${parentName} / Slot ${slot}`,
        parent,
        moduleType,
        moduleSubtype: subtype,
        kind: classifyModule(moduleType, subtype),
        symbols: [],
      };
      result.modules.push(current);
      pendingAddress = null;
      continue;
    }

    // --- DPSUBSYSTEM <id>, DPADDRESS <a>, "<gsd>", "<name>" --- (coupler header)
    const dpSlaveMatch = stripped.match(
      /^DPSUBSYSTEM\s+(\d+)\s*,\s*DPADDRESS\s+(\d+)\s*,\s*"([^"]*)"\s*,\s*"([^"]*)"/,
    );
    if (dpSlaveMatch) {
      const [, sysId, dpAddr, gsd, name] = dpSlaveMatch;
      current = {
        location: `DPSUBSYSTEM ${sysId}, DPADDRESS ${dpAddr}`,
        path: `${name} (DP ${dpAddr})`,
        moduleType: gsd,
        moduleSubtype: 'DP-Slave',
        kind: 'coupler',
        symbols: [],
      };
      result.modules.push(current);
      lastDpSlave = current;
      pendingAddress = null;
      continue;
    }

    // --- DPSUBSYSTEM <id>, "<name>" --- (master-system, ignore as module)
    if (/^DPSUBSYSTEM\s+\d+\s*,\s*"[^"]*"\s*$/.test(stripped) && !/DPADDRESS/.test(stripped)) {
      current = null;
      pendingAddress = null;
      continue;
    }

    // --- RACK <r>, SLOT <s>, SUBSLOT <ss>, "<type>", "<subtype>" ---
    const rackSlotSubMatch = stripped.match(
      /^RACK\s+(\d+)\s*,\s*SLOT\s+(\d+)\s*,\s*SUBSLOT\s+(\d+)\s*,\s*"([^"]*)"\s*,\s*"([^"]*)"/,
    );
    if (rackSlotSubMatch) {
      const [, rack, slot, subslot, moduleType, subtype] = rackSlotSubMatch;
      current = {
        location: `RACK ${rack}, SLOT ${slot}, SUBSLOT ${subslot}`,
        path: `Rack ${rack} / Slot ${slot}.${subslot}`,
        parent: `RACK ${rack}, SLOT ${slot}`,
        moduleType,
        moduleSubtype: subtype,
        kind: classifyModule(moduleType, subtype),
        symbols: [],
      };
      result.modules.push(current);
      pendingAddress = null;
      continue;
    }

    // --- RACK <r>, SLOT <s>, "<type>" [version], "<subtype>" ---
    const rackSlotMatch = stripped.match(
      /^RACK\s+(\d+)\s*,\s*SLOT\s+(\d+)\s*,\s*"([^"]*)"(?:\s+"[^"]*")?\s*,\s*"([^"]*)"/,
    );
    if (rackSlotMatch) {
      const [, rack, slot, moduleType, subtype] = rackSlotMatch;
      current = {
        location: `RACK ${rack}, SLOT ${slot}`,
        path: `Rack ${rack} / Slot ${slot}`,
        moduleType,
        moduleSubtype: subtype,
        kind: classifyModule(moduleType, subtype),
        symbols: [],
      };
      result.modules.push(current);
      pendingAddress = null;
      continue;
    }

    // --- RACK <r>, "<orderNo>", "<type>" --- (rack header, not a module)
    if (/^RACK\s+\d+\s*,\s*"[^"]*"\s*,\s*"[^"]*"/.test(stripped)) {
      current = null;
      pendingAddress = null;
      continue;
    }

    // --- SUBNET / MASTER / AUTOCREATED / BEGIN / END / PARAMETER ---
    if (/^(SUBNET|MASTER|AUTOCREATED|BEGIN|END|PARAMETER)\b/.test(stripped)) {
      pendingAddress = null;
      continue;
    }

    // --- LOCAL_IN_ADDRESSES / LOCAL_OUT_ADDRESSES ---
    if (stripped === 'LOCAL_IN_ADDRESSES') {
      pendingAddress = 'IN';
      continue;
    }
    if (stripped === 'LOCAL_OUT_ADDRESSES') {
      pendingAddress = 'OUT';
      continue;
    }

    // --- ADDRESS <byteOffset>, <?>, <byteLength>, <?>, <?>, <?> ---
    const addrMatch = stripped.match(/^ADDRESS\s+(\d+)\s*,\s*\d+\s*,\s*(\d+)\s*,/);
    if (addrMatch && pendingAddress && current) {
      const byteOffset = parseInt(addrMatch[1], 10);
      const byteLength = parseInt(addrMatch[2], 10);
      // byteOffset ~8190-8191 with length 0 = diagnosis-only pseudo-address; skip it.
      if (byteLength > 0) {
        const range: CfgAddressRange = { byteOffset, byteLength };
        if (pendingAddress === 'IN') current.in = range;
        else current.out = range;
      }
      pendingAddress = null;
      continue;
    }

    // --- SYMBOL  I , N, "name", "comment" ---
    const symMatch = stripped.match(/^SYMBOL\s+([IO])\s*,\s*(\d+)\s*,\s*"([^"]*)"\s*,\s*"([^"]*)"/);
    if (symMatch && current) {
      const [, area, off, name, comment] = symMatch;
      current.symbols.push({
        area: area as 'I' | 'O',
        relativeOffset: parseInt(off, 10),
        name,
        comment,
      });
      continue;
    }
  }

  for (const mod of result.modules) {
    for (const sym of mod.symbols) {
      const tag = buildTag(mod, sym, result.warnings);
      if (tag) result.tags.push(tag);
    }
  }

  return result;
}

const DIGITAL_RE = /\b(\d+\s*)?(DI|DO|DE|DA|DIO)\b/i;
const ANALOG_RE = /\b(\d+\s*)?(AI|AO|AE|AA|AX|AIO)\b/i;

function classifyModule(moduleType: string, subtype?: string): CfgModuleKind {
  const haystack = `${moduleType} ${subtype || ''}`;
  if (/CPU/i.test(haystack)) return 'cpu';
  if (/^CP\b|\bCP\s|Ethernet|PROFIBUS|PROFINET|DP|MPI/i.test(haystack) && !/CPU/i.test(haystack)) {
    // The communication-processor heuristic is secondary — only claim 'cp' when
    // the module actually looks like a comms card by order number (6GK).
    if (/\b6GK7?\b/.test(moduleType)) return 'cp';
  }
  const digital = DIGITAL_RE.test(haystack);
  const analog = ANALOG_RE.test(haystack);
  if (digital && analog) return 'mixed';
  if (digital) return 'digital';
  if (analog) return 'analog';
  return 'other';
}

function buildTag(mod: CfgModule, sym: CfgSymbol, warnings: string[]): CfgTag | null {
  const range = sym.area === 'I' ? mod.in : mod.out;
  if (!range) {
    warnings.push(`Symbol "${sym.name}" in ${mod.location} has no matching ${sym.area} address range`);
    return null;
  }

  const area: 'I' | 'Q' = sym.area === 'I' ? 'I' : 'Q';
  const treatAsDigital = isDigitalAddressing(mod, range);

  if (treatAsDigital) {
    const bit = sym.relativeOffset % 8;
    const byte = range.byteOffset + Math.floor(sym.relativeOffset / 8);
    return {
      name: sym.name,
      comment: sym.comment,
      area,
      byteOffset: byte,
      bitOffset: bit,
      dataType: 'BOOL',
      address: `${area}${byte}.${bit}`,
      source: mod.path,
    };
  }

  const byte = range.byteOffset + sym.relativeOffset;
  return {
    name: sym.name,
    comment: sym.comment,
    area,
    byteOffset: byte,
    dataType: 'WORD',
    address: `${area}W${byte}`,
    source: mod.path,
  };
}

function isDigitalAddressing(mod: CfgModule, range: CfgAddressRange): boolean {
  if (mod.kind === 'digital') return true;
  if (mod.kind === 'analog') return false;
  // Fallback heuristics for modules with no clear type label:
  // - a 1-byte area with up to 8 symbols is always bit-addressed
  // - if any symbol offset is >= byteLength the offsets must be bit positions
  const maxRel = mod.symbols.reduce((m, s) => Math.max(m, s.relativeOffset), 0);
  if (range.byteLength === 1) return true;
  if (maxRel >= range.byteLength) return true;
  return false;
}

/** Converts a parsed tag list into a map `{ address: label }` for s7-read import. */
export function tagsToLabelMap(tags: CfgTag[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of tags) {
    out[t.address] = t.name;
  }
  return out;
}
