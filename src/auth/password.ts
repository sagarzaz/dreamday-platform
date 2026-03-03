/**
 * Secure password hashing using bcrypt (cost factor 12).
 * WHY bcrypt: industry standard, resistant to GPU/ASIC brute-force, configurable cost.
 */
import * as bcrypt from 'bcrypt';

const SALT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
