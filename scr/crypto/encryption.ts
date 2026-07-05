import CryptoJS from 'crypto-js';

function getKey(): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length < 32) {
    throw new Error('ENCRYPTION_KEY must be set and at least 32 characters');
  }
  return key;
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const encrypted = CryptoJS.AES.encrypt(plaintext, key);
  return encrypted.toString();
}

export function decrypt(ciphertext: string): string {
  const key = getKey();
  const bytes = CryptoJS.AES.decrypt(ciphertext, key);
  const decrypted = bytes.toString(CryptoJS.enc.Utf8);
  if (!decrypted) throw new Error('Decryption failed — invalid key or corrupted data');
  return decrypted;
}

export function maskKey(apiKey: string): string {
  if (apiKey.length < 8) return '****';
  return apiKey.slice(0, 4) + '****' + apiKey.slice(-4);
}
