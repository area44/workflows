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
        with:
          ref: ${{ github.head_ref || github.ref_name }}

      - name: Optimize images
        id: optimize
        uses: area44/workflows/optimize-images@main

      - name: Commit optimized files
        if: ${{ steps.optimize.outputs.optimizedCount != '0' && (github.event_name == 'push' || github.event.pull_request.head.repo.full_name == github.repository) }}
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          git config --global user.name "github-actions[bot]"
          git config --global user.email "github-actions[bot]@users.noreply.github.com"
          git add -u
          git commit -m "chore: optimize images"
          git push https://x-access-token:${GH_TOKEN}@github.com/${{ github.repository }} HEAD:${{ github.head_ref || github.ref_name }}

      - name: Find comment
        uses: peter-evans/find-comment@v3
        id: fc
        with:
          issue-number: ${{ github.event.pull_request.number }}
          comment-author: 'github-actions[bot]'
          body-includes: Image Optimization Report

      - name: Create or update comment
        uses: peter-evans/create-or-update-comment@v4
        with:
          comment-id: ${{ steps.fc.outputs.comment-id }}
          issue-number: ${{ github.event.pull_request.number }}
          body: |
            **Image Optimization Report**

            - Optimized: **${{ steps.optimize.outputs.optimizedCount || '0' }}**
            - Skipped: **${{ steps.optimize.outputs.skippedCount || '0' }}**
            - Total Saved: **${{ steps.optimize.outputs.totalSaved || '0.0' }} KB**

            ### File Breakdown
            ```
            ${{ steps.optimize.outputs.details || 'No images found' }}
            ```
          edit-mode: replace
```

> Replace `main` with a specific version tag (e.g., `v2.0.0`) to ensure consistent behavior over time.
