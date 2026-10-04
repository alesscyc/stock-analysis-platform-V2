export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export function badRequest(message) {
  throw new HttpError(400, message);
}
