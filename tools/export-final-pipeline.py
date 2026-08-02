from pathlib import Path
import subprocess

pipeline = subprocess.check_output(
    ['git', 'show', 'origin/main:.github/workflows/pipeline.yml'],
    text=True
)
pipeline = pipeline.replace(
    'permissions:\n  contents: write',
    'permissions:\n  contents: write\n  actions: write'
)
if 'name: Repository cleanup' not in pipeline:
    pipeline += r'''

  cleanup:
    name: Repository cleanup
    if: ${{ always() && github.event_name == 'push' && github.ref == 'refs/heads/main' }}
    needs: [prepare, tests, windows, desktop-release, android-release, publish]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: Remove merged work branches
        env:
          GH_TOKEN: ${{ github.token }}
        shell: bash
        run: |
          set -euo pipefail
          git fetch origin '+refs/heads/*:refs/remotes/origin/*' --prune
          gh api --paginate "repos/$GITHUB_REPOSITORY/branches?per_page=100" --jq '.[].name' | while read -r branch; do
            [[ "$branch" == 'main' ]] && continue
            if git show-ref --verify --quiet "refs/remotes/origin/$branch" && git merge-base --is-ancestor "origin/$branch" origin/main; then
              echo "Deleting merged branch $branch"
              gh api -X DELETE "repos/$GITHUB_REPOSITORY/git/refs/heads/$branch" || true
            fi
          done
      - name: Remove legacy workflow run history
        env:
          GH_TOKEN: ${{ github.token }}
        shell: bash
        run: |
          set -euo pipefail
          legacy='^(Clean stale branches|Core Checks|Desktop Matrix|Publish release|Windows Portable)$'
          gh api --paginate "repos/$GITHUB_REPOSITORY/actions/runs?per_page=100" --jq ".workflow_runs[] | select(.name | test(\"$legacy\")) | .id" | while read -r run_id; do
            [[ -n "$run_id" ]] || continue
            echo "Deleting legacy workflow run $run_id"
            gh api -X DELETE "repos/$GITHUB_REPOSITORY/actions/runs/$run_id" || true
          done
'''
Path('pipeline.final.yml').write_text(pipeline, encoding='utf-8')
