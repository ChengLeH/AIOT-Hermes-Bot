import assert from "node:assert/strict";
import { test } from "node:test";
import { waitForCardAnimation } from "./card-motion.ts";

function animationEvent(name: string) {
  const event = new Event("animationend") as Event & { animationName: string };
  Object.defineProperty(event, "animationName", { value: name });
  return event;
}

test("card motion completes only for its own animation", () => {
  const element = new EventTarget() as HTMLElement;
  let completions = 0;
  const cancel = waitForCardAnimation(element, "card-exit", () => { completions += 1; });
  element.dispatchEvent(animationEvent("child-or-unrelated-animation"));
  assert.equal(completions, 0);
  element.dispatchEvent(animationEvent("card-exit"));
  assert.equal(completions, 1);
  cancel();
});

test("cancelling card motion disposes its fallback and listener", async () => {
  const element = new EventTarget() as HTMLElement;
  let completions = 0;
  const cancel = waitForCardAnimation(element, "card-exit", () => { completions += 1; });
  cancel();
  element.dispatchEvent(animationEvent("card-exit"));
  await new Promise((resolve) => setTimeout(resolve, 320));
  assert.equal(completions, 0);
});
