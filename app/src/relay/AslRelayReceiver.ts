import type { TcpServer } from 'react-native-tcp-socket';
import type Zeroconf from 'react-native-zeroconf';
import { loadTcpSocket, loadZeroconf, SERVICE_PORT, SERVICE_PROTOCOL, SERVICE_TYPE } from './nativeModules';

export type ReceiverStatus = 'idle' | 'listening' | 'unavailable';

const RECEIVER_SERVICE_NAME = 'ASL Receiver';

/**
 * The "other phone" side of the same-WiFi ASL relay (see `asl-relay-rn`): publishes itself on
 * the local network via mDNS and listens on a plain TCP socket, handing each newline-delimited
 * message up to the caller to speak (kept separate from `LocalSpeaker` here so this class stays
 * just the transport, the same way `CallRelay` doesn't own TTS either).
 */
export class AslRelayReceiver {
  private readonly tcpSocket = loadTcpSocket();
  private readonly zeroconf = loadZeroconf();
  private server: TcpServer | null = null;
  private zeroconfInstance: Zeroconf | null = null;

  isAvailable(): boolean {
    return this.tcpSocket !== null && this.zeroconf !== null;
  }

  start(onMessage: (text: string) => void, onStatusChange: (status: ReceiverStatus) => void): void {
    const tcpSocket = this.tcpSocket;
    const ZeroconfClass = this.zeroconf?.default;
    if (!tcpSocket || !ZeroconfClass || this.server) return;

    const server = tcpSocket.createServer((socket) => {
      let buffer = '';
      socket.on('data', (data) => {
        buffer += data.toString();
        // Messages are newline-delimited so multiple sends don't get glued together.
        let index;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const text = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (text) onMessage(text);
        }
      });
      socket.on('error', () => undefined);
    });

    server.listen({ port: SERVICE_PORT, host: '0.0.0.0' });
    this.server = server;

    const zeroconf = new ZeroconfClass();
    this.zeroconfInstance = zeroconf;
    zeroconf.publishService(SERVICE_TYPE, SERVICE_PROTOCOL, 'local.', RECEIVER_SERVICE_NAME, SERVICE_PORT);

    onStatusChange('listening');
  }

  stop(): void {
    this.zeroconfInstance?.unpublishService(RECEIVER_SERVICE_NAME);
    this.zeroconfInstance?.stop();
    this.zeroconfInstance = null;
    this.server?.close();
    this.server = null;
  }
}
