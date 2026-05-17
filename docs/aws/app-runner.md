## App Runner

**This is legacy material from the old README before migrating to CloudFront.**


## Production deployment

The app is deployed as a single Docker container on **AWS App Runner**. The
Express server serves the React SPA as static files and handles the
`/api/chat` streaming endpoint on the same origin.

See [`docs/deployments.md`](docs/deployments.md) for the full step-by-step
guide including ECR setup, IAM roles, environment variables, and the
auto-deploy CI workflow.

See [`docs/auth.md`](docs/auth.md) for authentication options (AWS Cognito
recommended).

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | Yes | — | OpenAI secret key |
| `PORT` | No | `3000` | Port the Express server listens on |
| `HOST` | No | `localhost` | Host to bind (`0.0.0.0` in production) |
