const INSTANCES_KEY = "__sortable_mock_instances__";
if (!(globalThis as any)[INSTANCES_KEY]) {
  (globalThis as any)[INSTANCES_KEY] = [];
}

class SortableMock {
  static get instances(): SortableMock[] {
    return (globalThis as any)[INSTANCES_KEY];
  }
  static set instances(val: SortableMock[]) {
    (globalThis as any)[INSTANCES_KEY] = val;
  }

  el: HTMLElement;
  options: Record<string, any>;
  destroy() {}

  constructor(el: HTMLElement, options: Record<string, any>) {
    this.el = el;
    this.options = options;
    SortableMock.instances.push(this);
  }
}

export default SortableMock;
