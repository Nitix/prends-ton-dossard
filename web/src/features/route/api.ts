import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { pb } from "../../lib/pb";
import type { FormatRecord } from "../../lib/types";
import { GpxError, parseGpx, type TrackPoint } from "./gpx";

/** Where the GPX file of a format is on the server, or undefined for a format that has none. */
export function trackURL(format: FormatRecord): string | undefined {
  return format.gpx ? pb.files.getURL(format, format.gpx) : undefined;
}

/**
 * The points of the GPX track of a format, read in the browser: the file is
 * fetched from the server, then parsed (the server never reads it). Nothing is
 * asked for a format with no track. A file is never changed (a new one has a
 * new name, which is in the key), so what is read stays good.
 *
 * It fails with a `GpxError` when the file cannot be read as a track, which
 * includes a file the server does not give: retrying would not help. A network
 * failure is tried again.
 */
export function useTrack(format: FormatRecord): UseQueryResult<TrackPoint[]> {
  return useQuery({
    queryKey: ["track", format.id, format.gpx ?? ""],
    enabled: !!format.gpx,
    staleTime: Infinity,
    retry: (failures, error) => !(error instanceof GpxError) && failures < 2,
    queryFn: async () => {
      const url = trackURL(format);
      if (url === undefined) throw new GpxError("The format has no track.");
      const response = await fetch(url);
      if (!response.ok) throw new GpxError(`The server answered ${response.status}.`);
      return parseGpx(await response.text());
    },
  });
}
