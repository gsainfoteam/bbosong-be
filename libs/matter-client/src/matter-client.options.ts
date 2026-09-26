export type MatterSiteConfig = {
  id: string;
  wsUrl: string;
};
export type MatterClientModuleOptions = {
  sites: MatterSiteConfig[];
};
export const MATTER_CLIENT_OPTIONS = Symbol('MATTER_CLIENT_OPTIONS');
