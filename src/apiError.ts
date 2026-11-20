/** A failed call. `message` is plain English and safe to show. `status` is 0 when the server did not answer. */
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}
