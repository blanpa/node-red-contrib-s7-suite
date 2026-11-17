import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

// The editor code lives in the nodes' .html files and runs in the browser. These tests run the
// scripts in a vm with a stand-in for RED and jQuery, to cover the parts that decide what a node
// saves: the shared s7Suite* helpers in s7-config.html and the validate functions the nodes register.

type Row = { name: string; type: string; offset: string; bit: string; length: string };
type Field = { name: string; type: string; offset?: number; bit?: number; length?: number };
type NodeDef = { defaults: Record<string, { value: unknown; validate?: (this: object, v: unknown) => boolean }> };

interface FakeInput {
  value: string;
  classes: Set<string>;
  handlers: Array<() => void>;
  val(v?: string | number): string | FakeInput;
  trigger(event: string): FakeInput;
  on(events: string, handler: () => void): FakeInput;
  toggleClass(name: string, on: boolean): FakeInput;
}

// Just enough of a jQuery-wrapped input for the helpers: val, trigger, on, toggleClass
function fakeInput(value = ''): FakeInput {
  const el: FakeInput = {
    value,
    classes: new Set<string>(),
    handlers: [],
    val(v?: string | number) {
      if (v === undefined) return el.value;
      el.value = String(v);
      return el;
    },
    trigger() {
      el.handlers.forEach((h) => h());
      return el;
    },
    on(_events: string, handler: () => void) {
      el.handlers.push(handler);
      return el;
    },
    toggleClass(name: string, on: boolean) {
      if (on) el.classes.add(name);
      else el.classes.delete(name);
      return el;
    },
  };
  return el;
}

// A schema row as the helpers read it: inputs by position (name, offset, bit, length) and one select
function fakeSchemaRow(row: Row) {
  const inputs = [fakeInput(row.name), fakeInput(row.offset), fakeInput(row.bit), fakeInput(row.length)];
  const select = fakeInput(row.type);
  return { length: 1, find: (selector: string) => (selector === 'select' ? select : inputs) };
}

interface Editor {
  s7SuiteSchemaFromRows(rows: Row[]): Field[];
  s7SuiteReadSchemaList(list: unknown): string;
  s7SuiteSchemaComplete(schemaJson?: unknown): boolean;
  s7SuiteRequireOffset(nameInput: FakeInput, offsetInput: FakeInput): void;
  s7SuiteSeedSchemaField(row: unknown, field: Record<string, FakeInput>): void;
  $: jest.Mock & { getJSON: jest.Mock };
  defs: Record<string, NodeDef>;
}

function editorScript(file: string): string {
  const html = fs.readFileSync(path.join(__dirname, '../../../src/nodes', file), 'utf8');
  const match = /<script type="text\/javascript">([\s\S]*?)<\/script>/.exec(html);
  if (!match) throw new Error(`No editor script in ${file}`);
  return match[1];
}

function loadEditor(): Editor {
  const defs: Record<string, NodeDef> = {};
  // The helpers wrap elements they were handed ($(this), $(inputs[1])); the fakes are already "wrapped"
  const $ = Object.assign(jest.fn((x: unknown) => x), { getJSON: jest.fn() });
  const context: Record<string, unknown> = {
    $,
    defs,
    navigator: { userAgent: '', platform: '' },
    RED: {
      nodes: { registerType: (name: string, def: NodeDef) => { defs[name] = def; } },
      validators: { typedInput: () => () => true },
    },
  };
  context.window = context;
  vm.createContext(context);
  // s7-config.html first: it defines the helpers the other nodes use
  for (const file of ['s7-config/s7-config.html', 's7-read/s7-read.html', 's7-write/s7-write.html']) {
    vm.runInContext(editorScript(file), context, { filename: file });
  }
  return context as unknown as Editor;
}

// Results come from another realm (the vm), so compare them by value
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const row = (name: string, type: string, offset = '', bit = '', length = ''): Row => ({ name, type, offset, bit, length });

describe('editor helpers (s7-config.html)', () => {
  let editor: Editor;
  beforeEach(() => { editor = loadEditor(); });

  describe('s7SuiteSchemaFromRows', () => {
    it('saves name, type and offset', () => {
      expect(plain(editor.s7SuiteSchemaFromRows([row('temp', 'REAL', '0'), row('count', 'INT', '4')]))).toEqual([
        { name: 'temp', type: 'REAL', offset: 0 },
        { name: 'count', type: 'INT', offset: 4 },
      ]);
    });

    // #83: a field with a name and a type but no offset used to vanish on Done
    it('keeps a named field without an offset, saved without one', () => {
      expect(plain(editor.s7SuiteSchemaFromRows([row('temp', 'REAL')]))).toEqual([{ name: 'temp', type: 'REAL' }]);
    });

    it('never saves a missing offset as 0', () => {
      const [field] = editor.s7SuiteSchemaFromRows([row('temp', 'REAL', '')]);
      expect('offset' in field).toBe(false);
    });

    it('keeps the fields around one without an offset, in order', () => {
      const schema = editor.s7SuiteSchemaFromRows([row('a', 'INT', '0'), row('b', 'INT'), row('c', 'INT', '4')]);
      expect(plain(schema)).toEqual([
        { name: 'a', type: 'INT', offset: 0 },
        { name: 'b', type: 'INT' },
        { name: 'c', type: 'INT', offset: 4 },
      ]);
    });

    it('leaves out a row without a name', () => {
      // What Add field leaves behind when nothing is typed: a type and a seeded offset
      const schema = editor.s7SuiteSchemaFromRows([row('', 'REAL', '0'), row('temp', 'REAL', '4'), row('', 'REAL')]);
      expect(plain(schema)).toEqual([{ name: 'temp', type: 'REAL', offset: 4 }]);
    });

    it('saves the bit of a BOOL only', () => {
      const schema = editor.s7SuiteSchemaFromRows([
        row('run', 'BOOL', '6', '3'),
        row('stop', 'BOOL', '6'),
        row('speed', 'INT', '8', '3'),
      ]);
      expect(plain(schema)).toEqual([
        { name: 'run', type: 'BOOL', offset: 6, bit: 3 },
        { name: 'stop', type: 'BOOL', offset: 6 },
        { name: 'speed', type: 'INT', offset: 8 },
      ]);
    });

    it('saves the length of a STRING or WSTRING only', () => {
      const schema = editor.s7SuiteSchemaFromRows([
        row('name', 'STRING', '0', '', '20'),
        row('wide', 'WSTRING', '22', '', '10'),
        row('plain', 'STRING', '46'),
        row('speed', 'INT', '302', '', '20'),
      ]);
      expect(plain(schema)).toEqual([
        { name: 'name', type: 'STRING', offset: 0, length: 20 },
        { name: 'wide', type: 'WSTRING', offset: 22, length: 10 },
        { name: 'plain', type: 'STRING', offset: 46 },
        { name: 'speed', type: 'INT', offset: 302 },
      ]);
    });

    it('returns an empty schema for no rows', () => {
      expect(plain(editor.s7SuiteSchemaFromRows([]))).toEqual([]);
    });
  });

  describe('s7SuiteReadSchemaList', () => {
    // Stands in for an editableList whose 'items' are the given rows
    const fakeList = (rows: Row[]) => {
      const items = rows.map(fakeSchemaRow);
      return {
        editableList: (method: string) => {
          expect(method).toBe('items');
          return {
            map: (fn: (this: unknown) => unknown) => ({ get: () => items.map((item) => fn.call(item)) }),
          };
        },
      };
    };

    it('reads each row by position and returns the schema as JSON', () => {
      const json = editor.s7SuiteReadSchemaList(fakeList([
        row('temp', 'REAL', '0'),
        row('run', 'BOOL', '4', '2'),
        row('name', 'STRING', '6', '', '10'),
      ]));
      expect(JSON.parse(json)).toEqual([
        { name: 'temp', type: 'REAL', offset: 0 },
        { name: 'run', type: 'BOOL', offset: 4, bit: 2 },
        { name: 'name', type: 'STRING', offset: 6, length: 10 },
      ]);
    });

    it('keeps a named row without an offset and drops an unnamed one', () => {
      const json = editor.s7SuiteReadSchemaList(fakeList([row('temp', 'REAL'), row('', 'INT', '4')]));
      expect(JSON.parse(json)).toEqual([{ name: 'temp', type: 'REAL' }]);
    });

    it('returns "[]" for an empty list', () => {
      expect(editor.s7SuiteReadSchemaList(fakeList([]))).toBe('[]');
    });
  });

  describe('s7SuiteSchemaComplete', () => {
    it.each([
      ['an empty schema', '[]'],
      ['a schema whose fields all have an offset', '[{"name":"a","type":"INT","offset":0},{"name":"b","type":"INT","offset":2}]'],
      ['no schema at all', undefined],
      ['an empty string', ''],
      // Not for this check to judge; the runtime reports them
      ['something that is not JSON', '[{'],
      ['JSON that is not an array', '{"name":"a"}'],
    ])('accepts %s', (_what, schema) => {
      expect(editor.s7SuiteSchemaComplete(schema)).toBe(true);
    });

    it.each([
      ['a field without an offset', '[{"name":"a","type":"INT"}]'],
      ['one field without an offset among complete ones', '[{"name":"a","type":"INT","offset":0},{"name":"b","type":"INT"}]'],
      ['a null offset', '[{"name":"a","type":"INT","offset":null}]'],
      ['an offset that is not a number', '[{"name":"a","type":"INT","offset":"4"}]'],
      ['a negative offset', '[{"name":"a","type":"INT","offset":-1}]'],
      ['an entry that is not a field', '[null]'],
    ])('rejects %s', (_what, schema) => {
      expect(editor.s7SuiteSchemaComplete(schema)).toBe(false);
    });

    it('agrees with what s7SuiteSchemaFromRows saves', () => {
      const complete = JSON.stringify(editor.s7SuiteSchemaFromRows([row('a', 'INT', '0'), row('b', 'BOOL', '2', '1')]));
      const incomplete = JSON.stringify(editor.s7SuiteSchemaFromRows([row('a', 'INT', '0'), row('b', 'INT')]));
      expect(editor.s7SuiteSchemaComplete(complete)).toBe(true);
      expect(editor.s7SuiteSchemaComplete(incomplete)).toBe(false);
    });
  });

  describe('s7SuiteRequireOffset', () => {
    it('marks the offset of a named field that has none', () => {
      const name = fakeInput('temp');
      const offset = fakeInput('');
      editor.s7SuiteRequireOffset(name, offset);
      expect(offset.classes.has('input-error')).toBe(true);
    });

    it('leaves an unused row and a complete field unmarked', () => {
      const unusedOffset = fakeInput('');
      editor.s7SuiteRequireOffset(fakeInput(''), unusedOffset);
      expect(unusedOffset.classes.has('input-error')).toBe(false);

      const completeOffset = fakeInput('0');
      editor.s7SuiteRequireOffset(fakeInput('temp'), completeOffset);
      expect(completeOffset.classes.has('input-error')).toBe(false);
    });

    it('marks a negative offset', () => {
      const offset = fakeInput('-2');
      editor.s7SuiteRequireOffset(fakeInput('temp'), offset);
      expect(offset.classes.has('input-error')).toBe(true);
    });

    it('follows the name and the offset as they change', () => {
      const name = fakeInput('');
      const offset = fakeInput('');
      editor.s7SuiteRequireOffset(name, offset);
      expect(offset.classes.has('input-error')).toBe(false);

      name.val('temp');
      name.trigger('input');
      expect(offset.classes.has('input-error')).toBe(true);

      offset.val(4);
      offset.trigger('change');
      expect(offset.classes.has('input-error')).toBe(false);

      offset.val('');
      offset.trigger('input');
      expect(offset.classes.has('input-error')).toBe(true);
    });
  });

  describe('s7SuiteSeedSchemaField', () => {
    const newField = () => ({ type: fakeInput('REAL'), offset: fakeInput(''), bit: fakeInput(''), len: fakeInput('') });
    // The new row, with the given row (or none) above it
    const rowBelow = (previous: unknown) => ({ closest: () => ({ prev: () => previous }) });

    it('starts the first field at offset 0 without asking the server', () => {
      const field = newField();
      editor.s7SuiteSeedSchemaField(rowBelow({ length: 0 }), field);
      expect(field.offset.val()).toBe('0');
      expect(editor.$.getJSON).not.toHaveBeenCalled();
    });

    it('clears the missing-offset mark when it fills in the first offset', () => {
      const field = newField();
      const name = fakeInput('temp');
      editor.s7SuiteRequireOffset(name, field.offset);
      expect(field.offset.classes.has('input-error')).toBe(true);
      editor.s7SuiteSeedSchemaField(rowBelow({ length: 0 }), field);
      expect(field.offset.classes.has('input-error')).toBe(false);
    });

    it('asks for the field after the one above and fills it in', () => {
      editor.$.getJSON.mockImplementation((_url: string, _query: unknown, done: (next: unknown) => void) => {
        done({ type: 'INT', offset: 6 });
      });
      const field = newField();
      editor.s7SuiteSeedSchemaField(rowBelow(fakeSchemaRow(row('count', 'INT', '4'))), field);
      expect(editor.$.getJSON).toHaveBeenCalledTimes(1);
      const [url, query] = editor.$.getJSON.mock.calls[0];
      expect(url).toBe('s7-suite/next-field');
      expect(plain(query)).toEqual({ type: 'INT', offset: '4', bit: '', length: '' });
      expect(field.type.val()).toBe('INT');
      expect(field.offset.val()).toBe('6');
      expect(field.bit.val()).toBe('');
      expect(field.len.val()).toBe('');
    });

    it('fills in the next bit of a BOOL and the length of a string', () => {
      editor.$.getJSON.mockImplementationOnce((_url: string, _query: unknown, done: (next: unknown) => void) => {
        done({ type: 'BOOL', offset: 6, bit: 4 });
      });
      const bool = newField();
      editor.s7SuiteSeedSchemaField(rowBelow(fakeSchemaRow(row('run', 'BOOL', '6', '3'))), bool);
      expect([bool.type.val(), bool.offset.val(), bool.bit.val()]).toEqual(['BOOL', '6', '4']);

      editor.$.getJSON.mockImplementationOnce((_url: string, _query: unknown, done: (next: unknown) => void) => {
        done({ type: 'STRING', offset: 14, length: 10 });
      });
      const str = newField();
      editor.s7SuiteSeedSchemaField(rowBelow(fakeSchemaRow(row('name', 'STRING', '2', '', '10'))), str);
      expect([str.type.val(), str.offset.val(), str.len.val()]).toEqual(['STRING', '14', '10']);
    });

    it('does not guess when the field above has no offset', () => {
      const field = newField();
      editor.s7SuiteSeedSchemaField(rowBelow(fakeSchemaRow(row('temp', 'REAL'))), field);
      expect(editor.$.getJSON).not.toHaveBeenCalled();
      expect(field.offset.val()).toBe('');
    });

    it('leaves a row the user has already given an offset', () => {
      const field = newField();
      editor.$.getJSON.mockImplementation((_url: string, _query: unknown, done: (next: unknown) => void) => {
        // The user typed while the request was on its way
        field.offset.val(100);
        done({ type: 'INT', offset: 6 });
      });
      editor.s7SuiteSeedSchemaField(rowBelow(fakeSchemaRow(row('count', 'INT', '4'))), field);
      expect(field.offset.val()).toBe('100');
      expect(field.type.val()).toBe('REAL');
    });

    it('leaves the row alone when the server has no guess', () => {
      editor.$.getJSON.mockImplementation((_url: string, _query: unknown, done: (next: unknown) => void) => {
        done({});
      });
      const field = newField();
      editor.s7SuiteSeedSchemaField(rowBelow(fakeSchemaRow(row('x', 'REAL', '0'))), field);
      expect(field.offset.val()).toBe('');
    });
  });
});

describe('schema validation in the node definitions', () => {
  const complete = '[{"name":"a","type":"INT","offset":0}]';
  const incomplete = '[{"name":"a","type":"INT"}]';
  let defs: Record<string, NodeDef>;
  beforeAll(() => { defs = loadEditor().defs; });

  const validate = (type: string, node: object, schema: unknown): boolean => {
    const check = defs[type].defaults.schema.validate;
    if (!check) throw new Error(`${type} has no schema validate`);
    return check.call(node, schema);
  };

  describe('s7-read', () => {
    it('accepts a complete schema in struct output', () => {
      expect(validate('s7-read', { outputMode: 'struct', schemaType: 'config' }, complete)).toBe(true);
    });

    it('rejects a field without an offset in struct output', () => {
      expect(validate('s7-read', { outputMode: 'struct', schemaType: 'config' }, incomplete)).toBe(false);
    });

    it('treats a node saved before schemaType existed as using its own schema', () => {
      expect(validate('s7-read', { outputMode: 'struct' }, incomplete)).toBe(false);
    });

    it.each(['single', 'object', 'buffer', 'bits', undefined])('ignores the schema in %s output', (outputMode) => {
      expect(validate('s7-read', { outputMode, schemaType: 'config' }, incomplete)).toBe(true);
    });

    it.each(['msg', 'flow', 'global'])('ignores the node\'s schema when it comes from %s', (schemaType) => {
      expect(validate('s7-read', { outputMode: 'struct', schemaType }, incomplete)).toBe(true);
    });

    it('keeps the default schema valid', () => {
      expect(validate('s7-read', { outputMode: 'struct', schemaType: 'config' }, defs['s7-read'].defaults.schema.value)).toBe(true);
    });
  });

  describe('s7-write', () => {
    it('accepts a complete schema in struct mode', () => {
      expect(validate('s7-write', { mode: 'struct', schemaType: 'config' }, complete)).toBe(true);
    });

    it('rejects a field without an offset in struct mode', () => {
      expect(validate('s7-write', { mode: 'struct', schemaType: 'config' }, incomplete)).toBe(false);
    });

    it('treats a node saved before schemaType existed as using its own schema', () => {
      expect(validate('s7-write', { mode: 'struct' }, incomplete)).toBe(false);
    });

    it.each(['single', 'multi', undefined])('ignores the schema in %s mode', (mode) => {
      expect(validate('s7-write', { mode, schemaType: 'config' }, incomplete)).toBe(true);
    });

    it.each(['msg', 'flow', 'global'])('ignores the node\'s schema when it comes from %s', (schemaType) => {
      expect(validate('s7-write', { mode: 'struct', schemaType }, incomplete)).toBe(true);
    });

    it('keeps the default schema valid', () => {
      expect(validate('s7-write', { mode: 'struct', schemaType: 'config' }, defs['s7-write'].defaults.schema.value)).toBe(true);
    });
  });
});
