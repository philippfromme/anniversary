import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  base: "/anniversary/",
  server: {
    fs: {
      allow: ["."],
    },
  },
  publicDir: "out",
});
