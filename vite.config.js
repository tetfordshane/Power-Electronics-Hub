import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  /* 5273, not Vite's default 5173: that one collides with whatever else is
     running, and the check scripts drive a real browser at a fixed address.
     PS_PORT overrides both here and in scripts/lib/env.mjs, which is what the
     scripts read — they must agree, so they read the same variable. */
  server: { port: Number(process.env.PS_PORT) || 5273 },
});
