import { createBackend, isSnap7Available } from '../../../src/backend/backend-factory';
import { NodeS7Backend } from '../../../src/backend/nodes7-backend';

describe('BackendFactory', () => {
  it('creates nodes7 backend', () => {
    const backend = createBackend('nodes7');
    expect(backend).toBeInstanceOf(NodeS7Backend);
  });

  it('throws for snap7 when not installed', () => {
    // node-snap7 is likely not installed in test env
    if (!isSnap7Available()) {
      expect(() => createBackend('snap7')).toThrow('node-snap7 is not installed');
    }
  });

  it('throws for unknown backend type', () => {
    expect(() => createBackend('unknown' as any)).toThrow('Unknown backend type');
  });

  it('reports snap7 availability', () => {
    const result = isSnap7Available();
    expect(typeof result).toBe('boolean');
  });
});
