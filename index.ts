import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const GHOST_CONTENT_ENDPOINT = process.env.GHOST_CONTENT_ENDPOINT!;
const GHOST_API_KEY = process.env.GHOST_API_KEY!;
const CONTENTFUL_SPACE_ID = process.env.CONTENTFUL_SPACE_ID!;
const CONTENTFUL_ACCESS_TOKEN = process.env.CONTENTFUL_ACCESS_TOKEN!;

// ── Ghost helpers ──

function ghostSearchParams(params: Record<string, string | number>): string {
  const sp = new URLSearchParams({
    key: GHOST_API_KEY,
    filter: "visibility:public",
    ...Object.fromEntries(
      Object.entries(params).map(([k, v]) => [k, String(v)])
    ),
  });
  return sp.toString();
}

async function fetchAllGhostRecords(
  endpoint: string,
  dataKey: string,
  include = ""
): Promise<any[]> {
  const all: any[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const params: Record<string, string | number> = {
      limit: 100,
      page,
      formats: "html",
    };
    if (include) params.include = include;

    const qs = ghostSearchParams(params);

    const res = await fetch(`${endpoint}?${qs}`);
    const json = await res.json();

    if (json?.[dataKey]) {
      all.push(...json[dataKey]);
      hasMore = !!json.meta?.pagination?.next;
    } else {
      hasMore = false;
    }
    page++;
  }

  return all;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

function matchesQuery(text: string | undefined | null, query: string): boolean {
  if (!text) return false;
  return text.toLowerCase().includes(query.toLowerCase());
}

function extractSnippet(
  text: string | undefined | null,
  query: string,
  contextChars = 150
): string | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return null;

  const start = Math.max(0, idx - contextChars);
  const end = Math.min(text.length, idx + query.length + contextChars);
  let snippet = text.slice(start, end);
  if (start > 0) snippet = "..." + snippet;
  if (end < text.length) snippet = snippet + "...";
  return snippet;
}

// ── Contentful helpers ──

function extractTextFromRichText(node: any): string {
  if (!node) return "";
  if (node.nodeType === "text") return node.value || "";
  if (Array.isArray(node.content)) {
    return node.content.map(extractTextFromRichText).join(" ");
  }
  return "";
}

function extractPlainTextSnippet(
  text: string | undefined | null,
  query: string,
  contextChars = 150
): string | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return null;

  const start = Math.max(0, idx - contextChars);
  const end = Math.min(text.length, idx + query.length + contextChars);
  let snippet = text.slice(start, end);
  if (start > 0) snippet = "..." + snippet;
  if (end < text.length) snippet = snippet + "...";
  return snippet;
}

async function contentfulGraphQL(query: string): Promise<any> {
  const res = await fetch(
    `https://graphql.contentful.com/content/v1/spaces/${CONTENTFUL_SPACE_ID}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CONTENTFUL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({ query }),
    }
  );
  return res.json();
}

// ── MCP Server ──

const server = new McpServer({
  name: "Content Search",
  version: "1.0.0",
});

// Tool 1: Search blog posts
server.tool(
  "search_blog_posts",
  "Search Ghost CMS blog posts by matching query against title, excerpt, and body content. Returns all matching posts.",
  { query: z.string().describe("Search term to match against blog post content") },
  async ({ query }) => {
    const posts = await fetchAllGhostRecords(
      `${GHOST_CONTENT_ENDPOINT}/posts`,
      "posts",
      "tags"
    );

    const matches = posts
      .filter((p: any) => {
        const bodyText = p.html ? stripHtml(p.html) : "";
        return (
          matchesQuery(p.title, query) ||
          matchesQuery(p.excerpt, query) ||
          matchesQuery(bodyText, query)
        );
      })
      .map((p: any) => {
        const bodyText = p.html ? stripHtml(p.html) : "";
        return {
          title: p.title,
          slug: p.slug,
          url: `/blog/${p.slug}`,
          excerpt: p.excerpt?.slice(0, 200),
          published_at: p.published_at,
          tags: p.tags?.map((t: any) => t.name),
          matched_snippet: extractSnippet(bodyText, query),
        };
      });

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(matches, null, 2),
        },
      ],
    };
  }
);

// Tool 2: Search blog pages
server.tool(
  "search_blog_pages",
  "Search Ghost CMS pages by matching query against title and body content. Returns all matching pages.",
  { query: z.string().describe("Search term to match against page content") },
  async ({ query }) => {
    const pages = await fetchAllGhostRecords(
      `${GHOST_CONTENT_ENDPOINT}/pages`,
      "pages"
    );

    const matches = pages
      .filter((p: any) => {
        const bodyText = p.html ? stripHtml(p.html) : "";
        return matchesQuery(p.title, query) || matchesQuery(bodyText, query);
      })
      .map((p: any) => {
        const bodyText = p.html ? stripHtml(p.html) : "";
        return {
          title: p.title,
          slug: p.slug,
          url: `/blog/${p.slug}`,
          matched_snippet: extractSnippet(bodyText, query),
        };
      });

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(matches, null, 2),
        },
      ],
    };
  }
);

// Tool 3: Search learn pages
server.tool(
  "search_learn_pages",
  "Search Contentful learn pages by matching query against title, meta title, meta description, and body content. Returns all matching pages.",
  { query: z.string().describe("Search term to match against learn page content") },
  async ({ query }) => {
    const gqlQuery = `query {
      learnPageCollection(limit: 999) {
        items {
          title
          url
          section {
            title
            url
          }
          subSection
          metaTitle
          metaDescription
          content {
            json
          }
        }
      }
    }`;

    const result = await contentfulGraphQL(gqlQuery);
    const items = result?.data?.learnPageCollection?.items || [];

    const matches = items
      .filter((item: any) => {
        const bodyText = extractTextFromRichText(item.content?.json);
        return (
          matchesQuery(item.title, query) ||
          matchesQuery(item.metaTitle, query) ||
          matchesQuery(item.metaDescription, query) ||
          matchesQuery(bodyText, query)
        );
      })
      .map((item: any) => {
        const bodyText = extractTextFromRichText(item.content?.json);
        return {
          title: item.title,
          url: item.section
            ? `/learn/${item.section.url}/${item.url}`
            : `/learn/${item.url}`,
          section: item.section?.title,
          subSection: item.subSection,
          metaDescription: item.metaDescription,
          matched_snippet:
            extractPlainTextSnippet(item.title, query) ||
            extractPlainTextSnippet(item.metaTitle, query) ||
            extractPlainTextSnippet(item.metaDescription, query) ||
            extractPlainTextSnippet(bodyText, query),
        };
      });

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(matches, null, 2),
        },
      ],
    };
  }
);

// Tool 4: Search case studies
server.tool(
  "search_case_studies",
  "Search Contentful case studies (success stories) by matching query against company name, meta title, meta description, overview, quote, use case, impact, and body content. Returns all matching case studies.",
  { query: z.string().describe("Search term to match against case study content") },
  async ({ query }) => {
    const gqlQuery = `query {
      successStoriesCompanyCollection(limit: 300) {
        items {
          name
          slug
          externalLink
          overview
          category
          useCase
          impact
          quoteText
          metaTitle
          metaDescription
          content {
            json
          }
        }
      }
    }`;

    const result = await contentfulGraphQL(gqlQuery);
    const items =
      result?.data?.successStoriesCompanyCollection?.items || [];

    const matches = items
      .filter((item: any) => {
        const bodyText = extractTextFromRichText(item.content?.json);
        return (
          matchesQuery(item.name, query) ||
          matchesQuery(item.metaTitle, query) ||
          matchesQuery(item.metaDescription, query) ||
          matchesQuery(item.overview, query) ||
          matchesQuery(item.quoteText, query) ||
          matchesQuery(item.useCase, query) ||
          matchesQuery(item.impact, query) ||
          matchesQuery(bodyText, query)
        );
      })
      .map((item: any) => {
        const bodyText = extractTextFromRichText(item.content?.json);
        return {
          name: item.name,
          slug: item.slug,
          url: item.externalLink || `/case-studies/${item.slug}`,
          overview: item.overview,
          category: item.category,
          useCase: item.useCase,
          impact: item.impact,
          matched_snippet:
            extractPlainTextSnippet(item.name, query) ||
            extractPlainTextSnippet(item.metaTitle, query) ||
            extractPlainTextSnippet(item.metaDescription, query) ||
            extractPlainTextSnippet(item.overview, query) ||
            extractPlainTextSnippet(item.quoteText, query) ||
            extractPlainTextSnippet(item.useCase, query) ||
            extractPlainTextSnippet(item.impact, query) ||
            extractPlainTextSnippet(bodyText, query),
        };
      });

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(matches, null, 2),
        },
      ],
    };
  }
);

// Tool 5: Search events
server.tool(
  "search_events",
  "Search Contentful events (internal event pages and event cards) by matching query against title, description, and body content. Returns all matching events.",
  { query: z.string().describe("Search term to match against event content") },
  async ({ query }) => {
    const gqlQuery = `query {
      internalEventPageCollection(limit: 300) {
        items {
          heroTitle
          metaDescription
          url
          eventDate
          additionalEventDetails {
            json
          }
          agenda {
            json
          }
        }
      }
      eventsCardCollection(limit: 300) {
        items {
          title
          description
          link
          date
        }
      }
    }`;

    const result = await contentfulGraphQL(gqlQuery);

    const internalEvents =
      result?.data?.internalEventPageCollection?.items || [];
    const eventCards = result?.data?.eventsCardCollection?.items || [];

    const matchedInternal = internalEvents
      .filter((evt: any) => {
        const detailsText = extractTextFromRichText(evt.additionalEventDetails?.json);
        const agendaText = extractTextFromRichText(evt.agenda?.json);
        return (
          matchesQuery(evt.heroTitle, query) ||
          matchesQuery(evt.metaDescription, query) ||
          matchesQuery(detailsText, query) ||
          matchesQuery(agendaText, query)
        );
      })
      .map((evt: any) => {
        const detailsText = extractTextFromRichText(evt.additionalEventDetails?.json);
        const agendaText = extractTextFromRichText(evt.agenda?.json);
        return {
          type: "internal_event",
          title: evt.heroTitle,
          description: evt.metaDescription,
          url: `/events/${evt.url}`,
          date: evt.eventDate,
          matched_snippet:
            extractPlainTextSnippet(evt.heroTitle, query) ||
            extractPlainTextSnippet(evt.metaDescription, query) ||
            extractPlainTextSnippet(detailsText, query) ||
            extractPlainTextSnippet(agendaText, query),
        };
      });

    const matchedCards = eventCards
      .filter((evt: any) =>
        matchesQuery(evt.title, query) ||
        matchesQuery(evt.description, query)
      )
      .map((evt: any) => ({
        type: "event_card",
        title: evt.title,
        description: evt.description,
        url: evt.link,
        date: evt.date,
        matched_snippet:
          extractPlainTextSnippet(evt.title, query) ||
          extractPlainTextSnippet(evt.description, query),
      }));

    const matches = [...matchedInternal, ...matchedCards];

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(matches, null, 2),
        },
      ],
    };
  }
);

// ── Start server ──

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
