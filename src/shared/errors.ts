export class DomainError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}

export class ExternalServiceError extends Error {
  public readonly provider: string;
  public readonly retryable: boolean;

  public constructor(provider: string, message: string, retryable: boolean) {
    super(message);
    this.name = "ExternalServiceError";
    this.provider = provider;
    this.retryable = retryable;
  }
}
