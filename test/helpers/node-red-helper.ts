// Re-export node-red-node-test-helper for use in tests
let helper: any; // eslint-disable-line @typescript-eslint/no-explicit-any

try {
  helper = require('node-red-node-test-helper');
} catch {
  // Provide a stub if not available
  helper = {
    init: () => {},
    load: () => Promise.resolve(),
    unload: () => Promise.resolve(),
    getNode: () => null,
    startServer: () => {},
    stopServer: () => {},
  };
}

export default helper;
