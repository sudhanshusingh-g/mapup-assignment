# Setup Instructions

## Prerequisites

- Go
- Node.js and npm
- Docker Desktop
- Git

## Start the database

From the project root:

    docker compose up -d db

## Start the backend

From the backend folder:

    $env:DATABASE_URL = "postgres://mapup_user:mapup_dev_password@localhost:5432/mapup_geofencing?sslmode=disable"
    go run ./cmd/api

## Start the frontend

From the frontend folder:

    npm install
    npm run dev

## Local URLs

- Frontend: http://localhost:5173
- Backend: http://localhost:8080
- Backend health: http://localhost:8080/health
- Database health: http://localhost:8080/health/db
