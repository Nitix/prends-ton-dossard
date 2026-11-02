import { Component, lazy, Suspense, useMemo, useRef, useState, type ReactNode } from "react";

import { SECONDARY } from "../../components/buttons";
import { DownloadIcon, ExternalIcon } from "../../components/icons";
import { useI18n } from "../../i18n/I18nProvider";
import type { FormatRecord } from "../../lib/types";
import { webAddress } from "../../lib/url";
import { trackURL, useTrack } from "./api";
import { ElevationProfile } from "./ElevationProfile";
import { gpxStats, type TrackPoint } from "./gpx";
import { MAP_BOX } from "./mapBox";
import type { SlopeZone } from "./slope";
import { TrackFigures } from "./TrackFigures";

// The map brings Leaflet along: it is loaded when a track is shown, not with the page.
const TrackMap = lazy(() => import("./TrackMap"));

const SEPARATOR = " · ";

/**
 * A map that fails (its chunk does not load, after a deploy or with the network
 * gone, or Leaflet throws) is no map: the page keeps the numbers, the profile
 * and the links, rather than the error screen of the router, and a line says
 * the map is not there (the chunk is only kept for offline once it has been
 * loaded: on a first visit with no network, a map that vanishes with no word
 * would look like a page that is missing something).
 */
class MapBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? <MapUnavailable /> : this.props.children;
  }
}

/** What stands in the place of a map that failed: one line, which is not an alert, since the page is all there. */
function MapUnavailable() {
  const { t } = useI18n();
  return <p className="map-unavailable text-sm text-neutral-600">{t.route.mapUnavailable}</p>;
}

/** What stands in the place of the map while it loads: a box of its size, so that the page does not jump. */
function MapLoading() {
  const { t } = useI18n();
  return (
    <output
      className={`map-loading ${MAP_BOX} flex items-center justify-center bg-neutral-100 text-sm text-neutral-600`}
    >
      {t.common.loading}
    </output>
  );
}

/**
 * The numbers of a track, then its map and its profile. A track without
 * altitudes has its length, and no profile.
 *
 * The map and the profile follow one cursor: where it is on the profile (a
 * pointer, a finger, the keys), the map has a mark, in the colour of the slope
 * under it; where the track of the map is pointed at or touched, the profile
 * reads it. Without a profile (no altitude), the map has no mark; without a
 * map (it could not be loaded), the profile works alone.
 */
function Track({ points }: { points: TrackPoint[] }) {
  const { t, f } = useI18n();
  // Where the cursor is, in kilometers from the start, and the zone of the slope
  // there as the profile reads it (`null` until the profile has drawn its cursor).
  const [cursorKm, setCursorKm] = useState<number | null>(null);
  const [cursorZone, setCursorZone] = useState<SlopeZone | null>(null);
  // The track under a pointer of the map puts the cursor there. A pointer that
  // leaves the track, or the map, takes it away, but not from a profile that has
  // the focus: the keys are using it, and it goes with the focus (or Escape).
  const profile = useRef<HTMLDivElement>(null);
  const onTrackKm = (km: number | null) => {
    if (km === null && profile.current?.contains(document.activeElement)) return;
    setCursorKm(km);
  };
  // Over every point: once per track, not at every move of the cursor.
  const stats = useMemo(() => gpxStats(points), [points]);
  const { min, max } = stats;
  // Without an altitude there is no gain and no loss to tell: not "0 m D+".
  const summary =
    min === undefined
      ? f.km(stats.km)
      : t.route.summary(f.km(stats.km), f.meters(stats.gain), f.meters(stats.loss));
  const altitude =
    min === undefined || max === undefined ? null : t.route.altitude(f.meters(min), f.meters(max));

  const first = points[0];

  return (
    <>
      <TrackFigures
        figures={summary.split(SEPARATOR)}
        altitude={altitude}
        start={first && { lat: first.lat, lon: first.lon }}
      />
      <MapBoundary>
        <Suspense fallback={<MapLoading />}>
          <TrackMap
            points={points}
            markerKm={cursorZone === null ? null : cursorKm}
            markerZone={cursorZone}
            onTrackKm={onTrackKm}
          />
        </Suspense>
      </MapBoundary>
      {/* Laid out as if it were not there: it only says where the profile is. */}
      <div ref={profile} className="contents">
        <ElevationProfile
          points={points}
          label={altitude === null ? t.route.profileLabel : `${t.route.profileLabel}, ${altitude}`}
          cursorKm={cursorKm}
          onCursorKm={setCursorKm}
          onCursorZone={setCursorZone}
        />
      </div>
    </>
  );
}

/**
 * The course of a format, on the page of its event: the numbers of its GPX
 * track, its map and its elevation profile, read from the file, a link to
 * download the file, and the link to the course on a website. Nothing for a
 * format with neither (a link that is not a web address is not one). A track
 * that cannot be read is said, and the links stay.
 */
export function RouteSection({ format }: { format: FormatRecord }) {
  const { t } = useI18n();
  const track = useTrack(format);
  const file = trackURL(format);
  const course = webAddress(format.route_url);
  if (file === undefined && course === null) return null;

  return (
    <div className="route-section mt-1 flex flex-col gap-3 border-t border-neutral-100 pt-4">
      <h3 className="route-title card-title">{t.route.title}</h3>
      {file !== undefined && track.isPending && <output>{t.common.loading}</output>}
      {file !== undefined && track.isError && (
        <output className="text-sm text-neutral-700">{t.route.unreadable}</output>
      )}
      {track.data && <Track points={track.data} />}
      <div className="route-links flex flex-wrap gap-2">
        {file !== undefined && (
          <a href={file} download className={`${SECONDARY} inline-flex items-center gap-2`}>
            <DownloadIcon className="size-[1.125rem] shrink-0 text-iris-600" />
            {t.route.download}
          </a>
        )}
        {course !== null && (
          <a
            href={course}
            target="_blank"
            rel="noopener noreferrer"
            className={`${SECONDARY} inline-flex items-center gap-2`}
          >
            <ExternalIcon className="size-4 shrink-0 text-iris-600" />
            {t.route.open}
          </a>
        )}
      </div>
    </div>
  );
}
