import { sumR2ChurchMetadataUsage } from "./churchStorageQuota.js";
import { toWorshipSyncContentDbName } from "./couchContentDatabase.js";

export const createChurchR2UsageLoader = ({
  getFirestore,
  queryDocs,
  axios,
  env = process.env,
} = {}) => async (churchId) => {
  const firestore = getFirestore?.();
  const resources = firestore
    ? (await firestore.collection("churchResources")
        .where("churchId", "==", churchId).get())
        .docs.map((doc) => doc.data())
    : await queryDocs(
        "churchResources",
        [{ field: "churchId", value: churchId }],
        { limit: Number.MAX_SAFE_INTEGER },
      );
  const chatMessages = firestore
    ? (await firestore.collection("chatMessages")
        .where("churchId", "==", churchId).get())
        .docs.map((doc) => doc.data())
    : await queryDocs(
        "chatMessages",
        [{ field: "churchId", value: churchId }],
        { limit: Number.MAX_SAFE_INTEGER },
      );

  const songs = [];
  if (env.COUCHDB_HOST && env.COUCHDB_USER && env.COUCHDB_PASSWORD) {
    const database = toWorshipSyncContentDbName(churchId);
    const origin = env.COUCHDB_HOST.startsWith("http")
      ? env.COUCHDB_HOST.replace(/\/$/, "")
      : `https://${env.COUCHDB_HOST}`;
    const url = `${origin}/${encodeURIComponent(database)}/_all_docs`;
    const headers = {
      Authorization: `Basic ${Buffer.from(`${env.COUCHDB_USER}:${env.COUCHDB_PASSWORD}`).toString("base64")}`,
    };
    const pageSize = 1000;
    for (let skip = 0; ; skip += pageSize) {
      const response = await axios.get(url, {
        headers,
        params: { include_docs: true, limit: pageSize, skip },
      });
      const rows = response.data?.rows || [];
      songs.push(...rows.map((row) => row.doc).filter((doc) => doc?.songAudio));
      if (rows.length < pageSize) break;
    }
  }

  return sumR2ChurchMetadataUsage({ resources, songs, chatMessages });
};
