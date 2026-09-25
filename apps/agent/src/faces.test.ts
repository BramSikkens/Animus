import { describe, expect, it } from "vitest";
import { createFaces, parseFaceMatchDistance } from "./faces.js";

describe("createFaces: inView / present", () => {
  it("geeft [] zonder enige Waarneming", () => {
    const faces = createFaces();
    expect(faces.inView(0)).toEqual([]);
    expect(faces.present(0)).toEqual([]);
  });

  it("geeft de Persoon van een enkel bekend gezicht", () => {
    const faces = createFaces();
    faces.record(7, 0, 1);
    expect(faces.inView(100)).toEqual([7]);
    expect(faces.present(100)).toEqual([7]);
  });

  it("geeft null voor een onbekend gezicht", () => {
    const faces = createFaces();
    faces.record(null, 0, 1);
    expect(faces.inView(100)).toEqual([null]);
    expect(faces.present(100)).toEqual([]);
  });

  it("hoogstens `aantal` van de laatste batch, nieuwste eerst", () => {
    const faces = createFaces();
    faces.record(1, 1000, 2);
    faces.record(2, 1000, 2);
    expect(faces.inView(1100)).toEqual([2, 1]);
  });

  it("verwaarloost Waarnemingen ouder dan 7s", () => {
    const faces = createFaces();
    faces.record(7, 0, 1);
    expect(faces.inView(6999)).toEqual([7]);
    expect(faces.inView(7000)).toEqual([]);
  });

  it("present() geeft unieke, bekende Personen (dubbels genegeerd)", () => {
    const faces = createFaces();
    faces.record(7, 0, 1);
    faces.record(7, 3000, 1);
    expect(faces.present(3100)).toEqual([7]);
  });

  it("reset() wist de gezichten", () => {
    const faces = createFaces();
    faces.record(7, 0, 1);
    faces.reset();
    expect(faces.inView(0)).toEqual([]);
  });
});

describe("createFaces: unknownStableSince", () => {
  it("false zolang er nog geen onbekende Waarneming was", () => {
    const faces = createFaces();
    expect(faces.unknownStableSince(0)).toBe(false);
  });

  it("false vóór 5s onafgebroken onbekend", () => {
    const faces = createFaces();
    faces.record(null, 0, 1);
    expect(faces.unknownStableSince(4999)).toBe(false);
  });

  it("true zodra 5s onafgebroken onbekend is verstreken, eenmalig per reeks", () => {
    const faces = createFaces();
    faces.record(null, 0, 1);
    expect(faces.unknownStableSince(5000)).toBe(true);
    expect(faces.unknownStableSince(5000)).toBe(false);
    expect(faces.unknownStableSince(9000)).toBe(false);
  });

  it("een bekende Persoon ernaast onderbreekt de onbekende-reeks niet (hoofdscenario: eigenaar + bezoeker)", () => {
    const faces = createFaces();
    faces.record(null, 0, 1); // bezoeker, onbekend
    faces.record(7, 0, 2); // eigenaar, zelfde ronde
    faces.record(7, 3000, 2); // eigenaar blijft in beeld
    faces.record(null, 3000, 2); // bezoeker nog steeds onbekend, samen met de eigenaar
    expect(faces.unknownStableSince(4999)).toBe(false); // nog geen 5s sinds de eerste onbekende (t=0)
    expect(faces.unknownStableSince(5000)).toBe(true);
  });

  it("enkel bekende gezichten: nooit stabiel onbekend", () => {
    const faces = createFaces();
    faces.record(7, 0, 1);
    faces.record(7, 5000, 1);
    expect(faces.unknownStableSince(10000)).toBe(false);
  });

  it("onbekend kort weg (< 7s zonder enige onbekende Waarneming) breekt de periode niet", () => {
    const faces = createFaces();
    faces.record(null, 0, 1); // onbekend gezien
    faces.record(null, 4000, 1); // 4s later weer onbekend gezien (< 7s gat): dezelfde reeks, geen herstart
    expect(faces.unknownStableSince(4999)).toBe(false); // nog geen 5s sinds de oorspronkelijke start (t=0)
    expect(faces.unknownStableSince(5000)).toBe(true); // 5s sinds t=0, niet pas sinds t=4000
  });

  it("een gat van ≥ 7s zonder enige onbekende Waarneming laat de reeks verlopen: een latere onbekende start opnieuw", () => {
    const faces = createFaces();
    faces.record(null, 0, 1);
    expect(faces.unknownStableSince(5000)).toBe(true);
    expect(faces.unknownStableSince(12001)).toBe(false); // reeks al > 7s geleden verlopen, geen nieuwe Waarneming nodig
    faces.record(null, 12100, 1); // nieuwe reeks
    expect(faces.unknownStableSince(17099)).toBe(false);
    expect(faces.unknownStableSince(17100)).toBe(true);
  });

  it("reset() wist de onbekende-reeks", () => {
    const faces = createFaces();
    faces.record(null, 0, 1);
    faces.reset();
    expect(faces.unknownStableSince(5000)).toBe(false);
  });
});

describe("parseFaceMatchDistance", () => {
  it("valt zonder waarde terug op de default van 10", () => {
    expect(parseFaceMatchDistance(undefined)).toEqual({ distance: 10 });
  });

  it("parseert een geldige waarde", () => {
    expect(parseFaceMatchDistance("8")).toEqual({ distance: 8 });
  });

  it("waarschuwt en valt terug bij een ongeldige waarde", () => {
    const result = parseFaceMatchDistance("nope");
    expect(result.distance).toBe(10);
    expect(result.warning).toContain("nope");
  });

  it("waarschuwt en valt terug bij een niet-positieve waarde", () => {
    const result = parseFaceMatchDistance("0");
    expect(result.distance).toBe(10);
    expect(result.warning).toContain("0");
  });
});
