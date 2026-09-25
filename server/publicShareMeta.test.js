import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPublicShareImageUrl,
  isLinkPreviewCrawler,
  matchPublicShareRoute,
  renderPublicShareHtml,
  resolvePublicShareMeta,
} from "./publicShareMeta.js";
import { isPublicSharePathname } from "../client/src/utils/publicSharePathRedirect.ts";

test("matchPublicShareRoute recognizes each public share path", () => {
  assert.deepEqual(matchPublicShareRoute("/invite", "?token=abc"), {
    kind: "invite",
    canonicalPath: "/invite",
    hashTarget: "/#/invite?token=abc",
  });

  assert.deepEqual(matchPublicShareRoute("/sms-opt-in"), {
    kind: "sms-opt-in",
    canonicalPath: "/sms-opt-in",
    hashTarget: "/sms-opt-in",
  });

  assert.deepEqual(matchPublicShareRoute("/sms-opt-in/demo"), {
    kind: "sms-opt-in",
    canonicalPath: "/sms-opt-in/demo",
    hashTarget: "/sms-opt-in/demo",
    param: "demo",
  });

  assert.deepEqual(matchPublicShareRoute("/sms-opt-in/church-public-id"), {
    kind: "sms-opt-in",
    canonicalPath: "/sms-opt-in/church-public-id",
    hashTarget: "/sms-opt-in/church-public-id",
    param: "church-public-id",
  });

  assert.deepEqual(matchPublicShareRoute("/services/share-token"), {
    kind: "service",
    canonicalPath: "/services/share-token",
    hashTarget: "/#/services/share-token",
    param: "share-token",
  });

  assert.deepEqual(
    matchPublicShareRoute("/schedule-response/tok", "?respond=accept"),
    {
      kind: "schedule-response",
      canonicalPath: "/schedule-response/tok",
      hashTarget: "/#/schedule-response/tok?respond=accept",
      param: "tok",
    },
  );

  assert.deepEqual(matchPublicShareRoute("/teams/schedule/sched-tok"), {
    kind: "team-schedule",
    canonicalPath: "/teams/schedule/sched-tok",
    hashTarget: "/#/teams/schedule/sched-tok",
    param: "sched-tok",
  });

  assert.deepEqual(matchPublicShareRoute("/a/private-recipient-token"), {
    kind: "team-intake-recipient",
    canonicalPath: "/a/private-recipient-token",
    hashTarget: "/#/a/private-recipient-token",
    param: "private-recipient-token",
  });

  assert.deepEqual(matchPublicShareRoute("/teams/intake/form-tok"), {
    kind: "team-intake",
    canonicalPath: "/teams/intake/form-tok",
    hashTarget: "/#/teams/intake/form-tok",
    param: "form-tok",
  });
  assert.deepEqual(matchPublicShareRoute("/teams/intake"), {
    kind: "team-intake",
    canonicalPath: "/teams/intake",
    hashTarget: "/#/teams/intake",
  });

  assert.deepEqual(matchPublicShareRoute("/boards/sunday"), {
    kind: "board",
    canonicalPath: "/boards/sunday",
    hashTarget: "/#/boards/sunday",
    param: "sunday",
  });

  assert.deepEqual(matchPublicShareRoute("/boards/present/sunday"), {
    kind: "board-present",
    canonicalPath: "/boards/present/sunday",
    hashTarget: "/#/boards/present/sunday",
    param: "sunday",
  });
});

test("matchPublicShareRoute ignores reserved board operator paths", () => {
  assert.equal(matchPublicShareRoute("/boards/controller"), null);
  assert.equal(matchPublicShareRoute("/boards/display"), null);
  assert.equal(matchPublicShareRoute("/home"), null);
  assert.equal(matchPublicShareRoute("/a"), null);
  assert.equal(matchPublicShareRoute("/a/token/extra"), null);
  assert.equal(matchPublicShareRoute("/teams/intake/token/extra"), null);
});

test("SMS opt-in route matching stays aligned between server and client", () => {
  for (const pathname of [
    "/sms-opt-in",
    "/sms-opt-in/demo",
    "/sms-opt-in/church-public-id",
  ]) {
    assert.ok(matchPublicShareRoute(pathname));
    assert.equal(isPublicSharePathname(pathname), true);
  }

  assert.equal(matchPublicShareRoute("/sms-opt-in/demo/extra"), null);
  assert.equal(isPublicSharePathname("/sms-opt-in/demo/extra"), false);
});

test("recipient intake links choose the public shell and expose generic crawler metadata", () => {
  const token = "private-recipient-token";
  const route = matchPublicShareRoute(`/a/${token}`);
  assert.equal(isPublicSharePathname(`/a/${token}`), true);
  assert.equal(route?.kind, "team-intake-recipient");
  const meta = resolvePublicShareMeta("team-intake-recipient");
  assert.equal(meta.title, "Availability request | WorshipSync");
  assert.doesNotMatch(meta.description, new RegExp(token));
  assert.doesNotMatch(meta.description, /recipient|Kevin|Cheddar/i);
});

test("resolvePublicShareMeta uses route defaults and allows overrides", () => {
  assert.deepEqual(resolvePublicShareMeta("sms-opt-in"), {
    title: "SMS messaging | WorshipSync",
    description: "Learn about SMS messaging and choose whether to opt in.",
  });
  assert.deepEqual(resolvePublicShareMeta("service"), {
    title: "Service plan | WorshipSync",
    description: "Open this shared service plan.",
  });
  assert.deepEqual(
    resolvePublicShareMeta("board", {
      title: "Sunday Q&A | WorshipSync",
      description: "Join the conversation on Sunday Q&A.",
    }),
    {
      title: "Sunday Q&A | WorshipSync",
      description: "Join the conversation on Sunday Q&A.",
    },
  );
});

test("renderPublicShareHtml escapes content for crawlers without a hash redirect", () => {
  const html = renderPublicShareHtml({
    title: 'Service "Alpha" | WorshipSync',
    description: "Open <this> plan & serve.",
    canonicalUrl: "https://www.worshipsync.net/services/tok",
    imageUrl: "https://www.worshipsync.net/logo-wide-container.png",
  });

  assert.match(
    html,
    /property="og:title" content="Service &quot;Alpha&quot; \| WorshipSync"/,
  );
  assert.match(
    html,
    /property="og:description" content="Open &lt;this&gt; plan &amp; serve."/,
  );
  assert.match(
    html,
    /property="og:image" content="https:\/\/www\.worshipsync\.net\/logo-wide-container\.png"/,
  );
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(
    html,
    /property="og:url" content="https:\/\/www\.worshipsync\.net\/services\/tok"/,
  );
  assert.match(
    html,
    /href="https:\/\/www\.worshipsync\.net\/services\/tok">Open in WorshipSync/,
  );
  assert.equal(html.includes("location.replace"), false);
  assert.equal(html.includes('http-equiv="refresh"'), false);
});

test("isLinkPreviewCrawler recognizes common preview bots", () => {
  assert.equal(isLinkPreviewCrawler("facebookexternalhit/1.1"), true);
  assert.equal(isLinkPreviewCrawler("WhatsApp/2.0"), true);
  assert.equal(
    isLinkPreviewCrawler(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0",
    ),
    false,
  );
});

test("buildPublicShareImageUrl joins the app origin and wide OG asset", () => {
  assert.equal(
    buildPublicShareImageUrl("https://www.worshipsync.net/"),
    "https://www.worshipsync.net/logo-wide-container.png",
  );
});
