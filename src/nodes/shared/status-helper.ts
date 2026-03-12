import { Node } from 'node-red';

/**
 * Creates a status update handler for S7 nodes.
 * Maps connection states to Node-RED status indicators.
 */
export function createStatusUpdater(node: Node) {
  return ({ newState }: { newState: string }) => {
    switch (newState) {
      case 'connected':
        node.status({ fill: 'green', shape: 'dot', text: 'connected' });
        break;
      case 'connecting':
      case 'reconnecting':
        node.status({ fill: 'yellow', shape: 'ring', text: newState });
        break;
      case 'error':
        node.status({ fill: 'red', shape: 'dot', text: 'error' });
        break;
      default:
        node.status({ fill: 'grey', shape: 'ring', text: 'disconnected' });
    }
  };
}
