import { getApiBasePath } from "../../utils/environment";

export interface EventData {
  elementType: string;
  title: string;
  ledBy: string;
}

export interface ServicePlanningSection {
  sectionName: string;
  rows: EventData[];
}

export const getNamesFromUrl = async (url: string): Promise<EventData[]> => {
  const response = await fetch(
    `${getApiBasePath()}api/getEventDetails?url=${encodeURIComponent(url)}`,
  );
  const textHtml = await response.text();

  return parseEventData(textHtml);
};

export const getSectionsFromUrl = async (
  url: string,
): Promise<ServicePlanningSection[]> => {
  const response = await fetch(
    `${getApiBasePath()}api/getEventDetails?url=${encodeURIComponent(url)}`,
  );
  const textHtml = await response.text();
  return parseSectionsFromHtml(textHtml);
};

/** Strip tags that trigger network loads on innerHTML parse (avoids CSP violations in Electron). */
const stripResourceTagsForLocalParse = (html: string) =>
  html
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/<source\b[^>]*>/gi, "")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object\b[^>]*>[\s\S]*?<\/object>/gi, "")
    .replace(/<embed\b[^>]*>/gi, "");

const normalizeCellText = (text: string) => text.replace(/[\t\n\r]+/g, " ").replace(/\s{2,}/g, " ").trim();

const parseEventData = (textHtml: string): EventData[] => {
  const el = document.createElement("html");
  el.innerHTML = stripResourceTagsForLocalParse(textHtml);

  const data: EventData[] = [];

  const mainRows = el.querySelectorAll("tr.main-row");

  if (mainRows.length > 0) {
    mainRows.forEach((tr) => {
      const tds = tr.querySelectorAll("td");
      if (tds.length < 6) return;
      data.push({
        elementType: normalizeCellText(tds[2].innerText),
        title: normalizeCellText(tds[3].innerText),
        ledBy: normalizeCellText(tds[4].innerText),
      });
    });
    appendLegacyCollapsedAssignments(el, data);
    return data;
  }

  const rows = el.querySelectorAll("table tr");

  const legacyThreeCol = Array.from(rows)
    .filter((tr) => tr.querySelectorAll("td").length === 3)
    .map((tr) => {
      const tds = tr.querySelectorAll("td");
      return {
        elementType: normalizeCellText(tds[1].innerText),
        title: "",
        ledBy: normalizeCellText(tds[2].innerText),
      };
    });
  data.push(...legacyThreeCol);

  appendLegacyCollapsedAssignments(el, data);

  return data;
};

export const parseSectionsFromHtml = (textHtml: string): ServicePlanningSection[] => {
  const el = document.createElement("html");
  el.innerHTML = stripResourceTagsForLocalParse(textHtml);

  const sections: ServicePlanningSection[] = [];
  let current: ServicePlanningSection = { sectionName: "", rows: [] };

  const allRows = el.querySelectorAll("table tr");

  const isMainRow = (tr: Element) => tr.classList.contains("main-row");
  const isDividerRow = (tr: Element) =>
    Array.from(tr.classList).some((c) => c === "divider" || c.startsWith("divider-"));

  // Detect format: does the table have tr.main-row at all?
  const hasMainRows = el.querySelectorAll("tr.main-row").length > 0;

  if (hasMainRows) {
    for (const tr of Array.from(allRows)) {
      if (isDividerRow(tr)) {
        if (current.rows.length > 0 || current.sectionName) {
          sections.push(current);
        }
        current = {
          sectionName: normalizeCellText(tr.innerText),
          rows: [],
        };
        continue;
      }
      if (!isMainRow(tr)) continue;
      const tds = tr.querySelectorAll("td");
      if (tds.length < 6) continue;
      current.rows.push({
        elementType: normalizeCellText(tds[2].innerText),
        title: normalizeCellText(tds[3].innerText),
        ledBy: normalizeCellText(tds[4].innerText),
      });
    }
  } else {
    // Legacy 3-column format — no divider support, return single unnamed section
    for (const tr of Array.from(allRows)) {
      const tds = tr.querySelectorAll("td");
      if (tds.length !== 3) continue;
      current.rows.push({
        elementType: normalizeCellText(tds[1].innerText),
        title: "",
        ledBy: normalizeCellText(tds[2].innerText),
      });
    }
  }

  if (current.rows.length > 0 || current.sectionName) {
    sections.push(current);
  }

  return sections;
};

/** Older printouts: Host / Co-Host rows nested under a colspan row with `.collapse`. */
function appendLegacyCollapsedAssignments(
  root: HTMLElement,
  data: EventData[],
) {
  const rows = root.querySelectorAll("table tr");

  for (let i = 0; i < rows.length; i++) {
    const nextRow = rows[i + 1];
    if (!nextRow) continue;

    const nextTds = nextRow.querySelectorAll("td");
    if (nextTds.length !== 1 || !nextTds[0].hasAttribute("colspan")) continue;

    const collapsedContent = nextTds[0].querySelector(".collapse");
    if (!collapsedContent) continue;

    const nestedRows = collapsedContent.querySelectorAll("tbody tr");
    nestedRows.forEach((nestedRow) => {
      const nestedTds = nestedRow.querySelectorAll("td");
      if (nestedTds.length !== 2) return;

      const name = normalizeCellText(nestedTds[0].innerText);
      const role = normalizeCellText(nestedTds[1].innerText);

      if (
        name &&
        !name.includes("Coordinators") &&
        !name.includes("General Notes") &&
        !name.includes("Specific Notes") &&
        !role.includes("Lapels") &&
        !role.includes("Go Live")
      ) {
        data.push({
          elementType: role,
          title: "",
          ledBy: name,
        });
      }
    });
    i++;
  }
}
