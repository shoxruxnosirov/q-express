// Postgres error codes, read off an error from the driver or from drizzle,
// which wraps the driver's error in `cause`.
const codeOf = (value: unknown) => (value as { code?: unknown } | undefined)?.code;

function hasCode(error: unknown, code: string) {
  return codeOf(error) === code || codeOf((error as { cause?: unknown } | undefined)?.cause) === code;
}

export const isUniqueViolation = (error: unknown) => hasCode(error, "23505");
export const isForeignKeyViolation = (error: unknown) => hasCode(error, "23503");
