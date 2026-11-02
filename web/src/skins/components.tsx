import { createElement, type ComponentType } from "react";

import { useSlot } from ".";
import type { SlotName, SlotProps } from "./types";

// How the app draws what a skin changes in its markup: the motif of a slot,
// made once, at the top of a module (components/Slots.tsx). What it draws is a
// component of the registry, the same for as long as the skin is: never one
// made during the render (which is what `react/static-components` guards against).

/**
 * The component that draws the motif of the skin of the page in the slot
 * `name`: its own, or Crête's. components/Slots.tsx makes one per slot.
 */
export function slotted<N extends SlotName>(name: N): ComponentType<SlotProps[N]> {
  function Slotted(props: SlotProps[N]) {
    const Motif: ComponentType<SlotProps[N]> = useSlot(name);
    return createElement(Motif, props);
  }
  Slotted.displayName = `Slot(${name})`;
  return Slotted;
}
