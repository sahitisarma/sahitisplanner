// Tiny shared hub so views can ask the app shell to do things
// (open a day, time-block a task, focus a new item) without import cycles.
export const bus = {
  focusItem: null,
  navigate: null, // (route) => void
  openDay: null, // (dayKey) => void
  timeBlock: null, // (item) => void
  editEvent: null, // (event|null, defaults) => void
  capture: null, // (text?) => void
  rerender: null,
};
