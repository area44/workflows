# @area44/workflows

This repository provides a collection of reusable **GitHub Actions workflows and composite actions** designed to standardize CI/CD processes across the AREA44 ecosystem.

## Available Actions

- **[Astro](./astro/README.md)**: Build and deploy Astro sites to GitHub Pages.
- **[Vite](./vite/README.md)**: Build and deploy Vite projects to GitHub Pages.
- **[Autofix.ci](./autofix/README.md)**: Automatically run linting and formatting scripts and integrate with autofix.ci.

## Key Features

- **Auto-detection**: Automatically detects Node.js versions and package managers (npm, pnpm, yarn, bun).
- **Standardized CI/CD**: Ensures consistent build and deployment steps across different projects.
- **Optimized Performance**: Uses minified bundles for faster action execution.

## Getting Started for Developers

### Prerequisites

- Node.js 24 or later
- npm

### Installation

```bash
npm install
```

### Building

To bundle and minify the source code into the `dist/` directory:

```bash
npm run build
```

### Testing

Run unit tests using Vitest:

```bash
npm run test
```

## License

This project is licensed under the [MIT License](LICENSE).
