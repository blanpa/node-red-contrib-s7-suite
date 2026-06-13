import { NodeAPI, Node, NodeDef, NodeMessage } from 'node-red';
import { S7ConfigNode } from '../s7-config/s7-config-types';
import { parseAddress, toNodes7Address, splitAddresses } from '../../core/address-parser';
import { Poller, EdgeMode } from '../../core/poller';
import { S7ReadItem, S7ReadResult } from '../../types/s7-address';
import { statusForState } from '../shared/status-helper';

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

    serverNode.registerChildNode(this);

    if (!config.address) {
      this.status({ fill: 'red', shape: 'ring', text: 'no address' });
      return;
    }

    const addresses = splitAddresses(config.address);
    let items: S7ReadItem[];
    try {
      items = addresses.map((a, i) => {
        const parsed = parseAddress(a);
        return {
          name: `item_${i}`,
          address: parsed,
          nodes7Address: toNodes7Address(parsed),
        };
      });
    } catch (err) {
      this.status({ fill: 'red', shape: 'ring', text: 'invalid address' });
      this.error(`Invalid address: ${err instanceof Error ? err.message : String(err)}`);
      serverNode.deregisterChildNode(this);
      return;
    }

    // Editor delivers <input type="number"> values as strings - coerce them.
    const configuredInterval = Number(config.interval) || 1000;
    const poller = new Poller({
      interval: configuredInterval,
      edgeMode: config.edgeMode || 'any',
      deadband: Number(config.deadband) || 0,
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

    let currentInterval = configuredInterval;
    const updateStatus = ({ newState }: { newState: string }) => {
      this.status(
        statusForState(newState, { connectedText: () => `polling ${currentInterval}ms` }),
      );
      if (newState === 'connected') {
        if (!poller.isRunning()) poller.start();
      } else {
        poller.stop();
      }
    };

    this.on('input', (msg: NodeMessage, _send, done) => {
      const m = msg as Record<string, unknown>;
      const update: Record<string, unknown> = {};
      if (typeof m.interval === 'number' && m.interval > 0) update.interval = m.interval;
      if (typeof m.edgeMode === 'string' && ['any', 'rising', 'falling'].includes(m.edgeMode)) update.edgeMode = m.edgeMode;
      if (typeof m.deadband === 'number' && m.deadband >= 0) update.deadband = m.deadband;

      if (Object.keys(update).length > 0) {
        poller.updateConfig(update as Partial<import('../../core/poller').PollerConfig>);
        if (typeof update.interval === 'number') {
          currentInterval = update.interval;
          if (serverNode.connectionManager.getState() === 'connected') {
            this.status({ fill: 'green', shape: 'dot', text: `polling ${currentInterval}ms` });
          }
        }
      }
      done();
    });

    serverNode.connectionManager.on('stateChanged', updateStatus);
    updateStatus({ newState: serverNode.connectionManager.getState() });

    this.on('close', (done: () => void) => {
      poller.stop();
      poller.removeAllListeners();
      if (serverNode) {
        serverNode.deregisterChildNode(this);
        serverNode.connectionManager.removeListener('stateChanged', updateStatus);
      }
      done();
    });
  }

  RED.nodes.registerType('s7-trigger', S7TriggerNodeConstructor);
};
