FROM golang:1.16.4 AS build
ENV GO111MODULE on
WORKDIR /workdir
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOPROXY=https://goproxy.io go build -a enx-server.go

FROM alpine AS prod
COPY --from=build /workdir/enx-server /data/enx-server/
COPY config.toml config.toml
COPY config.toml /data/enx-server/config.toml
CMD ["/data/enx-server/enx-server"]
