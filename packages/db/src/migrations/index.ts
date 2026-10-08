import { sql as core } from './001_core.ts';
import { sql as agent } from './002_agent.ts';
import { sql as tracker } from './003_tracker.ts';

export interface Migration {
  name: string;
  sql: string;
}

/**
 * Migrations are embedded as code, not read from disk, so they travel with the bundle on any host.
 * Add new ones to the end of this list. Never edit a migration that has been applied anywhere.
 */
export const MIGRATIONS: Migration[] = [
  { name: '001_core', sql: core },
  { name: '002_agent', sql: agent },
  { name: '003_tracker', sql: tracker },
];
