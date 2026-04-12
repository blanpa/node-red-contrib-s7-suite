import { Node, NodeStatus } from 'node-red';

export interface StatusUpdaterOptions {
  /** Text shown when the connection state is 'connected'. Defaults to 'connected'. */
  connectedText?: string | (() => string);
}

/**
 * Maps a connection state string to a Node-RED status object.
 */
export function statusForState(
  newState: string,
  options: StatusUpdaterOptions = {},
): NodeStatus {
  switch (newState) {
    case 'connected': {
      const text = typeof options.connectedText === 'function'
        ? options.connectedText()
        : options.connectedText ?? 'connected';
      return { fill: 'green', shape: 'dot', text };
    }
    case 'connecting':
    case 'reconnecting':
      return { fill: 'yellow', shape: 'ring', text: newState };
    case 'error':
      return { fill: 'red', shape: 'dot', text: 'error' };
    default:
      return { fill: 'grey', shape: 'ring', text: 'disconnected' };
  }
}

/**
 * Creates a status update handler for S7 nodes.
 * Maps connection states to Node-RED status indicators.
 */
export function createStatusUpdater(node: Node, options: StatusUpdaterOptions = {}) {
  return ({ newState }: { newState: string }) => {
    node.status(statusForState(newState, options));
  };
}
