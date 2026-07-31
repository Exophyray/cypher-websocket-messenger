import { useEffect, useRef, useCallback, useState } from 'react';

export function useWebSocket(token, onMessage) {
  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const pingTimerRef = useRef(null);
  const onMessageRef = useRef(onMessage);
  const shouldReconnectRef = useRef(true);
  const [status, setStatus] = useState('disconnected');

  useEffect(() => { onMessageRef.current = onMessage; }, [onMessage]);

  useEffect(() => {
    if (!token) return;
    shouldReconnectRef.current = true;
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) return;

      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const host = process.env.REACT_APP_WS_HOST || window.location.host;
      const url = `${protocol}://${host}/ws?token=${encodeURIComponent(token)}`;

      setStatus('connecting');
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) { ws.close(); return; }
        setStatus('connected');
        pingTimerRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
        }, 25000);
      };

      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === 'pong') return;
          onMessageRef.current?.(data);
        } catch (err) { console.error('[WS] Parse error:', err); }
      };

      ws.onclose = (e) => {
        setStatus('disconnected');
        if (pingTimerRef.current) { clearInterval(pingTimerRef.current); pingTimerRef.current = null; }
        if (!cancelled && shouldReconnectRef.current && e.code !== 4001) {
          reconnectTimerRef.current = setTimeout(connect, 2500);
        }
      };

      ws.onerror = () => setStatus('disconnected');
    };

    connect();

    return () => {
      cancelled = true;
      shouldReconnectRef.current = false;
      if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
      if (pingTimerRef.current) { clearInterval(pingTimerRef.current); pingTimerRef.current = null; }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [token]);

  const send = useCallback((data) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
      return true;
    }
    return false;
  }, []);

  return { status, send };
}
