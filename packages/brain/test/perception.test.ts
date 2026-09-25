import { describe, expect, it } from "vitest";
import { decodeEmbedding, encodeEmbedding, FACE_EMBEDDING_LENGTH, isWaarneming } from "../src/perception.js";

const validEmbedding = () => new Float32Array(FACE_EMBEDDING_LENGTH).fill(0.5);

describe("isWaarneming", () => {
  it("accepteert aanwezig", () => {
    expect(isWaarneming({ soort: "aanwezig" })).toBe(true);
  });

  it("accepteert afwezig", () => {
    expect(isWaarneming({ soort: "afwezig" })).toBe(true);
  });

  it("accepteert nieuw-object met een geldig COCO-label", () => {
    expect(isWaarneming({ soort: "nieuw-object", object: "cat" })).toBe(true);
    expect(isWaarneming({ soort: "nieuw-object", object: "potted plant" })).toBe(true);
  });

  it("verwerpt nieuw-object met een ongeldig label", () => {
    expect(isWaarneming({ soort: "nieuw-object", object: "Cat" })).toBe(false);
    expect(isWaarneming({ soort: "nieuw-object", object: "cat123" })).toBe(false);
    expect(isWaarneming({ soort: "nieuw-object", object: "" })).toBe(false);
    expect(isWaarneming({ soort: "nieuw-object", object: 1 })).toBe(false);
    expect(isWaarneming({ soort: "nieuw-object" })).toBe(false);
  });

  it("verwerpt onbekende vormen", () => {
    expect(isWaarneming(null)).toBe(false);
    expect(isWaarneming(undefined)).toBe(false);
    expect(isWaarneming("aanwezig")).toBe(false);
    expect(isWaarneming({ soort: "onbekend" })).toBe(false);
  });

  it("accepteert gezicht met een geldige embedding en aantal", () => {
    expect(isWaarneming({ soort: "gezicht", embedding: encodeEmbedding(validEmbedding()), aantal: 1 })).toBe(true);
  });

  it("verwerpt gezicht met een embedding die niet naar 1024 floats decodeert", () => {
    const kort = encodeEmbedding(new Float32Array(10).fill(0.5));
    expect(isWaarneming({ soort: "gezicht", embedding: kort, aantal: 1 })).toBe(false);
  });

  it("verwerpt gezicht met ongeldige base64", () => {
    expect(isWaarneming({ soort: "gezicht", embedding: "niet-base64!!", aantal: 1 })).toBe(false);
  });

  it("verwerpt gezicht met niet-eindige waarden", () => {
    const embedding = validEmbedding();
    embedding[0] = Number.POSITIVE_INFINITY;
    expect(isWaarneming({ soort: "gezicht", embedding: encodeEmbedding(embedding), aantal: 1 })).toBe(false);
  });

  it("verwerpt gezicht met een embedding-string die niet exact de verwachte base64-lengte heeft (vóór atob)", () => {
    const valid = encodeEmbedding(validEmbedding());
    expect(isWaarneming({ soort: "gezicht", embedding: valid.slice(0, valid.length - 4), aantal: 1 })).toBe(false);
    expect(isWaarneming({ soort: "gezicht", embedding: `${valid}AAAA`, aantal: 1 })).toBe(false);
  });

  it("verwerpt gezicht met aantal buiten 1–10 of niet-geheel", () => {
    const embedding = encodeEmbedding(validEmbedding());
    expect(isWaarneming({ soort: "gezicht", embedding, aantal: 0 })).toBe(false);
    expect(isWaarneming({ soort: "gezicht", embedding, aantal: 11 })).toBe(false);
    expect(isWaarneming({ soort: "gezicht", embedding, aantal: 1.5 })).toBe(false);
  });
});

describe("encodeEmbedding / decodeEmbedding", () => {
  it("codeert en decodeert een embedding rondtrip-gelijk", () => {
    const embedding = new Float32Array(FACE_EMBEDDING_LENGTH).map((_, i) => (i - 512) / 100);
    const decoded = decodeEmbedding(encodeEmbedding(embedding));
    expect(decoded).not.toBeNull();
    expect(decoded).toHaveLength(FACE_EMBEDDING_LENGTH);
    for (let i = 0; i < FACE_EMBEDDING_LENGTH; i++) expect(decoded![i]).toBeCloseTo(embedding[i]!, 5);
  });

  it("geeft null bij ongeldige base64", () => {
    expect(decodeEmbedding("!!!niet-geldig!!!")).toBeNull();
  });

  it("geeft null bij een lengte die geen veelvoud van 4 bytes is", () => {
    expect(decodeEmbedding(btoa("abc"))).toBeNull();
  });
});
