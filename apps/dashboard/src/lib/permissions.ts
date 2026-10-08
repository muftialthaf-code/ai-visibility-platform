import type { Role } from '@avp/db';

/**
 * What each role may do. Phase 3 ships with the owner only, but every action is checked
 * against this table from day one so adding editors, reviewers and clients needs no rewrite.
 */
export type Capability =
  | 'overview:read'
  | 'tenants:read'
  | 'tenants:write'
  | 'tenants:lifecycle' // add, remove, export, roll back
  | 'agent:control' // run now, pause
  | 'review:read'
  | 'review:act'
  | 'content:write'
  | 'runs:read'
  | 'reports:read'
  | 'users:manage'
  | 'settings:manage'
  | 'audit:read';

const ALL: Capability[] = [
  'overview:read', 'tenants:read', 'tenants:write', 'tenants:lifecycle', 'agent:control',
  'review:read', 'review:act', 'content:write', 'runs:read', 'reports:read',
  'users:manage', 'settings:manage', 'audit:read',
];

export const ROLE_CAPABILITIES: Record<Role, Capability[]> = {
  owner: ALL,
  editor: ['overview:read', 'tenants:read', 'tenants:write', 'agent:control', 'review:read', 'review:act', 'content:write', 'runs:read', 'reports:read'],
  reviewer: ['overview:read', 'tenants:read', 'review:read', 'review:act', 'runs:read'],
  // Clients only ever see their own tenant's reports (enforced by tenant scoping below).
  client: ['reports:read'],
};

export interface Actor {
  role: Role;
  /** The business a client account belongs to (the users.tenant_id column). */
  tenant_id: string | null;
}

/** Can this user do this, optionally for a specific tenant? Clients are confined to their own tenant. */
export function can(actor: Actor, capability: Capability, tenantId?: string): boolean {
  if (!ROLE_CAPABILITIES[actor.role].includes(capability)) return false;
  if (actor.role === 'client') return tenantId !== undefined && actor.tenant_id === tenantId;
  return true;
}
