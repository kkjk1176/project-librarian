"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { applyChoiceKey } = require("../../dist/install.js");

test("interactive chooser moves the cursor and toggles individual agents", () => {
  const initial = { cursor: 0, selected: [true, true, false] };
  assert.deepEqual(applyChoiceKey(initial, "down", true, 3), { cursor: 1, selected: [true, true, false] });
  assert.deepEqual(applyChoiceKey(initial, "space", true, 3), { cursor: 0, selected: [false, true, false] });
});

test("interactive chooser toggles all agents and supports submit/cancel", () => {
  const initial = { cursor: 0, selected: [true, true, false] };
  assert.deepEqual(applyChoiceKey(initial, "a", true, 3), { cursor: 0, selected: [true, true, true] });
  assert.deepEqual(applyChoiceKey({ cursor: 0, selected: [true, true, true] }, "a", true, 3), { cursor: 0, selected: [false, false, false] });
  assert.equal(applyChoiceKey(initial, "return", true, 3), "submit");
  assert.equal(applyChoiceKey(initial, "q", true, 3), "cancel");
});

test("single-choice scope ignores checkbox toggles", () => {
  const initial = { cursor: 0, selected: [true, false] };
  assert.deepEqual(applyChoiceKey(initial, "space", false, 2), initial);
  assert.deepEqual(applyChoiceKey(initial, "down", false, 2), { cursor: 1, selected: [true, false] });
});
