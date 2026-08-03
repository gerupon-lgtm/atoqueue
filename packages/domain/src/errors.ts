export class CorruptDataError extends Error {
  constructor(message = "Stored application data is corrupt.") {
    super(message);
    this.name = "CorruptDataError";
  }
}

export class UnsupportedSchemaVersionError extends Error {
  constructor(version: unknown) {
    super(`Unsupported schema version: ${String(version)}`);
    this.name = "UnsupportedSchemaVersionError";
  }
}

export class PersistenceError extends Error {
  constructor(message = "Unable to persist application data.", options?: ErrorOptions) {
    super(message, options);
    this.name = "PersistenceError";
  }
}
