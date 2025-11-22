.PHONY: all proto build run clean

all: proto build

proto:
	protoc --go_out=. --go_opt=paths=source_relative \
    --go-grpc_out=. --go-grpc_opt=paths=source_relative \
    proto/data_service.proto

build:
	go build -o bin/server cmd/server/main.go

run:
	go run cmd/server/main.go

clean:
	rm -rf bin/
