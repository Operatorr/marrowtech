# 骨 marrowtech

The personal showcase hub for **Alexander Widing** — full-stack & game developer, Stockholm.
A single-screen hub that cards up everything he builds (DoMarrow, MarrowTalk, Ashen Omega,
widing.dev) plus a journal/blog. Built with [Astro](https://astro.build).

The look is *Scandinavian-minimal meets terminal*: a dark warm-charcoal canvas, Swiss
neo-grotesque type, electric blue + violet accents, quiet Japanese kana accents, streaming
terminal text, and interactive dither / ASCII shader backgrounds.

## Structure

```text
src/
├── components/marrow/   # design-system components (Nav, Hero, ProjectCard, Terminal, …)
├── layouts/             # Base (shell + nav + footer) and BlogPost
├── pages/               # / (hub), /blog, /blog/[slug]
├── content/blog/        # Markdown/MDX posts
├── scripts/             # client behaviors: shaders, terminal streaming, hub interactions
└── styles/              # design tokens + base + component + hub CSS (entry: app.css)
```

- **`/`** — the hub: hero (streaming headline over a WebGL dither field), the four-project
  showcase grid, a journal teaser (latest posts), an about/résumé section, and a contact footer.
- **`/blog`** — the full journal index, restyled to the design system.
- **`/blog/[slug]`** — long-form posts (`src/layouts/BlogPost.astro`, `.mt-prose` styling).

The design system that this implements lives in `design_system/` — it is reference-only and
safe to delete; nothing under `src/` imports from it.

## Commands

| Command        | Action                                       |
| :------------- | :------------------------------------------- |
| `pnpm install` | Install dependencies                         |
| `pnpm dev`     | Start the dev server at `localhost:4321`     |
| `pnpm build`   | Build the production site to `./dist/`        |
| `pnpm preview` | Preview the production build locally          |
