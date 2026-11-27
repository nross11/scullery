export function id(): string {
  return crypto.randomUUID();
}

export function now(): string {
  return new Date().toISOString();
}

export function normTag(t: string): string {
  return t.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 40);
}
