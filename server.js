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
import bodyParser from "body-parser";
import fs from "fs/promises";
import axios from "axios";
import qs from "qs";
import * as XLSX from "xlsx";
import dotenv from "dotenv";

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

app.get("/api/version", (req, res) => {
  const packageJson = require("./package.json");
  res.json({ version: packageJson.version });
});

app.get("/api/changelog", async (req, res) => {
  try {
    const changelogPath = path.join(dirname, "CHANGELOG.md");
    const changelogContent = await fs.readFile(changelogPath, "utf8");
    res.setHeader("Content-Type", "text/plain");
    res.send(changelogContent);
  } catch (error) {
    console.error("Error reading changelog:", error);
    res.status(500).json({ error: "Failed to load changelog" });
  }
});

// Serve any static files
app.use(express.static(path.join(dirname, "/client/build")));
// Handle React routing, return all requests to React app
app.get("*", function (req, res) {
  res.sendFile(path.join(dirname, "/client/build", "index.html"));
});
