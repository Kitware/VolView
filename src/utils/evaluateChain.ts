import { Awaitable } from '@vueuse/core';

export const Skip = Symbol('Chain:Skip');

export type ChainHandler<Input, Output, Context = any> = (
  input: Input,
  context?: Context
) => Awaitable<Output | typeof Skip>;

export async function evaluateChain<Input, Output, Context = any>(
  data: Input,
  handlers: Array<ChainHandler<Input, Output, Context>>,
  context?: Context
) {
  /* eslint-disable no-await-in-loop */
  for (let i = 0; i < handlers.length; i++) {
    const handler = handlers[i];
    const response = await handler(data, context);
    if (response !== Skip) {
      return response;
    }
  }
  /* eslint-enable no-await-in-loop */

  throw new Error('Unhandled request');
}
