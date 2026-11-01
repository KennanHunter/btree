import type {
  BTreeEvent,
  BTreeEventRecorder,
  BTreeOperation,
} from "../btree/events";

/**
 * This class records events, then rolls them into a single operation
 */
class AnimationEventRecorder implements BTreeEventRecorder {
  event_log: BTreeEvent[] = [];

  record(event: BTreeEvent) {
    this.event_log.push(event);
  }

  clear() {}

  rollup_operation(type: BTreeOperation["type"]): BTreeOperation {
    let res: BTreeOperation = {
      type,
      events: this.event_log,
    };

    this.event_log = [];

    return res;
  }
}
