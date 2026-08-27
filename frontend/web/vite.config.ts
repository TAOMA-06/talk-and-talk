import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json" with { type: "json" };
import { sites } from "./build/sites-vite-plugin.js";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  // vinext's custom Worker image route reads original local assets through
  // this binding. The Cloudflare Vite plugin rewrites the directory for the
  // emitted server config, so this source path is only a build-time marker.
  assets: {
    directory: "./dist/client",
    binding: "ASSETS",
    not_found_handling: "none" as const,
    // Security headers are attached in worker/index.ts. Cloudflare otherwise
    // serves matching Next/Vinext image assets before the Worker and bypasses
    // that response boundary.
    run_worker_first: true,
  },
  // Cloudflare provides this binding in deployed Workers. Local Miniflare
  // installations may omit its transformer implementation; the Worker then
  // serves the validated original asset rather than failing the public page.
  images: { binding: "IMAGES" },
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "talk-and-talk-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "talk-and-talk-r2",
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
