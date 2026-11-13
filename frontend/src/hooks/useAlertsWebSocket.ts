import { useEffect, useRef, useState } from 'react';
import { resolveWebSocketURL } from '../services/api';
import type { WebSocketAlert } from '../types/api';

export type WsStatus = 'connecting' | 'connected' | 'disconnected';

export function useAlertsWebSocket(onAlert: (alert: WebSocketAlert) => void): {
  status: WsStatus;
  reconnectCount: number;
} {
  const [status, setStatus] = useState<WsStatus>('connecting');
  const [reconnectCount, setReconnectCount] = useState(0);
  const onAlertRef = useRef(onAlert);

  useEffect(() => {
    onAlertRef.current = onAlert;
  }, [onAlert]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let disposed = false;
    let attempt = 0;

    const connect = () => {
      if (disposed) return;
      setStatus('connecting');

      try {
        ws = new WebSocket(resolveWebSocketURL());
      } catch {
        scheduleReconnect();
        return;
      }

      ws.onopen = () => {
        if (disposed) return;
        attempt = 0;
        setStatus('connected');
      };

      ws.onmessage = (event) => {
        if (disposed) return;
        try {
          const parsed = JSON.parse(event.data) as WebSocketAlert;
          if (parsed && parsed.event_id) {
            onAlertRef.current(parsed);
          }
        } catch {
          // Ignore non-JSON heartbeat or malformed frames
        }
      };

      ws.onerror = () => {
        ws?.close();
      };

      ws.onclose = () => {
        if (disposed) return;
        setStatus('disconnected');
        scheduleReconnect();
      };
    };

    const scheduleReconnect = () => {
      if (disposed) return;
      const delayMs = Math.min(15000, 1000 * Math.pow(2, attempt));
      attempt += 1;
      setReconnectCount((prev) => prev + 1);
      reconnectTimer = window.setTimeout(connect, delayMs);
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close();
      }
    };
  }, []);

  return { status, reconnectCount };
}
