import { describe, expect, it } from "vitest";
import { overlayBoxes } from "./overlay.js";

describe("overlayBoxes", () => {
  it("schaalt van videopixels naar canvaspixels", () => {
    const boxes = overlayBoxes({
      faces: [{ originX: 100, originY: 50, width: 40, height: 60 }],
      objects: [],
      video: { w: 640, h: 480 },
      canvas: { w: 320, h: 240 },
      mirror: false,
    });
    expect(boxes).toEqual([{ x: 50, y: 25, w: 20, h: 30, kind: "gezicht" }]);
  });

  it("spiegelt horizontaal: x' = canvas.w - (x+w)·schaal", () => {
    const boxes = overlayBoxes({
      faces: [{ originX: 100, originY: 50, width: 40, height: 60 }],
      objects: [],
      video: { w: 640, h: 480 },
      canvas: { w: 320, h: 240 },
      mirror: true,
    });
    // (100+40)*0.5 = 70, canvas.w (320) - 70 = 250
    expect(boxes[0]).toMatchObject({ x: 250, y: 25, w: 20, h: 30 });
  });

  it("laat person weg (het gezichtskader dekt dat al)", () => {
    const boxes = overlayBoxes({
      faces: [],
      objects: [
        { box: { originX: 0, originY: 0, width: 10, height: 10 }, name: "person", score: 0.9 },
        { box: { originX: 0, originY: 0, width: 10, height: 10 }, name: "cat", score: 0.8 },
      ],
      video: { w: 100, h: 100 },
      canvas: { w: 100, h: 100 },
      mirror: false,
    });
    expect(boxes).toHaveLength(1);
    expect(boxes[0]?.label).toContain("cat");
  });

  it("formatteert het objectlabel als '<naam> <score met 2 decimalen>'", () => {
    const boxes = overlayBoxes({
      faces: [],
      objects: [{ box: { originX: 0, originY: 0, width: 10, height: 10 }, name: "cat", score: 0.876 }],
      video: { w: 100, h: 100 },
      canvas: { w: 100, h: 100 },
      mirror: false,
    });
    expect(boxes[0]?.label).toBe("cat 0.88");
    expect(boxes[0]?.kind).toBe("object");
  });

  it("gezichtskaders krijgen geen label", () => {
    const boxes = overlayBoxes({
      faces: [{ originX: 0, originY: 0, width: 10, height: 10 }],
      objects: [],
      video: { w: 100, h: 100 },
      canvas: { w: 100, h: 100 },
      mirror: false,
    });
    expect(boxes[0]?.label).toBeUndefined();
  });
});
