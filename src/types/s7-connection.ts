export type PlcType = 'S7-200' | 'S7-300' | 'S7-400' | 'S7-1200' | 'S7-1500' | 'LOGO';

export type BackendType = 'nodes7' | 'snap7' | 'sim';

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

export interface S7ConnectionConfig {
  host: string;
  port: number;
  rack: number;
  slot: number;
  plcType: PlcType;
  backend: BackendType;
  localTSAP?: number;
  remoteTSAP?: number;
  password?: string;
  connectionTimeout?: number;
  requestTimeout?: number;
  reconnectInterval?: number;
  maxReconnectInterval?: number;
}

export const PLC_DEFAULT_SLOTS: Record<PlcType, number> = {
  'S7-200': 1,
  'S7-300': 2,
  'S7-400': 3,
  'S7-1200': 1,
  'S7-1500': 1,
  'LOGO': 1,
};
