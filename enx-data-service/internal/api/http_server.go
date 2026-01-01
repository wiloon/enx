package api

import (
	"context"
	"encoding/json"
	"log"
	"net/http"

	"enx-data-service/internal/config"
	"enx-data-service/internal/sync"
)

type HTTPServer struct {
	coordinator *sync.Coordinator
	config      *config.Config
}

func NewHTTPServer(coordinator *sync.Coordinator, cfg *config.Config) *HTTPServer {
	return &HTTPServer{
		coordinator: coordinator,
		config:      cfg,
	}
}

func (h *HTTPServer) Start(addr string) error {
	mux := http.NewServeMux()

	mux.HandleFunc("POST /api/sync/trigger", h.handleTriggerSync)
	mux.HandleFunc("POST /api/sync/trigger-all", h.handleTriggerSyncAll)
	mux.HandleFunc("GET /api/sync/status", h.handleSyncStatus)
	mux.HandleFunc("GET /health", h.handleHealth)

	log.Printf("HTTP API listening on %s", addr)
	return http.ListenAndServe(addr, h.corsMiddleware(mux))
}

func (h *HTTPServer) handleTriggerSync(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Peer string `json:"peer"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if req.Peer == "" {
		h.jsonError(w, "peer address required", http.StatusBadRequest)
		return
	}

	go func() {
		if err := h.coordinator.SyncWithPeer(context.Background(), req.Peer); err != nil {
			log.Printf("Sync failed with %s: %v", req.Peer, err)
		}
	}()

	h.jsonResponse(w, map[string]interface{}{
		"status":  "triggered",
		"peer":    req.Peer,
		"message": "Sync triggered successfully",
	})
}

func (h *HTTPServer) handleTriggerSyncAll(w http.ResponseWriter, r *http.Request) {
	if len(h.config.Peers) == 0 {
		h.jsonError(w, "no peers configured", http.StatusBadRequest)
		return
	}

	triggered := make([]string, 0, len(h.config.Peers))

	for _, peer := range h.config.Peers {
		peerAddr := peer.Addr
		triggered = append(triggered, peerAddr)

		go func(addr string) {
			if err := h.coordinator.SyncWithPeer(context.Background(), addr); err != nil {
				log.Printf("Sync failed with %s: %v", addr, err)
			}
		}(peerAddr)
	}

	h.jsonResponse(w, map[string]interface{}{
		"status":  "triggered",
		"peers":   triggered,
		"count":   len(triggered),
		"message": "Sync triggered for all peers",
	})
}

func (h *HTTPServer) handleSyncStatus(w http.ResponseWriter, r *http.Request) {
	status := h.coordinator.GetSyncStatus()
	h.jsonResponse(w, status)
}

func (h *HTTPServer) handleHealth(w http.ResponseWriter, r *http.Request) {
	h.jsonResponse(w, map[string]string{
		"status": "healthy",
	})
}

func (h *HTTPServer) jsonResponse(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(data); err != nil {
		log.Printf("Failed to encode JSON response: %v", err)
	}
}

func (h *HTTPServer) jsonError(w http.ResponseWriter, message string, statusCode int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(map[string]string{
		"error": message,
	})
}

func (h *HTTPServer) corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}
