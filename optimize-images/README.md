# area44/optimize-images

Add the following workflow to your repository:

```yaml
name: Optimize Images

on:
  push:
    branches: ['main']
  pull_request:

jobs:
  image-optimization:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Optimize images
        id: optimize
        uses: area44/workflows/optimize-images@main

      - name: Commit optimized files
        if: steps.optimize.outputs.optimizedCount != '0'
        run: |
          git config --global user.name "github-actions[bot]"
          git config --global user.email "github-actions[bot]@users.noreply.github.com"
          git add -u
          git commit -m "chore: optimize images"
          git push

      - name: Post optimization report
        if: github.event_name == 'pull_request'
        uses: peter-evans/create-or-update-comment@v4
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          issue-number: ${{ github.event.pull_request.number }}
          identifier: image-optimization-report
          edit-mode: replace
          body: |
            **Image Optimization Report**

            - Optimized: **${{ steps.optimize.outputs.optimizedCount }}**
            - Skipped: **${{ steps.optimize.outputs.skippedCount }}**
            - Total Saved: **${{ steps.optimize.outputs.totalSaved }} KB**

            ### File Breakdown
            ```
            ${{ steps.optimize.outputs.details }}
            ```
```

> Replace `main` with a specific version tag (e.g., `v2.0.0`) to ensure consistent behavior over time.
