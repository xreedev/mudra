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

  /**
   * `onMessage` is optional — TCP is full-duplex, so the same socket used to send also carries
   * whatever the receiver phone sends back (e.g. a spoken reply transcribed to text), but a
   * caller with nothing to do with that (Talk Aloud has no call partner to reply) can just omit
   * it rather than wiring up a no-op.
   */
  start(onStateChange: (state: SenderState) => void, onMessage?: (text: string) => void): void {
    const ZeroconfCtor = this.zeroconf?.default;
    if (!ZeroconfCtor || this.zeroconfInstance) return;

    const zeroconf = new ZeroconfCtor();
    this.zeroconfInstance = zeroconf;

    zeroconf.on('resolved', (service) => {
      if (this.socket || this.connecting || !service.host || !service.port) return;
      this.connect(service.host, service.port, service.name, onStateChange, onMessage);
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
    onMessage?: (text: string) => void,
  ): void {
    const tcpSocket = this.tcpSocket;
    if (!tcpSocket) return;

    this.connecting = true;
    onStateChange({ status: 'connecting', peerName: name });

    const socket = tcpSocket.createConnection({ port, host }, () => {
      this.connecting = false;
      onStateChange({ status: 'connected', peerName: name });
    });
    if (onMessage) {
      // Newline-delimited, matching sendText's own framing and the receiver's parser for the
      // outgoing direction — one buffer per connection so a message split across TCP packets
      // still reassembles correctly.
      let buffer = '';
      socket.on('data', (data) => {
        buffer += data.toString();
        let index;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const text = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (text) onMessage(text);
        }
      });
    }
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
