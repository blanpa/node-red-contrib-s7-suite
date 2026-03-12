import { NodeAPI, Node, NodeDef, NodeMessage } from 'node-red';
import { S7ConfigNode } from '../s7-config/s7-config-types';
import { parseAddress, toNodes7Address, splitAddresses } from '../../core/address-parser';
import { S7ReadItem, S7ReadResult, S7StructField, AREA_CODE_MAP } from '../../types/s7-address';
import { readValue, byteLength } from '../../core/data-converter';
import { createStatusUpdater } from '../shared/status-helper';

interface S7ReadNodeDef extends NodeDef {
  server: string;
  address: string;
  outputMode: 'single' | 'object' | 'buffer' | 'struct' | 'bits';
  topic: string;
  schema: string; // JSON-encoded S7StructField[]
}

export = function (RED: NodeAPI): void {
  function S7ReadNodeConstructor(this: Node, config: S7ReadNodeDef): void {
    RED.nodes.createNode(this, config);

    const serverNode = RED.nodes.getNode(config.server) as S7ConfigNode | null;
    if (!serverNode) {
      this.status({ fill: 'red', shape: 'ring', text: 'no config' });
      return;
    }

    serverNode.registerChildNode(this);

    const updateStatus = createStatusUpdater(this);

    serverNode.connectionManager.on('stateChanged', updateStatus);
    updateStatus({ newState: serverNode.connectionManager.getState() });

    this.on('input', async (msg: NodeMessage, _send, done) => {
      const send = _send || ((m: NodeMessage) => this.send(m));

      try {
        const outputMode = config.outputMode || 'single';

        if (outputMode === 'buffer' || outputMode === 'bits') {
          const addressStr = (msg.topic as string) || config.address;
          if (!addressStr) {
            done(new Error('No address specified'));
            return;
          }

          const parsed = parseAddress(addressStr.trim());
          const areaCode = AREA_CODE_MAP[parsed.area];
          if (areaCode === undefined) {
            done(new Error(`Unsupported area: ${parsed.area}`));
            return;
          }

          const length = parsed.arrayLength || byteLength(parsed.dataType, parsed.stringLength);
          const buffer = await serverNode.connectionManager.readRawArea(
            areaCode, parsed.dbNumber, parsed.offset, length
          );

          if (outputMode === 'buffer') {
            send({ ...msg, payload: buffer } as NodeMessage);
          } else {
            // bits mode: unpack each byte into boolean array (LSB first)
            const bits: boolean[] = [];
            for (let i = 0; i < buffer.length; i++) {
              const byte = buffer[i];
              for (let bit = 0; bit < 8; bit++) {
                bits.push((byte & (1 << bit)) !== 0);
              }
            }
            send({ ...msg, payload: bits } as NodeMessage);
          }

          done();
          return;
        }

        if (outputMode === 'struct') {
          const addressStr = (msg.topic as string) || config.address;
          if (!addressStr) {
            done(new Error('No address specified'));
            return;
          }

          // Schema from msg.schema (runtime override) or config
          const schemaSource = (msg as Record<string, unknown>).schema || config.schema;
          if (!schemaSource) {
            done(new Error('No schema specified'));
            return;
          }

          let schema: S7StructField[];
          try {
            schema = typeof schemaSource === 'string'
              ? JSON.parse(schemaSource)
              : schemaSource as S7StructField[];
          } catch {
            done(new Error('Invalid JSON in schema'));
            return;
          }

          if (!Array.isArray(schema) || schema.length === 0) {
            done(new Error('Schema must be a non-empty array'));
            return;
          }

          const validTypes: Set<string> = new Set([
            'BOOL', 'BYTE', 'WORD', 'DWORD', 'INT', 'DINT', 'REAL', 'LREAL', 'CHAR', 'STRING',
            'USINT', 'UINT', 'UDINT', 'LINT', 'ULINT',
            'DATE', 'TIME', 'TIME_OF_DAY', 'DATE_AND_TIME', 'S5TIME',
            'WSTRING',
          ]);
          for (const field of schema) {
            if (!field.name || typeof field.name !== 'string') {
              done(new Error(`Schema field missing required "name" property`));
              return;
            }
            if (!field.type || !validTypes.has(field.type)) {
              done(new Error(`Schema field "${field.name}" has invalid type: "${field.type}"`));
              return;
            }
            if (field.offset === undefined || typeof field.offset !== 'number' || field.offset < 0) {
              done(new Error(`Schema field "${field.name}" has invalid offset: ${field.offset}`));
              return;
            }
          }

          const parsed = parseAddress(addressStr.trim());
          const areaCode = AREA_CODE_MAP[parsed.area];
          if (areaCode === undefined) {
            done(new Error(`Unsupported area: ${parsed.area}`));
            return;
          }

          // Calculate required buffer length from schema
          let requiredLength = 0;
          for (const field of schema) {
            const fieldEnd = field.offset + byteLength(field.type, field.length);
            if (fieldEnd > requiredLength) requiredLength = fieldEnd;
          }

          const buffer = await serverNode.connectionManager.readRawArea(
            areaCode, parsed.dbNumber, parsed.offset, requiredLength
          );

          const result: Record<string, unknown> = {};
          for (const field of schema) {
            result[field.name] = readValue(buffer, field.offset, field.type, field.bit ?? 0);
          }

          send({ ...msg, payload: result } as NodeMessage);
          done();
          return;
        }

        // Original single/object modes
        const addressStr = (msg.topic as string) || config.address;
        if (!addressStr) {
          done(new Error('No address specified'));
          return;
        }

        const addresses = splitAddresses(addressStr);
        const items: S7ReadItem[] = addresses.map((a, i) => {
          const parsed = parseAddress(a);
          return {
            name: `item_${i}`,
            address: parsed,
            nodes7Address: toNodes7Address(parsed),
          };
        });

        const results: S7ReadResult[] = await serverNode.connectionManager.read(items);

        if (outputMode === 'object' || addresses.length > 1) {
          const payload: Record<string, unknown> = {};
          for (let i = 0; i < results.length; i++) {
            payload[addresses[i]] = results[i].value;
          }
          send({ ...msg, payload } as NodeMessage);
        } else {
          send({ ...msg, payload: results[0]?.value ?? null } as NodeMessage);
        }

        done();
      } catch (err) {
        done(err instanceof Error ? err : new Error(String(err)));
      }
    });

    this.on('close', () => {
      if (serverNode) {
        serverNode.deregisterChildNode(this);
        serverNode.connectionManager.removeListener('stateChanged', updateStatus);
      }
    });
  }

  RED.nodes.registerType('s7-read', S7ReadNodeConstructor);
};
