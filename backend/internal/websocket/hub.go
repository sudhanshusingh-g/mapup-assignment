package websocket

import (
	"log"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 4096
	sendBufferSize = 256
)

// Hub maintains active WebSocket clients and broadcasts real-time alerts concurrently.
type Hub struct {
	clients        map[*Client]struct{}
	register       chan *Client
	unregister     chan *Client
	broadcast      chan []byte
	done           chan struct{}
	closeOnce      sync.Once
	clientCount    atomic.Int64
	allowedOrigins []string
	upgrader       websocket.Upgrader
}

// NewHub initializes a WebSocket hub with configurable origin checking.
func NewHub(allowedOrigins []string) *Hub {
	h := &Hub{
		clients:        make(map[*Client]struct{}),
		register:       make(chan *Client, 64),
		unregister:     make(chan *Client, 64),
		broadcast:      make(chan []byte, 512),
		done:           make(chan struct{}),
		allowedOrigins: allowedOrigins,
	}
	h.upgrader = websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin:     h.checkOrigin,
	}
	return h
}

func (h *Hub) checkOrigin(r *http.Request) bool {
	if len(h.allowedOrigins) == 0 {
		return true
	}
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	for _, allowed := range h.allowedOrigins {
		if allowed == "*" || strings.EqualFold(allowed, origin) {
			return true
		}
	}
	return false
}

// Run processes client registrations, unregistrations, and broadcasts on a single goroutine,
// ensuring race-free access to the clients map.
func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.clients[client] = struct{}{}
			h.clientCount.Add(1)

		case client := <-h.unregister:
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
				h.clientCount.Add(-1)
			}

		case message := <-h.broadcast:
			for client := range h.clients {
				select {
				case client.send <- message:
				default:
					// Slow or unresponsive client: evict without blocking other subscribers.
					delete(h.clients, client)
					close(client.send)
					h.clientCount.Add(-1)
				}
			}

		case <-h.done:
			for client := range h.clients {
				delete(h.clients, client)
				close(client.send)
			}
			h.clientCount.Store(0)
			return
		}
	}
}

// Broadcast queues a payload for delivery to all connected clients.
func (h *Hub) Broadcast(payload []byte) {
	select {
	case h.broadcast <- payload:
	case <-h.done:
	}
}

// ClientCount returns the number of currently connected WebSocket clients.
func (h *Hub) ClientCount() int {
	return int(h.clientCount.Load())
}

// Shutdown terminates the Hub loop and closes all connected clients.
func (h *Hub) Shutdown() {
	h.closeOnce.Do(func() {
		close(h.done)
	})
}

// ServeWS upgrades an HTTP connection to WebSocket and starts its read/write pumps.
func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("websocket upgrade failed: %v", err)
		return
	}

	client := &Client{
		hub:  h,
		conn: conn,
		send: make(chan []byte, sendBufferSize),
	}

	select {
	case h.register <- client:
	case <-h.done:
		_ = conn.Close()
		return
	}

	go client.writePump()
	go client.readPump()
}

// Client represents a single connected WebSocket subscriber.
type Client struct {
	hub  *Hub
	conn *websocket.Conn
	send chan []byte
}

func (c *Client) readPump() {
	defer func() {
		select {
		case c.hub.unregister <- c:
		case <-c.hub.done:
		}
		_ = c.conn.Close()
	}()

	c.conn.SetReadLimit(maxMessageSize)
	_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		return c.conn.SetReadDeadline(time.Now().Add(pongWait))
	})

	for {
		if _, _, err := c.conn.ReadMessage(); err != nil {
			break
		}
	}
}

func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		_ = c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			// Send each alert as its own WebSocket text frame so JSON.parse on clients stays 1:1.
			if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}

		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
