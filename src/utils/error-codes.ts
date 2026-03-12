export enum S7ErrorCode {
  CONNECTION_FAILED = 'CONNECTION_FAILED',
  CONNECTION_TIMEOUT = 'CONNECTION_TIMEOUT',
  DISCONNECTED = 'DISCONNECTED',
  READ_FAILED = 'READ_FAILED',
  WRITE_FAILED = 'WRITE_FAILED',
  INVALID_ADDRESS = 'INVALID_ADDRESS',
  INVALID_DATA_TYPE = 'INVALID_DATA_TYPE',
  BACKEND_NOT_AVAILABLE = 'BACKEND_NOT_AVAILABLE',
  BROWSE_FAILED = 'BROWSE_FAILED',
  RATE_LIMITED = 'RATE_LIMITED',
  QUEUE_FULL = 'QUEUE_FULL',
  REQUEST_TIMEOUT = 'REQUEST_TIMEOUT',
  CONTROL_FAILED = 'CONTROL_FAILED',
}

export class S7Error extends Error {
  constructor(
    public readonly code: S7ErrorCode,
    message: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'S7Error';
  }
}
