#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATE_ARG="${1:-}"

if [ -n "$DATE_ARG" ]; then
  if ! [[ "$DATE_ARG" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    echo "Error: Invalid date format. Use YYYY-MM-DD" >&2
    exit 1
  fi
  COMMIT_DATE="$DATE_ARG"
else
  # Default to yesterday since arXiv papers are announced at 20:00 ET (00:00-01:00 UTC next day)
  if date -v-1d >/dev/null 2>&1; then
    # macOS
    COMMIT_DATE=$(date -v-1d +%Y-%m-%d)
  else
    # Linux
    COMMIT_DATE=$(date -d "yesterday" +%Y-%m-%d)
  fi
fi

TEMP_JSON=$(mktemp)
trap "rm -f \"$TEMP_JSON\"" EXIT

echo "Fetching arXiv AI papers for $COMMIT_DATE..."

if ! node "$SCRIPT_DIR/fetch.js" "$DATE_ARG" > "$TEMP_JSON" 2>&1; then
  echo "Error: fetch.js failed" >&2
  cat "$TEMP_JSON" >&2
  exit 1
fi

if [ ! -s "$TEMP_JSON" ]; then
  echo "Error: No output from fetch.js" >&2
  exit 1
fi

if grep -q "Error fetching arXiv papers" "$TEMP_JSON"; then
  echo "Error: fetch.js returned an error:" >&2
  cat "$TEMP_JSON" >&2
  exit 1
fi

PAPER_COUNT=$(TEMP_JSON="$TEMP_JSON" node -e "
const data = JSON.parse(require('fs').readFileSync(process.env.TEMP_JSON, 'utf-8'));
console.log(data.length);
")

if [ "$PAPER_COUNT" -eq 0 ]; then
  echo "No papers found for $COMMIT_DATE"
  exit 0
fi

echo "Found $PAPER_COUNT papers. Creating commits..."

TEMP_JSON="$TEMP_JSON" node -e "
const papers = JSON.parse(require('fs').readFileSync(process.env.TEMP_JSON, 'utf-8'));
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function formatAuthors(authors) {
  if (authors.length === 0) return '';
  if (authors.length <= 5) return authors.join(', ');
  return authors.slice(0, 5).join(', ') + ', et al.';
}

function formatCommitMessage(paper) {
  const parts = [];

  parts.push(paper.title);
  parts.push('');
  parts.push(\`arXiv: \${paper.arxivId}\`);
  parts.push(\`Authors: \${formatAuthors(paper.authors)}\`);
  parts.push(\`Published: \${paper.published.split('T')[0]}\`);
  parts.push('');
  parts.push(paper.summary);
  parts.push('');
  parts.push('Links:');
  parts.push(\`- Abstract: https://arxiv.org/abs/\${paper.arxivId}\`);
  parts.push(\`- PDF: https://arxiv.org/pdf/\${paper.arxivId}\`);
  parts.push('');
  parts.push(\`Categories: \${paper.categories.join(', ')}\`);

  if (paper.comment) {
    parts.push('');
    parts.push(\`Note: \${paper.comment}\`);
  }

  return parts.join('\\n');
}

let successCount = 0;
let errorCount = 0;

for (const paper of papers) {
  try {
    const commitMessage = formatCommitMessage(paper);
    const commitDate = paper.published;

    const tmpFile = path.join('/tmp', \`commit-msg-\${process.pid}-\${paper.arxivId.replace(/\\./g, '-')}.txt\`);
    fs.writeFileSync(tmpFile, commitMessage, 'utf8');

    execSync(
      \`git commit --allow-empty --date=\"\${commitDate}\" -F \"\${tmpFile}\"\`,
      { stdio: 'inherit' }
    );

    fs.unlinkSync(tmpFile);

    successCount++;
  } catch (error) {
    console.error(\`Failed to create commit for paper: \${paper.arxivId}\`);
    console.error(error.message);
    errorCount++;
  }
}

console.log(\`\\nSuccessfully created \${successCount} commits for \${papers[0].published.split('T')[0]}\`);
if (errorCount > 0) {
  console.log(\`Failed to create \${errorCount} commits\`);
  process.exit(1);
}
"

COMMIT_EXIT_CODE=$?

if [ $COMMIT_EXIT_CODE -eq 0 ]; then
  echo "All commits created successfully"
else
  echo "Error: Some commits failed" >&2
  exit 1
fi
