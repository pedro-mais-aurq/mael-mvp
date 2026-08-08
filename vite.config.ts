// @lovable.dev/vite-tanstack-config includes the TanStack Start, React,
// Tailwind, tsconfig-paths and Nitro/Vite integration used by this project.
//
// Vercel detects Lovable/TanStack Start projects using this package. Setting
// `cloudflare: false` disables the Cloudflare Workers adapter so the build can
// target Vercel Functions instead of generating a Worker bundle.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  cloudflare: false,
  tanstackStart: {
    // Keep the custom SSR error wrapper used by the application.
    server: { entry: "server" },
  },
});
