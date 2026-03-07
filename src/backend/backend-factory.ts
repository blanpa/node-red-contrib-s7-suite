import { BackendType } from '../types/s7-connection';
import { IS7Backend } from './s7-backend.interface';
import { NodeS7Backend } from './nodes7-backend';
import { SimBackend } from './sim-backend';
import { S7Error, S7ErrorCode } from '../utils/error-codes';

export function createBackend(type: BackendType): IS7Backend {
  switch (type) {
    case 'sim':
      return new SimBackend();
    case 'nodes7':
      return new NodeS7Backend();
    case 'snap7': {
      try {
        require.resolve('node-snap7');
      } catch {
        throw new S7Error(
          S7ErrorCode.BACKEND_NOT_AVAILABLE,
          'node-snap7 is not installed. Install it with: npm install node-snap7',
        );
      }
      // Dynamic import to avoid crash if native module is missing
      const { Snap7Backend } = require('./snap7-backend');
      return new Snap7Backend();
    }
    default:
      throw new S7Error(S7ErrorCode.BACKEND_NOT_AVAILABLE, `Unknown backend type: ${type}`);
  }
}

export function isSnap7Available(): boolean {
  try {
    require.resolve('node-snap7');
    return true;
  } catch {
    return false;
  }
}
