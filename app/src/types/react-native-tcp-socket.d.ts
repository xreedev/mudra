/**
 * Declares only the subset of `react-native-tcp-socket` that the ASL relay consumes, mirroring
 * `react-native-tts.d.ts` — lets the module be `require`d lazily and type-checked before it is
 * actually installed/linked.
 *
 * No `export default` here on purpose: the installed package's `src/index.js` does
 * `export default {...}` and then *also* `module.exports = {...}` with the same literal object
 * — Metro transpiles node_modules too, and that second assignment overwrites the whole exports
 * object, wiping out the `.default` wrapper Babel's ESM interop would otherwise add. The real
 * shape at runtime is the plain object with these as top-level named exports.
 */
declare module 'react-native-tcp-socket' {
  export interface TcpSocket {
    on(event: 'data', handler: (data: string | Buffer) => void): void;
    on(event: 'error', handler: (error: unknown) => void): void;
    on(event: 'close', handler: () => void): void;
    write(data: string): void;
    destroy(): void;
  }

  export interface TcpServer {
    listen(options: { port: number; host: string }): void;
    close(): void;
  }

  export function createServer(onConnection: (socket: TcpSocket) => void): TcpServer;
  export function createConnection(
    options: { port: number; host: string },
    onConnected: () => void,
  ): TcpSocket;
}
