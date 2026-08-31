import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

export class SensitiveDataCipher {
  readonly key: Buffer;
  constructor(base64Key: string, readonly lookupSecret: string) {
    this.key = Buffer.from(base64Key, "base64");
    if (this.key.byteLength !== 32 || lookupSecret.length < 32)
      throw new Error("sensitive-data key material invalid");
  }
  encrypt(value: string): Buffer {
    if (!value.trim()) throw new Error("sensitive value empty");
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", this.key, iv), ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]), tag = cipher.getAuthTag();
    return Buffer.concat([Buffer.from([1]), iv, tag, ciphertext]);
  }
  decrypt(envelope: Uint8Array): string {
    const bytes = Buffer.from(envelope);
    if (bytes.byteLength < 30 || bytes[0] !== 1) throw new Error("sensitive envelope invalid");
    const decipher = createDecipheriv("aes-256-gcm", this.key, bytes.subarray(1,13));
    decipher.setAuthTag(bytes.subarray(13,29));
    return Buffer.concat([decipher.update(bytes.subarray(29)), decipher.final()]).toString("utf8");
  }
  lookup(value: string): string {
    return createHmac("sha256", this.lookupSecret).update(value.trim().toLowerCase()).digest("hex");
  }
}
