import { useEffect, useRef, useState } from 'react';
import { AslRelayReceiver, type ReceiverStatus } from './AslRelayReceiver';

export type ReceiverRelayStatus = {
  available: boolean;
  status: ReceiverStatus;
  /** Most recent message first. */
  messages: string[];
  /** Talks back to the connected signer's phone — a no-op until one is actually connected, so
   *  callers (a "talk back" mic on the Receive screen) don't need to branch on connection state. */
  sendText: (text: string) => void;
};

/**
 * Publishes this phone as a receiver on the local network (see `asl-relay-rn`) and collects
 * incoming messages for the screen to display and speak. Speaking is deliberately left to the
 * caller (via `LocalSpeaker`, same as every other screen) rather than owned by the relay itself.
 */
export function useAslRelayReceiver(onMessage: (text: string) => void): ReceiverRelayStatus {
  const receiver = useRef<AslRelayReceiver | null>(null);
  const [status, setStatus] = useState<ReceiverStatus>('idle');
  const [available, setAvailable] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    const instance = new AslRelayReceiver();
    receiver.current = instance;
    setAvailable(instance.isAvailable());
    instance.start(
      (text) => {
        setMessages((prev) => [text, ...prev].slice(0, 20));
        onMessageRef.current(text);
      },
      setStatus,
    );

    return () => {
      instance.stop();
      receiver.current = null;
    };
  }, []);

  return { available, status, messages, sendText: (text: string) => receiver.current?.sendText(text) };
}
