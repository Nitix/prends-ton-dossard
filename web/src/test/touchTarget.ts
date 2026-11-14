/**
 * The smallest side of a target that a finger presses: 44 px, less 0.01 px. A layout in
 * fractions of a pixel (zoom, a line height in rem, a device scale) gives 43.99998 or 43.995 for
 * a box that is 44 px as designed (run 25: McpSection; locally DuplicatesPage on the iPhone), and
 * no finger tells 0.01 px. A box that is really smaller still fails. (The 43.93 once read on
 * DuplicatesPage on WebKit was not a smaller box and no fix was made to the page: it was the press
 * transition of a button just clicked, still settling. The test waits for animationsDone().) Every test of a 44 px target compares with this.
 */
export const MIN_TARGET = 44 - 0.01;
