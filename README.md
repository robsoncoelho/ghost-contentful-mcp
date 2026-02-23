# Ghost + Contentful MCP

An MCP (Model Context Protocol) server that lets AI assistants search across multiple CMS platforms — **Ghost** and **Contentful** — from a single interface.

## What it does

This server exposes five search tools over the MCP stdio transport:

| Tool | Source | Searches across |
|---|---|---|
| `search_blog_posts` | Ghost | Post title, excerpt, and body |
| `search_blog_pages` | Ghost | Page title and body |
| `search_learn_pages` | Contentful | Learn page title, meta fields, and rich-text body |
| `search_case_studies` | Contentful | Company name, overview, quote, use case, impact, and body |
| `search_events` | Contentful | Internal event pages and event cards (title, description, agenda) |

Each tool accepts a `query` string and returns matching results with contextual snippets highlighting where the match was found.

## Setup

1. Install dependencies:

```bash
yarn install
```

2. Create a `.env` file with your API credentials:

```
GHOST_CONTENT_ENDPOINT=https://your-ghost-instance.com/ghost/api/content
GHOST_API_KEY=your-ghost-content-api-key
CONTENTFUL_SPACE_ID=your-contentful-space-id
CONTENTFUL_ACCESS_TOKEN=your-contentful-access-token
```

3. Run the server:

```bash
yarn start
```

## MCP client configuration

Add the server to your MCP client config (e.g. Claude Desktop):

```json
{
  "mcpServers": {
    "cms-search": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/mcp-cms-search/index.ts"]
    }
  }
}
```
