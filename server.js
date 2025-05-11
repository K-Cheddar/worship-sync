// const express = require('express');
// const path = require('path');
// const app = express();
// const cors = require('cors');
// const port = process.env.PORT || 5000;
// const request = require('request');
// const cheerio = require('cheerio');
// const qs = require('querystring');
// const h2p = require('html2plaintext');

import express from "express";
import cors from "cors";
import path from "path";
import { Document, Packer, Paragraph, TextRun } from "docx";
import mammoth from "mammoth";
import bodyParser from "body-parser";
import fs from "fs/promises";
import axios from "axios";
import qs from "qs";
import * as XLSX from "xlsx";
import dotenv from "dotenv";
import multer from "multer";

dotenv.config();
// Validate required environment variables
const requiredEnvVars = [
  "AZURE_TENANT_ID",
  "AZURE_CLIENT_ID",
  "AZURE_CLIENT_SECRET",
];
const missingEnvVars = requiredEnvVars.filter((envVar) => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  console.error("Missing required environment variables:", missingEnvVars);
  process.exit(1);
}

const app = express();
const dirname = import.meta.dirname;

const tenantId = process.env.AZURE_TENANT_ID;
const clientId = process.env.AZURE_CLIENT_ID;
const clientSecret = process.env.AZURE_CLIENT_SECRET;

const port = process.env.PORT || 5000;
// import request from "request";
// import qs from "querystring";
// import h2p from "html2plaintext";

app.listen(port, () => console.log(`Listening on port ${port}`));

app.use(bodyParser.json({ limit: "10mb", extended: true }));
app.use(express.json());

app.use(cors());
app.use(function (req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Credentials", true);
  res.header("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin,X-Requested-With,Content-Type,Accept,content-type,application/json"
  );
  next();
});

// API calls
app.get("/api/hello", (req, res) => {
  res.send({ express: "Hello From Express" });
});

// app.post('/api/updateUsers', (req, res) => {
// 	const { user, action } = req.body;
// 	const { users } = status;
// 	if (action === 'add') {
// 		const currentUser = users.find(e => e.user === user);
// 		if(currentUser) {
// 			currentUser.count += 1;
// 		}
// 		else {
// 			status.users.push({user, count: 1 });
// 		}
// 	}
// 	else if (action === 'remove') {
// 		const currentUser = users.find(e => e.user === user);
// 		if(currentUser) {
// 			if(currentUser.count > 1) {
// 				currentUser.count -= 1;
// 			}
// 			else {
// 				status.users = users.filter(e => e.user !== currentUser.user);
// 			}
// 		}
// 	}
// 	console.log(status.users);
// });

app.get("/api/bible", async (req, res) => {
  let book = req.query.book;
  let chapter = req.query.chapter;
  let version = req.query.version;

  let data = "";

  const url = `https://www.biblegateway.com/passage/?search=${book}%20${chapter}&version=${version}`;

  try {
    const response = await fetch(url);
    data = await response.text();
  } catch (error) {}
  // console.log(data);

  res.send(data);
});

app.get("/bible", async (req, res) => {
  let version = req.query.version;

  const bible = await fs.readFile(
    `./bibles/${version}.json`,
    "utf8",
    function (err, data) {
      if (err) throw err;
      return JSON.parse(data);
    }
  );

  res.send(bible);
});

// app.post("/api/currentInfo", (req, res) => {
//   let obj = req.body;
//   let t = obj.words;
//   res.send({ t });
// });

// app.post("/api/getLyrics", (req, res) => {
//   search(req.body.name, res);
// });

// app.post("/api/getHymnal", (req, res) => {
//   searchHymnal(req.body.number, res);
// });

// const hymnURL = "http://sdahymnals.com/Hymnal/";

// function searchHymnal(query, send) {
//   let url = hymnURL + query;
//   let song = {};
//   request(url, function (err, res, body) {
//     if (!err) {
//       $ = cheerio.load(body);
//       $("h1.title").each(function () {
//         song.title = $(this).text();
//         // Break From Each Loop
//         return false;
//       });
//       $("div.thecontent p").each(function () {
//         let text = $(this).text().split("\n");
//         song[text[0]] = text.slice(1);
//       });
//       send.send({ song: song });
//     } else {
//       console.log("Error : ", err);
//     }
//   });
// }

// const baseURL = "http://search.azlyrics.com";

// function search(query, send) {
//   let url = baseURL + "/search.php?q=" + qs.escape(query);

//   request(url, function (err, res, body) {
//     if (!err) {
//       $ = cheerio.load(body);

//       $("td.text-left a").each(function () {
//         url = $(this).attr("href");

//         // Get Lyrics
//         lyrics(url, send);

//         // Break From Each Loop
//         return false;
//       });
//     } else {
//       console.log("Error : ", err);
//     }
//   });
// }

// function lyrics(url, send) {
//   console.log("Getting lyrics from: ", url);

//   request(url, { ciphers: "DES-CBC3-SHA" }, function (err, res, body) {
//     if (!err) {
//       $ = cheerio.load(body);

//       $("div:not([class])").each(function () {
//         var lyrics = h2p($(this).html());
//         if (lyrics != "") {
//           send.send({ lyrics: lyrics });
//         }
//       });
//     } else {
//       console.log("Error in Getting Lyrics : ", err);
//     }
//   });
// }

async function getAccessToken() {
  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

  const tokenData = qs.stringify({
    client_id: clientId,
    scope: "https://graph.microsoft.com/.default",
    client_secret: clientSecret,
    grant_type: "client_credentials",
  });

  try {
    const response = await axios.post(tokenUrl, tokenData, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
    });

    return response.data.access_token;
  } catch (error) {
    console.error(
      "Error getting access token:",
      error.response?.data || error.message
    );
    throw error;
  }
}

async function fetchExcelFile(filePath, sheetIndex = 0) {
  try {
    const token = await getAccessToken();

    const userRes = await axios.get(
      "https://graph.microsoft.com/v1.0/users/kevin.cheddar@eliathahsda.org",
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      }
    );
    const userId = userRes.data.id;

    const driveRes = await axios.get(
      `https://graph.microsoft.com/v1.0/users/${userId}/drive`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      }
    );
    const driveId = driveRes.data.id;

    const fileMeta = await axios.get(
      `https://graph.microsoft.com/v1.0/drives/${driveId}/root:${filePath}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      }
    );
    const itemId = fileMeta.data.id;

    const fileContent = await axios.get(
      `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/content`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        responseType: "arraybuffer",
      }
    );

    try {
      const workbook = XLSX.read(fileContent.data, {
        type: "buffer",
        cellDates: true, // This will parse dates properly
        cellNF: false, // Don't parse number formats
        cellText: false, // Don't parse text formats
      });

      const sheet = workbook.Sheets[workbook.SheetNames[sheetIndex]];

      if (!sheet) {
        throw new Error("No sheets found in the Excel file");
      }

      const json = XLSX.utils.sheet_to_json(sheet, {
        raw: false, // Convert numbers to strings
        defval: null, // Default value for empty cells
        header: 1, // Use first row as headers
      });

      return json;
    } catch (error) {
      return {
        error: "Error processing Excel file",
        details: error.message,
      };
    }
  } catch (error) {
    return {
      error: "Error fetching Excel file",
      details: error.response?.data || error.message,
    };
  }
}

app.get("/getSchedule", async (req, res) => {
  const scheduleFilePath = `/${req.query.fileName}`;
  const schedule = await fetchExcelFile(scheduleFilePath, 0);
  res.send(schedule);
});

app.get("/getMembers", async (req, res) => {
  const membersFilePath = `/${req.query.fileName}`;
  const members = await fetchExcelFile(membersFilePath, 1);
  res.send(members);
});

// Add multer for handling file uploads
const upload = multer({ dest: "uploads/" });

app.post(
  "/process-program-outline",
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      console.log("Processing file:", req.file.path);

      const rawData = await extractTextFromDocx(req.file.path);
      if (!rawData) {
        throw new Error("Failed to extract text from DOCX file");
      }

      console.log("Extracted text:", rawData);

      const participantsEvents = generateParticipantsEvents(rawData);
      // console.log("Generated participants:", participantsEvents);

      // Clean up the uploaded file
      try {
        await fs.unlink(req.file.path);
      } catch (unlinkError) {
        console.error("Error cleaning up file:", unlinkError);
      }

      res.json({ participants: participantsEvents });
    } catch (error) {
      console.error("Error processing DOCX file:", error);
      // Clean up the file if it exists
      if (req.file?.path) {
        try {
          await fs.unlink(req.file.path);
        } catch (unlinkError) {
          console.error("Error cleaning up file after error:", unlinkError);
        }
      }
      res.status(500).json({
        error: "Error processing file",
        details: error.message,
      });
    }
  }
);

// Serve any static files
app.use(express.static(path.join(dirname, "/client/build")));
// Handle React routing, return all requests to React app
app.get("*", function (req, res) {
  res.sendFile(path.join(dirname, "/client/build", "index.html"));
});

const extractTextFromDocx = async (filePath) => {
  try {
    const { value } = await mammoth.extractRawText({ path: filePath });
    return value;
  } catch (err) {
    console.error("Error reading DOCX file:", err);
    return "";
  }
};

// Add this function at the top level
const capitalizeName = (name) => {
  return name
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

const generateParticipantsEvents = (data) => {
  // Split into lines and remove empty lines
  const lines = data.split("\n").filter((line) => line.trim());

  const result = [];
  let currentEvent = "";
  let currentTime = "";
  let isInEventSection = false;
  let isFirstSabbathSchoolHost = true; // Track if this is the first Sabbath School host

  lines.forEach((line) => {
    line = line.trim();

    // Skip header lines and empty lines
    if (
      !line ||
      line.includes("ELIATHAH SEVENTH DAY ADVENTIST CHURCH") ||
      line.includes("WORSHIP EXPERIENCE") ||
      line.includes("THEME") ||
      line.includes("Min") ||
      line.includes("Time") ||
      line.includes("Event") ||
      line.includes("PARTICIPANTS") ||
      line.includes("ITEM/ADDITIONAL INFO") ||
      line.includes("Instructions") ||
      line.includes("Microphone Instructions")
    ) {
      return;
    }

    // Check if line contains a time (format: HH:MM-HH:MM or HH:MM - HH:MM)
    const timeMatch = line.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
    if (timeMatch) {
      currentTime = line;
      isInEventSection = true;
      return;
    }

    // Skip duration lines
    if (line.match(/^\d+\s*mins?$/)) {
      return;
    }

    // If we're in an event section and the line isn't a time or duration
    if (isInEventSection && line) {
      // Check if this is an event (not a participant or other info)
      if (
        !line.includes("HOST") &&
        !line.includes("CO-HOST") &&
        !line.includes("ELDER") &&
        !line.includes("PASTORAL") &&
        !line.includes("PRAISE TEAM") &&
        !line.includes("KEY") &&
        !line.includes("HYMN") &&
        !line.includes("Scripture:") &&
        !line.includes("TOPIC:") &&
        !line.includes('"') &&
        !line.includes("Lapel") &&
        !line.includes("Handheld") &&
        !line.includes("mic") &&
        !line.includes("Congregation") &&
        !line.includes("Deacons") &&
        !line.includes("Stage") &&
        !line.includes("Prepare") &&
        !line.includes("Must include") &&
        !line.includes("The speaker") &&
        !line.includes("Praise team") &&
        !line.includes("STREAM") &&
        !line.includes("Afterglow") &&
        (line.includes("Special Music") ||
          line.includes("Reading The Word") ||
          line.includes("Intercessory Prayer") ||
          line.includes("Call To Prayer") ||
          line.includes("Prayer Song") ||
          line.includes("Song of Praise") ||
          line.includes("Congregational Hymn") ||
          line.includes("Offertory") ||
          line.includes("Welcome") ||
          line.includes("Sabbath School") ||
          line.includes("Sermon") ||
          line.includes("Appeal") ||
          line.includes("Praise and Worship"))
      ) {
        // Clean up event name
        currentEvent = line
          .replace(/and Welcome Song$/, "")
          .replace(/\/.*$/, "")
          .trim();

        // Reset Sabbath School host flag when we find a new event
        if (currentEvent !== "Sabbath School") {
          isFirstSabbathSchoolHost = true;
        }
      }
      // Check if this is a participant
      else if (
        (line.includes("HOST") ||
          line.includes("CO-HOST") ||
          line.includes("ELDER") ||
          line.includes("PASTOR") ||
          line.includes("PRAISE TEAM")) &&
        !line.includes("KEY") &&
        !line.includes("HYMN") &&
        !line.includes("Scripture:") &&
        !line.includes("TOPIC:") &&
        !line.includes('"') &&
        !line.includes("Lapel") &&
        !line.includes("Handheld") &&
        !line.includes("mic") &&
        !line.includes("Congregation") &&
        !line.includes("Deacons") &&
        !line.includes("Stage") &&
        !line.includes("Prepare") &&
        !line.includes("Must include") &&
        !line.includes("The speaker") &&
        !line.includes("Praise team") &&
        !line.includes("STREAM") &&
        !line.includes("Afterglow")
      ) {
        // Clean up the participant name
        let participant = line
          .replace(/^HOST\s*–\s*/, "")
          .replace(/^CO-HOST\s*–\s*/, "")
          .replace(/^ELDER\s*/, "")
          .replace(/^PASTOR\s*/, "")
          .replace(/\s*\/.*$/, "") // Remove anything after a forward slash
          .replace(/\s*AND\s*/, " & ") // Replace "AND" with &
          .trim();

        // Capitalize the participant name properly
        participant = capitalizeName(participant);

        // Handle special cases for Sabbath School
        if (currentEvent === "Sabbath School") {
          if (line.includes("HOST")) {
            if (isFirstSabbathSchoolHost) {
              result.push({
                participants: participant,
                event: "Sabbath School - Host",
              });
              isFirstSabbathSchoolHost = false;
            } else {
              result.push({
                participants: participant,
                event: "Sabbath School - Co-Host",
              });
            }
          } else if (line.includes("CO-HOST")) {
            result.push({
              participants: participant,
              event: "Sabbath School - Co-Host",
            });
          }
        } else {
          // Handle Praise Team cases
          if (line.includes("PRAISE TEAM")) {
            result.push({
              participants: "Praise Team",
              event: currentEvent,
            });
          } else {
            // Only add if we have both a valid participant and event
            if (
              participant &&
              currentEvent &&
              !participant.includes('"') &&
              !participant.includes("KEY") &&
              !participant.includes("HYMN") &&
              !participant.includes("Scripture:") &&
              !participant.includes("TOPIC:")
            ) {
              result.push({
                participants: participant,
                event: currentEvent,
              });
            }
          }
        }
      }
    }
  });

  return result;
};

const demoArray = [
  {
    participants: "Rashaun Baldeo",
    event: "Sabbath School - Host",
  },
  {
    participants: "Javar Baldeo",
    event: "Sabbath School - Co-Host",
  },
  {
    participants: "Jacob Hall",
    event: "Sabbath School - Co-Host",
  },
  {
    participants: "Bertie Hall",
    event: "Sabbath School - Co-Host",
  },
  {
    participants: "Courtney Stephens & Nelih Morgan",
    event: "Welcome",
  },
  {
    participants: "Nelih Morgan",
    event: "Call To Praise",
  },
  {
    participants: "Praise Team",
    event: "Song of Praise",
  },
  {
    participants: "Courtney Stephens",
    event: "Invocation",
  },
  {
    participants: "Praise Team",
    event: "Congregational Hymn",
  },
  {
    participants: "Kandyce Mullings",
    event: "Reading The Word",
  },
  {
    participants: "Clarence Jones",
    event: "Offertory",
  },
  {
    participants: "Sherian Jordon",
    event: "Special Music",
  },
  {
    participants: "Praise Team",
    event: "Call to Prayer",
  },
  {
    participants: "Praise Team",
    event: "Prayer Song",
  },
  {
    participants: "Roy Ebanks",
    event: "Intercessory Prayer",
  },
  {
    participants: "Praise Team",
    event: "Praise and Worship",
  },
  {
    participants: "Desmond Dunkley",
    event: "Sermon",
  },
  {
    participants: "Praise Team",
    event: "Appeal Song",
  },
  {
    participants: "Desmond Dunkley",
    event: "Appeal",
  },
  {
    participants: "Desmond Dunkley",
    event: "CLosing Prayer",
  },
  {
    participants: "Praise Team",
    event: "Afterglow",
  },
];
