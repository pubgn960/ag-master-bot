export interface StorageAdapter {
  storeImage(bufferOrBase64: string, filename: string): Promise<string>;
  getSignedUrl(imageRef: string, expiresInSeconds?: number): Promise<string>;
}

export class MockStorageAdapter implements StorageAdapter {
  private files: Map<string, string> = new Map();

  async storeImage(bufferOrBase64: string, filename: string): Promise<string> {
    const ref = `storage_ref_${Date.now()}_${filename}`;
    this.files.set(ref, bufferOrBase64);
    return ref;
  }

  async getSignedUrl(imageRef: string, expiresInSeconds: number = 3600): Promise<string> {
    const expiresAt = Date.now() + expiresInSeconds * 1000;
    return `https://storage.itechavengers.local/signed/${imageRef}?token=signed_mock_token&expires=${expiresAt}`;
  }
}
