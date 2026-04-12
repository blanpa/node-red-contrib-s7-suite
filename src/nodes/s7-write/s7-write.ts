import { NodeAPI, Node, NodeDef, NodeMessage } from 'node-red';
import { S7ConfigNode } from '../s7-config/s7-config-types';
import { parseAddress, toNodes7Address } from '../../core/address-parser';
import { S7WriteItem, S7StructField, AREA_CODE_MAP } from '../../types/s7-address';
import { writeValue, byteLength } from '../../core/data-converter';
import { createStatusUpdater } from '../shared/status-helper';

interface S7WriteNodeDef extends NodeDef {
  server: string;
  address: string;
  mode: 'single' | 'multi' | 'struct';
  schema: string; // JSON-encoded S7StructField[]
}

export = function (RED: NodeAPI): void {
  function S7WriteNodeConstructor(this: Node, config: S7WriteNodeDef): void {
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
        const mode = ((msg as Record<string, unknown>).mode as string) || config.mode || 'single';

        if (msg.topic !== undefined && typeof msg.topic !== 'string') {
          done(new Error('msg.topic must be a string'));
          return;
        }
        const topicAddress = typeof msg.topic === 'string' ? msg.topic : undefined;

        if (mode === 'multi') {
          // Multi-write: msg.payload is an object { address: value, ... }
          const payload = msg.payload as Record<string, unknown>;
          if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            done(new Error('Multi-write mode requires msg.payload to be an object { address: value }'));
            return;
          }

          const entries = Object.entries(payload);
          if (entries.length === 0) {
            done(new Error('Multi-write payload is empty'));
            return;
          }

          const items: S7WriteItem[] = entries.map(([addr, value], i) => {
            const parsed = parseAddress(addr);
            return {
              name: `item_${i}`,
              address: parsed,
              nodes7Address: toNodes7Address(parsed),
              value,
            };
          });

          await serverNode.connectionManager.write(items);
          send(msg);
          done();
          return;
        }

        if (mode === 'struct') {
          // Struct-write: read-modify-write using schema
          const addressStr = topicAddress || config.address;
          if (!addressStr) {
            done(new Error('No base address specified'));
            return;
          }

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

          const payload = msg.payload as Record<string, unknown>;
          if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            done(new Error('Struct-write mode requires msg.payload to be an object'));
            return;
          }

          const validTypes: Set<string> = new Set([
            'BOOL', 'BYTE', 'WORD', 'DWORD', 'INT', 'DINT', 'REAL', 'LREAL', 'CHAR', 'STRING',
          ]);
          for (const field of schema) {
            if (!field.name || typeof field.name !== 'string') {
              done(new Error('Schema field missing required "name" property'));
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

          const baseParsed = parseAddress(addressStr.trim());
          const areaCode = AREA_CODE_MAP[baseParsed.area];
          if (areaCode === undefined) {
            done(new Error(`Unsupported area: ${baseParsed.area}`));
            return;
          }

          // Calculate required buffer length from schema
          let requiredLength = 0;
          for (const field of schema) {
            const fieldEnd = field.offset + byteLength(field.type, field.length);
            if (fieldEnd > requiredLength) requiredLength = fieldEnd;
          }

          // Read current buffer (read-modify-write for BOOL support)
          const buffer = await serverNode.connectionManager.readRawArea(
            areaCode, baseParsed.dbNumber, baseParsed.offset, requiredLength
          );

          // Write each matching field into the buffer
          const fieldsToWrite: S7StructField[] = [];
          for (const field of schema) {
            if (field.name in payload) {
              writeValue(buffer, field.offset, field.type, payload[field.name], field.bit ?? 0);
              fieldsToWrite.push(field);
            }
          }

          if (fieldsToWrite.length === 0) {
            done(new Error('No fields in msg.payload match the schema'));
            return;
          }

          // Build individual S7WriteItem for each modified field and write via connectionManager
          const items: S7WriteItem[] = fieldsToWrite.map((field, i) => {
            const fieldAddress = {
              ...baseParsed,
              dataType: field.type,
              offset: baseParsed.offset + field.offset,
              bitOffset: field.bit ?? 0,
              stringLength: field.length,
            };
            return {
              name: `struct_${i}`,
              address: fieldAddress,
              nodes7Address: toNodes7Address(fieldAddress),
              value: payload[field.name],
            };
          });

          await serverNode.connectionManager.write(items);
          send(msg);
          done();
          return;
        }

        // Single mode (default): current behavior
        const addressStr = topicAddress || config.address;
        if (!addressStr) {
          done(new Error('No address specified'));
          return;
        }

        if (msg.payload === undefined || msg.payload === null) {
          done(new Error('msg.payload is required for single write mode'));
          return;
        }
        const pType = typeof msg.payload;
        if (pType !== 'number' && pType !== 'boolean' && pType !== 'string' && pType !== 'bigint') {
          done(new Error(`msg.payload must be a number, boolean, string, or bigint for single write mode (got ${pType})`));
          return;
        }

        const parsed = parseAddress(addressStr);
        const items: S7WriteItem[] = [
          {
            name: 'item_0',
            address: parsed,
            nodes7Address: toNodes7Address(parsed),
            value: msg.payload,
          },
        ];

        await serverNode.connectionManager.write(items);

        // Pass-through on success
        send(msg);
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

  RED.nodes.registerType('s7-write', S7WriteNodeConstructor);
};
