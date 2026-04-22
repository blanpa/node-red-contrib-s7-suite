import * as fs from 'fs';
import * as path from 'path';
import { parseCfg, tagsToLabelMap, CfgParseResult } from '../../../src/core/cfg-parser';

const FIXTURE_PATH = path.resolve(__dirname, '../../../test-assets/prod.cfg');

function loadProdCfg(): string {
  // The real STEP 7 export is latin1 — iconv once, hold for the suite.
  return fs.readFileSync(FIXTURE_PATH, 'latin1');
}

describe('cfg-parser', () => {
  describe('parseCfg against a synthetic minimal fixture', () => {
    const SAMPLE = [
      'FILEVERSION "3.2"',
      '#STEP7_VERSION V5.5 + SP4',
      '',
      'STATION S7300 , "Demo"',
      'BEGIN ',
      '  ASSET_ID "X"',
      'END ',
      '',
      'DPSUBSYSTEM 1, "PROFIBUS(Factory): DP-Mastersystem (1)"',
      '',
      'DPSUBSYSTEM 1, DPADDRESS 10, "B754_S34.GSG", "Hauptschrank"',
      'BEGIN ',
      '  ASSET_ID "Y"',
      'LOCAL_IN_ADDRESSES ',
      '  ADDRESS  8189, 0, 0, 0, 2, 0',
      'END ',
      '',
      'DPSUBSYSTEM 1, DPADDRESS 10, SLOT 7, "75x-430 8DI/24V DC/3.0ms", "8DE"',
      'BEGIN ',
      '  ASSET_ID "Z"',
      'LOCAL_IN_ADDRESSES ',
      '  ADDRESS  0, 0, 1, 0, 2, 0',
      'SYMBOL  I , 0, "STSP_NA", "Not-Aus vorhanden"',
      'SYMBOL  I , 3, "NA_HS_INT", "Not-Aus betätigt"',
      'END ',
      '',
      'DPSUBSYSTEM 1, DPADDRESS 10, SLOT 2, "75x-493 3AI/3-Phasen-Messung", "6AX"',
      'BEGIN ',
      'LOCAL_IN_ADDRESSES ',
      '  ADDRESS  272, 0, 12, 0, 7, 0',
      'LOCAL_OUT_ADDRESSES ',
      '  ADDRESS  272, 0, 12, 0, 7, 0',
      'SYMBOL  I , 0, "Wago_PEW272", ""',
      'SYMBOL  I , 2, "Wago_PEW274", ""',
      'SYMBOL  O , 0, "Wago_PAW272", ""',
      'END ',
      '',
    ].join('\n');

    let parsed: CfgParseResult;
    beforeAll(() => { parsed = parseCfg(SAMPLE); });

    it('reads the station header', () => {
      expect(parsed.station).toEqual({ type: 'S7300', name: 'Demo' });
      expect(parsed.step7Version).toBe('V5.5 + SP4');
    });

    it('emits the DP coupler as a module', () => {
      const coupler = parsed.modules.find((m) => m.location === 'DPSUBSYSTEM 1, DPADDRESS 10');
      expect(coupler).toBeDefined();
      expect(coupler!.kind).toBe('coupler');
      expect(coupler!.path).toBe('Hauptschrank (DP 10)');
    });

    it('resolves digital-input symbols to bit addresses I<byte>.<bit>', () => {
      const digital = parsed.tags.filter((t) => t.name.startsWith('STSP_NA') || t.name.startsWith('NA_HS_INT'));
      expect(digital).toHaveLength(2);
      expect(digital[0]).toMatchObject({ name: 'STSP_NA', address: 'I0.0', dataType: 'BOOL', bitOffset: 0, byteOffset: 0 });
      expect(digital[1]).toMatchObject({ name: 'NA_HS_INT', address: 'I0.3', dataType: 'BOOL', bitOffset: 3, byteOffset: 0 });
    });

    it('resolves analog symbols to word addresses with absolute byte offset', () => {
      const wago = parsed.tags.find((t) => t.name === 'Wago_PEW272');
      expect(wago).toMatchObject({ address: 'IW272', dataType: 'WORD', byteOffset: 272, area: 'I' });
      const wagoNext = parsed.tags.find((t) => t.name === 'Wago_PEW274');
      expect(wagoNext).toMatchObject({ address: 'IW274', byteOffset: 274 });
      const out = parsed.tags.find((t) => t.name === 'Wago_PAW272');
      expect(out).toMatchObject({ address: 'QW272', area: 'Q' });
    });

    it('includes the module path in the tag source for UI tooltips', () => {
      const tag = parsed.tags.find((t) => t.name === 'STSP_NA')!;
      expect(tag.source).toContain('Hauptschrank');
      expect(tag.source).toContain('Slot 7');
    });
  });

  describe('parseCfg against the real production export (test-assets/prod.cfg)', () => {
    let parsed: CfgParseResult;
    beforeAll(() => { parsed = parseCfg(loadProdCfg()); });

    it('extracts the station header', () => {
      expect(parsed.station).toEqual({ type: 'S7300', name: 'Product1Production' });
      expect(parsed.step7Version).toContain('V5.5');
    });

    it('discovers all four Profibus DP couplers (Hauptschrank, Hackschnitzel, Presse 1, Presse 2)', () => {
      const couplerPaths = parsed.modules.filter((m) => m.kind === 'coupler').map((m) => m.path);
      expect(couplerPaths).toEqual(expect.arrayContaining([
        expect.stringContaining('Hauptschrank'),
        expect.stringContaining('Hackschnitzel'),
        expect.stringContaining('Presse 1'),
      ]));
    });

    it('produces a non-trivial number of tags with German comments intact', () => {
      expect(parsed.tags.length).toBeGreaterThan(50);
      const tagWithUmlaut = parsed.tags.find((t) => t.comment.includes('Füllstandsmessung'));
      expect(tagWithUmlaut).toBeDefined();
    });

    it('resolves the well-known STSP_NA digital input to I0.0', () => {
      const tag = parsed.tags.find((t) => t.name === 'STSP_NA');
      expect(tag).toBeDefined();
      expect(tag!.address).toBe('I0.0');
      expect(tag!.dataType).toBe('BOOL');
    });

    it('resolves the Wago analog inputs at DP 10 / Slot 2 onto the PEW 272 .. 282 window', () => {
      const wagoTags = parsed.tags.filter((t) => t.name.startsWith('HS_Wago_493_PEW'));
      expect(wagoTags.length).toBeGreaterThan(0);
      const first = wagoTags.find((t) => t.name === 'HS_Wago_493_PEW272');
      expect(first).toMatchObject({ address: 'IW272', byteOffset: 272, area: 'I' });
      const last = wagoTags.find((t) => t.name === 'HS_Wago_493_PEW282');
      expect(last).toMatchObject({ address: 'IW282', byteOffset: 282 });
    });

    it('emits no warnings about orphan symbols for the production export', () => {
      const orphanWarnings = parsed.warnings.filter((w) => /no matching.*address range/.test(w));
      expect(orphanWarnings).toEqual([]);
    });

    it('never produces duplicate (address, name) combinations', () => {
      const seen = new Set<string>();
      for (const t of parsed.tags) {
        const key = `${t.address}|${t.name}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    });
  });

  describe('tagsToLabelMap', () => {
    it('maps addresses to tag names for label import', () => {
      const tags = parseCfg([
        'STATION S7300 , "T"',
        'DPSUBSYSTEM 1, DPADDRESS 10, SLOT 7, "75x-430 8DI/24V DC", "8DE"',
        'LOCAL_IN_ADDRESSES ',
        '  ADDRESS  0, 0, 1, 0, 2, 0',
        'SYMBOL  I , 0, "MY_INPUT", "comment"',
      ].join('\n')).tags;
      expect(tagsToLabelMap(tags)).toEqual({ 'I0.0': 'MY_INPUT' });
    });
  });
});
