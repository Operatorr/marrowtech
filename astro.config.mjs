// @ts-check

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
	site: 'https://marrowtech.app',
	// A build against test evidence keeps its own cache and output, so it can never reach a real build.
	...(process.env.EVIDENCE_FIXTURES && { cacheDir: './node_modules/.astro-fixtures', outDir: './dist-fixtures' }),
	integrations: [mdx(), sitemap()],
});
