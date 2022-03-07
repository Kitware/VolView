import { defineStore } from 'pinia';
import Vue from 'vue';

export enum MessageType {
  Error,
  Warning,
  Pending,
  Info,
}

export interface RegularMessage {
  type: MessageType.Warning | MessageType.Info;
  contents: string;
}

export interface ErrorMessage {
  type: MessageType.Error;
  contents: string;
  error: Error | null;
}

export interface PendingMessage {
  type: MessageType.Pending;
  contents: string;
  progress: number;
}

export type Message = RegularMessage | ErrorMessage | PendingMessage;

export type UpdateProgressFunction = (progress: number) => void;
export type TaskFunction = (updateProgress?: UpdateProgressFunction) => any;

export const useMessageStore = defineStore('messages', {
  state: () => ({
    _nextID: 1,
    byID: {} as Record<string, Message>,
    msgList: [] as string[],
  }),
  getters: {
    messages(): Array<Message> {
      return this.msgList.map((id: string) => this.byID[id]);
    },
  },
  actions: {
    addError(contents: string, error: Error | null = null) {
      return this._addMessage({
        type: MessageType.Error,
        contents,
        error,
      } as ErrorMessage);
    },
    addPending(contents: string, progress: number = -1) {
      return this._addMessage({
        type: MessageType.Pending,
        contents,
        progress,
      } as PendingMessage);
    },
    updatePendingProgress(id: string, progress: number) {
      const msg = this.byID[id];
      if (msg?.type === MessageType.Pending) {
        msg.progress = progress;
      }
    },
    addWarning(contents: string) {
      return this._addMessage({
        type: MessageType.Warning,
        contents,
      } as RegularMessage);
    },
    addInfo(contents: string) {
      return this._addMessage({
        type: MessageType.Info,
        contents,
      } as RegularMessage);
    },
    clearOne(id: string) {
      if (id in this.byID) {
        Vue.delete(this.byID, id);
        const idx = this.msgList.indexOf(id);
        this.msgList.splice(idx, 1);
      }
    },
    clearAll() {
      this.byID = {};
      this.msgList = [];
    },
    async runTaskWithMessage<T extends (...args: any) => any>(
      contents: string,
      taskFn: T
    ): Promise<ReturnType<T>> {
      const id = this.addPending(contents);
      const updateProgress = (progress: number) =>
        this.updatePendingProgress(id, progress);
      try {
        const result = await taskFn(updateProgress);
        this.clearOne(id);
        return result;
      } catch (err) {
        let error: Error | null = null;
        if (err instanceof Error) {
          error = err;
        } else {
          error = new Error(String(err));
        }
        this.byID[id] = {
          type: MessageType.Error,
          contents,
          error,
        };
        throw err;
      }
    },
    _addMessage(msg: Message) {
      const id = String(this._nextID++);
      Vue.set(this.byID, id, msg);
      this.msgList.push(id);
      return id;
    },
  },
});
