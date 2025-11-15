#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATE_ARG="${1:-}"

TEMP_JSON=$(mktemp)
trap "rm -f \"$TEMP_JSON\"" EXIT

if [ -n "$DATE_ARG" ]; then
  if ! [[ "$DATE_ARG" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    echo "Error: Invalid date format. Use YYYY-MM-DD" >&2
    exit 1
  fi
  echo "Fetching arXiv AI papers for $DATE_ARG..."
  if ! node "$SCRIPT_DIR/fetch.js" "$DATE_ARG" > "$TEMP_JSON"; then
    echo "Error: fetch.js failed" >&2
    cat "$TEMP_JSON" >&2
    exit 1
  fi
else
  echo "Auto-detecting missing dates and fetching papers..."
  if ! node "$SCRIPT_DIR/fetch.js" > "$TEMP_JSON"; then
    echo "Error: fetch.js failed" >&2
    cat "$TEMP_JSON" >&2
    exit 1
  fi
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
  echo "No new papers to commit"
  exit 0
fi

echo "Found $PAPER_COUNT papers. Checking for existing papers in last 14 days..."

EXISTING_IDS=$(git log --since="14 days ago" --all --grep="^arXiv: " --format="%B" | grep "^arXiv: " | sed 's/arXiv: //' | sort -u | tr '\n' ',')

TEMP_JSON="$TEMP_JSON" EXISTING_IDS="$EXISTING_IDS" node -e "
const papers = JSON.parse(require('fs').readFileSync(process.env.TEMP_JSON, 'utf-8'));
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const existingIds = new Set(
  (process.env.EXISTING_IDS || '').split(',').filter(Boolean)
);

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
let skippedCount = 0;
let errorCount = 0;

for (const paper of papers) {
  try {
    if (existingIds.has(paper.arxivId)) {
      console.log(\`Already exists: \${paper.arxivId}\`);
      skippedCount++;
      continue;
    }

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

const dates = [...new Set(papers.map(p => p.published.split('T')[0]))].sort();
const dateStr = dates.length === 1 ? dates[0] : \`\${dates.length} dates (\${dates[0]} to \${dates[dates.length-1]})\`;
console.log(\`\\nSuccessfully created \${successCount} commits for \${dateStr}\`);
if (skippedCount > 0) {
  console.log(\`Skipped \${skippedCount} existing papers\`);
}
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
