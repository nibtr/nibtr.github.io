# nibtr.github.io

My personal website, built with [Astro](https://astro.build). No client-side JavaScript, one CSS file.

## Usage

```sh
npm ci
npm run dev        # local dev server
npm run build      # static output in dist/
./new_post.sh "Post title"   # new draft in src/content/posts
```

Pushing to `main` deploys to GitHub Pages (`.github/workflows/astro.yml`).
Dependabot opens a grouped update PR monthly; the PR build catches breakage.

## License

Copyright (c) 2024 Hieu Nguyen Ho Trung

1. For the source code in this repository, it is licensed under the _MIT License_. View [LICENSE](/LICENSE) for more details.
2. For the posts, they are licensed under the _Creative Commons Attribution 4.0 International Public License_. View [COPYRIGHT](/COPYRIGHT) for more details.
