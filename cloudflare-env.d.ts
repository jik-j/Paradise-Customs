declare namespace Cloudflare {
  interface Env {
    ASSETS: Fetcher;
    DB: D1Database;
    EMPLOYEE_AUTH_SEED?: string;
    DISCORD_STORAGE_KEY?: string;
    DISCORD_BOT_ID: string;
    DISCORD_CHANNEL_ID: string;
    DISCORD_WEBHOOK_ID: string;
    DISCORD_SHOP?: string;
  }
}

declare module 'cloudflare:workers' {
  export const env: Cloudflare.Env;
}
