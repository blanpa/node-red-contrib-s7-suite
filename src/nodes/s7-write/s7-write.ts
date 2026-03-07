import { NodeAPI, Node, NodeDef, NodeMessage } from 'node-red';
import { S7ConfigNode } from '../s7-config/s7-config-types';
import { parseAddress, toNodes7Address } from '../../core/address-parser';
import { S7WriteItem } from '../../types/s7-address';

interface S7WriteNodeDef extends NodeDef {
  server: string;
  address: string;
}

export = function (RED: NodeAPI): void {
  function S7WriteNodeConstructor(this: Node, config: S7WriteNodeDef): void {
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
      serverNode.connectionManager.removeListener('stateChanged', updateStatus);
    });
  }

  RED.nodes.registerType('s7-write', S7WriteNodeConstructor);
};
