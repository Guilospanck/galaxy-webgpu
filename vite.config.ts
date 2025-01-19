import { defineConfig } from "vite";

export default defineConfig({
  base: "/galaxy-webgpu/",
  esbuild: {
    target: "esnext",
  },
  build: {
    target: "esnext",
  },
});
