#!/usr/bin/env node
/**
 * Generates a self-hosted "Contribution Graph" SVG for a GitHub profile README.
 *
 * Data source: GitHub's own public contribution calendar
 * (https://github.com/users/<username>/contributions), the same HTML the
 * profile page renders. No third-party services, no tokens, no rate limits.
 *
 * Usage:
 *   node generate-contribution-graph.mjs [username] [output-path]
 *
 * The script fails loudly when GitHub changes the calendar markup instead of
 * publishing an empty graph, so the workflow never overwrites a good asset
 * with a broken one.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const username = process.argv[2] || "JoythDev";
const outputPath = process.argv[3] || "dist/contribution-graph.svg";

const WIDTH = 880;
const HEIGHT = 300;
const PADDING = { top: 64, right: 26, bottom: 44, left: 54 };

const COLORS = {
  background: "#0d1117",
  title: "#c9d1d9",
  subtitle: "#8b949e",
  grid: "#21262d",
  axis: "#6e7681",
  line: "#38bdae",
  point: "#70a5fd",
  area: "#38bdae",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Approximate contribution counts per intensity level (0 = none ... 4 = max).
// Used only when a tooltip cannot be parsed.
const LEVEL_FALLBACK = [0, 1, 5, 9, 13];

// A rolling-year calendar always has ~53 weeks (371 cells).
const MINIMUM_DAYS = 350;

const fetchCalendar = async () => {
  const response = await fetch(`https://github.com/users/${encodeURIComponent(username)}/contributions`, {
    headers: { "User-Agent": `${username}-contribution-graph`, Accept: "text/html" },
  });
  if (!response.ok) {
    throw new Error(`GitHub answered HTTP ${response.status} for the contributions calendar`);
  }
  return response.text();
};

const parseCalendar = (html) => {
  const days = [];

  // Each cell is <td data-date="YYYY-MM-DD" data-level="N"> followed by its own
  // <tool-tip> ("12 contributions on ..." / "No contributions on ...").
  // Splitting by <td keeps every cell and its tooltip in the same chunk.
  for (const chunk of html.split(/<td\b/).slice(1)) {
    const date = chunk.match(/data-date="(\d{4}-\d{2}-\d{2})"/)?.[1];
    if (!date) continue;

    const level = Number(chunk.match(/data-level="(\d)"/)?.[1] ?? 0);
    const tooltip = chunk.match(/<tool-tip\b[^>]*>([^<]*)<\/tool-tip>/)?.[1]?.trim() ?? "";

    let count;
    if (/^no contributions/i.test(tooltip)) {
      count = 0;
    } else {
      const parsed = Number.parseInt(tooltip, 10);
      count = Number.isNaN(parsed) ? LEVEL_FALLBACK[level] ?? 0 : parsed;
    }

    days.push({ date, count });
  }

  return days.sort((a, b) => a.date.localeCompare(b.date));
};

const format = (value) => value.toFixed(2);

const niceCeiling = (value) => Math.max(4, Math.ceil(value / 4) * 4);

const sumContributions = (days) => {
  const today = new Date().toISOString().slice(0, 10);
  return days.filter((day) => day.date <= today).reduce((total, day) => total + day.count, 0);
};

const renderGraph = (days) => {
  const plot = {
    left: PADDING.left,
    top: PADDING.top,
    width: WIDTH - PADDING.left - PADDING.right,
    height: HEIGHT - PADDING.top - PADDING.bottom,
  };
  const baseline = plot.top + plot.height;
  const yMax = niceCeiling(Math.max(1, ...days.map((day) => day.count)));
  const step = days.length > 1 ? plot.width / (days.length - 1) : 0;

  const x = (index) => plot.left + index * step;
  const y = (count) => baseline - (count / yMax) * plot.height;

  const linePath = days
    .map((day, index) => `${index === 0 ? "M" : "L"}${format(x(index))},${format(y(day.count))}`)
    .join(" ");

  const areaPath = [
    `M${format(x(0))},${format(baseline)}`,
    ...days.map((day, index) => `L${format(x(index))},${format(y(day.count))}`),
    `L${format(x(days.length - 1))},${format(baseline)}`,
    "Z",
  ].join(" ");

  const points = days
    .map((day, index) =>
      day.count > 0
        ? `<circle cx="${format(x(index))}" cy="${format(y(day.count))}" r="1.7" fill="${COLORS.point}" opacity="0.85"/>`
        : "",
    )
    .join("");

  const gridLines = [];
  const axisLabels = [];
  for (let quarter = 0; quarter <= 4; quarter += 1) {
    const value = (yMax / 4) * quarter;
    const lineY = format(y(value));
    gridLines.push(
      `<line x1="${plot.left}" y1="${lineY}" x2="${WIDTH - PADDING.right}" y2="${lineY}" stroke="${COLORS.grid}" stroke-width="1" stroke-dasharray="3 4"/>`,
    );
    axisLabels.push(
      `<text x="${plot.left - 10}" y="${lineY}" fill="${COLORS.axis}" font-size="10" text-anchor="end" dominant-baseline="middle">${value}</text>`,
    );
  }

  // Month labels, skipping any label that would collide with the previous one.
  const monthLabels = [];
  let previousLabelX = -Infinity;
  days.forEach((day, index) => {
    const current = new Date(`${day.date}T00:00:00Z`);
    const previous = index > 0 ? new Date(`${days[index - 1].date}T00:00:00Z`) : null;
    if (previous && current.getUTCMonth() === previous.getUTCMonth()) return;

    const labelX = x(index);
    if (labelX - previousLabelX < 34) return;
    previousLabelX = labelX;

    const month = MONTHS[current.getUTCMonth()];
    const withYear = current.getUTCMonth() === 0 || index === 0;
    const label = withYear ? `${month} ${current.getUTCFullYear()}` : month;
    monthLabels.push(
      `<text x="${format(labelX)}" y="${HEIGHT - PADDING.bottom + 22}" fill="${COLORS.axis}" font-size="10" text-anchor="middle">${label}</text>`,
    );
  });

  const total = sumContributions(days);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="Contribution Graph">`,
    "<title>Contribution Graph</title>",
    "<defs>",
    `<linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">`,
    `<stop offset="0%" stop-color="${COLORS.area}" stop-opacity="0.35"/>`,
    `<stop offset="100%" stop-color="${COLORS.area}" stop-opacity="0.02"/>`,
    "</linearGradient>",
    "</defs>",
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="${COLORS.background}"/>`,
    `<g font-family="ui-sans-serif, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif">`,
    `<text x="${WIDTH / 2}" y="30" fill="${COLORS.title}" font-size="17" font-weight="600" text-anchor="middle">Contribution Graph</text>`,
    `<text x="${WIDTH / 2}" y="50" fill="${COLORS.subtitle}" font-size="11.5" text-anchor="middle">${total} contributions in the last year</text>`,
    ...gridLines,
    ...axisLabels,
    ...monthLabels,
    `<path d="${areaPath}" fill="url(#areaGradient)"/>`,
    `<path d="${linePath}" fill="none" stroke="${COLORS.line}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>`,
    `<g>${points}</g>`,
    "</g>",
    "</svg>",
    "",
  ].join("\n");
};

const main = async () => {
  const html = await fetchCalendar();
  const days = parseCalendar(html);

  if (days.length < MINIMUM_DAYS) {
    throw new Error(`Unexpected calendar markup: parsed only ${days.length} days from GitHub's HTML`);
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, renderGraph(days), "utf8");
  console.log(
    `Contribution graph written to ${outputPath} (${days.length} days, ${sumContributions(days)} contributions in the last year).`,
  );
};

main().catch((error) => {
  console.error(`Failed to generate the contribution graph: ${error.message}`);
  process.exit(1);
});
