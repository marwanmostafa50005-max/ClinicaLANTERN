import type { HealthResponse, LanternConfig } from '../../shared/types.ts';

export function makeOwnedDataDir(requested: string, temporaryRoot: string): string;
export function removeOwnedDataDir(dir: string): Promise<boolean>;
export function standInHealth(cfg: LanternConfig): HealthResponse;
