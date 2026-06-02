import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface EncryptedPayload {
  readonly algorithm: string;
  readonly keyId: string;
  readonly ivBase64: string;
  readonly authTagBase64: string;
  readonly ciphertextBase64: string;
}

export interface TokenCipher {
  encryptUtf8(plaintext: string, aad: string): EncryptedPayload;
  decryptUtf8(payload: EncryptedPayload, aad: string): string;
}

export class AesGcmTokenCipher implements TokenCipher {
  private readonly keysById: ReadonlyMap<string, Buffer>;
  private readonly activeKeyId: string;

  public constructor(keysById: ReadonlyMap<string, Buffer>, activeKeyId: string) {
    const activeKey = keysById.get(activeKeyId);
    if (!activeKey) {
      throw new Error(`Active encryption key not found: ${activeKeyId}`);
    }
    for (const [keyId, key] of keysById.entries()) {
      if (key.length !== 32) {
        throw new Error(`AES-256-GCM key ${keyId} must be exactly 32 bytes.`);
      }
    }
    this.keysById = keysById;
    this.activeKeyId = activeKeyId;
  }

  public static fromBase64Key(activeKeyId: string, base64Key: string): AesGcmTokenCipher {
    return new AesGcmTokenCipher(new Map([[activeKeyId, Buffer.from(base64Key, "base64")]]), activeKeyId);
  }

  public encryptUtf8(plaintext: string, aad: string): EncryptedPayload {
    const key = this.requireKey(this.activeKeyId);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(aad, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      algorithm: "aes-256-gcm",
      keyId: this.activeKeyId,
      ivBase64: iv.toString("base64"),
      authTagBase64: authTag.toString("base64"),
      ciphertextBase64: ciphertext.toString("base64")
    };
  }

  public decryptUtf8(payload: EncryptedPayload, aad: string): string {
    if (payload.algorithm !== "aes-256-gcm") {
      throw new Error(`Unsupported cipher algorithm: ${payload.algorithm}`);
    }

    const decipher = createDecipheriv("aes-256-gcm", this.requireKey(payload.keyId), Buffer.from(payload.ivBase64, "base64"));
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(Buffer.from(payload.authTagBase64, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertextBase64, "base64")),
      decipher.final()
    ]);
    return plaintext.toString("utf8");
  }

  private requireKey(keyId: string): Buffer {
    const key = this.keysById.get(keyId);
    if (!key) {
      throw new Error(`Encryption key unavailable: ${keyId}`);
    }
    return key;
  }
}
