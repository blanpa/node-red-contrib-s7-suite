import { NodeAPI, Node, NodeDef, NodeMessage } from 'node-red';
import { S7ConfigNode } from '../s7-config/s7-config-types';
import { parseAddress, toNodes7Address, splitAddresses } from '../../core/address-parser';
import { Poller, EdgeMode } from '../../core/poller';
import { S7ReadItem, S7ReadResult } from '../../types/s7-address';

interface S7TriggerNodeDef extends NodeDef {
  server: string;
  address: string;
  interval: number;
  edgeMode: EdgeMode;
  deadband: number;
}

export = function (RED: NodeAPI): void {
  function S7TriggerNodeConstructor(this: Node, config: S7TriggerNodeDef): void {
    RED.nodes.createNode(this, config);

    const serverNode = RED.nodes.getNode(config.server) as S7ConfigNode | null;
    if (!serverNode) {
      this.status({ fill: 'red', shape: 'ring', text: 'no config' });
      return;
    }

    if (!config.address) {
      this.status({ fill: 'red', shape: 'ring', text: 'no address' });
      return;
    }

    const addresses = splitAddresses(config.address);
    const items: S7ReadItem[] = addresses.map((a, i) => {
      const parsed = parseAddress(a);
      return {
        name: `item_${i}`,
        address: parsed,
        nodes7Address: toNodes7Address(parsed),
      };
    });

    const poller = new Poller({
      interval: config.interval || 1000,
      edgeMode: config.edgeMode || 'any',
      deadband: config.deadband || 0,
    });

    for (const item of items) {
      poller.addItem(item.name);
    }

    poller.setReadFunction(async () => {
      const results: S7ReadResult[] = await serverNode.connectionManager.read(items);
      const map = new Map<string, unknown>();
      for (const r of results) {
        map.set(r.name, r.value);
      }
      return map;
    });

    poller.on('changed', ({ name, value, oldValue }) => {
      const index = parseInt(name.replace('item_', ''), 10);
      const addr = addresses[index] || name;
      const msg: NodeMessage = {
        topic: addr,
        payload: value,
        _msgid: '',
      };
      (msg as Record<string, unknown>).oldValue = oldValue;
      this.send(msg);
    });

    poller.on('error', (err: Error) => {
      this.error(err.message);
    });

    const updateStatus = ({ newState }: { newState: string }) => {
      switch (newState) {
        case 'connected':
          this.status({ fill: 'green', shape: 'dot', text: `polling ${config.interval}ms` });
          if (!poller.isRunning()) poller.start();
          break;
        case 'connecting':
        case 'reconnecting':
          this.status({ fill: 'yellow', shape: 'ring', text: newState });
          poller.stop();
          break;
        case 'error':
          this.status({ fill: 'red', shape: 'dot', text: 'error' });
          poller.stop();
          break;
        default:
          this.status({ fill: 'grey', shape: 'ring', text: 'disconnected' });
          poller.stop();
      }
    };

    serverNode.connectionManager.on('stateChanged', updateStatus);
    updateStatus({ newState: serverNode.connectionManager.getState() });

    this.on('close', (done: () => void) => {
      poller.stop();
      poller.removeAllListeners();
      serverNode.connectionManager.removeListener('stateChanged', updateStatus);
      done();
    });
  }

  RED.nodes.registerType('s7-trigger', S7TriggerNodeConstructor);
};
