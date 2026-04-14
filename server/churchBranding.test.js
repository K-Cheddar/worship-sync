import test from "node:test";
import assert from "node:assert/strict";
import {
  createEmptyChurchBranding,
  getChurchBrandingPath,
  normalizeChurchBrandingForStorage,
  pickPublicBoardHeaderLogoUrl,
} from "./churchBranding.js";

test("createEmptyChurchBranding returns empty branding defaults", () => {
  assert.deepEqual(createEmptyChurchBranding(), {
    mission: "",
    vision: "",
    logos: {
      square: null,
      wide: null,
    },
    colors: [],
  });
});

test("normalizeChurchBrandingForStorage trims and preserves valid branding", () => {
  assert.deepEqual(
    normalizeChurchBrandingForStorage({
      mission: "  To serve well.  ",
      vision: "  To lead clearly. ",
      logos: {
        square: {
          url: "https://res.cloudinary.com/portable-media/image/upload/v1/branding/logo-square.png",
          publicId: "branding/logo-square",
          width: 600,
          height: 600,
          format: "png",
        },
        wide: null,
      },
      colors: [
        { label: "Primary", value: "#112233" },
        { label: "Accent", value: "#AABBCCDD" },
      ],
    }),
    {
      mission: "To serve well.",
      vision: "To lead clearly.",
      logos: {
        square: {
          url: "https://res.cloudinary.com/portable-media/image/upload/v1/branding/logo-square.png",
          publicId: "branding/logo-square",
          width: 600,
          height: 600,
          format: "png",
        },
        wide: null,
      },
      colors: [
        { label: "Primary", value: "#112233" },
        { label: "Accent", value: "#AABBCCDD" },
      ],
    },
  );
});

test("normalizeChurchBrandingForStorage rejects duplicate labels after trimming", () => {
  assert.throws(
    () =>
      normalizeChurchBrandingForStorage({
        colors: [
          { label: " Primary ", value: "#112233" },
          { label: "primary", value: "#445566" },
        ],
      }),
    /Brand color labels must be unique/,
  );
});

test("normalizeChurchBrandingForStorage rejects more than six colors", () => {
  assert.throws(
    () =>
      normalizeChurchBrandingForStorage({
        colors: [
          { value: "#000001" },
          { value: "#000002" },
          { value: "#000003" },
          { value: "#000004" },
          { value: "#000005" },
          { value: "#000006" },
          { value: "#000007" },
        ],
      }),
    /up to 6 brand colors/,
  );
});

test("normalizeChurchBrandingForStorage rejects invalid color values", () => {
  assert.throws(
    () =>
      normalizeChurchBrandingForStorage({
        colors: [{ value: "blue" }],
      }),
    /#RRGGBB or #RRGGBBAA/,
  );
});

test("normalizeChurchBrandingForStorage rejects non-cloudinary logos", () => {
  assert.throws(
    () =>
      normalizeChurchBrandingForStorage({
        logos: {
          square: {
            url: "https://example.com/logo.svg",
            publicId: "branding/logo-square",
            format: "svg",
          },
        },
      }),
    /Cloudinary URL/,
  );
});

test("normalizeChurchBrandingForStorage derives publicId from the Cloudinary URL", () => {
  assert.deepEqual(
    normalizeChurchBrandingForStorage({
      logos: {
        square: {
          url: "https://res.cloudinary.com/portable-media/image/upload/c_scale,w_200/v123/branding/logo-square.png",
          publicId: "branding/not-the-real-id",
          format: "png",
        },
      },
    }).logos.square,
    {
      url: "https://res.cloudinary.com/portable-media/image/upload/c_scale,w_200/v123/branding/logo-square.png",
      publicId: "branding/logo-square",
      format: "png",
    },
  );
});

test("normalizeChurchBrandingForStorage rejects cloudinary substring hostnames", () => {
  assert.throws(
    () =>
      normalizeChurchBrandingForStorage({
        logos: {
          square: {
            url: "https://cloudinary.com.evil.example/logo.svg",
            publicId: "branding/logo-square",
            format: "svg",
          },
        },
      }),
    /Cloudinary URL/,
  );
});

test("normalizeChurchBrandingForStorage rejects Cloudinary URLs without an asset path", () => {
  assert.throws(
    () =>
      normalizeChurchBrandingForStorage({
        logos: {
          square: {
            url: "https://res.cloudinary.com/portable-media/image/upload/",
            publicId: "branding/logo-square",
            format: "png",
          },
        },
      }),
    /valid Cloudinary asset path/,
  );
});

test("getChurchBrandingPath returns the shared branding RTDB path", () => {
  assert.equal(
    getChurchBrandingPath("church-42"),
    "churches/church-42/data/branding",
  );
});

test("pickPublicBoardHeaderLogoUrl prefers square over wide", () => {
  const square =
    "https://res.cloudinary.com/portable-media/image/upload/v1/branding/sq.png";
  const wide =
    "https://res.cloudinary.com/portable-media/image/upload/v1/branding/wide.png";
  assert.equal(
    pickPublicBoardHeaderLogoUrl({
      logos: {
        square: { url: square },
        wide: { url: wide },
      },
    }),
    square,
  );
});

test("pickPublicBoardHeaderLogoUrl falls back to wide", () => {
  const wide =
    "https://res.cloudinary.com/portable-media/image/upload/v1/branding/wide.png";
  assert.equal(
    pickPublicBoardHeaderLogoUrl({
      logos: { square: null, wide: { url: wide } },
    }),
    wide,
  );
});

test("pickPublicBoardHeaderLogoUrl rejects non-Cloudinary URLs", () => {
  assert.equal(
    pickPublicBoardHeaderLogoUrl({
      logos: {
        square: { url: "https://evil.example/x.png" },
      },
    }),
    "",
  );
});
