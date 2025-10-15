# arXiv AI Daily Papers

Daily archive of [arXiv cs.AI](https://arxiv.org/list/cs.AI/recent) papers. Each paper is stored as an empty git commit containing the paper's metadata, abstract, and links.

## Usage

```bash
# Fetch today's papers (outputs JSON)
node scripts/fetch.js

# Fetch papers for specific date
node scripts/fetch.js 2025-10-15

# Create commits for today's papers
./scripts/commit.sh

# Create commits for specific date
./scripts/commit.sh 2025-10-15
```

## Automation

GitHub Action runs at 01:00 UTC, Sunday through Thursday (matching arXiv's announcement schedule). Papers are announced:
- **Mon-Thu announcements**: Daily at 20:00 ET (00:00-01:00 UTC)
- **Sun announcement**: Weekend papers (Fri-Mon submissions)
- **No announcements**: Friday or Saturday

Typical volume:
- 50-200 papers per announcement day
- ~300+ papers on Monday (weekend backlog)

## Commit Format

Each commit contains:
- **Title**: Paper title
- **Body**: arXiv ID, authors, publication date, abstract, links, categories

Example:
```
Ax-Prover: A Deep Reasoning Agentic Framework for Theorem Proving

arXiv: 2510.12787
Authors: Marco Del Tredici, Jacob McCarran, Benjamin Breen, et al.
Published: 2025-10-14

[Full abstract text...]

Links:
- Abstract: https://arxiv.org/abs/2510.12787
- PDF: https://arxiv.org/pdf/2510.12787

Categories: cs.AI, cs.MA
```
