import { buildMediaActionRouteFlags } from "./mediaLibraryActions";

it.each(["/controller", "/controller/", "/aux-controller/lobby"])("offers item slide actions at workspace %s", (path) => {
  expect(buildMediaActionRouteFlags(path, "default", null, null, null).itemSlides).toBe(true);
});
it.each(["/controller/songs", "/controller/bible", "/controller/timers", "/aux-controller/lobby/free", "/controller/item/old/link"])("keeps item actions out of section/legacy route %s", (path) => {
  expect(buildMediaActionRouteFlags(path, "default", null, null, null).itemSlides).toBe(false);
});
