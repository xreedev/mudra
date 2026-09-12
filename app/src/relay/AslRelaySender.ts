import type { TcpSocket } from 'react-native-tcp-socket';
import type ZeroconfClass from 'react-native-zeroconf';
import { loadTcpSocket, loadZeroconf, SERVICE_PROTOCOL, SERVICE_TYPE } from './nativeModules';

export type SenderStatus = 'scanning' | 'connecting' | 'connected' | 'disconnected' | 'unavailable';

export type SenderState = {
  status: SenderStatus;
  /** The receiver's advertised name once connected — null until then. */
  peerName: string | null;
};

/**
 * The "this phone" side of the same-WiFi ASL relay (see `asl-relay-rn`): scans for a receiver
 * advertised via mDNS and auto-connects to the first one found — no peer list to pick from,
 * since the common case here is exactly two phones in the same room. `sendText` is the one
 * method the rest of the app needs; everything else is connection bookkeeping.
 */
export class AslRelaySender {
  private readonly tcpSocket = loadTcpSocket();
  private readonly zeroconf = loadZeroconf();
  private zeroconfInstance: ZeroconfClass | null = null;
  private socket: TcpSocket | null = null;
  private connecting = false;

  isAvailable(): boolean {
    return this.tcpSocket !== null && this.zeroconf !== null;
  }

  start(onStateChange: (state: SenderState) => void): void {
    const ZeroconfCtor = this.zeroconf?.default;
    if (!ZeroconfCtor || this.zeroconfInstance) return;

    const zeroconf = new ZeroconfCtor();
    this.zeroconfInstance = zeroconf;

    zeroconf.on('resolved', (service) => {
      if (this.socket || this.connecting || !service.host || !service.port) return;
      this.connect(service.host, service.port, service.name, onStateChange);
    });
    zeroconf.on('error', () => onStateChange({ status: 'unavailable', peerName: null }));

    onStateChange({ status: 'scanning', peerName: null });
    zeroconf.scan(SERVICE_TYPE, SERVICE_PROTOCOL, 'local.');
  }

  private connect(
    host: string,
    port: number,
    name: string,
    onStateChange: (state: SenderState) => void,
  ): void {
    const tcpSocket = this.tcpSocket;
    if (!tcpSocket) return;

    this.connecting = true;
    onStateChange({ status: 'connecting', peerName: name });

    const socket = tcpSocket.createConnection({ port, host }, () => {
      this.connecting = false;
      onStateChange({ status: 'connected', peerName: name });
    });
    socket.on('error', () => {
      this.connecting = false;
      onStateChange({ status: 'disconnected', peerName: null });
    });
    socket.on('close', () => {
      this.connecting = false;
      this.socket = null;
      onStateChange({ status: 'disconnected', peerName: null });
    });
    this.socket = socket;
  }

  /** No-op when nothing is connected yet — callers don't need to gate on connection state. */
  sendText(text: string): void {
    const trimmed = text.trim();
    if (!trimmed || !this.socket) return;
    // Newline-delimited, matching the receiver's parser.
    this.socket.write(`${trimmed}\n`);
  }

  stop(): void {
    this.zeroconfInstance?.stop();
    this.zeroconfInstance = null;
    this.socket?.destroy();
    this.socket = null;
    this.connecting = false;
  }
}
