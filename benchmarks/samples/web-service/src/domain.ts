export interface SampleDomainConfig {
  id: string;
  owner: string;
}

export function resolveSampleDomain(config: SampleDomainConfig): string {
  return `${config.owner}:${config.id}`;
}
