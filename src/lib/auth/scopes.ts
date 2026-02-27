export const SCOPES = {
  READ: "read",
  WRITE: "write",
  FINANCIAL: "financial",
  ADMIN: "admin",
} as const;

export type Scope = (typeof SCOPES)[keyof typeof SCOPES];

export const ALL_SCOPES: Scope[] = [
  SCOPES.READ,
  SCOPES.WRITE,
  SCOPES.FINANCIAL,
  SCOPES.ADMIN,
];

export const DEFAULT_SCOPES: Scope[] = [
  SCOPES.READ,
  SCOPES.WRITE,
  SCOPES.FINANCIAL,
];

export function hasScope(agentScopes: string[], required: Scope): boolean {
  return agentScopes.includes(required);
}

export function hasAllScopes(
  agentScopes: string[],
  required: Scope[]
): boolean {
  return required.every((s) => agentScopes.includes(s));
}

export function validateScopes(scopes: string[]): scopes is Scope[] {
  return scopes.every((s) =>
    (ALL_SCOPES as readonly string[]).includes(s)
  );
}
