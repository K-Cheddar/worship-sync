const getScheduleFromExcel = async (
  fileName: string,
  membersFileName: string
) => {
  const response = await fetch(
    `${
      process.env.REACT_APP_API_BASE_PATH
    }getSchedule?fileName=${encodeURIComponent(fileName)}`
  );

  const membersResponse = await fetch(
    `${
      process.env.REACT_APP_API_BASE_PATH
    }getMembers?fileName=${encodeURIComponent(membersFileName)}`
  );

  const data = await response.json();
  const members = await membersResponse.json();

  const schedule = getClosestUpcomingSchedule(data);
  const transformedSchedule = await transformSchedule(schedule, members);

  return transformedSchedule;
};

export default getScheduleFromExcel;

const getClosestUpcomingSchedule = (data: any) => {
  // Get current date
  const today = new Date();

  // Get the headers (first row)
  const headers = data[0];

  // Find the first row with a date >= today
  let closestRow: any = null;
  let closestDate: Date | null = null;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const dateStr = row[0];
    // Skip if dateStr is not a valid date in MM/DD/YY or MM/DD/YYYY format
    if (typeof dateStr !== "string") continue;
    const dateParts = dateStr.split("/");
    if (dateParts.length !== 3) continue;
    const [month, day, year] = dateParts;
    if (
      isNaN(Number(month)) ||
      isNaN(Number(day)) ||
      isNaN(Number(year)) ||
      Number(month) < 1 ||
      Number(month) > 12 ||
      Number(day) < 1 ||
      Number(day) > 31 ||
      (year.length !== 2 && year.length !== 4)
    ) {
      continue;
    }
    // Parse date in MM/DD/YY or MM/DD/YYYY format
    const fullYear = year.length === 2 ? parseInt(year) + 2000 : parseInt(year);
    const rowDate = new Date(fullYear, parseInt(month) - 1, parseInt(day));
    rowDate.setHours(0, 0, 0, 0);
    if (rowDate >= today) {
      if (!closestDate || rowDate < closestDate) {
        closestDate = rowDate;
        closestRow = row;
      }
    }
  }

  if (!closestRow || !closestDate) {
    return null;
  }

  // Format date as MM/DD/YY
  const formattedDate = `${
    closestDate.getMonth() + 1
  }/${closestDate.getDate()}/${closestDate.getFullYear().toString().slice(-2)}`;

  // Create schedule object
  const schedule = {
    date: formattedDate,
    positions: {} as Record<string, string>,
  };

  // Map positions to people
  for (let i = 1; i < headers.length; i++) {
    const header = headers[i];
    if (header && closestRow[i]) {
      schedule.positions[header] = closestRow[i] as string;
    }
  }

  return schedule;
};

// Helper function to normalize names using the members list
const normalizeName = (name: string, members: string[][]): string => {
  // Try to find an exact match first
  const exactMatch = members.find(
    (member) => member[0].toLowerCase() === name.toLowerCase()
  );

  if (exactMatch) {
    return exactMatch[0];
  }

  // If no exact match, try to match by first name
  const firstNameMatch = members.find((member) => {
    const memberFirstName = member[0].split(" ")[0].toLowerCase();
    const inputFirstName = name.split(" ")[0].toLowerCase();
    return inputFirstName === memberFirstName;
  });

  if (firstNameMatch) {
    return firstNameMatch[0];
  }

  return name;
};

interface Schedule {
  date: string;
  positions: Record<string, string>;
}

interface ScheduleEntry {
  heading: string;
  names: string;
}

export const transformSchedule = async (
  schedule: Schedule | null,
  members: string[][]
): Promise<ScheduleEntry[]> => {
  if (!schedule || !schedule.positions) {
    return [];
  }

  const creditHeadingMapping: { [key: string]: string | string[] } = {
    "Technical Director": "Director",
    "Camera Operators": ["Camera 1", "Camera 2", "Camera 3", "Camera 4"],
    Graphics: "In House",
    "Text Master": "Text Master",
    "Audio Engineers": ["Front of House Audio", "Stream Audio"],
    "Worship Coordinators": ["Coordinator 1", "Coordinator 2"],
  };

  // Create a reverse mapping for easier lookup
  const reverseMapping: { [key: string]: string } = {};
  Object.entries(creditHeadingMapping).forEach(([newHeading, oldHeadings]) => {
    if (Array.isArray(oldHeadings)) {
      oldHeadings.forEach((oldHeading) => {
        reverseMapping[oldHeading] = newHeading;
      });
    } else {
      reverseMapping[oldHeadings] = newHeading;
    }
  });

  // Transform and group the schedule data
  const transformedSchedule: { [key: string]: string[] } = {};

  for (const [position, name] of Object.entries(schedule.positions)) {
    // Find the new heading for this position
    const newHeading = Object.entries(reverseMapping).find(([oldHeading]) =>
      position.toLowerCase().includes(oldHeading.toLowerCase())
    )?.[1];

    if (newHeading) {
      if (!transformedSchedule[newHeading]) {
        transformedSchedule[newHeading] = [];
      }

      // First process any names in parentheses
      const namesToProcess = name.match(/(.*?)\s*\((.*?)\)/)
        ? [
            name.match(/(.*?)\s*\((.*?)\)/)![1].trim(),
            name.match(/(.*?)\s*\((.*?)\)/)![2].trim(),
          ]
        : [name];

      // Normalize each name and add to the schedule
      for (const nameToProcess of namesToProcess) {
        const normalizedName = normalizeName(nameToProcess, members);

        // Add prefixes for audio engineers
        if (newHeading === "Audio Engineers") {
          if (position.toLowerCase().includes("front of house")) {
            transformedSchedule[newHeading].push(
              `Front of House - ${normalizedName}`
            );
          } else if (position.toLowerCase().includes("stream")) {
            transformedSchedule[newHeading].push(`Online - ${normalizedName}`);
          }
        } else {
          transformedSchedule[newHeading].push(normalizedName);
        }
      }
    }
  }

  // Convert to final list format
  const scheduleList: ScheduleEntry[] = [];
  Object.entries(transformedSchedule).forEach(([heading, names]) => {
    scheduleList.push({
      heading,
      names: names.join("\n"),
    });
  });

  return scheduleList;
};
