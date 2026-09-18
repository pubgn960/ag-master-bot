import crypto from 'crypto';

export interface EncryptedPayload {
  cipherText: string;
  iv: string;
  authTag: string;
  keyVersion: string;
  toString?(): string;
}

export class KmsManager {
  private masterKeys: Map<string, Buffer> = new Map();
  private currentVersion: string = 'v1';

  constructor(masterKeyHex?: string, version: string = 'v1') {
    this.currentVersion = version;
    const keyHex = masterKeyHex || process.env.ENCRYPTION_MASTER_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const keyBuffer = Buffer.from(keyHex, 'hex');
    if (keyBuffer.length !== 32) {
      throw new Error(`Master encryption key must be 32 bytes (256 bits). Received ${keyBuffer.length} bytes.`);
    }
    this.masterKeys.set(version, keyBuffer);
  }

  registerKey(version: string, keyHex: string) {
    const keyBuffer = Buffer.from(keyHex, 'hex');
    if (keyBuffer.length !== 32) {
      throw new Error(`Key ${version} must be 32 bytes.`);
    }
    this.masterKeys.set(version, keyBuffer);
  }

  setCurrentVersion(version: string) {
    if (!this.masterKeys.has(version)) {
      throw new Error(`Key version ${version} is not registered.`);
    }
    this.currentVersion = version;
  }

  encrypt(plainText: string): EncryptedPayload {
    const key = this.masterKeys.get(this.currentVersion);
    if (!key) {
      throw new Error(`Current key version ${this.currentVersion} not found`);
    }

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    
    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    return {
      cipherText: encrypted,
      iv: iv.toString('hex'),
      authTag,
      keyVersion: this.currentVersion,
      toString() {
        return `${this.keyVersion}:${this.iv}:${this.authTag}:${this.cipherText}`;
      }
    };
  }

  decrypt(payload: EncryptedPayload): string {
    const key = this.masterKeys.get(payload.keyVersion);
    if (!key) {
      throw new Error(`Key version ${payload.keyVersion} not found for decryption`);
    }

    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(payload.iv, 'hex')
    );
    decipher.setAuthTag(Buffer.from(payload.authTag, 'hex'));

    let decrypted = decipher.update(payload.cipherText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  serializeEncrypted(payload: EncryptedPayload): string {
    return `${payload.keyVersion}:${payload.iv}:${payload.authTag}:${payload.cipherText}`;
  }

  deserializeEncrypted(serialized: string): EncryptedPayload {
    const parts = serialized.split(':');
    if (parts.length !== 4) {
      throw new Error('Invalid serialized encrypted payload format');
    }
    return {
      keyVersion: parts[0],
      iv: parts[1],
      authTag: parts[2],
      cipherText: parts[3],
    };
  }

  maskValue(fieldName: string, value: string): string {
    if (!value || value.length === 0) return '';
    const lower = fieldName.toLowerCase();
    
    if (lower.includes('pass') || lower.includes('secret') || lower.includes('code') || lower.includes('pin')) {
      if (value.length <= 4) return '••••';
      return `${value.slice(0, 2)}••••${value.slice(-2)}`;
    }

    if (lower.includes('email')) {
      const parts = value.split('@');
      if (parts.length === 2) {
        const name = parts[0];
        const domain = parts[1];
        const maskedName = name.length > 2 ? `${name.slice(0, 2)}***` : '***';
        return `${maskedName}@${domain}`;
      }
      return `${value.slice(0, 2)}***`;
    }

    if (lower.includes('phone')) {
      if (value.length <= 6) return '•••-••••';
      return `${value.slice(0, 4)}••••${value.slice(-3)}`;
    }

    if (value.length > 6) {
      return `${value.slice(0, 3)}...${value.slice(-2)}`;
    }
    return value;
  }

  mask(value: string): string {
    return this.maskValue('general', value);
  }
}

export const defaultKms = new KmsManager();
