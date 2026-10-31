export type AnimationID = number;

export class AnimationIDGenerator {
  count: number = 0;

  allocate_id(): number {
    return ++this.count;
  }
}
