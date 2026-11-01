import { Component, lazy, Suspense, type ReactNode } from "react";

import { SECONDARY } from "../../components/buttons";
import { useI18n } from "../../i18n/I18nProvider";
import type { FormatRecord } from "../../lib/types";
import { webAddress } from "../../lib/url";
import { trackURL, useTrack } from "./api";
import { ElevationProfile } from "./ElevationProfile";
import { gpxStats, type TrackPoint } from "./gpx";
import { MAP_BOX } from "./mapBox";

// The map brings Leaflet along: it is loaded when a track is shown, not with the page.
const TrackMap = lazy(() => import("./TrackMap"));

/**
 * A map that fails (its chunk does not load, after a deploy or with the network
 * gone, or Leaflet throws) is no map: the page keeps the numbers, the profile
 * and the links, rather than the error screen of the router.
 */
class MapBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** What stands in the place of the map while it loads: a box of its size, so that the page does not jump. */
function MapLoading() {
  const { t } = useI18n();
  return (
    <output
      className={`${MAP_BOX} flex items-center justify-center bg-neutral-100 text-sm text-neutral-600`}
    >
      {t.common.loading}
    </output>
  );
}

/** The numbers of a track, then its map and its profile. A track without altitudes has its length, and no profile. */
function Track({ points }: { points: TrackPoint[] }) {
  const { t, f } = useI18n();
  const stats = gpxStats(points);
  const { min, max } = stats;
  // Without an altitude there is no gain and no loss to tell: not "0 m D+".
  const summary =
    min === undefined
      ? f.km(stats.km)
      : t.route.summary(f.km(stats.km), f.meters(stats.gain), f.meters(stats.loss));
  const altitude =
    min === undefined || max === undefined ? null : t.route.altitude(f.meters(min), f.meters(max));

  return (
    <>
      <p>{summary}</p>
      {altitude !== null && <p className="text-sm text-neutral-600">{altitude}</p>}
      <MapBoundary>
        <Suspense fallback={<MapLoading />}>
          <TrackMap points={points} />
        </Suspense>
      </MapBoundary>
      <ElevationProfile
        points={points}
        label={altitude === null ? t.route.profileLabel : `${t.route.profileLabel}, ${altitude}`}
      />
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
    <div className="flex flex-col gap-2 border-t border-neutral-200 pt-2">
      <h3 className="text-base font-semibold">{t.route.title}</h3>
      {file !== undefined && track.isPending && <output>{t.common.loading}</output>}
      {file !== undefined && track.isError && (
        <output className="text-sm text-neutral-700">{t.route.unreadable}</output>
      )}
      {track.data && <Track points={track.data} />}
      <div className="flex flex-wrap gap-2">
        {file !== undefined && (
          <a href={file} download className={`${SECONDARY} inline-flex items-center`}>
            {t.route.download}
          </a>
        )}
        {course !== null && (
          <a
            href={course}
            target="_blank"
            rel="noopener noreferrer"
            className={`${SECONDARY} inline-flex items-center`}
          >
            {t.route.open}
          </a>
        )}
      </div>
    </div>
  );
}
