import type { Pool } from "pg";
import type { EncryptedPayload, TokenCipher } from "../security/AesGcmTokenCipher.js";
import type { OAuthTokenSet } from "../../domain/brokerage/types.js";
import type { TokenRepository } from "../../domain/brokerage/TokenRepository.js";

interface TokenRecord {
  readonly access_token_ciphertext: EncryptedPayload;
  readonly refresh_token_ciphertext: EncryptedPayload;
  readonly expires_at_epoch_ms: string;
  readonly scope: readonly string[];
}

export class PostgresTokenRepository implements TokenRepository {
  private readonly pool: Pool;
  private readonly cipher: TokenCipher;

  public constructor(pool: Pool, cipher: TokenCipher) {
    this.pool = pool;
    this.cipher = cipher;
  }

  public async loadOAuthTokenSet(connectionId: string): Promise<OAuthTokenSet | null> {
    const result = await this.pool.query<TokenRecord>(
      `select access_token_ciphertext,
              refresh_token_ciphertext,
              expires_at_epoch_ms,
              scope
         from brokerage_oauth_tokens
        where connection_id = $1`,
      [connectionId]
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      accessToken: this.cipher.decryptUtf8(row.access_token_ciphertext, connectionId),
      refreshToken: this.cipher.decryptUtf8(row.refresh_token_ciphertext, connectionId),
      expiresAtEpochMs: Number(row.expires_at_epoch_ms),
      scope: row.scope
    };
  }

  public async saveOAuthTokenSet(connectionId: string, tokenSet: OAuthTokenSet): Promise<void> {
    const accessPayload = this.cipher.encryptUtf8(tokenSet.accessToken, connectionId);
    const refreshPayload = this.cipher.encryptUtf8(tokenSet.refreshToken, connectionId);

    await this.pool.query(
      `insert into brokerage_oauth_tokens (
         connection_id,
         access_token_ciphertext,
         refresh_token_ciphertext,
         expires_at_epoch_ms,
         scope,
         updated_at
       )
       values ($1, $2::jsonb, $3::jsonb, $4, $5, now())
       on conflict (connection_id) do update set
         access_token_ciphertext = excluded.access_token_ciphertext,
         refresh_token_ciphertext = excluded.refresh_token_ciphertext,
         expires_at_epoch_ms = excluded.expires_at_epoch_ms,
         scope = excluded.scope,
         updated_at = now()`,
      [
        connectionId,
        JSON.stringify(accessPayload),
        JSON.stringify(refreshPayload),
        tokenSet.expiresAtEpochMs.toString(),
        tokenSet.scope
      ]
    );
  }
}
