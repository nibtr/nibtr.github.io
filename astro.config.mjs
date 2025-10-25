// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import pagefind from "astro-pagefind";

// https://astro.build/config
export default defineConfig({
  site: "https://nibtr.github.io",
  integrations: [sitemap(), pagefind()],
  vite: {
    plugins: [tailwindcss()]
  }
});
