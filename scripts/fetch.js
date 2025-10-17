#!/usr/bin/env node

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

function getDateString() {
  const providedDate = process.argv[2];
  if (providedDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(providedDate)) {
      throw new Error('Invalid date format. Use YYYY-MM-DD');
    }
    const date = new Date(providedDate);
    if (isNaN(date.getTime())) {
      throw new Error('Invalid date');
    }
    return providedDate;
  }
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday.toISOString().split('T')[0];
}

async function fetchArxivPapers() {
  try {
    const dateStr = getDateString();
    const query = `cat:cs.AI`;
    const url = `${API_URL}?search_query=${encodeURIComponent(query)}&start=0&max_results=2000&sortBy=submittedDate&sortOrder=descending`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const xml = await response.text();
    const entries = xml.match(/<entry>([\s\S]*?)<\/entry>/g);

    if (!entries || entries.length === 0) {
      console.error('No entries found in feed');
      return 1;
    }

    const papers = [];
    for (const entry of entries) {
      const paper = parseEntry(entry);
      const paperDate = paper.published.split('T')[0];
      if (paperDate === dateStr) {
        papers.push(paper);
      }
    }

    if (papers.length === 0) {
      console.error(`No papers found for date: ${dateStr}`);
      console.log('[]');
      return 0;
    }

    console.log(JSON.stringify(papers, null, 2));
    return 0;
  } catch (error) {
    console.error('Error fetching arXiv papers:', error.message);
    return 1;
  }
}

const exitCode = await fetchArxivPapers();
process.exit(exitCode);
