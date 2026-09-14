import type PouchDB from "pouchdb-browser";
import type { DBBoardPost } from "../types";
import { getBoardPostRange, sortBoardPostsAscending } from "./boardUtils";

type AllDocsResult<T> = {
  rows: Array<{ doc?: T }>;
};

/** Read one board's current local replica without making an HTTP request. */
export const getLocalBoardPosts = async (
  db: PouchDB.Database,
  boardId: string,
): Promise<DBBoardPost[]> => {
  const result = (await db.allDocs({
    include_docs: true,
    ...getBoardPostRange(boardId),
  })) as AllDocsResult<DBBoardPost>;

  return sortBoardPostsAscending(
    result.rows.flatMap((row) => (row.doc ? [row.doc] : [])),
  );
};
