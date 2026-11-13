# Stage 1: Build Go binary
FROM golang:1.25-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /app/server ./cmd/api

# Stage 2: Minimal non-root runtime image
FROM alpine:3.21

RUN apk --no-cache add ca-certificates tzdata && \
    adduser -D -g '' appuser

WORKDIR /app
COPY --from=builder /app/server /app/server

USER appuser
EXPOSE 8080

ENTRYPOINT ["/app/server"]
