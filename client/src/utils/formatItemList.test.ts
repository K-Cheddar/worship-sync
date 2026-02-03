import { formatItemList } from "./formatItemList";
import { createServiceItem } from "../test/fixtures";
import type { Cloudinary } from "@cloudinary/url-gen";

describe("formatItemList", () => {
  const mockToURL = jest.fn(() => "https://cloudinary.com/image.jpg");
  const mockImage = jest.fn(() => ({ toURL: mockToURL }));
  const mockCloud = { image: mockImage } as unknown as Cloudinary;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns items with http background unchanged", () => {
    const item = createServiceItem({
      name: "Item",
      _id: "1",
      background: "https://example.com/bg.jpg",
    });
    const result = formatItemList([item], mockCloud);
    expect(result).toHaveLength(1);
    expect(result[0].background).toBe("https://example.com/bg.jpg");
    expect(mockImage).not.toHaveBeenCalled();
  });

  it("converts non-http background via cloud.image().toURL()", () => {
    const item = createServiceItem({
      name: "Item",
      _id: "1",
      background: "folder/image_id",
    });
    const result = formatItemList([item], mockCloud);
    expect(result).toHaveLength(1);
    expect(mockImage).toHaveBeenCalledWith("folder/image_id");
    expect(mockToURL).toHaveBeenCalled();
    expect(result[0].background).toBe("https://cloudinary.com/image.jpg");
  });

  it("preserves other item fields", () => {
    const item = createServiceItem({
      name: "Song",
      _id: "id-1",
      type: "song",
      background: "bg",
    });
    const result = formatItemList([item], mockCloud);
    expect(result[0].name).toBe("Song");
    expect(result[0]._id).toBe("id-1");
    expect(result[0].type).toBe("song");
  });

  it("maps over multiple items", () => {
    const items = [
      createServiceItem({ name: "A", _id: "1", background: "a" }),
      createServiceItem({ name: "B", _id: "2", background: "https://b" }),
    ];
    const result = formatItemList(items, mockCloud);
    expect(result).toHaveLength(2);
    expect(result[0].background).toBe("https://cloudinary.com/image.jpg");
    expect(result[1].background).toBe("https://b");
  });
});
