import { getApiBasePath } from "../../utils/environment";

export interface EventData {
  element: string;
  leader: string;
}

export const getNamesFromUrl = async (url: string): Promise<EventData[]> => {
  const response = await fetch(
    `${getApiBasePath()}api/getEventDetails?url=${url}`
  );
  const textHtml = await response.text();

  return parseEventData(textHtml);
};

const parseEventData = (textHtml: string): EventData[] => {
  const el = document.createElement("html");
  el.innerHTML = textHtml;

  const rows = el.querySelectorAll("table tr");

  // Get regular 3-column data
  const data = Array.from(rows)
    .filter((tr) => tr.querySelectorAll("td").length === 3) // only rows with 3 tds
    .map((tr) => {
      const tds = tr.querySelectorAll("td");
      return {
        element: tds[1].innerText.trim().replaceAll("\n", ""),
        leader: tds[2].innerText.trim().replaceAll("\n", ""),
      };
    });

  // Look for collapsed sections and extract Host/Co-Host assignments
  for (let i = 0; i < rows.length; i++) {
    const nextRow = rows[i + 1];
    if (nextRow) {
      const nextTds = nextRow.querySelectorAll("td");
      if (nextTds.length === 1 && nextTds[0].hasAttribute("colspan")) {
        const collapsedContent = nextTds[0].querySelector(".collapse");
        if (collapsedContent) {
          const nestedRows = collapsedContent.querySelectorAll("tbody tr");
          nestedRows.forEach((nestedRow) => {
            const nestedTds = nestedRow.querySelectorAll("td");
            if (nestedTds.length === 2) {
              const name = nestedTds[0].innerText.trim().replaceAll("\n", "");
              const role = nestedTds[1].innerText.trim().replaceAll("\n", "");

              // Only add specific Host/Co-Host assignments
              if (
                name &&
                !name.includes("Coordinators") &&
                !name.includes("General Notes") &&
                !name.includes("Specific Notes") &&
                !role.includes("Lapels") &&
                !role.includes("Go Live")
              ) {
                data.push({
                  element: role, // Host, Co-Host, etc.
                  leader: name, // Jackie Mullings, Bertie Hall, etc.
                });
              }
            }
          });
        }
        i++; // Skip the collapsed row since we processed it
      }
    }
  }

  return data;
};
