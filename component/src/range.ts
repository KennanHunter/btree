// Range search is reserved — the types are exposed so the UI's op selector
// and operation-result switch stay exhaustive. dispatch() throws
// NotImplemented until core grows a range_search() method.

export type RangeSearchResult = {
  type: "RangeSearch";
  values: number[];
};
