# 🏗️ Hosting WintrChess locally

> This is a guide on how to get WintrChess running on your local machine.

## Prerequisites

- Git
- Node.js 22 or later
- MongoDB
- Docker, if you want to host with that

## Setup

### Clone the repository

```sh
git clone https://github.com/wintrcat/wintrchess.git

# Go to the directory
cd wintrchess
```

### Set environment variables

These are the environment variables that you can set when hosting WintrChess:

```toml
NODE_ENV="production"
```

The environment that the app is running in. Can be one of two values: `production` (default) and `development`. In production, only requests with the `Host` header set to `wintrchess.com` are accepted. You can edit the hostname whitelist in `server/src/lib/security/whitelist.ts`.

```toml
PORT=8080
```

The port that the backend server listens on. Defaults to `8080`.

```toml
ORIGIN="http://localhost:8080"
```
> Required

The origin - used to construct email URLs and to allow the configured hostname in production.
For example, `http://localhost:8080` or `https://wintrchess.com`.

```toml
DATABASE_URI="mongodb://" # ...
```

A connection string for a MongoDB database. Collections, indexes etc. will be created when the app runs. Defaults to `mongodb://database/wintrchess`.

```toml
ANALYTICS_MEASUREMENT_ID="G-EX024ZXSNX"
```

A Google Analytics Measurement ID, if you would like to enable analytics.

```toml
EMAIL_ACCOUNT="contact@wintrchess.com"
```

The contact address shown on the website.

## Deploy manually

### Install dependencies

```sh
npm install
```

### Build the app

```sh
npm run build
```

You can also compile individual workspaces if you want with the `-w` flag:

```sh
npm run build -w client
npm run build -w server
npm run build -w shared
```

### Start the server

```sh
npm start
```

The server will begin listening on the port that you defined in the environment variables, or `8080` if you have not defined one.
Make sure you have your database running.

## Deploy with Docker

You might find it easier to run WintrChess in a Docker container. The database will be created for you so you will not have to
specify a database URI.

### Build and start

```sh
docker compose up
```
