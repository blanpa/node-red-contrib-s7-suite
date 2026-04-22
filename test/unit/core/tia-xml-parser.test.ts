import { parseTiaXml } from '../../../src/core/tia-xml-parser';

const SAMPLE_XML = `<?xml version="1.0" encoding="utf-8"?>
<Document>
  <Engineering version="V17" />
  <SW.Tags.PlcTagTable ID="0">
    <AttributeList>
      <Name>Default tag table</Name>
    </AttributeList>
    <ObjectList>
      <SW.Tags.PlcTag ID="1">
        <AttributeList>
          <DataTypeName>Bool</DataTypeName>
          <LogicalAddress>%I0.0</LogicalAddress>
          <Name>StartButton</Name>
        </AttributeList>
        <ObjectList>
          <MultilingualText ID="2" CompositionName="Comment">
            <ObjectList>
              <MultilingualTextItem ID="3" CompositionName="Items">
                <AttributeList>
                  <Culture>de-DE</Culture>
                  <Text>Start-Taster &amp; Freigabe</Text>
                </AttributeList>
              </MultilingualTextItem>
              <MultilingualTextItem ID="4" CompositionName="Items">
                <AttributeList>
                  <Culture>en-US</Culture>
                  <Text>Start push-button</Text>
                </AttributeList>
              </MultilingualTextItem>
            </ObjectList>
          </MultilingualText>
        </ObjectList>
      </SW.Tags.PlcTag>
      <SW.Tags.PlcTag ID="5">
        <AttributeList>
          <DataTypeName>Int</DataTypeName>
          <LogicalAddress>%MW20</LogicalAddress>
          <Name>Temperatur_Ist</Name>
        </AttributeList>
      </SW.Tags.PlcTag>
      <SW.Tags.PlcTag ID="6">
        <AttributeList>
          <DataTypeName>Real</DataTypeName>
          <LogicalAddress>%QW4</LogicalAddress>
          <Name>Druck_Soll</Name>
        </AttributeList>
        <ObjectList>
          <MultilingualText ID="7" CompositionName="Comment">
            <ObjectList>
              <MultilingualTextItem ID="8" CompositionName="Items">
                <AttributeList>
                  <Culture>en-US</Culture>
                  <Text>pressure setpoint (only locale)</Text>
                </AttributeList>
              </MultilingualTextItem>
            </ObjectList>
          </MultilingualText>
        </ObjectList>
      </SW.Tags.PlcTag>
      <SW.Tags.PlcUserConstant ID="9">
        <AttributeList>
          <DataTypeName>Int</DataTypeName>
          <Name>MAX_RETRIES</Name>
          <Value>5</Value>
        </AttributeList>
      </SW.Tags.PlcUserConstant>
      <SW.Tags.PlcTag ID="10">
        <AttributeList>
          <DataTypeName>Word</DataTypeName>
          <Name>OrphanTag</Name>
        </AttributeList>
      </SW.Tags.PlcTag>
    </ObjectList>
  </SW.Tags.PlcTagTable>
  <SW.Tags.PlcTagTable ID="100">
    <AttributeList>
      <Name>Safety tags</Name>
    </AttributeList>
    <ObjectList>
      <SW.Tags.PlcTag ID="101">
        <AttributeList>
          <DataTypeName>Bool</DataTypeName>
          <LogicalAddress>%I10.3</LogicalAddress>
          <Name>NotAus_1</Name>
        </AttributeList>
      </SW.Tags.PlcTag>
    </ObjectList>
  </SW.Tags.PlcTagTable>
</Document>
`;

describe('tia-xml-parser', () => {
  describe('parseTiaXml against a synthetic TIA Portal V17 export', () => {
    const parsed = parseTiaXml(SAMPLE_XML);

    it('picks up the engineering version', () => {
      expect(parsed.engineeringVersion).toBe('V17');
    });

    it('discovers both tag tables with correct counts', () => {
      const names = parsed.tables.map((t) => t.name).sort();
      expect(names).toEqual(['Default tag table', 'Safety tags']);
      expect(parsed.tables.find((t) => t.name === 'Default tag table')!.tagCount).toBe(4);
      expect(parsed.tables.find((t) => t.name === 'Safety tags')!.tagCount).toBe(1);
    });

    it('strips the leading %% from LogicalAddress and keeps IEC format', () => {
      const start = parsed.tags.find((t) => t.name === 'StartButton')!;
      expect(start.address).toBe('I0.0');
      const temp = parsed.tags.find((t) => t.name === 'Temperatur_Ist')!;
      expect(temp.address).toBe('MW20');
      const pressure = parsed.tags.find((t) => t.name === 'Druck_Soll')!;
      expect(pressure.address).toBe('QW4');
    });

    it('prefers de-DE over en-US when multiple translations exist', () => {
      const start = parsed.tags.find((t) => t.name === 'StartButton')!;
      expect(start.comment).toBe('Start-Taster & Freigabe');
    });

    it('falls back to en-US (or the only available locale) when de-DE is missing', () => {
      const pressure = parsed.tags.find((t) => t.name === 'Druck_Soll')!;
      expect(pressure.comment).toBe('pressure setpoint (only locale)');
    });

    it('decodes XML entities in names and comments', () => {
      const start = parsed.tags.find((t) => t.name === 'StartButton')!;
      expect(start.comment).toContain('&'); // "&amp;" → "&"
    });

    it('yields PlcUserConstant records with isConstant + value, no address', () => {
      const c = parsed.tags.find((t) => t.name === 'MAX_RETRIES')!;
      expect(c.isConstant).toBe(true);
      expect(c.value).toBe('5');
      expect(c.address).toBe('');
    });

    it('emits a warning and drops tags without LogicalAddress', () => {
      const orphan = parsed.tags.find((t) => t.name === 'OrphanTag');
      expect(orphan).toBeUndefined();
      expect(parsed.warnings.some((w) => w.includes('OrphanTag'))).toBe(true);
    });

    it('records the tag-table name on each tag for UI grouping', () => {
      const safetyTag = parsed.tags.find((t) => t.name === 'NotAus_1')!;
      expect(safetyTag.source).toBe('Safety tags');
    });
  });

  describe('edge cases', () => {
    it('handles an export with no PlcTagTable wrapper by treating it as a single root table', () => {
      const xml = `<Document>
        <SW.Tags.PlcTag ID="1">
          <AttributeList>
            <DataTypeName>Bool</DataTypeName>
            <LogicalAddress>%I5.7</LogicalAddress>
            <Name>Hoist_Up</Name>
          </AttributeList>
        </SW.Tags.PlcTag>
      </Document>`;
      const r = parseTiaXml(xml);
      expect(r.tags).toHaveLength(1);
      expect(r.tables[0].name).toBe('(root)');
      expect(r.tags[0].address).toBe('I5.7');
    });

    it('handles CDATA-wrapped texts', () => {
      const xml = `<Document>
        <SW.Tags.PlcTagTable ID="0">
          <AttributeList><Name><![CDATA[Tag table 1]]></Name></AttributeList>
          <ObjectList>
            <SW.Tags.PlcTag ID="1">
              <AttributeList>
                <DataTypeName>Bool</DataTypeName>
                <LogicalAddress>%Q0.0</LogicalAddress>
                <Name><![CDATA[Relay_1]]></Name>
              </AttributeList>
            </SW.Tags.PlcTag>
          </ObjectList>
        </SW.Tags.PlcTagTable>
      </Document>`;
      const r = parseTiaXml(xml);
      expect(r.tables[0].name).toBe('Tag table 1');
      expect(r.tags[0].name).toBe('Relay_1');
    });

    it('handles DB tag addresses (IEC-style with absolute DB)', () => {
      const xml = `<SW.Tags.PlcTagTable ID="0">
        <AttributeList><Name>DB tags</Name></AttributeList>
        <ObjectList>
          <SW.Tags.PlcTag ID="1"><AttributeList>
            <DataTypeName>Word</DataTypeName>
            <LogicalAddress>%DB1.DBW2</LogicalAddress>
            <Name>RawValue</Name>
          </AttributeList></SW.Tags.PlcTag>
        </ObjectList>
      </SW.Tags.PlcTagTable>`;
      const r = parseTiaXml(xml);
      expect(r.tags[0].address).toBe('DB1.DBW2');
    });

    it('returns empty result without throwing on an empty document', () => {
      const r = parseTiaXml('<?xml version="1.0"?><Document></Document>');
      expect(r.tables).toHaveLength(0);
      expect(r.tags).toHaveLength(0);
    });
  });
});
