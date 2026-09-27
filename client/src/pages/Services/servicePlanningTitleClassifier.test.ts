import { classifyServicePlanningTitle } from "./servicePlanningTitleClassifier";

describe("classifyServicePlanningTitle", () => {
  it("keeps an explicitly marked song title out of name extraction", () => {
    const result = classifyServicePlanningTitle({
      title: "There's a Welcome Here (C)",
      songTitle: "There's a Welcome Here (C)",
      ledBy: "Jasmine Williams",
    });
    expect(result.suggestedAssignees).toEqual([]);
    expect(result.content).toBe("There's a Welcome Here (C)");
  });

  it("still extracts a Note link from a marked song without reading its title as a person", () => {
    const result = classifyServicePlanningTitle({
      title: "There's a Welcome Here (C)",
      songTitle: "There's a Welcome Here (C)",
      note: "Reference track: https://youtu.be/abc?t=30",
    });
    expect(result.suggestedAssignees).toEqual([]);
    expect(result.urls).toEqual(["https://youtu.be/abc?t=30"]);
    expect(result.reasons).toEqual([]);
    expect(result.parts[0]).toMatchObject({ kind: "url", sourceField: "note" });
  });

  it("extracts a Bible reference and a known person independently", () => {
    const result = classifyServicePlanningTitle({
      title: "Psalms 97 (NLT) Jasmine Williams",
      knownPeople: ["Jasmine Williams"],
    });
    expect(result.scripture).toMatchObject({ book: "Psalms", chapter: "97", version: "NLT" });
    expect(result.suggestedAssignees).toEqual(["Jasmine Williams"]);
    expect(result.reasons).toEqual([]);
  });

  it("keeps an unfamiliar name-like suffix reviewable rather than deciding it is a person", () => {
    const result = classifyServicePlanningTitle({ title: "Psalms 97 (NLT) Jasmine Williams" });
    expect(result.scripture?.book).toBe("Psalms");
    expect(result.suggestedAssignees).toEqual(["Jasmine Williams"]);
    expect(result.reasons).toContain("The title resembles a list of names, but not every name matches a known person.");
  });

  it("recognizes a scripture reference inside a descriptive title", () => {
    const result = classifyServicePlanningTitle({ title: "Reading the Word — Psalm 98 NIV" });
    expect(result.scripture).toMatchObject({ book: "Psalms", chapter: "98", version: "NIV" });
    expect(result.content).toBe("Reading the Word");
  });

  it("extracts and deduplicates links from Title and Note while keeping query parameters", () => {
    const result = classifyServicePlanningTitle({
      title: "Pathfinder welcome video — Florida Conference https://dropbox.com/s/abc?dl=0&token=x",
      note: "Reference: https://DROPBOX.com/s/abc?dl=0&token=x",
    });
    expect(result.urls).toEqual(["https://dropbox.com/s/abc?dl=0&token=x"]);
    expect(result.content).toContain("Florida Conference");
    expect(result.reasons).toEqual([]);
  });

  it("keeps conference and skit descriptions while deduplicating Dropbox and YouTube URLs", () => {
    const dropbox = classifyServicePlanningTitle({
      title: "Pathfinder Welcome Video — Florida Conference",
      note: "Dropbox: https://www.dropbox.com/s/abc?dl=0",
    });
    expect(dropbox.content).toContain("Florida Conference");
    expect(dropbox.urls).toEqual(["https://www.dropbox.com/s/abc?dl=0"]);

    const youtube = classifyServicePlanningTitle({
      title: "Skit/Mime – Walking With Jesus https://youtube.com/watch?v=abc&t=40",
      note: "https://youtube.com/watch?v=abc&t=40",
    });
    expect(youtube.urls).toEqual(["https://youtube.com/watch?v=abc&t=40"]);
    expect(youtube.content).toContain("Walking With Jesus");
    expect(youtube.suggestedAssignees).toEqual([]);
  });

  it("splits names with roles and common separators, removing repeated names", () => {
    const result = classifyServicePlanningTitle({
      title: "Co-Hosts – Oniel Campbell; Jackie Mullings & Candice Bailey, Oniel Campbell",
    });
    expect(result.suggestedAssignees).toEqual(["Oniel Campbell", "Jackie Mullings", "Candice Bailey"]);
    expect(result.parts.find((part) => part.kind === "description")?.value).toBe("Co-Hosts");
    expect(result.reasons).toContain("The title resembles a list of names, but not every name matches a known person.");
  });

  it("extracts a known person after descriptive text but keeps group names as content", () => {
    const person = classifyServicePlanningTitle({
      title: "Behind the Pulpit — Chadwick Anderson",
      knownPeople: ["Chadwick Anderson"],
    });
    expect(person.suggestedAssignees).toEqual(["Chadwick Anderson"]);
    expect(person.parts).toContainEqual(expect.objectContaining({ kind: "description", value: "Behind the Pulpit", destination: "content" }));
    const group = classifyServicePlanningTitle({ title: "Pathfinder Welcome Video — Florida Conference" });
    expect(group.suggestedAssignees).toEqual([]);
    expect(group.content).toBe("Pathfinder Welcome Video — Florida Conference");
  });

  it("retains unknown descriptive text and malformed URL-like values for review", () => {
    const empty = classifyServicePlanningTitle({ title: "" });
    const malformed = classifyServicePlanningTitle({ title: "Special feature https:// bad link" });
    expect(empty.parts).toEqual([]);
    expect(malformed.content).toContain("Special feature");
    expect(malformed.reasons).toContain("A link-like value could not be validated.");
    expect(classifyServicePlanningTitle({ title: "Unknown free-text Title" }).reasons.length).toBeGreaterThan(0);
  });

  it("extracts a valid standalone YouTube link without classifying it as ambiguous", () => {
    const result = classifyServicePlanningTitle({
      title: "https://youtube.com/watch?v=abc&t=45",
    });
    expect(result.urls).toEqual(["https://youtube.com/watch?v=abc&t=45"]);
    expect(result.reasons).toEqual([]);
  });

  it("keeps a malformed link reviewable even beside a valid link", () => {
    const result = classifyServicePlanningTitle({
      title: "https://youtu.be/abc https:// bad",
    });
    expect(result.urls).toEqual(["https://youtu.be/abc"]);
    expect(result.reasons).toContain("A link-like value could not be validated.");
  });

  it("keeps malformed links on marked songs reviewable", () => {
    const result = classifyServicePlanningTitle({
      title: "There's a Welcome Here",
      songTitle: "There's a Welcome Here",
      note: "Reference track: https:// bad",
    });
    expect(result.reasons).toContain("A link-like value could not be validated.");
  });

  it("does not infer a song when an unmarked title merely resembles a song name", () => {
    const result = classifyServicePlanningTitle({ title: "There's a Welcome Here" });
    expect(result.suggestedAssignees).toEqual([]);
    expect(result.content).toBe("There's a Welcome Here");
  });
});
