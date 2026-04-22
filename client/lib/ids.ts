import { nanoid } from "nanoid";

/** Short client-side id with a human-readable prefix. */
export function makeId(prefix: string): string {
  return `${prefix}_${nanoid(10)}`;
}
