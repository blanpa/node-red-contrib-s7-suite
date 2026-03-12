import { Node } from 'node-red';
import { ConnectionManager } from '../../core/connection-manager';
import { S7ConnectionConfig } from '../../types/s7-connection';

export interface S7ConfigNode extends Node {
  connectionManager: ConnectionManager;
  s7Config: S7ConnectionConfig;
  registerChildNode(node: Node): void;
  deregisterChildNode(node: Node): void;
}
