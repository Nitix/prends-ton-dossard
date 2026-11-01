import { describe, expect, test } from "vitest";

import { GpxError, gpxStats, parseGpx } from "./gpx";

// Reading a file needs the DOMParser of a browser: these run in the browser
// project, with the other tests of the pages. The arithmetic on the points is in
// gpx.test.ts, which a plain Node runs.

const NAMESPACE = "http://www.topografix.com/GPX/1/1";

/** A GPX 1.1 file, as the server's tests and most apps write it: one track, one segment. */
function gpx(points: string, namespace = ` xmlns="${NAMESPACE}"`): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="tests"${namespace}>
  <trk><name>Trace</name><trkseg>${points}</trkseg></trk>
</gpx>`;
}

describe("parseGpx", () => {
  test("parseGpx — trkpt avec altitude et km cumulés", () => {
    const xml = gpx(`
      <trkpt lat="45.000000" lon="6.000000"><ele>450.5</ele></trkpt>
      <trkpt lat="45.010000" lon="6.000000"><ele>480</ele></trkpt>
      <trkpt lat="45.020000" lon="6.000000"><ele>470.25</ele></trkpt>`);

    const points = parseGpx(xml);

    expect(points).toHaveLength(3);
    expect(points[0]).toEqual({ lat: 45, lon: 6, ele: 450.5, km: 0 });
    expect(points[1]).toMatchObject({ lat: 45.01, lon: 6, ele: 480 });
    expect(points[2]).toMatchObject({ lat: 45.02, lon: 6, ele: 470.25 });
    // 0.01° of latitude is 1.11195 km, on a sphere of 6 371 km.
    expect(points[1]?.km).toBeCloseTo(1.11195, 4);
    expect(points[2]?.km).toBeCloseTo(2.2239, 3);
    expect(gpxStats(points)).toMatchObject({ gain: 29.5, loss: 9.75, min: 450.5, max: 480 });
  });

  test("parseGpx — sans l'espace de noms de GPX, ou avec un préfixe", () => {
    const point = '<trkpt lat="45" lon="6"><ele>10</ele></trkpt>';
    expect(parseGpx(gpx(point, ""))).toHaveLength(1);
    const prefixed = `<g:gpx xmlns:g="${NAMESPACE}"><g:trk><g:trkseg><g:trkpt lat="45" lon="6"><g:ele>10</g:ele></g:trkpt></g:trkseg></g:trk></g:gpx>`;
    expect(parseGpx(prefixed)).toEqual([{ lat: 45, lon: 6, ele: 10, km: 0 }]);
  });

  test("parseGpx — plusieurs segments se suivent", () => {
    const xml = `<gpx xmlns="${NAMESPACE}"><trk>
      <trkseg><trkpt lat="45" lon="6"/><trkpt lat="45.01" lon="6"/></trkseg>
      <trkseg><trkpt lat="45.02" lon="6"/></trkseg>
    </trk></gpx>`;
    const points = parseGpx(xml);
    expect(points.map((p) => p.lat)).toEqual([45, 45.01, 45.02]);
    expect(points[2]?.km).toBeCloseTo(2.2239, 3);
  });

  test("parseGpx — rtept", () => {
    const xml = `<gpx version="1.1" xmlns="${NAMESPACE}">
      <rte><name>Itinéraire</name>
        <rtept lat="46.5" lon="7.25"><ele>1200</ele></rtept>
        <rtept lat="46.51" lon="7.26"/>
      </rte></gpx>`;

    const points = parseGpx(xml);

    expect(points).toHaveLength(2);
    expect(points[0]).toEqual({ lat: 46.5, lon: 7.25, ele: 1200, km: 0 });
    expect(points[1]?.ele).toBeUndefined();
    expect(points[1]?.km).toBeGreaterThan(1);
  });

  test("parseGpx — la trace passe avant l'itinéraire, les points de passage ne comptent pas", () => {
    const xml = `<gpx xmlns="${NAMESPACE}">
      <wpt lat="10" lon="10"/>
      <rte><rtept lat="20" lon="20"/><rtept lat="21" lon="21"/></rte>
      <trk><trkseg><trkpt lat="45" lon="6"/></trkseg></trk>
    </gpx>`;
    expect(parseGpx(xml).map((p) => p.lat)).toEqual([45]);
  });

  test("parseGpx — sans altitude", () => {
    const xml = gpx(`
      <trkpt lat="45.00" lon="6.00"></trkpt>
      <trkpt lat="45.01" lon="6.00"/>
      <trkpt lat="45.02" lon="6.00"><ele></ele></trkpt>
      <trkpt lat="45.03" lon="6.00"><ele>pas un nombre</ele></trkpt>`);

    const points = parseGpx(xml);

    expect(points).toHaveLength(4);
    for (const point of points) {
      expect(point.ele).toBeUndefined();
      expect("ele" in point).toBe(false);
    }
    const stats = gpxStats(points);
    expect(stats.km).toBeCloseTo(3.3358, 3);
    expect(stats).toMatchObject({ gain: 0, loss: 0 });
    expect(stats.min).toBeUndefined();
    expect(stats.max).toBeUndefined();
  });

  test("parseGpx — un point sans position utilisable est laissé de côté", () => {
    const xml = gpx(`
      <trkpt lat="45" lon="6"/>
      <trkpt lat="abc" lon="6"/>
      <trkpt lon="6"/>
      <trkpt lat="95" lon="6"/>
      <trkpt lat="45" lon="200"/>
      <trkpt lat="" lon="6"/>
      <trkpt lat="45.01" lon="6"/>`);
    expect(parseGpx(xml).map((p) => p.lat)).toEqual([45, 45.01]);
  });

  test("parseGpx — fichier invalide lève GpxError", () => {
    const invalid = [
      "",
      "   ",
      "pas du XML",
      "<gpx><trk><trkseg><trkpt lat=",
      // XML, but broken: a closing tag is missing.
      `<gpx xmlns="${NAMESPACE}"><trk><trkseg><trkpt lat="45" lon="6"></trkseg></trk></gpx>`,
      // XML, not GPX.
      "<html><body><p>Bonjour</p></body></html>",
      // GPX with nothing to read.
      `<gpx xmlns="${NAMESPACE}"></gpx>`,
      gpx(""),
      `<gpx xmlns="${NAMESPACE}"><rte></rte><wpt lat="45" lon="6"/></gpx>`,
      gpx('<trkpt lat="abc" lon="def"/>'),
    ];
    const accepted = invalid.filter((xml) => {
      try {
        parseGpx(xml);
        return true;
      } catch (error) {
        return !(error instanceof GpxError);
      }
    });
    expect(accepted).toEqual([]);
  });
});
