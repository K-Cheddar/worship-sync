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

export interface ServicePlanningTeamAssignment {
  teamName: string;
  role: string;
  name: string;
}

export interface ServicePlanningImportData {
  planLabel: string;
  sections: ServicePlanningSection[];
  teamAssignments: ServicePlanningTeamAssignment[];
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
  const data = await getServicePlanningImportDataFromUrl(url);
  return data.sections;
};

export const getServicePlanningImportDataFromUrl = async (
  url: string,
): Promise<ServicePlanningImportData> => {
  const response = await fetch(
    `${getApiBasePath()}api/getEventDetails?url=${encodeURIComponent(url)}`,
  );
  const textHtml = await response.text();
  return parseServicePlanningImportFromHtml(textHtml);
};

/** Strip tags that trigger network loads on innerHTML parse (avoids CSP violations in Electron). */
const stripResourceTagsForLocalParse = (html: string) =>
  html
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/<source\b[^>]*>/gi, "")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object\b[^>]*>[\s\S]*?<\/object>/gi, "")
    .replace(/<embed\b[^>]*>/gi, "");

const normalizeCellText = (text: string) =>
  text
    .replace(/\u00a0/g, " ")
    .replace(/[\t\n\r]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

const getElementText = (element?: Element | null) =>
  normalizeCellText(
    element instanceof HTMLElement
      ? element.innerText
      : element?.textContent || "",
  );

const buildAccordionRowEventData = (tds: NodeListOf<Element>) => {
  const middleCellLines = Array.from(tds[1].childNodes)
    .map((node) =>
      normalizeCellText(
        node.textContent || (node instanceof HTMLElement ? node.innerText : ""),
      ),
    )
    .filter(Boolean);

  const elementType = middleCellLines[0] ?? "";
  const title = middleCellLines
    .slice(1)
    .join(" ")
    .replace(/^-?\s*/, "")
    .trim();

  return {
    elementType,
    title,
    ledBy: getElementText(tds[2]),
  };
};

const buildWorshipFlowRowEventData = (tds: NodeListOf<Element>) => ({
  elementType: getElementText(tds[1]),
  title: getElementText(tds[2]),
  ledBy: getElementText(tds[3]),
});

const parseEventData = (textHtml: string): EventData[] => {
  const el = document.createElement("html");
  el.innerHTML = stripResourceTagsForLocalParse(textHtml);

  const data: EventData[] = [];

  const mainRows = el.querySelectorAll("tr.main-row");
  const worshipFlowRows = el.querySelectorAll(
    "table.worship-flow-table tbody tr",
  );

  if (mainRows.length > 0) {
    mainRows.forEach((tr) => {
      const tds = tr.querySelectorAll("td");
      if (tds.length < 6) return;
      data.push({
        elementType: getElementText(tds[2]),
        title: getElementText(tds[3]),
        ledBy: getElementText(tds[4]),
      });
    });
    appendLegacyCollapsedAssignments(el, data);
    return data;
  }

  if (worshipFlowRows.length > 0) {
    worshipFlowRows.forEach((tr) => {
      if (
        Array.from(tr.classList).some(
          (className) =>
            className === "divider" || className.startsWith("divider-"),
        )
      ) {
        return;
      }
      const tds = tr.querySelectorAll("td");
      if (tds.length < 5) return;
      data.push(buildWorshipFlowRowEventData(tds));
    });
    return data;
  }

  const rows = el.querySelectorAll("table tr");

  const accordionRows = Array.from(
    el.querySelectorAll("tr.accordion-toggle"),
  ).map((tr) => {
    const tds = tr.querySelectorAll("td");
    if (tds.length !== 3) return null;
    return buildAccordionRowEventData(tds);
  });

  if (accordionRows.length > 0) {
    data.push(...accordionRows.filter((row): row is EventData => Boolean(row)));
    appendLegacyCollapsedAssignments(el, data);
    return data;
  }

  const legacyThreeCol = Array.from(rows)
    .filter((tr) => tr.querySelectorAll("td").length === 3)
    .map((tr) => {
      const tds = tr.querySelectorAll("td");
      return {
        elementType: getElementText(tds[1]),
        title: "",
        ledBy: getElementText(tds[2]),
      };
    });
  data.push(...legacyThreeCol);

  appendLegacyCollapsedAssignments(el, data);

  return data;
};

export const parseSectionsFromHtml = (
  textHtml: string,
): ServicePlanningSection[] => {
  return parseServicePlanningImportFromHtml(textHtml).sections;
};

const parseTeamAssignments = (
  root: HTMLElement,
): ServicePlanningTeamAssignment[] => {
  const assignments: ServicePlanningTeamAssignment[] = [];
  const teamTables = root.querySelectorAll("#teams .teamContainer table");

  teamTables.forEach((table) => {
    const teamName = normalizeCellText(
      table.querySelector("tr th[colspan]")?.textContent || "",
    );
    if (!teamName) return;

    const rows = table.querySelectorAll("tr");
    rows.forEach((row, index) => {
      if (index === 0) return;
      const cells = row.querySelectorAll("td");
      if (cells.length < 3) return;

      const role = normalizeCellText(cells[0].textContent || "");
      const name = normalizeCellText(cells[2].textContent || "");
      if (!role || !name || /^\(no person\)$/i.test(name)) return;

      assignments.push({
        teamName,
        role,
        name,
      });
    });
  });

  return assignments;
};

const extractPlanLabel = (root: HTMLElement): string => {
  const dateHeader = root.querySelector(".service-info-table-printout th.left");
  const direct = getElementText(dateHeader);
  if (direct) return direct;

  const publicHeading = root.querySelector("#weekend-service h3");
  const publicLabel = getElementText(publicHeading);
  if (publicLabel) return publicLabel;

  const fullText = normalizeCellText(root.innerText || "");
  const match = fullText.match(
    /\b[A-Z][a-z]+\s+\d{1,2},\s+\d{4}\s*-\s*\d{1,2}(?::\d{2})?\s*(?:AM|PM)\b/,
  );
  return match?.[0] || "";
};

export const parseServicePlanningImportFromHtml = (
  textHtml: string,
): ServicePlanningImportData => {
  const el = document.createElement("html");
  el.innerHTML = stripResourceTagsForLocalParse(textHtml);

  const sections: ServicePlanningSection[] = [];
  let current: ServicePlanningSection = { sectionName: "", rows: [] };

  const allRows = el.querySelectorAll("table tr");

  const isMainRow = (tr: Element) => tr.classList.contains("main-row");
  const isDividerRow = (tr: Element) =>
    Array.from(tr.classList).some(
      (c) => c === "divider" || c.startsWith("divider-"),
    );
  const isAccordionRow = (tr: Element) =>
    tr.classList.contains("accordion-toggle");
  const worshipFlowRows = el.querySelectorAll(
    "table.worship-flow-table tbody tr",
  );

  // Detect format: does the table have tr.main-row at all?
  const hasMainRows = el.querySelectorAll("tr.main-row").length > 0;

  if (hasMainRows) {
    for (const tr of Array.from(allRows)) {
      if (isDividerRow(tr)) {
        if (current.rows.length > 0 || current.sectionName) {
          sections.push(current);
        }
        current = {
          sectionName: getElementText(tr),
          rows: [],
        };
        continue;
      }
      if (!isMainRow(tr)) continue;
      const tds = tr.querySelectorAll("td");
      if (tds.length < 6) continue;
      current.rows.push({
        elementType: getElementText(tds[2]),
        title: getElementText(tds[3]),
        ledBy: getElementText(tds[4]),
      });
    }
  } else if (el.querySelectorAll("tr.accordion-toggle").length > 0) {
    for (const tr of Array.from(allRows)) {
      if (isDividerRow(tr)) {
        if (current.rows.length > 0 || current.sectionName) {
          sections.push(current);
        }
        current = {
          sectionName: getElementText(tr),
          rows: [],
        };
        continue;
      }
      if (!isAccordionRow(tr)) continue;
      const tds = tr.querySelectorAll("td");
      if (tds.length !== 3) continue;
      current.rows.push(buildAccordionRowEventData(tds));
    }
  } else if (worshipFlowRows.length > 0) {
    for (const tr of Array.from(worshipFlowRows)) {
      if (isDividerRow(tr)) {
        if (current.rows.length > 0 || current.sectionName) {
          sections.push(current);
        }
        current = {
          sectionName: getElementText(tr),
          rows: [],
        };
        continue;
      }
      const tds = tr.querySelectorAll("td");
      if (tds.length < 5) continue;
      current.rows.push(buildWorshipFlowRowEventData(tds));
    }
  } else {
    // Legacy 3-column format — no divider support, return single unnamed section
    for (const tr of Array.from(allRows)) {
      const tds = tr.querySelectorAll("td");
      if (tds.length !== 3) continue;
      current.rows.push({
        elementType: getElementText(tds[1]),
        title: "",
        ledBy: getElementText(tds[2]),
      });
    }
  }

  if (current.rows.length > 0 || current.sectionName) {
    sections.push(current);
  }

  return {
    planLabel: extractPlanLabel(el),
    sections,
    teamAssignments: parseTeamAssignments(el),
  };
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

      const name = getElementText(nestedTds[0]);
      const role = getElementText(nestedTds[1]);

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
