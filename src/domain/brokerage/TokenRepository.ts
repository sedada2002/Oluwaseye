import type { OAuthTokenSet } from "./types.js";

export interface TokenRepository {
  loadOAuthTokenSet(connectionId: string): Promise<OAuthTokenSet | null>;
  saveOAuthTokenSet(connectionId: string, tokenSet: OAuthTokenSet): Promise<void>;
}
