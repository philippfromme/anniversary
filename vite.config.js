import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  server: {
    fs: {
      allow: ["."],
    },
  },
  publicDir: "out",
});
