import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const root = process.cwd();
const session = {
  churchId: "church-1",
  database: "fixture",
  sessionId: "restream-1",
  startedAt: 1,
  messageCount: 0,
  enabled: true,
  connected: true,
  connectionState: "connected",
  accountLabel: "",
  streamTitle: "",
  lastError: "",
  platformSummary: [],
};
const restreamMessages = [
  {
    id: "restream-message-1",
    churchId: "church-1",
    database: "fixture",
    sessionId: "restream-1",
    platform: "YouTube",
    connectionIdentifier: "youtube-main",
    author: "Livestream guest",
    authorAvatarUrl: "",
    text: "Thanks for sharing this helpful update.",
    postedAt: Date.now() - 30_000,
    receivedAt: Date.now() - 30_000,
    rawEventType: "5",
    kind: "viewer_message",
    isHighlighted: false,
    hidden: false,
  },
];
const posts = Array.from({ length: 48 }, (_, index) => ({
  _id: `post:current:post-${index}`,
  _rev: "1-a",
  type: "post",
  docType: "board-post",
  aliasId: "sunday",
  boardId: "current",
  database: "fixture",
  author: index === 2
    ? "Alexandria Community Member With A Long Name"
    : `Guest ${index + 1}`,
  text: `Question ${index + 1}: please include this longer message so cards wrap naturally at phone widths.`,
  timestamp: Date.now() - 60_000 + index,
  hidden: index === 2,
  highlighted: index === 1,
  deleted: index === 3,
  ...(index === 4 ? { author: "Board moderator", authorId: "worshipsync:fixture-moderator" } : {}),
}));
const alias = {
  _id: "alias:sunday",
  _rev: "1-a",
  type: "alias",
  docType: "board-alias",
  aliasId: "sunday",
  title: "Sunday Board",
  database: "fixture",
  currentBoardId: "current",
  history: ["old"],
  createdAt: 1,
  updatedAt: 1,
};
const boards = {
  current: {
    _id: "board:current",
    _rev: "1-a",
    type: "board",
    docType: "board",
    id: "current",
    aliasId: "sunday",
    database: "fixture",
    createdAt: 10,
    archived: false,
  },
  old: {
    _id: "board:old",
    _rev: "1-a",
    type: "board",
    docType: "board",
    id: "old",
    aliasId: "sunday",
    database: "fixture",
    createdAt: 1,
    archived: true,
  },
};
const server = await createServer({
  configFile: false,
  root,
  plugins: [
    {
      name: "board-controller-browser-fixtures",
      enforce: "pre",
      resolveId(id) {
        const path = id.replaceAll("\\", "/");
        if (path.endsWith("/context/globalInfo") || path.endsWith("/context/globalInfo.tsx"))
          return "\0board-global-context";
        if (path.endsWith("/context/controllerInfo") || path.endsWith("/context/controllerInfo.tsx"))
          return "\0board-controller-context";
        if (path.endsWith("/boards/BoardSyncContext") || path.endsWith("/boards/BoardSyncContext.tsx"))
          return "\0board-sync-context";
        if (path.endsWith("/boards/useRestreamSession") || path.endsWith("/boards/useRestreamSession.ts"))
          return "\0board-restream-hook";
        if (
          path.endsWith("/boards/useYouTubeConnectionStatus") ||
          path.endsWith("/boards/useYouTubeConnectionStatus.ts")
        )
          return "\0board-youtube-hook";
        if (path.endsWith("/hooks/useMediaQuery") || path.endsWith("/hooks/useMediaQuery.ts"))
          return "\0board-media-query";
        if (path === "../hooks" || path.endsWith("/hooks/index.ts")) return "\0board-hooks-index";
        if (
          path.endsWith("/containers/Toolbar/ToolbarElements/UserSection") ||
          path.endsWith("/containers/Toolbar/ToolbarElements/UserSection.tsx")
        )
          return "\0board-user-section";
        if (path.endsWith("/boards/BoardControllerMenu") || path.endsWith("/boards/BoardControllerMenu.tsx"))
          return "\0board-menu";
      },
      async load(id) {
        if (id === "\0board-global-context")
          return `import {createContext} from 'react'; export const GlobalInfoContext=createContext(null); export const globalFireDbInfo={}; export const globalHostId='fixture-host';`;
        if (id === "\0board-controller-context")
          return `import {createContext} from 'react'; export const ControllerInfoContext=createContext(null); export const globalDb=undefined; export const globalBroadcastRef={postMessage:()=>{}};`;
        if (id === "\0board-sync-context")
          return `export const useBoardSync=()=>({db:window.__boardDb,status:'connected',pullFromRemote:()=>{},subscribeToChanges:(listener)=>{window.__boardListeners??=new Set();window.__boardListeners.add(listener);return()=>window.__boardListeners.delete(listener)}}); export default ({children})=>children;`;
        if (id === "\0board-restream-hook")
          return `export const useRestreamSession=()=>({session:${JSON.stringify(session)},messages:${JSON.stringify(restreamMessages)},isLoading:false,error:'',bestEffortOnly:true,oauthConfigured:true,isOffline:false,streamState:'disconnected',streamFailure:null,feedState:'has_messages',reload:async()=>{}});`;
        if (id === "\0board-youtube-hook")
          return `export const useYouTubeConnectionStatus=()=>({connected:true,accountLabel:'Main channel'});`;
        if (id === "\0board-media-query")
          return `import {useEffect,useState} from 'react'; export const useMediaQuery=(query)=>{const [matches,setMatches]=useState(()=>window.matchMedia(query).matches);useEffect(()=>{const media=window.matchMedia(query);const update=()=>setMatches(media.matches);update();media.addEventListener('change',update);return()=>media.removeEventListener('change',update)},[query]);return matches};`;
        if (id === "\0board-hooks-index")
          return `export const useSelector=(selector)=>selector({undoable:{present:{preferences:{scrollbarWidth:'thin'}}}});`;
        if (id === "\0board-user-section")
          return `import React from 'react'; export default function UserSection(){return React.createElement('button',{className:'min-h-[44px] px-2','aria-label':'Account: Fixture Operator'},React.createElement('span',null,'Synced'),React.createElement('span',{className:'ml-2'},'Fixture Operator'))}`;
        if (id === "\0board-menu")
          return `import React from 'react'; export const BoardControllerMenu=()=>React.createElement('button',{className:'min-h-[44px] px-2','aria-label':'Open menu'},'Menu');`;
      },
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url?.split("?")[0] === "/board-controller") {
            res.setHeader("Content-Type", "text/html");
            res.end(
              await server.transformIndexHtml(
                req.url,
                '<html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body><div id="root"></div><script type="module" src="/e2e/board-controller-fixture.tsx"></script></body></html>',
              ),
            );
          } else next();
        });
      },
    },
    react(),
  ],
  optimizeDeps: { entries: ["e2e/board-controller-fixture.tsx"] },
  resolve: { alias: { "@": resolve(root, "src") } },
  server: { host: "127.0.0.1", port: 3112, strictPort: true },
});
await server.listen();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(10_000);
  page.on("console", (message) => {
    if (message.type() === "error") console.error("BROWSER CONSOLE", message.text());
  });
  page.on("requestfailed", (request) => console.error("REQUEST FAILED", request.url(), request.failure()?.errorText));
  page.on("pageerror", (error) => console.error("BROWSER ERROR", error.message));
  let firstYoutubeRequestRelease;
  let secondYoutubeRequestRelease;
  let youtubeSendCount = 0;
  await page.route("**/api/churches/church-1/youtube/live-chat/messages", async (route) => {
    youtubeSendCount += 1;
    if (youtubeSendCount === 1) {
      await new Promise((resolve) => { firstYoutubeRequestRelease = resolve; });
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true }) });
    } else if (youtubeSendCount === 2) {
      await new Promise((resolve) => { secondYoutubeRequestRelease = resolve; });
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "YouTube is temporarily unavailable." }) });
    } else {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true }) });
    }
  });
  await page.route("**/api/boards/sunday/posts", async (route) => {
    const body = route.request().postDataJSON();
    assert.equal(body.expectedBoardId, "current", "board sends should stay bound to the selected board session");
    assert.equal(body.text, "Board post stays on its destination");
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ post: { success: true } }) });
  });
  await page.addInitScript(
    (data) => {
      window.__boardAlias = data.alias;
      window.__boardBoards = data.boards;
      window.__boardPosts = data.posts;
      window.__boardListeners = new Set();
      window.__emitBoardPost = (post) => {
        window.__boardPosts.push(post);
        window.__boardListeners.forEach((listener) => listener({ id: post._id, doc: post }));
      };
      window.__boardDb = {
        allDocs: async (options) => {
          if (options.startkey === "alias:") return { rows: [{ doc: window.__boardAlias }] };
          if (Array.isArray(options.keys))
            return {
              rows: options.keys.map((key) => ({
                doc: window.__boardBoards[key.replace("board:", "")],
              })),
            };
          const boardId = String(options.startkey || "")
            .replace(/^post:/, "")
            .replace(/:$/, "");
          return {
            rows: (boardId === "current" ? window.__boardPosts : []).map((doc) => ({ doc })),
          };
        },
        get: async (id) =>
          id === "alias:sunday" ? window.__boardAlias : window.__boardBoards[id.replace("board:", "")],
        changes: () => ({
          on: () => ({ on: () => ({ cancel() {} }), cancel() {} }),
          cancel() {},
        }),
      };
    },
    { alias, boards, posts },
  );
  for (const [width, height] of [
    [320, 568],
    [375, 812],
    [390, 844],
    [768, 1024],
    [1024, 768],
    [1440, 900],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto("http://127.0.0.1:3112/board-controller");
    await page.getByText("Question 1:", { exact: false }).waitFor();
    const toolbar = page.locator("[data-board-toolbar]");
    const toolbarBox = await toolbar.boundingBox();
    const mobile = width < 1280;
    const postingButtonHeights = [];
    let moderationButtonHeight;
    if (mobile) {
      assert(
        toolbarBox && Math.abs(toolbarBox.height - 48) <= 1,
        `${width}px toolbar is not 48px: ${JSON.stringify(toolbarBox)}`,
      );
      assert.equal(await page.getByRole("heading", { name: "Discussion Board" }).count(), 0);
      const targets = [
        page.getByRole("button", { name: "Open menu" }),
        page.getByRole("button", { name: /Account: Fixture Operator/ }),
        page.getByRole("button", { name: /Current board: Sunday Board/ }),
        page.getByRole("button", { name: "Board tools" }),
      ];
      for (const target of targets) {
        const box = await target.boundingBox();
        assert(box && box.height >= 44, `${width}px touch target is too short: ${JSON.stringify(box)}`);
      }
      for (const name of ["Board post", "YouTube chat"]) {
        const dockButton = page.getByRole("button", { name });
        const dockBox = await dockButton.boundingBox();
        if (dockBox) postingButtonHeights.push(dockBox.height);
        assert.equal(await dockButton.getAttribute("data-variant"), "presentTertiary", `${name} should use tertiary styling`);
        assert(dockBox && dockBox.height >= 32 && dockBox.height <= 36, `${name} should be visually compact: ${JSON.stringify(dockBox)}`);
        assert.equal(await dockButton.evaluate((el) => getComputedStyle(el, "::after").content !== "none"), true, `${name} should keep an expanded pointer target`);
      }
      const feed = page.getByRole("region", { name: "Live activity feed" });
      const feedBox = await feed.boundingBox();
      assert(feedBox && feedBox.height > 60, `${width}px feed is not visible: ${JSON.stringify(feedBox)}`);
      const activityHeading = page.getByRole("heading", { name: "Live activity" });
      const activityHeader = activityHeading.locator("..", { has: page.locator("details") });
      const headerBox = await activityHeader.boundingBox();
      const headingBox = await activityHeading.boundingBox();
      assert(headerBox && headerBox.height <= 52, `${width}px activity header has excess height: ${JSON.stringify(headerBox)}`);
      assert(headingBox && feedBox && feedBox.y >= headerBox.y + headerBox.height - 1, "feed overlaps the activity header");
      const about = page.getByLabel("About live activity");
      const aboutBox = await about.boundingBox();
      assert(aboutBox && aboutBox.height >= 44, `information affordance is too short: ${JSON.stringify(aboutBox)}`);
      assert.equal(await page.getByText("Discussion board posts and Restream chat appear in time order.").isVisible().catch(() => false), false);
      const actionRow = page.locator("[data-posting-dock-actions]");
      const rowBeforeComposer = await actionRow.boundingBox();
      const feedPinMetrics = () => feed.evaluate((el) => ({ distance: el.scrollHeight - el.scrollTop - el.clientHeight, scrollHeight: el.scrollHeight, scrollTop: el.scrollTop, clientHeight: el.clientHeight }));
      const pinnedBeforeComposer = (await feedPinMetrics()).distance <= 48;
      assert(pinnedBeforeComposer, `${width}px initial feed should be following the latest activity: ${JSON.stringify(await feedPinMetrics())}`);
      await page.getByRole("button", { name: "Board post" }).click();
      await page.waitForTimeout(300);
      const boardComposer = page.getByRole("textbox", { name: /Add to discussion board/i });
      const boardComposerBox = await boardComposer.boundingBox();
      const rowDuringComposer = await actionRow.boundingBox();
      assert(boardComposerBox && rowDuringComposer && boardComposerBox.y < rowDuringComposer.y, `${width}px composer should expand above the action row`);
      assert(boardComposerBox && boardComposerBox.width >= 120, `${width}px message field should retain useful width: ${JSON.stringify(boardComposerBox)}`);
      assert(rowBeforeComposer && rowDuringComposer && Math.abs(rowDuringComposer.y - rowBeforeComposer.y) <= 1, `${width}px opening composer moved the action row`);
      const pinnedDuringComposer = (await feedPinMetrics()).distance <= 48;
      assert(pinnedDuringComposer, `${width}px opening the composer should preserve follow-latest: ${JSON.stringify(await feedPinMetrics())}`);
      await page.getByRole("button", { name: "Board post" }).click();
      await page.waitForTimeout(300);
      const rowAfterComposer = await actionRow.boundingBox();
      assert(rowBeforeComposer && rowAfterComposer && Math.abs(rowAfterComposer.y - rowBeforeComposer.y) <= 1, `${width}px closing composer moved the action row`);
      const pinnedAfterComposer = await feed.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight <= 48);
      assert(pinnedAfterComposer, `${width}px closing the composer should preserve follow-latest`);
      if (width <= 390) {
        const firstCard = page.getByRole("article", { name: "Discussion board post" }).first();
        const firstMessage = firstCard.getByText("Question 1:", { exact: false });
        const firstHide = firstCard.getByRole("button", { name: /^Hide$/i });
        const messageBox = await firstMessage.boundingBox();
        const hideBox = await firstHide.boundingBox();
        moderationButtonHeight = hideBox?.height;
        assert(messageBox && hideBox && messageBox.y + messageBox.height <= hideBox.y, "message content must precede its moderation actions");
        assert(hideBox.height >= 28 && hideBox.height <= 36, `Hide should remain visually compact: ${JSON.stringify(hideBox)}`);
        const cardBox = await firstCard.boundingBox();
        assert(cardBox && cardBox.height < 180, `message card is unexpectedly tall: ${JSON.stringify(cardBox)}`);
        const boardPadding = await firstCard.evaluate((el) => getComputedStyle(el).paddingTop);
        const restreamCard = page.getByRole("article", { name: "Restream · YouTube" });
        const restreamBox = await restreamCard.boundingBox();
        const restreamPadding = await restreamCard.evaluate((el) => getComputedStyle(el).paddingTop);
        assert(restreamBox && restreamBox.height < 130, `Restream card is unexpectedly tall: ${JSON.stringify(restreamBox)}`);
        assert(parseFloat(boardPadding) <= 10 && parseFloat(restreamPadding) <= 10, "activity card padding should stay compact");
        assert(await page.getByText("Alexandria Community Member With A Long Name", { exact: true }).isVisible(), "long author name was clipped");
        console.log(`DENSITY ${width}px: board card ${cardBox.height.toFixed(1)}px (padding ${boardPadding}); Restream card ${restreamBox.height.toFixed(1)}px (padding ${restreamPadding})`);
      }
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        true,
        `${width}px horizontal overflow`,
      );
      if (width === 390) {
        await feed.evaluate((el) => {
          el.scrollTop = 240;
        });
        const priorScroll = await feed.evaluate((el) => el.scrollTop);
        const actionRow = page.locator("[data-posting-dock-actions]");
        const rowBefore = await actionRow.boundingBox();
        const composerRows = page.locator("[data-posting-dock] > div.grid");
        const transitionDuration = await composerRows.first().evaluate((el) => getComputedStyle(el).transitionDuration);
        assert(transitionDuration.split(",").some((duration) => parseFloat(duration) >= 0.18), `composer should animate for about 200ms: ${transitionDuration}`);
        await page.getByRole("button", { name: "Board post" }).click();
        const boardDraft = page.getByRole("textbox", {
          name: /Add to discussion board/i,
        });
        await boardDraft.waitFor();
        const boardComposer = page.getByLabel("Posting dock").getByRole("textbox", { name: /Add to discussion board/i });
        const composerBox = await boardComposer.boundingBox();
        const rowDuringOpen = await actionRow.boundingBox();
        assert(composerBox && rowDuringOpen && composerBox.y < rowDuringOpen.y, "composer should expand above the posting actions");
        assert(rowBefore && rowDuringOpen && Math.abs(rowDuringOpen.y - rowBefore.y) <= 1, "opening composer moved the posting row");
        assert.equal(await page.getByRole("button", { name: "Close composer" }).count(), 0, "Docked Board composer should not show an internal close action");
        assert.equal(await page.getByRole("heading", { name: "Add to discussion board" }).count(), 0, "Board composer should not repeat its destination heading");
        await boardDraft.fill("Board draft stays here");
        assert(await boardDraft.isVisible(), "Board composer disappeared while editing");
        assert(await feed.isVisible(), "Opening the composer obscured the feed");
        const afterOpenScroll = await feed.evaluate((el) => el.scrollTop);
        assert(
          Math.abs(afterOpenScroll - priorScroll) <= 2,
          `opening composer moved feed from ${priorScroll} to ${afterOpenScroll}`,
        );
        const newPost = {
          _id: "post:current:e2e-new",
          _rev: "1-z",
          type: "post",
          docType: "board-post",
          aliasId: "sunday",
          boardId: "current",
          database: "fixture",
          author: "New guest",
          text: "Incoming while composing",
          timestamp: Date.now(),
          hidden: false,
          highlighted: false,
          deleted: false,
        };
        await page.evaluate((post) => window.__emitBoardPost(post), newPost);
        await page.getByText("Incoming while composing").waitFor();
        assert.equal(
          await feed.evaluate((el) => el.scrollTop),
          afterOpenScroll,
          "incoming activity interrupted review of older messages",
        );
        await page.getByRole("button", { name: "YouTube chat" }).click();
        const youtubeDraft = page.getByRole("textbox", {
          name: "YouTube live chat message",
        });
        const rowAfterSwitch = await actionRow.boundingBox();
        assert(rowBefore && rowAfterSwitch && Math.abs(rowAfterSwitch.y - rowBefore.y) <= 1, "switching composers moved the posting row");
        assert.equal(await page.getByLabel("Live stream URL or video ID (optional)").count(), 0, "YouTube URL override should stay hidden by default");
        assert.equal(await page.getByRole("button", { name: "Close YouTube composer" }).count(), 0, "Docked YouTube composer should not show an internal close action");
        await youtubeDraft.fill("YouTube draft stays here");
        await page.getByRole("button", { name: "Board post" }).click();
        assert.equal(
          await page.getByRole("textbox", { name: /Add to discussion board/i }).inputValue(),
          "Board draft stays here",
        );
        await page.getByRole("button", { name: "YouTube chat" }).click();
        assert.equal(
          await page.getByRole("textbox", { name: "YouTube live chat message" }).inputValue(),
          "YouTube draft stays here",
        );
        await page.getByRole("textbox", { name: "YouTube live chat message" }).fill("Success after switching");
        await page.getByRole("button", { name: "Send to YouTube" }).click();
        const pendingYoutubeIndicator = page.locator("[data-posting-dock-actions]").getByRole("status");
        await pendingYoutubeIndicator.waitFor();
        await page.getByRole("button", { name: "Board post" }).click();
        assert(await page.getByRole("textbox", { name: /Add to discussion board/i }).isVisible(), "switching during YouTube send should keep Board composer available");
        for (let attempt = 0; attempt < 100 && !firstYoutubeRequestRelease; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
        assert(firstYoutubeRequestRelease, "YouTube send request did not reach the held browser response");
        firstYoutubeRequestRelease();
        await page.getByText("Message sent to YouTube live chat.").waitFor();
        assert(await page.getByRole("textbox", { name: /Add to discussion board/i }).isVisible(), "YouTube completion should not close the selected Board composer");
        await page.getByRole("textbox", { name: /Add to discussion board/i }).fill("Board post stays on its destination");
        await page.getByRole("button", { name: "Send to discussion board" }).click();
        await page.getByText("Message posted to the discussion board.").waitFor();

        await page.getByRole("button", { name: "YouTube chat" }).click();
        const failedDraft = page.getByRole("textbox", { name: "YouTube live chat message" });
        await failedDraft.fill("Retry after switching away");
        await page.getByRole("button", { name: "Send to YouTube" }).click();
        await page.locator("[data-posting-dock-actions]").getByRole("status").waitFor();
        await page.getByRole("button", { name: "Board post" }).click();
        for (let attempt = 0; attempt < 100 && !secondYoutubeRequestRelease; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
        assert(secondYoutubeRequestRelease, "second YouTube send request did not reach the held browser response");
        secondYoutubeRequestRelease();
        await page.getByText("YouTube is temporarily unavailable.").first().waitFor();
        await page.getByRole("button", { name: "YouTube chat" }).click();
        assert.equal(await page.getByRole("textbox", { name: "YouTube live chat message" }).inputValue(), "Retry after switching away", "failed message should remain available for retry");
        await page.getByRole("button", { name: "Send to YouTube" }).click();
        await page.getByText("Message sent to YouTube live chat.").waitFor();
        await page.getByRole("button", { name: "Send to YouTube" }).waitFor();
        await page.setViewportSize({ width: 390, height: 420 });
        await page.waitForFunction(() => {
          const height = Number.parseFloat(document.querySelector("#controller-main")?.style.height || "0");
          return Math.abs(height - (window.visualViewport?.height || window.innerHeight)) <= 1;
        });
        const viewportHeight = await page.evaluate(() => window.visualViewport?.height || window.innerHeight);
        const textBox = await page.getByRole("textbox", { name: "YouTube live chat message" }).boundingBox();
        const send = await page.getByRole("button", { name: "Send to YouTube" }).boundingBox();
        assert(
          textBox && send && textBox.y + textBox.height <= viewportHeight && send.y + send.height <= viewportHeight,
          `keyboard-sized viewport covers composer controls: ${JSON.stringify({ textBox, send, viewportHeight })}`,
        );
        assert.equal(await feed.evaluate((el) => el.scrollTop), afterOpenScroll, "viewport resize reset feed position");
        const rowAfterResize = await actionRow.boundingBox();
        const resizedDockBox = await page.getByLabel("Posting dock").boundingBox();
        assert(rowAfterResize && resizedDockBox && Math.abs(rowAfterResize.y + rowAfterResize.height - (resizedDockBox.y + resizedDockBox.height - 8)) <= 2, "keyboard-sized viewport should keep the posting row anchored to the resized dock");
        await page.emulateMedia({ reducedMotion: "reduce" });
        const reducedTransition = await composerRows.first().evaluate((el) => ({ property: getComputedStyle(el).transitionProperty, duration: getComputedStyle(el).transitionDuration }));
        assert(reducedTransition.property === "none" || reducedTransition.duration.split(",").every((duration) => parseFloat(duration) <= 0.05), `reduced motion should remove or reduce the dock transition: ${JSON.stringify(reducedTransition)}`);
        await page.emulateMedia({ reducedMotion: "no-preference" });
        await page.setViewportSize({ width, height });
        await page.getByRole("button", { name: "YouTube chat" }).click();
        await feed.evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        });
        await page.waitForTimeout(50);
        const feedBottomBox = await feed.boundingBox();
        const lastCardBox = await page.getByRole("article").last().boundingBox();
        assert(feedBottomBox && lastCardBox && lastCardBox.y + lastCardBox.height <= feedBottomBox.y + feedBottomBox.height + 1, "last message is not fully reachable in the feed");
        await page.getByRole("button", { name: "Board tools" }).click();
        await page.getByRole("dialog", { name: "Board tools" }).waitFor();
      }
      console.log(`PASS ${width}x${height}: posting buttons ${postingButtonHeights.map((value) => value.toFixed(1)).join("/")}px; moderation ${moderationButtonHeight?.toFixed(1) ?? "n/a"}px; feed geometry and overflow`);
    } else {
      assert(
        toolbarBox && toolbarBox.height > 48,
        `desktop toolbar unexpectedly compact: ${JSON.stringify(toolbarBox)}`,
      );
      assert.equal(await page.getByRole("heading", { name: "Discussion Board", exact: true }).isVisible(), true);
      assert.equal(await page.getByRole("complementary", { name: "Manage boards" }).isVisible(), true);
      assert.equal(await page.getByRole("complementary", { name: "Board tools" }).isVisible(), true);
      const desktopHide = await page.getByRole("article", { name: "Discussion board post" }).first().getByRole("button", { name: /^Hide$/i }).boundingBox();
      assert(desktopHide && desktopHide.height >= 28 && desktopHide.height <= 32, `desktop moderation control should be compact: ${JSON.stringify(desktopHide)}`);
      const dock = page.getByLabel("Posting dock");
      const actionRow = dock.locator("[data-posting-dock-actions]");
      const boardButton = page.getByRole("button", { name: "Board post" });
      const youtubeButton = page.getByRole("button", { name: "YouTube chat" });
      const boardBox = await boardButton.boundingBox();
      const youtubeBox = await youtubeButton.boundingBox();
      const rowBefore = await actionRow.boundingBox();
      const feedBox = await page.getByRole("region", { name: "Live activity feed" }).boundingBox();
      assert(boardBox && boardBox.height >= 28 && boardBox.height <= 32, `desktop Board post action should be compact: ${JSON.stringify(boardBox)}`);
      assert(youtubeBox && youtubeBox.height >= 28 && youtubeBox.height <= 32, `desktop YouTube action should be compact: ${JSON.stringify(youtubeBox)}`);
      assert(boardBox && youtubeBox && feedBox && boardBox.width < feedBox.width / 2 && youtubeBox.width < feedBox.width / 2, "desktop posting actions should be content-sized");
      await boardButton.click();
      const rowOpen = await actionRow.boundingBox();
      assert(rowBefore && rowOpen && Math.abs(rowOpen.y - rowBefore.y) <= 1, "desktop composer opening moved the posting row");
      const desktopComposer = await dock.getByRole("textbox", { name: /Add to discussion board/i }).boundingBox();
      assert(desktopComposer && rowOpen && desktopComposer.y < rowOpen.y, "desktop composer should expand above its action row");
      await boardButton.click();
      const rowClosed = await actionRow.boundingBox();
      assert(rowBefore && rowClosed && Math.abs(rowClosed.y - rowBefore.y) <= 1, "desktop composer closing moved the posting row");
      console.log(`PASS ${width}x${height}: posting buttons ${boardBox?.height.toFixed(1)}/${youtubeBox?.height.toFixed(1)}px; moderation ${desktopHide?.height.toFixed(1)}px; content-sized dock and three-panel layout`);
    }
  }
} finally {
  await browser.close();
  await server.close();
}
