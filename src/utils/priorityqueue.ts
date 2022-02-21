interface HeapItem<T> {
  item: T;
  priority: number;
}

export default class PriorityQueue<T> {
  heap: HeapItem<T>[];

  constructor() {
    this.heap = [];
  }

  push(item: T, priority = 0) {
    this.heap.push({ item, priority });
    this.rebalanceUp();
  }

  pop() {
    if (this.heap.length) {
      const last = this.heap.length - 1;
      [this.heap[0], this.heap[last]] = [this.heap[last], this.heap[0]];
      const result = this.heap.pop()!.item;
      this.rebalanceDown();
      return result;
    }
    throw new Error('Queue is empty');
  }

  size() {
    return this.heap.length;
  }

  rebalanceUp() {
    let i = this.heap.length - 1;
    if (i === 0) {
      return;
    }

    while (i > 0) {
      const pi = Math.floor((i - 1) / 2);
      const cur = this.heap[i];
      const parent = this.heap[pi];
      if (cur.priority <= parent.priority) {
        break;
      }
      [this.heap[pi], this.heap[i]] = [this.heap[i], this.heap[pi]];
      i = pi;
    }
  }

  selectLargerChild(parent: number) {
    const lefti = parent * 2;
    const righti = parent + 1;

    if (lefti >= this.heap.length && righti >= this.heap.length) return -1;
    if (lefti >= this.heap.length) return righti;
    if (righti >= this.heap.length) return lefti;
    const leftp = this.heap[lefti].priority;
    const rightp = this.heap[righti].priority;
    if (leftp >= rightp) return lefti;
    return righti;
  }

  rebalanceDown() {
    let cur = 0;
    while (cur < this.heap.length) {
      const child = this.selectLargerChild(cur);
      if (child > 0) {
        [this.heap[cur], this.heap[child]] = [this.heap[child], this.heap[cur]];
        cur = child;
      } else {
        break;
      }
    }
  }
}
