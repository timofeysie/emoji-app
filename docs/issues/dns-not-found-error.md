
After updating the callback urls in Cognito, I want to test things.  When I go to `https://emoji-staging.kogs.link/ ` I see this response: ```{"message":"Cannot GET /","error":"Not Found","statusCode":404}```

Reordering middleware: NestJS registers routes during init() before we attached express.static, so unmatched routes like GET / hit Nest's 404 (Cannot GET /) and never reached the SPA. Serving static assets and the SPA fallback before initializing Nest fixes it.
