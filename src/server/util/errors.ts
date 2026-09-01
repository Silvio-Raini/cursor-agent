export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode = 400,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function toPublicError(err: unknown): { statusCode: number; body: { success: false; error: { code: string; message: string } } } {
  if (err instanceof AppError) {
    return {
      statusCode: err.statusCode,
      body: { success: false, error: { code: err.code, message: err.message } },
    };
  }
  return {
    statusCode: 500,
    body: { success: false, error: { code: 'INTERNAL', message: 'Interner Fehler.' } },
  };
}
