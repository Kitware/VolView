import { defineStore } from 'pinia';
import Vue from 'vue';

export enum MessageType {
  Error,
  Warning,
  Info,
  Success,
}

export interface Message {
  id: string;
  type: MessageType;
  title: string;
  details?: string;
}

export type UpdateProgressFunction = (progress: number) => void;
export type TaskFunction = (updateProgress?: UpdateProgressFunction) => any;

interface State {
  _nextID: number;
  byID: Record<string, Message>;
  msgList: string[];
}

export const useMessageStore = defineStore('message', {
  state: (): State => ({
    _nextID: 1,
    byID: {},
    msgList: [],
  }),
  getters: {
    messages(): Array<Message> {
      return this.msgList.map((id: string) => this.byID[id]);
    },
  },
  actions: {
    addError(title: string, error?: Error | string) {
      return this._addMessage({
        type: MessageType.Error,
        title,
        details: error ? String(error) : undefined,
      });
    },
    addWarning(title: string, details?: string) {
      return this._addMessage({
        type: MessageType.Warning,
        title,
        details,
      });
    },
    addInfo(title: string, details?: string) {
      return this._addMessage({
        type: MessageType.Info,
        title,
        details,
      });
    },
    addSuccess(title: string, details?: string) {
      return this._addMessage({
        type: MessageType.Success,
        title,
        details,
      });
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
    _addMessage(msg: Omit<Message, 'id'>) {
      const id = String(this._nextID++);
      Vue.set(this.byID, id, {
        ...msg,
        id,
      });
      this.msgList.push(id);
      return id;
    },
  },
});
