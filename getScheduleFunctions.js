import axios from "axios";
import qs from "qs";
import * as XLSX from "xlsx";
import dotenv from "dotenv";

dotenv.config();

const tenantId = process.env.AZURE_TENANT_ID;
const clientId = process.env.AZURE_CLIENT_ID;
const clientSecret = process.env.AZURE_CLIENT_SECRET;

export async function getAccessToken() {
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

export async function fetchExcelFile(filePath, sheetIndex = 0) {
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
