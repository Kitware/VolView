import { useMessageStore } from '../store/messages';

export async function useErrorMessage(message: string, task: Function) {
  try {
    return await task();
  } catch (err) {
    if (err instanceof Error) {
      const messageStore = useMessageStore();
      messageStore.addError(message, {
        details: `${err}. More details can be found in the developer's console.`,
      });
    }
    console.error(err);
  }
  return undefined;
}
