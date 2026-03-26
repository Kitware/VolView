import { defineStore } from 'pinia';
import { removeFromArray } from '../utils';
import { generateBugReport } from '../utils/bugReport';

export enum MessageType {
  Error,
  Warning,
  Info,
  Success,
}

export type MessageOptions = {
  details?: string;
  persist?: boolean;
};

export interface Message {
  id: string;
  type: MessageType;
  title: string;
  options: MessageOptions;
  bugReport?: string;
}

export type ErrorOptions = {
  error?: Error;
  details?: string;
  persist?: boolean;
};

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
    // only info, error, warn
    importantMessages(): Array<Message> {
      return this.messages.filter((msg) => msg.type !== MessageType.Success);
    },
  },
  actions: {
    addError(title: string, opts?: ErrorOptions) {
      console.error(title, opts?.error ?? opts?.details);

      return this._addMessage(
        {
          type: MessageType.Error,
          title,
          bugReport: generateBugReport(opts?.error),
        },
        {
          details: opts?.details ?? opts?.error?.stack,
          persist: opts?.persist ?? false,
        }
      );
    },
    /**
     * Adds a warning message.
     * @param title message title
     * @param opts a string containing details or a MessageOptions
     */
    addWarning(title: string, details?: string | MessageOptions) {
      return this._addMessage(
        {
          type: MessageType.Warning,
          title,
        },
        details
      );
    },
    /**
     * Adds a success message.
     * @param title message title
     * @param opts a string containing details or a MessageOptions
     */
    addInfo(title: string, details?: string | MessageOptions) {
      return this._addMessage(
        {
          type: MessageType.Info,
          title,
        },
        details
      );
    },
    /**
     * Adds a success message.
     * @param title message title
     * @param opts a string containing details or a MessageOptions
     */
    addSuccess(title: string, details?: string | MessageOptions) {
      return this._addMessage(
        {
          type: MessageType.Success,
          title,
        },
        details
      );
    },
    clearOne(id: string) {
      if (id in this.byID) {
        removeFromArray(this.msgList, id);
        delete this.byID[id];
      }
    },
    clearAll() {
      this.byID = {};
      this.msgList = [];
    },
    _addMessage(
      msg: Omit<Message, 'id' | 'options'>,
      details?: string | MessageOptions
    ) {
      const id = String(this._nextID++);
      const options: MessageOptions = {
        persist: false,
        ...(typeof details === 'string' ? { details } : details),
      };
      this.byID[id] = {
        ...msg,
        options,
        id,
      };
      this.msgList.push(id);
      return id;
    },
  },
});
