#!/usr/bin/env node

import { execSync } from 'child_process';

const API_URL = 'https://export.arxiv.org/api/query';

function extractText(xml, tag) {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

function extractAllMatches(xml, tag) {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  const matches = [];
  let match;
  while ((match = regex.exec(xml)) !== null) {
    matches.push(match[1].trim());
  }
  return matches;
}

function extractArxivId(idUrl) {
  const match = idUrl.match(/arxiv\.org\/abs\/([^\s]+)/i);
  return match ? match[1].replace(/v\d+$/, '') : '';
}

function extractCategories(entryXml) {
  const categoryMatches = entryXml.match(/<category\s+term="([^"]+)"/gi);
  if (!categoryMatches) return [];
  return categoryMatches.map(match => {
    const termMatch = match.match(/term="([^"]+)"/);
    return termMatch ? termMatch[1] : '';
  }).filter(Boolean);
}

function extractLinks(entryXml) {
  const links = {};
  const linkMatches = entryXml.match(/<link[^>]*>/gi);
  if (linkMatches) {
    linkMatches.forEach(linkTag => {
      const hrefMatch = linkTag.match(/href="([^"]+)"/);
      const relMatch = linkTag.match(/rel="([^"]+)"/);
      const typeMatch = linkTag.match(/type="([^"]+)"/);
      if (hrefMatch) {
        const href = hrefMatch[1];
        const rel = relMatch ? relMatch[1] : '';
        const type = typeMatch ? typeMatch[1] : '';
        if (rel === 'alternate' && type.includes('html')) {
          links.abstract = href;
        } else if (type.includes('pdf')) {
          links.pdf = href;
        }
      }
    });
  }
  return links;
}

function parseEntry(entryXml) {
  const id = extractText(entryXml, 'id');
  const arxivId = extractArxivId(id);
  const title = extractText(entryXml, 'title').replace(/\s+/g, ' ').trim();
  const summary = extractText(entryXml, 'summary').replace(/\s+/g, ' ').trim();
  const published = extractText(entryXml, 'published');
  const updated = extractText(entryXml, 'updated');
  const authors = extractAllMatches(entryXml, 'name');
  const categories = extractCategories(entryXml);
  const links = extractLinks(entryXml);
  const comment = extractText(entryXml, 'arxiv:comment').replace(/\s+/g, ' ').trim();

  return {
    arxivId,
    title,
    summary,
    published,
    updated,
    authors,
    categories,
    links,
    comment
  };
}

function getLastCommitDate() {
  try {
    const log = execSync('git log --format=%cd --date=format:%Y-%m-%d --author="arXiv AI Bot" -1', { encoding: 'utf-8' });
    const dateStr = log.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return dateStr;
    }
    return null;
  } catch {
    return null;
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  let startDate = null;
  let endDate = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--start-date' && args[i + 1]) {
      startDate = args[i + 1];
      i++;
    } else if (args[i] === '--end-date' && args[i + 1]) {
      endDate = args[i + 1];
      i++;
    } else if (!args[i].startsWith('--')) {
      startDate = args[i];
    }
  }
  return { startDate, endDate };
}

function getYesterday() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday.toISOString().split('T')[0];
}

function getNextDate(dateStr) {
  const date = new Date(dateStr);
  date.setDate(date.getDate() + 1);
  return date.toISOString().split('T')[0];
}

function getDateRange() {
  const { startDate, endDate } = parseArgs();
  const yesterday = getYesterday();
  let start = startDate;
  let end = endDate || yesterday;
  if (start && !/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    throw new Error('Invalid start date format. Use YYYY-MM-DD');
  }
  if (end && !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    throw new Error('Invalid end date format. Use YYYY-MM-DD');
  }
  if (!start) {
    const lastCommit = getLastCommitDate();
    start = lastCommit ? getNextDate(lastCommit) : yesterday;
  }
  const dates = [];
  let current = start;
  while (current <= end) {
    dates.push(current);
    current = getNextDate(current);
  }
  return dates;
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchPapersForDate(dateStr, retries = 3) {
  const query = `cat:cs.AI`;
  const url = `${API_URL}?search_query=${encodeURIComponent(query)}&start=0&max_results=1000&sortBy=submittedDate&sortOrder=descending`;
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url);
      if (response.status === 429) {
        if (attempt < retries) {
          const waitTime = Math.pow(3, attempt) * 5000;
          console.error(`Rate limited for ${dateStr}, retrying in ${waitTime/1000}s (attempt ${attempt + 1}/${retries + 1})`);
          await sleep(waitTime);
          continue;
        }
        throw new Error(`Rate limited after ${retries + 1} attempts`);
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const xml = await response.text();
      const entries = xml.match(/<entry>([\s\S]*?)<\/entry>/g);
      if (!entries || entries.length === 0) {
        return [];
      }
      const papers = [];
      for (const entry of entries) {
        const paper = parseEntry(entry);
        const paperDate = paper.published.split('T')[0];
        if (paperDate === dateStr) {
          papers.push(paper);
        }
      }
      return papers;
    } catch (error) {
      lastError = error;
      if (attempt < retries && error.message.includes('Rate limited')) {
        continue;
      }
      break;
    }
  }
  throw lastError;
}

async function main() {
  try {
    const dates = getDateRange();
    if (dates.length === 0) {
      console.log('[]');
      return 0;
    }
    const allPapers = [];
    let hasErrors = false;
    const verbose = dates.length > 1;
    for (const dateStr of dates) {
      try {
        const papers = await fetchPapersForDate(dateStr);
        if (papers.length > 0) {
          if (verbose) console.error(`Fetched ${papers.length} papers for ${dateStr}`);
          allPapers.push(...papers);
        } else {
          if (verbose) console.error(`No papers found for ${dateStr}`);
        }
        if (dates.length > 1) {
          await sleep(1000);
        }
      } catch (error) {
        if (verbose) console.error(`Failed to fetch papers for ${dateStr}: ${error.message}`);
        hasErrors = true;
      }
    }
    if (allPapers.length === 0) {
      console.log('[]');
      return hasErrors ? 1 : 0;
    }
    console.log(JSON.stringify(allPapers, null, 2));
    return hasErrors ? 1 : 0;
  } catch (error) {
    console.error('Error:', error.message);
    return 1;
  }
}

const exitCode = await main();
process.exit(exitCode);
