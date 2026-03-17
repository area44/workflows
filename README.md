# area44/workflows

This repository contains reusable **GitHub Actions workflows and composite actions** for the AREA44 ecosystem. It helps standardize and streamline CI/CD processes across projects.

## Composite Actions

- **[Astro](./astro/README.md)**: Build and deploy Astro sites.
- **[Vite](./vite/README.md)**: Build and deploy Vite sites.
- **[Autofix.ci](./autofix/README.md)**: Run autofix scripts and integrate with autofix.ci.

## Security Best Practices

All actions in this repository:
- Use pinned commit SHAs for third-party actions.
- Use environment variables to prevent shell injection.
- Automatically detect Node.js and package managers.

## License

This project is licensed under the [MIT License](LICENSE).
