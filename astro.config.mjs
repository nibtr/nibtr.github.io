import { defineConfig, passthroughImageService } from "astro/config";

export default defineConfig({
  site: "https://nibtr.github.io",
  image: { service: passthroughImageService() },
  markdown: {
    shikiConfig: {
      themes: { light: "github-light", dark: "github-dark" },
    },
  },
});
