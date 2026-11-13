package websocket

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	gorillaws "github.com/gorilla/websocket"
)

func TestHubBroadcastToMultipleClientsAndDisconnect(t *testing.T) {
	hub := NewHub([]string{"*"})
	go hub.Run()
	defer hub.Shutdown()

	srv := httptest.NewServer(http.HandlerFunc(hub.ServeWS))
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")

	c1, _, err := gorillaws.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial client 1: %v", err)
	}
	defer c1.Close()

	c2, _, err := gorillaws.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial client 2: %v", err)
	}
	defer c2.Close()

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) && hub.ClientCount() < 2 {
		time.Sleep(10 * time.Millisecond)
	}
	if hub.ClientCount() != 2 {
		t.Fatalf("expected 2 connected clients, got %d", hub.ClientCount())
	}

	payload := []byte(`{"event_id":"evt_1","event_type":"entry"}`)
	hub.Broadcast(payload)

	for idx, conn := range []*gorillaws.Conn{c1, c2} {
		_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
		_, msg, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("client %d read failed: %v", idx+1, err)
		}
		if string(msg) != string(payload) {
			t.Fatalf("client %d got %q, want %q", idx+1, string(msg), string(payload))
		}
	}

	_ = c1.Close()
	deadline = time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) && hub.ClientCount() != 1 {
		time.Sleep(10 * time.Millisecond)
	}
	if hub.ClientCount() != 1 {
		t.Fatalf("expected 1 client after closing client 1, got %d", hub.ClientCount())
	}
}
