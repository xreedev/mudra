/**
 * Declares only the subset of `react-native-zeroconf` that the ASL relay consumes, mirroring
 * `react-native-tts.d.ts` — lets the module be `require`d lazily and type-checked before it is
 * actually installed/linked.
 */
declare module 'react-native-zeroconf' {
  export interface ZeroconfService {
    name: string;
    host?: string;
    port?: number;
  }

  export default class Zeroconf {
    publishService(type: string, protocol: string, domain: string, name: string, port: number): void;
    unpublishService(name: string): void;
    scan(type: string, protocol: string, domain: string): void;
    stop(): void;
    on(event: 'resolved', handler: (service: ZeroconfService) => void): void;
    on(event: 'error', handler: (error: unknown) => void): void;
  }
}
