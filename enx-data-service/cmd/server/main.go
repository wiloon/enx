package main

import (
	"enx-data-service/internal/db"
	"enx-data-service/internal/service"
	pb "enx-data-service/proto"
	"log"
	"net"

	"google.golang.org/grpc"
)

const (
	port   = ":50051"
	dbPath = "enx.db"
)

func main() {
	// Initialize Database
	database, err := db.NewDatabase(dbPath)
	if err != nil {
		log.Fatalf("failed to open database: %v", err)
	}
	defer database.Close()

	// Initialize Schema
	if err := database.InitSchema("internal/db/schema.sql"); err != nil {
		log.Fatalf("failed to init schema: %v", err)
	}

	// Start gRPC Server
	lis, err := net.Listen("tcp", port)
	if err != nil {
		log.Fatalf("failed to listen: %v", err)
	}

	s := grpc.NewServer()
	dataService := service.NewDataService(database)
	pb.RegisterDataServiceServer(s, dataService)

	log.Printf("server listening at %v", lis.Addr())
	if err := s.Serve(lis); err != nil {
		log.Fatalf("failed to serve: %v", err)
	}
}
