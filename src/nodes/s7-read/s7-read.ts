import { NodeAPI, Node, NodeDef, NodeMessage } from 'node-red';
import { S7ConfigNode } from '../s7-config/s7-config-types';
import { parseAddress, toNodes7Address, splitAddresses } from '../../core/address-parser';
import { S7ReadItem, S7ReadResult } from '../../types/s7-address';

interface S7ReadNodeDef extends NodeDef {
  server: string;
  address: string;
  outputMode: 'single' | 'object';
  topic: string;
}

export = function (RED: NodeAPI): void {
  function S7ReadNodeConstructor(this: Node, config: S7ReadNodeDef): void {
    RED.nodes.createNode(this, config);

    const serverNode = RED.nodes.getNode(config.server) as S7ConfigNode | null;
    if (!serverNode) {
      this.status({ fill: 'red', shape: 'ring', text: 'no config' });
      return;
    }

    const updateStatus = ({ newState }: { newState: string }) => {
      switch (newState) {
        case 'connected':
          this.status({ fill: 'green', shape: 'dot', text: 'connected' });
          break;
        case 'connecting':
        case 'reconnecting':
          this.status({ fill: 'yellow', shape: 'ring', text: newState });
          break;
        case 'error':
          this.status({ fill: 'red', shape: 'dot', text: 'error' });
          break;
        default:
          this.status({ fill: 'grey', shape: 'ring', text: 'disconnected' });
      }
    };

    serverNode.connectionManager.on('stateChanged', updateStatus);
    updateStatus({ newState: serverNode.connectionManager.getState() });

    this.on('input', async (msg: NodeMessage, _send, done) => {
      const send = _send || ((m: NodeMessage) => this.send(m));

      try {
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

        if (config.outputMode === 'object' || addresses.length > 1) {
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
      serverNode.connectionManager.removeListener('stateChanged', updateStatus);
    });
  }

  RED.nodes.registerType('s7-read', S7ReadNodeConstructor);
};
