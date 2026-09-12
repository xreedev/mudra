type TcpSocketModule = typeof import('react-native-tcp-socket');
type ZeroconfModule = typeof import('react-native-zeroconf');

let tcpSocketModule: TcpSocketModule | null | undefined;
let zeroconfModule: ZeroconfModule | null | undefined;

/**
 * Both native modules are loaded lazily and defensively, the same way `LocalSpeaker` loads
 * `react-native-tts` and `CallRelay` loads its own native deps: a fresh clone has not run a
 * native build yet, and the app should stay reviewable even when these aren't linked.
 */
export function loadTcpSocket(): TcpSocketModule | null {
  if (tcpSocketModule === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      tcpSocketModule = require('react-native-tcp-socket') as TcpSocketModule;
    } catch {
      tcpSocketModule = null;
    }
  }
  return tcpSocketModule;
}

export function loadZeroconf(): ZeroconfModule | null {
  if (zeroconfModule === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      zeroconfModule = require('react-native-zeroconf') as ZeroconfModule;
    } catch {
      zeroconfModule = null;
    }
  }
  return zeroconfModule;
}

/** Shared mDNS service identity — the receiver publishes this, the sender scans for it. */
export const SERVICE_TYPE = 'aslrelay';
export const SERVICE_PROTOCOL = 'tcp';
export const SERVICE_PORT = 12345;
