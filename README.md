# Shanmukha-Stores

Full-stack e-commerce solution for an organic goods business powered by Node.js, Express, and PostgreSQL (Supabase).

## Deployment Architecture

- **Database**: Supabase PostgreSQL (IPv4 Pooler enabled with SSL)
- **Backend Service**: Hosted on [Render.com](https://render.com) (`ShanmukhaStoresBackend` / `shanmukha-stores`)
- **Frontend / Store App**: Hosted on [Vercel](https://vercel.com) (`shanmukha-stores`)

## Structure

```text
├── .env                              # Root environment config (committed for private repo)
├── api/
│   └── index.js                      # Vercel Serverless Function entrypoint
├── vercel.json                       # Vercel routing & serverless bundling config
├── render.yaml                       # Render.com Web Services Blueprint
├── package.json                      # Root package dependencies
├── package-lock.json                 # Lockfile for consistent serverless builds
├── shanmukha-stores/                 # Full store application (EJS views, routes, assets)
│   ├── api/index.js                  # Subfolder Vercel entrypoint
│   ├── config/db.js                  # Supabase database pool connection
│   ├── public/                       # CSS, client JS, images, uploads
│   ├── routes/                       # Express route controllers
│   ├── views/                        # EJS dynamic page templates
│   ├── server.js                     # Express app setup
│   └── vercel.json                   # Subfolder Vercel config
└── ShanmukhaStoresBackend/           # Companion Express API service
    └── src/                          # API controllers and routes
```
