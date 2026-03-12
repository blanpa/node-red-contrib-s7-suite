import { createStatusUpdater } from '../../../../src/nodes/shared/status-helper';

describe('createStatusUpdater', () => {
  let mockNode: { status: jest.Mock };
  let updateStatus: ReturnType<typeof createStatusUpdater>;

  beforeEach(() => {
    mockNode = { status: jest.fn() };
    updateStatus = createStatusUpdater(mockNode as any); // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  it('sets green dot for connected', () => {
    updateStatus({ newState: 'connected' });
    expect(mockNode.status).toHaveBeenCalledWith({ fill: 'green', shape: 'dot', text: 'connected' });
  });

  it('sets yellow ring for connecting', () => {
    updateStatus({ newState: 'connecting' });
    expect(mockNode.status).toHaveBeenCalledWith({ fill: 'yellow', shape: 'ring', text: 'connecting' });
  });

  it('sets yellow ring for reconnecting', () => {
    updateStatus({ newState: 'reconnecting' });
    expect(mockNode.status).toHaveBeenCalledWith({ fill: 'yellow', shape: 'ring', text: 'reconnecting' });
  });

  it('sets red dot for error', () => {
    updateStatus({ newState: 'error' });
    expect(mockNode.status).toHaveBeenCalledWith({ fill: 'red', shape: 'dot', text: 'error' });
  });

  it('sets grey ring for disconnected', () => {
    updateStatus({ newState: 'disconnected' });
    expect(mockNode.status).toHaveBeenCalledWith({ fill: 'grey', shape: 'ring', text: 'disconnected' });
  });

  it('sets grey ring for unknown state', () => {
    updateStatus({ newState: 'unknown' });
    expect(mockNode.status).toHaveBeenCalledWith({ fill: 'grey', shape: 'ring', text: 'disconnected' });
  });
});
