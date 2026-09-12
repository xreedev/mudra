import { useEffect, useRef, useState } from 'react';
import { AslRelaySender, type SenderState } from './AslRelaySender';

export type SenderRelayStatus = SenderState & {
  available: boolean;
  sendText: (text: string) => void;
};

/**
 * Starts scanning for a receiver phone on the same WiFi (see `asl-relay-rn`) as soon as a
 * screen mounts, auto-connecting to the first one found. `sendText` is always safe to call —
 * it's a no-op until a receiver is actually connected — so callers don't need to branch on
 * connection state just to speak a confirmed sentence.
 */
export function useAslRelaySender(): SenderRelayStatus {
  const sender = useRef<AslRelaySender | null>(null);
  const [state, setState] = useState<SenderState>({ status: 'scanning', peerName: null });
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const instance = new AslRelaySender();
    sender.current = instance;
    setAvailable(instance.isAvailable());
    instance.start(setState);

    return () => {
      instance.stop();
      sender.current = null;
    };
  }, []);

  return {
    ...state,
    available,
    sendText: (text: string) => sender.current?.sendText(text),
  };
}
